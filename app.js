// app.js - Lógica principal de Reunión+
import * as db from './db.js';
import { isFirebaseConfigured } from './firebase-config.js';
import { isFirebaseReady, borrarParticipantesReunionesProgramas, limpiarTodasLasColecciones } from './firestore.js';
import { iniciarSync, pullSiVacio, reconciliar, syncStatus } from './sync.js';
import { login, loginWithGoogle, logout, restoreSession, currentUser, isAuthenticated, onAuthChange, reauthenticate } from './auth.js';
import {
  MONTHS_ES, WEEK_TYPES, FIELD_LABORE, FIELD_LABELS,
  normalizeStr, searchTalks, saturdaysOf,
  collectWeekPersons, labelOfKey, labelOf,
  computeConflicts, computeOutingConflicts, weekComplete, computeMidweekConflicts,
  dedupPersons, eligiblePeople, isAtencionPerson, ATENCION_DEF, collectMidweekPersons,
  capitalize, escapeHtml, escapeAttr, cryptoId,
  isoDate, eventTypeForDate, upcomingEvents, DAYS_ES_NAMES, addDays,
  convertPdfToData, convertPdfTalks, convertPdfPeople, convertPdfMidweeks, midweekGuideSummary, rebuildPdfWords,
  computeCrossConflicts, canBePair, CALIFICACIONES, midweekSlotsOf,
  isStudentPerson, isStudentLabore, laboreAllowedForPerson,
  automatizarEntreSemana, automatizarAtencion, automatizarFinSemana,
  camposFinSemana, extractAssignments, assignmentMetrics,
  defaultAlgorithmConfig, defaultScoringConfig,
  generateProposals, scoreSolution, salidasFaltantes,
  laboresVaciasPropuesta, sinAsignarPorMotivo,
  workloadByPerson, historyTimeline, distributionByLabore, pairRoleStats,
} from './logic.js';

/* ---------- Estado ---------- */
const state = {
  view: 'home',           // home | new | auto | edit | preview | outings | lists | uploads | eventos | labores | laboresGrupo | salidas | general | settings | about | midweeks | midweek | midweekPreview | midweekMonthPreview | midweekList
  newTab: 'fin',          // 'fin' | 'entre' | 'atencion' | 'atencionGrupo' | 'salidas' | 'general' (en Programas)
  monthId: null,          // "YYYY-MM"
  month: null,
  previewMode: 'lista',   // lista | tabla
  people: [],
  departments: [],
  talks: [],              // lista de discursos públicos [{num, title}]
  labores: [],            // labores del equipo [{id, label}]
  midweeks: [],           // reuniones de entre semana
  config: null,           // configuración general
  toastsOpen: new Set(),
  mwMonth: null,          // mes seleccionado en la vista mensual de entre semana
  progMonth: null,        // mes seleccionado en Programas (selector global)
  listsTab: 'labores',    // 'labores' | 'historial' (vista Personas)
  listsShowInactive: false, // mostrar también las personas desactivadas (borrado lógico)
};

/* ---------- INIT ---------- */
init();

async function init() {
  await db.seedIfEmpty();
  await refreshCatalogs();
  registerSW();
  bindGlobal();
  // Sincronización con Firebase (si está configurado). No bloquea el arranque.
  iniciarSync().catch(() => {});
  // Autenticación: restaurar sesión persistente y actualizar la UI.
  onAuthChange((user) => {
    renderAuthUI();
    // Al cambiar la sesión, refrescar la vista Inicio (bienvenida ↔ tablero).
    if (state.view === 'home') router();
    // Al iniciar sesión en un dispositivo sin datos locales, traer de Firebase.
    if (user && isAuthenticated()) pullSiVacio().catch(() => {});
    if (user && isAuthenticated()) reconciliar().catch(() => {});
  });
  restoreSession().catch(() => {}).finally(renderAuthUI);
  window.addEventListener('hashchange', router);
  initSyncIndicator();
  router();
}

async function refreshCatalogs() {
  state.people = await db.listPeople();
  state.departments = await db.listDepartments();
  state.talks = await db.listTalks();
  state.midweeks = await db.listMidweeks();
  state.config = await db.getConfig();
  const saved = await db.getLabores(null);
  state.labores = (saved && Array.isArray(saved) && saved.length)
    ? saved
    : DEFAULT_LABORES.map(r => ({ ...r }));
  const canonAudio = state.labores.find(r => r.id === 'audio');
  if (canonAudio) canonAudio.label = 'Sonido';
  if (state.labores.some(r => r.id === 'sonido')) {
    state.labores = state.labores.filter(r => r.id !== 'sonido');
  }
  state.people.forEach(p => {
    if (!Array.isArray(p.labores)) return;
    p.labores = p.labores.map(l => (l === 'sonido' ? 'audio' : l));
  });
}

// Indicador global de conexión con la base de datos. Luz simple en la barra de
// navegación: verde cuando la app está conectada (en línea) y roja cuando está
// fuera de línea. Sin textos de sincronización: los datos se refrescan en
// segundo plano sin molestar al usuario.
function initSyncIndicator() {
  const root = el(`<span id="syncIndicator" class="hidden items-center gap-1.5 px-2 py-1.5 rounded-full font-label-md text-label-md" title="Estado de conexión">
    <span id="syncIndicatorDot" class="w-2.5 h-2.5 rounded-full inline-block" style="background:#e5484d"></span>
    <span id="syncIndicatorTxt">Sin conexión</span>
  </span>`);
  const container = document.getElementById('onlineBtn');
  if (container && container.parentNode) {
    container.parentNode.insertBefore(root, container.nextSibling);
  } else {
    document.body.appendChild(root);
  }
  const dot = $('#syncIndicatorDot');
  const txt = $('#syncIndicatorTxt');

  const pintar = () => {
    const on = navigator.onLine;
    root.classList.remove('hidden');
    root.classList.add('flex');
    dot.style.background = on ? '#2e7d32' : '#e5484d';
    txt.textContent = on ? 'on line' : 'off line';
  };
  window.addEventListener('online', pintar);
  window.addEventListener('offline', pintar);
  // Al terminar una descarga, refrescar catálogos y repintar la vista actual.
  window.addEventListener('reunion-sync', (e) => {
    const st = e.detail || {};
    if (st.state !== 'syncing' && /descargando|descarga|pull/i.test(String(st.detail || ''))) {
      refreshCatalogs().then(() => router()).catch((err) => console.warn('[Reunión+] Refresco tras descarga falló', err));
    }
    pintar();
  });
  pintar();
}

// Reconstruye el historial de asignaciones desde el estado actual de todos los
// programas (entre semana, fin de semana, acomodación y salidas). Es idempotente:
// las entradas tienen id compuesto persona+fecha+programa+puesto, así que
// re-sincronizar actualiza las ya existentes y añade las nuevas sin duplicar.
async function syncAssignmentLog() {
  try {
    const [midweeks, months, salidas, labores] = await Promise.all([
      db.listMidweeks(),
      db.listMonths(),
      db.listSalidas(),
      db.listAtencion(),
    ]);
    const entries = extractAssignments(midweeks, months, salidas, labores, state.people);
    await db.bulkPutAssignmentLog(entries);
  } catch (e) {
    console.warn('[Reunión+] No se pudo sincronizar el historial de asignaciones', e);
  }
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      // Si hay una nueva versión del SW instalándose, avisar y actualizar.
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      reg.addEventListener('updatefound', () => {
        const nuevo = reg.installing;
        if (!nuevo) return;
        nuevo.addEventListener('statechange', () => {
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
            reg.waiting && reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }).catch(() => {});
    // Cuando un nuevo SW toma control, recargar para usar la versión nueva.
    let recargando = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recargando) return;
      recargando = true;
      window.location.reload();
    });
  }
}

function bindGlobal() {
  document.getElementById('settingsBtn').addEventListener('click', () => go('settings'));
  document.getElementById('sideAbout').addEventListener('click', () => go('about'));
  document.getElementById('sideNewMonth').addEventListener('click', () => go('new'));
  document.getElementById('navToggle').addEventListener('click', () => {
    document.getElementById('sideNav').classList.toggle('hidden');
  });
  document.getElementById('authBtn').addEventListener('click', onClickAuthBtn);
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();
}

// Estado de la autenticación en la interfaz (Fase 6). Si Firebase no está
// configurado, el botón queda oculto y la app funciona sin login.
function renderAuthUI() {
  const btn = document.getElementById('authBtn');
  const label = document.getElementById('authBtnLabel');
  const badge = document.getElementById('sideAuthBadge');
  const user = currentUser();
  if (!isFirebaseConfigured()) {
    if (btn) btn.style.display = 'none';
    if (badge) badge.classList.add('hidden');
    return;
  }
  if (!btn || !badge) return;
  if (user) {
    btn.style.display = 'flex';
    btn.title = 'Cerrar sesión';
    label.textContent = user.email || 'Salir';
    badge.classList.remove('hidden');
    badge.textContent = user.rol === 'admin' ? '👑 Admin' : '👁️ Solo lectura';
    badge.className = `text-[11px] font-label-md mt-1 ${user.rol === 'admin' ? 'text-tertiary' : 'text-on-surface-variant'}`;
  } else {
    btn.style.display = 'flex';
    btn.title = 'Iniciar sesión';
    label.textContent = 'Entrar';
    badge.classList.add('hidden');
    badge.textContent = '';
  }
  // Ocultar/mostrar acciones administrativas según el rol (solo UX; la seguridad
  // real está en Firestore Security Rules).
  document.body.classList.toggle('is-reader', !!user && user.rol !== 'admin');
  document.body.classList.toggle('is-admin', !!user && user.rol === 'admin');
  document.body.classList.toggle('is-logged', !!user);
}

async function onClickAuthBtn() {
  const user = currentUser();
  if (user) {
    await logout();
    toast('Sesión cerrada', 'success');
    renderAuthUI();
    // Con la sesión cerrada, la app vuelve a la bienvenida (bloqueo real).
    if (location.hash.replace(/^#\/?/, '') !== 'home') location.hash = '#/home';
    renderWelcome();
    return;
  }
  openLoginModal();
}

// Modal de inicio de sesión (email + contraseña).
function openLoginModal() {
  openModal(`
    <div class="text-center">
      <span class="material-symbols-outlined text-6xl text-primary mb-2">lock</span>
      <h3 class="font-headline-md text-headline-md text-primary mb-1">Iniciar sesión</h3>
      <p class="text-on-surface-variant text-sm mb-4">Acceso con la cuenta de la congregación.</p>
      <form id="loginForm" class="space-y-4 text-left">
        <div>
          <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Correo electrónico</label>
          <input id="loginEmail" type="email" required placeholder="usuario@ejemplo.com" autocomplete="email" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
        </div>
        <div>
          <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Contraseña</label>
          <input id="loginPass" type="password" required placeholder="••••••••" autocomplete="current-password" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
        </div>
        <div class="flex gap-3 justify-end pt-2">
          <button type="button" id="loginCancel" class="px-5 py-2.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cancelar</button>
          <button type="submit" class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Entrar</button>
        </div>
      </form>
      <div class="flex items-center gap-3 my-4">
        <div class="flex-1 h-px bg-outline-variant"></div>
        <span class="text-on-surface-variant text-sm">o</span>
        <div class="flex-1 h-px bg-outline-variant"></div>
      </div>
      <button type="button" id="loginGoogle" class="w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">
        <svg class="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
        </svg>
        Continuar con Google
      </button>
      <p class="text-on-surface-variant text-xs mt-3">Acceso restringido a los correos autorizados por la congregación.</p>
    </div>`);
  $('#loginCancel').onclick = closeModal;
  $('#loginGoogle').onclick = async () => {
    try {
      await loginWithGoogle();
      closeModal();
      toast('Sesión iniciada', 'success');
      renderAuthUI();
    } catch (err) {
      toast('No se pudo iniciar sesión: ' + (err.message || err), 'error');
    }
  };
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#loginEmail').value.trim();
    const pass = $('#loginPass').value;
    if (!email || !pass) { toast('Completa correo y contraseña', 'error'); return; }
    try {
      await login(email, pass);
      closeModal();
      toast('Sesión iniciada', 'success');
      renderAuthUI();
    } catch (err) {
      toast('No se pudo iniciar sesión: ' + (err.message || err), 'error');
    }
  };
}
function updateOnline() {
  const btn = document.getElementById('onlineBtn');
  if (navigator.onLine) {
    btn.textContent = 'cloud';
    btn.classList.remove('text-error');
    btn.classList.add('text-on-surface-variant');
    btn.title = 'En línea';
  } else {
    btn.textContent = 'cloud_off';
    btn.classList.add('text-error');
    btn.classList.remove('text-on-surface-variant');
    btn.title = 'Sin conexión';
  }
}

/* ---------- Router (hash) ---------- */
function go(view, params = {}) {
  let hash = `#/${view}`;
  if (params.monthId) hash += `/${params.monthId}`;
  if (params.previewMode) hash += `?mode=${params.previewMode}`;
  location.hash = hash;
  // cerrar sidenav en móvil
  if (window.innerWidth < 1024) document.getElementById('sideNav').classList.add('hidden');
}

function router() {
  const hash = location.hash.replace(/^#\/?/, '') || 'home';
  const [path, query] = hash.split('?');
  const segs = path.split('/').filter(Boolean);
  const view = segs[0] || 'home';
  // Arquitectura segura: sin sesión, la única pantalla accesible es la
  // bienvenida; cualquier vista interna queda bloqueada.
  if (appBloqueada()) {
    state.view = 'home';
    renderTop();
    renderSide();
    renderWelcome();
    return;
  }
  state.view = view;
  if (segs[1]) state.monthId = segs[1];
  const qp = new URLSearchParams(query || '');
  if (qp.get('mode')) state.previewMode = qp.get('mode');

  // reset action bar (solo la vista preview la usa)
  const bar = $('#actionBar');
  if (view !== 'preview') { bar.classList.add('hidden'); bar.innerHTML = ''; }

  renderTop();
  renderSide();
  switch (view) {
    case 'new':      renderNew(); break;
    case 'auto':     renderAutoAsignacion(); break;
    case 'edit':     renderEdit(); break;
    case 'preview':  renderPreview(); break;
    case 'outings':  renderOutings(); break;
    case 'lists':    renderLists(); break;
    case 'uploads':  renderUploads(); break;
    case 'eventos':  renderEventos(); break;
    case 'midweeks': renderMidweeks(); break;
    case 'midweek':  renderMidweek(segs[1]); break;
    case 'midweekPreview': renderMidweekPreview(segs[1]); break;
    case 'midweekMonthPreview': renderMidweekMonthPreview(segs[1]); break;
    case 'midweekList': renderMidweekList(); break;
    case 'atencion':  renderAtencion(segs[1]); break;
    case 'atencionGrupo': renderAtencionGrupo(segs[1]); break;
    case 'salidas':  renderSalidas(segs[1]); break;
    case 'general':  renderGeneralMonth(segs[1]); break;
    case 'algoritmo': renderAlgoritmo(); break;
    case 'settings': renderSettings(); break;
    case 'about':    renderAbout(); break;
    default:         renderHome();
  }
}

/* ---------- Helpers UI ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

const infoTip = (text) => `<span class="material-symbols-outlined text-[16px] leading-none text-on-surface-variant cursor-help align-middle" title="${escapeAttr(text)}">info</span>`;

function toast(msg, type = 'info') {
  const root = $('#toastRoot');
  const colors = {
    info:  'bg-surface-container-high text-on-surface',
    success:'bg-tertiary-fixed text-on-primary-fixed',
    error: 'bg-error-container text-on-error-container border border-error',
  }[type];
  const node = el(`<div class="toast-enter ${colors} p-4 rounded-xl shadow-lg flex items-center gap-3 max-w-sm">
    <span class="material-symbols-outlined">${type === 'error' ? 'error' : type === 'success' ? 'check_circle' : 'info'}</span>
    <span class="text-sm font-medium">${msg}</span>
  </div>`);
  root.appendChild(node);
  setTimeout(() => { node.style.opacity = '0'; node.style.transition = 'opacity .3s'; setTimeout(() => node.remove(), 300); }, 3500);
}

function openModal(html, wide = false) {
  const root = $('#modalRoot');
  const card = $('#modalCard');
  if (wide) { card.classList.remove('max-w-lg'); card.classList.add('max-w-[64rem]'); }
  else { card.classList.remove('max-w-[64rem]'); card.classList.add('max-w-lg'); }
  card.innerHTML = html;
  card.classList.add('modal-enter');
  root.classList.remove('hidden');
  $('#modalBackdrop').onclick = closeModal;
}
function closeModal() { $('#modalRoot').classList.add('hidden'); $('#modalCard').innerHTML = ''; }

function confirmDialog(message, okText = 'Confirmar') {
  return new Promise((resolve) => {
    openModal(`<div class="text-center">
      <span class="material-symbols-outlined text-6xl text-primary mb-2">help</span>
      <p class="font-body-lg text-body-lg text-on-surface mb-6">${message}</p>
      <div class="flex gap-3 justify-center">
        <button id="mdCancel" class="px-5 py-2.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cancelar</button>
        <button id="mdOk" class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">${okText}</button>
      </div>
    </div>`);
    $('#mdCancel').onclick = () => { closeModal(); resolve(false); };
    $('#mdOk').onclick     = () => { closeModal(); resolve(true); };
  });
}

/* ---------- Top + Side ---------- */
// Bloqueo real de la app: si Firebase está configurado y no hay sesión, la única
// pantalla accesible es la bienvenida con el botón de inicio de sesión. La
// seguridad efectiva la impone `firestore.rules`; esta es la capa de UI.
function appBloqueada() {
  return isFirebaseConfigured() && !isAuthenticated();
}

function renderTop() {
  // El menú superior se elimina; la navegación vive en la barra lateral (sidebar).
  // Sin sesión: ocultar la navegación, solo queda la bienvenida.
  if (appBloqueada()) { $('#settingsBtn').style.display = 'none'; $('#topTitle').textContent = 'Reunión+'; $('#topBadge').classList.add('hidden'); return; }
  $('#settingsBtn').style.display = 'flex';

  const badge = $('#topBadge');
  if (state.month) {
    $('#topTitle').textContent = `${MONTHS_ES[state.month.month - 1]} ${state.month.year}`;
    badge.textContent = state.month.published ? 'Final' : 'Borrador';
    badge.classList.remove('hidden');
  } else {
    $('#topTitle').textContent = 'Reunión+';
    badge.classList.add('hidden');
  }
}

function renderSide() {
  const nav = $('#sideNavItems');
  // Sin sesión: sin navegación lateral ni acciones administrativas.
  if (appBloqueada()) {
    nav.innerHTML = '';
    $('#sideNewMonth').style.display = 'none';
    $('#sideAbout').style.display = 'none';
    return;
  }
  $('#sideNewMonth').style.display = '';
  $('#sideAbout').style.display = '';
  const items = [
    { id: 'home', icon: 'calendar_month', label: 'Tablero', view: 'home' },
    { id: 'new', icon: 'add_circle', label: 'Programa', view: 'new' },
    { id: 'lists', icon: 'group', label: 'Personas y Deptos.', view: 'lists' },
    { id: 'uploads', icon: 'upload_file', label: 'Carga de Archivos', view: 'uploads' },
    { id: 'eventos', icon: 'event', label: 'Eventos', view: 'eventos' },
    { id: 'settings', icon: 'settings', label: 'Ajustes', view: 'settings' },
  ];
  nav.innerHTML = items.map(i =>
    `<button data-go="${i.id}" class="flex items-center gap-3 px-4 py-3 ${state.view === i.view ? 'bg-secondary-container text-on-secondary-container rounded-lg font-bold' : 'text-on-surface-variant hover:bg-surface-variant rounded-lg'} transition-all w-full text-left">
      <span class="material-symbols-outlined">${i.icon}</span>
      <span class="font-label-md text-label-md">${i.label}</span>
    </button>`
  ).join('');
  nav.querySelectorAll('button').forEach(b => b.onclick = () => go(b.dataset.go));
}

/* ---------- HOME: Tablero principal ---------- */
// Página de bienvenida a la app: se muestra en la vista Inicio cuando no hay
// sesión activa. Ofrece el botón de inicio de sesión de la congregación.
function renderWelcome() {
  const app = $('#app');
  app.innerHTML = `
    <div class="flex flex-col items-center justify-center text-center py-16 md:py-24">
      <div class="w-20 h-20 rounded-2xl bg-primary text-on-primary flex items-center justify-center mb-6 shadow-lg">
        <span class="material-symbols-outlined text-5xl">auto_stories</span>
      </div>
      <h1 class="font-display-lg text-display-lg text-primary mb-3">Bienvenido a Reunión+</h1>
      <p class="font-body-lg text-body-lg text-on-surface-variant max-w-md mb-8">
        Organiza el programa mensual de las reuniones de la congregación: asignaciones,
        reuniones de entre semana, atención y salidas, todo en un solo lugar.
      </p>
      <button id="welcomeLogin" class="flex items-center gap-2 bg-primary text-on-primary px-8 py-3.5 rounded-xl font-label-lg text-label-lg hover:opacity-90 hover:shadow-lg transition-all active:scale-95">
        <span class="material-symbols-outlined text-[22px]">login</span>
        Entrar
      </button>
      <button id="welcomeMore" class="mt-3 text-on-surface-variant text-sm underline hover:text-primary transition-colors">¿Qué es esto?</button>
    </div>
  `;
  $('#welcomeLogin').onclick = openLoginModal;
  $('#welcomeMore').onclick = () => go('about');
}

async function renderHome() {
  state.month = null;
  if (isFirebaseConfigured() && !isAuthenticated()) { renderWelcome(); return; }
  const months = await db.listMonths();
  months.sort((a, b) => b.id.localeCompare(a.id));
  _homeMonths = months;
  _homeAseos = await db.listAseos();
  const app = $('#app');
  app.innerHTML = `
    <div class="mb-10 md:flex justify-between items-end gap-4">
      <div>
        <h1 class="font-display-lg text-display-lg text-primary mb-2">Tablero Principal</h1>
        <p class="font-body-lg text-body-lg text-on-surface-variant">Resumen de actividades y asignaciones para la semana en curso.</p>
      </div>
      <button id="btnNew" data-admin class="flex items-center gap-2 bg-primary text-on-primary px-5 py-3 rounded-lg font-label-md text-label-md hover:shadow-lg transition-all active:scale-95 whitespace-nowrap">
        <span class="material-symbols-outlined text-[20px]">add_circle</span>
        Nuevo Programa
      </button>
    </div>

    <!-- Bento Grid -->
    <div class="grid grid-cols-1 md:grid-cols-12 gap-gutter">
      <!-- Columna izquierda: reuniones -->
      <div class="md:col-span-8 md:grid-rows-1 flex flex-col gap-4">
        <!-- Entre Semana -->
        <div data-go-mw class="flex-1 bg-surface-container-lowest rounded-xl p-6 border border-outline-variant shadow-[0_4px_20px_rgba(0,0,0,0.04)] cursor-pointer hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] hover:border-primary transition-all" title="Abrir la reunión de entre semana de esta semana">
          <div class="flex items-center justify-between mb-6 gap-3">
            <h3 class="font-headline-md text-headline-md text-primary flex items-center gap-2">
              <span class="material-symbols-outlined">auto_stories</span>
              Reunión Entre Semana
            </h3>
            <span class="bg-surface-container-highest px-3 py-1 rounded font-label-md text-label-md text-on-surface-variant whitespace-nowrap">${betweenSemanaWhen()}</span>
          </div>
          <div class="bg-surface-container-low p-4 rounded-lg border-l-4 border-primary">
            <p class="font-label-md text-label-md text-on-surface-variant mb-1 uppercase">Lectura de la semana</p>
            <p class="font-headline-md text-headline-md text-on-surface">${betweenSemanaReading()}</p>
          </div>
          <p class="mt-3 text-sm text-primary flex items-center gap-1 font-label-md text-label-md"><span class="material-symbols-outlined text-[16px]">open_in_new</span> Ver detalle</p>
        </div>
        <!-- Fin de Semana -->
        <div data-go-fin class="flex-1 bg-surface-container-lowest rounded-xl p-6 border border-outline-variant shadow-[0_4px_20px_rgba(0,0,0,0.04)] cursor-pointer hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] hover:border-secondary transition-all" title="Abrir el programa de fin de semana del mes en curso">
          <div class="flex items-center justify-between mb-6 gap-3">
            <h3 class="font-headline-md text-headline-md text-primary flex items-center gap-2">
              <span class="material-symbols-outlined">record_voice_over</span>
              Reunión Fin de Semana
            </h3>
            <span class="bg-surface-container-highest px-3 py-1 rounded font-label-md text-label-md text-on-surface-variant whitespace-nowrap">${finSemanaSchedule()}</span>
          </div>
          <div class="bg-surface-container-low p-4 rounded-lg border-l-4 border-secondary">
            <p class="font-label-md text-label-md text-on-surface-variant mb-1 uppercase">Título del Discurso</p>
            <p class="font-body-lg text-body-lg font-semibold text-on-surface italic">${finSemanaTitle()}</p>
          </div>
          <p class="mt-3 text-sm text-secondary flex items-center gap-1 font-label-md text-label-md"><span class="material-symbols-outlined text-[16px]">open_in_new</span> Ver detalle</p>
        </div>
      </div>

      <!-- Columna derecha: Aseo y Hospitalidad -->
      <div class="md:col-span-4 flex">
        <div class="w-full bg-primary-container text-on-primary-container rounded-xl p-6 md:p-8 shadow-[0_4px_20px_rgba(0,0,0,0.04)] flex flex-col relative overflow-hidden">
          <div class="absolute inset-0 opacity-10 pointer-events-none" style="background-image: radial-gradient(circle at 100% 100%, #ffffff 0%, transparent 50%);"></div>
          <div class="bg-on-tertiary-fixed-variant/30 rounded-xl p-6 border border-on-primary-container/20 relative z-10 flex-1 flex flex-col">
            <h3 class="font-headline-md text-headline-md text-on-primary uppercase tracking-[0.2em] text-center mb-4">${finWeekAssignDetail()}</h3>
            <div class="border-b border-on-primary-container/40 mb-6"></div>
            <div class="text-center flex-1 flex flex-col justify-center">
              <p class="font-label-lg text-label-lg text-primary-fixed uppercase tracking-[0.3em] mb-2">Grupo</p>
              <h4 class="font-headline-lg text-[96px] leading-none text-on-primary" style="font-family:'Playfair Display', serif;font-weight:800">${finWeekAssign()}</h4>
             </div>
          </div>
        </div>
      </div>

      <!-- Próximos Eventos (abajo) -->
      <section class="md:col-span-12 bg-surface-container-lowest rounded-xl p-6 md:p-8 shadow-[0_4px_20px_rgba(0,0,0,0.04)] border border-outline-variant relative overflow-hidden">
        <div class="absolute top-0 left-0 w-2 h-full bg-primary"></div>
        <div class="flex justify-between items-start mb-8 gap-3">
          <div>
            <h2 class="font-headline-lg text-headline-lg-mobile md:text-headline-lg text-primary mb-1 flex items-center gap-3">
              <span class="material-symbols-outlined text-3xl">event_upcoming</span>
              Próximos Eventos
            </h2>
            <p class="font-body-md text-body-md text-on-surface-variant">Destacados para los próximos meses</p>
          </div>
          <button data-go-settings class="text-primary-container bg-primary-fixed hover:bg-primary-fixed-dim px-4 py-2 rounded-lg font-label-md text-label-md transition-colors whitespace-nowrap flex items-center gap-1">
            <span class="material-symbols-outlined text-[18px]">tune</span> Configurar
          </button>
        </div>
        <div id="homeEvents" class="space-y-6"></div>
      </section>
    </div>
  `;
  $('#btnNew').onclick = () => go('new');
  document.querySelectorAll('[data-go-settings]').forEach(b => b.onclick = () => go('eventos'));
  document.querySelectorAll('[data-go-mw]').forEach(c => c.onclick = () => {
    const { monday } = currentWeekDates();
    const wk = state.midweeks.find(m => String(m.id) === monday);
    if (wk) go('midweek', { monthId: wk.id });
    else go('midweeks');
  });
  document.querySelectorAll('[data-go-fin]').forEach(c => c.onclick = () => {
    const cur = findCurrentFinWeek();
    if (cur) go('edit', { monthId: cur.month.id });
    else go('new');
  });

  renderHomeEvents($('#homeEvents'));
}

// ---- Helpers de la semana en curso para el tablero ----
// Almacena los meses y programas de aseo cargados para las tarjetas de resumen.
let _homeMonths = [];
let _homeAseos = [];

// Devuelve lunes y sábado (YYYY-MM-DD) de la semana en curso.
function currentWeekDates() {
  const now = new Date();
  const daysSinceMon = (now.getDay() + 6) % 7; // 0=lunes
  const monday = new Date(now); monday.setDate(now.getDate() - daysSinceMon);
  const saturday = new Date(monday); saturday.setDate(monday.getDate() + 5);
  return { monday: isoDate(monday), saturday: isoDate(saturday) };
}

// Busca la semana del programa mensual cuya fecha (sábado) es la semana en curso.
function findCurrentFinWeek() {
  const { saturday } = currentWeekDates();
  for (const m of _homeMonths) {
    const w = (m.weeks || []).find(x => x.date === saturday);
    if (w) return { month: m, week: w };
  }
  return null;
}
function finSemanaTitle() {
  const cur = findCurrentFinWeek();
  if (!cur) return 'Programa aún no cargado para esta semana';
  const w = cur.week;
  if (w.type === 'assembly') return 'Asamblea';
  const title = w.tituloDiscurso || w.discursoSupervisor1 || w.discursoSupervisor2 || '';
  return (title && title.trim()) ? `"${title}"` : 'Por confirmar';
}
function finSemanaSchedule() {
  const cfg = state.config || {};
  const day = DAYS_ES_NAMES[Number(cfg.schedule?.day) || 6] || 'Sábado';
  return `${day}, ${cfg.schedule?.time || '10:00'}`;
}
function finWeekAssign() {
  const { saturday } = currentWeekDates();
  for (const a of _homeAseos) {
    const w = (a.weeks || []).find(x => x.saturday === saturday);
    if (w && w.group) return deptNameOf(w.group);
  }
  return 'Sin asignar';
}
function finWeekAssignDetail() {
  const labores = state.config?.groups?.labores;
  if (labores) return labores;
  const cur = findCurrentFinWeek();
  if (cur) return `${capitalize(WEEK_TYPES[cur.week.type]?.label || 'Normal')} de la semana`;
  return 'Seleccione el programa del mes en curso';
}
function betweenSemanaReading() {
  const { monday, saturday } = currentWeekDates();
  const mw = state.midweeks.find(m => m.id >= monday && m.id <= saturday) || null;
  return mw ? (mw.reading || '—') : 'Lectura no cargada para esta semana';
}
function betweenSemanaWhen() {
  const cfg = state.config || {};
  const day = DAYS_ES_NAMES[Number(cfg.midweek?.day) ?? Number(cfg.schedule?.day) ?? 2] || 'Miércoles';
  const time = cfg.midweek?.time || cfg.schedule?.time || '19:00';
  return `${day}, ${time}`;
}

// Panel de próximos eventos (conmemoración, visita, asamblea) desde la configuración general.
function renderHomeEvents(container) {
  const config = state.config || { schedule: { day: 6, time: '10:00' }, events: {} };
  const today = isoDate(new Date());
  const upcoming = upcomingEvents(config.events || {}, today, 6);

  const TYPE_META = {
    commemoration: { icon: 'stars', label: 'Conmemoración', sub: 'Conmemoración de la muerte de Cristo', box: 'bg-secondary-container text-on-secondary-container' },
    supervisor:    { icon: 'meeting_room', label: 'Visita del Superintendente', sub: 'Semana Especial de Actividades', box: 'bg-tertiary-container text-on-tertiary-container' },
    assembly:      { icon: 'event', label: 'Asamblea', sub: 'Asamblea', box: 'bg-primary-fixed text-on-primary-fixed-variant' },
  };

  const MON = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const dayNum = (iso) => ({ m: +iso.slice(5, 7), d: +iso.slice(8, 10) });
  const fmt = (iso) => { const { m, d } = dayNum(iso); return `${d} ${MON[m]}`; };

  const raw = [ ...upcoming ];
  container.innerHTML = raw.map((ev, idx) => {
    const meta = TYPE_META[ev.type] || TYPE_META.commemoration;
    const { m, d } = dayNum(ev.date);
    const startDate = new Date(ev.date + 'T00:00:00');
    const endDate = ev.end ? new Date(ev.end + 'T00:00:00') : null;
    const days = endDate ? (Math.round((endDate - startDate) / 86400000) + 1) : 1;
    const multi = !!endDate && ev.end !== ev.date;
    const range = multi ? `${fmt(ev.date)} – ${fmt(ev.end)}` : null;
    const sub = ev.type === 'assembly'
      ? `${days} ${days === 1 ? 'día' : 'días'} de programa`
      : meta.sub;
    return `<div class="flex items-start gap-4 ${raw.length > 1 && idx < raw.length - 1 ? 'pb-6 border-b border-outline-variant/30' : ''}">
      <div class="${meta.box} w-16 h-16 rounded-lg flex flex-col items-center justify-center flex-shrink-0">
        <span class="font-label-md text-label-md uppercase text-[10px] leading-tight">${MON[m]}</span>
        <span class="font-headline-md text-headline-md leading-none">${d}</span>
      </div>
      <div class="pt-1">
        <div class="flex items-center gap-2 flex-wrap">
          <h3 class="font-headline-md text-headline-md text-on-surface mb-1">${meta.label}</h3>
          ${range ? `<span class="flex items-center gap-1 font-label-md text-label-md text-on-surface-variant mb-1">
            <span class="material-symbols-outlined text-[15px]">date_range</span>
            ${range}
          </span>` : ''}
        </div>
        <p class="font-body-md text-body-md text-on-surface-variant flex items-center gap-2">
          <span class="material-symbols-outlined text-[18px]">${meta.icon}</span>
          ${sub}
        </p>
      </div>
    </div>`;
  }).join('');
}

/* ---------- NEW: Programas (selector de mes global + pestañas) ---------- */
async function renderNew() {
  state.month = null;
  renderTop();
  const app = $('#app');
  const [months, aseos, salidas, labores] = await Promise.all([
    db.listMonths(), db.listAseos(), db.listSalidas(), db.listAtencion(),
  ]);
  const mwMonths = [...new Set(state.midweeks.map(m => String(m.id).slice(0, 7)))];
  const dataMonths = [...new Set([
    ...months.map(m => m.id), ...mwMonths,
    ...aseos.map(a => a.id), ...salidas.map(p => p.id), ...labores.map(p => p.id),
  ])];
  if (!state.progMonth) {
    const today = isoDate(new Date()).slice(0, 7);
    state.progMonth = dataMonths.includes(today) ? today : (dataMonths[0] || today);
  }
  const allMonths = [...new Set([...dataMonths, state.progMonth])].sort((a, b) => b.localeCompare(a));

  const tabs = [
    { id: 'fin', label: 'Reunión de Fin de Semana' },
    { id: 'entre', label: 'Reunión de Entre Semana' },
    { id: 'atencion', label: 'Atención' },
    { id: 'atencionGrupo', label: 'Aseo' },
    { id: 'salidas', label: 'Salidas' },
    { id: 'general', label: 'General Mensual' },
  ];

  app.innerHTML = `
    <div class="mb-3">
      <h1 class="font-headline-lg text-headline-lg text-primary">Programas</h1>
      <p class="text-on-surface-variant font-body-md text-body-md">Seleccione el mes; todas las vistas del programa se actualizan.</p>
    </div>
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-6">
      <div class="flex items-center gap-2 flex-wrap">
        ${[-1, 0, 1].map(delta => {
          const m = addMonths(state.progMonth, delta);
          const isCur = delta === 0;
          return `<button data-month="${m}" class="flex items-center justify-center px-4 py-2 rounded-lg font-label-md text-label-md transition-colors whitespace-nowrap ${isCur ? 'bg-primary text-on-primary shadow' : 'border border-outline hover:bg-surface-container'}">${MONTHS_ES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}</button>`;
        }).join('')}
        <select id="progMonth" class="bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md font-semibold focus:border-primary" title="Buscar mes">
          ${allMonths.map(id => `<option value="${id}" ${id === state.progMonth ? 'selected' : ''}>${MONTHS_ES[Number(id.slice(5)) - 1]} ${id.slice(0, 4)}</option>`).join('')}
        </select>
      </div>
      <button id="autoBtn" data-admin class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-colors" title="Asignación automática del mes">
        <span class="material-symbols-outlined text-[18px]">auto_awesome</span> Asignación automática
      </button>
    </div>
    <div class="flex gap-2 mb-8 border-b border-outline-variant flex-wrap">
      ${tabs.map(t => `<button data-tab="${t.id}" class="newTab px-5 py-3 font-label-md text-label-md transition-colors">${t.label}</button>`).join('')}
    </div>
    <div id="newBody"></div>
  `;

  const goMonth = (m) => { state.progMonth = m; renderNew(); };
  $('#progMonth').onchange = (e) => goMonth(e.target.value);
  app.querySelectorAll('[data-month]').forEach(b => b.onclick = () => goMonth(b.dataset.month));
  $('#autoBtn').onclick = () => go('algoritmo');

  const tabNodes = app.querySelectorAll('.newTab');
  const setActive = () => {
    tabNodes.forEach(t => {
      const on = t.dataset.tab === state.newTab;
      t.classList.toggle('border-b-2', on);
      t.classList.toggle('border-primary', on);
      t.classList.toggle('text-primary', on);
      t.classList.toggle('text-on-surface-variant', !on);
    });
  };
  tabNodes.forEach(t => t.onclick = () => {
    state.newTab = t.dataset.tab;
    setActive();
    renderNewBody();
  });
  setActive();
  renderNewBody();
}

/* ---------- Vista de asignación automática ---------- */

// Vista completa (no modal) de la asignación automática. Muestra una barra de
// progreso con las etapas y una card vertical por programa (entre semana,
// acomodación, salidas y fin de semana). Cada card muestra su estado, los
// puestos que faltan y un botón para asignarlo automáticamente sin salir de la
// vista. Al terminar se guardan todos los programas.
async function renderAutoAsignacion() {
  state.month = null;
  renderTop();
  const app = $('#app');
  const inicial = state.progMonth || isoDate(new Date()).slice(0, 7);
  let month = inicial;

  // ---- Estado de la sesión ----
  // El usuario inicia con la asignación PENDIENTE; cada card se completa de
  // forma independiente. Si el mes ya fue asignado y guardado, se avisa y solo
  // continúa (reescribiendo todo) si lo confirma.
  const sesion = {
    rewrite: false,            // el usuario confirmó reescribir un mes ya asignado
    revisado: false,           // el usuario confirmó revisar el mes y sus conflictos
    creados: [],               // programas creados en esta sesión
    hechos: { entre: false, atencion: false, salidas: false, fin: false },
    reportes: { entre: null, atencion: null, salidas: null, fin: null },
  };

  const mesTxt = (m) => `${MONTHS_ES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
  const verPrograma = (tab) => { state.progMonth = month; state.newTab = tab; go('new'); };

  // ---- Computar estado de cada programa ----
  const midweekSlotsCount = (week) => {
    let n = 0;
    (week.sections || []).forEach(sec => (sec.parts || []).forEach(p => { n += midweekSlotsOf(sec, p).length; }));
    return n;
  };
  const midweekMissing = (week) => {
    const out = [];
    if (!week.presidente) out.push({ key: 'presidente', label: 'Presidente' });
    (week.sections || []).forEach((sec, si) => (sec.parts || []).forEach(p => {
      const ap = p.assignments || {};
      midweekSlotsOf(sec, p).forEach(s => { if (!ap[s.key]) out.push({ key: `mw_${si}_${p.num}_${s.key}`, label: `${sec.title} · parte ${p.num} · ${s.label}` }); });
    }));
    return out;
  };
  const laboresMissing = (program) => {
    const out = [];
    (program && program.weeks || []).forEach((w, wi) => {
      const l = ensureAtencion(w).labores;
      ATENCION_DEF.forEach(d => {
        for (let si = 0; si < d.count; si++) {
          const cur = Array.isArray(l[d.key]) ? l[d.key][si] : (si === 0 ? l[d.key] : '');
          if (!cur) out.push({ key: `lab_${wi}_${d.key}_${si}`, label: `${d.label}${d.count > 1 ? ` ${si + 1}` : ''}` });
        }
      });
    });
    return out;
  };
  const salidasMissing = (program) => {
    const out = [];
    (program && program.weeks || []).forEach((w, wi) => (w.outings || []).forEach((o, oi) => {
      if (!o.oradorSalida) out.push({ key: `sal_${wi}_${oi}`, label: `Orador de salida ${oi + 1}` });
    }));
    return out;
  };
  const finMissing = (program) => {
    const out = [];
    (program && program.weeks || []).forEach((w, wi) => {
      camposFinSemana(w).forEach(({ campo, labore }) => {
        if (!w[campo]) out.push({ key: `fin_${wi}_${campo}`, label: labelOf(campo), labore });
      });
    });
    return out;
  };

  // ---- Cargar datos del mes ----
  const load = async () => {
    const mws = state.midweeks.filter(x => String(x.id).slice(0, 7) === month);
    const [fin, lab, sal] = await Promise.all([db.getMonth(month), db.getAtencion(month), db.getSalidas(month)]);
    return { mws, fin, lab, sal };
  };

  // ---- Aviso de mes ya asignado ----
  const mesAsignado = (d) => {
    if (d.mws.some(w => w.presidente || (w.sections || []).some(sec => (sec.parts || []).some(p => Object.values(p.assignments || {}).some(v => v))))) return true;
    if (d.fin && (d.fin.weeks || []).some(w => w.presidente || w.conductor || w.lector || w.estudioSinLectura)) return true;
    if (d.lab && (d.lab.weeks || []).some(w => Object.values(w.labores || {}).some(v => (Array.isArray(v) ? v : [v]).some(x => x)))) return true;
    if (d.sal && (d.sal.weeks || []).some(w => (w.outings || []).some(o => o.oradorSalida))) return true;
    return false;
  };

  // ---- Reescribir: limpia todas las asignaciones del mes ----
  const limpiarMes = async (d) => {
    const writes = [];
    d.mws.forEach(w => {
      w.presidente = '';
      (w.sections || []).forEach(sec => (sec.parts || []).forEach(p => { p.assignments = {}; }));
      writes.push(db.putMidweek(w));
    });
    if (d.fin) {
      (d.fin.weeks || []).forEach(w => { w.presidente = ''; w.conductor = ''; w.lector = ''; w.estudioSinLectura = ''; });
      writes.push(db.putMonth(d.fin));
    }
    if (d.lab) {
      (d.lab.weeks || []).forEach(w => { w.labores = newAtencion(); });
      writes.push(db.putAtencion(d.lab));
    }
    if (d.sal) {
      (d.sal.weeks || []).forEach(w => (w.outings || []).forEach(o => { o.oradorSalida = ''; }));
      writes.push(db.putSalidas(d.sal));
    }
    await Promise.all(writes);
    state.midweeks = await db.listMidweeks();
    await syncAssignmentLog();
  };

  // ---- Render de una card de programa ----
  const card = (opts) => {
    const { id, icono, titulo, desc, faltan, pct, done, accion, resumen } = opts;
    const faltanHtml = faltan.length
      ? `<div class="mt-3 bg-error-container/30 rounded-lg border border-error/40 p-3">
          <p class="text-sm font-semibold text-error mb-2 flex items-center gap-1.5"><span class="material-symbols-outlined text-[16px]">report</span> Falta completar (${faltan.length})</p>
          <ul class="text-sm text-on-error-container space-y-1 max-h-40 overflow-auto">
            ${faltan.slice(0, 20).map(f => `<li class="flex items-start gap-1.5"><span class="material-symbols-outlined text-[14px] mt-0.5">circle</span>${escapeHtml(f.label)}</li>`).join('')}
            ${faltan.length > 20 ? `<li class="text-on-surface-variant">… y ${faltan.length - 20} más</li>` : ''}
          </ul>
        </div>`
      : done ? `<div class="mt-3 text-sm font-semibold text-tertiary flex items-center gap-1.5"><span class="material-symbols-outlined text-[18px]">check_circle</span> Completo</div>`
      : '';
    const resumenHtml = resumen
      ? `<div class="mt-3 text-sm text-on-surface-variant">${resumen}</div>`
      : '';
    return `<section class="bg-surface-container-lowest rounded-xl border ${done ? 'border-tertiary' : 'border-outline-variant'} p-5 md:p-6">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex items-start gap-3">
          <span class="material-symbols-outlined text-[26px] ${done ? 'text-tertiary' : 'text-primary'}">${icono}</span>
          <div>
            <h3 class="font-headline-md text-headline-md text-primary">${titulo}</h3>
            <p class="text-sm text-on-surface-variant">${desc}</p>
          </div>
        </div>
        <span class="px-3 py-1 rounded-full font-label-md text-label-md ${done ? 'bg-tertiary-fixed text-on-tertiary-fixed' : 'bg-secondary-container text-on-secondary-container'}">${pct}%</span>
      </div>
      <div class="h-2 bg-surface-variant rounded-full overflow-hidden mt-4"><div class="h-full ${done ? 'bg-tertiary' : 'bg-primary'} transition-all" style="width:${pct}%"></div></div>
      ${resumenHtml}
      ${faltanHtml}
      <div class="mt-4 flex flex-wrap gap-2 justify-end">${accion}</div>
    </section>`;
  };

  // ---- Render principal ----
  const render = async () => {
    const d = await load();
    const creadosTxt = sesion.creados.length ? ` · se creó: ${sesion.creados.join(', ')}` : '';
    const yaAsignado = !sesion.rewrite && mesAsignado(d);
    // Mientras el mes ya esté asignado (sin confirmar reescritura) o el usuario
    // no haya confirmado la revisión del general y sus conflictos, los botones
    // "Asignar" quedan deshabilitados.
    const bloqueado = yaAsignado || !sesion.revisado;
    const botonAsignar = (tipo, label) => `<button data-asignar="${tipo}" data-admin ${bloqueado ? 'disabled' : ''} class="px-4 py-2 rounded-lg font-label-md text-label-md ${bloqueado ? 'bg-surface-container-high text-on-surface-variant cursor-not-allowed' : 'bg-primary text-on-primary hover:opacity-90'}">${label}</button>`;

    const mwMissing = d.mws.flatMap(midweekMissing);
    const labMissing = laboresMissing(d.lab);
    const salMissing = salidasMissing(d.sal);
    const finFaltan = finMissing(d.fin);
    const mwTotal = d.mws.reduce((a, w) => a + 1 + midweekSlotsCount(w), 0);
    const mwDone = d.mws.reduce((a, w) => a + (w.presidente ? 1 : 0) + (w.sections || []).reduce((aa, sec) => aa + (sec.parts || []).reduce((aaa, p) => aaa + Object.values(p.assignments || {}).filter(Boolean).length, 0), 0), 0);
    const labTotal = (d.lab?.weeks || []).reduce((a, w) => a + ATENCION_DEF.reduce((aa, dd) => aa + dd.count, 0), 0);
    const labDone = labTotal - labMissing.length;
    const salTotal = (d.sal?.weeks || []).reduce((a, w) => a + (w.outings || []).length, 0);
    const salDone = salTotal - salMissing.length;
    const finTotal = (d.fin?.weeks || []).reduce((a, w) => a + camposFinSemana(w).length, 0);
    const finDone = finTotal - finFaltan.length;
    const pct = (done, total) => total ? Math.round((done / total) * 100) : 0;

    const faltaGuia = !d.mws.length;
    const cards = [];

    // Card 1: Entre semana
    const resumenEntre = sesion.reportes.entre
      ? `${sesion.reportes.entre.asignados} asignaciones hechas` +
        (sesion.reportes.entre.flexiones && sesion.reportes.entre.flexiones.length
          ? ` · ${sesion.reportes.entre.flexiones.length} asignación(es) con regla flexibilizada`
          : '')
      : '';
    cards.push(card({
      id: 'entre', icono: 'calendar_view_week', titulo: 'Entre semana', desc: `Reunión de entre semana · ${d.mws.length} semana(s)`,
      faltan: mwMissing, pct: pct(mwDone, mwTotal), done: !faltaGuia && mwMissing.length === 0,
      resumen: resumenEntre,
      accion: faltaGuia
        ? `<button data-load-guide class="px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Cargar guía</button>`
        : `<button data-ver="entre" class="px-3 py-2 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Ver</button>
           ${botonAsignar('entre', 'Asignar')}`,
    }));

    // Card 2: Atención
    cards.push(card({
      id: 'atencion', icono: 'weekend', titulo: 'Atención', desc: 'Atención y labores tras bambalinas',
      faltan: labMissing, pct: pct(labDone, labTotal), done: labTotal > 0 && labMissing.length === 0,
      resumen: sesion.reportes.atencion ? `${sesion.reportes.atencion.asignados} asignaciones hechas` : '',
      accion: `<button data-ver="atencion" class="px-3 py-2 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Ver</button>
               ${botonAsignar('atencion', 'Asignar')}`,
    }));

    // Card 3: Salidas
    cards.push(card({
      id: 'salidas', icono: 'campaign', titulo: 'Salidas', desc: 'Oradores para las salidas a congregaciones',
      faltan: salMissing, pct: pct(salDone, salTotal), done: salTotal > 0 && salMissing.length === 0,
      resumen: sesion.reportes.salidas ? `${sesion.reportes.salidas.asignados} asignaciones hechas` : '',
      accion: `<button data-ver="salidas" class="px-3 py-2 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Ver</button>
               ${botonAsignar('salidas', 'Asignar')}`,
    }));

    // Card 4: Fin de semana
    cards.push(card({
      id: 'fin', icono: 'event', titulo: 'Fin de semana', desc: 'Presidente, conductor y lector',
      faltan: finFaltan, pct: pct(finDone, finTotal), done: finTotal > 0 && finFaltan.length === 0,
      resumen: sesion.reportes.fin ? `${sesion.reportes.fin.asignados} asignaciones hechas` : '',
      accion: `<button data-ver="fin" class="px-3 py-2 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Ver</button>
               ${botonAsignar('fin', 'Asignar')}`,
    }));

    // Barra de estado (pasos)
    const STEPS = [
      { id: 'entre', titulo: 'Entre semana' },
      { id: 'atencion', titulo: 'Atención y salidas' },
      { id: 'fin', titulo: 'Fin de semana' },
    ];
    const pasoDone = {
      entre: !faltaGuia && mwMissing.length === 0,
      atencion: labMissing.length === 0 && salMissing.length === 0,
      fin: finFaltan.length === 0,
    };
    const barra = STEPS.map((s, i) => {
      const done = pasoDone[s.id];
      return `<div class="flex items-center gap-2 ${done ? 'text-tertiary' : 'text-on-surface-variant'}">
        <span class="w-8 h-8 rounded-full ${done ? 'bg-tertiary text-on-tertiary' : 'bg-surface-container-high text-on-surface-variant'} flex items-center justify-center">
          ${done ? '<span class="material-symbols-outlined text-[18px]">check</span>' : `<span class="material-symbols-outlined text-[18px]">${s.id === 'entre' ? 'calendar_view_week' : s.id === 'acomodacion' ? 'weekend' : 'event'}</span>`}
        </span>
        <span class="text-sm font-label-md whitespace-nowrap">${s.titulo}</span>
        ${i < STEPS.length - 1 ? '<span class="flex-1 h-0.5 bg-outline-variant min-w-[8px]"></span>' : ''}
      </div>`;
    }).join('');

    // Aviso de mes ya asignado
    const aviso = yaAsignado
      ? `<div class="bg-error-container rounded-xl border border-error p-4 mb-5 flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-start gap-3">
            <span class="material-symbols-outlined text-error text-[26px]">warning</span>
            <div>
              <p class="font-label-lg text-label-lg text-error">Este mes ya fue asignado y guardado</p>
              <p class="text-sm text-on-error-container">Si continúa, se reescribirán todas las asignaciones de ${mesTxt(month)}.</p>
            </div>
          </div>
          <div class="flex gap-2">
            <button id="autoBack" class="px-4 py-2 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Volver</button>
            <button id="autoRewrite" class="px-4 py-2 rounded-lg bg-error text-on-error font-label-md text-label-md hover:opacity-90">Reescribir todo</button>
          </div>
        </div>`
      : '';

    app.innerHTML = `
      <div class="flex items-center gap-3 mb-2">
        <button data-back class="material-symbols-outlined p-2 text-on-surface-variant hover:text-primary rounded-full">arrow_back</button>
        <div>
          <h1 class="font-headline-lg text-headline-lg text-primary">Asignación automática</h1>
          <p class="text-on-surface-variant font-label-md">${mesTxt(month)}${creadosTxt}</p>
        </div>
      </div>

      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <label class="flex items-center gap-2 font-label-md text-label-md text-on-surface-variant">
          Mes a trabajar
          <input id="autoMonth" type="month" value="${month}" class="bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md font-semibold focus:border-primary">
        </label>
        <div class="flex items-stretch gap-2 bg-surface-container-low rounded-xl border border-outline-variant p-3 w-full md:w-auto">${barra}</div>
      </div>

      ${aviso}

      <div id="autoCards" class="space-y-4">${cards.join('')}</div>

      ${panelMotivos(sesion.reportes)}

      <div class="mt-8 rounded-xl border border-outline-variant bg-surface-container-lowest p-5 md:p-6">
        <div class="flex items-center gap-2 mb-1">
          <span class="material-symbols-outlined text-[22px] text-primary">calendar_month</span>
          <h2 class="font-headline-md text-headline-md text-primary">Revise el mes antes de asignar</h2>
        </div>
        <p class="text-sm text-on-surface-variant mb-4">Revise la vista mensual general y los conflictos de asignación. Debe marcar la confirmación para habilitar la asignación automática.</p>
        <div id="autoReviewCross" class="mb-4"></div>
        <div id="autoReviewGeneral"></div>
        <label class="flex items-center gap-2 mt-5 font-label-md text-label-md cursor-pointer select-none ${yaAsignado ? 'opacity-60' : ''}">
          <input type="checkbox" id="autoReviewAck" class="text-primary accent-primary w-5 h-5" ${sesion.revisado ? 'checked' : ''} ${yaAsignado ? 'disabled' : ''}>
          He revisado el mes y sus conflictos de asignación
        </label>
      </div>

      <div class="sticky bottom-0 bg-surface py-4 mt-8 flex gap-3 justify-end items-center flex-wrap">
        <button id="autoSaveAll" class="px-6 py-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-all active:scale-95">Guardar y ver programas</button>
      </div>
    `;

    $('[data-back]').onclick = () => go('new');
    $('#autoMonth').onchange = async (e) => {
      month = e.target.value;
      sesion.rewrite = false;
      sesion.revisado = false;
      sesion.creados = [];
      sesion.hechos = { entre: false, atencion: false, salidas: false, fin: false };
      sesion.reportes = { entre: null, atencion: null, salidas: null, fin: null };
      sesion.creados = await crearProgramasFaltantes(month);
      state.midweeks = await db.listMidweeks();
      render();
    };
    if ($('#autoBack')) $('#autoBack').onclick = () => go('new');
    if ($('#autoRewrite')) $('#autoRewrite').onclick = async () => {
      await limpiarMes(d);
      sesion.rewrite = true;
      toast('Asignaciones reescritas. Puede asignar de nuevo.', 'success');
      render();
    };
    app.querySelectorAll('[data-load-guide]').forEach(b => b.onclick = () => go('uploads'));
    app.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => verPrograma(b.dataset.ver));
    app.querySelectorAll('[data-asignar]').forEach(b => b.onclick = async () => {
      const tipo = b.dataset.asignar;
      const btn = b;
      btn.disabled = true;
      try {
        if (tipo === 'entre') { sesion.reportes.entre = await etapaEntreSemana(month); sesion.hechos.entre = true; }
        else if (tipo === 'atencion') { sesion.reportes.atencion = await etapaAtencion(month); sesion.hechos.atencion = true; }
        else if (tipo === 'salidas') { sesion.reportes.salidas = await etapaSalidas(month); sesion.hechos.salidas = true; }
        else if (tipo === 'fin') { sesion.reportes.fin = await etapaFinSemana(month); sesion.hechos.fin = true; }
        await syncAssignmentLog();
        toast('Asignación completada', 'success');
      } catch (err) {
        toast(err.message || 'Error al asignar', 'error');
      }
      btn.disabled = false;
      render();
    });
    $('#autoSaveAll').onclick = async () => {
      await syncAssignmentLog();
      toast('Programas guardados', 'success');
      verPrograma('general');
    };
    // Bloque de revisión del mes: general embebido, conflictos y confirmación.
    const autoReviewGeneral = $('#autoReviewGeneral');
    if (autoReviewGeneral) {
      renderGeneralMonth(month, { embed: autoReviewGeneral });
      renderCrossAlerts($('#autoReviewCross'), month);
    }
    const revision = $('#autoReviewAck');
    if (revision) revision.onchange = async () => {
      sesion.revisado = revision.checked;
      const on = sesion.revisado && !yaAsignado;
      document.querySelectorAll('[data-asignar]').forEach(b => {
        b.disabled = !on;
        b.classList.toggle('bg-surface-container-high', !on);
        b.classList.toggle('text-on-surface-variant', !on);
        b.classList.toggle('cursor-not-allowed', !on);
        b.classList.toggle('bg-primary', on);
        b.classList.toggle('text-on-primary', on);
        b.classList.toggle('hover:opacity-90', on);
      });
    };
  };

  // Crear programas del mes que no estén iniciados (si falta la guía, solo se
  // crean cuando existan semanas cargadas).
  const crearProgramasFaltantes = async (m) => {
    const year = Number(m.slice(0, 4));
    const monthNum = Number(m.slice(5, 7));
    const creados = [];
    if (!await db.getMonth(m)) {
      const weeks = saturdaysOf(year, monthNum).map(d => newWeek(d));
      applyConfigWeekTypes(weeks);
      await db.putMonth({ id: m, year, month: monthNum, weeks, published: false });
      creados.push('Fin de semana');
    }
    if (!await db.getAtencion(m)) {
      const weeks = saturdaysOf(year, monthNum).map(d => ({ saturday: isoDate(d), labores: newAtencion() }));
      await db.putAtencion({ id: m, weeks });
      creados.push('Atención');
    }
    if (!await db.getSalidas(m)) {
      const weeks = saturdaysOf(year, monthNum).map(d => ({ saturday: isoDate(d), outings: [newOuting()] }));
      await db.putSalidas({ id: m, congregations: [newCongregation()], weeks });
      creados.push('Salidas');
    }
    return creados;
  };

  // Antes de pintar: crear los programas del mes que no estén iniciados
  // (fin de semana, acomodación y salidas no dependen de la guía; la reunión de
  // entre semana sí, y esa card muestra el aviso de cargar la guía).
  sesion.creados = await crearProgramasFaltantes(month);
  state.midweeks = await db.listMidweeks();

  await render();
}

// Panel con el detalle "algoritmo explicable": motivos por asignación y avisos
// de reglas flexibilizadas (Fase 9).
function panelMotivos(reportes) {
  const partes = [];
  if (reportes.entre && reportes.entre.motivos && reportes.entre.motivos.length) {
    const items = reportes.entre.motivos.map(m =>
      `<div class="border-b border-outline-variant/40 pb-2 mb-2 last:border-0 last:mb-0">
        <p class="text-sm font-semibold text-primary">${escapeHtml(m.nombre || '')} · ${escapeHtml(rolLegible(m.labore))}</p>
        <ul class="text-xs text-on-surface-variant mt-1 space-y-0.5">
          ${m.motivos.map(t => `<li class="flex items-start gap-1.5"><span class="material-symbols-outlined text-[12px] mt-0.5">check_circle</span><span>${escapeHtml(t)}</span></li>`).join('')}
        </ul>
      </div>`).join('');
    partes.push(`<div class="mt-4">
      <h3 class="font-label-lg text-label-lg text-primary mb-2">¿Por qué se asignó así?</h3>
      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-4 text-sm">${items}</div>
    </div>`);
  }
  if (reportes.entre && reportes.entre.flexiones && reportes.entre.flexiones.length) {
    const flex = reportes.entre.flexiones.length;
    partes.push(`<p class="text-sm text-error mt-2 flex items-center gap-1.5">
      <span class="material-symbols-outlined text-[16px]">warning</span>
      ${flex} asignación(es) requirieron flexibilizar una regla de repetición por falta de candidatos perfectos. Revise los resultados.
    </p>`);
  }
  return partes.join('');
}

// Nombre legible de un puesto/rol para los motivos.
function rolLegible(labore) {
  if (!labore) return '—';
  const lab = ATENCION_DEF.find(d => String(labore).startsWith(d.key + '_'));
  if (lab) return `${lab.label} ${(Number(String(labore).slice(lab.key.length + 1)) || 0) + 1}`;
  const r = state.labores.find(x => String(x.id) === String(labore));
  if (r) return r.label;
  const fid = FIELD_LABORE[labore];
  const fRole = fid && state.labores.find(x => String(x.id) === fid);
  return fRole ? fRole.label : String(labore);
}

async function etapaEntreSemana(month) {
  const [midweeks, log] = await Promise.all([db.listMidweeks(), db.listAssignmentLog()]);
  const mwMes = midweeks.filter(m => String(m.id).slice(0, 7) === month);
  const historial = log.map(e => ({ personId: String(e.personId || ''), date: String(e.date || ''), roleKey: String(e.roleKey || '') }));
  const nombres = Object.fromEntries(state.people.map(p => [String(p.id), p.name]));
  const repMw = automatizarEntreSemana(state.people, mwMes, null, { historial, nombres });
  await Promise.all(mwMes.map(w => db.putMidweek(w)));
  state.midweeks = await db.listMidweeks();
  return {
    asignados: repMw.asignados,
    vacios: repMw.vacios.map(v => ({ semana: v.semana, rol: v.labore })),
    motivos: repMw.motivos,
    flexiones: repMw.flexiones,
  };
}

async function etapaAtencion(month) {
  const [midweeks, labores] = await Promise.all([db.listMidweeks(), db.listAtencion()]);
  const mwMes = midweeks.filter(m => String(m.id).slice(0, 7) === month);
  const labMes = labores.filter(p => p.id === month);
  const repLab = automatizarAtencion(state.people, labMes, mwMes, { serviceRolesOnlyMale: (state.config && state.config.algorithm && state.config.algorithm.serviceRolesOnlyMale) !== false });
  // Las labores de entre semana se guardan en cada week.labores del midweek.
  await Promise.all(labMes.map(p => db.putAtencion(p)));
  await Promise.all(mwMes.map(w => db.putMidweek(w)));
  state.midweeks = await db.listMidweeks();
  return {
    asignados: repLab.asignados,
    vacios: repLab.vacios.map(v => ({ semana: v.semana, rol: v.labore })),
  };
}

async function etapaSalidas(month) {
  const salidas = await db.listSalidas();
  const salMes = salidas.filter(p => p.id === month);
  // El orador de salida se asigna con personas con rol "orador" que no estén ya
  // ocupadas esa semana por acomodación, salidas o la reunión de fin de semana.
  const [midweeks, months, labores] = await Promise.all([db.listMidweeks(), db.listMonths(), db.listAtencion()]);
  const mwMes = midweeks.filter(m => String(m.id).slice(0, 7) === month);
  const mesMes = months.filter(m => m.id === month);
  const labMes = labores.filter(p => p.id === month);
  const ocupados = new Map();
  const marcar = (sat, id) => { if (id) { const s = new Set(ocupados.get(sat) || []); s.add(String(id)); ocupados.set(sat, s); } };
  labMes.forEach(p => (p.weeks || []).forEach(w => {
    const l = w.labores || {};
    ATENCION_DEF.forEach(dd => { const v = l[dd.key]; (Array.isArray(v) ? v : [v]).forEach(id => marcar(w.saturday, id)); });
  }));
  mesMes.forEach(p => (p.weeks || []).forEach(w => {
    ['presidente', 'conductor', 'lector', 'estudioSinLectura'].forEach(f => marcar(w.date, w[f]));
  }));
  mwMes.forEach(w => {
    const sat = addDays(w.id, 5);
    if (w.presidente) marcar(sat, w.presidente);
    (w.sections || []).forEach(sec => (sec.parts || []).forEach(p => Object.values(p.assignments || {}).forEach(id => marcar(sat, id))));
  });
  // labor de salida: por defecto "orador"; sin labores → todas las personas.
  const peopleForSalida = state.people.filter(p => (!Array.isArray(p.labores) || p.labores.length === 0 || p.labores.includes('orador')) && laboreAllowedForPerson(p, 'orador'));
  let asignados = 0;
  const vacios = [];
  salMes.forEach(p => (p.weeks || []).forEach(w => {
    const sat = String(w.saturday);
    const ocup = new Set(ocupados.get(sat) || []);
    (w.outings || []).forEach(o => {
      if (o.oradorSalida) { marcar(sat, o.oradorSalida); return; }
      const cand = peopleForSalida.find(x => !ocup.has(String(x.id)));
      if (!cand) { vacios.push({ semana: sat, rol: 'orador' }); return; }
      o.oradorSalida = cand.id;
      ocup.add(String(cand.id));
      marcar(sat, cand.id);
      asignados++;
    });
  }));
  await Promise.all(salMes.map(p => db.putSalidas(p)));
  return { asignados, vacios };
}

async function etapaFinSemana(month) {
  const [midweeks, months, salidas, labores] = await Promise.all([
    db.listMidweeks(),
    db.listMonths(),
    db.listSalidas(),
    db.listAtencion(),
  ]);
  const mwMes = midweeks.filter(m => String(m.id).slice(0, 7) === month);
  const mesMes = months.filter(m => m.id === month);
  const salMes = salidas.filter(p => p.id === month);
  const labMes = labores.filter(p => p.id === month);

  // Personas ya ocupadas cada semana por acomodación y salidas (E1/E2).
  const ocupados = new Map(); // sábado -> Set de personas
  const marcar = (sat, id) => { if (id) { const s = new Set(ocupados.get(sat) || []); s.add(String(id)); ocupados.set(sat, s); } };
  salMes.forEach(p => (p.weeks || []).forEach(w => (w.outings || []).forEach(o => marcar(w.saturday, o.oradorSalida))));
  labMes.forEach(p => (p.weeks || []).forEach(w => {
    const l = w.labores || {};
    ATENCION_DEF.forEach(d => {
      const v = l[d.key];
      (Array.isArray(v) ? v : [v]).forEach(id => marcar(w.saturday, id));
    });
  }));

  // Rellenar vacíos restantes de entre semana (ahora con acomodación/salidas en cuenta).
  const repMw = automatizarEntreSemana(state.people, mwMes, ocupados);
  const repFin = automatizarFinSemana(state.people, mesMes, salMes, labMes, mwMes);

  await Promise.all(mwMes.map(w => db.putMidweek(w)));
  await Promise.all(mesMes.map(m => db.putMonth(m)));
  state.midweeks = await db.listMidweeks();

  return {
    asignados: repMw.asignados + repFin.asignados,
    vacios: [...repMw.vacios.map(v => ({ semana: v.semana, rol: v.labore })),
             ...repFin.vacios.map(v => ({ semana: v.semana, rol: v.labore }))],
  };
}

/* ---------- ALGORITMO (motor configurable) ---------- */

// SVG nativo: gráfico de barras horizontales. `rows`: [{ label, value, sub }].
function svgBarras(rows, { maxLabel = 60 } = {}) {
  const w = 320, rowH = 26, pad = 8;
  const h = rows.length * rowH + pad;
  const max = Math.max(1, ...rows.map(r => r.value));
  const bars = rows.map((r, i) => {
    const y = pad + i * rowH;
    const bw = Math.max(2, (r.value / max) * (w - 90));
    return `
      <g>
        <text x="0" y="${y + 13}" class="algo-txt" style="font-size:10px">${escapeAttr(String(r.label).slice(0, maxLabel))}</text>
        <rect x="0" y="${y + 18}" width="${bw}" height="8" rx="4" fill="var(--primary, #4f378b)"><title>${escapeAttr((r.sub || '') + (r.sub ? ' · ' : '') + r.value)}</title></rect>
        <text x="${bw + 6}" y="${y + 26}" class="algo-txt" style="font-size:9px;fill:var(--on-surface-variant, #49454f)">${r.value}</text>
      </g>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="w-full h-auto" role="img">${bars}</svg>`;
}

// SVG nativo: gráfico de líneas (serie temporal). `rows`: [{ label, value }].
function svgLinea(rows, { w = 320, h = 120 } = {}) {
  if (!rows.length) return '<p class="text-sm text-on-surface-variant">Sin datos.</p>';
  const max = Math.max(1, ...rows.map(r => r.value));
  const px = 34, py = 8, pw = w - px - 10, ph = h - py - 18;
  const x = (i) => px + (rows.length === 1 ? pw / 2 : (i / (rows.length - 1)) * pw);
  const y = (v) => py + ph - (v / max) * ph;
  const pts = rows.map((r, i) => `${x(i).toFixed(1)},${y(r.value).toFixed(1)}`).join(' ');
  const labels = rows.length > 8 ? rows.filter((_, i) => i % 2 === 0) : rows;
  const lbl = labels.map((r, i) => {
    const idx = rows.indexOf(r);
    const xi = x(idx);
    return `<text x="${xi}" y="${h - 4}" text-anchor="middle" style="font-size:8px;fill:var(--on-surface-variant, #49454f)">${escapeAttr(r.label)}</text>`;
  }).join('');
  const dots = rows.map((r, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(r.value).toFixed(1)}" r="3" fill="var(--primary, #4f378b)"><title>${escapeAttr(r.label)}: ${r.value}</title></circle>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="w-full h-auto" role="img">
    <polyline points="${pts}" fill="none" stroke="var(--primary, #4f378b)" stroke-width="2"></polyline>
    <line x1="${px}" y1="${py + ph}" x2="${px + pw}" y2="${py + ph}" stroke="var(--outline-variant, #cac4d0)"></line>
    ${lbl}${dots}
  </svg>`;
}

// SVG nativo: gráfico de dona. `rows`: [{ label, value }].
function svgDona(rows, { size = 180 } = {}) {
  if (!rows.length) return '<p class="text-sm text-on-surface-variant">Sin datos.</p>';
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  const c = size / 2, r = size / 2 - 22, thick = 26;
  let ang = -90;
  const colores = ['#4f378b', '#00a96b', '#d02e3f', '#7d4c9e', '#1e88e5', '#f9a825', '#00b8d4', '#6d4c41'];
  const segs = rows.map((row, i) => {
    const frac = row.value / total;
    const a2 = ang + frac * 360;
    const start = ang * Math.PI / 180, end = a2 * Math.PI / 180;
    const x1 = c + r * Math.cos(start), y1 = c + r * Math.sin(start);
    const x2 = c + r * Math.cos(end), y2 = c + r * Math.sin(end);
    const large = frac > 0.5 ? 1 : 0;
    ang = a2;
    return `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} L ${c} ${c} Z" fill="${colores[i % colores.length]}"><title>${escapeAttr(row.label)}: ${row.value}</title></path>`;
  }).join('');
  const leyenda = rows.map((r, i) =>
    `<div class="flex items-center gap-2 text-xs">
      <span class="w-3 h-3 rounded-full" style="background:${colores[i % colores.length]}"></span>
      <span class="text-on-surface-variant truncate">${escapeAttr(r.label)}</span>
      <span class="ml-auto font-semibold">${r.value}</span>
    </div>`).join('');
  return `<div class="flex items-center gap-6 flex-wrap">
    <svg viewBox="0 0 ${size} ${size}" class="w-40 h-40 mx-auto" role="img">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--surface-container-high, #e7e0ec)" stroke-width="${thick}"></circle>
      ${segs}
      <text x="${c}" y="${c - 2}" text-anchor="middle" style="font-size:26px;font-weight:700;fill:var(--on-surface, #1d1b20)">${total}</text>
      <text x="${c}" y="${c + 14}" text-anchor="middle" style="font-size:9px;fill:var(--on-surface-variant, #49454f)">asignaciones</text>
    </svg>
    <div class="flex-1 min-w-[160px] space-y-2">${leyenda}</div>
  </div>`;
}

// Render de la vista Asignación Automática (motor): generador de propuestas con
// ranking 0-100 y gráficos de historial/carga. La configuración del motor se
// edita desde Ajustes. Se abre desde el botón "Asignación automática" de Programa.
async function renderAlgoritmo() {
  state.month = null;
  renderTop();
  const app = $('#app');
  const config = await db.getConfig();
  const algo = { ...defaultAlgorithmConfig(), ...(config.algorithm || {}) };

  const mes = state.progMonth || isoDate(new Date()).slice(0, 7);

  app.innerHTML = `
    <div class="flex items-center gap-3 mb-2">
      <button data-algo-back class="material-symbols-outlined p-2 text-on-surface-variant hover:text-primary rounded-full">arrow_back</button>
      <div>
        <h1 class="font-headline-lg text-headline-lg text-primary">Asignación automática</h1>
        <p class="text-on-surface-variant font-label-md">Genera varias propuestas del mes y aplica la que mejor se ajuste a sus reglas.</p>
      </div>
    </div>

    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-6">
      <label class="flex items-center gap-2 font-label-md text-label-md text-on-surface-variant">
        Mes a generar
        <input id="algoMonth" type="month" value="${escapeAttr(mes)}" class="bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md font-semibold focus:border-primary">
      </label>
      <div class="flex flex-wrap items-center gap-2">
        <button data-algo-config class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-outline font-label-md text-label-md text-on-surface-variant hover:bg-surface-container transition-colors">
          <span class="material-symbols-outlined text-[18px]">tune</span> Configurar motor (Ajustes)
        </button>
        <button data-algo-manual class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-outline font-label-md text-label-md text-on-surface-variant hover:bg-surface-container transition-colors">
          <span class="material-symbols-outlined text-[18px]">edit_note</span> Ajuste manual por etapas
        </button>
        <button id="algoGenerate" data-admin class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-secondary text-on-secondary font-label-md text-label-md hover:opacity-90"><span class="material-symbols-outlined text-[20px]">play_arrow</span> Generar</button>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-6">
        <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6">
          <h3 class="font-headline-md text-headline-md text-primary mb-1 flex items-center gap-2"><span class="material-symbols-outlined">auto_awesome</span> Propuestas</h3>
          <p class="text-sm text-on-surface-variant mb-4">El motor respeta las reglas guardadas en Ajustes y ofrece las mejores ${algo.numberOfProposals} con su puntuación.</p>
          <div id="algoResults" class="space-y-4"></div>
        </div>

        <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6">
          <h3 class="font-headline-md text-headline-md text-primary mb-1 flex items-center gap-2"><span class="material-symbols-outlined">monitoring</span> Historial y carga</h3>
          <p class="text-sm text-on-surface-variant mb-4">Distribución real de asignaciones para apoyar tus decisiones.</p>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="bg-surface-container-low p-4 rounded-xl border border-outline-variant/60">
              <p class="font-label-md text-label-md text-on-surface-variant mb-2">Asignaciones por persona</p>
              <div id="algoBarWorkload"></div>
            </div>
            <div class="bg-surface-container-low p-4 rounded-xl border border-outline-variant/60">
              <p class="font-label-md text-label-md text-on-surface-variant mb-2">Asignaciones por mes</p>
              <div id="algoLineTimeline"></div>
            </div>
            <div class="bg-surface-container-low p-4 rounded-xl border border-outline-variant/60">
              <p class="font-label-md text-label-md text-on-surface-variant mb-2">Distribución por rol</p>
              <div id="algoDonaRoles"></div>
            </div>
            <div class="bg-surface-container-low p-4 rounded-xl border border-outline-variant/60">
              <p class="font-label-md text-label-md text-on-surface-variant mb-2">Encargado vs ayudante (presentaciones)</p>
              <div id="algoBarPairs"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="lg:col-span-1 space-y-6">
        <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6">
          <h3 class="font-headline-md text-headline-md text-primary mb-3 flex items-center gap-2"><span class="material-symbols-outlined">rule</span> Reglas vigentes</h3>
          <ul class="space-y-2 text-sm text-on-surface">
            <li class="flex justify-between gap-2"><span class="text-on-surface-variant">Propuestas a generar</span><span class="font-semibold">${algo.numberOfProposals}</span></li>
            <li class="flex justify-between gap-2"><span class="text-on-surface-variant">Mismo puesto / mes</span><span class="font-semibold">máx. ${algo.maxSameAssignmentPerMonth}</span></li>
            <li class="flex justify-between gap-2"><span class="text-on-surface-variant">Repetición mensual</span><span class="font-semibold">${algo.sameAssignmentMonthlyMode === 'PREFERRED' ? 'Preferida' : algo.sameAssignmentMonthlyMode === 'LIMIT' ? 'Límite' : 'Prohibida'}</span></li>
            <li class="flex justify-between gap-2"><span class="text-on-surface-variant">Pareja mixta</span><span class="font-semibold">${algo.mixedGenderPairing === 'NOT_ALLOWED' ? 'Prohibido' : algo.mixedGenderPairing === 'ALLOWED_LOW' ? 'Solo con motivo' : algo.mixedGenderPairing === 'ALLOWED_MEDIUM' ? 'Permitido' : 'Permitido (prioridad)'}</span></li>
            <li class="flex justify-between gap-2"><span class="text-on-surface-variant">Lector estudiantil</span><span class="font-semibold">nivel ${algo.studentReaderLevel}</span></li>
            <li class="flex justify-between gap-2"><span class="text-on-surface-variant">Labores de servicio</span><span class="font-semibold">${algo.serviceRolesOnlyMale ? 'solo hombres' : 'sin restricción'}</span></li>
          </ul>
          <div class="mt-4">
            <button data-algo-config class="w-full px-4 py-2.5 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-container transition-colors">Editar reglas</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const bck = (d) => { const b = document.querySelector('[data-algo-back]'); if (b) b.onclick = d; };
  bck(() => go('new'));
  app.querySelectorAll('[data-algo-config]').forEach(b => b.onclick = () => go('settings'));
  if ($('[data-algo-manual]')) $('[data-algo-manual]').onclick = () => go('auto');

  // Gráficos con el historial real.
  const log = await db.listAssignmentLog();
  const people = state.people;
  const byPerson = workloadByPerson(log, people).filter(r => r.count > 0).slice(0, 12);
  $('#algoBarWorkload').innerHTML = svgBarras(byPerson.map(r => ({ label: r.name, value: r.count })));
  $('#algoLineTimeline').innerHTML = svgLinea(historyTimeline(log).map(r => ({ label: r.month.slice(2), value: r.total })));
  $('#algoDonaRoles').innerHTML = svgDona(distributionByLabore(log).slice(0, 8).map(r => ({ label: r.label, value: r.total })));
  const pairStats = pairRoleStats(log);
  $('#algoBarPairs').innerHTML = pairStats.length
    ? svgBarras(pairStats.map(r => ({ label: r.name, value: r.encargado + r.ayudante, sub: `${r.encargado}E / ${r.ayudante}A` })))
    : '<p class="text-sm text-on-surface-variant">Sin presentaciones registradas.</p>';

  // Generación de propuestas (botón). Lee la config guardada (Ajustes).
  const generar = async () => {
    const cfg = await db.getConfig();
    const a = { ...defaultAlgorithmConfig(), ...(cfg.algorithm || {}) };
    const s = { ...defaultScoringConfig(), ...((cfg.algorithm || {}).scoring || {}) };
    const month = $('#algoMonth').value;
    const btn = $('#algoGenerate');

    // Validación: debe haber semanas de la guía de actividades cargadas para el mes.
    const mwMes = (await db.listMidweeks()).filter(m => String(m.id).slice(0, 7) === month);
    if (!mwMes.length) {
      const mesTxt = `${MONTHS_ES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
      openModal(`
        <div class="text-center">
          <span class="material-symbols-outlined text-6xl text-primary mb-2">upload_file</span>
          <h3 class="font-headline-md text-headline-md text-primary mb-1">No hay semanas cargadas</h3>
          <p class="text-on-surface-variant text-sm mb-1">Para generar propuestas de ${mesTxt} primero debes subir la <b>Guía de Actividades</b> de ese mes.</p>
          <p class="text-on-surface-variant text-sm mb-6">La guía se carga desde la vista Carga de Archivos.</p>
          <div class="flex gap-3 justify-center">
            <button id="algoFaltaGuiaCancel" class="px-5 py-2.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cancelar</button>
            <button id="algoFaltaGuiaGo" class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Subir la guía</button>
          </div>
        </div>`);
      $('#algoFaltaGuiaCancel').onclick = closeModal;
      $('#algoFaltaGuiaGo').onclick = () => { closeModal(); go('uploads'); };
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span> Generando…';
    try {
      const [months, salidas, atencion, logMes] = await Promise.all([
        db.listMonths(), db.listSalidas(), db.listAtencion(), db.listAssignmentLog(),
      ]);
      const faltSalidas = salidasFaltantes(salidas.filter(p => String(p.id) === month));
      if (faltSalidas.length) {
        const mesTxt = `${MONTHS_ES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
        const seguir = await new Promise((resolve) => {
          openModal(`
            <div class="text-center">
              <span class="material-symbols-outlined text-6xl text-warning mb-2">event_busy</span>
              <h3 class="font-headline-md text-headline-md text-primary mb-1">Programa de salidas incompleto</h3>
              <p class="text-on-surface-variant text-sm mb-2">En ${mesTxt} hay <b>${faltSalidas.length}</b> salida(s) sin orador asignado.</p>
              <p class="text-on-surface-variant text-sm mb-6">¿Desea continuar? El conductor permanente dirigirá el fin de semana y se usará al conductor suplente solo cuando el permanente esté asignado en salidas esa misma semana.</p>
              <div class="flex gap-3 justify-center">
                <button id="algoSalidasCancel" class="px-5 py-2.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cancelar</button>
                <button id="algoSalidasGo" class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Continuar</button>
              </div>
            </div>`);
          $('#algoSalidasCancel').onclick = () => { closeModal(); resolve(false); };
          $('#algoSalidasGo').onclick = () => { closeModal(); resolve(true); };
        });
        if (!seguir) return;
      }
      const input = {
        people,
        midweeks: mwMes,
        months: months.filter(m => m.id === month),
        salidas: salidas.filter(p => p.id === month),
        atencion: atencion.filter(p => p.id === month),
        historial: logMes.map(e => ({ personId: String(e.personId || ''), date: String(e.date || ''), roleKey: String(e.roleKey || '') })),
        nombres: Object.fromEntries(people.map(p => [String(p.id), p.name])),
      };
      const props = generateProposals(input, a, s);
      const caja = $('#algoResults');
      if (!props.length) { caja.innerHTML = '<p class="text-sm text-error">No se pudieron generar propuestas para este mes.</p>'; return; }
      const lista = props.map((p, i) => {
        const bd = p.breakdown || {};
        const dims = [
          ['Equilibrio de carga', bd.workloadBalance], ['Rotación de roles', bd.roleRotation],
          ['Reparto semanal', bd.weeklyBalance], ['Sin repetición', bd.monthlyRepetition],
          ['Escasez', bd.scarceRoleProtection], ['Parejas', bd.pairRoleBalance], ['Oportunidad', bd.studentOpportunityBalance],
        ].filter(([, v]) => v !== undefined).map(([l, v]) => `
          <div class="flex items-center gap-2">
            <span class="text-xs text-on-surface-variant w-32 truncate">${l}</span>
            <div class="flex-1 h-2 bg-surface-variant rounded-full overflow-hidden"><div class="h-full ${v >= 70 ? 'bg-tertiary' : v >= 40 ? 'bg-secondary' : 'bg-error'}" style="width:${Math.max(2, v)}%"></div></div>
            <span class="text-xs font-semibold w-8 text-right">${v}</span>
          </div>`).join('');
        const warn = (p.warnings || []).length ? `<div class="mt-3 bg-error-container/30 rounded-lg border border-error/40 p-3 text-xs text-on-error-container space-y-1">${p.warnings.map(w => `<p class="flex items-start gap-1.5"><span class="material-symbols-outlined text-[14px] mt-0.5">warning</span>${escapeHtml(w)}</p>`).join('')}</div>` : '';
        const medalla = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
        return `
        <div class="bg-surface-container-low rounded-xl border ${i === 0 ? 'border-tertiary' : 'border-outline-variant/60'} p-5">
          <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div class="flex items-center gap-3">
              <span class="text-2xl">${medalla}</span>
              <div>
                <p class="font-label-lg text-label-lg text-primary">Propuesta ${i + 1}${p.valida === false ? ' · incompleta' : ''}</p>
                <p class="text-xs text-on-surface-variant">${(p.assignments || []).length} asignaciones · semilla ${p.seed}</p>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-4xl font-bold ${p.score >= 80 ? 'text-tertiary' : p.score >= 60 ? 'text-secondary' : 'text-error'}" style="font-family:'Playfair Display',serif">${p.score}</span>
              <span class="text-xs text-on-surface-variant">/ 100</span>
              <button data-previa="${i}" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90"><span class="material-symbols-outlined text-[16px]">visibility</span> Vista previa</button>
            </div>
          </div>
          <div class="space-y-1.5">${dims}</div>
          ${warn}
        </div>`;
      }).join('');
      caja.innerHTML = `<h4 class="font-label-lg text-label-lg text-on-surface-variant mb-2">Mejores ${props.length} de ${Math.max(props.length, 1)} propuesta(s)</h4>${lista}`;
      caja.querySelectorAll('[data-previa]').forEach(b => b.onclick = () => {
        abrirVistaPreviaPropuesta(props[Number(b.dataset.previa)], month, Number(b.dataset.previa));
      });
    } catch (e) {
      console.error(e);
      $('#algoResults').innerHTML = `<p class="text-sm text-error">Error al generar: ${escapeHtml(e.message || e)}</p>`;
    }
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined text-[20px]">play_arrow</span> Generar';
  };
  $('#algoGenerate').onclick = generar;
}

// Persiste una propuesta en los stores (reescribe midweeks/month/salidas/atencion).
async function aplicarPropuesta(p, month) {
  const writes = [];
  (p.midweeks || []).forEach(w => writes.push(db.putMidweek(w)));
  (p.months || []).forEach(m => writes.push(db.putMonth(m)));
  (p.salidas || []).forEach(x => writes.push(db.putSalidas(x)));
  (p.atencion || []).forEach(x => writes.push(db.putAtencion(x)));
  await Promise.all(writes);
  state.midweeks = await db.listMidweeks();
  await syncAssignmentLog();
}

// Vista previa de una propuesta: renderiza la vista mensual general con los
// programas de la propuesta en memoria, marca los conflictos con su redacción
// breve y permite aceptarla (persiste en todos los stores y deja los programas
// en edición para completarlos).
function abrirVistaPreviaPropuesta(p, month, i) {
  openModal(`
    <div>
      <div class="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 class="font-headline-md text-headline-md text-primary">Propuesta ${i + 1} <span class="text-on-surface-variant">· ${p.score} / 100</span></h3>
          <p class="text-xs text-on-surface-variant mt-0.5">${(p.assignments || []).length} asignaciones · semilla ${p.seed}${p.valida === false ? ' · incompleta' : ''}</p>
        </div>
        <button data-close-modal class="material-symbols-outlined p-1 rounded-lg hover:bg-surface-variant text-on-surface-variant">close</button>
      </div>
      <div id="pvConflictos" class="mb-4"></div>
      <div id="pvVacios" class="mb-4"></div>
      <div id="pvSinAsignar" class="mb-4"></div>
      <div id="pvGeneral"></div>
      <div class="flex gap-3 justify-end mt-5 pt-4 border-t border-outline-variant/40">
        <button data-cancel class="px-5 py-2.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cancelar</button>
        <button id="pvAccept" class="px-6 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Aceptar propuesta</button>
      </div>
    </div>`, true);
  $('#pvConflictos').innerHTML = redaccionConflictosPropuesta(p, month);
  const pvVacios = $('#pvVacios');
  pvVacios.innerHTML = redaccionVaciosPropuesta(p);
  pvVacios.style.display = pvVacios.innerHTML ? '' : 'none';
  $('#pvSinAsignar').innerHTML = redaccionSinAsignarPropuesta(p);
  renderGeneralMonth(month, {
    embed: $('#pvGeneral'),
    data: {
      months: p.months || [],
      midweeks: p.midweeks || [],
      salidas: p.salidas || [],
      atencion: p.atencion || [],
    },
  });
  modalEl('[data-close-modal]').onclick = closeModal;
  modalEl('[data-cancel]').onclick = closeModal;
  $('#pvAccept').onclick = async () => {
    $('#pvAccept').disabled = true;
    await aplicarPropuesta(p, month);
    closeModal();
    state.progMonth = month;
    go('new');
    toast('Propuesta aplicada. Revise y complete los programas.', 'success');
  };
}

// Redacción breve de los conflictos de una propuesta (cruzados, de fin de semana
// y de entre semana) y de los puestos que quedan sin completar. Los conflictos se
// marcan en rojo con su descripción; lo pendiente se lista aparte.
function redaccionConflictosPropuesta(p, month) {
  const REGLA = {
    E1: 'No puede tener más de una asignación (entre semana + acomodación) en la misma semana.',
    E2: 'No puede tener más de una asignación (fin de semana + acomodación + salidas) en la misma semana.',
    E3: 'La misma asignación de entre semana se repite en el mes.',
    E4: 'El mismo cargo de fin de semana se repite en el mes.',
    E5: 'No puede tener más de una salida en el mes.',
  };
  const mesTxt = (id) => `${MONTHS_ES[Number(String(id).slice(5, 7)) - 1]} ${String(id).slice(0, 4)}`;
  const conflictos = [];
  const pendientes = [];

  computeCrossConflicts({
    months: (p.months || []).filter(m => String(m.id).startsWith(month)),
    midweeks: (p.midweeks || []).filter(m => String(m.id).startsWith(month)),
    atencion: (p.atencion || []).filter(x => String(x.id) === month),
    salidas: (p.salidas || []).filter(x => String(x.id) === month),
    permanentConductorId: state.config && state.config.algorithm && state.config.algorithm.permanentConductorId,
    permanentConductorBackupId: state.config && state.config.algorithm && state.config.algorithm.permanentConductorBackupId,
    permanentConductorBackupId2: state.config && state.config.algorithm && state.config.algorithm.permanentConductorBackupId2,
  }).forEach(c => conflictos.push(`${personNameOf(c.value)} — ${c.detalle}. ${REGLA[c.regla] || ''}`));

  (p.months || []).forEach(m => {
    computeConflicts(m).errors.forEach(e => {
      if (e.includes('falta')) pendientes.push(`${mesTxt(m.id)} · ${e}`);
      else conflictos.push(`${mesTxt(m.id)} · ${e}`);
    });
  });

  (p.midweeks || []).forEach(w => {
    computeMidweekConflicts(w).errors.forEach(e => conflictos.push(`${mesTxt(w.id)} · ${e}`));
  });

  const parts = [];
  if (conflictos.length) {
    parts.push(`<div class="rounded-xl border border-error bg-error-container/20 p-4 mb-3">
      <div class="flex items-center gap-2 mb-2">
        <span class="material-symbols-outlined text-error">report</span>
        <h4 class="font-label-lg text-label-lg text-on-surface">Conflictos de asignación (${conflictos.length})</h4>
      </div>
      <ul class="space-y-1.5 text-sm">
        ${conflictos.map(t => `<li class="flex items-start gap-2"><span class="material-symbols-outlined text-error text-[16px] mt-0.5">person_off</span><span class="text-on-surface">${escapeHtml(t)}</span></li>`).join('')}
      </ul>
    </div>`);
  }
  if (pendientes.length) {
    parts.push(`<div class="rounded-xl border border-outline-variant bg-surface-container-low p-4">
      <div class="flex items-center gap-2 mb-2">
        <span class="material-symbols-outlined text-tertiary">assignment_late</span>
        <h4 class="font-label-lg text-label-lg text-on-surface">Puestos por completar (${pendientes.length})</h4>
      </div>
      <ul class="space-y-1.5 text-sm">
        ${pendientes.map(t => `<li class="flex items-start gap-2"><span class="material-symbols-outlined text-tertiary text-[16px] mt-0.5">edit</span><span class="text-on-surface">${escapeHtml(t)}</span></li>`).join('')}
      </ul>
    </div>`);
  }

  // Advertencias del motor (restricciones de repetición / roles).
  const repo = (p && p.restricciones) || {};
  const avisos = [];
  if (repo.superaMaximo && repo.superaMaximo.length) avisos.push(`Se supera el máximo de repetición mensual: ${repo.superaMaximo.join('; ')}.`);
  if (repo.mujeresEnServicio && repo.mujeresEnServicio.length) avisos.push(`Mujeres en labores no estudiantiles: ${repo.mujeresEnServicio.join('; ')}.`);
  if (avisos.length) {
    parts.push(`<div class="rounded-xl border border-secondary/40 bg-secondary-container/20 p-4 mb-3">
      <div class="flex items-center gap-2 mb-2">
        <span class="material-symbols-outlined text-secondary">warning</span>
        <h4 class="font-label-lg text-label-lg text-on-surface">Sugerencias del motor (${avisos.length})</h4>
      </div>
      <ul class="space-y-1.5 text-sm">
        ${avisos.map(t => `<li class="flex items-start gap-2"><span class="material-symbols-outlined text-secondary text-[16px] mt-0.5">info</span><span class="text-on-surface">${escapeHtml(t)}</span></li>`).join('')}
      </ul>
    </div>`);
  }
  if (!parts.length) {
    parts.push(`<div class="rounded-xl border border-tertiary/40 bg-tertiary-container/20 p-4 flex items-center gap-2 text-sm">
      <span class="material-symbols-outlined text-tertiary">verified</span>
      <span class="text-on-surface">Sin conflictos de asignación detectados.</span>
    </div>`);
  }
  return parts.join('');
}

// Resumen de puestos que quedaron vacíos en la propuesta (semana + labor).
function redaccionVaciosPropuesta(p) {
  const vac = laboresVaciasPropuesta(p);
  if (!vac.length) return '';
  const PROG = { entre: 'Entre semana', atencion: 'Atención', fin: 'Fin de semana' };
  const fmt = (iso) => { try { return new Date(iso + 'T00:00:00').toLocaleDateString('es', { day: '2-digit', month: 'short' }); } catch (e) { return iso; } };
  return `<div class="rounded-xl border border-error/40 bg-error-container/15 p-4">
    <div class="flex items-center gap-2 mb-2">
      <span class="material-symbols-outlined text-error">report_gmailerrorred</span>
      <h4 class="font-label-lg text-label-lg text-on-surface">Puestos sin cubrir (${vac.length})</h4>
    </div>
    <ul class="space-y-1 text-sm text-on-surface-variant">${vac.map(v => `<li>${PROG[v.programa] || v.programa} · ${fmt(v.semana)}: <span class="text-on-surface">${escapeHtml(v.label)}</span></li>`).join('')}</ul>
  </div>`;
}

// Lista de personas sin asignación en una propuesta (los que no participan),
// agrupadas por motivo.
function redaccionSinAsignarPropuesta(p) {
  const g = sinAsignarPorMotivo(p, state.people);
  const total = g.universales.length + g.conVacantes.length + g.cubiertos.length;
  if (!total) {
    return `<div class="rounded-xl border border-tertiary/40 bg-tertiary-container/20 p-4 flex items-center gap-2 text-sm">
      <span class="material-symbols-outlined text-tertiary">group_add</span>
      <span class="text-on-surface">Todos los participantes tienen asignación en esta propuesta.</span>
    </div>`;
  }
  const labelDe = (id) => (state.labores.find(r => String(r.id) === String(id)) || {}).label || String(id);
  const fila = (x, nota) => `<li class="flex items-center justify-between gap-3 rounded-lg bg-surface-bright border border-outline-variant px-3 py-2">
    <span class="text-sm text-on-surface">${escapeHtml(x.name)}</span>
    <span class="text-xs text-on-surface-variant text-right">${nota}</span>
  </li>`;
  const grupo = (icono, titulo, texto, filas) => `<div class="rounded-lg bg-surface-container-high/40 border border-outline-variant/60 p-3">
    <div class="flex items-center gap-2 mb-1.5">
      <span class="material-symbols-outlined text-base text-primary">${icono}</span>
      <h5 class="font-label-md text-label-md text-on-surface">${titulo}</h5>
    </div>
    <p class="text-xs text-on-surface-variant mb-2">${texto}</p>
    <ul class="space-y-1">${filas}</ul>
  </div>`;
  const parts = [];
  if (g.conVacantes.length) {
    parts.push(grupo('extension', `Con puestos libres de su labor (${g.conVacantes.length})`,
      `Hay vacantes que podrían cubrir en la labor marcada.`,
      g.conVacantes.map(x => fila(x.persona, `${x.laboresVacantes.map(labelDe).join(', ')} · ${x.puestos} puesto${x.puestos === 1 ? '' : 's'} libre${x.puestos === 1 ? '' : 's'}`)).join('')));
  }
  if (g.cubiertos.length) {
    parts.push(grupo('check_circle_outline', `Sin vacantes para su labor (${g.cubiertos.length})`,
      `No quedaron puestos libres que coincidan con sus labores en el mes.`,
      g.cubiertos.map(x => fila(x, x.labores.map(labelDe).join(', '))).join('')));
  }
  if (g.universales.length) {
    parts.push(grupo('gesture', `Sin labores marcadas (${g.universales.length})`,
      `Pueden hacer cualquier labor; no quedaron puestos disponibles.`,
      g.universales.map(x => fila(x, 'Disponible para cualquier labor')).join('')));
  }
  return `<div class="rounded-xl border border-outline-variant bg-surface-container-low p-4">
    <div class="flex items-center gap-2 mb-2">
      <span class="material-symbols-outlined text-secondary">group_off</span>
      <h4 class="font-label-lg text-label-lg text-on-surface">Sin asignación en esta propuesta (${total})</h4>
    </div>
    <div class="space-y-2">${parts.join('')}</div>
  </div>`;
}

async function renderNewBody() {
  const body = $('#newBody');
  if (!body) return;
  if (state.newTab === 'entre') { renderMidweeks({ embed: body, month: state.progMonth }); return; }
  if (state.newTab === 'atencion') { renderAtencion(state.progMonth, { embed: body }); return; }
  if (state.newTab === 'atencionGrupo') { renderAtencionGrupo(state.progMonth, { embed: body }); return; }
  if (state.newTab === 'salidas') { renderSalidas(state.progMonth, { embed: body }); return; }
  if (state.newTab === 'general') { renderGeneralMonth(state.progMonth, { embed: body }); return; }
  renderNewFin(body, state.progMonth);
}

async function renderNewFin(body, progMonth) {
  const months = await db.listMonths();
  const pm = progMonth || isoDate(new Date()).slice(0, 7);
  const year = Number(pm.slice(0, 4));
  const month = Number(pm.slice(5, 7));
  const id = `${year}-${String(month).padStart(2, '0')}`;
  body.innerHTML = `
    <div class="max-w-xl bg-surface-container-lowest rounded-xl shadow-[0px_4px_20px_rgba(0,0,0,0.04)] p-6 md:p-8 border border-outline-variant">
      <div class="bg-surface-container rounded-lg p-4 mb-6">
        <p class="font-label-md text-label-md text-on-surface-variant uppercase mb-2">Sábados detectados</p>
        <div id="nmPreview" class="flex flex-wrap gap-2"></div>
      </div>
      <button id="nmCreate" data-admin class="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:opacity-90 active:scale-95 transition-all">
        Crear Programa
      </button>
    </div>

    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mt-12 mb-6">
      <h2 class="font-headline-lg text-headline-lg text-primary">Programas</h2>
    </div>
    <div id="newMonthsList" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter"></div>
  `;
  const list = $('#newMonthsList');
  if (months.length === 0) {
    list.innerHTML = `<div class="col-span-full text-center py-16 border-2 border-dashed border-outline-variant rounded-xl">
      <span class="material-symbols-outlined text-primary text-6xl mb-4">calendar_month</span>
      <p class="text-on-surface-variant font-body-lg">Aún no hay programas creados. Use el formulario de arriba para comenzar.</p>
    </div>`;
  } else {
    list.innerHTML = months.map(m => {
      const filled = m.weeks.filter(w => w.type === 'assembly' || weekComplete(w)).length;
      const pct = Math.round((filled / m.weeks.length) * 100);
      const label = m.published ? 'Final' : (pct === 0 ? 'Nuevo programa' : 'Borrador');
      return `<article class="week-card-accent bg-surface-container-lowest rounded-lg shadow-[0px_4px_20px_rgba(0,0,0,0.04)] p-6 border border-outline-variant hover:shadow-[0px_8px_30px_rgba(0,0,0,0.08)] transition-shadow flex flex-col gap-4">
        <div class="flex justify-between items-start">
          <div>
            <span class="inline-block px-3 py-1 ${m.published ? 'bg-tertiary-fixed text-on-tertiary-fixed' : 'bg-secondary-container text-on-secondary-container'} font-label-md text-label-md rounded-full">${label}</span>
            <h3 class="font-headline-md text-headline-md text-primary mt-3">${MONTHS_ES[m.month - 1]} ${m.year}</h3>
            <p class="text-on-surface-variant font-caption text-caption uppercase tracking-wider">${m.weeks.length} reuniones · ${pct}% completo</p>
          </div>
          <span class="material-symbols-outlined text-outline-variant">${m.published ? 'task_alt' : 'edit_note'}</span>
        </div>
        <div class="h-2 bg-surface-variant rounded-full overflow-hidden"><div class="h-full bg-primary" style="width:${pct}%"></div></div>
        <div class="flex gap-2 mt-2">
          <button data-edit="${m.id}" class="flex-1 px-3 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-all">Editar</button>
          <button data-view="${m.id}" class="flex-1 px-3 py-2 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container transition-all">Vista</button>
          <button data-del="${m.id}" class="px-3 py-2 rounded-lg border border-outline-variant text-error font-label-md text-label-md hover:bg-error-container transition-all" title="Eliminar"><span class="material-symbols-outlined text-[18px]">delete</span></button>
        </div>
      </article>`;
    }).join('');
    list.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => go('edit', { monthId: b.dataset.edit }));
    list.querySelectorAll('[data-view]').forEach(b => b.onclick = () => go('preview', { monthId: b.dataset.view }));
    list.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (await confirmDialog('¿Eliminar este programa? Esta acción no se puede deshacer.', 'Eliminar')) {
        await db.deleteMonth(b.dataset.del);
        toast('Programa eliminado', 'success');
        renderNewBody();
      }
    });
  }

  const preview = () => {
    const sats = saturdaysOf(year, month);
    $('#nmPreview').innerHTML = sats.length
      ? sats.map(s => `<span class="px-3 py-1 bg-primary text-on-primary rounded font-label-md text-label-md">${formatShort(s)}</span>`).join('')
      : `<span class="text-error font-label-md">No hay sábados en este mes.</span>`;
  };
  preview();

  $('#nmCreate').onclick = async () => {
    if (await db.getMonth(id)) {
      if (!await confirmDialog(`Ya existe un programa para ${MONTHS_ES[month - 1]} ${year}. ¿Sobreescribirlo?`, 'Sobreescribir')) return;
    }
    const sats = saturdaysOf(year, month);
    const weeks = sats.map(d => newWeek(d));
    applyConfigWeekTypes(weeks);
    const monthObj = { id, year, month, weeks, published: false };
    await db.putMonth(monthObj);
    toast('Programa creado', 'success');
    go('edit', { monthId: id });
  };
}

// Marca automáticamente el tipo de reunión de cada semana según las fechas
// especiales de la configuración general (conmemoración, visita, asamblea).
function applyConfigWeekTypes(weeks, silent) {
  const events = state.config?.events || {};
  let marked = 0;
  for (const w of weeks) {
    const type = eventTypeForDate(events, w.date);
    if (type !== w.type) { w.type = type; marked++; }
  }
  if (marked > 0 && !silent) toast(`${marked} semana(s) marcada(s) según los eventos`, 'success');
  return weeks;
}

/* ---------- EDIT: editor de semanas ---------- */
async function renderEdit() {
  if (!state.monthId) { go('home'); return; }
  let m = await db.getMonth(state.monthId);
  if (!m) { toast('Programa no encontrado', 'error'); go('home'); return; }
  ensureOutings(m);
  applyConfigWeekTypes(m.weeks, true); // el tipo de reunión se determina por los eventos
  state.month = m;
  renderTop();
  const app = $('#app');
  app.innerHTML = `
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
      <div>
        <h1 class="font-headline-lg text-headline-lg text-primary">Edición Mensual</h1>
        <p class="text-on-surface-variant font-body-lg text-body-lg max-w-2xl">Organice las sesiones y labores para ${MONTHS_ES[m.month - 1]} ${m.year}. Evite duplicidad de personas en la misma reunión.</p>
      </div>
      <div class="flex gap-3 w-full md:w-auto flex-wrap">
        <button id="btnOutings" class="flex items-center justify-center gap-2 border border-secondary text-secondary px-4 py-2.5 rounded-lg font-label-md text-label-md hover:bg-secondary-container transition-colors">
          <span class="material-symbols-outlined text-[20px]">campaign</span>
          Vista de Salidas
        </button>
        <button id="btnPreview" class="flex items-center justify-center gap-2 bg-primary text-on-primary px-4 py-2.5 rounded-lg font-label-md text-label-md hover:shadow-lg transition-all active:scale-95">
          <span class="material-symbols-outlined text-[20px]">visibility</span>
          Vista Final
        </button>
      </div>
    </div>
    <div id="editCross" class="mb-4"></div>
    <div id="weeksContainer" class="space-y-6"></div>
    <div class="mt-10 flex flex-col sm:flex-row gap-3 justify-end no-print">
      <button id="btnSave" class="flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-primary text-on-primary font-bold hover:opacity-90 active:scale-95 transition-all">
        <span class="material-symbols-outlined">save</span> Guardar Cambios
      </button>
    </div>
  `;
  renderWeeks();
  $('#btnPreview').onclick = () => go('preview', { monthId: state.monthId });
  $('#btnOutings').onclick = () => go('outings', { monthId: state.monthId });
  $('#btnSave').onclick = saveMonth;
  renderCrossAlerts($('#editCross'), state.monthId);
}

/* ---------- EDIT: congregaciones (datos de salida) ---------- */
function congCard(c, i) {
  return `<div class="bg-surface-container-lowest rounded-lg p-4 border border-outline-variant space-y-3" data-cong-idx="${i}">
    <div class="flex items-center justify-between">
      <span class="font-label-md text-label-md text-secondary uppercase">Congregación ${i + 1}</span>
      <button data-cong-del="${i}" class="text-error" title="Eliminar"><span class="material-symbols-outlined text-[18px]">delete</span></button>
    </div>
    <div>
      <input type="text" data-cong-field="nombre" data-cong-idx="${i}" value="${escapeAttr(c.nombre || '')}" placeholder="Ej. Centro" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Día</label>
        <select data-cong-field="dia" data-cong-idx="${i}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          <option value="sabado" ${c.dia === 'sabado' ? 'selected' : ''}>Sábado</option>
          <option value="domingo" ${c.dia === 'domingo' ? 'selected' : ''}>Domingo</option>
        </select>
      </div>
      <div>
        <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Hora</label>
        <input type="time" data-cong-field="hora" data-cong-idx="${i}" value="${escapeAttr(c.hora || '')}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
      </div>
    </div>
  </div>`;
}

function bindCongFieldChange(node) {
  node.addEventListener('change', () => {
    const idx = parseInt(node.dataset.congIdx, 10);
    const field = node.dataset.congField;
    state.month.outings[idx][field] = node.value;
  });
}

function renderWeeks() {
  const container = $('#weeksContainer');
  const conflicts = computeConflicts(state.month);
  container.innerHTML = state.month.weeks.map((w, i) => weekCard(w, i, conflicts.perWeek[i] || {})).join('');
  container.querySelectorAll('[data-field]').forEach(bindFieldChange);
  container.querySelectorAll('select[data-people]').forEach(fillPeople);
  container.querySelectorAll('[data-add-person]').forEach(b => {
    b.onclick = () => {
      const sel = b.parentElement?.querySelector('select[data-people]');
      const labore = sel?.dataset.labore || '';
      quickAddPerson(labore).then(refreshPeopleSelects);
    };
  });
  container.querySelectorAll('[data-talkpicker]').forEach(bindTalkPicker);
}

/* ---------- Talk Picker: buscador de discurso por nº o palabra clave ---------- */

function bindTalkPicker(root) {
  const input = root.querySelector('input[data-field]');
  const box = root.querySelector('.talk-suggestions');
  if (!input || !box) return;
  let highlighted = -1;

  const render = (q) => {
    const results = searchTalks(q, state.talks);
    if (!results.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.innerHTML = results.map((t, i) => `<button type="button" data-talk-num="${t.num}" data-i="${i}"
        class="w-full text-left px-3 py-2 hover:bg-primary-fixed/40 flex gap-3 items-start border-b border-outline-variant/30 last:border-0">
      <span class="font-label-md text-label-md text-primary font-bold shrink-0 w-8 text-right">${t.num}.</span>
      <span class="font-body-md text-body-md text-on-surface">${escapeHtml(t.title)}</span>
    </button>`).join('');
    box.classList.remove('hidden');
    highlighted = -1;
    box.querySelectorAll('button[data-talk-num]').forEach(b => {
      b.onclick = (e) => { e.preventDefault(); selectTalk(parseInt(b.dataset.talkNum, 10)); };
      b.onmousedown = (e) => e.preventDefault(); // no robar el foco antes del click
    });
  };

  const selectTalk = (num) => {
    const t = state.talks.find(x => x.num === num);
    if (!t) return;
    input.value = `${num}. ${t.title}`;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    box.classList.add('hidden');
    box.innerHTML = '';
  };

  input.addEventListener('input', () => render(input.value));
  input.addEventListener('focus', () => { if (input.value) render(input.value); else render(''); });
  input.addEventListener('keydown', (e) => {
    const items = box.querySelectorAll('button[data-talk-num]');
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); highlighted = Math.min(highlighted + 1, items.length - 1); } else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); highlighted = Math.max(highlighted - 1, 0); } else if (e.key === 'Enter' && highlighted >= 0 && items[highlighted]) { e.preventDefault(); items[highlighted].click(); return; } else if (e.key === 'Escape') { box.classList.add('hidden'); return; } else return;
    items.forEach((it, i) => it.classList.toggle('bg-primary-fixed', i === highlighted));
  });

  // cerrar al hacer clic fuera
  document.addEventListener('click', function onDoc(e) {
    if (!root.contains(e.target)) { box.classList.add('hidden'); document.removeEventListener('click', onDoc); }
  }, { once: true });
}

function weekCard(w, i, conflicts) {
  const date = new Date(w.date + 'T00:00:00');
  const fullDate = capitalize(date.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }));

  return `<section class="week-card-accent bg-surface-container-lowest rounded-lg shadow-[0px_4px_20px_rgba(0,0,0,0.04)] p-6 md:p-8 border ${w.type !== 'normal' ? 'border-primary' : 'border-outline-variant'} hover:shadow-[0px_8px_30px_rgba(0,0,0,0.08)] transition-shadow">
    <div class="flex flex-col lg:flex-row gap-8">
      <div class="lg:w-1/4">
        <h3 class="font-headline-md text-headline-md text-primary mb-1">Semana ${i + 1}</h3>
        <div class="mb-2 flex items-center gap-1 text-secondary font-bold text-[10px] uppercase">
          <span class="material-symbols-outlined text-[14px]">${WEEK_TYPES[w.type].icon}</span> ${WEEK_TYPES[w.type].label}
        </div>
        <div class="inline-block px-3 py-1 bg-primary text-on-primary font-label-md text-label-md rounded">${fullDate}</div>
      </div>
      <div class="flex-1 space-y-6" data-fields="${i}">${fieldsFor(w, i, conflicts)}</div>
    </div>
  </section>`;
}

/* ---------- Labores: editor (tras bambalinas, no asignaciones de reunión) ---------- */
/* ---------- EDIT: sección Salidas (sólo semanas normales) ---------- */
function outingRow(o, weekIdx, outIdx, conflicts) {
  const dup = conflicts.duplicates.includes(outIdx);
  const badge = dup ? `<span class="flex items-center gap-1 text-error font-bold text-[10px] uppercase conflict-dot"><span class="material-symbols-outlined text-[14px]">warning</span> Repite en la semana</span>` : '';
  const talkVal = o.tituloDiscurso || '';
  return `<div class="bg-secondary-container/20 border border-secondary/50 rounded-lg p-4 space-y-3" data-outing="${weekIdx}.${outIdx}">
    <div class="flex items-center justify-between">
      <span class="font-label-md text-label-md text-secondary uppercase">Orador ${outIdx + 1}</span>
      <div class="flex items-center gap-2">
        ${badge}
        <button data-outing-del="${weekIdx}.${outIdx}" class="text-error" title="Eliminar orador"><span class="material-symbols-outlined text-[18px]">delete</span></button>
      </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div class="space-y-1">
        <label class="font-label-md text-label-md text-on-surface-variant">Orador</label>
        <select data-outing-field="oradorSalida" data-outing-idx="${weekIdx}.${outIdx}" data-people data-labore="orador" class="w-full bg-surface-bright border ${dup ? 'border-error' : 'border-outline-variant'} rounded-lg p-2.5 font-body-md focus:border-primary">
          <option value="">— Sin asignar —</option>
        </select>
      </div>
      <div class="space-y-1 relative" data-talkpicker-out data-out-idx="${weekIdx}.${outIdx}">
        <label class="font-label-md text-label-md text-on-surface-variant flex items-center justify-between">Discurso
          ${state.talks.length ? `<span class="text-on-surface-variant text-caption normal-case font-normal flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">search</span>Buscar</span>` : ''}
        </label>
        <div class="relative">
          <input type="text" data-outing-field="tituloDiscurso" data-outing-idx="${weekIdx}.${outIdx}" value="${escapeAttr(talkVal)}" placeholder="Título o número del discurso" autocomplete="off"
            class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-2 focus:border-secondary outline-none transition-all pr-10">
          <span class="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-outline text-[20px] pointer-events-none">search</span>
          <div class="talk-suggestions hidden absolute left-0 right-0 mt-1 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-xl max-h-72 overflow-y-auto z-30"></div>
        </div>
      </div>
    </div>
  </div>`;
}

// Talk picker para salidas (guarda en outings[oi].tituloDiscurso / talkNum)
function bindTalkPickerOut(root) {
  const input = root.querySelector('input[data-outing-field]');
  const box = root.querySelector('.talk-suggestions');
  if (!input || !box) return;
  let highlighted = -1;
  const render = (q) => {
    const results = searchTalks(q, state.talks);
    if (!results.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.innerHTML = results.map((t, i) => `<button type="button" data-talk-num="${t.num}" data-i="${i}"
        class="w-full text-left px-3 py-2 hover:bg-secondary-fixed/50 flex gap-3 items-start border-b border-outline-variant/30 last:border-0">
      <span class="font-label-md text-label-md text-secondary font-bold shrink-0 w-8 text-right">${t.num}.</span>
      <span class="font-body-md text-body-md text-on-surface">${escapeHtml(t.title)}</span>
    </button>`).join('');
    box.classList.remove('hidden');
    highlighted = -1;
    box.querySelectorAll('button[data-talk-num]').forEach(b => {
      b.onclick = (e) => { e.preventDefault(); select(parseInt(b.dataset.talkNum, 10)); };
      b.onmousedown = (e) => e.preventDefault();
    });
  };
  const select = (num) => {
    const t = state.talks.find(x => x.num === num);
    if (!t) return;
    const [wi, oi] = input.dataset.outingIdx.split('.').map(Number);
    state.month.weeks[wi].outings[oi].tituloDiscurso = `${num}. ${t.title}`;
    state.month.weeks[wi].outings[oi].talkNum = num;
    input.value = `${num}. ${t.title}`;
    box.classList.add('hidden');
    box.innerHTML = '';
  };
  input.addEventListener('input', () => {
    render(input.value);
    const [wi, oi] = input.dataset.outingIdx.split('.').map(Number);
    state.month.weeks[wi].outings[oi].tituloDiscurso = input.value;
    state.month.weeks[wi].outings[oi].talkNum = '';
  });
  input.addEventListener('focus', () => render(input.value));
  input.addEventListener('keydown', (e) => {
    const items = box.querySelectorAll('button[data-talk-num]');
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); highlighted = Math.min(highlighted + 1, items.length - 1); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); highlighted = Math.max(highlighted - 1, 0); }
    else if (e.key === 'Enter' && highlighted >= 0 && items[highlighted]) { e.preventDefault(); items[highlighted].click(); return; }
    else if (e.key === 'Escape') { box.classList.add('hidden'); return; }
    else return;
    items.forEach((it, i) => it.classList.toggle('bg-secondary-fixed', i === highlighted));
  });
  document.addEventListener('click', function onDoc(e) {
    if (!root.contains(e.target)) { box.classList.add('hidden'); document.removeEventListener('click', onDoc); }
  }, { once: true });
}

function fieldsFor(w, i, conflicts) {
  if (w.type === 'assembly') {
    return `<div class="h-full flex flex-col items-center justify-center p-8 bg-surface-container rounded-xl border border-dashed border-outline-variant text-center">
      <span class="material-symbols-outlined text-primary text-[48px] mb-4">event_busy</span>
      <h4 class="font-headline-md text-headline-md text-primary uppercase tracking-widest">Asamblea</h4>
      <p class="text-on-surface-variant font-body-lg">No se realiza reunión local esta semana.</p>
    </div>`;
  }
  if (w.type === 'commemoration') {
    return `
      ${talkPicker('tituloDiscurso', i, w.tituloDiscurso || '', 'Título del discurso de conmemoración', conflicts)}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        ${peopleSelect('presidente', i, w.presidente, 'Presidente', conflicts)}
        ${textInput('orador', i, w.orador || '', 'Nombre del orador (a mano)', conflicts)}
      </div>`;
  }
  if (w.type === 'supervisor') {
    return `
      ${textInput('nombreSupervisor', i, w.nombreSupervisor || '', 'Nombre del Superintendente (a mano)', conflicts)}
      ${textInput('discursoSupervisor1', i, w.discursoSupervisor1 || '', 'Título del discurso público', conflicts)}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${peopleSelect('presidente', i, w.presidente, 'Presidente', conflicts)}
        ${peopleSelect('estudioSinLectura', i, w.estudioSinLectura, 'Conductor del estudio (sin lectura)', conflicts)}
        ${textInput('discursoSupervisor2', i, w.discursoSupervisor2 || '', 'Título del discurso de servicio', conflicts)}
      </div>`;
  }
  // normal
  return `
    ${talkPicker('tituloDiscurso', i, w.tituloDiscurso || '', 'Título del discurso público', conflicts)}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      ${peopleSelect('presidente', i, w.presidente, 'Presidente', conflicts)}
      ${textInput('orador', i, w.orador || '', 'Nombre del orador (a mano)', conflicts)}
      ${peopleSelect('conductor', i, w.conductor, 'Conductor Atalaya', conflicts)}
      ${peopleSelect('lector', i, w.lector, 'Lector Atalaya', conflicts)}
    </div>`;
}

function textInput(name, idx, val, placeholder, conflicts) {
  const ok = !conflicts.missing?.includes(name);
  return `<div class="space-y-2">
    <label class="font-label-md text-label-md text-on-surface-variant">${capitalize(labelOf(name))}</label>
    <input data-field="${name}" data-idx="${idx}" type="text" placeholder="${placeholder}" value="${escapeAttr(val)}"
      class="w-full bg-surface-bright border ${ok ? 'border-outline-variant' : 'border-error'} rounded-lg p-3 text-body-md focus:border-2 focus:border-primary outline-none transition-all">
  </div>`;
}

// Buscador de discurso público: input de texto libre con sugerencias
// (por número o palabra clave) sobre la lista de discursos cargada.
function talkPicker(name, idx, val, placeholder, conflicts) {
  const ok = !conflicts.missing?.includes(name);
  const talksCount = state.talks.length;
  return `<div class="space-y-2 relative" data-talkpicker="${name}" data-idx="${idx}">
    <label class="font-label-md text-label-md text-on-surface-variant flex items-center justify-between">
      ${capitalize(labelOf(name))}
      ${talksCount ? `<span class="text-on-surface-variant text-caption normal-case font-normal flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">search</span>Buscar por nº o palabra</span>` : ''}
    </label>
    <div class="relative">
      <input data-field="${name}" data-idx="${idx}" type="text" placeholder="${placeholder}" value="${escapeAttr(val)}" autocomplete="off"
        class="w-full bg-surface-bright border ${ok ? 'border-outline-variant' : 'border-error'} rounded-lg p-3 text-body-md focus:border-2 focus:border-primary outline-none transition-all pr-10">
      <span class="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-outline text-[20px] pointer-events-none">search</span>
      <div class="talk-suggestions hidden absolute left-0 right-0 mt-1 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-xl max-h-72 overflow-y-auto z-30"></div>
    </div>
  </div>`;
}

function peopleSelect(name, idx, val, label, conflicts) {
  const labore = FIELD_LABORE[name] || '';
  const hasConflict = conflicts.duplicates?.includes(name);
  const missing = conflicts.missing?.includes(name);
  const repeated = sameFieldOtherWeek(name, idx);
  const badge = hasConflict
    ? `<span class="flex items-center gap-1 text-error font-bold text-[10px] uppercase conflict-dot"><span class="material-symbols-outlined text-[14px]">warning</span> Conflicto</span>`
    : repeated
      ? `<span class="flex items-center gap-1 text-secondary font-bold text-[10px] uppercase conflict-dot"><span class="material-symbols-outlined text-[14px]">event_repeat</span> Ya designado este mes</span>`
      : '';
  const errClass = (hasConflict || missing) ? 'bg-error-container/20 border-error' : 'border-outline-variant';
  const laboreHint = labore ? `data-labore="${labore}"` : '';
  return `<div class="space-y-2 relative">
    <label class="font-label-md text-label-md text-on-surface-variant flex items-center justify-between gap-2 flex-wrap">${label} ${badge}${missing ? '<span class="text-error font-bold text-[10px] uppercase ml-1">Falta</span>' : ''}</label>
    <div class="flex gap-2">
      <select data-field="${name}" data-idx="${idx}" data-people ${laboreHint} class="flex-1 bg-surface-bright border ${errClass} rounded-lg p-2.5 font-body-md focus:border-primary">
        <option value="">— Sin asignar —</option>
      </select>
   </div>
   <div class="field-suggestions flex flex-wrap gap-1 text-[11px]" data-fsug="${name}" data-fsug-idx="${idx}"></div>
  </div>`;
}

// ¿La persona elegida en esta semana para el campo `field` ya está designada para
// el MISMO campo en otra semana del mes? (aviso, no bloquea)
function sameFieldOtherWeek(field, weekIdx) {
  const m = state.month;
  if (!m || !Array.isArray(m.weeks)) return false;
  const val = m.weeks[weekIdx] && m.weeks[weekIdx][field];
  if (!val) return false;
  return m.weeks.some((w, i) => i !== weekIdx && w[field] && String(w[field]) === String(val));
}

function fillPeople(sel) {
  if (sel.dataset.idx === undefined) return;       // ignorar selects de salidas (usan data-outing-idx)
  const current = parseInt(sel.dataset.idx, 10);
  const field = sel.dataset.field;
  if (!state.month || !state.month.weeks[current]) return;
  const val = state.month.weeks[current][field];
  const labore = sel.dataset.labore || '';
  const list = eligiblePeople(state.month.weeks[current], state.people, labore, val);
  sel.innerHTML = `<option value="">— Sin asignar —</option>` +
    list.map(p => `<option value="${p.id}" ${String(p.id) === String(val) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  fillSuggestions(sel, current, field, labore, val);
}

function fillSuggestions(sel, idx, field, labore, val) {
  const wrap = sel.closest('.space-y-2.relative')?.querySelector('.field-suggestions[data-fsug]');
  if (!wrap) return;
  if (val) { wrap.innerHTML = ''; return; }
  const week = state.month?.weeks?.[idx];
  if (!week) return;
  const list = eligiblePeople(week, state.people, labore, val);
  wrap.innerHTML = list.slice(0, 6).map(p =>
    `<button type="button" data-fsug-pick="${idx}" data-fsug-field="${field}" data-fsug-id="${p.id}"
      class="px-2 py-0.5 rounded-full bg-primary-fixed/70 text-primary border border-primary/30 text-[11px] font-label-md hover:bg-primary hover:text-on-primary transition-colors">${escapeHtml(p.name.split(' ')[0])} ${escapeHtml((p.name.split(' ')[1] || '').slice(0, 1))}</button>`
  ).join('');
  wrap.querySelectorAll('button[data-fsug-pick]').forEach(b => b.onclick = () => {
    const pid = b.dataset.fsugId;
    if (![...sel.options].some(o => String(o.value) === pid)) {
      sel.add(new Option(personNameOf(pid), pid));
    }
    sel.value = pid;
    sel.dispatchEvent(new Event('change'));
  });
}

// Rellena un select de orador de salida (data-outing-idx="wi.oi")
function fillOutingPeople(sel) {
  const parts = (sel.dataset.outingIdx || '').split('.').map(Number);
  if (parts.length !== 2 || !state.month || !state.month.weeks[parts[0]]) return;
  const [wi, oi] = parts;
  const outing = state.month.weeks[wi].outings?.[oi];
  const val = outing ? outing.oradorSalida : '';
  const labore = sel.dataset.labore || 'orador';
  const list = eligiblePeople(state.month.weeks[wi], state.people, labore, val);
  sel.innerHTML = `<option value="">— Sin asignar —</option>` +
    list.map(p => `<option value="${p.id}" ${String(p.id) === String(val) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
}

function refreshPeopleSelects() {
  document.querySelectorAll('select[data-people]').forEach(fillPeople);
}

function bindFieldChange(node) {
  node.addEventListener('change', () => {
    const idx = parseInt(node.dataset.idx, 10);
    const field = node.dataset.field;
    let val = node.value;
    if (node.dataset.people !== undefined || node.dataset.dept !== undefined) {
      val = val === '' ? '' : parseInt(val, 10);
    }
    state.month.weeks[idx][field] = val;
    // re-renderizar tarjetas para reflejar conflictos (change se dispara tras blur)
    renderWeeks();
  });
}

async function saveMonth() {
  const conflicts = computeConflicts(state.month);
  const hard = conflicts.errors;
  if (hard.length) {
    toast(`${hard.length} problema(s) sin resolver. Revise los campos resaltados.`, 'error');
    return;
  }
  state.month.updatedAt = Date.now();
  await db.putMonth(state.month);
  await syncAssignmentLog();
  toast('Cambios guardados', 'success');
}

/* ---------- Validación ---------- */
// (collectWeekPersons, labelOfKey, computeConflicts, weekComplete se importan de logic.js)

/* ---------- PREVIEW: lista y tabla ---------- */
async function renderPreview() {
  if (!state.monthId) { go('home'); return; }
  const m = await db.getMonth(state.monthId);
  if (!m) { toast('Programa no encontrado', 'error'); go('home'); return; }
  applyConfigWeekTypes(m.weeks, true); // el tipo de reunión se determina por los eventos
  state.month = m;
  renderTop();
  const app = $('#app');
  app.innerHTML = `
    <div class="mb-8 text-center md:text-left">
      <div class="flex items-center gap-3 mb-2 justify-center md:justify-start">
        <span class="editorial-line w-12 hidden md:block"></span>
        <p class="font-label-md text-label-md text-secondary uppercase tracking-widest">REUNION PUBLICA</p>
      </div>
      <h1 class="font-display-lg text-display-lg text-primary mb-2 leading-tight">${MONTHS_ES[m.month - 1].toUpperCase()} ${m.year}</h1>
    </div>

    <div class="flex items-center justify-between gap-4 mb-6 no-print">
      <div class="flex items-center gap-1 bg-surface-container-high p-1 rounded-lg">
        <button id="modeLista" class="px-4 py-2 font-label-md text-label-md rounded-md transition-colors ${state.previewMode === 'lista' ? 'bg-surface text-primary editorial-shadow' : 'text-on-surface-variant hover:bg-surface-container-highest'}">Vista Lista</button>
        <button id="modeTabla" class="px-4 py-2 font-label-md text-label-md rounded-md transition-colors ${state.previewMode === 'tabla' ? 'bg-surface text-primary editorial-shadow' : 'text-on-surface-variant hover:bg-surface-container-highest'}">Vista Tabla</button>
      </div>
      <button id="btnEdit" class="flex items-center gap-2 px-4 py-2 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-all active:scale-95">
        <span class="material-symbols-outlined text-[20px]">edit</span> Editar
      </button>
    </div>

    <div id="previewContent" class="bg-surface-container-lowest editorial-shadow rounded-xl border border-outline-variant p-4 md:p-8"></div>
  `;
  $('#btnEdit').onclick = () => go('edit', { monthId: state.monthId });
  $('#modeLista').onclick = () => { state.previewMode = 'lista'; go('preview', { monthId: state.monthId, previewMode: 'lista' }); };
  $('#modeTabla').onclick = () => { state.previewMode = 'tabla'; go('preview', { monthId: state.monthId, previewMode: 'tabla' }); };
  renderPreviewContent();

  // Action bar de exportación
  const bar = $('#actionBar');
  bar.classList.remove('hidden');
  bar.classList.add('no-print');
  bar.innerHTML = `<div class="max-w-container-max-width mx-auto flex flex-wrap justify-center md:justify-end gap-gutter">
    ${actionBtn('Imprimir', 'print', 'printProgram')}
    ${actionBtn('Exportar PDF', 'picture_as_pdf', 'pdfProgram')}
    ${actionBtn('Compartir', 'ios_share', 'shareProgram')}
    ${actionBtn('Guardar Imagen', 'image', 'imageProgram')}
    ${actionBtn('WhatsApp', 'share', 'waProgram')}
  </div>`;
  $('#printProgram').onclick = () => window.print();
  $('#pdfProgram').onclick = () => window.print();
  $('#shareProgram').onclick = shareProgram;
  $('#imageProgram').onclick = imageProgram;
  $('#waProgram').onclick = waProgram;
}

function actionBtn(label, icon, id) {
  return `<button id="${id}" class="flex items-center gap-2 px-5 py-2 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-all active:scale-95">
    <span class="material-symbols-outlined text-[20px]">${icon}</span> ${label}
  </button>`;
}

function renderPreviewContent() {
  const c = $('#previewContent');
  c.innerHTML = state.previewMode === 'lista' ? previewLista() : previewTabla();
}

function previewLista() {
  return `<div class="grid grid-cols-1 md:grid-cols-2 gap-gutter">
    ${state.month.weeks.map((w, i) => weekCardList(w, i)).join('')}
  </div>`;
}

function weekCardList(w, i) {
  const date = new Date(w.date + 'T00:00:00');
  const day = date.getDate();
  const monthName = MONTHS_ES[state.month.month - 1].toUpperCase();

  const icon = WEEK_TYPES[w.type].icon;
  if (w.type === 'assembly') {
    return `<div class="week-card bg-surface-container-low border-l-4 p-8 rounded-lg bg-surface-dim">
      <div class="flex justify-between items-start mb-6">
        <div><span class="font-label-md text-label-md text-on-secondary-container bg-secondary-container px-3 py-1 rounded-full uppercase">Semana ${i + 1}</span>
        <h2 class="font-headline-lg text-headline-lg text-primary mt-3">${day} ${monthName}</h2></div>
        <span class="material-symbols-outlined text-outline-variant text-4xl">event_busy</span>
      </div>
      <div class="flex flex-col items-center justify-center py-12 text-center">
        <span class="material-symbols-outlined text-primary text-6xl mb-2">groups</span>
        <h3 class="font-headline-lg text-headline-lg text-primary uppercase tracking-widest">Asamblea</h3>
        <p class="font-body-md text-body-md text-on-surface-variant mt-2">No hay reunión local programada para esta semana.</p>
      </div>
    </div>`;
  }
  const rows = [];
  const presName = personNameOf(w.presidente);
  if (w.type === 'normal') {
    rows.push(['Presidente', presName, 'person']);
    rows.push(['Discurso Público', w.tituloDiscurso || '—', 'mic_external_on']);
    rows.push(['Orador', w.orador || '—', 'campaign']);
    rows.push(['Conductor Atalaya', personNameOf(w.conductor), 'menu_book']);
    rows.push(['Lector', personNameOf(w.lector), 'library_books']);
    rows.push(['Grupo de atención', deptNameOf(w.departamento), 'handshake']);
  } else if (w.type === 'supervisor') {
    rows.push(['Presidente', presName, 'person']);
    rows.push(['Discurso público', w.discursoSupervisor1 || '—', 'campaign']);
    rows.push(['Superintendente', w.nombreSupervisor || '—', 'supervisor_account']);
    rows.push(['Estudio (sin lectura)', personNameOf(w.estudioSinLectura), 'menu_book']);
    rows.push(['Discurso de servicio', w.discursoSupervisor2 || '—', 'campaign']);
  } else if (w.type === 'commemoration') {
    rows.push(['Discurso', w.tituloDiscurso || '—', 'mic_external_on']);
    rows.push(['Presidente', presName, 'person']);
    rows.push(['Orador', w.orador || '—', 'campaign']);
  }
  const rowsHtml = rows.map((r, idx) => `<div class="flex items-center justify-between py-2 ${idx < rows.length - 1 ? 'border-b border-outline-variant/20' : ''}">
    <div class="flex items-center gap-3"><span class="material-symbols-outlined text-on-surface-variant">${r[2]}</span><span class="font-label-md text-label-md text-on-surface-variant">${r[0]}</span></div>
    <span class="font-body-md text-body-md font-semibold text-on-surface text-right">${escapeHtml(r[1])}</span>
  </div>`).join('');
  const accent = w.type === 'normal' ? 'border-primary' : (w.type === 'supervisor' ? 'border-primary bg-primary-fixed/30' : 'border-secondary');
  return `<div class="week-card bg-surface-container-low border-l-4 ${accent} p-8 rounded-lg">
    <div class="flex justify-between items-start mb-6">
      <div>
        <div class="flex gap-2 items-center mb-3 flex-wrap">
          <span class="font-label-md text-label-md text-on-secondary-container bg-secondary-container px-3 py-1 rounded-full uppercase">Semana ${i + 1}</span>
          <span class="font-label-md text-label-md text-on-primary bg-primary px-3 py-1 rounded-full uppercase">${WEEK_TYPES[w.type].label}</span>
        </div>
        <h2 class="font-headline-lg text-headline-lg text-primary">${day} ${monthName}</h2>
      </div>
      <span class="material-symbols-outlined text-primary text-4xl">${icon}</span>
    </div>
    ${rowsHtml}
    ${previewLaboresBox(w)}
  </div>`;
}

function previewTabla() {
  const rows = state.month.weeks.map((w, i) => {
    const date = new Date(w.date + 'T00:00:00');
    const dateStr = date.toLocaleDateString('es', { day: '2-digit' });
    const dateAsam = date.toLocaleDateString('es', { day: '2-digit', month: 'long' });

    if (w.type === 'assembly' || w.type === 'commemoration') {
      const label = w.type === 'assembly' ? 'Asamblea' : 'Conmemoración';
      return `<tr class="transition-colors"><td class="p-4 bg-surface-variant/50 text-center" colspan="7">
        <div class="py-4">
          <div class="font-headline-md text-headline-md text-primary uppercase tracking-widest font-bold">${label} — ${dateAsam}</div>
        </div></td></tr>`;
    }
    let cells = {
      title: '—', chairman: '—', speaker: '—', conductor: '—', reader: '—', attendance: '—',
    };
    if (w.type === 'normal') {
      cells.title = escapeHtml(w.tituloDiscurso || '—');
      cells.chairman = escapeHtml(personNameOf(w.presidente));
      cells.speaker = escapeHtml(w.orador || '—');
      cells.conductor = escapeHtml(personNameOf(w.conductor));
      cells.reader = escapeHtml(personNameOf(w.lector));
      cells.attendance = escapeHtml(deptNameOf(w.departamento));
    } else if (w.type === 'supervisor') {
      cells.title = `${escapeHtml(w.discursoSupervisor1 || '—')}<div class="text-caption text-secondary mt-0.5">Discurso público</div>${w.discursoSupervisor2 ? `<div class="mt-1.5">${escapeHtml(w.discursoSupervisor2)}<div class="text-caption text-secondary">Discurso de servicio</div></div>` : ''}`;
      cells.chairman = escapeHtml(personNameOf(w.presidente));
      cells.speaker = `${escapeHtml(w.nombreSupervisor || '—')}<div class="text-caption text-on-surface-variant">Superintendente</div>`;
      cells.conductor = escapeHtml(personNameOf(w.estudioSinLectura));
      cells.reader = 'Sin lectura';
      cells.attendance = escapeHtml(deptNameOf(w.departamento));
    } else if (w.type === 'commemoration') {
      cells.title = escapeHtml(w.tituloDiscurso || '—');
      cells.chairman = escapeHtml(personNameOf(w.presidente));
      cells.speaker = escapeHtml(w.orador || '—');
      cells.conductor = '—';
      cells.reader = '—';
      cells.attendance = 'Conmemoración';
    }
    const big = w.type === 'assembly' || w.type === 'commemoration';
    const highlight = w.type !== 'normal' ? 'bg-secondary-container/10' : '';
    return `<tr class="transition-colors">
      <td class="p-4 align-top ${highlight}"><div class="font-body-md text-body-md text-primary font-semibold whitespace-nowrap ${big ? 'text-lg pt-3' : ''}">${dateStr}</div></td>
      <td class="p-4 align-top ${highlight}"><div class="font-body-md text-body-md ${big ? 'text-lg pt-3' : ''}">${cells.chairman}</div></td>
      <td class="p-4 align-top ${highlight} max-w-[340px]"><div class="font-body-md text-body-md text-primary leading-snug font-medium ${big ? 'text-lg pt-3' : ''}">${cells.title}</div></td>
      <td class="p-4 align-top ${highlight}"><div class="font-body-md text-body-md font-semibold ${big ? 'text-lg pt-3' : ''}">${cells.speaker}</div></td>
      <td class="p-4 align-top ${highlight}"><div class="font-body-md text-body-md ${big ? 'text-lg pt-3' : ''}">${cells.conductor}</div></td>
      <td class="p-4 align-top ${highlight}"><div class="font-body-md text-body-md ${big ? 'text-lg pt-3' : ''}">${cells.reader}</div></td>
      <td class="p-4 align-top ${highlight}"><div class="font-body-md text-body-md text-primary font-bold ${big ? 'text-lg pt-3' : ''}">${cells.attendance}</div></td>
    </tr>`;
  }).join('');
  return `<div class="tabla-programa overflow-x-auto">
    <table class="w-full text-left" style="border-collapse: separate; border-spacing: 0 0.75rem;">
      <colgroup>
        <col class="w-[6%]">
        <col class="w-[14%]">
        <col class="w-[28%]">
        <col class="w-[14%]">
        <col class="w-[14%]">
        <col class="w-[14%]">
        <col class="w-[10%]">
      </colgroup>
      <thead>
        <tr class="bg-surface-container-low border-b border-outline-variant">
          <th class="p-4 font-label-md text-label-md text-secondary uppercase">Fecha</th>
          <th class="p-4 font-label-md text-label-md text-secondary uppercase">Presidente</th>
          <th class="p-4 font-label-md text-label-md text-secondary uppercase">Discurso</th>
          <th class="p-4 font-label-md text-label-md text-secondary uppercase">Orador</th>
          <th class="p-4 font-label-md text-label-md text-secondary uppercase">Estudio</th>
          <th class="p-4 font-label-md text-label-md text-secondary uppercase">Lector</th>
          <th class="p-4 font-label-md text-label-md text-secondary uppercase">Grupo</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/* ---------- VISTA DE SALIDAS (programa separado) ---------- */
async function renderOutings() {
  if (!state.monthId) { go('home'); return; }
  const program = await db.getSalidas(state.monthId);
  if (!program) { toast('No hay programa de salidas para este mes', 'error'); go('salidas', { monthId: state.monthId }); return; }
  state.month = null;
  renderTop();
  state.month = { weeks: program.weeks, outings: program.congregations };
  const app = $('#app');
  const y = Number(state.monthId.slice(0, 4));
  const mes = Number(state.monthId.slice(5, 7));
  const outs = program.congregations || [];
  app.innerHTML = `
    <div class="mb-10 text-center md:text-left">
      <div class="flex items-center gap-3 mb-2 justify-center md:justify-start">
        <span class="editorial-line w-12 hidden md:block"></span>
        <p class="font-label-md text-label-md text-secondary uppercase tracking-widest">Programa de Salidas</p>
      </div>
      <h1 class="font-display-lg text-display-lg text-primary mb-2 leading-tight">${MONTHS_ES[mes - 1].toUpperCase()} ${y} — Salidas</h1>
      <p class="font-body-lg text-body-lg text-on-surface-variant max-w-2xl">Programa de oradores para las salidas a congregaciones. Revise antes de compartir.</p>
    </div>

    <div class="flex items-center justify-between gap-4 mb-6 no-print flex-wrap">
      <button id="btnEditOut" class="flex items-center gap-2 px-4 py-2 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-all active:scale-95">
        <span class="material-symbols-outlined text-[20px]">edit</span> Editar
      </button>
      <button id="btnPreviewOut" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:shadow-lg transition-all active:scale-95">
        <span class="material-symbols-outlined text-[20px]">visibility</span> Vista Final Programa
      </button>
    </div>

    <div id="outingsContent" class="bg-surface-container-lowest editorial-shadow rounded-xl border border-outline-variant p-4 md:p-8"></div>
  `;
  $('#btnEditOut').onclick = () => go('salidas', { monthId: state.monthId });
  $('#btnPreviewOut').onclick = () => go('preview', { monthId: state.monthId });
  renderOutingsContent();

  const bar = $('#actionBar');
  bar.classList.remove('hidden');
  bar.classList.add('no-print');
  bar.innerHTML = `<div class="max-w-container-max-width mx-auto flex flex-wrap justify-center md:justify-end gap-gutter">
    ${actionBtnOut('Imprimir', 'print', 'outPrint')}
    ${actionBtnOut('Exportar PDF', 'picture_as_pdf', 'outPdf')}
    ${actionBtnOut('Compartir', 'ios_share', 'outShare')}
    ${actionBtnOut('WhatsApp', 'share', 'outWa')}
    ${actionBtnOut('Guardar Imagen', 'image', 'outImg')}
  </div>`;
  $('#outPrint').onclick = () => window.print();
  $('#outPdf').onclick = () => window.print();
  $('#outShare').onclick = shareOutings;
  $('#outWa').onclick = waOutings;
  $('#outImg').onclick = imageOutings;
}

function actionBtnOut(label, icon, id) {
  return `<button id="${id}" class="flex items-center gap-2 px-5 py-2 rounded-lg border border-secondary text-secondary font-label-md text-label-md hover:bg-secondary-fixed transition-all active:scale-95">
    <span class="material-symbols-outlined text-[20px]">${icon}</span> ${label}
  </button>`;
}

function renderOutingsContent() {
  const c = $('#outingsContent');
  const m = state.month;
  const outs = m.outings || [];
  const congsHtml = outs.filter(c => c.nombre).map(c => {
    const diaLabel = c.dia === 'domingo' ? 'Domingos' : 'Sábados';
    return `<span class="inline-block px-3 py-1 bg-secondary-container text-on-secondary-container font-label-md text-label-md rounded-full">
      ${escapeHtml(c.nombre)} — ${diaLabel} ${c.hora || ''}
    </span>`;
  }).join(' ');
  const weekRows = m.weeks.map((w, i) => outingWeekRow(w, i)).join('');
  c.innerHTML = `
    <div class="mb-8 pb-6 border-b border-outline-variant">
      <h2 class="font-headline-md text-headline-md text-secondary mb-3">Congregaciones</h2>
      <div class="flex flex-wrap gap-2">${congsHtml || '<span class="text-on-surface-variant text-sm">Sin congregaciones</span>'}</div>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-left border-collapse min-w-[800px]">
        <thead>
          <tr class="bg-surface-container-low border-b border-outline-variant">
            <th class="p-4 font-label-md text-label-md text-secondary uppercase">Semana / Fecha</th>
            <th class="p-4 font-label-md text-label-md text-secondary uppercase">Orador</th>
            <th class="p-4 font-label-md text-label-md text-secondary uppercase">Discurso</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-outline-variant">${weekRows}</tbody>
      </table>
    </div>
  `;
}

function outingWeekRow(w, i) {
  const date = new Date(w.saturday + 'T00:00:00');
  const dateStr = date.toLocaleDateString('es', { day: '2-digit', month: 'long' });
  const outs = Array.isArray(w.outings) ? w.outings : [];
  const cells = outs.map((o, j) => {
    const orador = personNameOf(o.oradorSalida);
    const sep = j > 0 ? `<hr class="my-3 border-outline-variant/40">` : '';
    return `${sep}<div class="flex gap-3">
      <span class="font-label-md text-label-md text-secondary shrink-0 w-6">${j + 1}.</span>
      <div>
        <div class="font-body-md text-body-md font-semibold">${escapeHtml(orador)}</div>
        <div class="font-body-md text-body-md text-on-surface-variant">${escapeHtml(o.tituloDiscurso || '—')}</div>
      </div>
    </div>`;
  }).join('') || '<span class="text-on-surface-variant text-sm">Sin oradores asignados</span>';
  return `<tr class="table-row-hover transition-colors">
    <td class="p-6 align-top">
      <div class="font-headline-md text-headline-md text-primary mb-1">Semana ${i + 1}</div>
      <div class="font-body-md text-body-md text-on-surface-variant">${dateStr}</div>
    </td>
    <td class="p-6 align-top" colspan="2">${cells}</td>
  </tr>`;
}

function buildOutingsText() {
  const m = state.month;
  const outs = m.outings || [];
  const y = Number(state.monthId.slice(0, 4));
  const mes = Number(state.monthId.slice(5, 7));
  const lines = [];
  lines.push(`*Programa de Salidas - ${MONTHS_ES[mes - 1]} ${y}*`);
  const congs = outs.filter(c => c.nombre);
  if (congs.length) {
    lines.push('');
    lines.push('*Congregaciones:*');
    congs.forEach(c => {
      const dia = c.dia === 'domingo' ? 'Domingos' : 'Sábados';
      lines.push(`• ${c.nombre} — ${dia} ${c.hora || ''}`);
    });
  }
  m.weeks.forEach((w, i) => {
    const date = new Date(w.saturday + 'T00:00:00');
    const dateStr = date.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
    lines.push(`\n*Semana ${i + 1} — ${dateStr}*`);
    const ws = (w.outings || []);
    if (!ws.length) { lines.push('Sin oradores asignados'); return; }
    ws.forEach((o, j) => {
      lines.push(`${j + 1}. ${personNameOf(o.oradorSalida)} — ${o.tituloDiscurso || '—'}`);
    });
  });
  return lines.join('\n');
}

async function shareOutings() {
  const text = buildOutingsText();
  if (navigator.share) {
    try { await navigator.share({ title: 'Programa de Salidas', text }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('Programa copiado al portapapeles', 'success'); }
  catch { toast('No se pudo compartir', 'error'); }
}
function waOutings() {
  const text = buildOutingsText();
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}
async function imageOutings() {
  const node = $('#outingsContent');
  if (!node) return;
  toast('Generando imagen…', 'info');
  try { const blob = await nodeToPngBlob(node); downloadBlob(blob, `salidas-${state.month.id}.png`); toast('Imagen descargada', 'success'); }
  catch (err) { console.error(err); toast('No se pudo generar la imagen. Use Imprimir > Guardar como PDF.', 'error'); }
}

/* ---------- LISTAS: personas y grupos ---------- */
// Cargos de congregación (nivel del participante). Todos son publicadores por defecto.
const CARGOS = [
  { id: 'publicador',  label: 'Publicador',  nivel: 1 },
  { id: 'ministerial', label: 'Siervo Ministerial', nivel: 2 },
  { id: 'anciano',     label: 'Anciano',     nivel: 3 },
];
function cargoOf(p) {
  const c = Array.isArray(p.cargos) && p.cargos.length ? p.cargos[0] : 'publicador';
  return CARGOS.find(x => x.id === c) || CARGOS[0];
}
function cargosOpts(cur) {
  return CARGOS.map(c => `<option value="${c.id}" ${String(cur || 'publicador') === c.id ? 'selected' : ''}>${c.label}</option>`).join('');
}

const DEFAULT_LABORES = [
  { id: 'presidente',   label: 'Presidente' },
  { id: 'conductor1',   label: 'Cond. Atalaya' },
  { id: 'conductor2',   label: 'Cond. Libro' },
  { id: 'orador',       label: 'Orador' },
  { id: 'lector1',      label: 'Lector Atalaya' },
  { id: 'lector2',      label: 'Lector Libro' },
  { id: 'audio',        label: 'Sonido' },
  { id: 'microf',       label: 'Micrófono' },
  { id: 'plataforma',   label: 'Plataforma' },
  { id: 'acomodador',   label: 'Acomodador' },
  { id: 'asignacion1',  label: 'Lectura' },
  { id: 'asignacion2',  label: 'Presentación' },
  { id: 'asignacion3',  label: 'Discurso Estudiantil' },
  { id: 'asignacion4',  label: 'Discurso Reunión' },
];

async function renderLists() {
  state.month = null;
  renderTop();
  await refreshCatalogs();
  const app = $('#app');
  app.innerHTML = `
    <div class="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
      <div>
        <h1 class="font-headline-lg text-headline-lg text-primary mb-2">Personas y Grupos</h1>
        <p class="text-on-surface-variant font-body-md text-body-md">Asignar y gestionar responsabilidades del equipo.</p>
      </div>
      <div class="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
        <div class="flex bg-surface-container-high p-1 rounded-lg" id="listsTabs">
          <button data-tab="labores" class="px-4 py-2 font-label-md text-label-md rounded-md transition-colors ${state.listsTab === 'labores' ? 'bg-surface text-primary editorial-shadow' : 'text-on-surface-variant hover:bg-surface-container-highest'}">Labores</button>
          <button data-tab="historial" class="px-4 py-2 font-label-md text-label-md rounded-md transition-colors ${state.listsTab === 'historial' ? 'bg-surface text-primary editorial-shadow' : 'text-on-surface-variant hover:bg-surface-container-highest'}">Historial</button>
        </div>
        <div class="relative w-full sm:w-64">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline" data-icon="search">search</span>
          <input id="pSearch" class="w-full bg-surface-container-low border border-outline-variant rounded-full py-2 pl-10 pr-4 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-body-md font-body-md" placeholder="Buscar miembro..." type="text">
        </div>
        <div class="relative w-full sm:w-40">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline" data-icon="filter">filter_alt</span>
          <select id="pGenderFilter" class="w-full bg-surface-container-low border border-outline-variant rounded-full py-2 pl-10 pr-4 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-body-md font-body-md ${state.listsTab === 'historial' ? 'hidden' : ''}">
            <option value="">Todos</option>
            <option value="masculino">Hombre</option>
            <option value="femenino">Mujer</option>
          </select>
        </div>
        <div class="relative w-full sm:w-44">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline" data-icon="badge">badge</span>
          <select id="pCargoFilter" class="w-full bg-surface-container-low border border-outline-variant rounded-full py-2 pl-10 pr-4 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-body-md font-body-md ${state.listsTab === 'historial' ? 'hidden' : ''}">
            <option value="">Todos los cargos</option>
            ${CARGOS.map(c => `<option value="${c.id}">${c.label}</option>`).join('')}
          </select>
        </div>
        <button data-admin class="whitespace-nowrap flex items-center justify-center gap-2 border border-primary text-primary w-full sm:w-auto px-4 py-2 rounded-lg font-label-md text-label-md hover:bg-surface-container-high transition-colors ${state.listsTab === 'historial' ? 'hidden' : ''}" id="toggleEditMode">
          <span class="material-symbols-outlined text-[18px]">lock_open</span>
          <span id="editText">Desbloquear</span>
        </button>
        <button data-admin class="whitespace-nowrap flex items-center justify-center gap-2 border ${state.listsShowInactive ? 'bg-secondary-container text-on-secondary-container border-secondary-container' : 'border-outline text-on-surface-variant'} w-full sm:w-auto px-4 py-2 rounded-lg font-label-md text-label-md hover:bg-surface-container-high transition-colors ${state.listsTab === 'historial' ? 'hidden' : ''}" id="toggleInactive">
          <span class="material-symbols-outlined text-[18px]">history_toggle_off</span>
          <span>${state.listsShowInactive ? 'Ocultar desactivados' : 'Ver desactivados'}</span>
        </button>
      </div>
    </div>

    <div id="quickLaboresWrap" class="${state.listsTab === 'historial' ? 'hidden' : ''} flex flex-wrap items-center gap-2 mb-4">
      <span class="font-label-md text-label-md text-on-surface-variant">Marcar labor en todos:</span>
      ${state.labores.map(r => `<button type="button" data-quicklabore="${r.id}" class="quick-chip" title="Marcar/desmarcar ${escapeAttr(r.label)} en las visibles">${escapeHtml(r.label)}</button>`).join('')}
    </div>

    <div class="bg-surface-container-lowest rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.04)] border border-outline-variant overflow-hidden">
      <div id="pList" class="overflow-auto max-h-[68vh] p-3 sm:p-4 grid grid-cols-1 xl:grid-cols-2 gap-3 content-start"></div>
    </div>

    <div class="mt-6 flex justify-between flex-wrap gap-3">
      <div class="flex flex-wrap gap-3">
        <button id="manageLaboresBtn" data-admin class="bg-surface-container-low text-on-surface-variant px-4 py-2 rounded-lg font-label-md text-label-md hover:bg-surface-variant transition-colors flex items-center gap-2">
          <span class="material-symbols-outlined text-[18px]">manage_accounts</span> Gestionar Labores
        </button>
      </div>
      <button id="addMemberBtn" data-admin class="bg-primary text-on-primary px-4 py-2 rounded-lg font-label-md text-label-md hover:opacity-90 transition-opacity flex items-center gap-2">
        <span class="material-symbols-outlined text-[18px]">add</span> Añadir Miembro
      </button>
    </div>
  `;

  $('#listsTabs').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.listsTab = b.dataset.tab; renderLists(); });

  if (state.listsTab === 'historial') {
    renderListsHistorial();
    return;
  }

  app.querySelectorAll('[data-quicklabore]').forEach(btn => btn.onclick = async () => {
    await applyLaboreToVisible(btn.dataset.quicklabore);
  });

  let editMode = false;
  const toggleBtn = $('#toggleEditMode');
  toggleBtn.onclick = () => {
    editMode = !editMode;
    if (editMode) {
      toggleBtn.classList.remove('border-primary', 'text-primary');
      toggleBtn.classList.add('bg-primary', 'text-on-primary', 'hover:bg-primary/90');
      toggleBtn.lastElementChild.textContent = 'Guardar y Bloquear';
      $('#pList').querySelectorAll('.labor-chip').forEach(cb => { if (!cb.hasAttribute('data-locked')) cb.disabled = false; });
    } else {
      toggleBtn.classList.add('border-primary', 'text-primary');
      toggleBtn.classList.remove('bg-primary', 'text-on-primary', 'hover:bg-primary/90');
      toggleBtn.lastElementChild.textContent = 'Desbloquear';
      $('#pList').querySelectorAll('.labor-chip').forEach(cb => cb.disabled = true);
    }
  };
  $('#addMemberBtn').onclick = openAddMemberModal;

  $('#manageLaboresBtn').onclick = renderLaboresModal;
  $('#toggleInactive').onclick = () => { state.listsShowInactive = !state.listsShowInactive; renderLists(); };

  const search = $('#pSearch');
  const genderFilter = $('#pGenderFilter');
  const cargoFilter = $('#pCargoFilter');
  const applyFilter = () => {
    const q = normalizeStr(search.value);
    const gen = genderFilter.value;
    const cargo = cargoFilter.value;
    document.querySelectorAll('#pList .person-card').forEach(card => {
      const matchName = card.dataset.norm.includes(q);
      const matchGen = !gen || card.dataset.genero === gen;
      const matchCargo = !cargo || card.dataset.cargo === cargo;
      card.classList.toggle('is-hidden', !(matchName && matchGen && matchCargo));
    });
  };
  search.addEventListener('input', applyFilter);
  genderFilter.addEventListener('change', applyFilter);
  cargoFilter.addEventListener('change', applyFilter);

  const pList = $('#pList');
  const inactivos = state.listsShowInactive ? await db.listPeopleInactive() : [];
  const cards = [
    ...state.people.map(p => renderPersonCard(p, editMode, false)),
    ...inactivos.map(p => renderPersonCard(p, false, true)),
  ];
  pList.innerHTML = cards.length
    ? cards.join('')
    : `<div class="col-span-full p-6 text-center text-on-surface-variant text-sm">Sin personas. Añada un miembro para comenzar.</div>`;
  renderPersonCardBindings(editMode);
}

// Marca o desmarca una labor en todas las personas visibles (respeta el filtro
// de búsqueda/género y la regla de género por labor).
async function applyLaboreToVisible(labore) {
  const visibleCards = [...document.querySelectorAll('#pList .person-card')].filter(c => !c.classList.contains('is-hidden'));
  const ids = new Set(visibleCards.map(c => c.dataset.pid).filter(Boolean));
  const visible = state.people.filter(p => ids.has(String(p.id)) && laboreAllowedForPerson(p, labore));
  if (!visible.length) { toast('No hay personas visibles para esa labor', 'info'); return; }
  const add = visible.some(p => !(Array.isArray(p.labores) && p.labores.includes(labore)));
  for (const p of visible) {
    const labores = Array.isArray(p.labores) ? [...p.labores] : [];
    if (add) { if (!labores.includes(labore)) labores.push(labore); }
    else { const i = labores.indexOf(labore); if (i !== -1) labores.splice(i, 1); }
    await db.setPersonLabores(p.id, labores);
    p.labores = labores;
    const chip = document.querySelector(`#pList .labor-chip[data-pid="${p.id}"][data-plabore="${labore}"]`);
    if (chip) setChipOn(chip, add);
  }
  const lbl = (state.labores.find(r => r.id === labore) || {}).label || labore;
  toast(add ? `"${lbl}" marcado en ${visible.length} visible(s)` : `"${lbl}" desmarcado en ${visible.length} visible(s)`, 'success');
}

// Refleja el estado "asignado" de un chip de labor en sus clases CSS.
function setChipOn(chip, on) {
  chip.classList.toggle('is-on', on);
}

// Modal para añadir un miembro (usado en la vista Personas, tab Labores e Historial).
function openAddMemberModal() {
  openModal(`
  <div class="text-center">
    <span class="material-symbols-outlined text-6xl text-primary mb-2">person_add</span>
    <h3 class="font-headline-md text-headline-md text-primary mb-4">Añadir Miembro</h3>
    <form id="mdForm" class="space-y-4">
      <input id="mdName" type="text" placeholder="Nombre completo" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary" autocomplete="off">
      ${personAttrsFields()}
      <div class="flex flex-wrap justify-center gap-2" id="mdLabores"></div>
      <div class="flex gap-3 justify-center pt-2">
        <button type="button" id="mdCancel2" class="px-5 py-2.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cancelar</button>
        <button type="submit" class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Agregar</button>
      </div>
    </form>
  </div>`);
  $('#mdLabores').innerHTML = state.labores.map(r =>
    `<label class="flex items-center gap-1.5 cursor-pointer text-[12px] font-label-md text-on-surface-variant"><input type="checkbox" data-mr="${r.id}" class="text-primary accent-primary"> ${r.label}</label>`
  ).join('');
  $('#mdCancel2').onclick = closeModal;
  $('#mdForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#mdName').value.trim();
    if (!name) { toast('Escribe un nombre', 'error'); return; }
    const labores = Array.from(document.querySelectorAll('[data-mr]:checked')).map(c => c.dataset.mr);
    const attrs = readPersonAttrs();
    try {
      const newId = await db.addPerson({ name, labores, ...attrs });
      // Enlace bidireccional: si el nuevo miembro no es D y tiene enlace, la
      // persona enlazada pasa a tenerlo como enlace a él.
      if (attrs.enlace && attrs.calificacion !== 'D') {
        const target = state.people.find(x => String(x.id) === String(attrs.enlace));
        if (target && target.calificacion !== 'D') {
          target.enlace = String(newId);
          await db.updatePerson(target);
        }
      }
      closeModal(); toast('Miembro agregado', 'success'); renderLists();
    } catch (err) { toast(err.message, 'error'); }
  };
}

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
}

function avatarClassFor(name) {
  let s = 0;
  for (const ch of String(name)) s += ch.charCodeAt(0);
  return s % 2 ? 'bg-secondary-container text-on-secondary-container' : 'bg-primary-container text-on-primary-container';
}

// Mapa de labores a categoría para la presentación en 3 columnas.
// La presidencia aparece en ambas columnas (ES y FS) porque son cargos distintos.
const LABOR_CATEGORY = {
  // Entre semana
  presidente: 'es',
  asignacion1: 'es',
  asignacion2: 'es',
  asignacion3: 'es',
  asignacion4: 'es',
  conductor2: 'es',
  lector2: 'es',
  // Fin de semana
  conductor1: 'fs',
  lector1: 'fs',
  orador: 'fs',
  // Servicio / Acomodación
  audio: 'svc',
  microf: 'svc',
  plataforma: 'svc',
  acomodador: 'svc',
};

function laborChipMarkup(p, r, editMode) {
  const on = Array.isArray(p.labores) && p.labores.includes(r.id);
  const locked = !laboreAllowedForPerson(p, r.id);
  const cls = ['labor-chip'];
  if (on) cls.push('is-on');
  if (locked) cls.push('is-locked');
  const dis = (locked || !editMode) ? 'disabled' : '';
  const lockTitle = locked ? ' (no permitido para este género)' : '';
  return `<button type="button" data-plabore="${r.id}" data-pid="${p.id}" class="${cls.join(' ')}" ${dis} title="${escapeAttr(r.label)}${lockTitle}">${escapeHtml(r.label)}</button>`;
}

function renderLaborColumns(p, editMode) {
  const labores = Array.isArray(p.labores) ? p.labores : [];
  const cats = { es: [], fs: [], svc: [] };
  state.labores.forEach(r => {
    const cat = LABOR_CATEGORY[r.id];
    if (cat) cats[cat].push(r);
  });
  // La presidencia aparece en ambas columnas (ES y FS) porque son cargos distintos.
  const pres = state.labores.find(r => r.id === 'presidente');
  if (pres && !cats.es.includes(pres)) cats.es.push(pres);
  if (pres && !cats.fs.includes(pres)) cats.fs.push(pres);
  const col = (catKey, title) => {
    const items = cats[catKey].map(r => laborChipMarkup(p, r, editMode)).join('');
    if (!items) return '';
    return `<div class="flex flex-col gap-1.5 min-w-0 flex-1">
      <span class="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">${title}</span>
      <div class="flex flex-wrap gap-1.5">${items}</div>
    </div>`;
  };
  return `<div class="grid grid-cols-3 gap-3 mt-3">${col('es', 'Entre semana')}${col('fs', 'Fin de semana')}${col('svc', 'Servicio')}</div>`;
}

// Tarjeta de persona (vista Personas y Grupos → Labores). El nombre es el
// elemento principal; sus labores se muestran como chips conmutables. Si la
// persona está desactivada (borrado lógico) se muestra atenuada con botón
// de restauración.
function renderPersonCard(p, editMode, isInactive = false) {
  const gen = p.genero === 'femenino' ? 'Femenino' : p.genero === 'masculino' ? 'Masculino' : '—';
  const cal = CALIFICACIONES.includes(p.calificacion) ? p.calificacion : '';
  const cargo = cargoOf(p);
  const badges = [];
  if (cargo.id !== 'publicador') badges.push(`<span class="px-2 py-0.5 rounded-full bg-primary-fixed text-primary text-[11px] font-label-md">${cargo.label}</span>`);
  if (p.genero) badges.push(`<span class="px-2 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant text-[11px] font-label-md">${gen}</span>`);
  if (cal) badges.push(`<span class="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[11px] font-label-md">Cal. ${cal}</span>`);
  if (p.enlace) badges.push(`<span class="px-2 py-0.5 rounded-full bg-primary-container text-on-primary-container text-[11px] font-label-md">Enlazado</span>`);
  if (isInactive) badges.push(`<span class="px-2 py-0.5 rounded-full bg-error-container text-error text-[11px] font-label-md">Desactivada</span>`);
  const actions = isInactive
    ? `
      <button data-prestore="${p.id}" class="p-1.5 rounded-lg text-primary hover:bg-primary-fixed" title="Restaurar"><span class="material-symbols-outlined text-[18px]">undo</span></button>`
    : `
      <button data-profile="${p.id}" class="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-variant" title="Ver perfil"><span class="material-symbols-outlined text-[18px]">account_circle</span></button>
      <button data-markall="${p.id}" class="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-variant" title="Marcar/desmarcar todas las labores"><span class="material-symbols-outlined text-[18px]">select_all</span></button>
      <button data-pdel="${p.id}" data-admin class="p-1.5 rounded-lg text-error hover:bg-error-container" title="Quitar de la lista"><span class="material-symbols-outlined text-[18px]">delete</span></button>`;
  return `<div class="person-card ${isInactive ? 'is-inactive' : ''}" data-norm="${escapeAttr(normalizeStr(p.name))}" data-genero="${escapeAttr(p.genero || '')}" data-cargo="${escapeAttr(cargoOf(p).id)}" data-pid="${p.id}">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-full ${avatarClassFor(p.name)} flex items-center justify-center font-label-md text-label-md font-bold shrink-0">${initialsOf(p.name)}</div>
      <div class="min-w-0 flex-1">
        <p class="font-body-md text-body-md font-semibold text-on-surface truncate">${escapeHtml(p.name)}</p>
        <div class="flex flex-wrap gap-1.5 mt-1">${badges.join('') || '<span class="text-[11px] text-on-surface-variant/60">Sin datos</span>'}</div>
      </div>
      <div class="flex items-center gap-0.5 shrink-0">${actions}</div>
    </div>
    ${renderLaborColumns(p, isInactive ? false : editMode)}
  </div>`;
}

function renderPersonCardBindings(editMode) {
  $('#pList').querySelectorAll('[data-profile]').forEach(b => b.onclick = () => {
    const person = state.people.find(x => String(x.id) === String(b.dataset.profile));
    if (person) openPersonProfile(person);
  });
  $('#pList').querySelectorAll('[data-markall]').forEach(b => b.onclick = async () => {
    const card = b.closest('.person-card');
    const chips = [...card.querySelectorAll('.labor-chip')];
    if (chips.length && chips[0].disabled) { toast('Desbloquea la edición primero', 'info'); return; }
    const pid = parseInt(b.dataset.markall, 10);
    const person = state.people.find(x => String(x.id) === String(pid));
    if (!person) return;
    const anyUnchecked = chips.some(c => !c.classList.contains('is-on'));
    const labores = anyUnchecked ? state.labores.filter(r => laboreAllowedForPerson(person, r.id)).map(r => r.id) : [];
    await db.setPersonLabores(pid, labores);
    person.labores = labores;
    chips.forEach(c => { if (!c.hasAttribute('data-locked')) setChipOn(c, anyUnchecked); });
    toast(anyUnchecked ? 'Todas las labores marcadas' : 'Labores desmarcadas', 'success');
  });
  $('#pList').querySelectorAll('[data-prestore]').forEach(b => b.onclick = async () => {
    if (await confirmDialog('¿Restaurar esta persona? Volverá a aparecer en las listas y podrá recibir asignaciones.')) {
      await db.restorePerson(b.dataset.prestore);
      renderLists();
    }
  });
  $('#pList').querySelectorAll('[data-pdel]').forEach(b => b.onclick = async () => {
    if (await confirmDialog('¿Quitar a esta persona? No recibirá más asignaciones y quedará oculta; su historial se conserva y puede restaurarse después.')) { await db.deletePerson(b.dataset.pdel); renderLists(); }
  });
  $('#pList').querySelectorAll('.labor-chip').forEach(cb => cb.onclick = async () => {
    if (cb.disabled) return;
    const pid = parseInt(cb.dataset.pid, 10);
    const labore = cb.dataset.plabore;
    const person = state.people.find(x => String(x.id) === String(pid));
    if (!person) return;
    const labores = Array.isArray(person.labores) ? [...person.labores] : [];
    const idx = labores.indexOf(labore);
    const willOn = idx === -1;
    if (willOn) labores.push(labore);
    else labores.splice(idx, 1);
    await db.setPersonLabores(pid, labores);
    person.labores = labores;
    setChipOn(cb, willOn);
  });
}

/* ---------- Vista Historial de asignaciones (Personas) ---------- */
// Consulta quién recibió una asignación hace más tiempo y métricas por persona.
// Columnas: asignaciones último mes, promedio por mes, puede dar (tiene labor)
// pero no le ha tocado, última asignación y total.
async function renderListsHistorial() {
  const pList = $('#pList');
  pList.className = 'overflow-auto max-h-[68vh] p-0';
  pList.innerHTML = '<div class="p-6 text-center text-on-surface-variant text-sm">Cargando historial…</div>';

  const log = await db.listAssignmentLog();
  const metrics = assignmentMetrics(log, state.people, state.labores)
    .sort((a, b) => (a.lastDate || '') < (b.lastDate || '') ? -1 : ((a.lastDate || '') > (b.lastDate || '') ? 1 : 0));

  const labelOfLabore = (rid) => (state.labores.find(r => String(r.id) === String(rid)) || {}).label || rid;
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return `${d.getDate()} ${MONTHS_ES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
  };

  const rows = metrics.map(m => {
    const canGive = m.canGiveButNot.length
      ? m.canGiveButNot.map(labelOfLabore).join(', ')
      : '<span class="text-on-surface-variant/60">—</span>';
    return `<tr class="hover:bg-surface-container-low transition-colors" data-norm="${escapeAttr(normalizeStr(m.name))}">
      <td class="p-4 font-body-md text-body-md font-medium text-on-surface flex items-center gap-3 sticky left-0 bg-surface-container-lowest group-hover:bg-surface-container-low transition-colors z-10">
        <div class="w-8 h-8 rounded-full ${avatarClassFor(m.name)} flex items-center justify-center font-label-md text-label-md font-bold shrink-0">${initialsOf(m.name)}</div>
        <span class="truncate">${escapeHtml(m.name)}</span>
      </td>
      <td class="p-4 text-center font-body-md text-body-md ${m.lastMonth ? 'text-primary font-semibold' : 'text-on-surface-variant'}">${m.lastMonth}</td>
      <td class="p-4 text-center font-body-md text-body-md text-on-surface">${m.perMonth.toFixed(1)}</td>
      <td class="p-4 text-center font-body-md text-body-md text-on-surface">${m.total}</td>
      <td class="p-4 font-body-md text-body-md text-on-surface-variant max-w-[280px] truncate" title="${escapeAttr(canGive)}">${canGive}</td>
      <td class="p-4 text-center font-body-md text-body-md text-on-surface whitespace-nowrap">${fmtDate(m.lastDate)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="p-6 text-center text-on-surface-variant text-sm">Sin asignaciones registradas todavía. Guarde o automatice programas para empezar a llevar el historial.</td></tr>';

  pList.innerHTML = `
    <table class="w-full text-left border-collapse">
      <thead>
        <tr class="bg-surface-container border-b border-outline-variant">
          <th class="p-4 font-label-md text-label-md text-on-surface-variant sticky left-0 top-0 bg-surface-container z-30 min-w-[200px]">Miembro</th>
          <th class="p-4 font-label-md text-label-md text-on-surface-variant text-center whitespace-nowrap" title="Cantidad de asignaciones en los últimos 30 días">Último mes</th>
          <th class="p-4 font-label-md text-label-md text-on-surface-variant text-center whitespace-nowrap" title="Promedio de asignaciones por mes">Promedio / mes</th>
          <th class="p-4 font-label-md text-label-md text-on-surface-variant text-center whitespace-nowrap" title="Total de asignaciones registradas">Total</th>
          <th class="p-4 font-label-md text-label-md text-on-surface-variant text-left" title="Labores que puede dar (las tiene) pero aún no le han tocado">Puede dar, no le ha tocado</th>
          <th class="p-4 font-label-md text-label-md text-on-surface-variant text-center whitespace-nowrap" title="Fecha de su última asignación (orden ascendente = hace más tiempo)">Última asignación</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant/50">${rows}</tbody>
    </table>`;

  const search = $('#pSearch');
  if (search) search.addEventListener('input', () => {
    const q = normalizeStr(search.value);
    document.querySelectorAll('#pList tbody tr').forEach(tr => {
      tr.style.display = tr.dataset.norm.includes(q) ? '' : 'none';
    });
  });

  $('#manageLaboresBtn').onclick = renderLaboresModal;
  $('#addMemberBtn').onclick = openAddMemberModal;
}

/* ---------- Atributos de colaborador (género, calificación, enlace) ---------- */
const GENEROS = [['', '—'], ['masculino', 'Masculino'], ['femenino', 'Femenino']];

// Campos de atributos para los modales (añadir/editar persona).
function personAttrsFields() {
  return `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
      <div>
        <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Género</label>
        <select data-attr="genero" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          ${GENEROS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Calificación</label>
        <select data-attr="calificacion" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          ${CALIFICACIONES.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Cargo</label>
        <select data-attr="cargo" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          ${cargosOpts('publicador')}
        </select>
      </div>
    </div>
    <div class="text-left">
      <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Enlace (pareja designada)</label>
      <select data-attr="enlace" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
        <option value="">— Sin enlace —</option>
        ${state.people.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
      </select>
      <p class="text-on-surface-variant text-caption mt-1">Si la calificación es D, solo podrá tener asignación en pareja con la persona enlazada (enlace unidireccional). En cualquier otro caso el enlace es mutuo: la persona enlazada también quedará enlazada a él.</p>
    </div>`;
}

// Lee los atributos de los campos data-attr del modal actual.
function readPersonAttrs() {
  const genero = (document.querySelector('[data-attr="genero"]') || {}).value || '';
  const calificacion = (document.querySelector('[data-attr="calificacion"]') || {}).value || '';
  const enlace = (document.querySelector('[data-attr="enlace"]') || {}).value || '';
  const cargo = (document.querySelector('[data-attr="cargo"]') || {}).value || 'publicador';
  return { genero, calificacion, enlace, cargo };
}

// Aplica el enlace de pareja con la regla de direccionalidad:
//  · Persona NO D → bidireccional: la otra persona también pasa a tener como
//    enlace a esta (y se limpia el reflejo previo si el enlace anterior era mutuo).
//  · Persona D → unidireccional: solo cambia su propio enlace, no toca al otro
//    (así un D puede tener a Juan como enlace aunque Juan conserve a María).
async function applyEnlace(person, newEnlace) {
  const oldEnlace = person.enlace || '';
  const newVal = newEnlace || '';
  const isD = person.calificacion === 'D';

  // Si se rompe un enlace anterior que era mutuo (el otro apuntaba a esta
  // persona), limpiar el reflejo.
  if (oldEnlace && oldEnlace !== newVal) {
    const oldT = state.people.find(x => String(x.id) === String(oldEnlace));
    if (oldT && String(oldT.enlace || '') === String(person.id) && oldT.calificacion !== 'D') {
      oldT.enlace = '';
      await db.updatePerson(oldT);
    }
  }

  person.enlace = newVal;
  await db.updatePerson(person);

  if (!isD && newVal) {
    const target = state.people.find(x => String(x.id) === String(newVal));
    if (target) {
      // Si el destino ya apuntaba a otro (enlace mutuo), limpiar ese reflejo viejo.
      const prevT = String(target.enlace || '');
      if (prevT && String(prevT) !== String(person.id)) {
        const prevTarget = state.people.find(x => String(x.id) === String(prevT));
        if (prevTarget && String(prevTarget.enlace || '') === String(target.id) && prevTarget.calificacion !== 'D') {
          prevTarget.enlace = '';
          await db.updatePerson(prevTarget);
        }
      }
      // El destino (si no es D) apunta de vuelta a esta persona.
      if (target.calificacion !== 'D') {
        target.enlace = String(person.id);
        await db.updatePerson(target);
      }
    }
  }
}

// Modal de perfil de un colaborador: nombre, género, calificación (A/B/C/D),
// enlace, labores conmutables e historial de asignaciones.
async function openPersonProfile(person) {
  const p = { ...person };
  p.labores = Array.isArray(p.labores) ? p.labores : [];
  const cal = CALIFICACIONES.includes(p.calificacion) ? p.calificacion : 'A';
  const genOpts = GENEROS.map(([v, l]) => `<option value="${v}" ${p.genero === v ? 'selected' : ''}>${l}</option>`).join('');
  const calOpts = CALIFICACIONES.map(c => `<option value="${c}" ${cal === c ? 'selected' : ''}>${c}${c === 'D' ? ' (enlace)' : ''}</option>`).join('');
  const enlOpts = `<option value="">— Sin enlace —</option>` +
    state.people.filter(x => String(x.id) !== String(p.id)).map(x => `<option value="${x.id}" ${p.enlace === String(x.id) ? 'selected' : ''}>${escapeHtml(x.name)}</option>`).join('');
  const laborCols = renderLaborColumns(p, true);
  openModal(`
    <div>
      <div class="flex items-start gap-3 mb-4">
        <div class="w-12 h-12 rounded-full ${avatarClassFor(p.name)} flex items-center justify-center font-headline-md text-headline-md font-bold shrink-0">${initialsOf(p.name)}</div>
        <div class="flex-1 min-w-0">
          <input id="pfName" type="text" value="${escapeAttr(p.name)}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2 font-headline-md text-headline-md text-primary focus:border-primary" autocomplete="off">
          <p class="text-on-surface-variant text-sm mt-1">${p.genero === 'femenino' ? 'Femenino' : p.genero === 'masculino' ? 'Masculino' : 'Colaborador'} · ${cargoOf(p).label} · Calificación ${cal}${p.enlace ? ' · Enlazado' : ''}</p>
        </div>
      </div>
      <div class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Género</label>
            <select id="pfGenero" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${genOpts}</select>
          </div>
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Calificación</label>
            <select id="pfCalif" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${calOpts}</select>
          </div>
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Cargo</label>
            <select id="pfCargo" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${cargosOpts(cargoOf(p).id)}</select>
          </div>
        </div>
        <div>
          <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Enlace (pareja designada)</label>
          <select id="pfEnlace" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${enlOpts}</select>
          <p class="text-on-surface-variant text-caption mt-1">Si la calificación es D, solo podrá tener asignación en pareja con la persona enlazada (enlace unidireccional). En cualquier otro caso el enlace es mutuo: la persona enlazada también quedará enlazada a él.</p>
        </div>
        <div>
          <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Labores asignadas</label>
          <div id="pfLabores">${laborCols}</div>
        </div>
        <div>
          <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Historial de asignaciones</label>
          <div id="pfHistory" class="max-h-52 overflow-y-auto rounded-lg border border-outline-variant bg-surface-bright px-3">Cargando…</div>
        </div>
      </div>
      <div class="flex gap-3 justify-end mt-5">
        <button id="pfCancel" class="px-5 py-2.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cerrar</button>
        <button id="pfSave" class="px-6 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Guardar</button>
      </div>
    </div>`);

  $('#pfHistory').innerHTML = await personHistoryMarkup(p.id);

  $('#pfLabores').querySelectorAll('.labor-chip').forEach(cb => cb.onclick = () => {
    if (cb.disabled) return;
    cb.classList.toggle('is-on');
  });

  $('#pfCancel').onclick = closeModal;
  $('#pfSave').onclick = async () => {
    p.name = ($('#pfName').value || '').trim() || p.name;
    p.genero = $('#pfGenero').value;
    p.calificacion = $('#pfCalif').value;
    p.cargo = $('#pfCargo').value;
    p.cargos = [p.cargo];
    p.labores = [...$('#pfLabores').querySelectorAll('.labor-chip.is-on')].map(c => c.dataset.plabore);
    await applyEnlace(p, $('#pfEnlace').value);
    const orig = state.people.find(x => String(x.id) === String(p.id));
    if (orig) Object.assign(orig, p);
    closeModal();
    toast('Perfil actualizado', 'success');
    renderLists();
  };
}

// Construye el historial de asignaciones de una persona a partir del log.
async function personHistoryMarkup(personId) {
  const log = await db.listAssignmentLog();
  const entries = (log || [])
    .filter(e => String(e.personId) === String(personId))
    .sort((a, b) => (b.date || '') < (a.date || '') ? -1 : ((b.date || '') > (a.date || '') ? 1 : 0))
    .slice(0, 20);
  if (!entries.length) return '<p class="py-4 text-center text-on-surface-variant text-sm">Sin asignaciones registradas todavía.</p>';
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return `${d.getDate()} ${MONTHS_ES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
  };
  return entries.map(e => `
    <div class="hist-row">
      <span class="material-symbols-outlined text-[18px] text-on-surface-variant shrink-0">event</span>
      <div class="min-w-0 flex-1">
        <p class="font-body-md text-body-md text-on-surface truncate">${escapeHtml(e.roleLabel || e.roleKey || 'Asignación')}</p>
        <p class="text-caption text-on-surface-variant truncate">${escapeHtml(e.program || '')}</p>
      </div>
      <span class="text-body-md text-on-surface-variant whitespace-nowrap shrink-0">${fmtDate(e.date)}</span>
    </div>`).join('');
}

function renderLaboresModal() {
  openModal(`
    <h3 class="font-headline-md text-headline-md text-primary mb-2">Labores del equipo</h3>
    <p class="text-on-surface-variant font-body-md text-body-md mb-4">Cree, renombre o elimine las labores que se asignan a los miembros.</p>
    <form id="rForm" class="flex gap-2 mb-4">
      <input id="rName" type="text" placeholder="Nueva labor (p. ej. Sonido)" class="flex-1 bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
      <button class="px-4 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 whitespace-nowrap">Agregar</button>
    </form>
    <ul id="rList" class="divide-y divide-outline-variant max-h-80 overflow-y-auto"></ul>
    <button id="mdCloseR" class="mt-5 w-full px-5 py-2.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cerrar</button>
  `);
  $('#rList').innerHTML = state.labores.map(r => `<li class="flex items-center justify-between py-3 gap-3 group">
    <span class="font-body-md text-body-md">${escapeHtml(r.label)}</span>
    <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button data-redit="${r.id}" class="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-variant" title="Renombrar"><span class="material-symbols-outlined text-[18px]">edit</span></button>
      <button data-rdel="${r.id}" class="p-1.5 rounded-lg text-error hover:bg-error-container" title="Eliminar"><span class="material-symbols-outlined text-[18px]">delete</span></button>
    </div>
  </li>`).join('') || `<li class="py-3 text-on-surface-variant text-sm">Sin labores.</li>`;
  $('#rList').querySelectorAll('[data-redit]').forEach(b => b.onclick = () => editLaboreModal(b.dataset.redit));
  $('#rList').querySelectorAll('[data-rdel]').forEach(b => b.onclick = async () => {
    const id = b.dataset.rdel;
    const labore = state.labores.find(r => r.id === id);
    if (!labore) return;
    if (!await confirmDialog(`¿Eliminar la labor "${labore.label}"? Se quitará de todos los miembros.`, 'Eliminar')) return;
    state.labores = state.labores.filter(r => r.id !== id);
    await db.setLabores(state.labores);
    for (const p of state.people) {
      if (Array.isArray(p.labores) && p.labores.includes(id)) {
        p.labores = p.labores.filter(x => x !== id);
        await db.setPersonLabores(p.id, p.labores);
      }
    }
    toast('Labor eliminada', 'success');
    renderLaboresModal();
  });
  $('#rForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#rName').value.trim();
    if (!name) { toast('Escribe un nombre', 'error'); return; }
    if (state.labores.some(r => r.label.toLowerCase() === name.toLowerCase())) { toast('Esa labor ya existe', 'error'); return; }
    state.labores.push({ id: 'labore_' + cryptoId(), label: name });
    await db.setLabores(state.labores);
    toast('Labor agregada', 'success');
    renderLaboresModal();
  };
  $('#mdCloseR').onclick = () => { closeModal(); renderLists(); };
}

function editLaboreModal(id) {
  const labore = state.labores.find(r => r.id === id);
  if (!labore) return;
  openModal(`
    <h3 class="font-headline-md text-headline-md text-primary mb-4">Renombrar labor</h3>
    <input id="editRName" type="text" value="${escapeAttr(labore.label)}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary mb-4">
    <div class="flex gap-3 justify-end">
      <button id="editRCancel" class="px-4 py-2 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cancelar</button>
      <button id="editROk" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Guardar</button>
    </div>
  `);
  const save = async () => {
    const name = $('#editRName').value.trim();
    if (!name) { toast('Escribe un nombre', 'error'); return; }
    if (state.labores.some(r => r.id !== id && r.label.toLowerCase() === name.toLowerCase())) { toast('Esa labor ya existe', 'error'); return; }
    labore.label = name;
    await db.setLabores(state.labores);
    toast('Labor actualizada', 'success');
    closeModal();
    renderLaboresModal();
  };
  $('#editRCancel').onclick = () => { closeModal(); renderLaboresModal(); };
  $('#editROk').onclick = save;
  $('#editRName').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
}

/* ---------- UPLOADS: carga de archivos para completar la base de datos ---------- */
const UPLOAD_TYPES = [
  {
    key: 'talks',
    title: 'Conferencias',
    icon: 'campaign',
    desc: 'Lista de discursos públicos. Se sube un PDF, se extraen los títulos y se reescribe la colección.',
    pdfHint: 'Se extraen los discursos numerados del PDF para revisar.',
  },
  {
    key: 'people',
    title: 'Personas',
    icon: 'group',
    desc: 'Lista de participantes. Use la plantilla descargable (solo Nombre, Género y Calificación), complétela y súbala convertida a PDF.',
    pdfHint: 'Se extraen nombre, género y calificación de la tabla. Los roles y las parejas se asignan después en el sistema.',
  },
  {
    key: 'midweeks',
    title: 'Guía de Actividades',
    icon: 'auto_stories',
    desc: 'Programa de las reuniones de entre semana. Se acumulan las guías por fecha; las fechas ya cargadas se pueden reescribir.',
    pdfHint: 'Se extrae el programa de la guía y se añade semana a semana por su fecha.',
  },
];

async function renderUploads() {
  state.month = null;
  renderTop();
  const app = $('#app');
  const cards = UPLOAD_TYPES.map(t => `
    <div class="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-6">
      <div class="flex items-start gap-4 mb-4">
        <span class="material-symbols-outlined text-primary text-3xl">${t.icon}</span>
        <div class="flex-1">
          <h3 class="font-headline-md text-headline-md text-primary mb-1">${t.title}</h3>
          <p class="font-body-md text-body-md text-on-surface-variant">${t.desc}</p>
        </div>
      </div>
      ${t.key === 'people' ? `
        <div class="flex gap-2 mb-4 flex-wrap">
          <button data-dl-template class="flex items-center gap-2 border border-tertiary text-tertiary px-4 py-2 rounded-lg font-label-md text-label-md hover:bg-tertiary-fixed/40 transition-colors">
            <span class="material-symbols-outlined text-[18px]">download</span> Descargar plantilla
          </button>
          <span class="flex items-center gap-1 text-caption text-on-surface-variant"><span class="material-symbols-outlined text-[16px]">info</span> Llene la plantilla (Nombre, Género, Calificación), conviértala a PDF y súbala aquí.</span>
        </div>` : ''}
      <div data-slot="pdf">
        <label for="upl-pdf-${t.key}" class="block w-full cursor-pointer border-2 border-dashed border-outline-variant rounded-lg p-5 text-center hover:border-primary hover:bg-primary-fixed/10 transition-colors">
          <span class="material-symbols-outlined text-4xl text-on-surface-variant block mx-auto mb-2">picture_as_pdf</span>
          <span class="font-label-md text-label-md text-primary">Seleccionar archivo PDF</span>
          <span class="block text-caption text-on-surface-variant mt-1">${t.pdfHint}</span>
        </label>
        <input id="upl-pdf-${t.key}" type="file" accept=".pdf,application/pdf" class="hidden" data-upload-pdf="${t.key}">
      </div>
      <p id="upl-status-${t.key}" class="mt-3 font-label-md text-label-md text-on-surface-variant hidden"></p>
    </div>
  `).join('');

  app.innerHTML = `
    <div class="mb-10">
      <h1 class="font-display-lg text-display-lg text-primary mb-2">Carga de Archivos</h1>
      <p class="font-body-lg text-body-lg text-on-surface-variant">Suba un archivo PDF y la app extraerá la información para revisar antes de guardarla.</p>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-gutter">${cards}</div>
    <div id="uploadSummary" class="mt-8"></div>
  `;

  app.querySelector('[data-dl-template]').onclick = downloadPeopleTemplate;

  // Carga de PDF → valida el tipo y pide confirmación antes de guardar.
  app.querySelectorAll('input[data-upload-pdf]').forEach(input => {
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const type = input.dataset.uploadPdf;
      const status = $(`#upl-status-${type}`);
      showStatus(status, `Extrayendo ${file.name} con OCR/pdf.js…`, 'text-on-surface-variant');
      try {
        const text = await extractPdfText(file);

        if (type === 'midweeks') {
          const summary = midweekGuideSummary(text);
          if (!summary) {
            showStatus(status, 'Este PDF no se reconoce como una Guía de Actividades. Se esperan los títulos "Tesoros de la Biblia", "Seamos Mejores Maestros" y "Nuestra Vida Cristiana", o cabeceras de semanas "D-D DE MES".', 'text-error');
            return;
          }
          if (!summary.weeksCount) {
            showStatus(status, 'Guía de Actividades reconocida por sus títulos, pero no se detectaron semanas con formato "D-D DE MES". Revisa el texto extraído.', 'text-error');
            return;
          }
          const label = summary.months.length === 1
            ? `${summary.months[0]} ${summary.year}`
            : `${summary.months.slice(0, -1).join(', ')} y ${summary.months[summary.months.length - 1]} ${summary.year}`;
          await cargarGuiaMidweeks(summary, text, label, status);
          return;
        }

        // Conferencias / Personas: resumen + confirmación.
        const { data, warnings } = convertPdfToData(type, text, { labores: state.labores.map(r => r.id) });
        if (!data) {
          showStatus(status, 'No se pudo interpretar este PDF con el formato esperado.', 'text-error');
          return;
        }
        let msg;
        if (type === 'talks') msg = `Se detectaron ${(data.discursos || []).length} discursos. ¿Guardar y reemplazar la lista de conferencias?`;
        else msg = `Se detectaron ${(data.personas || []).length} personas. ¿Guardar y reemplazar la lista de participantes?`;
        const ok = await confirmDialog(msg, 'Guardar');
        if (!ok) { showStatus(status, 'Carga cancelada', 'text-on-surface-variant'); return; }
        if (type === 'talks') await db.replaceTalksFromFile(data);
        else await db.replaceAllPeople(data.personas || data);
        await refreshCatalogs();
        showStatus(status, '✓ Datos guardados.', 'text-tertiary-fixed');
        renderUploadSummary();
        toast('Datos guardados', 'success');
      } catch (e) {
        showStatus(status, `Error al leer PDF: ${e.message}`, 'text-error');
      }
    });
  });

  await renderUploadSummary();
}

// Carga una Guía de Actividades de forma ACUMULATIVA por fecha: añade las
// semanas que no existen y, para las que ya están, pregunta si reescribirlas.
async function cargarGuiaMidweeks(summary, text, label, status) {
  const { data, warnings } = convertPdfMidweeks(text);
  if (!data || !data.weeks || !data.weeks.length) {
    showStatus(status, 'No se pudieron extraer las semanas de la guía.', 'text-error');
    return;
  }
  const nuevas = data.weeks;
  const existentes = new Map((await db.listMidweeks()).map(w => [String(w.id), w]));

  // Semanas que ya existen en la base.
  const duplicadas = nuevas.filter(w => existentes.has(String(w.id)));
  const porAnadir = nuevas.filter(w => !existentes.has(String(w.id)));

  let msg = `Se detectó la Guía de Actividades de ${label} con ${nuevas.length} semanas.`;
  if (warnings && warnings.length) msg += '\n\nAvisos:\n• ' + warnings.join('\n• ');
  if (duplicadas.length) {
    const fechas = duplicadas.map(w => w.header || w.id).join(', ');
    msg += `\n\n${duplicadas.length} de esas semanas ya están cargadas (${fechas}).`;
  }
  if (porAnadir.length) {
    msg += `\n\nSe añadirán ${porAnadir.length} semana(s) nueva(s).`;
  }
  if (!porAnadir.length && duplicadas.length) {
    msg += '\n\nNo hay semanas nuevas para añadir.';
  }
  msg += '\n\n¿Continuar?';
  const ok = await confirmDialog(msg, 'Continuar');
  if (!ok) { showStatus(status, 'Carga cancelada', 'text-on-surface-variant'); return; }

  // Si hay duplicadas, preguntar una a una (o en bloque) si se reescriben.
  let reescribir = new Set();
  if (duplicadas.length) {
    const reescribirTodo = await confirmDialog(
      `Hay ${duplicadas.length} semana(s) cuya fecha ya está cargada.\n\n¿Quiere reescribir TODAS las existentes con los datos de esta guía?`,
      'Reescribir todas'
    );
    if (reescribirTodo) {
      duplicadas.forEach(w => reescribir.add(String(w.id)));
    } else {
      for (const w of duplicadas) {
        const r = await confirmDialog(`La semana ${w.header || w.id} ya está cargada. ¿Reescribirla con los datos de esta guía?`, 'Reescribir');
        if (r) reescribir.add(String(w.id));
      }
    }
  }

  const aGuardar = [
    ...porAnadir,
    ...duplicadas.filter(w => reescribir.has(String(w.id))),
  ];
  if (!aGuardar.length) {
    showStatus(status, 'No se guardó ningún cambio (no había semanas nuevas ni se eligió reescribir).', 'text-on-surface-variant');
    return;
  }
  await db.mergeMidweeks(aGuardar);
  await refreshCatalogs();
  showStatus(status, `✓ Guía de ${label} procesada · ${porAnadir.length} añadidas, ${duplicadas.filter(w => reescribir.has(String(w.id))).length} reescritas.`, 'text-tertiary-fixed');
  renderUploadSummary();
  toast('Guía de actividades actualizada', 'success');
}

// Descarga la plantilla de participantes (Excel .xls con tabla).
// Solo pide Nombre, Género y Calificación; los roles y las parejas se asignan
// después en el sistema.
function downloadPeopleTemplate() {
  const html = `<!DOCTYPE html>
<html lang="es" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
<meta charset="UTF-8">
<meta name="ProgId" content="Excel.Sheet">
<meta name="Generator" content="Reunión+">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>Participantes</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
  body { font-family: Arial, sans-serif; margin: 24px; }
  h2 { color: #1a3a5c; }
  p.small { font-size: 11px; color: #555; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; }
  th, td { border: 1px solid #999; padding: 6px 8px; font-size: 12px; text-align: left; }
  th { background: #e8f0f8; }
</style></head><body>
  <h2>Reunión+ · Plantilla de participantes</h2>
  <p class="small">Complete una fila por participante. Género: Masculino o Femenino. Calificación: A, B, C o D (D = requiere enlace de pareja). Los roles de asignación y las parejas se ingresan después en el sistema. Luego convierta la hoja a PDF y súbala en la vista Carga de Archivos.</p>
  <table>
    <thead><tr><th>Nombre</th><th>Género</th><th>Calificación</th></tr></thead>
    <tbody>
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
    </tbody>
  </table>
</body></html>`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  downloadBlob(blob, 'plantilla-participantes.xls');
  toast('Plantilla descargada', 'success');
}

async function renderUploadSummary() {
  const s = $('#uploadSummary');
  if (!s) return;
  const [people, talks, midweeks, depts] = await Promise.all([
    db.listPeople(), db.listTalks(), db.listMidweeks(), db.listDepartments(),
  ]);
  const rows = [
    ['Personas', people.length, 'group', 'listPeople'],
    ['Departamentos', depts.length, 'apartment', 'listDepartments'],
    ['Conferencias', talks.length, 'campaign', 'listTalks'],
    ['Semanas de entre semana', midweeks.length, 'auto_stories', 'listMidweeks'],
  ].map(([label, n, icon, action]) => `<div class="flex items-center gap-3 bg-surface-container-lowest rounded-lg p-4 border border-outline-variant hover:border-primary hover:shadow-md transition-all cursor-pointer" data-summary-action="${action}" title="Revisar lista de ${label.toLowerCase()}">
    <span class="material-symbols-outlined text-primary">${icon}</span>
    <div class="flex-1"><p class="font-label-md text-label-md text-on-surface-variant">${label}</p></div>
    <span class="font-headline-md text-headline-md text-primary">${n}</span>
    <span class="material-symbols-outlined text-on-surface-variant text-[18px]">chevron_right</span>
  </div>`).join('');
  s.innerHTML = `<h2 class="font-headline-md text-headline-md text-primary mb-4">Base de datos actual</h2>
    <p class="text-on-surface-variant text-caption mb-3">Toque una tarjeta para revisar y editar su lista.</p>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${rows}</div>`;
  s.querySelectorAll('[data-summary-action]').forEach(el => {
    el.onclick = () => openSummaryList(el.dataset.summaryAction);
  });
}

// Abre la lista de un parámetro del resumen con opciones de CRUD.
async function openSummaryList(what) {
  await refreshCatalogs();
  if (what === 'listPeople') return openPeopleListModal();
  if (what === 'listDepartments') return openDepartmentsListModal();
  if (what === 'listTalks') return openTalksListModal();
  if (what === 'listMidweeks') return openMidweeksListModal();
}

function showStatus(node, msg, cls) {
  if (!node) return;
  node.classList.remove('hidden');
  node.className = 'mt-3 font-label-md text-label-md ' + cls;
  node.textContent = msg;
}

/* ---------- Modales CRUD del resumen de base de datos ---------- */
// Lista de personas con búsqueda, edición y eliminación.
async function openPeopleListModal() {
  const people = [...state.people].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const body = people.map(p => `
    <li class="flex items-center justify-between gap-3 py-2.5 border-b border-outline-variant/40 group">
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-8 h-8 rounded-full ${avatarClassFor(p.name)} flex items-center justify-center font-label-md text-label-md font-bold shrink-0">${initialsOf(p.name)}</div>
        <div class="min-w-0">
          <p class="font-body-md text-body-md font-medium truncate">${escapeHtml(p.name)}</p>
          <p class="text-caption text-on-surface-variant truncate">${(p.labores || []).map(l => (state.labores.find(r => r.id === l) || {}).label || l).join(', ') || 'Sin labores'}</p>
        </div>
      </div>
      <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button data-pedit="${p.id}" class="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-variant" title="Editar perfil"><span class="material-symbols-outlined text-[18px]">edit</span></button>
        <button data-pdel2="${p.id}" class="p-1.5 rounded-lg text-error hover:bg-error-container" title="Eliminar"><span class="material-symbols-outlined text-[18px]">delete</span></button>
      </div>
    </li>`).join('') || '<li class="py-4 text-center text-on-surface-variant text-sm">Sin personas.</li>';
  openModal(`
    <div>
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-headline-md text-headline-md text-primary">Personas (${people.length})</h3>
        <button data-close-modal class="material-symbols-outlined p-1 rounded-lg hover:bg-surface-variant text-on-surface-variant">close</button>
      </div>
      <div class="relative mb-3">
        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">search</span>
        <input data-search class="w-full bg-surface-bright border border-outline-variant rounded-lg py-2 pl-9 pr-3 text-body-md font-body-md focus:border-primary" placeholder="Buscar persona...">
      </div>
      <ul data-list class="max-h-[55vh] overflow-y-auto divide-y-0"></ul>
      <div class="flex gap-3 mt-4">
        <button data-add class="flex-1 flex items-center justify-center gap-2 bg-primary text-on-primary px-4 py-2.5 rounded-lg font-label-md text-label-md hover:opacity-90"><span class="material-symbols-outlined text-[18px]">person_add</span> Añadir persona</button>
        <button data-depts class="flex-1 flex items-center justify-center gap-2 border border-outline text-on-surface-variant px-4 py-2.5 rounded-lg font-label-md text-label-md hover:bg-surface-container"><span class="material-symbols-outlined text-[18px]">apartment</span> Departamentos</button>
      </div>
    </div>`);
  const list = modalEl('[data-list]');
  list.innerHTML = body;

  modalEl('[data-search]').addEventListener('input', (e) => {
    const q = normalizeStr(e.target.value);
    list.querySelectorAll('li').forEach(li => { li.style.display = li.dataset.norm.includes(q) ? '' : 'none'; });
    list.querySelectorAll('li').forEach(li => { li.dataset.norm = normalizeStr((li.textContent || '').slice(0, 120)); });
  });
  list.querySelectorAll('li').forEach(li => { li.dataset.norm = normalizeStr((li.textContent || '').slice(0, 120)); });

  list.querySelectorAll('[data-pedit]').forEach(b => b.onclick = () => {
    const person = state.people.find(x => String(x.id) === String(b.dataset.pedit));
    if (person) openPersonProfile(person);
  });
  list.querySelectorAll('[data-pdel2]').forEach(b => b.onclick = async () => {
    const person = state.people.find(x => String(x.id) === String(b.dataset.pdel2));
    if (!person) return;
    if (!await confirmDialog(`¿Quitar a ${person.name}? No recibirá más asignaciones y quedará oculta; puede restaurarse después.`, 'Quitar')) return;
    await db.deletePerson(person.id);
    await refreshCatalogs();
    closeModal();
    openPeopleListModal();
    renderUploadSummary();
    toast('Persona oculta', 'success');
  });
  modalEl('[data-add]').onclick = () => { closeModal(); openAddMemberModal(); };
  modalEl('[data-depts]').onclick = () => { closeModal(); openDepartmentsListModal(); };
  modalEl('[data-close-modal]').onclick = closeModal;
}

// Lista de departamentos con añadir/renombrar/eliminar.
async function openDepartmentsListModal() {
  const depts = [...state.departments].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const body = depts.map(d => `
    <li class="flex items-center justify-between gap-3 py-2.5 border-b border-outline-variant/40 group">
      <div class="flex items-center gap-3 min-w-0">
        <span class="material-symbols-outlined text-on-surface-variant">apartment</span>
        <p class="font-body-md text-body-md font-medium truncate">${escapeHtml(d.name)}</p>
      </div>
      <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button data-dedit="${d.id}" class="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-variant" title="Renombrar"><span class="material-symbols-outlined text-[18px]">edit</span></button>
        <button data-ddel="${d.id}" class="p-1.5 rounded-lg text-error hover:bg-error-container" title="Eliminar"><span class="material-symbols-outlined text-[18px]">delete</span></button>
      </div>
    </li>`).join('') || '<li class="py-4 text-center text-on-surface-variant text-sm">Sin departamentos.</li>';
  openModal(`
    <div>
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-headline-md text-headline-md text-primary">Departamentos (${depts.length})</h3>
        <button data-close-modal class="material-symbols-outlined p-1 rounded-lg hover:bg-surface-variant text-on-surface-variant">close</button>
      </div>
      <form data-form class="flex gap-2 mb-3">
        <input data-name type="text" placeholder="Nuevo departamento (p. ej. Grupo 4)" class="flex-1 bg-surface-bright border border-outline-variant rounded-lg p-2.5 text-body-md font-body-md focus:border-primary" autocomplete="off">
        <button class="px-4 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 whitespace-nowrap">Agregar</button>
      </form>
      <ul data-list class="max-h-[55vh] overflow-y-auto divide-y-0">${body}</ul>
      <div class="flex gap-3 mt-4">
        <button data-people class="flex-1 flex items-center justify-center gap-2 border border-outline text-on-surface-variant px-4 py-2.5 rounded-lg font-label-md text-label-md hover:bg-surface-container"><span class="material-symbols-outlined text-[18px]">group</span> Personas</button>
      </div>
    </div>`);

  modalEl('[data-form]').onsubmit = async (e) => {
    e.preventDefault();
    const name = modalEl('[data-name]').value.trim();
    if (!name) { toast('Escribe un nombre', 'error'); return; }
    await db.addDepartment(name);
    await refreshCatalogs();
    closeModal();
    openDepartmentsListModal();
    renderUploadSummary();
    toast('Departamento agregado', 'success');
  };
  modalEl('[data-list]').querySelectorAll('[data-dedit]').forEach(b => b.onclick = () => {
    const d = state.departments.find(x => String(x.id) === String(b.dataset.dedit));
    if (!d) return;
    const nuevo = promptText('Renombrar departamento', d.name);
    if (nuevo == null) return;
    if (!nuevo.trim()) { toast('Nombre vacío', 'error'); return; }
    (async () => { await db.updateDepartment({ ...d, name: nuevo.trim() }); await refreshCatalogs(); closeModal(); openDepartmentsListModal(); renderUploadSummary(); toast('Departamento actualizado', 'success'); })();
  });
  modalEl('[data-list]').querySelectorAll('[data-ddel]').forEach(b => b.onclick = async () => {
    const d = state.departments.find(x => String(x.id) === String(b.dataset.ddel));
    if (!d) return;
    if (!await confirmDialog(`¿Quitar el departamento "${d.name}"? Se ocultará de las listas y puede restaurarse después.`, 'Quitar')) return;
    await db.deleteDepartment(d.id);
    await refreshCatalogs();
    closeModal();
    openDepartmentsListModal();
    renderUploadSummary();
    toast('Departamento oculto', 'success');
  });
  modalEl('[data-people]').onclick = () => { closeModal(); openPeopleListModal(); };
  modalEl('[data-close-modal]').onclick = closeModal;
}

// Lista de discursos con añadir/editar/eliminar.
async function openTalksListModal() {
  const talks = [...state.talks].sort((a, b) => Number(a.num) - Number(b.num));
  const body = talks.map(t => `
    <li class="flex items-center justify-between gap-3 py-2.5 border-b border-outline-variant/40 group">
      <div class="flex items-center gap-3 min-w-0">
        <span class="w-8 h-8 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center font-label-md text-label-md font-bold shrink-0">${t.num}</span>
        <p class="font-body-md text-body-md truncate">${escapeHtml(t.title)}</p>
      </div>
      <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button data-tedit="${t.num}" class="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-variant" title="Editar"><span class="material-symbols-outlined text-[18px]">edit</span></button>
        <button data-tdel="${t.num}" class="p-1.5 rounded-lg text-error hover:bg-error-container" title="Eliminar"><span class="material-symbols-outlined text-[18px]">delete</span></button>
      </div>
    </li>`).join('') || '<li class="py-4 text-center text-on-surface-variant text-sm">Sin discursos.</li>';
  openModal(`
    <div>
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-headline-md text-headline-md text-primary">Conferencias (${talks.length})</h3>
        <button data-close-modal class="material-symbols-outlined p-1 rounded-lg hover:bg-surface-variant text-on-surface-variant">close</button>
      </div>
      <form data-form class="flex gap-2 mb-3">
        <input data-num type="number" min="1" placeholder="Nº" class="w-20 bg-surface-bright border border-outline-variant rounded-lg p-2.5 text-body-md font-body-md focus:border-primary" autocomplete="off">
        <input data-title type="text" placeholder="Título del discurso" class="flex-1 bg-surface-bright border border-outline-variant rounded-lg p-2.5 text-body-md font-body-md focus:border-primary" autocomplete="off">
        <button class="px-4 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 whitespace-nowrap">Añadir</button>
      </form>
      <ul data-list class="max-h-[55vh] overflow-y-auto divide-y-0">${body}</ul>
    </div>`);

  modalEl('[data-form]').onsubmit = async (e) => {
    e.preventDefault();
    const num = Number(modalEl('[data-num]').value);
    const title = modalEl('[data-title]').value.trim();
    if (!num || !title) { toast('Número y título son obligatorios', 'error'); return; }
    try {
      await db.addTalk(num, title);
      await refreshCatalogs();
      closeModal();
      openTalksListModal();
      renderUploadSummary();
      toast('Discurso agregado', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };
  modalEl('[data-list]').querySelectorAll('[data-tedit]').forEach(b => b.onclick = () => {
    const t = state.talks.find(x => String(x.num) === String(b.dataset.tedit));
    if (!t) return;
    const nuevo = promptText('Editar título del discurso', t.title);
    if (nuevo == null) return;
    if (!nuevo.trim()) { toast('Título vacío', 'error'); return; }
    (async () => { await db.updateTalk({ ...t, title: nuevo.trim() }); await refreshCatalogs(); closeModal(); openTalksListModal(); renderUploadSummary(); toast('Discurso actualizado', 'success'); })();
  });
  modalEl('[data-list]').querySelectorAll('[data-tdel]').forEach(b => b.onclick = async () => {
    const t = state.talks.find(x => String(x.num) === String(b.dataset.tdel));
    if (!t) return;
    if (!await confirmDialog(`¿Eliminar el discurso ${t.num}: "${t.title}"?`, 'Eliminar')) return;
    await db.deleteTalk(t.num);
    await refreshCatalogs();
    closeModal();
    openTalksListModal();
    renderUploadSummary();
    toast('Discurso eliminado', 'success');
  });
  modalEl('[data-close-modal]').onclick = closeModal;
}

// Lista de semanas de entre semana cargadas, con búsqueda y eliminación.
async function openMidweeksListModal() {
  const weeks = [...state.midweeks].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const body = weeks.map(w => `
    <li class="flex items-center justify-between gap-3 py-2.5 border-b border-outline-variant/40 group">
      <div class="flex items-center gap-3 min-w-0">
        <span class="material-symbols-outlined text-on-surface-variant">auto_stories</span>
        <div class="min-w-0">
          <p class="font-body-md text-body-md font-medium truncate">${escapeHtml(w.header || w.id)}</p>
          <p class="text-caption text-on-surface-variant">${escapeHtml(w.reading || 'Sin lectura')}</p>
        </div>
      </div>
      <button data-wdel="${w.id}" class="p-1.5 rounded-lg text-error hover:bg-error-container opacity-0 group-hover:opacity-100 transition-opacity shrink-0" title="Eliminar"><span class="material-symbols-outlined text-[18px]">delete</span></button>
    </li>`).join('') || '<li class="py-4 text-center text-on-surface-variant text-sm">Sin semanas cargadas.</li>';
  openModal(`
    <div>
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-headline-md text-headline-md text-primary">Semanas de entre semana (${weeks.length})</h3>
        <button data-close-modal class="material-symbols-outlined p-1 rounded-lg hover:bg-surface-variant text-on-surface-variant">close</button>
      </div>
      <div class="relative mb-3">
        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">search</span>
        <input data-search class="w-full bg-surface-bright border border-outline-variant rounded-lg py-2 pl-9 pr-3 text-body-md font-body-md focus:border-primary" placeholder="Buscar semana...">
      </div>
      <ul data-list class="max-h-[55vh] overflow-y-auto divide-y-0">${body}</ul>
    </div>`);
  const list = modalEl('[data-list]');
  modalEl('[data-search]').addEventListener('input', (e) => {
    const q = normalizeStr(e.target.value);
    list.querySelectorAll('li').forEach(li => { li.style.display = li.dataset.norm.includes(q) ? '' : 'none'; });
  });
  list.querySelectorAll('li').forEach(li => { li.dataset.norm = normalizeStr(li.textContent || ''); });
  list.querySelectorAll('[data-wdel]').forEach(b => b.onclick = async () => {
    const id = b.dataset.wdel;
    const w = state.midweeks.find(x => String(x.id) === String(id));
    if (!await confirmDialog(`¿Eliminar la semana ${(w && w.header) || id}?`, 'Eliminar')) return;
    await db.deleteMidweek(id);
    await refreshCatalogs();
    closeModal();
    openMidweeksListModal();
    renderUploadSummary();
    toast('Semana eliminada', 'success');
  });
  modalEl('[data-close-modal]').onclick = closeModal;
}

// Lee un elemento dentro del modal actual.
function modalEl(sel) {
  return $('#modalCard').querySelector(sel);
}

// Prompt simple (texto) reutilizado por los CRUD.
function promptText(label, value = '') {
  return new Promise((resolve) => {
    openModal(`
      <div>
        <h3 class="font-headline-md text-headline-md text-primary mb-4">${escapeHtml(label)}</h3>
        <input id="ptInput" type="text" value="${escapeAttr(value)}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 text-body-md font-body-md focus:border-primary" autocomplete="off">
        <div class="flex gap-3 justify-end mt-5">
          <button id="ptCancel" class="px-5 py-2.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cancelar</button>
          <button id="ptOk" class="px-6 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Aceptar</button>
        </div>
      </div>`);
    $('#ptOk').onclick = () => { const v = $('#ptInput').value; closeModal(); resolve(v); };
    $('#ptCancel').onclick = () => { closeModal(); resolve(null); };
    $('#ptInput').onkeydown = (e) => { if (e.key === 'Enter') { const v = $('#ptInput').value; closeModal(); resolve(v); } };
    $('#ptInput').focus();
  });
}


// ---- PDF: extracción de texto con pdf.js (vendored, funciona sin conexión) ----
let _pdfReady = false;
function pdfInit() {
  if (_pdfReady) return true;
  if (!window.pdfjsLib) return false;
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
  _pdfReady = true;
  return true;
}

async function extractPdfText(file) {
  pdfInit();
  if (!window.pdfjsLib) throw new Error('Motor PDF no disponible');
  const data = await file.arrayBuffer();
  const doc = await window.pdfjsLib.getDocument({ data }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += rebuildPdfWords(content.items) + '\n';
  }
  return out.replace(/\n{2,}/g, '\n').trim();
}

// Convierte el texto extraído a la estructura por tipo. Devuelve { data, warnings }.
// (convertPdfToData, convertPdfTalks, convertPdfPeople, convertPdfMidweeks se
//  importan de logic.js para poder probarse en Node.)

/* ---------- EVENTOS: fechas especiales que determinan el tipo de reunión ---------- */
async function renderEventos() {
  state.month = null;
  renderTop();
  const config = await db.getConfig();
  const app = $('#app');

  const cfgRow = (arr, type) => (Array.isArray(arr) ? arr : []).map((item, i) => {
    const it = typeof item === 'string' ? { date: item } : (item || {});
    if (type === 'visits') {
      return `<div class="cfg-event-row flex items-center gap-2">
        <span class="text-on-surface-variant text-sm">Desde</span>
        <input data-cfg-from type="date" value="${escapeAttr(it.from || it.date || '')}"
          class="cfg-date flex-1 bg-surface-bright border border-outline-variant rounded-lg p-2 font-body-md focus:border-primary">
        <span class="text-on-surface-variant text-sm">hasta</span>
        <input data-cfg-to type="date" value="${escapeAttr(it.to || it.date || '')}"
          class="cfg-date flex-1 bg-surface-bright border border-outline-variant rounded-lg p-2 font-body-md focus:border-primary">
        <button data-cfg-del="${i}" type="button" class="cfg-del material-symbols-outlined p-2 text-error hover:bg-error-container rounded-lg">close</button>
      </div>`;
    }
    if (type === 'assemblies') {
      const days = Number(it.days) || (it.from && it.to ? 3 : 1);
      const from = it.from || it.date || '';
      const to = it.to || (days === 3 && it.date ? addDays(it.date, 2) : '');
      return `<div class="cfg-event-row flex items-center gap-2 flex-wrap">
        <select data-cfg-days class="bg-surface-bright border border-outline-variant rounded-lg p-2 font-body-md focus:border-primary">
          <option value="1" ${days === 1 ? 'selected' : ''}>1 día</option>
          <option value="3" ${days === 3 ? 'selected' : ''}>3 días</option>
        </select>
        <span class="text-on-surface-variant text-sm">Desde</span>
        <input data-cfg-from type="date" value="${escapeAttr(from)}"
          class="cfg-date flex-1 min-w-[140px] bg-surface-bright border border-outline-variant rounded-lg p-2 font-body-md focus:border-primary">
        <span class="text-on-surface-variant text-sm cfg-to-label ${days === 3 ? '' : 'hidden'}">hasta</span>
        <input data-cfg-to type="date" value="${escapeAttr(to)}"
          class="cfg-date flex-1 min-w-[140px] bg-surface-bright border border-outline-variant rounded-lg p-2 font-body-md focus:border-primary ${days === 3 ? '' : 'hidden'}">
        <button data-cfg-del="${i}" type="button" class="cfg-del material-symbols-outlined p-2 text-error hover:bg-error-container rounded-lg">close</button>
      </div>`;
    }
    return `<div class="cfg-event-row flex items-center gap-2">
      <input type="date" class="cfg-date flex-1 bg-surface-bright border border-outline-variant rounded-lg p-2 font-body-md focus:border-primary">
      <button data-cfg-del="${i}" type="button" class="cfg-del material-symbols-outlined p-2 text-error hover:bg-error-container rounded-lg">close</button>
    </div>`;
  }).join('');

  app.innerHTML = `
    <h1 class="font-display-lg text-display-lg text-primary mb-2">Eventos</h1>
    <p class="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mb-8">Las fechas especiales determinan automáticamente el tipo de reunión de cada semana: en asamblea no hay reunión local; con visita se modifica el organigrama; con conmemoración se suspende una reunión según el día en que cae.</p>
    <div class="max-w-2xl space-y-6">

      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 space-y-6">
        <div>
          <h3 class="font-headline-md text-headline-md text-primary mb-1">Asambleas</h3>
          <p class="text-on-surface-variant text-caption">La fecha de inicio; elija si es de 1 día o de 3 días. Esa semana no hay reunión local.</p>
        </div>
        <div id="cfgAssemblyWrap">${cfgRow(config.events.assemblies, 'assemblies')}</div>
        <button id="cfgAddAssembly" type="button" class="text-primary font-label-md text-label-md hover:underline flex items-center gap-1">
          <span class="material-symbols-outlined text-[18px]">add_circle</span> Añadir asamblea
        </button>
      </div>

      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 space-y-6">
        <div>
          <h3 class="font-headline-md text-headline-md text-primary mb-1">Visita del Superintendente</h3>
          <p class="text-on-surface-variant text-caption">Indique el rango de fechas (desde/hasta) de la visita. Ambas reuniones se modifican en su organigrama.</p>
        </div>
        <div id="cfgVisitWrap">${cfgRow(config.events.visits, 'visits')}</div>
        <button id="cfgAddVisit" type="button" class="text-primary font-label-md text-label-md hover:underline flex items-center gap-1">
          <span class="material-symbols-outlined text-[18px]">add_circle</span> Añadir visita
        </button>
      </div>

      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 space-y-6">
        <div>
          <h3 class="font-headline-md text-headline-md text-primary mb-1">Conmemoración</h3>
          <p class="text-on-surface-variant text-caption">La fecha se marcará como Conmemoración en esa semana; se suspende una reunión según si cae entre semana o fin de semana.</p>
        </div>
        <div id="cfgCommWrap">${cfgRow(config.events.commemorations, 'commemoration')}</div>
        <button id="cfgAddComm" type="button" class="text-primary font-label-md text-label-md hover:underline flex items-center gap-1">
          <span class="material-symbols-outlined text-[18px]">add_circle</span> Añadir fecha
        </button>
      </div>

      <div class="flex gap-3">
        <button id="evSave" class="px-6 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Guardar eventos</button>
      </div>
    </div>
  `;

  const addRow = (wrap, type) => {
    const row = type === 'visits'
      ? `<div class="cfg-event-row flex items-center gap-2">
          <span class="text-on-surface-variant text-sm">Desde</span>
          <input data-cfg-from type="date" value=""
            class="cfg-date flex-1 bg-surface-bright border border-outline-variant rounded-lg p-2 font-body-md focus:border-primary">
          <span class="text-on-surface-variant text-sm">hasta</span>
          <input data-cfg-to type="date" value=""
            class="cfg-date flex-1 bg-surface-bright border border-outline-variant rounded-lg p-2 font-body-md focus:border-primary">
          <button data-cfg-del type="button" class="cfg-del material-symbols-outlined p-2 text-error hover:bg-error-container rounded-lg">close</button>
        </div>`
      : type === 'assemblies'
      ? `<div class="cfg-event-row flex items-center gap-2 flex-wrap">
          <select data-cfg-days class="bg-surface-bright border border-outline-variant rounded-lg p-2 font-body-md focus:border-primary">
            <option value="1">1 día</option>
            <option value="3">3 días</option>
          </select>
          <span class="text-on-surface-variant text-sm">Desde</span>
          <input data-cfg-from type="date" value=""
            class="cfg-date flex-1 min-w-[140px] bg-surface-bright border border-outline-variant rounded-lg p-2 font-body-md focus:border-primary">
          <span class="text-on-surface-variant text-sm cfg-to-label hidden">hasta</span>
          <input data-cfg-to type="date" value=""
            class="cfg-date flex-1 min-w-[140px] bg-surface-bright border border-outline-variant rounded-lg p-2 font-body-md focus:border-primary hidden">
          <button data-cfg-del type="button" class="cfg-del material-symbols-outlined p-2 text-error hover:bg-error-container rounded-lg">close</button>
        </div>`
      : `<div class="cfg-event-row flex items-center gap-2">
          <input type="date" class="cfg-date flex-1 bg-surface-bright border border-outline-variant rounded-lg p-2 font-body-md focus:border-primary">
          <button data-cfg-del type="button" class="cfg-del material-symbols-outlined p-2 text-error hover:bg-error-container rounded-lg">close</button>
        </div>`;
    wrap.insertAdjacentHTML('beforeend', row);
  };
  const removeCfgRow = (e) => { e.target.closest('.cfg-event-row').remove(); };
  const bindCfgDel = (wrap) => wrap.querySelectorAll('.cfg-del').forEach(b => b.addEventListener('click', removeCfgRow));
  const toggleDays = (row) => {
    const days = row.querySelector('[data-cfg-days]');
    if (!days) return;
    const is3 = days.value === '3';
    const to = row.querySelector('[data-cfg-to]');
    const toLabel = row.querySelector('.cfg-to-label');
    if (to) to.classList.toggle('hidden', !is3);
    if (toLabel) toLabel.classList.toggle('hidden', !is3);
    if (is3 && to && !to.value) {
      const from = row.querySelector('[data-cfg-from]').value;
      if (from) to.value = addDays(from, 2);
    }
  };
  const bindDaysToggles = (wrap) => {
    wrap.querySelectorAll('[data-cfg-days]').forEach(d => d.addEventListener('change', () => toggleDays(d.closest('.cfg-event-row'))));
  };
  const bindAdd = (id, wrapId) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
      addRow(document.getElementById(wrapId), $(`#${wrapId}`).dataset.kind);
      bindDaysToggles(document.getElementById(wrapId));
    });
  };

  document.getElementById('cfgAssemblyWrap').dataset.kind = 'assemblies';
  document.getElementById('cfgVisitWrap').dataset.kind = 'visits';
  document.getElementById('cfgCommWrap').dataset.kind = 'commemoration';
  bindCfgDel(document.getElementById('cfgAssemblyWrap'));
  bindCfgDel(document.getElementById('cfgVisitWrap'));
  bindCfgDel(document.getElementById('cfgCommWrap'));
  bindAdd('cfgAddAssembly', 'cfgAssemblyWrap');
  bindAdd('cfgAddVisit', 'cfgVisitWrap');
  bindAdd('cfgAddComm', 'cfgCommWrap');
  bindDaysToggles(document.getElementById('cfgAssemblyWrap'));

  const readRows = (wrap) => {
    const wrapEl = document.getElementById(wrap);
    const rows = [...wrapEl.querySelectorAll('.cfg-event-row')];
    const kind = wrapEl.dataset.kind;
    const out = [];
    rows.forEach(r => {
      if (kind === 'commemoration') {
        const d = r.querySelector('.cfg-date').value;
        if (d) out.push(d);
      } else if (kind === 'visits') {
        const from = r.querySelector('[data-cfg-from]').value;
        const to = r.querySelector('[data-cfg-to]').value;
        if (from) out.push({ from, to: to || from });
      } else if (kind === 'assemblies') {
        const days = parseInt(r.querySelector('[data-cfg-days]').value, 10) || 1;
        const from = r.querySelector('[data-cfg-from]').value;
        const to = r.querySelector('[data-cfg-to]').value;
        if (from) out.push(days === 1 ? { from, days: 1 } : { from, to: to || addDays(from, 2), days: 3 });
      }
    });
    return out;
  };

  $('#evSave').onclick = async () => {
    const events = {
      commemorations: readRows('cfgCommWrap'),
      visits: readRows('cfgVisitWrap'),
      assemblies: readRows('cfgAssemblyWrap'),
    };
    const cfg = await db.getConfig();
    cfg.events = events;
    await db.setConfig(cfg);
    state.config = cfg;
    // Re-sincronizar el tipo de reunión de todos los programas según las fechas.
    const months = await db.listMonths();
    let updated = 0;
    for (const m of months) {
      const before = m.weeks.map(w => w.type).join(',');
      applyConfigWeekTypes(m.weeks, true);
      if (m.weeks.map(w => w.type).join(',') !== before) { await db.putMonth(m); updated++; }
    }
    toast(`Eventos guardados · ${updated} programa(s) actualizado(s)`, 'success');
    renderEventos();
  };
}

/* ---------- SETTINGS ---------- */
async function renderSettings() {
  state.month = null;
  renderTop();
  const congregation = await db.getSetting('congregation', '');
  const config = await db.getConfig();
  const algo = { ...defaultAlgorithmConfig(), ...(config.algorithm || {}) };
  const scoring = { ...defaultScoringConfig(), ...((config.algorithm || {}).scoring || {}) };
  const personasOptions = (sel, cur) => `<option value="">—</option>${state.people.map(p => `<option value="${escapeAttr(String(p.id))}" ${String(p.id) === String(cur) ? 'selected' : ''}>${escapeAttr(p.name)}</option>`).join('')}`;
  const selVeces = (cur) => [0, 1, 2, 3, 4].map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${v === 0 ? 'Prohibido (0 veces)' : v === 1 ? 'Preferido (1 vez al mes)' : `Hasta ${v} veces al mes`}</option>`).join('');
  const selPair = (cur) => ['NOT_ALLOWED', 'ALLOWED_LOW', 'ALLOWED_MEDIUM', 'ALLOWED_HIGH'].map(m => `<option value="${m}" ${m === cur ? 'selected' : ''}>${m === 'NOT_ALLOWED' ? 'Prohibido' : m === 'ALLOWED_LOW' ? 'Solo con motivo' : m === 'ALLOWED_MEDIUM' ? 'Permitido' : 'Permitido (prioridad)'}</option>`).join('');
  const selLevel = (cur) => {
    const norm = cur === 'C' || cur === 'D' ? 'CD' : cur;
    return ['A', 'B', 'CD'].map(m => `<option value="${m}" ${m === norm ? 'selected' : ''}>${m === 'CD' ? 'C y D (CD)' : `Nivel ${m}`}</option>`).join('');
  };
  const app = $('#app');
  const algoVeces = algo.sameAssignmentMonthlyMode === 'STRICT' ? 0 : Math.min(4, Math.max(1, Number(algo.maxSameAssignmentPerMonth) || 1));
  const POND = [
    { id: 'scWorkload', peso: 'workloadBalance', label: 'Equilibrio de carga', izq: 'Da igual el reparto', der: 'Carga pareja', info: 'Peso de repartir la carga de trabajo de forma pareja entre todos los participantes.' },
    { id: 'scRotacion', peso: 'roleRotation', label: 'Rotación de roles', izq: 'Roles fijos', der: 'Rotar roles', info: 'Peso de alternar los puestos entre distintas personas para que no se encasillen.' },
    { id: 'scSemanal', peso: 'weeklyBalance', label: 'Reparto semanal', izq: 'Se acumulan en semanas', der: 'Semanas parejas', info: 'Peso de evitar que una persona acumule muchas asignaciones en la misma semana.' },
    { id: 'scRepeticion', peso: 'monthlyRepetition', label: 'Menos repetición mensual', izq: 'Repiten los mismos', der: 'Todos participan', info: 'Peso de evitar que una persona repita el mismo puesto dentro del mismo mes.' },
    { id: 'scEscasez', peso: 'scarceRoleProtection', label: 'Protección de escasez', izq: 'Usa a los pocos', der: 'Reserva a los escasos', info: 'Peso de cuidar los puestos que tienen pocos candidatos disponibles para no quedarse sin quién los cubra.' },
    { id: 'scParejas', peso: 'pairRoleBalance', label: 'Alternancia encargado/ayudante', izq: 'Siempre el mismo rol', der: 'Alterna roles', info: 'Peso de alternar quién es encargado y quién ayudante en las presentaciones en pareja.' },
    { id: 'scOportunidad', peso: 'studentOpportunityBalance', label: 'Oportunidad a estudiantes', izq: 'Reparto general', der: 'Más a estudiantes', info: 'Peso de dar más participación a los estudiantes que necesitan más prácticas.' },
  ];

  app.innerHTML = `
    <h1 class="font-headline-lg text-headline-lg text-primary mb-6">Ajustes</h1>
    <div class="max-w-2xl space-y-6">

      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 space-y-6">
        <div>
          <h3 class="font-headline-md text-headline-md text-primary mb-1">Configuración General</h3>
          <p class="text-on-surface-variant text-sm mb-4">Horarios de las reuniones. Las fechas especiales se gestionan desde la vista Eventos.</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Día de la reunión</label>
            <select id="cfgDay" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
              ${DAYS_ES_NAMES.map((d, i) => `<option value="${i}" ${i === Number(config.schedule?.day) ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Hora de comienzo</label>
            <input id="cfgTime" type="time" value="${escapeAttr(config.schedule?.time || '10:00')}"
              class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          </div>
        </div>

        <div class="border-t border-outline-variant pt-5">
          <div class="mb-3">
            <p class="font-label-md text-label-md text-on-surface uppercase tracking-wider">Reunión de Entre Semana</p>
            <p class="text-on-surface-variant text-caption">Día y hora de la reunión de entre semana.</p>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Día</label>
              <select id="cfgMwDay" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
                ${DAYS_ES_NAMES.map((d, i) => `<option value="${i}" ${i === Number(config.midweek?.day) ? 'selected' : ''}>${d}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Hora de comienzo</label>
              <input id="cfgMwTime" type="time" value="${escapeAttr(config.midweek?.time || '19:00')}"
                class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
            </div>
          </div>
        </div>

        <div class="flex gap-3 pt-2">
          <button id="cfgSave" class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Guardar</button>
        </div>
      </div>

      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 space-y-6">
        <div>
          <h3 class="font-headline-md text-headline-md text-primary mb-1">Gestión de Grupos</h3>
          <p class="text-on-surface-variant text-sm">Indique la cantidad de grupos de atención. Los grupos se asignan en rotación correlativa de un mes al siguiente; las labores son comunes a todos los grupos.</p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Cantidad de grupos</label>
            <select id="grpCant" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary"></select>
          </div>
        </div>
        <div>
          <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Labores (comunes a todos los grupos)</label>
          <input id="grpLabores" type="text" value="${escapeAttr(config.groups?.labores || '')}" placeholder="p. ej. Aseo y hospitalidad, sonido, ujieres…" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          <p class="text-on-surface-variant text-caption mt-1">Esta descripción es la misma para todos los grupos y se usará como referencia en los programas; modifíquela aquí cuando cambie.</p>
        </div>
        <div class="flex gap-3 pt-2">
          <button id="grpSave" class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Guardar grupos</button>
          <button id="grpAuto" class="px-5 py-2.5 rounded-lg border border-secondary text-secondary font-label-md text-label-md hover:bg-secondary-container">Aplicar rotación a todos los programas</button>
        </div>
      </div>

      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 space-y-6" data-admin>
        <div>
          <h3 class="font-headline-md text-headline-md text-primary mb-1">Acceso de usuarios</h3>
          <p class="text-on-surface-variant text-sm">Lista de correos autorizados para iniciar sesión (con correo/contraseña o con Google). Solo los correos que aparecen aquí pueden entrar y ver los datos. Un correo por línea; cada usuario mantiene su propio rol.</p>
        </div>
        <div>
          <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Correos permitidos</label>
          <textarea id="cfgEmails" rows="5" placeholder="usuario1@ejemplo.com&#10;usuario2@ejemplo.com"
            class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${escapeAttr(Array.isArray(config.emailsPermitidos) ? config.emailsPermitidos.join('\n') : '')}</textarea>
        </div>
        <div class="flex gap-3 pt-2">
          <button id="cfgEmailsSave" class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Guardar lista de correos</button>
        </div>
      </div>

      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 space-y-6">
        <div>
          <h3 class="font-headline-md text-headline-md text-primary mb-1">Motor de asignación automática</h3>
          <p class="text-on-surface-variant text-sm mb-4">Reglas que sigue el algoritmo al generar propuestas y el peso de cada dimensión en la puntuación 0-100.</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-2 flex items-center gap-1">Propuestas a generar ${infoTip('Cuántas alternativas distintas genera el algoritmo (1-10) para luego puntuar y elegir la mejor.')}</label>
            <input id="algoPropuestas" type="number" value="${escapeAttr(algo.numberOfProposals)}" min="1" max="10" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          </div>
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-2 flex items-center gap-1">Repetición del mismo puesto por mes ${infoTip('Cuántas veces puede repetir una misma persona el mismo puesto en el mes. 0 = prohibido, 1 = preferido (solo si hace falta), 2 o más = límite permitido.')}</label>
            <select id="algoRepVeces" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${selVeces(algoVeces)}</select>
          </div>
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-2 flex items-center gap-1">Pareja de género mixto ${infoTip('Permite combinar un varón y una mujer en la misma presentación y con qué prioridad a la hora de formar parejas.')}</label>
            <select id="algoPairMode" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${selPair(algo.mixedGenderPairing)}</select>
          </div>
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-2 flex items-center gap-1">Nivel del lector estudiantil ${infoTip('Qué calificaciones pueden tomar la lectura de la Biblia. Al elegir "C y D (CD)" se contemplan ambos niveles (desde CD hacia arriba) y se priorizan los de nivel C y D.')}</label>
            <select id="algoLectorNivel" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${selLevel(algo.studentReaderLevel)}</select>
          </div>
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-2 flex items-center gap-1">Conductor permanente ${infoTip('Persona fija que se asigna como conductor de la reunión de fin de semana. Si tiene salida ese sábado, se usa el suplente.')}</label>
            <select id="algoConductor" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${personasOptions('', algo.permanentConductorId)}</select>
          </div>
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-2 flex items-center gap-1">Conductor suplente ${infoTip('Se usa cuando el conductor permanente tiene una salida asignada ese fin de semana.')}</label>
            <select id="algoConductorBackup" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${personasOptions('', algo.permanentConductorBackupId)}</select>
          </div>
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-2 flex items-center gap-1">Conductor 2º suplente ${infoTip('Tercera opción: solo se usa si el permanente y el suplente están en salidas ese fin de semana.')}</label>
            <select id="algoConductorBackup2" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${personasOptions('', algo.permanentConductorBackupId2)}</select>
          </div>
          <div class="flex items-end">
            <label class="flex items-center gap-2 font-label-md text-label-md text-on-surface-variant cursor-pointer py-2.5" title="Restringe las labores de servicio (micrófono, sonido, acomodación) a varones.">
              <input id="algoServiceMale" type="checkbox" ${algo.serviceRolesOnlyMale ? 'checked' : ''} class="accent-primary"> Labores de servicio solo hombres
            </label>
          </div>
        </div>

        <div class="border-t border-outline-variant pt-5">
          <div class="mb-3">
            <p class="font-label-md text-label-md text-on-surface uppercase tracking-wider">Ponderación del ranking</p>
            <p class="text-on-surface-variant text-caption">Arrastre cada barra para fijar cuánto influye (0 = no influye, 100 = máxima influencia). Los extremos indican qué favorece cada valor; los pesos definen el ranking 0-100 de las propuestas.</p>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            ${POND.map(p => `
            <div>
              <label class="block font-label-md text-label-md text-on-surface-variant mb-1.5 flex items-center gap-1">${p.label} ${infoTip(p.info)}</label>
              <div class="flex items-center gap-2">
                <span class="text-caption leading-tight text-on-surface-variant min-w-[4.5rem]">${p.izq}</span>
                <input id="${p.id}" type="range" min="0" max="100" step="1" value="${escapeAttr(scoring[p.peso])}" class="flex-1 accent-primary">
                <span class="text-caption leading-tight text-on-surface-variant min-w-[4.5rem] text-right">${p.der}</span>
                <span class="w-7 text-center font-label-md text-label-md text-primary" data-val="${p.id}">${escapeAttr(scoring[p.peso])}</span>
              </div>
            </div>`).join('')}
          </div>
        </div>

        <div class="flex gap-3 pt-2">
          <button id="algoSave" class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Guardar motor</button>
          <button id="algoReset" class="px-4 py-2.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Restaurar</button>
        </div>
      </div>

      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 space-y-6">
        <div>
          <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Nombre de la congregación / grupo</label>
          <input id="setCong" type="text" value="${escapeAttr(congregation)}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          <p class="text-on-surface-variant text-caption mt-2">Aparece en los programas generados.</p>
        </div>
        <button id="setSave" class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Guardar</button>

        <div class="border-t border-outline-variant pt-6">
          <h3 class="font-headline-md text-headline-md text-primary mb-2">Mantenimiento de datos</h3>
          <p class="text-on-surface-variant text-sm mb-3">Los datos viven en Firebase y se sincronizan automáticamente. Aquí puedes restaurar los valores de fábrica o borrar solo reuniones y programas. Las acciones destructivas requieren tu contraseña de admin.</p>
          <div class="flex gap-3 flex-wrap">
            <button id="setBorrarProgramas" data-admin class="px-4 py-2 rounded-lg border border-error text-error font-label-md text-label-md hover:bg-error-container">Borrar participantes, reuniones y programas</button>
            <button id="setResetFabrica" data-admin class="px-4 py-2 rounded-lg border border-error text-error font-label-md text-label-md hover:bg-error-container">Restaurar valores de fábrica</button>
          </div>
          <p id="setSyncStatus" class="text-on-surface-variant text-caption mt-2"></p>
          <p class="text-on-surface-variant text-caption mt-1">"Restaurar valores de fábrica" borra todos los registros de Firebase y del dispositivo, dejando las colecciones vacías y conservando tu cuenta de admin. "Borrar participantes, reuniones y programas" elimina solo esas colecciones (conserva usuarios, grupos y configuración).</p>
        </div>
      </div>
    </div>
  `;

  // ---- Configuración General: horarios (los eventos se gestionan en la vista Eventos) ----
  $('#cfgSave').onclick = async () => {
    const prev = await db.getConfig();
    const cfg = {
      schedule: {
        day: parseInt($('#cfgDay').value, 10) || 6,
        time: $('#cfgTime').value || '10:00',
      },
      midweek: {
        day: parseInt($('#cfgMwDay').value, 10) || 2,
        time: $('#cfgMwTime').value || '19:00',
      },
      events: prev.events,
      groups: prev.groups,
    };
    await db.setConfig(cfg);
    state.config = cfg;
    toast('Configuración guardada', 'success');
  };

  // ---- Gestión de Grupos: cantidad + labores comunes ----
  const grpCant = $('#grpCant');
  const curCant = Number(config.groups?.cantidad) || Math.max(state.departments.length, 1) || 3;

  const fillGrpCant = () => {
    grpCant.innerHTML = Array.from({ length: 12 }, (_, i) => i + 1)
      .map(n => `<option value="${n}" ${n === curCant ? 'selected' : ''}>${n} grupo${n > 1 ? 's' : ''}</option>`).join('');
  };
  fillGrpCant();

  // Asegura que existan exactamente `n` grupos activos (numerados "Grupo i" o "i")
  // en la DB, reutilizando los ya existentes (incluso ocultos) para no perder
  // referencias. Los grupos fuera de rango se ocultan (borrado lógico).
  async function ensureGroupCount(n) {
    const existing = await db.listDepartmentsAll();
    const byNum = new Map();
    for (const d of existing) {
      const m = /^(?:grupo\s*)?(\d+)$/i.exec(String(d.name || '').trim());
      if (m) byNum.set(parseInt(m[1], 10), d);
    }
    for (let i = 1; i <= n; i++) {
      const d = byNum.get(i);
      if (!d) await db.addDepartment(`Grupo ${i}`);
      else if (d.activo === false) await db.restoreDepartment(d.id);
    }
    for (const d of existing) {
      const m = /^(?:grupo\s*)?(\d+)$/i.exec(String(d.name || '').trim());
      if (m && parseInt(m[1], 10) > n && d.activo !== false) await db.deleteDepartment(d.id);
    }
    state.departments = await db.listDepartments();
  }

  const saveGroups = async () => {
    const n = Math.max(parseInt(grpCant.value, 10) || curCant, 1);
    await ensureGroupCount(n);
    const cfg = await db.getConfig();
    cfg.groups = { cantidad: n, labores: $('#grpLabores').value.trim() };
    await db.setConfig(cfg);
    state.config = cfg;
    toast('Grupos guardados', 'success');
  };
  $('#grpSave').onclick = saveGroups;

  // ---- Acceso de usuarios: guardar whitelist de correos ----
  $('#cfgEmailsSave').onclick = async () => {
    const cfg = await db.getConfig();
    cfg.emailsPermitidos = $('#cfgEmails').value
      .split(/\n|,/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    await db.setConfig(cfg);
    state.config = cfg;
    toast('Lista de correos guardada', 'success');
  };

  // ---- Motor de asignación: guardar/restaurar reglas + ponderación ----
  POND.forEach(p => {
    const slide = $(`#${p.id}`);
    if (!slide) return;
    slide.addEventListener('input', () => {
      const badge = document.querySelector(`[data-val="${p.id}"]`);
      if (badge) badge.textContent = slide.value;
    });
  });
  const readAlgoForm = () => {
    const veces = Math.min(4, Math.max(0, parseInt($('#algoRepVeces').value, 10) || 1));
    const a = {
      numberOfProposals: Math.min(10, Math.max(1, parseInt($('#algoPropuestas').value, 10) || 3)),
      maxSameAssignmentPerMonth: veces,
      sameAssignmentMonthlyMode: veces === 0 ? 'STRICT' : veces === 1 ? 'PREFERRED' : 'LIMIT',
      mixedGenderPairing: $('#algoPairMode').value,
      studentReaderLevel: $('#algoLectorNivel').value,
      permanentConductorId: $('#algoConductor').value,
      permanentConductorBackupId: $('#algoConductorBackup').value,
      permanentConductorBackupId2: $('#algoConductorBackup2').value,
      serviceRolesOnlyMale: $('#algoServiceMale').checked,
    };
    const s = {
      workloadBalance: parseInt($('#scWorkload').value, 10) || 0,
      roleRotation: parseInt($('#scRotacion').value, 10) || 0,
      weeklyBalance: parseInt($('#scSemanal').value, 10) || 0,
      monthlyRepetition: parseInt($('#scRepeticion').value, 10) || 0,
      scarceRoleProtection: parseInt($('#scEscasez').value, 10) || 0,
      pairRoleBalance: parseInt($('#scParejas').value, 10) || 0,
      studentOpportunityBalance: parseInt($('#scOportunidad').value, 10) || 0,
    };
    return { a, s };
  };
  $('#algoSave').onclick = async () => {
    const { a, s } = readAlgoForm();
    const cfg = await db.getConfig();
    cfg.algorithm = { ...a, scoring: s };
    await db.setConfig(cfg);
    state.config = cfg;
    toast('Motor de asignación guardado', 'success');
  };
  $('#algoReset').onclick = async () => {
    const cfg = await db.getConfig();
    cfg.algorithm = { ...defaultAlgorithmConfig(), scoring: { ...defaultScoringConfig() } };
    await db.setConfig(cfg);
    state.config = cfg;
    toast('Motor restaurado a valores por defecto', 'success');
    renderSettings();
  };

  $('#grpAuto').onclick = async () => {
    await saveGroups();
    const n = Math.max(parseInt(grpCant.value, 10) || curCant, 1);
    const aseos = await db.listAseos();
    aseos.sort((a, b) => a.id.localeCompare(b.id)); // cronológico
    let total = 0;
    for (const a of aseos) {
      if (!Array.isArray(a.weeks) || !a.weeks.length) continue;
      const start = await nextAseoStart(a.id, n); // continúa del mes anterior
      let prev = start;
      for (const w of a.weeks) {
        if (prev == null) { w.group = ''; continue; }
        w.group = groupDeptForNum(prev);
        prev = (prev % n) + 1;
        total++;
      }
      await db.putAseo(a);
    }
    toast(`Rotación aplicada a ${aseos.length} programa(s) de aseo · ${total} semana(s) asignada(s)`, 'success');
  };
  $('#setSave').onclick = async () => {
    await db.setSetting('congregation', $('#setCong').value.trim());
    toast('Ajustes guardados', 'success');
  };
  $('#setSave').onclick = async () => {
    await db.setSetting('congregation', $('#setCong').value.trim());
    toast('Ajustes guardados', 'success');
  };

  // Acción destructiva protegida: pide la contraseña de admin antes de continuar.
  async function confirmarAdmin() {
    const u = currentUser();
    if (!u || u.rol !== 'admin') { toast('Debes iniciar sesión como admin.', 'error'); return false; }
    return new Promise((resolve) => {
      openModal(`
        <div class="text-center">
          <span class="material-symbols-outlined text-6xl text-error mb-2">admin_panel_settings</span>
          <h3 class="font-headline-md text-headline-md text-primary mb-1">Confirmar como admin</h3>
          <p class="text-on-surface-variant text-sm mb-4">Escribe tu contraseña para autorizar esta acción.</p>
          <form id="adminConfirmForm" class="space-y-4 text-left">
            <div>
              <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Contraseña</label>
              <input id="adminConfirmPass" type="password" required autocomplete="current-password" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
            </div>
            <div class="flex gap-3 justify-end pt-2">
              <button type="button" id="adminCancel" class="px-5 py-2.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cancelar</button>
              <button type="submit" class="px-5 py-2.5 rounded-lg bg-error text-on-error font-label-md text-label-md hover:opacity-90">Autorizar</button>
            </div>
          </form>
        </div>`);
      $('#adminCancel').onclick = () => { closeModal(); resolve(false); };
      $('#adminConfirmForm').onsubmit = async (e) => {
        e.preventDefault();
        const pass = $('#adminConfirmPass').value;
        try {
          await reauthenticate(pass);
          closeModal();
          resolve(true);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });
  }

  // Borrar participantes, reuniones y programas (conserva grupos, usuarios y config).
  $('#setBorrarProgramas').onclick = async () => {
    if (!await confirmarAdmin()) return;
    if (!await confirmDialog('Se borrarán en Firebase y en el dispositivo: participantes, reuniones y programas mensuales (con su historial de asignaciones). Los usuarios, grupos y configuración se conservan. ¿Continuar?', 'Borrar')) return;
    const btn = $('#setBorrarProgramas');
    btn.disabled = true;
    try {
      const borrados = await borrarParticipantesReunionesProgramas();
      await db.borrarParticipantesReunionesProgramasLocal();
      await refreshCatalogs();
      toast(`Borrado completado · ${borrados} documentos en Firebase`, 'success');
    } catch (err) {
      toast('Error al borrar: ' + (err.message || err), 'error');
    } finally {
      btn.disabled = false;
    }
  };

  // Restaurar valores de fábrica: borra todo menos la cuenta admin.
  $('#setResetFabrica').onclick = async () => {
    if (!await confirmarAdmin()) return;
    if (!await confirmDialog('Se borrarán TODOS los registros (personas, grupos, reuniones, programas, asignaciones, configuración) en Firebase y en el dispositivo. Las colecciones quedarán vacías y se conservará tu cuenta de admin. Esta acción NO se puede deshacer. ¿Continuar?', 'Restaurar valores de fábrica')) return;
    const btn = $('#setResetFabrica');
    btn.disabled = true;
    btn.textContent = 'Restaurando…';
    try {
      const uid = currentUser() && currentUser().uid;
      const borrados = await limpiarTodasLasColecciones(uid);
      await db.limpiarIndexedDBLocal();
      await refreshCatalogs();
      toast(`Valores de fábrica restaurados · ${borrados} documentos en Firebase`, 'success');
    } catch (err) {
      toast('Error al restaurar: ' + (err.message || err), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Restaurar valores de fábrica';
    }
  };
  // Estado de la sincronización
  const pintarSync = () => {
    const st = syncStatus();
    const el = $('#setSyncStatus');
    if (!el) return;
    const mapa = {
      'inactivo': ['text-on-surface-variant', 'Sincronización inactiva (Firebase no configurado)'],
      'conectado': ['text-tertiary', 'Sincronización con Firebase activa'],
      'syncing': ['text-primary', 'Sincronizando…'],
      'ok': ['text-tertiary', 'Sincronizado · ' + st.detail],
      'error': ['text-error', 'Error de sincronización · ' + st.detail],
      'pending': ['text-error', 'Cambios pendientes por falta de conexión · ' + st.detail],
    };
    const [cls, txt] = mapa[st.state] || ['text-on-surface-variant', '—'];
    el.className = `font-label-md text-label-md ${cls}`;
    el.textContent = txt;
  };
  pintarSync();
  window.addEventListener('reunion-sync', pintarSync);
}

/* ---------- MIDWEEKS: vista general ---------- */
async function renderMidweeks(opts = {}) {
  state.month = null;
  renderTop();
  const embed = opts.embed;
  const container = embed || $('#app');
  const allWeeks = state.midweeks.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));

  // Vista mensual: meses con reuniones de entre semana + filtrado por mes.
  const mwMonths = [...new Set(allWeeks.map(m => String(m.id).slice(0, 7)))].sort((a, b) => b.localeCompare(a));
  const cur = (opts.month && /^\d{4}-\d{2}$/.test(String(opts.month)))
    ? String(opts.month)
    : (state.mwMonth && mwMonths.includes(state.mwMonth) ? state.mwMonth : (mwMonths[0] || ''));
  state.mwMonth = cur;
  const weeks = cur ? allWeeks.filter(m => String(m.id).startsWith(cur)) : allWeeks;

  const monthSel = `<select id="mwMonth" class="bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
      ${mwMonths.map(m => `<option value="${m}" ${m === cur ? 'selected' : ''}>${MONTHS_ES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}</option>`).join('')}
    </select>`;

  const summary = (w) => {
    let total = 0, done = 0;
    for (const sec of (w.sections || [])) {
      for (const p of (sec.parts || [])) {
        total++;
        const ap = p.assignments || {};
        if (Object.values(ap).some(v => v != null && String(v).trim() !== '')) done++;
      }
    }
    return { total, done };
  };

  if (embed) {
    embed.innerHTML = `
      <div class="flex items-center gap-3 mb-6 flex-wrap">
        <button id="mwMonthPrevBtn" class="flex items-center gap-2 px-4 py-2 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-all whitespace-nowrap">
          <span class="material-symbols-outlined text-[18px]">description</span> Vista Final Mensual
        </button>
      </div>
      <div id="mwList" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter"></div>
    `;
  } else {
    container.innerHTML = `
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10">
      <div>
        <h1 class="font-display-lg text-display-lg text-primary mb-2">Reunión de Entre Semana</h1>
        <p class="text-on-surface-variant font-body-lg text-body-lg max-w-2xl">Programa mensual de la reunión de entre semana. Revise cada semana y asigne los participantes a cada parte.</p>
      </div>
      <div class="flex items-center gap-3 flex-wrap">
        ${monthSel}
        <div id="mwTotals" class="text-right text-sm text-on-surface-variant"></div>
        <button id="mwListaBtn" class="flex items-center gap-2 px-4 py-2 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-all whitespace-nowrap">
          <span class="material-symbols-outlined text-[18px]">view_list</span> Vista Lista
        </button>
        <button id="mwMonthPrevBtn" class="flex items-center gap-2 px-4 py-2 rounded-lg border border-secondary text-secondary font-label-md text-label-md hover:bg-secondary-container transition-all whitespace-nowrap">
          <span class="material-symbols-outlined text-[18px]">description</span> Vista Final Mensual
        </button>
      </div>
    </div>
    <div id="mwList" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter"></div>
  `;
  }

  const list = embed ? embed.querySelector('#mwList') : $('#mwList');
  if (!list) return;

  const monthNode = embed ? embed.querySelector('#mwMonth') : $('#mwMonth');
  if (monthNode) monthNode.onchange = (e) => renderMidweeks({ embed, month: e.target.value });

  if (weeks.length === 0) {
    list.innerHTML = `<div class="col-span-full text-center py-16 border-2 border-dashed border-outline-variant rounded-xl">
      <span class="material-symbols-outlined text-primary text-6xl mb-4">event_available</span>
      <p class="text-on-surface-variant font-body-lg">No hay semanas cargadas para la reunión de entre semana.</p>
      <button id="mwUploadGuide" class="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-all active:scale-95">
        <span class="material-symbols-outlined text-[18px]">upload_file</span> Subir guía
      </button>
    </div>`;
    const uploadBtn = embed ? embed.querySelector('#mwUploadGuide') : $('#mwUploadGuide');
    if (uploadBtn) uploadBtn.onclick = () => go('uploads');
    return;
  }

  const global = weeks.map(w => summary(w)).reduce((a, c) => ({ total: a.total + c.total, done: a.done + c.done }), { total: 0, done: 0 });
  const totals = embed ? embed.querySelector('#mwTotals') : $('#mwTotals');
  if (totals) totals.textContent = `${global.done} / ${global.total} partes asignadas`;

  list.innerHTML = weeks.map(w => {
    const s = summary(w);
    const pct = Math.round((s.done / Math.max(s.total, 1)) * 100);
    const songs = [];
    if (w.introSong) songs.push(`Intro ${w.introSong}`);
    if (w.songIn) songs.push(String(w.songIn));
    if (w.songOut) songs.push(w.songOut);
    return `<article class="bg-surface-container-lowest rounded-lg shadow-[0px_4px_20px_rgba(0,0,0,0.04)] p-6 border border-outline-variant hover:shadow-[0px_8px_30px_rgba(0,0,0,0.08)] transition-shadow flex flex-col gap-4">
      <div class="flex justify-between items-start">
        <div>
          <span class="inline-block px-3 py-1 bg-secondary-container text-on-secondary-container font-label-md text-label-md rounded-full">${escapeHtml(w.header)}</span>
          <h3 class="font-headline-md text-headline-md text-primary mt-3">Lectura: ${escapeHtml(w.reading || '—')}</h3>
          <p class="text-on-surface-variant font-caption text-caption uppercase tracking-wider">${s.done} / ${s.total} partes · ${pct}%</p>
        </div>
      </div>
      <div class="h-2 bg-surface-variant rounded-full overflow-hidden"><div class="h-full ${pct === 100 ? 'bg-tertiary' : 'bg-primary'}" style="width:${pct}%"></div></div>
      <div class="flex gap-2 mt-2">
        <button data-open="${w.id}" class="flex-1 px-3 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-all">${pct === 100 ? 'Editar' : 'Asignar participantes'}</button>
        <button data-preview="${w.id}" class="flex-1 px-3 py-2 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container transition-all">Vista Final</button>
      </div>
    </article>`;
  }).join('');

  list.querySelectorAll('[data-open]').forEach(b => b.onclick = () => go('midweek', { monthId: b.dataset.open }));
  list.querySelectorAll('[data-preview]').forEach(b => b.onclick = () => go('midweekPreview', { monthId: b.dataset.preview }));
  const monthPrevBtn = embed ? embed.querySelector('#mwMonthPrevBtn') : $('#mwMonthPrevBtn');
  if (monthPrevBtn) monthPrevBtn.onclick = () => go('midweekMonthPreview', { monthId: state.mwMonth });
  if (!embed) {
    const listaBtn = $('#mwListaBtn');
    if (listaBtn) listaBtn.onclick = () => go('midweekList');
  }
}

/* ---------- MIDWEEK: vista lista (cards por reunión, similar a fin de semana) ---------- */
function renderMidweekList() {
  state.month = null;
  renderTop();
  const app = $('#app');
  const weeks = state.midweeks.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const back = `<button data-back class="flex items-center gap-2 px-4 py-2 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-all active:scale-95">
    <span class="material-symbols-outlined text-[18px]">view_module</span> Vista Tarjetas
  </button>`;
  app.innerHTML = `
    <div class="mb-8 text-center md:text-left">
      <div class="flex items-center gap-3 mb-2 justify-center md:justify-start">
        <span class="editorial-line w-12 hidden md:block"></span>
        <p class="font-label-md text-label-md text-secondary uppercase tracking-widest">REUNIÓN DE ENTRE SEMANA</p>
      </div>
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 class="font-display-lg text-display-lg text-primary mb-2 leading-tight">Vista Lista</h1>
          <p class="font-body-lg text-body-lg text-on-surface-variant">Todas las reuniones de entre semana con sus asignaciones y labores.</p>
        </div>
        ${back}
      </div>
    </div>
    <div id="mwLista" class="grid grid-cols-1 md:grid-cols-2 gap-gutter"></div>
  `;
  $('[data-back]').onclick = () => go('midweeks');
  const list = $('#mwLista');
  if (!weeks.length) {
    list.innerHTML = `<div class="col-span-full text-center py-16 border-2 border-dashed border-outline-variant rounded-xl">
      <span class="material-symbols-outlined text-primary text-6xl mb-4">event_available</span>
      <p class="text-on-surface-variant font-body-lg">No hay semanas cargadas para la reunión de entre semana.</p>
      <button id="mwUploadGuide" class="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-all active:scale-95">
        <span class="material-symbols-outlined text-[18px]">upload_file</span> Subir guía
      </button>
    </div>`;
    const uploadBtn = $('#mwUploadGuide');
    if (uploadBtn) uploadBtn.onclick = () => go('uploads');
    return;
  }
  list.innerHTML = weeks.map((w, i) => midweekCardList(w, i)).join('');
}

function midweekCardList(w, i) {
  const date = new Date(w.id + 'T00:00:00');
  const day = date.getDate();
  const monthName = MONTHS_ES[date.getMonth()].toUpperCase();
  const assigned = (sec, p) => {
    const ap = p.assignments || {};
    const names = mwSlotsFor(sec, p).map(s => {
      const v = ap[s.key];
      return v ? personNameOf(v) : null;
    }).filter(Boolean);
    return names.length ? escapeHtml(names.join(' · ')) : '—';
  };
  const sectionsHtml = (w.sections || []).map(sec => {
    const parts = (sec.parts || []).map(p => `
      <div class="flex items-start justify-between gap-3 py-2 ${p !== (sec.parts || []).at(-1) ? 'border-b border-outline-variant/20' : ''}">
        <div class="flex items-center gap-2 min-w-0">
          <span class="font-body-md text-body-md font-semibold text-primary shrink-0">${p.num}.</span>
          <span class="font-body-md text-body-md text-on-surface">${escapeHtml(p.title)} <span class="text-caption text-on-surface-variant">(${p.mins} min)</span></span>
        </div>
        <span class="font-body-md text-body-md font-semibold text-on-surface text-right shrink-0">${assigned(sec, p)}</span>
      </div>`).join('');
    return `<div class="mt-4">
      <p class="font-label-md text-label-md text-secondary uppercase tracking-wider mb-1">${escapeHtml(sec.title)}</p>
      <div>${parts || '<p class="text-on-surface-variant text-sm">Sin partes.</p>'}</div>
    </div>`;
  }).join('');
  return `<div class="week-card bg-surface-container-low border-l-4 border-primary p-8 rounded-lg">
    <div class="flex justify-between items-start mb-4">
      <div>
        <div class="flex gap-2 items-center mb-3 flex-wrap">
          <span class="font-label-md text-label-md text-on-secondary-container bg-secondary-container px-3 py-1 rounded-full uppercase">Semana ${i + 1}</span>
          <span class="font-label-md text-label-md text-on-primary bg-primary px-3 py-1 rounded-full uppercase">${escapeHtml(w.header)}</span>
        </div>
        <h2 class="font-headline-lg text-headline-lg text-primary">${day} ${monthName}</h2>
        <p class="font-body-md text-body-md text-on-surface-variant mt-1">Lectura: ${escapeHtml(w.reading || '—')}</p>
        <p class="font-body-md text-body-md text-on-surface-variant">Presidente: ${escapeHtml(personNameOf(w.presidente))}</p>
      </div>
      <span class="material-symbols-outlined text-primary text-4xl">auto_stories</span>
    </div>
    ${sectionsHtml}
    ${previewLaboresBox(w)}
  </div>`;
}

/* ---------- ACOMODACIÓN: programa de labores independiente por mes ---------- */
async function renderAtencion(monthId, opts = {}) {
  const embed = opts.embed;
  if (!embed) {
    state.month = null;
    renderTop();
  }
  const root = embed || $('#app');
  const laboresList = await db.listAtencion();
  const mwMonths = [...new Set(state.midweeks.map(m => String(m.id).slice(0, 7)))];
  const allMonths = [...new Set([...laboresList.map(p => p.id), ...mwMonths])].sort((a, b) => b.localeCompare(a));
  const cur = (monthId && /^\d{4}-\d{2}$/.test(String(monthId))) ? String(monthId) : (allMonths[0] || isoDate(new Date()).slice(0, 7));
  let program = await db.getAtencion(cur);

  // Cada columna es una semana de la organización (domingo que la cierra): la
  // reunión de fin de semana (sábado, del programa de acomodación) y la de entre
  // semana (lunes, de la guía) comparten ese domingo.
  const weekSunday = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 6);
    return isoDate(d);
  };
  const slotValue = (week, key, si) => {
    const l = ensureAtencion(week).labores;
    return (Array.isArray(l[key]) ? l[key][si] : (si === 0 ? l[key] : '')) || '';
  };
  const fmtShort = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
  // Regla de género de acomodación: si serviceRolesOnlyMale está activo (default),
  // solo varones aparecen en los selectores manuales, alineado con la generación.
  const algoCfg = { ...defaultAlgorithmConfig(), ...((state.config && state.config.algorithm) || {}) };
  const atencionPred = (p) => isAtencionPerson(p) && (algoCfg.serviceRolesOnlyMale === false || p.genero !== 'femenino');
  const atencionOpts = (week, curVal, collector) => `<option value="">— Sin asignar —</option>` +
    eligiblePeople(week, state.people, atencionPred, curVal, collector).map(p => `<option value="${p.id}" ${String(p.id) === String(curVal) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');

  const render = () => {
    const finBySunday = new Map();
    ((program && program.weeks) || []).forEach((w, wi) => finBySunday.set(weekSunday(w.saturday), { w, wi }));
    const mwBySunday = new Map();
    state.midweeks.forEach(m => mwBySunday.set(weekSunday(m.id), m));
    const sundays = [...new Set([...finBySunday.keys(), ...mwBySunday.keys()])]
      .filter(s => s.startsWith(cur))
      .sort();

    const columns = sundays.map((sunday, i) => {
      const fin = finBySunday.get(sunday); // { w, wi } | undefined
      const mw = mwBySunday.get(sunday);
      // Cada celda: selector editable (fin de semana y entre semana). Las labores
      // de ambas reuniones se gestionan solo desde aquí (programa de acomodación).
      const cell = (key, si) => {
        const curVal = fin ? slotValue(fin.w, key, si) : '';
        const mwName = mw ? slotValue(mw, key, si) : '';
        const bits = [];
        if (fin) {
          bits.push(`<div class="flex flex-col gap-0.5">
            <select data-atencion-wi="${fin.wi}" data-atencion-key="${key}" data-atencion-si="${si}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-1.5 text-sm font-body-md focus:border-primary">${atencionOpts(fin.w, curVal)}</select>
            <span class="text-[9px] uppercase text-on-surface-variant/70 tracking-wider">FS</span>
          </div>`);
        } else if (curVal) {
          bits.push(`<div class="text-sm font-semibold text-on-surface">${escapeHtml(personNameOf(curVal))} <span class="text-[9px] uppercase text-on-surface-variant">FS</span></div>`);
        }
        if (mw) {
          bits.push(`<div class="flex flex-col gap-0.5">
            <select data-mwatencion-key="${key}" data-mwatencion-si="${si}" data-mwatencion-id="${mw.id}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-1.5 text-sm font-body-md focus:border-primary">${atencionOpts(mw, mwName, collectMidweekPersons)}</select>
            <span class="text-[9px] uppercase text-on-surface-variant/70 tracking-wider">ES</span>
          </div>`);
        } else if (mwName) {
          bits.push(`<div class="text-xs text-on-surface-variant mt-1">${escapeHtml(personNameOf(mwName))} <span class="text-[9px] uppercase">ES</span></div>`);
        }
        return bits.length ? bits.join('<div class="mt-1.5"></div>') : '<span class="text-on-surface-variant text-sm">—</span>';
      };
      return {
        i,
        fin,
        mw,
        sub: mw ? mw.header : (fin ? fmtShort(fin.w.saturday) : ''),
        cell,
      };
    });

    const thead = `<thead><tr class="bg-surface-container border-b border-outline-variant">
      <th class="p-4 font-label-md text-label-md text-secondary uppercase text-left whitespace-nowrap">Labor</th>
      ${columns.map(c => `<th class="p-4 font-label-md text-label-md text-secondary uppercase text-center whitespace-nowrap min-w-[130px]">
        <div>Sem. ${c.i + 1}</div>
        <div class="text-caption text-on-surface-variant normal-case font-normal">${escapeHtml(c.sub)}</div>
      </th>`).join('')}
    </tr></thead>`;
    const rows = [];
    for (const d of ATENCION_DEF) {
      for (let si = 0; si < d.count; si++) {
        const cells = columns.map(c => `<td class="p-4 text-center font-body-md text-body-md align-top">${c.cell(d.key, si)}</td>`).join('');
        rows.push(`<tr class="border-b border-outline-variant/40">
          <td class="p-4 font-body-md text-body-md text-on-surface whitespace-nowrap">${escapeHtml(d.label)}${d.count > 1 ? ` ${si + 1}` : ''}</td>
          ${cells}
        </tr>`);
      }
    }

    const title = embed
      ? ''
      : `<h1 class="font-display-lg text-display-lg text-primary mb-2">Atención</h1>
        <p class="font-body-lg text-body-lg text-on-surface-variant mb-4">Labores de atención (tras bambalinas) de ambas reuniones · ${MONTHS_ES[Number(cur.slice(5)) - 1]} ${cur.slice(0, 4)}.</p>`;

    const monthSelBlock = embed ? '' : `
      <div class="mt-4 max-w-xs">
        <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Mes</label>
        <select id="labMonth" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          ${allMonths.map(id => `<option value="${id}" ${id === cur ? 'selected' : ''}>${MONTHS_ES[Number(id.slice(5)) - 1]} ${id.slice(0, 4)}</option>`).join('')}
        </select>
      </div>`;

    root.innerHTML = `
      <div class="${embed ? 'mb-0' : 'mb-8'}">
        ${title}
        ${monthSelBlock}
        <div class="${embed ? '' : 'mt-4 '}flex items-center gap-5 text-xs text-on-surface-variant">
          <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded-full bg-primary"></span> Reunión de fin de semana</span>
          <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded-full bg-secondary"></span> Reunión de entre semana</span>
        </div>
      </div>
      <div id="crossAlerts" class="mb-4"></div>
      ${!program
        ? `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-10 text-center">
            <span class="material-symbols-outlined text-primary text-5xl mb-3 inline-block">work</span>
            <p class="text-on-surface-variant font-body-lg">No hay programa de atención para este mes.</p>
            <button id="laboresCreate" class="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-all active:scale-95">
              <span class="material-symbols-outlined text-[18px]">add_circle</span> Crear programa de atención
            </button>
          </div>`
        : columns.length === 0
          ? `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-10 text-center">
              <span class="material-symbols-outlined text-primary text-5xl mb-3 inline-block">work</span>
              <p class="text-on-surface-variant font-body-lg">No hay semanas para este mes.</p>
            </div>`
          : `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 md:p-8 overflow-x-auto">
              <table class="w-full text-left border-collapse min-w-[640px]">${thead}<tbody>${rows.join('')}</tbody></table>
            </div>`}
    `;

    const monthSel = $('#labMonth');
    if (monthSel) monthSel.onchange = (e) => go('atencion', { monthId: e.target.value });
    const createBtn = root.querySelector('#laboresCreate');
    if (createBtn) createBtn.onclick = createProgram;
    if (!program) return;

    root.querySelectorAll('select[data-atencion-wi]').forEach(sel => {
      sel.addEventListener('change', async () => {
        const wi = parseInt(sel.dataset.laboreWi, 10);
        const key = sel.dataset.laboreKey;
        const si = parseInt(sel.dataset.laboreSi, 10);
        const week = program.weeks[wi];
        if (!week) return;
        ensureAtencion(week);
        const val = sel.value;
        if (Array.isArray(week.labores[key])) week.labores[key][si] = val;
        else week.labores[key] = val;
        await db.putAtencion(program);
        await syncAssignmentLog();
        toast('Labor asignada', 'success');
        render();
      });
    });

    root.querySelectorAll('select[data-mwatencion-key]').forEach(sel => {
      sel.addEventListener('change', async () => {
        const key = sel.dataset.mwatencionKey;
        const si = parseInt(sel.dataset.mwatencionSi, 10);
        const mwId = sel.dataset.mwatencionId;
        const week = state.midweeks.find(m => String(m.id) === String(mwId));
        if (!week) return;
        ensureAtencion(week);
        const val = sel.value;
        if (Array.isArray(week.labores[key])) week.labores[key][si] = val;
        else week.labores[key] = val;
        await db.putMidweek(week);
        state.midweeks = await db.listMidweeks();
        await syncAssignmentLog();
        toast('Labor asignada', 'success');
        render();
      });
    });

    renderCrossAlerts(embed ? embed.querySelector('#crossAlerts') : $('#crossAlerts'), cur);
  };

  async function createProgram() {
    const year = Number(cur.slice(0, 4));
    const month = Number(cur.slice(5, 7));
    const weeks = saturdaysOf(year, month).map(d => ({ saturday: isoDate(d), labores: newAtencion() }));
    program = { id: cur, weeks };
    await db.putAtencion(program);
    toast('Programa de acomodación creado', 'success');
    render();
  }

  render();
}

/* ---------- ASEO: programa de aseo independiente por mes ---------- */
async function renderAtencionGrupo(monthId, opts = {}) {
  const embed = opts.embed;
  if (!embed) {
    state.month = null;
    renderTop();
  }
  const root = embed || $('#app');
  const aseos = await db.listAseos();
  const allMonths = aseos.map(a => a.id).sort((a, b) => b.localeCompare(a));
  const cur = (monthId && /^\d{4}-\d{2}$/.test(String(monthId))) ? String(monthId) : (allMonths[0] || isoDate(new Date()).slice(0, 7));
  let aseo = await db.getAseo(cur);

  const n = Number(state.config?.groups?.cantidad) || Math.max(state.departments.length, 1) || 1;
  const groupOpts = (curVal) => `<option value="">Elegir grupo</option>` +
    state.departments.map(d => `<option value="${d.id}" ${String(d.id) === String(curVal) ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('');
  const shortDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });

  const render = () => {
    const title = embed
      ? ''
      : `<h1 class="font-display-lg text-display-lg text-primary mb-2">Aseo</h1>
        <p class="font-body-lg text-body-lg text-on-surface-variant mb-4">Programa de aseo y hospitalidad · ${MONTHS_ES[Number(cur.slice(5)) - 1]} ${cur.slice(0, 4)}.</p>`;

    const monthSelBlock = embed ? '' : `
      <div class="mt-4 max-w-xs">
        <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Mes</label>
        <select id="labGrupoMonth" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          ${allMonths.map(id => `<option value="${id}" ${id === cur ? 'selected' : ''}>${MONTHS_ES[Number(id.slice(5)) - 1]} ${id.slice(0, 4)}</option>`).join('')}
        </select>
      </div>`;

    // Rows: cada semana es lunes-domingo; la primera semana tiene el selector y el
    // resto se muestra asignado en correlativo.
    const weeks = (aseo && aseo.weeks) || [];
    const rows = weeks.map((w, i) => {
      const range = `${shortDate(w.monday)} – ${shortDate(w.sunday)}`;
      let cell;
      if (i === 0) {
        cell = `<select data-wgroup="0" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${groupOpts(w.group)}</select>`;
      } else {
        const name = w.group ? deptNameOf(w.group) : '—';
        cell = `<span class="font-body-md text-body-md font-semibold text-on-surface">${escapeHtml(name)}</span>`;
      }
      return `<tr class="border-b border-outline-variant/40">
        <td class="p-4 whitespace-nowrap"><div class="font-headline-md text-headline-md text-primary">Semana ${i + 1}</div></td>
        <td class="p-4 font-body-md text-body-md text-on-surface">${escapeHtml(range)}</td>
        <td class="p-4 min-w-[220px]">${cell}</td>
      </tr>`;
    }).join('');

    root.innerHTML = `
      <div class="${embed ? 'mb-0' : 'mb-8'}">
        ${title}
        ${monthSelBlock}
      </div>
      ${!aseo
        ? `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-10 text-center">
            <span class="material-symbols-outlined text-primary text-5xl mb-3 inline-block">handshake</span>
            <p class="text-on-surface-variant font-body-lg">No hay programa de aseo para este mes.</p>
            <button id="aseoCreate" class="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-all active:scale-95">
              <span class="material-symbols-outlined text-[18px]">add_circle</span> Crear programa de aseo
            </button>
          </div>`
        : `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse min-w-[520px]">
                <thead><tr class="bg-surface-container border-b border-outline-variant">
                  <th class="p-4 font-label-md text-label-md text-secondary uppercase">Semana</th>
                  <th class="p-4 font-label-md text-label-md text-secondary uppercase">Lunes – Domingo</th>
                  <th class="p-4 font-label-md text-label-md text-secondary uppercase">Grupo de atención</th>
                </tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
            <p class="px-4 pb-4 text-on-surface-variant text-sm">Cada semana va de lunes a domingo (empieza con la reunión de entre semana); las semanas de borde se traslapan con el mes anterior/siguiente. El primer grupo se pre-llena con el siguiente del mes anterior (al llegar al grupo ${n} vuelve al 1).</p>
          </div>`}
    `;

    const monthSel = $('#labGrupoMonth');
    if (monthSel) monthSel.onchange = (e) => go('laboresGrupo', { monthId: e.target.value });

    const createBtn = root.querySelector('#aseoCreate');
    if (createBtn) createBtn.onclick = createProgram;

    root.querySelectorAll('select[data-wgroup]').forEach(sel => {
      sel.addEventListener('change', async () => {
        const startId = sel.value === '' ? '' : parseInt(sel.value, 10);
        let prevNum = startId ? aseoWeekGroupNum({ group: startId }) : null;
        aseo.weeks.forEach((w, i) => {
          if (i === 0) { w.group = startId; return; }
          if (prevNum == null) { w.group = ''; return; }
          prevNum = (prevNum % n) + 1;
          w.group = groupDeptForNum(prevNum);
        });
        await db.putAseo(aseo);
        toast('Rotación de aseo aplicada', 'success');
        render();
      });
    });
  };

  async function createProgram() {
    const year = Number(cur.slice(0, 4));
    const month = Number(cur.slice(5, 7));
    const weeks = aseoWeeksForMonth(year, month);
    const start = await nextAseoStart(cur, n);
    let prev = start;
    for (const w of weeks) {
      if (prev == null) { w.group = ''; continue; }
      w.group = groupDeptForNum(prev);
      prev = (prev % n) + 1;
    }
    aseo = { id: cur, weeks };
    await db.putAseo(aseo);
    toast('Programa de aseo creado', 'success');
    render();
  }

  render();
}

/* ---------- SALIDAS: programa de salidas independiente por mes ---------- */
async function renderSalidas(monthId, opts = {}) {
  const embed = opts.embed;
  if (!embed) { state.month = null; renderTop(); }
  const root = embed || $('#app');
  const all = await db.listSalidas();
  const allMonths = all.map(p => p.id).sort((a, b) => b.localeCompare(a));
  const cur = (monthId && /^\d{4}-\d{2}$/.test(String(monthId))) ? String(monthId) : (allMonths[0] || isoDate(new Date()).slice(0, 7));
  let program = await db.getSalidas(cur);
  if (program) state.month = { weeks: program.weeks, outings: program.congregations }; // reutiliza helpers

  const render = () => {
    const title = embed
      ? ''
      : `<h1 class="font-display-lg text-display-lg text-primary mb-2">Salidas</h1>
        <p class="font-body-lg text-body-lg text-on-surface-variant mb-4">Programa de salidas a congregaciones · ${MONTHS_ES[Number(cur.slice(5)) - 1]} ${cur.slice(0, 4)}.</p>`;

    const monthSelBlock = embed ? '' : `
      <div class="mt-4 max-w-xs">
        <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Mes</label>
        <select id="salidasMonth" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          ${allMonths.map(id => `<option value="${id}" ${id === cur ? 'selected' : ''}>${MONTHS_ES[Number(id.slice(5)) - 1]} ${id.slice(0, 4)}</option>`).join('')}
        </select>
      </div>`;

    const blocks = program ? (program.weeks || []).map((w, i) => {
      const date = new Date(w.saturday + 'T00:00:00');
      const dateStr = capitalize(date.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }));
      const occ = computeOutingConflicts({ weeks: program.weeks }, i);
      const rows = (w.outings || []).map((o, j) => outingRow(o, i, j, occ)).join('');
      return `<section class="bg-surface-container-lowest rounded-xl border border-outline-variant p-5 md:p-6">
        <div class="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h3 class="font-headline-md text-headline-md text-primary">Semana ${i + 1}</h3>
          <span class="px-3 py-1 bg-secondary-container text-on-secondary-container font-label-md text-label-md rounded-full">${escapeHtml(dateStr)}</span>
        </div>
        <div class="grid grid-cols-1 gap-4" data-outing-list="${i}">${rows}</div>
        <div class="mt-4 flex justify-end">
          <button data-outing-add="${i}" class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary text-on-secondary font-label-md text-label-md hover:bg-secondary-container transition-colors">
            <span class="material-symbols-outlined text-[18px]">person_add</span> Agregar orador
          </button>
        </div>
      </section>`;
    }).join('') : '';

    const congs = program ? (program.congregations || []).map((c, i) => congCard(c, i)).join('') : '';

    root.innerHTML = `
      <div class="${embed ? 'mb-0' : 'mb-8'}">
        ${title}
        ${monthSelBlock}
      </div>
      ${!program
        ? `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-10 text-center">
            <span class="material-symbols-outlined text-primary text-5xl mb-3 inline-block">campaign</span>
            <p class="text-on-surface-variant font-body-lg">No hay programa de salidas para este mes.</p>
            <button id="salidasCreate" class="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-all active:scale-95">
              <span class="material-symbols-outlined text-[18px]">add_circle</span> Crear programa de salidas
            </button>
          </div>`
        : `<div id="salidasCross" class="mb-4"></div>
           <section id="salidasCong" class="bg-surface-container-lowest rounded-xl border border-outline-variant p-5 md:p-6 mb-6">
            <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 class="font-headline-md text-headline-md text-primary flex items-center gap-2">
                <span class="material-symbols-outlined text-secondary">campaign</span> Datos de Salida
              </h2>
              <button id="addCongBtn" class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-secondary text-secondary font-label-md text-label-md hover:bg-secondary-fixed/60 transition-colors">
                <span class="material-symbols-outlined text-[18px]">add</span> Agregar congregación
              </button>
            </div>
            <div id="congList" class="grid grid-cols-1 md:grid-cols-2 gap-4">${congs}</div>
            <p class="text-on-surface-variant text-caption mt-3">Congregaciones visitadas en el mes; se incluyen en el programa de salidas.</p>
          </section>
          <div id="salidasList" class="space-y-6">${blocks}</div>
          <div class="mt-6 flex justify-end gap-3">
            <button id="salidasProgram" class="px-4 py-2.5 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed">Ver programa</button>
            <button id="salidasSave" class="px-6 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Guardar cambios</button>
          </div>`}
    `;

    const monthSel = $('#salidasMonth');
    if (monthSel) monthSel.onchange = (e) => go('salidas', { monthId: e.target.value });
    const createBtn = root.querySelector('#salidasCreate');
    if (createBtn) createBtn.onclick = createProgram;
    if (!program) return;

    // Congregaciones (datos de salida)
    const congWrap = embed ? embed.querySelector('#salidasCong') : $('#salidasCong');
    congWrap.querySelectorAll('[data-cong-field]').forEach(bindCongFieldChange);
    congWrap.querySelectorAll('[data-cong-del]').forEach(b => b.onclick = async () => {
      const i = parseInt(b.dataset.congDel, 10);
      if (program.congregations.length <= 1) { toast('Debe haber al menos una congregación', 'error'); return; }
      if (await confirmDialog('¿Eliminar esta congregación?')) { program.congregations.splice(i, 1); render(); }
    });
    const addCong = congWrap.querySelector('#addCongBtn');
    if (addCong) addCong.onclick = () => { program.congregations.push(newCongregation()); render(); };

    const list = embed ? embed.querySelector('#salidasList') : $('#salidasList');
    list.querySelectorAll('select[data-outing-field][data-people]').forEach(sel => {
      fillOutingPeople(sel);
      sel.addEventListener('change', () => {
        const [wi, oi] = sel.dataset.outingIdx.split('.').map(Number);
        program.weeks[wi].outings[oi].oradorSalida = sel.value === '' ? '' : parseInt(sel.value, 10);
        render();
      });
    });
    list.querySelectorAll('[data-talkpicker-out]').forEach(bindTalkPickerOut);
    list.querySelectorAll('[data-outing-add]').forEach(b => b.onclick = () => {
      const wi = parseInt(b.dataset.outingAdd, 10);
      program.weeks[wi].outings.push(newOuting());
      render();
    });
    list.querySelectorAll('[data-outing-del]').forEach(b => b.onclick = async () => {
      const [wi, oi] = b.dataset.outingDel.split('.').map(Number);
      if (program.weeks[wi].outings.length <= 1) { toast('Debe haber al menos un orador por semana', 'error'); return; }
      if (await confirmDialog('¿Eliminar este orador de la salida?')) {
        program.weeks[wi].outings.splice(oi, 1);
        render();
      }
    });

    const programBtn = embed ? embed.querySelector('#salidasProgram') : $('#salidasProgram');
    if (programBtn) programBtn.onclick = () => go('outings', { monthId: cur });
    const saveBtn = embed ? embed.querySelector('#salidasSave') : $('#salidasSave');
    if (saveBtn) saveBtn.onclick = async () => { await db.putSalidas(program); await syncAssignmentLog(); toast('Salidas guardadas', 'success'); };

    renderCrossAlerts(embed ? embed.querySelector('#salidasCross') : $('#salidasCross'), cur);
  };

  async function createProgram() {
    const year = Number(cur.slice(0, 4));
    const month = Number(cur.slice(5, 7));
    const weeks = saturdaysOf(year, month).map(d => ({ saturday: isoDate(d), outings: [newOuting()] }));
    program = { id: cur, congregations: [newCongregation()], weeks };
    await db.putSalidas(program);
    state.month = { weeks: program.weeks, outings: program.congregations };
    toast('Programa de salidas creado', 'success');
    render();
  }

  render();
}

/* ---------- VISTA MENSUAL GENERAL: agrupa ambas reuniones por semana ---------- */
async function renderGeneralMonth(monthId, opts = {}) {
  const embed = opts.embed;
  if (!embed) { state.month = null; renderTop(); }
  const root = embed || $('#app');

  // Con `opts.data` se renderiza con datos en memoria (p. ej. una propuesta sin
  // persistir). Cada store que falte en `data` cae al valor de la BD.
  const data = opts.data || null;
  const months = data && data.months != null ? data.months : await db.listMonths();
  const midweeks = data && data.midweeks != null ? data.midweeks : state.midweeks;
  const aseos = data && data.aseos != null ? data.aseos : await db.listAseos();
  const salidasList = data && data.salidas != null ? data.salidas : await db.listSalidas();
  const laboresList = data && data.atencion != null ? data.atencion : await db.listAtencion();
  const monthsArr = [...months].sort((a, b) => b.id.localeCompare(a.id));

  const mwMonths = [...new Set(midweeks.map(m => String(m.id).slice(0, 7)))];
  const allMonths = [...new Set([...monthsArr.map(m => m.id), ...mwMonths])].sort((a, b) => b.localeCompare(a));
  const cur = (monthId && /^\d{4}-\d{2}$/.test(String(monthId))) ? String(monthId) : (allMonths[0] || isoDate(new Date()).slice(0, 7));
  const month = monthsArr.find(m => m.id === cur) || null;

  // Cada semana de la organización (domingo que la cierra) agrupa su reunión de
  // entre semana (lunes) y su reunión de fin de semana (sábado).
  const weekSunday = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 6);
    return isoDate(d);
  };
  const finBySunday = new Map();
  ((month && month.weeks) || []).forEach(w => finBySunday.set(weekSunday(w.date), w));
  const mwBySunday = new Map();
  midweeks.forEach(m => mwBySunday.set(weekSunday(m.id), m));

  const aseoBySunday = new Map();
  aseos.forEach(a => (a.weeks || []).forEach(w => aseoBySunday.set(weekSunday(w.saturday), w)));
  const salidasBySunday = new Map();
  salidasList.forEach(p => (p.weeks || []).forEach(w => salidasBySunday.set(weekSunday(w.saturday), w)));
  const laboresBySunday = new Map();
  laboresList.forEach(p => (p.weeks || []).forEach(w => laboresBySunday.set(weekSunday(w.saturday), w)));

  // La semana se incluye si cualquiera de los programas la tiene (todos se unen).
  const sundays = [...new Set([
    ...finBySunday.keys(), ...mwBySunday.keys(),
    ...aseoBySunday.keys(), ...salidasBySunday.keys(), ...laboresBySunday.keys(),
  ])].filter(s => s.startsWith(cur)).sort();

  const boxes = sundays.map((sunday, i) => {
    const fin = finBySunday.get(sunday) || null;
    const mw = mwBySunday.get(sunday) || null;
    const aseoWeek = aseoBySunday.get(sunday) || null;
    const salidasWeek = salidasBySunday.get(sunday) || null;
    const laboresWeek = laboresBySunday.get(sunday) || null;
    const saturday = fin ? fin.date : (aseoWeek ? aseoWeek.saturday : (laboresWeek ? laboresWeek.saturday : (salidasWeek ? salidasWeek.saturday : null)));
    return generalWeekBox({
      fin,
      mw,
      i,
      aseoGroup: aseoWeek && aseoWeek.group ? aseoWeek.group : null,
      outings: salidasWeek ? (salidasWeek.outings || []) : null,
      finLabores: laboresWeek || null,
      sunday,
      saturday,
    });
  });

  const title = embed ? '' : `
    <h1 class="font-display-lg text-display-lg text-primary mb-2">Vista Mensual General</h1>
    <p class="font-body-lg text-body-lg text-on-surface-variant mb-4">Todas las reuniones del mes, semana por semana.</p>`;

  const monthSelBlock = embed ? '' : `
    <div class="mt-4 max-w-xs">
      <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Mes</label>
      <select id="generalMonth" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
        ${allMonths.map(id => `<option value="${id}" ${id === cur ? 'selected' : ''}>${MONTHS_ES[Number(id.slice(5)) - 1]} ${id.slice(0, 4)}</option>`).join('')}
      </select>
    </div>`;

  root.innerHTML = `
    <div class="${embed ? 'mb-0' : 'mb-8'}">
      ${title}
      ${monthSelBlock}
    </div>
    ${boxes.length
      ? `<div class="space-y-6">${boxes.join('')}</div>`
      : `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-10 text-center">
          <span class="material-symbols-outlined text-primary text-5xl mb-3 inline-block">calendar_month</span>
          <p class="text-on-surface-variant font-body-lg">No hay programas ni reuniones de entre semana cargados para este mes.</p>
        </div>`}
  `;
  const monthSel = $('#generalMonth');
  if (monthSel) monthSel.onchange = (e) => go('general', { monthId: e.target.value });
}

// Cuadro de una semana en la vista mensual general.
function generalWeekBox({ fin, mw, i, aseoGroup, outings, finLabores, sunday, saturday }) {
  const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
  const header = mw ? mw.header : (fin ? fmt(fin.date) : (saturday ? fmt(saturday) : (sunday ? fmt(sunday) : '')));
  return `
  <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-5 md:p-6">
    <div class="flex items-center justify-between gap-3 flex-wrap mb-4">
      <h3 class="font-headline-md text-headline-md text-primary">Semana ${i + 1}</h3>
      <span class="px-3 py-1 bg-secondary-container text-on-secondary-container font-label-md text-label-md rounded-full">${escapeHtml(header)}</span>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="rounded-lg border border-outline-variant p-4">
        <p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-3 flex items-center gap-2">
          <span class="material-symbols-outlined text-[18px]">auto_stories</span> Entre Semana
        </p>
        ${mw ? generalEsContent(mw) : '<p class="text-sm text-on-surface-variant">Sin reunión de entre semana.</p>'}
      </div>
      <div class="rounded-lg border border-outline-variant p-4">
        <p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-3 flex items-center gap-2">
          <span class="material-symbols-outlined text-[18px]">record_voice_over</span> Fin de Semana
        </p>
        ${fin ? generalFsContent(fin, outings) : '<p class="text-sm text-on-surface-variant">Sin programa de fin de semana.</p>'}
      </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      <div class="rounded-lg border border-outline-variant p-4">${generalLabores({ fin, mw, finLabores })}</div>
      <div class="rounded-lg border border-outline-variant p-4 flex flex-col justify-center">${generalGroup(fin, aseoGroup)}</div>
    </div>
  </div>`;
}

// Reunión de entre semana compacta para el cuadro semanal.
function generalEsContent(w) {
  const assigned = (sec, p) => {
    const ap = p.assignments || {};
    return mwSlotsFor(sec, p).map(s => { const v = ap[s.key]; return v ? personNameOf(v) : null; }).filter(Boolean).join(' · ');
  };
  const section = (sec) => {
    const parts = (sec.parts || []).map(p => {
      const nm = assigned(sec, p);
      return `<div class="flex items-baseline justify-between gap-2 py-[2px]">
        <span class="text-xs text-on-surface">${p.num}. ${escapeHtml(p.title)} <span class="text-on-surface-variant">(${p.mins})</span></span>
        <span class="text-xs font-semibold text-on-surface text-right whitespace-nowrap">${nm ? escapeHtml(nm) : ''}</span>
      </div>`;
    }).join('');
    return `<div class="mb-2">
      <p class="font-label-md text-label-md text-secondary uppercase text-[10px] tracking-wider mb-0.5">${escapeHtml(sec.title)}</p>
      ${parts}
    </div>`;
  };
  const introSong = w.introSong || w.songIn;
  return `
    <div class="text-center mb-2">
      <div class="font-bold text-on-surface text-sm">${escapeHtml(w.header)}</div>
      <div class="text-xs text-on-surface-variant">Lectura: ${escapeHtml(w.reading || '—')}</div>
      <div class="text-xs text-on-surface-variant">Presidente: ${escapeHtml(personNameOf(w.presidente))}</div>
      <div class="text-[11px] text-on-surface-variant mt-1">♪ ${escapeHtml(introSong || '—')} · ${escapeHtml(w.introTitle || '')} (${w.introMins || 1} min.)</div>
    </div>
    ${section((w.sections || []).find(s => s.id === 'tesoros'))}
    ${section((w.sections || []).find(s => s.id === 'maestros'))}
    ${section((w.sections || []).find(s => s.id === 'vida'))}
    <div class="text-[11px] text-on-surface-variant border-t border-outline-variant/30 pt-1 mt-1">${escapeHtml(w.closingTitle || 'Palabras de conclusión')} (${w.closingMins || 3} mins.) · ♪ ${escapeHtml(w.songOut || '—')}</div>`;
}

// Reunión de fin de semana compacta para el cuadro semanal.
function generalFsContent(w, outings) {
  if (w.type === 'assembly') return `<div class="flex flex-col items-center justify-center py-6 text-center">
    <span class="material-symbols-outlined text-primary text-4xl mb-2">event_busy</span>
    <p class="text-on-surface-variant text-sm">Asamblea · sin reunión local.</p>
  </div>`;
  const rows = [];
  if (w.type === 'normal') {
    rows.push(['Presidente', personNameOf(w.presidente)]);
    rows.push(['Discurso', w.tituloDiscurso || '—']);
    rows.push(['Orador', w.orador || '—']);
    rows.push(['Conductor', personNameOf(w.conductor)]);
    rows.push(['Lector', personNameOf(w.lector)]);
    const salidas = outings != null ? outings : (w.outings || []);
    salidas.forEach((o, j) => rows.push([`Salida ${j + 1}`, `${personNameOf(o.oradorSalida)}${o.tituloDiscurso ? ' · ' + o.tituloDiscurso : ''}`]));
  } else if (w.type === 'supervisor') {
    rows.push(['Presidente', personNameOf(w.presidente)]);
    rows.push(['Superintendente', w.nombreSupervisor || '—']);
    rows.push(['Discurso público', w.discursoSupervisor1 || '—']);
    rows.push(['Estudio (sin lectura)', personNameOf(w.estudioSinLectura)]);
    rows.push(['Discurso de servicio', w.discursoSupervisor2 || '—']);
  } else if (w.type === 'commemoration') {
    rows.push(['Discurso', w.tituloDiscurso || '—']);
    rows.push(['Presidente', personNameOf(w.presidente)]);
    rows.push(['Orador', w.orador || '—']);
  }
  return `<div class="flex items-center gap-2 mb-2">
    <span class="material-symbols-outlined text-secondary text-[18px]">${WEEK_TYPES[w.type].icon}</span>
    <span class="font-label-md text-label-md text-secondary uppercase">${WEEK_TYPES[w.type].label}</span>
  </div>` +
    rows.map(([k, v]) => `<div class="flex justify-between gap-3 py-1 border-b border-outline-variant/20 last:border-0">
      <span class="text-xs text-on-surface-variant whitespace-nowrap">${k}</span>
      <span class="text-sm font-semibold text-on-surface text-right">${escapeHtml(String(v))}</span>
    </div>`).join('');
}

// Labores combinadas (fin de semana FS + entre semana ES) del cuadro semanal.
function generalLabores({ fin, mw, finLabores }) {
  const slot = (week, key, si) => {
    const l = ensureAtencion(week).labores;
    return (Array.isArray(l[key]) ? l[key][si] : (si === 0 ? l[key] : '')) || '';
  };
  const fsWeek = finLabores || fin; // el fin de semana sale del programa de acomodación
  const rows = ATENCION_DEF.map(({ key, label, count }) => {
    const bits = [];
    for (let si = 0; si < count; si++) {
      const finName = fsWeek ? slot(fsWeek, key, si) : '';
      const mwName = mw ? slot(mw, key, si) : '';
      const parts = [];
      if (finName) parts.push(`${escapeHtml(personNameOf(finName))} <span class="text-[9px] uppercase text-on-surface-variant">FS</span>`);
      if (mwName) parts.push(`${escapeHtml(personNameOf(mwName))} <span class="text-[9px] uppercase text-on-surface-variant">ES</span>`);
      bits.push(`<div class="flex justify-between gap-2 text-xs">
        <span class="text-on-surface-variant">${label}${count > 1 ? ` ${si + 1}` : ''}</span>
        <span class="font-semibold text-on-surface text-right">${parts.length ? parts.join(' · ') : '—'}</span>
      </div>`);
    }
    return bits.join('');
  }).join('');
  return `<div class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-3 flex items-center gap-2">
    <span class="material-symbols-outlined text-[18px]">work</span> Labores
  </div>${rows}`;
}

// Grupo de atención de la semana (a la derecha del cuadro).
function generalGroup(fin, aseoGroup) {
  const grupo = aseoGroup ? deptNameOf(aseoGroup) : ((fin && fin.departamento) ? deptNameOf(fin.departamento) : '—');
  const desc = state.config?.groups?.labores || '';
  return `
    <div class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-3 flex items-center gap-2">
      <span class="material-symbols-outlined text-[18px]">handshake</span> Grupo de la semana
    </div>
    <div class="text-center">
      <div class="font-headline-lg text-[40px] leading-none text-primary">${escapeHtml(grupo)}</div>
      ${desc ? `<p class="text-xs text-on-surface-variant mt-2">${escapeHtml(desc)}</p>` : ''}
    </div>`;
}

/* ---------- MIDWEEK: editor de una semana ---------- */
// Mapea cada parte de entre semana a sus puestos y al rol que la cubre
// (lógica compartida con el algoritmo, en logic.js).
function mwSlotsFor(sec, part) {
  return midweekSlotsOf(sec, part);
}

async function renderMidweek(id) {
  state.month = null;
  renderTop();
  const app = $('#app');
  const week = state.midweeks.find(w => String(w.id) === String(id));
  if (!week) {
    app.innerHTML = `<h1 class="font-headline-lg text-headline-lg text-primary mb-6">Semana no encontrada</h1>
      <button class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md hover:opacity-90" onclick="location.hash='#/midweeks'">Volver</button>`;
    return;
  }

  app.innerHTML = `
    <div class="flex items-center gap-3 mb-2">
      <button data-back class="material-symbols-outlined p-2 text-on-surface-variant hover:text-primary rounded-full">arrow_back</button>
      <div>
        <h1 class="font-headline-lg text-headline-lg text-primary">${escapeHtml(week.header)}</h1>
        <p class="text-on-surface-variant font-label-md">Lectura bíblica: ${escapeHtml(week.reading || '—')}</p>
      </div>
    </div>
    <div id="mwCross" class="mt-4"></div>
    <div id="mwEditor" class="mt-6 space-y-6" data-mwid="${escapeAttr(id)}"></div>
    <div class="sticky bottom-0 bg-surface py-4 mt-8 flex gap-3 justify-end">
      <button id="mwPreviewBtn" class="px-5 py-3 rounded-lg border border-secondary text-secondary font-label-md text-label-md hover:bg-secondary-container transition-all active:scale-95">Vista Final</button>
      <button id="mwSave" class="px-6 py-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-all active:scale-95">Guardar asignaciones</button>
    </div>
  `;
  $('[data-back]').onclick = () => go('midweeks');
  $('#mwPreviewBtn').onclick = () => go('midweekPreview', { monthId: id });

  const editor = $('#mwEditor');
  const presOpts = ['<option value="">— Sin asignar —</option>'];
  const presList = state.people.filter(p => !Array.isArray(p.labores) || p.labores.length === 0 || p.labores.includes('presidente'));
  for (const person of presList) {
    presOpts.push(`<option value="${person.id}" ${String(week.presidente) === String(person.id) ? 'selected' : ''}>${escapeHtml(person.name)}</option>`);
  }
  editor.innerHTML = `
    <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-5 md:p-6">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-headline-md text-headline-md text-primary">Presidente</h2>
      </div>
      <select data-mw-presidente class="mwSel w-full bg-surface-bright border ${!week.presidente ? 'border-error' : 'border-outline-variant'} rounded-lg p-2.5 font-body-md focus:border-primary">${presOpts.join('')}</select>
      ${!week.presidente ? `<div class="mt-2 text-xs text-on-surface-variant" data-mwsugwrap="presidente">Sugerencias: ${mwSuggestChips(week, 'presidente', [], (p) => !Array.isArray(p.labores) || p.labores.length === 0 || p.labores.includes('presidente'), (list) => list)}</div>` : ''}
    </div>` + (week.sections || []).map((sec, si) => {
    const parts = (sec.parts || []).map(p => {
      const slots = mwSlotsFor(sec, p);
      const ap = p.assignments || {};
      const slotFields = slots.map(s => {
        const cur = ap[s.key];
        const opts = ['<option value="">— Sin asignar —</option>'];
        // Las partes de estudiante aceptan a cualquier estudiante (cualquier rol de
        // estudiante o sin labores); el resto de puestos filtra por su labor exacta.
        const roleFilter = isStudentLabore(s.labore) ? isStudentPerson : s.labore;
        const list = eligiblePeople(week, state.people, roleFilter, cur, collectMidweekPersons);
        for (const person of list) {
          opts.push(`<option value="${person.id}" ${String(cur) === String(person.id) ? 'selected' : ''}>${escapeHtml(person.name)}</option>`);
        }
        const missing = !cur;
        return `<div class="flex-1 min-w-[160px]">
          <label class="block font-label-md text-label-md text-on-surface-variant mb-1">${escapeHtml(s.label)} ${missing ? '<span class="text-error font-bold text-[10px] uppercase ml-1">Falta</span>' : ''}<span data-mwbadge="${si}.${p.num}.${s.key}" class="mw-conflict-badge hidden items-center gap-1 text-error font-bold text-[10px] uppercase conflict-dot"><span class="material-symbols-outlined text-[14px]">warning</span> Conflicto</span></label>
          <select data-sec="${si}" data-part="${p.num}" data-slot="${s.key}"
            class="mwSel w-full bg-surface-bright border ${missing ? 'border-error' : 'border-outline-variant'} rounded-lg p-2.5 font-body-md focus:border-primary">${opts.join('')}</select>
          ${missing ? `<div class="mt-1.5 flex flex-wrap gap-1 text-[11px]" data-mwsugwrap="${si}.${p.num}.${s.key}">${mwSuggestChips(week, `${si}.${p.num}.${s.key}`, list, roleFilter, collectMidweekPersons)}</div>` : ''}
        </div>`;
      }).join('');
      return `<div class="flex flex-col md:flex-row gap-3 md:items-center md:gap-4 bg-surface-container-low rounded-lg p-4 border border-outline-variant">
        <div class="min-w-[32px] h-8 px-2 rounded-full bg-primary text-on-primary flex items-center justify-center font-label-md text-label-md">${p.num}</div>
        <div class="flex-1">
          <p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">${p.mins} min</p>
          <p class="font-body-lg text-body-lg text-on-surface">${escapeHtml(p.title)}</p>
          ${pairWarning(sec, p)}
        </div>
        <div class="flex-1 flex flex-wrap gap-3">${slotFields}</div>
      </div>`;
    }).join('');
    return `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-5 md:p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-headline-md text-headline-md text-primary">${escapeHtml(sec.title)}</h2>
        <span class="text-sm text-on-surface-variant font-label-md">${sec.parts.reduce((a, p) => a + p.mins, 0)} min</span>
      </div>
      <div class="space-y-4">${parts}</div>
    </div>`;
  }).join('');

  mwRefreshConflicts(editor, week);
  editor.querySelectorAll('select[data-mw-presidente], select.mwSel').forEach(bindMwChange);
  editor.querySelectorAll('button[data-mwsug]').forEach(btn => {
    btn.onclick = () => {
      const key = btn.dataset.mwsug;
      const pid = btn.dataset.mwsugId;
      let sel;
      if (key === 'presidente') sel = editor.querySelector('select[data-mw-presidente]');
      else {
        const [si, part, slot] = key.split('.');
        sel = editor.querySelector(`select[data-sec="${si}"][data-part="${part}"][data-slot="${slot}"]`);
      }
      if (!sel) return;
      if (![...sel.options].some(o => String(o.value) === pid)) {
        sel.add(new Option(personNameOf(pid), pid));
      }
      sel.value = pid;
      btn.closest('[data-mwsugwrap]')?.remove();
      sel.dispatchEvent(new Event('change'));
    };
  });

  renderCrossAlerts($('#mwCross'), String(id).slice(0, 7));

  $('#mwSave').onclick = async () => {
    const dup = mwCurrentDupKeys(editor);
    if (dup.size) {
      mwRefreshConflicts(editor, week);
      toast('Hay personas repetidas en esta reunión. Revise los campos resaltados.', 'error');
      return;
    }
    const pairs = mwPairErrors(editor);
    if (pairs.length) {
      toast(`Pareja no compatible: ${pairs[0].a.name} / ${pairs[0].b.name}. Revise la asignación.`, 'error');
      return;
    }
    week.sections.forEach((sec, si) => {
      sec.parts.forEach(p => {
        const slots = mwSlotsFor(sec, p);
        const ap = { ...(p.assignments || {}) };
        for (const f of slots) {
          const sel = editor.querySelector(`[data-sec="${si}"][data-part="${p.num}"][data-slot="${f.key}"]`);
          ap[f.key] = sel ? sel.value : ap[f.key];
        }
        p.assignments = ap;
      });
    });
    week.labores = ensureAtencion(week).labores;
    const presSel = editor.querySelector('select[data-mw-presidente]');
    if (presSel) week.presidente = presSel.value;
    await db.putMidweek(week);
    state.midweeks = await db.listMidweeks();
    await syncAssignmentLog();
    toast('Asignaciones guardadas', 'success');
    renderMidweek(id);
  };
}

/* ---------- MIDWEEK: detección de personas duplicadas (en vivo) ---------- */

// Relee los valores actuales de todos los selects (partes) del editor
// y devuelve el conjunto de keys con persona duplicada dentro de la reunión.
function mwCurrentDupKeys(editor) {
  const persons = [];
  const pres = editor.querySelector('select[data-mw-presidente]');
  if (pres && pres.value) persons.push({ value: String(pres.value), key: 'mw_presidente' });
  editor.querySelectorAll('select.mwSel').forEach(sel => {
    if (sel.value) persons.push({
      value: String(sel.value),
      key: `mw_${sel.dataset.sec}_${sel.dataset.part}_${sel.dataset.slot}`,
    });
  });
  return dedupPersons(persons).dupKeys;
}

// Devuelve las parejas incompatibles actuales (partes de a 2) leyendo el DOM.
// Resultado: [{ part, a, b }]
function mwPairErrors(editor) {
  const byPart = {};
  editor.querySelectorAll('select.mwSel').forEach(sel => {
    if (!sel.value) return;
    // La compatibilidad de pareja solo aplica a las presentaciones (asignacion2);
    // el Estudio Bíblico de la Congregación solo exige el rol.
    if (sel.dataset.slot !== 'estudiante' && sel.dataset.slot !== 'ayudante') return;
    const key = `${sel.dataset.sec}.${sel.dataset.part}`;
    (byPart[key] ||= []).push({ slot: sel.dataset.slot, id: sel.value });
  });
  const errors = [];
  Object.values(byPart).forEach(items => {
    const ids = items.map(x => x.id).filter(Boolean);
    if (ids.length < 2) return;
    const a = personOf(ids[0]), b = personOf(ids[1]);
    if (a && b && !canBePair(a, b)) errors.push({ a, b });
  });
  return errors;
}

// Estiliza selects duplicados y muestra un rótulo "Conflicto" parpadeante junto
// al campo, igual que en la reunión de fin de semana. Mantiene el borde rojo de
// los puestos vacíos (falta asignar).
function mwRefreshConflicts(editor, week) {
  const dup = mwCurrentDupKeys(editor);

  // rótulo de conflicto junto a cada campo (pads)
  editor.querySelectorAll('span[data-mwbadge]').forEach(badge => {
    const keyExpanded = `mw_${badge.dataset.mwbadge.split('.').join('_')}`;
    const isDup = dup.has(keyExpanded);
    badge.classList.toggle('hidden', !isDup);
    badge.classList.toggle('inline-flex', isDup);
  });

  // selects (pads + presidente): borde rojo en duplicados o puestos vacíos
  editor.querySelectorAll('select.mwSel, select[data-mw-presidente]').forEach(sel => {
    let key;
    if (sel.classList.contains('mwSel')) key = `mw_${sel.dataset.sec}_${sel.dataset.part}_${sel.dataset.slot}`;
    else key = 'mw_presidente';
    const isDup = dup.has(key);
    const isMissing = !sel.value;
    sel.classList.toggle('border-error', isDup || isMissing);
    sel.classList.toggle('border-outline-variant', !isDup && !isMissing);
    // ocultar el rótulo "Falta" cuando el puesto ya tiene asignación
    const wrap = sel.closest('.flex-1.min-w-\\[160px\\]');
    if (wrap) {
      const label = wrap.querySelector('label');
      if (label) {
        const falta = [...label.children].find(n => n.textContent.trim() === 'Falta');
        if (falta) falta.remove();
      }
    }
  });
}

// Sugerencias de nombres para completar un puesto vacío de la reunión de entre
// semana. `key`: 'presidente' o "${si}.${partNum}.${slot}". `list`: personas ya
// filtradas y elegibles (para presidente se calcula aquí). Genera chips que al
// pulsarlos asignan la persona al puesto correspondiente.
function mwSuggestChips(week, key, list, roleFilter, collector) {
  const people = (list && list.length) ? list : (key === 'presidente'
    ? eligiblePeople(week, state.people, 'presidente', '', collectMidweekPersons)
    : eligiblePeople(week, state.people, roleFilter, '', collector || collectMidweekPersons));
  const top = people.slice(0, 6);
  if (!top.length) return '<span class="text-error">Sin personas libres</span>';
  return top.map(p =>
    `<button type="button" data-mwsug="${key}" data-mwsug-id="${p.id}"
      class="px-2 py-0.5 rounded-full bg-primary-fixed/70 text-primary border border-primary/30 text-[11px] font-label-md hover:bg-primary hover:text-on-primary transition-colors">${escapeHtml(p.name.split(' ')[0])} ${escapeHtml((p.name.split(' ')[1] || '').slice(0, 1))}</button>`
  ).join('');
}

function bindMwChange(node) {
  node.addEventListener('change', () => {
    const editor = $('#mwEditor');
    const id = editor?.dataset.mwid;
    const wk = state.midweeks.find(w => String(w.id) === String(id));
    mwRefreshConflicts(editor, wk || {});
  });
}

/* ---------- MIDWEEK: vista final (documento imprimible) ---------- */
async function renderMidweekPreview(id) {
  state.month = null;
  renderTop();
  const app = $('#app');
  const week = state.midweeks.find(w => String(w.id) === String(id));
  if (!week) {
    app.innerHTML = `<h1 class="font-headline-lg text-headline-lg text-primary mb-6">Semana no encontrada</h1>
      <button class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md hover:opacity-90" onclick="location.hash='#/midweeks'">Volver</button>`;
    return;
  }

  app.innerHTML = `
    <div class="flex items-center justify-between gap-4 mb-6 no-print">
      <div class="flex items-center gap-3">
        <button data-back class="material-symbols-outlined p-2 text-on-surface-variant hover:text-primary rounded-full">arrow_back</button>
        <h1 class="font-headline-lg text-headline-lg text-primary">Vista Final · ${escapeHtml(week.header)}</h1>
      </div>
      <div class="flex gap-2">
        <button id="mwPrint" class="flex items-center gap-2 px-4 py-2 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-all active:scale-95">
          <span class="material-symbols-outlined text-[20px]">print</span> Imprimir
        </button>
        <button id="mwPdf" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-all active:scale-95">
          <span class="material-symbols-outlined text-[20px]">picture_as_pdf</span> Exportar PDF
        </button>
      </div>
    </div>
    <div id="mwPreviewContent"></div>
  `;
  $('[data-back]').onclick = () => go('midweek', { monthId: id });
  $('#mwPrint').onclick = () => window.print();
  $('#mwPdf').onclick = () => window.print();

  $('#mwPreviewContent').innerHTML = midweekPreviewDocument(week);
}

function midweekPreviewDocument(w) {
  return `<div id="mwDoc" class="page-container rounded-lg" style="max-width:800px;margin:0 auto;background:#fff;padding:2rem 3rem;box-shadow:0 4px 6px -1px rgba(0,0,0,.1);">${midweekBlockContent(w)}</div>`;
}

// Contenido de una semana de entre semana (cabecera + secciones + conclusión).
// Reutilizado por la vista final de una semana y por la vista final mensual.
function midweekBlockContent(w) {
  const assigned = (sec, p) => {
    const ap = p.assignments || {};
    const slots = mwSlotsFor(sec, p);
    const names = slots.map(s => {
      const v = ap[s.key];
      return v ? personNameOf(v) : null;
    }).filter(Boolean);
    return names.length ? `<span class="text-gray-600 italic">· ${names.join(' — ')}</span>` : '';
  };

  const sectionBlock = (sec, color) => {
    const parts = (sec.parts || []).map(p => `
      <div class="px-4 mb-4">
        <p class="font-bold" style="color:${color.strong}">${p.num}. ${escapeHtml(p.title)}</p>
        <p class="text-gray-600 text-sm ml-4">(${p.mins} mins.) ${assigned(sec, p)}</p>
      </div>`).join('');
    const song = sec.song ? `
      <div class="flex items-center text-sm mb-6 ml-4">
        <span class="text-blue-custom mr-2">♪</span>
        <span class="font-bold text-blue-custom">Canción ${escapeHtml(sec.song)}</span>
      </div>` : '';
    return `
    <section class="mb-8">
      <div class="flex items-center mb-2">
        <span class="text-white rounded-sm mr-2 flex items-center justify-center w-6 h-6" style="background-color:${color.strong}">${color.icon}</span>
        <h2 class="text-lg font-bold uppercase tracking-wide" style="color:${color.strong}">${escapeHtml(sec.title)}</h2>
      </div>
      <div class="mw-sep mb-4"></div>
      ${song}
      ${parts}
    </section>`;
  };

  const introSong = w.introSong || w.songIn;
  return `
    <header class="mb-4">
      <h1 class="text-2xl font-bold text-gray-600 mb-1">${escapeHtml(w.header)}</h1>
      <p class="text-blue-custom font-bold text-lg mb-2">${escapeHtml(w.reading || '')}</p>
      <p class="text-gray-600 text-sm mb-2">Presidente: ${escapeHtml(personNameOf(w.presidente))}</p>
      <div class="mw-sep mb-3"></div>
      <div class="flex items-center text-sm mb-6">
        <span class="text-blue-custom mr-2">♪</span>
        <span class="font-bold text-blue-custom">Canción ${escapeHtml(introSong || '')}</span>
        <span class="mx-1 text-gray-500">y oración |</span>
        <span class="font-bold mr-1">${escapeHtml(w.introTitle || 'Palabras de introducción')}</span>
        <span class="text-gray-500">(${w.introMins || 1} min.)</span>
      </div>
    </header>
    ${sectionBlock((w.sections || []).find(s => s.id === 'tesoros'), { strong: '#0f7685', icon: '◆' })}
    ${sectionBlock((w.sections || []).find(s => s.id === 'maestros'), { strong: '#b8860b', icon: '✚' })}
    ${sectionBlock((w.sections || []).find(s => s.id === 'vida'), { strong: '#9e2a2b', icon: '▦' })}
    <footer>
      <div class="mw-sep mb-3"></div>
      <div class="flex items-center text-sm">
        <span class="font-bold mr-1">${escapeHtml(w.closingTitle || 'Palabras de conclusión')}</span>
        <span class="text-gray-500 mr-1">(${w.closingMins || 3} mins.) |</span>
        <span class="text-blue-custom mr-1">♪</span>
        <span class="font-bold text-blue-custom">Canción ${escapeHtml(w.songOut || '')}</span>
        <span class="font-bold mx-1">y oración</span>
      </div>
    </footer>`;
}

/* ---------- MIDWEEK: vista final mensual (todas las reuniones del mes) ---------- */
async function renderMidweekMonthPreview(monthId) {
  state.month = null;
  renderTop();
  const app = $('#app');
  const cur = monthId || state.mwMonth || '';
  const weeks = state.midweeks
    .filter(m => String(m.id).startsWith(cur))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!weeks.length) {
    app.innerHTML = `<h1 class="font-headline-lg text-headline-lg text-primary mb-6">Vista Final Mensual</h1>
      <p class="text-on-surface-variant font-body-lg text-body-lg mb-6">No hay reuniones de entre semana cargadas para este mes.</p>
      <button class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md hover:opacity-90" onclick="location.hash='#/midweeks'">Volver</button>`;
    return;
  }
  const monthLabel = `${MONTHS_ES[Number(cur.slice(5)) - 1]} ${cur.slice(0, 4)}`;
  app.innerHTML = `
    <div class="flex items-center justify-between gap-4 mb-6 no-print">
      <div class="flex items-center gap-3">
        <button data-back class="material-symbols-outlined p-2 text-on-surface-variant hover:text-primary rounded-full">arrow_back</button>
        <h1 class="font-headline-lg text-headline-lg text-primary">Vista Final Mensual · ${monthLabel}</h1>
      </div>
      <div class="flex gap-2">
        <button id="mwMPrint" class="flex items-center gap-2 px-4 py-2 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-all active:scale-95">
          <span class="material-symbols-outlined text-[20px]">print</span> Imprimir
        </button>
        <button id="mwMPdf" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-all active:scale-95">
          <span class="material-symbols-outlined text-[20px]">picture_as_pdf</span> Exportar PDF
        </button>
      </div>
    </div>
    <div id="mwMonthContent"></div>
  `;
  $('[data-back]').onclick = () => go('midweeks');
  $('#mwMPrint').onclick = () => window.print();
  $('#mwMPdf').onclick = () => window.print();
  $('#mwMonthContent').innerHTML = midweekMonthDocument(weeks, monthLabel);
}

// Documento del mes: una sola hoja compacta con todas las semanas a 2 columnas
// (aprovecha los espacios laterales y reduce el alto vertical).
function midweekMonthDocument(weeks, monthLabel) {
  return `
  <div id="mwDoc" class="mw-month-doc" style="max-width:1100px;margin:0 auto;background:#fff;padding:1.5rem 2rem;box-shadow:0 4px 6px -1px rgba(0,0,0,.1);">
    <header class="text-center mb-4">
      <h1 class="text-xl font-bold text-gray-700 mb-1">${escapeHtml(monthLabel)}</h1>
      <p class="text-[11px] text-gray-500">Reuniones de entre semana · lectura, partes y labores</p>
      <div class="mw-sep mt-2"></div>
    </header>
    <div class="grid grid-cols-2 gap-3">
      ${weeks.map(w => compactWeekCard(w)).join('')}
    </div>
  </div>`;
}

// Tarjeta compacta de una semana para la vista final mensual.
function compactWeekCard(w) {
  const assigned = (sec, p) => {
    const ap = p.assignments || {};
    return mwSlotsFor(sec, p).map(s => { const v = ap[s.key]; return v ? personNameOf(v) : null; }).filter(Boolean).join(' · ');
  };
  const section = (sec, color) => {
    const parts = (sec.parts || []).map(p => {
      const nm = assigned(sec, p);
      return `<div class="flex items-baseline justify-between gap-2 py-[1px]">
        <span class="text-[10px] leading-tight" style="color:${color}"><b>${p.num}.</b> <span class="text-gray-800">${escapeHtml(p.title)}</span> <span class="text-gray-500">(${p.mins})</span></span>
        <span class="text-[10px] font-semibold text-gray-700 text-right whitespace-nowrap">${nm ? escapeHtml(nm) : ''}</span>
      </div>`;
    }).join('');
    return `<div class="mb-1.5">
      <div class="text-[9px] font-bold uppercase tracking-widest mb-0.5" style="color:${color}">${escapeHtml(sec.title)}</div>
      ${parts}
    </div>`;
  };
  const introSong = w.introSong || w.songIn;
  return `
  <article class="border border-gray-300 rounded-md p-2.5" style="break-inside:avoid;page-break-inside:avoid;">
    <div class="text-center mb-1.5">
      <div class="font-bold text-sm text-gray-800">${escapeHtml(w.header)}</div>
      <div class="text-[10px] text-gray-600">${escapeHtml(w.reading || '')}</div>
      <div class="text-[10px] text-gray-600">Presidente: ${escapeHtml(personNameOf(w.presidente))}</div>
      <div class="text-[9px] text-gray-500 mt-0.5">♪ Canción ${escapeHtml(introSong || '')} y oración · ${escapeHtml(w.introTitle || 'Palabras de introducción')} (${w.introMins || 1} min.)</div>
    </div>
    ${section((w.sections || []).find(s => s.id === 'tesoros'), '#0f7685')}
    ${section((w.sections || []).find(s => s.id === 'maestros'), '#b8860b')}
    ${section((w.sections || []).find(s => s.id === 'vida'), '#9e2a2b')}
    <div class="text-[9px] text-gray-600 border-t border-gray-200 pt-1 mt-1">
      ${escapeHtml(w.closingTitle || 'Palabras de conclusión')} (${w.closingMins || 3} mins.) · ♪ Canción ${escapeHtml(w.songOut || '')}
    </div>
    ${compactLabores(w)}
  </article>`;
}

// Cuadro de labores compacto para la tarjeta mensual.
function compactLabores(w) {
  const l = ensureAtencion(w).labores;
  const rows = ATENCION_DEF.map(({ key, label, count }) => {
    const slots = Array.isArray(l[key]) ? l[key] : [l[key] || ''];
    const names = Array.from({ length: count }, (_, si) => { const v = slots[si] || ''; return v ? personNameOf(v) : null; }).filter(Boolean);
    return `<div class="flex justify-between text-[9px] leading-tight">
      <span class="text-gray-500">${label}</span>
      <span class="font-semibold text-gray-700 text-right">${names.length ? escapeHtml(names.join(' · ')) : '—'}</span>
    </div>`;
  }).join('');
  return `<div class="border-t border-dashed border-gray-300 mt-1.5 pt-1">
    <div class="text-[8px] uppercase tracking-widest text-gray-500 font-bold mb-0.5">ATENCIÓN · TRAS BAMBALINAS</div>
    ${rows}
  </div>`;
}

/* Cuadro de Atención departamentos (labores) para las vistas de lista */
function previewLaboresBox(w) {
  const l = ensureAtencion(w).labores;
  const rows = ATENCION_DEF.map(({ key, label, count }) => {
    const slots = Array.isArray(l[key]) ? l[key] : [l[key] || ''];
    const names = Array.from({ length: count }, (_, si) => {
      const v = slots[si] || '';
      return v ? personNameOf(v) : null;
    }).filter(Boolean);
    return `<div class="flex items-center justify-between text-xs mb-2">
      <span class="text-gray-500">${label}</span>
      <span class="font-semibold text-gray-700 text-right">${names.length ? names.join(' · ') : '—'}</span>
    </div>`;
  }).join('');
  return `<div class="mt-6 pt-3 border-t-2 border-dashed border-gray-300">
    <div class="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">ATENCIÓN · TRAS BAMBALINAS</div>
    ${rows}
  </div>`;
}

/* ---------- ABOUT ---------- */
function renderAbout() {
  state.month = null;
  renderTop();
  $('#app').innerHTML = `
    <h1 class="font-headline-lg text-headline-lg text-primary mb-6">Ayuda</h1>
    <div class="max-w-2xl prose prose-sm text-on-surface-variant font-body-lg text-body-lg space-y-4">
      <p><strong class="text-primary">Reunión+</strong> es una aplicación para preparar el programa mensual de reuniones en pocos minutos, sin conexión a Internet.</p>
      <ol class="list-decimal pl-6 space-y-2">
        <li>Pulse <strong>Nuevo Programa</strong> y seleccione mes y año.</li>
        <li>Complete cada semana con su tipo de evento y las asignaciones.</li>
        <li>La aplicación valida automáticamente conflictos y campos vacíos.</li>
        <li>Use <strong>Vista Final</strong> para revisar el programa en formato lista o tabla.</li>
        <li>Exporte a PDF, imagen, comparta por WhatsApp o imprima.</li>
        <li>Puede copiar el mes anterior como base para ahorrar tiempo.</li>
      </ol>
      <p>Toda la información se guarda localmente en su dispositivo.</p>
      <button class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90" onclick="location.hash='#/home'">Volver al inicio</button>
    </div>
  `;
}

/* ---------- Quick add persona (modal) ---------- */
async function quickAddPerson(preselectLabore = '') {
  return new Promise((resolve) => {
    const allLabores = state.labores.map(r => `<label class="flex items-center gap-2 text-sm">
      <input type="checkbox" data-plabore="${r.id}" ${preselectLabore === r.id ? 'checked' : ''} class="accent-primary">
      <span>${r.label}</span>
    </label>`).join('');
    openModal(`<div>
      <h3 class="font-headline-md text-headline-md text-primary mb-4">Agregar</h3>
      <input id="qpName" type="text" placeholder="Nombre completo" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary mb-4">
      <p class="text-on-surface-variant font-label-md text-label-md mb-2">Labores:</p>
      <div class="grid grid-cols-2 gap-2 mb-4">${allLabores}</div>
      <div class="flex gap-3 justify-end">
        <button id="qpCancel" class="px-4 py-2 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cancelar</button>
        <button id="qpOk" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Agregar</button>
      </div>
    </div>`);
    const submit = async () => {
      const name = $('#qpName').value.trim();
      if (!name) { toast('Nombre vacío', 'error'); return; }
      const labores = Array.from(document.querySelectorAll('[data-plabore]:checked')).map(c => c.dataset.plabore);
      try { await db.addPerson({ name, labores }); await refreshCatalogs(); toast('Persona agregada', 'success'); }
      catch (err) { toast(err.message, 'error'); }
      closeModal(); resolve();
    };
    $('#qpCancel').onclick = () => { closeModal(); resolve(); };
    $('#qpOk').onclick = submit;
    $('#qpName').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    $('#qpName').focus();
  });
}

/* ---------- Exportación ---------- */
function buildShareText() {
  const m = state.month;
  const lines = [];
  lines.push(`*Programa de Reuniones - ${MONTHS_ES[m.month - 1]} ${m.year}*`);
  m.weeks.forEach((w, i) => {
    const date = new Date(w.date + 'T00:00:00');
    const dateStr = date.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
    if (w.type === 'assembly') {
      lines.push(`\n*Semana ${i + 1} — ${dateStr}*\nASAMBLEA (sin reunión local)`);
      return;
    }
    lines.push(`\n*Semana ${i + 1} — ${dateStr}*`);
    lines.push(`Tipo: ${WEEK_TYPES[w.type].label}`);
    if (w.type === 'normal') {
      lines.push(`Discurso: ${w.tituloDiscurso || '—'}`);
      lines.push(`Presidente: ${personNameOf(w.presidente)}`);
      lines.push(`Orador: ${w.orador || '—'}`);
      lines.push(`Conductor: ${personNameOf(w.conductor)}`);
      lines.push(`Lector: ${personNameOf(w.lector)}`);
      lines.push(`Grupo: ${deptNameOf(w.departamento)}`);
    } else if (w.type === 'supervisor') {
      lines.push(`Superintendente: ${w.nombreSupervisor || '—'}`);
      lines.push(`Discurso público: ${w.discursoSupervisor1 || '—'}`);
      lines.push(`Presidente: ${personNameOf(w.presidente)}`);
      lines.push(`Estudio (sin lectura): ${personNameOf(w.estudioSinLectura)}`);
      lines.push(`Discurso de servicio: ${w.discursoSupervisor2 || '—'}`);
    } else if (w.type === 'commemoration') {
      lines.push(`Discurso: ${w.tituloDiscurso || '—'}`);
      lines.push(`Presidente: ${personNameOf(w.presidente)}`);
      lines.push(`Orador: ${w.orador || '—'}`);
    }
  });
  return lines.join('\n');
}

async function shareProgram() {
  const text = buildShareText();
  if (navigator.share) {
    try { await navigator.share({ title: 'Programa de Reuniones', text }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Programa copiado al portapapeles', 'success');
  } catch { toast('No se pudo compartir', 'error'); }
}

function waProgram() {
  const text = buildShareText();
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

async function imageProgram() {
  const node = $('#previewContent');
  if (!node) return;
  toast('Generando imagen…', 'info');
  try {
    const blob = await nodeToPngBlob(node);
    downloadBlob(blob, `programa-${state.month.id}.png`);
    toast('Imagen descargada', 'success');
  } catch (err) {
    console.error(err);
    toast('No se pudo generar la imagen. Use Imprimir > Guardar como PDF.', 'error');
  }
}

/* Convierte un nodo DOM a PNG usando SVG foreignObject con estilos inlineados. */
async function nodeToPngBlob(node) {
  const clone = await cloneWithInlineStyles(node);
  const rect = node.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(node.scrollHeight);

  //xmlns y XHTML necesario para foreignObject
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  const serialized = new XMLSerializer().serializeToString(clone);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <foreignObject width="100%" height="100%">${serialized}</foreignObject>
  </svg>`;

  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const img = await loadImage(url);
  URL.revokeObjectURL(url);

  const scale = 2; // retina
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob falló')), 'image/png');
  });
}

async function cloneWithInlineStyles(node) {
  const clone = node.cloneNode(true);
  const src = [node, ...node.querySelectorAll('*')];
  const dst = [clone, ...clone.querySelectorAll('*')];
  for (let i = 0; i < src.length; i++) {
    const cs = getComputedStyle(src[i]);
    let style = '';
    for (let j = 0; j < cs.length; j++) {
      const prop = cs.item(j);
      const val = cs.getPropertyValue(prop);
      if (val) style += `${prop}:${val};`;
    }
    dst[i].setAttribute('style', style);
    // reemplazar material-symbols por texto plano para que renderice en SVG
    if (dst[i].classList?.contains('material-symbols-outlined')) {
      dst[i].textContent = src[i].textContent;
    }
  }
  // Eliminar íconos de fuentes que no renderizan en SVG
  clone.querySelectorAll('.material-symbols-outlined').forEach(n => n.remove());
  return clone;
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el(`<a href="${url}" download="${filename}"></a>`);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Utilidades ---------- */
// (saturdaysOf, cryptoId, capitalize, escapeHtml, escapeAttr, labelOf
//  se importan de logic.js)

function newWeek(date) {
  const iso = isoDate(date); // fecha local (no UTC) para no desplazar el día
  return {
    id: cryptoId(),
    date: iso,
    type: 'normal',
    tituloDiscurso: '',
    presidente: '',
    orador: '',
    conductor: '',
    lector: '',
    departamento: '',
    nombreSupervisor: '',
    discursoSupervisor1: '',
    estudioSinLectura: '',
    discursoSupervisor2: '',
    // Salidas (sólo relevantes si type === 'normal'): lista de oradores
    outings: [ newOuting() ],
    // Atencion departamentos (no son asignaciones del programa)
    labores: newAtencion(),
  };
}

// Estructura por defecto de las labores de una semana (derivada de ATENCION_DEF)
function newAtencion() {
  return Object.fromEntries(ATENCION_DEF.map(({ key, count }) => [key, count > 1 ? Array(count).fill('') : '']));
}

// Garantiza que una semana tenga su objeto de labores
function ensureAtencion(w) {
  if (!w) w = {};
  if (!w.labores) w.labores = newAtencion();
  const d = newAtencion();
  ATENCION_DEF.forEach(({ key }) => {
    let cur = w.labores[key];
    const slotCount = (Array.isArray(d[key]) ? d[key].length : 1);
    if (Array.isArray(d[key])) {
      if (!Array.isArray(cur)) cur = Array(slotCount).fill('');
      while (cur.length < slotCount) cur.push('');
      for (let i = 0; i < slotCount; i++) cur[i] = cur[i] || '';
    } else if (cur === undefined) {
      cur = '';
    }
    w.labores[key] = cur;
  });
  return w;
}

// Estructura de una salida (un orador con su discurso)
function newOuting() {
  return {
    id: cryptoId(),
    oradorSalida: '',    // id de persona con rol 'orador'
    tituloDiscurso: '', // "N. Título" o texto libre
    talkNum: '',        // nº de discurso elegido (para asociar)
  };
}

// Asegura que el mes tiene outings (congregaciones) y que cada semana normal tiene .outings
function ensureOutings(month) {
  if (!Array.isArray(month.outings) || month.outings.length === 0) {
    month.outings = [ newCongregation() ];
  }
  month.weeks.forEach(w => {
    if (w.type === 'normal' && !Array.isArray(w.outings)) {
      w.outings = [ newOuting() ];
    }
  });
}

// Datos generales de una salida (congregación + día + hora)
function newCongregation() {
  return {
    id: cryptoId(),
    nombre: '',
    dia: 'sabado',     // sabado | domingo
    hora: '',          // "18:00"
  };
}

function formatShort(date) {
  return date.toLocaleDateString('es', { day: '2-digit', month: 'short' });
}

// Suma/resta meses a "YYYY-MM" y devuelve "YYYY-MM".
function addMonths(iso, delta) {
  const [y, m] = String(iso).split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Devuelve el id del departamento cuyo número coincide (p. ej. 4 → "Grupo 4").
function groupDeptForNum(num) {
  const ordered = state.departments
    .map(d => { const m = /^(?:grupo\s*)?(\d+)$/i.exec(String(d.name || '').trim()); return { d, num: m ? Number(m[1]) : null }; })
    .sort((a, b) => (a.num ?? 999) - (b.num ?? 999));
  const byNum = ordered.find(o => o.num === num);
  return byNum ? byNum.d.id : (ordered[(num - 1) % ordered.length]?.d.id || '');
}

// Número del grupo asignado en una semana del programa de aseo.
function aseoWeekGroupNum(w) {
  if (!w || !w.group) return null;
  const d = state.departments.find(x => String(x.id) === String(w.group));
  const m = d && /^(?:grupo\s*)?(\d+)$/i.exec(String(d.name || '').trim());
  return m ? Number(m[1]) : null;
}

// Grupo (id de departamento) asignado a un sábado en los programas de aseo.
function aseoGroupFor(saturday, aseos) {
  for (const a of (aseos || [])) {
    const w = (a.weeks || []).find(x => x.saturday === saturday);
    if (w && w.group) return w.group;
  }
  return null;
}

// Salidas (oradores) de un sábado en los programas de salidas; null si no existe.
function salidasFor(saturday, salidasList) {
  for (const p of (salidasList || [])) {
    const w = (p.weeks || []).find(x => x.saturday === saturday);
    if (w) return w.outings || [];
  }
  return null;
}

// Semana (con labores) de un sábado en los programas de acomodación; null si no existe.
function laboresWeekFor(saturday, laboresList) {
  for (const p of (laboresList || [])) {
    const w = (p.weeks || []).find(x => x.saturday === saturday);
    if (w) return w;
  }
  return null;
}

// Siguiente grupo con el que debe comenzar el programa de aseo del mes: la última
// semana del mes anterior con grupo, +1 en el ciclo (si julio terminó en 3 y hay 7
// grupos, agosto comienza en 4). Devuelve el número o null si no hay programa previo.
async function nextAseoStart(monthId, n) {
  if (!n) return null;
  const prevId = addMonths(monthId, -1);
  const prev = await db.getAseo(prevId);
  if (!prev || !Array.isArray(prev.weeks)) return null;
  for (let i = prev.weeks.length - 1; i >= 0; i--) {
    const num = aseoWeekGroupNum(prev.weeks[i]);
    if (num != null) return (num % n) + 1;
  }
  return null;
}

// Semanas de un mes para el programa de aseo: cada semana va de lunes a domingo
// (empezando por la reunión de entre semana) y se incluye toda semana cuyo sábado
// cae en el mes. Así quedan cubiertos todos los fines de semana del mes y las
// semanas de borde se traslapan con el mes anterior/siguiente.
function aseoWeeksForMonth(year, month) {
  return saturdaysOf(year, month).map(sat => {
    const satIso = isoDate(sat);
    return {
      id: addDays(satIso, -5), // lunes (inicio de semana)
      monday: addDays(satIso, -5),
      saturday: satIso,
      sunday: addDays(satIso, 1),
      group: '',
    };
  }).sort((a, b) => a.monday.localeCompare(b.monday));
}

function personNameOf(id) {
  if (!id) return '—';
  const p = state.people.find(x => String(x.id) === String(id));
  return p ? p.name : '—';
}
function personOf(id) {
  return state.people.find(x => String(x.id) === String(id)) || null;
}

// Aviso de pareja para partes de a 2: devuelve HTML de alerta si los dos asignados
// no son una pareja compatible (calificación + género + enlace).
function pairWarning(sec, p) {
  const slots = midweekSlotsOf(sec, p);
  // La compatibilidad de pareja solo aplica a las presentaciones (asignacion2);
  // el Estudio Bíblico de la Congregación solo exige el rol.
  if (!(slots.length === 2 && slots.some(s => s.labore === 'asignacion2'))) return '';
  const ap = p.assignments || {};
  const keys = Object.keys(ap).filter(k => ap[k]);
  if (keys.length < 2) return '';
  const a = personOf(ap[keys[0]]), b = personOf(ap[keys[1]]);
  if (!a || !b) return '';
  if (canBePair(a, b)) return '';
  return `<p class="flex items-center gap-1 text-error font-bold text-[10px] uppercase conflict-dot"><span class="material-symbols-outlined text-[14px]">warning</span> Pareja no compatible (${escapeHtml(a.name)} / ${escapeHtml(b.name)})</p>`;
}
function deptNameOf(id) {
  if (!id) return '—';
  const d = state.departments.find(x => String(x.id) === String(id));
  return d ? d.name : '—';
}

// Carga el contexto del mes (todos los programas) y renderiza una tarjeta con los
// conflictos cruzados de asignación de personas. Se muestra en cada programa para
// que el aviso aparezca sin importar el orden en que se completen.
async function renderCrossAlerts(container, cur) {
  if (!container) return;
  const [months, midweeks, labores, salidas] = await Promise.all([
    db.listMonths(), db.listMidweeks(), db.listAtencion(), db.listSalidas(),
  ]);
  const ctx = {
    months: months.filter(m => String(m.id).startsWith(cur)),
    midweeks: midweeks.filter(m => String(m.id).startsWith(cur)),
    atencion: labores.filter(p => String(p.id) === cur),
    salidas: salidas.filter(p => String(p.id) === cur),
  };
  const conflicts = computeCrossConflicts(ctx);
  if (!conflicts.length) { container.innerHTML = ''; return; }

  const REGLA = { E1: 'No puede tener más de una asignación (entre semana + acomodación) en la misma semana.', E2: 'No puede tener más de una asignación (fin de semana + acomodación + salidas) en la misma semana.', E3: 'La misma asignación de entre semana se repite en el mes.', E4: 'El mismo cargo de fin de semana se repite en el mes.', E5: 'No puede tener más de una salida en el mes.' };
  container.innerHTML = `
    <div class="rounded-xl border border-error bg-error-container/20 p-4 md:p-5">
      <div class="flex items-center gap-2 mb-3">
        <span class="material-symbols-outlined text-error">warning</span>
        <h3 class="font-headline-md text-headline-md text-error">Conflictos de asignación</h3>
      </div>
      <ul class="space-y-2">
        ${conflicts.map(c => `<li class="flex items-start gap-2 text-sm">
          <span class="material-symbols-outlined text-error text-[18px]">person_off</span>
          <div>
            <span class="font-semibold text-on-surface">${escapeHtml(personNameOf(c.value))}</span>
            <span class="text-on-surface-variant"> — ${escapeHtml(c.detalle)}</span>
            <div class="text-on-surface-variant">${REGLA[c.regla] || ''} ${(c.otros || []).map(o => `<span class="block text-xs">↳ ${escapeHtml(o)}</span>`).join('')}</div>
          </div>
        </li>`).join('')}
      </ul>
    </div>
  `;
}