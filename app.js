// app.js - Lógica principal de Reunión+
import * as db from './db.js';
import { isSupabaseConfigured } from './supabase-config.js?v=217';
import { borrarSoloParticipantes, borrarSoloReuniones, borrarSoloProgramas, limpiarTodasLasColecciones, obtenerUsuarios, guardarUsuario } from './supabase.js?v=217';
import { iniciarSync, pullSiVacio, pullAll, reconciliar, syncStatus, hayCambiosPendientes, sincronizarAhora, subirStores, lastSavedAt, descartarLocal } from './sync.js';
import { login, logout, restoreSession, currentUser, isAuthenticated, onAuthChange, reauthenticate } from './auth.js';
import {
  MONTHS_ES, WEEK_TYPES, FIELD_LABORE, FIELD_LABELS,
  normalizeStr, searchTalks, saturdaysOf,
  collectWeekPersons, labelOfKey, labelOf,
  computeConflicts, computeOutingConflicts, weekComplete, computeMidweekConflicts,
  dedupPersons, eligiblePeople, isAtencionPerson, ATENCION_DEF, collectMidweekPersons,
  capitalize, escapeHtml, escapeAttr, cryptoId,
  isoDate, eventTypeForDate, upcomingEvents, DAYS_ES_NAMES, addDays,
  lastMonths, computeRegularity,
  convertPdfToData, convertPdfTalks, convertPdfPeople, convertPdfMidweeks, midweekGuideSummary, rebuildPdfWords, normalizeMidweekHeaders, personasFromXlsx,
  computeCrossConflicts, canBePair, CALIFICACIONES, midweekSlotsOf,
  collectPersonAssignments,
  isStudentPerson, isStudentLabore, laboreAllowedForPerson, laboreEligible,
  isAssignmentLabore, isServiceLabore,
  automatizarEntreSemana, automatizarAtencion, automatizarFinSemana,
  camposFinSemana, campoFinLabore, extractAssignments, assignmentMetrics,
  ASIGNACION_GRUPOS, LABORE_GRUPO,
  defaultAlgorithmConfig, defaultScoringConfig,
  generateProposals, scoreSolution, salidasFaltantes,
  laboresVaciasPropuesta, sinAsignarPorMotivo,
  workloadByPerson, historyTimeline, distributionByLabore, pairRoleStats,
  balanceReport, cargoNivel,
  asId, asStr, slotOf, runEngine, changedManualKeys, wrapManualPrograms,
  clearAutoSlots, manualSlotKeys, estadoProgramas, invertName,
} from './logic.js';
import { extractEpubText } from './epub.js';
import { generatePeopleTemplate, parsePeopleXlsx } from './xlsx.js';

const APP_VERSION = '2.0.0';
let _swReg = null;
let _pollTimer = null;
let _recargando = false;

/* ---------- Estado ---------- */
const state = {
  view: 'home',           // home | new | auto | edit | preview | outings | lists | uploads | eventos | labores | laboresGrupo | salidas | general | settings | about | midweeks | midweek | midweekPreview | midweekMonthPreview | midweekList
  newTab: 'fin',          // 'fin' | 'entre' | 'atencion' | 'atencionGrupo' | 'salidas' | 'general' (en Programas)
  monthId: null,          // "YYYY-MM"
  month: null,
  previewMode: 'lista',   // lista | tabla
  people: [],
  departments: [],
  departmentsAll: [],     // todos los grupos, incluidos los ocultos (inactivos)
  talks: [],              // lista de discursos públicos [{num, title}]
  labores: [],            // labores del equipo [{id, label}]
  midweeks: [],           // reuniones de entre semana
  config: null,           // configuración general
  toastsOpen: new Set(),
  mwMonth: null,          // mes seleccionado en la vista mensual de entre semana
  progMonth: null,        // mes seleccionado en Programas (selector global)
  listsTab: 'personas',   // 'personas' | 'grupos' | 'departamentos' | 'historial' (vista Personas)
  listsShowInactive: false, // mostrar también las personas desactivadas (borrado lógico)
  reportTab: 'actividad',
  reportMonth: null,
  aseoWeeks: [],          // programa de aseo del mes activo (vista previa)
  atencionWeeks: [],      // labores de atención del mes activo (vista previa)
};

/* ---------- INIT ---------- */
init();

async function init() {
  await db.seedIfEmpty();
  await refreshCatalogs();
  registerSW();
  bindGlobal();
  // Sincronización con Supabase (si está configurado). No bloquea el arranque.
  iniciarSync().then(() => mostrarBannerBorrador()).catch(() => {});
  // Autenticación: restaurar sesión persistente y actualizar la UI.
  onAuthChange((user) => {
    renderAuthUI();
    // Al cambiar la sesión, refrescar la vista Inicio (bienvenida ↔ tablero).
    if (state.view === 'home') router();
    // Al iniciar sesión en un dispositivo sin datos locales, traer de Supabase.
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
  state.departmentsAll = await db.listDepartmentsAll();
  state.talks = await db.listTalks();
  state.midweeks = await db.listMidweeks();
  state.config = await db.getConfig();
  // Auto-reparación de grupos: la plantilla XLSX guarda el número de grupo que
  // escribe la congregación (p. ej. "3"), no el id interno del departamento. Si
  // ese número no coincide con ningún id real (p. ej. tras ocultar o recrear
  // grupos), se reasigna a la persona el grupo cuyo nombre termina en ese
  // número ("3" → "Grupo 3") y se persiste el id correcto.
  if (state.departmentsAll.length) {
    const idsReales = new Set(state.departmentsAll.map(d => String(d.id)));
    for (const p of state.people) {
      if (!p.grupoId || idsReales.has(String(p.grupoId))) continue;
      const num = String(p.grupoId).replace(/\D/g, '');
      if (!num) continue;
      const match = state.departmentsAll.find(d => {
        const m = String(d.name || '').match(/(\d+)\s*$/);
        return m && m[1] === num;
      });
      if (match && String(match.id) !== String(p.grupoId)) {
        p.grupoId = match.id;
        await db.updatePerson({ ...p });
      }
    }
  }
  const saved = await db.getLabores(null);
  state.labores = (saved && Array.isArray(saved) && saved.length)
    ? saved
    : DEFAULT_LABORES.map(r => ({ ...r }));
  // Incorpora labores nuevas de versiones recientes a instalaciones existentes
  // (solo añade las que faltan; no quita ni renombra las personalizadas).
  const idsGuardados = new Set(state.labores.map(r => r.id));
  DEFAULT_LABORES.forEach(r => { if (!idsGuardados.has(r.id)) state.labores.push({ ...r }); });
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
  const btnCloud = document.getElementById('onlineBtn');
  const saveLabel = document.getElementById('syncSaveLabel');

  const pintar = () => {
    const on = navigator.onLine;
    const dirty = hayCambiosPendientes();
    const st = syncStatus();
    const last = lastSavedAt();
    root.classList.remove('hidden');
    root.classList.add('flex');
    let color, label;
    if (st.state === 'syncing') { color = '#f59e0b'; label = 'Guardando…'; }
    else if (st.state === 'error') { color = '#e5484d'; label = 'Error de sincronización'; }
    else if (dirty || st.state === 'pending') { color = '#f59e0b'; label = 'Cambios sin guardar'; }
    else if (!on) { color = '#e5484d'; label = 'off line'; }
    else { color = '#2e7d32'; label = 'Sincronizado'; }
    dot.style.background = color;
    txt.textContent = label;
    const lastTxt = last ? new Date(last).toLocaleString('es', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    root.title = 'Estado de la sincronización' + (lastTxt ? `\nÚltimo guardado en Supabase: ${lastTxt}` : '');
    if (btnCloud) btnCloud.style.color = dirty ? '#e5484d' : '';
    if (saveLabel) {
      saveLabel.classList.toggle('hidden', !dirty);
      saveLabel.classList.toggle('inline-flex', !!dirty);
    }
  };
  window.addEventListener('online', pintar);
  window.addEventListener('offline', pintar);
  window.addEventListener('reunion-dirty', pintar);
  let guardando = false;
  const guardarAhora = async () => {
    if (guardando) return;
    guardando = true;
    if (btnCloud) btnCloud.disabled = true;
    try {
      const res = await sincronizarAhora();
      if (res && res.error) {
        const msgs = {
          'offline': 'Sin conexión: los cambios quedan en este dispositivo y se subirán solos al recuperar la conexión.',
          'no-configurado': 'Supabase no está configurado en esta instalación.',
          'sin-sesion': 'Inicia sesión para guardar los cambios en la nube.',
          'ocupado': 'Sincronizando ahora mismo; espera un momento.',
          'parcial': 'Hubo errores al subir algunos cambios; vuelve a pulsar para reintentar.',
          'quota-exceeded': 'Cupo de la nube superado: los cambios quedan en este dispositivo y se subirán cuando haya cupo.',
        };
        toast(msgs[res.error] || 'No se pudo subir: ' + res.error, 'error');
      }
    } catch (err) {
      toast('Error al guardar en Supabase: ' + (err.message || err), 'error');
    } finally {
      guardando = false;
      if (btnCloud) btnCloud.disabled = false;
      pintar();
    }
  };
  if (btnCloud) btnCloud.addEventListener('click', guardarAhora);
  if (saveLabel) saveLabel.addEventListener('click', guardarAhora);
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

// Aviso de borrador local no guardado (spec 46): al reabrir la app SIN conexión
// con cambios locales pendientes, se ofrece Continuar borrador o Descartarlo
// (volver a la última versión confirmada en Supabase).
function mostrarBannerBorrador() {
  if (!navigator.onLine || !hayCambiosPendientes()) return;
  if (document.getElementById('draftBanner')) return;
  const banner = document.createElement('div');
  banner.id = 'draftBanner';
  banner.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-container-low text-on-surface shadow-xl border border-outline-variant max-w-[94vw] flex-wrap justify-center';
  banner.innerHTML = `
    <span class="material-symbols-outlined text-warning">edit_note</span>
    <span class="text-sm">Hay cambios locales no guardados.</span>
    <div class="flex gap-2">
      <button id="draftKeep" class="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:opacity-90">Continuar borrador</button>
      <button id="draftDiscard" class="px-3 py-1.5 rounded-lg border border-error text-error text-sm font-semibold hover:bg-error-container">Descartar borrador</button>
    </div>`;
  document.body.appendChild(banner);
  banner.querySelector('#draftKeep').onclick = () => banner.remove();
  banner.querySelector('#draftDiscard').onclick = async () => {
    if (!(await confirmDialog('¿Descartar el borrador local? Se restaurarán los datos confirmados en Supabase (los cambios sin guardar se perderán).', 'Descartar borrador'))) return;
    banner.remove();
    try {
      const res = await pullAll();
      if (res && res.error) { toast('No se pudo descartar: ' + res.error, 'error'); return; }
      await descartarLocal();
      await refreshCatalogs();
      router();
      toast('Borrador descartado. Se restauraron los datos de Supabase.', 'success');
    } catch (err) {
      toast('Error al descartar: ' + (err.message || err), 'error');
    }
  };
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

function mostrarAviso() {
  if (document.getElementById('swUpdateBanner')) return;
  const banner = document.createElement('div');
  banner.id = 'swUpdateBanner';
  banner.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-container-low text-on-surface shadow-xl border border-outline-variant max-w-[94vw]';
  banner.innerHTML = `
    <span class="material-symbols-outlined text-primary">system_update</span>
    <span class="text-sm">Nueva versión disponible. Actualizar aplicación.</span>
    <button id="swUpdateBtn" class="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:opacity-90 whitespace-nowrap">Actualizar</button>`;
  document.body.appendChild(banner);
  banner.querySelector('#swUpdateBtn').onclick = () => {
    if (_swReg && _swReg.waiting) _swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
  };
}

async function checkForUpdate() {
  try {
    const res = await fetch('./version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const info = await res.json();
    if (info.version && info.version !== APP_VERSION) mostrarAviso();
  } catch (_) { /* offline o error de red: ignorar */ }
}

function startVersionPolling() {
  checkForUpdate();
  _pollTimer = setInterval(checkForUpdate, 5 * 60 * 1000);
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    _swReg = reg;
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) mostrarAviso();
      });
    });
    startVersionPolling();
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_recargando) return;
    _recargando = true;
    setTimeout(() => { _recargando = false; }, 10000);
    window.location.reload();
  });
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

// Estado de la autenticación en la interfaz (Fase 6). Si Supabase no está
// configurado, el botón queda oculto y la app funciona sin login.
function renderAuthUI() {
  const btn = document.getElementById('authBtn');
  const label = document.getElementById('authBtnLabel');
  const badge = document.getElementById('sideAuthBadge');
  const user = currentUser();
  if (!isSupabaseConfigured()) {
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
     badge.textContent = user.rol === 'admin' ? '👑 Admin' : user.rol === 'user' ? '👁️ Usuario' : user.rol === 'ia' ? '🖼️ Imagen semanal' : '👁️ Solo lectura';
    badge.className = `text-[11px] font-label-md mt-1 ${user.rol === 'admin' ? 'text-tertiary' : 'text-on-surface-variant'}`;
  } else {
    btn.style.display = 'flex';
    btn.title = 'Iniciar sesión';
    label.textContent = 'Entrar';
    badge.classList.add('hidden');
    badge.textContent = '';
  }
  // Ocultar/mostrar acciones administrativas según el rol (solo UX; la seguridad
  // real está en las políticas RLS de Supabase).
  document.body.classList.toggle('is-reader', !!user && user.rol !== 'admin');
  document.body.classList.toggle('is-user', !!user && user.rol === 'user');
  document.body.classList.toggle('is-ia', !!user && user.rol === 'ia');
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
      <p class="text-on-surface-variant text-xs mt-3">Acceso restringido a los correos autorizados por la congregación.</p>
    </div>`);
  $('#loginCancel').onclick = closeModal;
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

function isCompactViewport() {
  return window.matchMedia('(max-width: 767px)').matches;
}

function isUserRole() {
  const user = currentUser();
  return !!user && user.rol === 'user';
}

function isIaRole() {
  const user = currentUser();
  return !!user && user.rol === 'ia';
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
  if (isIaRole() && view !== 'ia') {
    location.hash = '#/ia';
    return;
  }
  if (isUserRole() && !['home', 'lists', 'grupo'].includes(view)) {
    location.hash = '#/home';
    return;
  }
  if (view === 'informes' && currentUser()?.rol !== 'admin') {
    location.hash = '#/home';
    return;
  }
  state.view = view;
  if (segs[1]) state.monthId = segs[1];
  const qp = new URLSearchParams(query || '');
  if (view === 'preview') state.previewMode = qp.get('mode') || 'lista';
  else if (qp.get('mode')) state.previewMode = qp.get('mode');

  // reset action bar (solo la vista preview la usa)
  const bar = $('#actionBar');
  if (view !== 'preview') { bar.classList.add('hidden'); bar.innerHTML = ''; }

  renderTop();
  renderSide();
  switch (view) {
    case 'ia':        renderIa(); break;
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
    case 'conflictos': renderConflictos(segs[1]); break;
    case 'algoritmo': renderAlgoritmo(); break;
    case 'settings': renderSettings(); break;
    case 'informes': renderInformes(); break;
    case 'grupo': renderGroupSummary(); break;
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
// Bloqueo real de la app: si Supabase está configurado y no hay sesión, la única
// pantalla accesible es la bienvenida con el botón de inicio de sesión. La
// seguridad efectiva la imponen las políticas RLS de Supabase; esta es la capa de UI.
function appBloqueada() {
  return isSupabaseConfigured() && !isAuthenticated();
}

function renderTop() {
  // El menú superior se elimina; la navegación vive en la barra lateral (sidebar).
  // Sin sesión: ocultar la navegación, solo queda la bienvenida.
  if (appBloqueada()) { $('#settingsBtn').style.display = 'none'; $('#topTitle').textContent = 'Reunión+'; $('#topBadge').classList.add('hidden'); return; }
  $('#settingsBtn').style.display = (isUserRole() || isIaRole()) ? 'none' : 'flex';

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
  $('#sideNewMonth').style.display = isUserRole() ? 'none' : '';
  $('#sideAbout').style.display = isUserRole() ? 'none' : '';
  if (isIaRole()) {
    nav.innerHTML = '';
    $('#sideNewMonth').style.display = 'none';
    $('#sideAbout').style.display = 'none';
    return;
  }
  const items = isUserRole() ? [
    { id: 'home', icon: 'calendar_month', label: 'Tablero', view: 'home' },
    { id: 'grupo', icon: 'group_work', label: 'Mi grupo', view: 'grupo' },
    { id: 'lists', icon: 'groups', label: 'Congregación', view: 'lists' },
  ] : [
    { id: 'home', icon: 'calendar_month', label: 'Tablero', view: 'home' },
    { id: 'new', icon: 'add_circle', label: 'Programa', view: 'new' },
    { id: 'lists', icon: 'groups', label: 'Congregación', view: 'lists' },
    { id: 'uploads', icon: 'upload_file', label: 'Carga de Archivos', view: 'uploads' },
    { id: 'eventos', icon: 'event', label: 'Eventos', view: 'eventos' },
    { id: 'settings', icon: 'settings', label: 'Ajustes', view: 'settings' },
    ...(currentUser()?.rol === 'admin' ? [{ id: 'informes', icon: 'analytics', label: 'Informes', view: 'informes' }] : []),
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

async function renderIa() {
  state.month = null;
  renderTop();
  const [months, aseos, salidas, atencion] = await Promise.all([
    db.listMonths(), db.listAseos(), db.listSalidas(), db.listAtencion(),
  ]);
  _homeMonths = months.sort((a, b) => b.id.localeCompare(a.id));
  _homeAseos = aseos;
  _homeSalidas = salidas;
  _homeAtencion = atencion;
  const week = currentGeneralWeek(0);
  const app = $('#app');
  app.innerHTML = `<div class="max-w-3xl mx-auto text-center">
    <h1 class="font-headline-lg text-headline-lg text-primary mb-2">Imagen de la semana</h1>
    <p class="text-on-surface-variant font-body-md mb-6">Solo está disponible la semana en curso.</p>
    ${week ? `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-3 md:p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
      <img id="iaWeekImage" class="w-full rounded-lg" alt="Programa de la semana en curso">
      <button id="iaShare" class="mt-4 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-all active:scale-95">
        <span class="material-symbols-outlined text-[18px]">share</span> Descargar / compartir imagen
      </button>
    </div>` : `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-8 text-on-surface-variant">No hay programa cargado para la semana en curso.</div>`}
  </div>`;
  if (!week) return;
  const cur = String(week.saturday || isoDate(new Date())).slice(0, 7);
  const blob = await svgToPngBlob(generalWeekExportSvg(week, cur, { mobile: true }));
  const image = $('#iaWeekImage');
  image.src = URL.createObjectURL(blob);
  $('#iaShare').onclick = async () => {
    const button = $('#iaShare');
    button.disabled = true;
    try { await compartirPng(blob, `semana-${cur}.png`); }
    catch (err) { console.error(err); toast('No se pudo compartir la imagen.', 'error'); }
    finally { button.disabled = false; }
  };
}

function serviceYearMonths(year) {
  const months = [];
  for (let i = 0; i < 12; i++) {
    const date = new Date(year, 8 + i, 1);
    months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

function currentServiceYear() {
  const now = new Date();
  return now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();
}

function serviceYearOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m >= 9 ? y + 1 : y;
}

function weekKeyOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - dt.getDay());
  return isoDate(dt);
}

function meetingDatesForYear(year, config, events) {
  const midDay = config?.midweek?.day ?? 2;
  const wkDay = config?.schedule?.day ?? 6;
  const months = serviceYearMonths(year);
  const start = months[0] + '-01';
  const endY = Number(months[11].slice(0, 4));
  const endM = Number(months[11].slice(5));
  const end = isoDate(new Date(endY, endM - 1, 31));
  const blankWeeks = new Set();
  (events?.assemblies || []).forEach(a => {
    const from = a.from || a.date;
    const to = a.to || addDays(a.date, (Number(a.days) || 1) - 1);
    let cur = from;
    while (cur && cur <= to) { blankWeeks.add(weekKeyOf(cur)); cur = addDays(cur, 1); }
  });
  const out = { midweek: [], weekend: [] };
  let cur = start;
  while (cur <= end) {
    const ev = eventTypeForDate(events, cur);
    const [y, m, d] = cur.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const blank = blankWeeks.has(weekKeyOf(cur)) || ev === 'assembly' || ev === 'commemoration';
    if (dow === midDay) out.midweek.push({ date: cur, blank, supervisor: ev === 'supervisor', ev });
    if (dow === wkDay) out.weekend.push({ date: cur, blank, supervisor: ev === 'supervisor', ev });
    cur = addDays(cur, 1);
  }
  return out;
}

function serviceYearLabel(year) {
  return `${MONTHS_ES[8]} ${year - 1} – ${MONTHS_ES[7]} ${year}`;
}

async function renderInformes() {
  state.month = null;
  renderTop();
  const year = currentServiceYear();
  const months = serviceYearMonths(year);
  if (!state.reportMonth || !months.includes(state.reportMonth)) state.reportMonth = months.find(m => m === isoDate(new Date()).slice(0, 7)) || months[0];
  const tab = state.reportTab || 'actividad';
  const tabs = [
    ['actividad', 'Actividad', 'assignment'],
    ['asistencia', 'Asistencia', 'groups'],
    ['arreglos', 'Arreglos', 'swap_horiz'],
    ['formularios', 'Formularios', 'download'],
  ];
  let body = '';
  if (tab === 'actividad') body = await renderActivityTab();
  else if (tab === 'asistencia') body = await renderAttendanceTab();
  else if (tab === 'arreglos') body = await renderArrangementsTab();
  else body = await renderFormsTab();
  const showMonth = tab === 'actividad' || tab === 'arreglos';
  const app = $('#app');
  app.innerHTML = `<div class="mb-6"><h1 class="font-display-lg text-display-lg text-primary">Informes</h1><p class="text-on-surface-variant font-body-lg">Actividad, asistencia y arreglos de la congregación.</p></div>
    <div class="mb-5 flex flex-wrap items-center gap-3">
      ${showMonth ? `<select id="reportMonth" class="bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md">${months.map(m => `<option value="${m}" ${m === state.reportMonth ? 'selected' : ''}>${MONTHS_ES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}</option>`).join('')}</select>` : ''}
      <div class="flex flex-wrap gap-2">${tabs.map(([id, label, icon]) => `<button data-report-tab="${id}" class="inline-flex items-center gap-1 px-3 py-2 rounded-lg font-label-md text-label-md ${tab === id ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant'}"><span class="material-symbols-outlined text-[18px]">${icon}</span>${label}</button>`).join('')}</div>
    </div>
    ${body}`;
  const ms = $('#reportMonth');
  if (ms) ms.onchange = e => { state.reportMonth = e.target.value; renderInformes(); };
  document.querySelectorAll('[data-report-tab]').forEach(b => b.onclick = () => { state.reportTab = b.dataset.reportTab; renderInformes(); });
  if (tab === 'actividad') bindActivityTab();
  else if (tab === 'asistencia') bindAttendanceTab();
  else if (tab === 'arreglos') bindArrangementsTab();
  else bindFormsTab();
}

async function renderActivityTab() {
  const me = currentUser();
  if (me && me.rol === 'user') {
    const grupos = (me.grupos && me.grupos.length) ? me.grupos : [];
    const gid = (state.reportGroup && grupos.includes(state.reportGroup)) ? state.reportGroup : grupos[0];
    if (!gid) return `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-8 text-center text-on-surface-variant">No tienes un grupo asignado.</div>`;
    return await renderActivityGroupView(gid, false);
  }
  if (state.reportGroup) return await renderActivityGroupView(state.reportGroup, true);
  return renderActivityCards();
}

function renderActivityCards() {
  const deps = state.departments || [];
  const cards = deps.map(dep => {
    const members = state.people.filter(p => String(p.grupoId) === String(dep.id));
    return `<button data-group-card="${dep.id}" class="text-left bg-surface-container-lowest rounded-xl border border-outline-variant p-5 hover:border-primary transition-colors">
      <div class="flex items-center gap-3 mb-3"><span class="material-symbols-outlined text-primary">groups</span><h3 class="font-headline-md text-headline-md text-primary">${escapeHtml(dep.name || 'Grupo')}</h3></div>
      <p class="font-body-md text-body-md text-on-surface-variant">${members.length} publicadores</p>
    </button>`;
  }).join('');
  return `<h2 class="font-headline-md text-headline-md text-primary mb-4">Grupos</h2>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">${cards || '<p class="text-on-surface-variant">No hay grupos.</p>'}</div>`;
}

function actCellHtml(regular, aux, act, horas, disabled, pid) {
  if (regular || aux) {
    return `<input type="number" min="0" step="1" data-act="horas" data-pid="${pid}" value="${horas}" ${disabled ? 'disabled' : ''} class="w-20 px-2 py-1 border border-outline-variant rounded bg-surface focus:border-primary text-center font-body-md"/>`;
  }
  const estado = act ? 'Sí' : 'No';
  return `<label class="inline-flex items-center gap-2 cursor-pointer">
    <input type="checkbox" data-act="actividad" data-pid="${pid}" class="sr-only peer" ${act ? 'checked' : ''} ${disabled ? 'disabled' : ''}/>
    <span class="relative w-11 h-6 bg-outline-variant peer-checked:bg-primary rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-5"></span>
    <span class="text-label-md ${act ? 'text-primary' : 'text-on-surface-variant'} font-medium select-none" data-act-label>${estado}</span>
  </label>`;
}

function auxCellHtml(regular, aux, disabled, pid) {
  if (regular) return `<span class="text-label-md text-label-md text-on-surface-variant">Regular</span>`;
  return `<input type="checkbox" data-act="auxiliar" data-pid="${pid}" ${aux ? 'checked' : ''} ${disabled ? 'disabled' : ''} class="form-checkbox text-primary rounded border-outline-variant cursor-pointer"/>`;
}

async function renderActivityGroupView(gid, withBack) {
  const dep = (state.departments || []).find(d => String(d.id) === String(gid));
  const groupName = dep ? (dep.name || 'Grupo') : 'Grupo';
  const month = state.reportMonth;
  const monthLabel = `${MONTHS_ES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
  const report = await db.getActivity(month) || { id: month, people: {}, locked: false };
  const members = state.people.filter(p => String(p.grupoId) === String(gid));
  let totalCursos = 0;
  let sinActividad = 0;
  members.forEach(p => {
    const v = report.people?.[p.id] || {};
    const act = p.precursorRegular === true || v.actividad === true;
    totalCursos += Number(v.cursos) || 0;
    if (!act) sinActividad++;
  });
  const months6 = lastMonths(month, 6);
  const allActivity = await db.listActivity();
  const reg = computeRegularity(members, allActivity, months6);
  const estado = report.locked ? 'Bloqueado' : 'En progreso';
  const initials = (name) => { const ps = String(name || '').trim().split(/\s+/); return ((ps[0]?.[0] || '') + (ps[1]?.[0] || '')).toUpperCase(); };
  const rows = members.map(p => {
    const v = report.people?.[p.id] || {};
    const regular = p.precursorRegular === true;
    const act = regular || v.actividad === true;
    const precBadge = regular ? `<span class="inline-block px-2 py-0.5 mt-1 bg-secondary text-on-secondary rounded text-[10px] uppercase font-bold tracking-wide">Precursor</span>` : '';
    const aux = !!v.auxiliar;
    const auxCell = auxCellHtml(regular, aux, report.locked, p.id);
    const actCell = actCellHtml(regular, aux, act, Number(v.horas) || 0, report.locked, p.id);
    return `<div class="grid grid-cols-12 gap-4 p-4 border-b border-outline-variant border-opacity-50 items-center hover:bg-surface-variant transition-colors group" data-row="${p.id}">
      <div class="col-span-4 flex items-center gap-3"><div class="w-8 h-8 rounded-full ${regular ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high text-on-surface-variant'} flex items-center justify-center font-bold text-sm">${escapeHtml(initials(p.name))}</div><div><p class="font-body-md text-body-md font-medium text-on-surface">${escapeHtml(p.name)}</p>${precBadge}</div></div>
      <div class="col-span-2 flex justify-center">${auxCell}</div>
      <div class="col-span-2 act-cell">${actCell}</div>
      <div class="col-span-2"><input type="number" min="0" step="1" data-act="cursos" data-pid="${p.id}" value="${Number(v.cursos) || 0}" ${report.locked ? 'disabled' : ''} class="w-20 px-2 py-1 border border-outline-variant rounded bg-surface focus:border-primary text-center font-body-md"/></div>
      <div class="col-span-2"><input type="text" data-act="notas" data-pid="${p.id}" value="${escapeAttr(v.notas || '')}" ${report.locked ? 'disabled' : ''} class="w-full px-3 py-1.5 border border-transparent hover:border-outline-variant focus:border-primary rounded bg-transparent focus:bg-surface focus:ring-0 font-body-md text-on-surface-variant transition-colors" placeholder="Añadir nota..."/></div>
    </div>`;
  }).join('');
  const back = withBack ? `<button id="activityBack" class="flex items-center gap-2 px-3 py-2 rounded-lg border border-outline-variant text-on-surface-variant font-label-md text-label-md hover:bg-surface-variant transition-colors"><span class="material-symbols-outlined text-sm">arrow_back</span> Grupos</button>` : '';
  const lockBtn = report.locked
    ? `<button id="activityLock" data-admin class="flex items-center gap-2 px-6 py-2.5 border border-primary text-primary rounded hover:bg-surface-variant transition-colors font-label-md text-label-md"><span class="material-symbols-outlined text-sm">lock_open</span> Desbloquear Tabla</button>`
    : `<button id="activityLock" data-admin class="flex items-center gap-2 px-6 py-2.5 border border-primary text-primary rounded hover:bg-surface-variant transition-colors font-label-md text-label-md"><span class="material-symbols-outlined text-sm">lock</span> Bloquear Tabla</button>`;
  const saveBtn = report.locked ? '' : `<button id="activitySave" class="flex items-center gap-2 px-6 py-2.5 bg-primary text-on-primary rounded hover:bg-opacity-90 transition-colors font-label-md text-label-md shadow-sm"><span class="material-symbols-outlined text-sm">save</span> Guardar</button>`;
  const sendBtn = `<button id="activitySend" class="flex items-center gap-2 px-6 py-2.5 bg-primary text-on-primary rounded hover:bg-opacity-90 transition-colors font-label-md text-label-md shadow-sm"><span class="material-symbols-outlined text-sm">send</span> Enviar Informe</button>`;
  return `<div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
      <div><h1 class="font-headline-lg text-headline-lg md:text-display-lg font-bold text-primary mb-2">Actividad del ${escapeHtml(groupName)}</h1><p class="font-body-lg text-body-lg text-on-surface-variant flex items-center gap-2"><span class="material-symbols-outlined text-lg">calendar_today</span>${monthLabel}</p></div>
      <div class="flex flex-wrap gap-4">${back}${lockBtn}${saveBtn}${sendBtn}</div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-4 gap-gutter mb-8">
      <div class="bg-surface-container-lowest p-6 rounded-lg border border-outline-variant shadow-sm relative overflow-hidden group"><div class="absolute top-0 left-0 w-1 h-full bg-primary"></div><p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-1">Total CURSOS</p><p class="font-headline-lg text-headline-lg text-primary">${totalCursos}</p></div>
      <div class="bg-surface-container-lowest p-6 rounded-lg border border-outline-variant shadow-sm relative overflow-hidden"><div class="absolute top-0 left-0 w-1 h-full bg-secondary"></div><p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-1">Sin actividad</p><p class="font-headline-lg text-headline-lg text-primary">${sinActividad}</p></div>
      <div class="bg-surface-container-lowest p-6 rounded-lg border border-outline-variant shadow-sm relative overflow-hidden"><div class="absolute top-0 left-0 w-1 h-full bg-tertiary-fixed-dim"></div><p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-1">Regularidad (6 m)</p><p class="font-headline-lg text-headline-lg text-primary">${reg.percentage}%</p><p class="text-caption text-on-surface-variant mt-1">${reg.regular} de ${reg.total} regulares</p></div>
      <div class="bg-surface-container-lowest p-6 rounded-lg border border-outline-variant shadow-sm relative overflow-hidden"><div class="absolute top-0 left-0 w-1 h-full bg-outline"></div><p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-1">Estado</p><p class="font-headline-md text-headline-md text-primary mt-1">${estado}</p></div>
    </div>
    <div class="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-sm flex flex-col overflow-hidden h-[600px]">
      <div class="grid grid-cols-12 gap-4 p-4 border-b border-outline-variant bg-surface-container-low font-label-md text-label-md text-on-surface-variant sticky top-0 z-10">
        <div class="col-span-4">Nombre</div><div class="col-span-2 text-center">Auxiliar</div><div class="col-span-2">Actividad / Horas</div><div class="col-span-2">Cursos</div><div class="col-span-2">Observación</div>
      </div>
      <div class="flex-1 overflow-y-auto table-scroll p-2">${rows || '<p class="p-8 text-center text-on-surface-variant">Sin publicadores en este grupo.</p>'}</div>
    </div>`;
}

function bindActivityTab() {
  const back = $('#activityBack');
  if (back) back.onclick = () => { state.reportGroup = null; renderInformes(); };
  document.querySelectorAll('[data-group-card]').forEach(b => b.onclick = () => { state.reportGroup = b.dataset.groupCard; renderInformes(); });
  const lock = $('#activityLock');
  if (lock) lock.onclick = async () => {
    const month = state.reportMonth;
    const report = await db.getActivity(month) || { id: month, people: {} };
    await db.putActivity({ ...report, locked: !report.locked });
    renderInformes();
  };
  const saveData = async () => {
    const month = state.reportMonth;
    const report = await db.getActivity(month) || { id: month, people: {}, locked: false };
    const people = { ...(report.people || {}) };
    const gid = state.reportGroup;
    state.people.forEach(p => {
      if (gid && String(p.grupoId) !== String(gid)) return;
      const get = k => document.querySelector(`[data-act="${k}"][data-pid="${p.id}"]`);
      const regular = p.precursorRegular === true;
      const auxChk = get('auxiliar');
      const auxiliar = regular ? false : !!auxChk?.checked;
      const isNumber = regular || auxiliar;
      const horas = isNumber ? (parseInt(get('horas')?.value, 10) || 0) : 0;
      const actividad = regular || (isNumber ? true : !!get('actividad')?.checked);
      people[p.id] = {
        actividad,
        auxiliar,
        cursos: parseInt(get('cursos')?.value, 10) || 0,
        horas,
        notas: get('notas')?.value || '',
      };
    });
    await db.putActivity({ ...report, people });
    return report;
  };
  const save = $('#activitySave');
  if (save) save.onclick = async () => {
    await saveData();
    toast('Actividad guardada', 'success');
    renderInformes();
  };
  const send = $('#activitySend');
  if (send) send.onclick = async () => {
    await saveData();
    toast('Informe enviado correctamente', 'success');
  };
  document.querySelectorAll('[data-act="auxiliar"]').forEach(c => c.onchange = () => {
    const pid = c.dataset.pid;
    const row = document.querySelector(`[data-row="${pid}"]`);
    const cell = row?.querySelector('.act-cell');
    if (!cell) return;
    const horasPrev = row.querySelector('[data-act="horas"]')?.value || 0;
    cell.innerHTML = actCellHtml(false, c.checked, false, horasPrev, c.disabled, pid);
    bindActividad(c.parentElement);
  });
  function bindActividad(scope) {
    (scope || document).querySelectorAll('[data-act="actividad"]').forEach(c => {
      c.onchange = () => {
        const lbl = c.closest('label')?.querySelector('[data-act-label]');
        if (!lbl) return;
        lbl.textContent = c.checked ? 'Sí' : 'No';
        lbl.classList.toggle('text-primary', c.checked);
        lbl.classList.toggle('text-on-surface-variant', !c.checked);
      };
    });
  }
  bindActividad();
}

function formatShortDate(iso) {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('es', { day: '2-digit', month: 'short' }); }
  catch (e) { return iso; }
}

async function computeServiceYearMetrics(year) {
  const months = serviceYearMonths(year);
  const reports = (await db.listActivity()).filter(r => months.includes(r.id));
  const byPerson = {};
  state.people.forEach(p => byPerson[p.id] = { name: p.name, active: 0, courses: 0, aux: 0, hours: 0 });
  reports.forEach(r => {
    Object.entries(r.people || {}).forEach(([pid, v]) => {
      const bp = byPerson[pid];
      if (!bp) return;
      if (v.actividad) bp.active++;
      bp.courses += Number(v.cursos) || 0;
      if (v.auxiliar) bp.aux++;
      bp.hours += Number(v.horas) || 0;
    });
  });
  const rows = Object.values(byPerson);
  const totals = {
    publishers: rows.length,
    active: rows.filter(r => r.active > 0).length,
    courses: rows.reduce((s, r) => s + r.courses, 0),
    hours: rows.reduce((s, r) => s + r.hours, 0),
    aux: rows.reduce((s, r) => s + r.aux, 0),
  };
  return { rows, totals };
}

async function renderMetricsSection(year) {
  const { rows, totals } = await computeServiceYearMetrics(year);
  const cards = [
    ['Publicadores', totals.publishers],
    ['Activos (meses)', totals.active],
    ['Cursos (año)', totals.courses],
    ['Horas (año)', totals.hours],
    ['Meses auxiliar', totals.aux],
  ].map(([l, v]) => `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-4 text-center"><div class="font-display-sm text-display-sm text-primary">${v}</div><div class="font-label-sm text-label-sm text-on-surface-variant">${l}</div></div>`).join('');
  const prow = rows.filter(r => r.active > 0).sort((a, b) => b.active - a.active).map(r => `<tr class="border-b border-outline-variant/40"><td class="p-2 font-semibold">${escapeHtml(r.name)}</td><td class="p-2 text-center">${r.active}</td><td class="p-2 text-center">${r.courses}</td><td class="p-2 text-center">${r.aux}</td><td class="p-2 text-center">${r.hours}</td></tr>`).join('');
  return `<h3 class="font-headline-md text-headline-md text-primary mt-8 mb-3">Métricas del año de servicio ${serviceYearLabel(year)}</h3>
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3">${cards}</div>
    <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-x-auto mt-4">
      <table class="w-full text-left min-w-[500px]"><thead><tr class="bg-surface-container border-b border-outline-variant"><th class="p-2">Publicador</th><th class="p-2 text-center">Meses activo</th><th class="p-2 text-center">Cursos</th><th class="p-2 text-center">Auxiliar</th><th class="p-2 text-center">Horas</th></tr></thead><tbody>${prow || '<tr><td colspan="5" class="p-6 text-center text-on-surface-variant">Sin actividad registrada.</td></tr>'}</tbody></table>
    </div>`;
}

async function renderAttendanceTab() {
  const month = isoDate(new Date()).slice(0, 7);
  const monthLabel = `${MONTHS_ES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
  const cfg = state.config || {}, events = state.config?.events || {};
  const sy = currentServiceYear();
  const dates = meetingDatesForYear(sy, cfg, events);
  const mk = dates.midweek.filter(d => d.date.startsWith(month));
  const we = dates.weekend.filter(d => d.date.startsWith(month));
  const att = await db.getAttendance(sy) || { id: sy, midweek: {}, weekend: {} };
  const cong = await db.getSetting('congregation', '') || '';
  const todayKey = weekKeyOf(isoDate(new Date()));
  const table = (kind, ds) => {
    const saved = att[kind] || {};
    const rows = ds.map((d, i) => {
      const val = saved[d.date];
      const isActual = weekKeyOf(d.date) === todayKey;
      let badge = '';
      if (d.ev === 'commemoration') badge += ' <span class="ml-2 px-2 py-0.5 bg-secondary text-on-secondary text-caption rounded-full uppercase tracking-tighter">Conmemoración</span>';
      else if (d.ev === 'assembly') badge += ' <span class="ml-2 px-2 py-0.5 bg-secondary text-on-secondary text-caption rounded-full uppercase tracking-tighter">Asamblea</span>';
      if (d.supervisor) badge += ' <span class="material-symbols-outlined align-middle text-[14px] text-primary" title="Visita del superintendente">verified</span>';
      if (isActual) badge += ' <span class="ml-2 px-2 py-0.5 bg-primary text-on-primary text-caption rounded-full uppercase tracking-tighter">Actual</span>';
      const cell = d.blank ? `<td class="py-4 px-4 text-right text-on-surface-variant italic">Sin reunión</td>`
        : `<td class="py-4 px-4 text-right"><input type="number" min="0" step="1" data-att="${kind}" data-date="${d.date}" value="${val != null ? val : ''}" class="w-20 text-center border border-outline-variant rounded bg-surface focus:ring-1 focus:ring-primary focus:border-primary px-2 py-1 att-input"/></td>`;
      let rowCls = 'border-b border-outline-variant/30 hover:bg-surface-container-low transition-colors';
      if (isActual || d.ev === 'assembly' || d.ev === 'commemoration') rowCls += ' border-l-4 border-primary font-semibold';
      if (isActual) rowCls += ' bg-tertiary-fixed';
      else if (d.ev === 'assembly' || d.ev === 'commemoration') rowCls += ' bg-secondary-container';
      return `<tr class="${rowCls}"><td class="py-4 pr-4">Semana ${i + 1} (${formatShortDate(d.date)})${badge}</td>${cell}</tr>`;
    }).join('');
    return `<section class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden p-6 relative"><div class="absolute left-0 top-0 bottom-0 w-1 bg-${kind === 'midweek' ? 'primary' : 'secondary'}"></div>
      <h2 class="font-headline-md text-headline-md text-primary mb-6 flex items-center gap-3"><span class="material-symbols-outlined text-secondary">${kind === 'midweek' ? 'menu_book' : 'wb_sunny'}</span>${kind === 'midweek' ? 'Reunión de Entre Semana' : 'Reunión del Fin de Semana'}</h2>
      <div class="overflow-x-auto"><table class="w-full text-left border-collapse"><thead><tr class="border-b border-outline-variant text-on-surface-variant font-label-md text-label-md"><th class="pb-3 pr-4 font-normal">Fecha</th><th class="pb-3 px-4 font-normal text-right">Asistencia</th></tr></thead><tbody class="font-body-md text-body-md">${rows}</tbody></table></div></section>`;
  };
  return `<div class="flex flex-col md:flex-row justify-between items-start md:items-end mb-10 pb-6 border-b border-outline-variant">
      <div><h1 class="font-display-lg text-display-lg text-primary mb-2">${monthLabel}</h1><p class="font-body-lg text-body-lg text-on-surface-variant">${escapeHtml(cong)}</p></div>
      <div class="flex gap-4 mt-6 md:mt-0">
        <button id="attSave" class="bg-surface-container-high text-primary font-label-md text-label-md px-6 py-3 rounded border border-outline-variant hover:bg-surface-variant transition-colors flex items-center gap-2"><span class="material-symbols-outlined text-[18px]">save</span>Guardar</button>
        <button id="attDownload" class="bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded shadow-sm hover:bg-tertiary transition-colors flex items-center gap-2"><span class="material-symbols-outlined text-[18px]">download</span>Descargar Informe</button>
      </div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-gutter mb-10">${table('midweek', mk)}${table('weekend', we)}</div>
    <section class="bg-surface-container-high/50 backdrop-blur-sm rounded-xl border border-outline-variant p-8 flex flex-col md:flex-row items-center justify-between gap-8">
      <div class="flex items-center gap-6"><div class="w-16 h-16 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center"><span class="material-symbols-outlined text-[32px]">bar_chart</span></div>
      <div><h3 class="font-headline-md text-headline-md text-primary mb-1">Resumen del Mes</h3><p class="font-body-md text-body-md text-on-surface-variant">Datos consolidados de las reuniones registradas.</p></div></div>
      <div class="flex flex-col gap-6 w-full md:w-auto">
        <div class="flex gap-12 text-center items-center justify-between md:justify-start">
          <div class="text-left w-32"><p class="font-label-md text-label-md text-primary mb-1">Entre Semana</p></div>
          <div><p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-2">Total</p><p class="font-display-lg text-display-lg text-primary" id="mw-total">0</p></div>
          <div class="w-px h-16 bg-outline-variant hidden md:block"></div>
          <div><p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-2">Promedio</p><p class="font-display-lg text-display-lg text-secondary" id="mw-avg">0</p></div>
        </div>
        <div class="w-full h-px bg-outline-variant/50"></div>
        <div class="flex gap-12 text-center items-center justify-between md:justify-start">
          <div class="text-left w-32"><p class="font-label-md text-label-md text-primary mb-1">Fin de Semana</p></div>
          <div><p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-2">Total</p><p class="font-display-lg text-display-lg text-primary" id="we-total">0</p></div>
          <div class="w-px h-16 bg-outline-variant hidden md:block"></div>
          <div><p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-2">Promedio</p><p class="font-display-lg text-display-lg text-secondary" id="we-avg">0</p></div>
        </div>
      </div>
    </section>`;
}

async function bindAttendanceTab() {
  const sy = currentServiceYear();
  const att = await db.getAttendance(sy) || { id: sy, midweek: {}, weekend: {} };
  const compute = () => {
    let mwT = 0, mwC = 0, weT = 0, weC = 0;
    document.querySelectorAll('.att-input[data-att="midweek"]').forEach(i => { const v = parseInt(i.value, 10); if (!isNaN(v)) { mwT += v; mwC++; } });
    document.querySelectorAll('.att-input[data-att="weekend"]').forEach(i => { const v = parseInt(i.value, 10); if (!isNaN(v)) { weT += v; weC++; } });
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('mw-total', mwT); set('mw-avg', mwC ? Math.round(mwT / mwC) : 0);
    set('we-total', weT); set('we-avg', weC ? Math.round(weT / weC) : 0);
  };
  compute();
  document.querySelectorAll('.att-input').forEach(inp => {
    inp.addEventListener('input', async () => {
      const v = parseInt(inp.value, 10);
      if (isNaN(v) || v < 0) return;
      att[inp.dataset.att][inp.dataset.date] = v;
      await db.putAttendance({ ...att, id: sy });
      compute();
    });
  });
  const dl = $('#attDownload');
  if (dl) dl.onclick = () => downloadAsistenciaMes(isoDate(new Date()).slice(0, 7), 'pdf');
  const sv = $('#attSave');
  if (sv) sv.onclick = () => toast('Asistencia guardada', 'success');
}

async function renderArrangementsTab() {
  const months = serviceYearMonths(currentServiceYear());
  const month = state.reportMonth && months.includes(state.reportMonth) ? state.reportMonth : months[0];
  const nextM = addMonths(month, 1);
  const arr = await db.getArrangements(month) || { id: month, congregation: '', contact: '', phone: '', notes: '', localSpeakers: [] };
  const arrNext = await db.getArrangements(nextM) || { id: nextM, congregation: '', contact: '', phone: '', notes: '', localSpeakers: [] };
  const allArr = await db.listArrangements();
  const ranking = computeTalkRanking(allArr);
  const oradoresSalida = state.people.filter(p => p.activo !== false && laboreEligible(p, 'salida'));
  const localRows = (arr.localSpeakers || []).map((ls, i) => `
    <li class="group flex items-start justify-between p-3 rounded-lg hover:bg-surface-container-low transition-colors border border-transparent hover:border-outline-variant/50">
      <div><p class="font-label-md text-label-md text-on-surface mb-2 group-hover:text-primary transition-colors">${escapeHtml(ls.speaker || 'Orador')}</p>
      <div class="flex flex-wrap gap-2">${String(ls.num).split(',').map(n => `<span class="bg-secondary/10 text-secondary border border-secondary/20 px-2 py-0.5 rounded text-[11px] font-semibold">${escapeHtml(n.trim())}</span>`).join('')}</div></div>
      <button data-local-remove="${i}" class="opacity-0 group-hover:opacity-100 transition-opacity text-outline hover:text-primary p-1"><span class="material-symbols-outlined text-[18px]">delete</span></button>
    </li>`).join('');
  const salidaRows = oradoresSalida.map(p => `
    <li class="flex items-center gap-3 p-3 rounded-lg bg-surface-container-low/50 border border-outline-variant/30 cursor-pointer hover:bg-surface-container-low transition-colors" data-speaker-card="${p.id}">
      <div class="w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center font-bold text-sm">${escapeHtml(((p.name || '').split(/\s+/).map(w => w[0]).slice(0, 2).join('')).toUpperCase())}</div>
      <div class="flex-1 min-w-0"><p class="font-body-md text-body-md font-medium text-on-surface truncate hover:text-primary transition-colors">${escapeHtml(p.name)}</p></div>
      <span class="bg-secondary/10 text-secondary border border-secondary/20 px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap">Orador de salida</span>
    </li>`).join('');
  const rankMap = {};
  ranking.forEach(r => rankMap[String(r.num)] = r);
  const talkRows = (state.talks || []).map(t => {
    const r = rankMap[String(t.num)];
    const count = r ? r.count : 0;
    const last = r && r.last ? formatShortDate(r.last) : '—';
    const badge = count === 0
      ? `<div class="bg-tertiary-fixed text-on-tertiary-fixed border border-tertiary/30 px-3 py-1 rounded-full text-[12px] font-semibold flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">schedule</span> 0 veces</div>`
      : count >= 5
        ? `<div class="bg-error-container text-on-error-container border border-error/30 px-3 py-1 rounded-full text-[12px] font-semibold flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">trending_up</span> ${count} veces</div>`
        : `<div class="bg-surface-variant text-on-surface-variant border border-outline-variant px-3 py-1 rounded-full text-[12px] font-semibold">${count} veces</div>`;
    return `<tr class="hover:bg-surface-container-low transition-colors group" data-talk-row data-talk-num="${t.num}" data-talk-title="${escapeAttr((t.title || '').toLowerCase())}">
      <td class="py-4 px-6 font-semibold text-primary">${t.num}</td>
      <td class="py-4 px-6"><div class="font-medium text-on-surface mb-1">${escapeHtml(t.title || '')}</div></td>
      <td class="py-4 px-6 text-on-surface-variant">${last}</td>
      <td class="py-4 px-6"><div class="flex justify-center items-center">${badge}</div></td>
    </tr>`;
  }).join('');
  const exchangeCard = (m, a, isNext) => {
    const mLabel = `${MONTHS_ES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
    const cong = a.congregation || 'Sin asignar';
    const hasData = a.congregation || a.contact || a.phone;
    return `<div class="bg-surface-container-lowest rounded-xl border ${hasData ? 'border-primary/30' : 'border-outline-variant'} shadow-sm overflow-hidden relative cursor-pointer hover:shadow-md hover:border-primary/50 transition-all group" data-exchange-card="${m}">
      <div class="absolute left-0 top-0 bottom-0 w-1 ${hasData ? 'bg-primary' : 'bg-outline-variant'}"></div>
      <div class="p-5 pl-6">
        <div class="flex justify-between items-start mb-3">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-primary text-[20px]">swap_horiz</span>
            <h4 class="font-headline-md text-[16px] text-primary font-bold">${isNext ? 'Proximo mes' : 'Mes actual'}</h4>
          </div>
          <span class="bg-secondary-container text-on-secondary-container px-2.5 py-0.5 rounded-full font-label-md text-[11px] uppercase tracking-wider">${mLabel}</span>
        </div>
        <p class="font-body-md text-body-md text-on-surface mb-1">${escapeHtml(cong)}</p>
        ${hasData ? `<p class="text-caption text-outline">${a.contact ? escapeHtml(a.contact) : ''}${a.phone ? ' · ' + escapeHtml(a.phone) : ''}</p>` : '<p class="text-caption text-outline">Pulsa para configurar</p>'}
        <div class="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
          <span class="material-symbols-outlined text-outline">chevron_right</span>
        </div>
      </div>
    </div>`;
  };
  return `<div class="flex items-center justify-between gap-3 mb-4"><h2 class="font-headline-md text-headline-md text-primary">Arreglos</h2><select id="arrMonth" class="bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md">${months.map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${MONTHS_ES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}</option>`).join('')}</select></div>
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
      <div class="lg:col-span-4 flex flex-col gap-gutter">
        <section class="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden relative"><div class="absolute left-0 top-0 bottom-0 w-1 bg-primary"></div>
          <div class="p-6">
            <div class="flex justify-between items-start mb-4"><h3 class="font-headline-md text-[20px] text-primary font-bold">Intercambio Mensual</h3></div>
            <div class="flex flex-col gap-3">
              ${exchangeCard(month, arr, false)}
              ${exchangeCard(nextM, arrNext, true)}
            </div>
          </div>
        </section>
        <section class="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm flex-1 flex flex-col min-h-[400px]">
          <div class="p-6 border-b border-outline-variant/30 flex justify-between items-center bg-surface-bright rounded-t-xl"><h2 class="font-headline-md text-[20px] text-primary font-bold">Oradores Locales</h2><button id="addLocal" class="text-primary hover:text-tertiary transition-colors"><span class="material-symbols-outlined">add_circle</span></button></div>
          <div class="p-4 flex-1 overflow-y-auto"><ul id="localSpeakers" class="space-y-4">${salidaRows}${localRows}</ul></div>
        </section>
      </div>
      <div class="lg:col-span-8">
        <section class="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm h-full flex flex-col">
          <div class="p-6 border-b border-outline-variant/50 bg-surface-bright rounded-t-xl">
            <div class="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6"><div><h2 class="font-headline-lg text-[28px] text-primary font-bold mb-1">Catálogo de Discursos</h2><p class="font-body-md text-on-surface-variant text-[14px]">Control y rotación de los ${state.talks.length} bosquejos públicos.</p></div></div>
            <div class="relative"><span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span><input id="talkSearch" class="w-full bg-surface-container-low border border-outline-variant text-on-surface rounded-lg py-3 pl-10 pr-4 focus:outline-none focus:border-primary font-body-md text-[14px]" placeholder="Consulta por número, título o palabra clave..."/></div>
          </div>
          <div class="flex-1 overflow-x-auto"><table class="w-full text-left border-collapse"><thead class="bg-surface-container-lowest sticky top-0 z-10 shadow-sm"><tr class="border-b border-outline-variant"><th class="py-4 px-6 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-20">Núm.</th><th class="py-4 px-6 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Título del Discurso</th><th class="py-4 px-6 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-32">Última Vez</th><th class="py-4 px-6 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider text-center w-32">Ranking</th></tr></thead><tbody id="talkBody" class="font-body-md text-[14px] text-on-surface divide-y divide-outline-variant/30">${talkRows}</tbody></table></div>
        </section>
      </div>
    </div>`;
}

function bindArrangementsTab() {
  const monthSel = $('#arrMonth');
  if (monthSel) monthSel.onchange = () => { state.reportMonth = monthSel.value; renderInformes(); };
  document.querySelectorAll('[data-exchange-card]').forEach(el => el.onclick = () => {
    openExchangeModal(el.dataset.exchangeCard);
  });
  document.querySelectorAll('[data-speaker-card]').forEach(el => el.onclick = () => {
    const pid = el.dataset.speakerCard;
    const person = state.people.find(p => String(p.id) === String(pid));
    if (person) openSpeakerCard(person);
  });
  const search = $('#talkSearch');
  if (search) search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    document.querySelectorAll('[data-talk-row]').forEach(r => {
      const ok = !q || String(r.dataset.talkNum).includes(q) || r.dataset.talkTitle.includes(q);
      r.style.display = ok ? '' : 'none';
    });
  };
}

async function openExchangeModal(monthId) {
  const mLabel = `${MONTHS_ES[Number(monthId.slice(5)) - 1]} ${monthId.slice(0, 4)}`;
  const arr = await db.getArrangements(monthId) || { id: monthId, congregation: '', contact: '', phone: '', notes: '', localSpeakers: [] };
  const oradoresSalida = state.people.filter(p => p.activo !== false && laboreEligible(p, 'salida'));
  const speakerRows = oradoresSalida.map(p => `
    <div class="flex items-center gap-3 p-3 rounded-lg bg-surface-container-low/50 border border-outline-variant/30">
      <div class="w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center font-bold text-sm">${escapeHtml(((p.name || '').split(/\s+/).map(w => w[0]).slice(0, 2).join('')).toUpperCase())}</div>
      <div class="flex-1 min-w-0"><p class="font-body-md text-body-md font-medium text-on-surface truncate">${escapeHtml(p.name)}</p></div>
      <span class="bg-secondary/10 text-secondary border border-secondary/20 px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap">Orador de salida</span>
    </div>`).join('');
  const localItems = (arr.localSpeakers || []).map((ls, i) => `
    <li class="group flex items-start justify-between p-3 rounded-lg hover:bg-surface-container-low transition-colors border border-transparent hover:border-outline-variant/50">
      <div class="flex-1 min-w-0"><p class="font-label-md text-label-md text-on-surface mb-1">${escapeHtml(ls.speaker || 'Orador')}</p>
      <div class="flex flex-wrap gap-1">${String(ls.num || '').split(',').map(n => n.trim() ? `<span class="bg-secondary/10 text-secondary border border-secondary/20 px-2 py-0.5 rounded text-[11px] font-semibold">${escapeHtml(n.trim())}</span>` : '').join('')}</div></div>
      <button data-exch-local-remove="${i}" class="opacity-0 group-hover:opacity-100 transition-opacity text-outline hover:text-primary p-1"><span class="material-symbols-outlined text-[18px]">delete</span></button>
    </li>`).join('');
  const html = `
    <div class="flex flex-col gap-6">
      <div class="flex items-center justify-between">
        <div><h2 class="font-headline-md text-headline-md text-primary font-bold">Intercambio Mensual</h2><p class="text-on-surface-variant font-body-md text-body-md flex items-center gap-2 mt-1"><span class="material-symbols-outlined text-[16px]">calendar_today</span>${mLabel}</p></div>
        <button id="exchClose" class="text-on-surface-variant hover:text-primary transition-colors"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest mb-2">Congregacion</p><input id="exchCong" value="${escapeAttr(arr.congregation || '')}" placeholder="Nombre de la congregacion" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 focus:border-primary"/></div>
        <div><p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest mb-2">Coordinador</p><input id="exchContact" value="${escapeAttr(arr.contact || '')}" placeholder="Nombre del coordinador" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 mb-2 focus:border-primary"/><input id="exchPhone" value="${escapeAttr(arr.phone || '')}" placeholder="Telefono" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 focus:border-primary"/></div>
      </div>
      <div><p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest mb-2">Observaciones</p><textarea id="exchNotes" placeholder="Notas adicionales..." class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 focus:border-primary" rows="3">${escapeHtml(arr.notes || '')}</textarea></div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest mb-3">Oradores de Salida</p>
          <div class="flex flex-col gap-2 max-h-[200px] overflow-y-auto">${speakerRows || '<p class="text-caption text-outline">No hay oradores configurados</p>'}</div>
        </div>
        <div>
          <div class="flex justify-between items-center mb-3"><p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Oradores Locales</p><button id="exchAddLocal" class="text-primary hover:text-tertiary transition-colors"><span class="material-symbols-outlined text-[20px]">add_circle</span></button></div>
          <ul id="exchLocalList" class="flex flex-col gap-2 max-h-[200px] overflow-y-auto">${localItems || '<li class="text-caption text-outline p-2">Sin oradores locales</li>'}</ul>
        </div>
      </div>
      <div class="flex justify-end gap-3 pt-4 border-t border-outline-variant/30">
        <button id="exchCancel" class="border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition-colors rounded px-5 py-2.5 font-label-md text-label-md">Cancelar</button>
        <button id="exchSave" class="bg-primary text-on-primary hover:opacity-90 transition-opacity rounded px-6 py-2.5 font-label-md text-label-md shadow-sm">Guardar</button>
      </div>
    </div>`;
  openModal(html, true);
  $('#exchClose').onclick = closeModal;
  $('#exchCancel').onclick = closeModal;
  $('#exchAddLocal').onclick = () => {
    const box = $('#exchLocalList');
    const li = document.createElement('li');
    li.className = 'group flex items-start justify-between p-3 rounded-lg hover:bg-surface-container-low transition-colors border border-transparent hover:border-outline-variant/50';
    li.innerHTML = `<div class="flex-1"><input data-exch-local="speaker" placeholder="Orador" class="bg-surface-bright border border-outline-variant rounded-lg p-2 mb-2 w-full text-sm"/><input data-exch-local="num" placeholder="Numeros (ej. 1,17)" class="bg-surface-bright border border-outline-variant rounded-lg p-2 w-full text-sm"/></div><button data-exch-local-remove="x" class="text-outline hover:text-primary p-1"><span class="material-symbols-outlined text-[18px]">delete</span></button>`;
    box.appendChild(li);
    li.querySelector('[data-exch-local-remove]').onclick = () => li.remove();
  };
  document.querySelectorAll('[data-exch-local-remove]').forEach(b => b.onclick = () => b.closest('li')?.remove());
  $('#exchSave').onclick = async () => {
    const local = [];
    document.querySelectorAll('#exchLocalList li').forEach(li => {
      const speaker = li.querySelector('[data-exch-local="speaker"]')?.value || '';
      const num = li.querySelector('[data-exch-local="num"]')?.value || '';
      if (speaker || num) local.push({ speaker, num, date: '' });
    });
    const rec = { id: monthId, congregation: $('#exchCong').value, contact: $('#exchContact').value, phone: $('#exchPhone').value, notes: $('#exchNotes').value, localSpeakers: local };
    await db.putArrangements(rec);
    toast('Intercambio guardado', 'success');
    closeModal();
    renderInformes();
  };
}

function openSpeakerCard(person) {
  const name = person.name || 'Orador';
  const phone = person.telefono || '';
  const bio = person.notas || '';
  const initials = ((name || '').split(/\s+/).map(w => w[0]).slice(0, 2).join('')).toUpperCase();
  const talks = (state.talks || []).slice(0, 8);
  const talkList = talks.map((t, i) => `
    <li class="flex items-start gap-4 py-3 border-b border-outline-variant/10 last:border-0 group">
      <div class="bg-surface-variant text-on-surface-variant font-label-md text-label-md w-[40px] text-center rounded py-1 shrink-0 group-hover:bg-primary-fixed group-hover:text-on-primary-fixed transition-colors">#${t.num}</div>
      <p class="font-body-md text-body-md text-on-surface pt-[2px]">${escapeHtml(t.title || '')}</p>
    </li>`).join('');
  const bioSection = bio ? `
    <div class="relative py-6">
      <span class="material-symbols-outlined absolute top-0 left-0 text-primary-fixed-dim text-opacity-30 text-[48px] -translate-x-2 -translate-y-4">format_quote</span>
      <p class="font-body-lg text-body-lg text-on-surface-variant leading-relaxed relative z-10 pl-2 border-l-2 border-outline-variant/30">${escapeHtml(bio)}</p>
    </div>` : '';
  const phoneSection = phone ? `<span class="font-body-md text-body-md text-on-surface-variant flex items-center gap-1"><span class="material-symbols-outlined text-[16px]">call</span>${escapeHtml(phone)}</span>` : '';
  const cardId = `speaker-card-${person.id}`;
  const modalHtml = `
    <div class="relative w-full bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden flex flex-col md:flex-row">
      <div class="absolute left-0 top-0 bottom-0 w-2 bg-primary hidden md:block"></div>
      <div class="absolute left-0 top-0 right-0 h-2 bg-primary block md:hidden"></div>
      <div class="flex-1 p-6 md:p-10 md:pl-12 flex flex-col justify-between">
        <div class="flex flex-col gap-6">
          <div>
            <div class="flex items-center gap-3 mb-2">
              <span class="inline-flex items-center justify-center px-2.5 py-1 rounded bg-secondary-container text-on-secondary-container font-label-md text-label-md uppercase tracking-wider text-[11px]">Orador de salida</span>
              ${phoneSection}
            </div>
            <h2 class="font-headline-lg text-headline-lg md:text-[40px] leading-tight text-on-surface text-balance">${escapeHtml(name)}</h2>
          </div>
          ${bioSection}
          ${talks.length ? `
          <div class="mt-4">
            <h3 class="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest mb-4">Discursos Disponibles</h3>
            <ul class="flex flex-col">${talkList}</ul>
          </div>` : ''}
        </div>
        <div class="mt-10 pt-6 border-t border-outline-variant/20 flex justify-end gap-3">
          <button id="speakerCloseBtn" class="border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition-colors rounded px-6 py-3 flex items-center gap-3 font-label-md text-label-md">Cerrar</button>
          <button id="speakerDlBtn" class="bg-primary text-on-primary hover:bg-primary-container hover:text-on-primary-container transition-all shadow-sm hover:shadow-md rounded px-6 py-3 flex items-center gap-3 font-label-md text-label-md group">
            <span class="material-symbols-outlined text-[20px] group-hover:-translate-y-0.5 transition-transform">download</span>
            Descargar como Imagen
          </button>
        </div>
      </div>
    </div>`;
  openModal(modalHtml, true);
  $('#speakerCloseBtn').onclick = closeModal;
  $('#speakerDlBtn').onclick = () => {
    const svgStr = speakerCardSvg(person);
    svgToPngBlob(svgStr).then(blob => {
      downloadBlob(blob, `orador-${(person.name || 'orador').replace(/\s+/g, '-').toLowerCase()}.png`);
      toast('Imagen descargada', 'success');
    }).catch(() => toast('No se pudo generar la imagen', 'error'));
  };
}

function speakerCardSvg(person) {
  const name = person.name || 'Orador';
  const phone = person.telefono || '';
  const bio = person.notas || '';
  const talks = (state.talks || []).slice(0, 8);
  const W = 800, PAD = 40;
  const C = { bg: '#ffffff', primary: '#032121', text: '#1a1c1c', muted: '#414848', accent: '#cae8e8', border: '#c1c8c7', badge: '#f6dcb5', badgeText: '#736041', surface: '#f3f3f3' };
  let y = PAD;
  const lines = [];
  const barW = 8;
  lines.push(`<rect x="0" y="0" width="${W}" height="1" fill="${C.bg}"/>`);
  lines.push(`<rect x="0" y="0" width="${barW}" height="100%" fill="${C.primary}"/>`);
  lines.push(`<rect x="${PAD}" y="${y}" width="110" height="24" rx="4" fill="${C.badge}"/>`);
  lines.push(`<text x="${PAD + 55}" y="${y + 16}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="${C.badgeText}">ORADOR DE SALIDA</text>`);
  if (phone) {
    lines.push(`<text x="${W - PAD}" y="${y + 16}" text-anchor="end" font-family="system-ui, sans-serif" font-size="13" fill="${C.muted}">${svgEscape(phone)}</text>`);
  }
  y += 44;
  const nameLines = svgTextLines(name, 36, W - PAD * 2 - barW);
  nameLines.forEach((ln, i) => {
    lines.push(svgT(PAD + barW, y + 36 + i * 42, ln, 36, 700, C.text));
  });
  y += nameLines.length * 42 + 20;
  if (bio) {
    lines.push(`<line x1="${PAD + barW}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${C.border}" stroke-opacity="0.3" stroke-width="1"/>`);
    y += 20;
    const bioLines = svgTextLines(bio, 16, W - PAD * 2 - barW - 20);
    bioLines.forEach((ln, i) => {
      lines.push(`<line x1="${PAD + barW}" y1="${y - 4}" x2="${PAD + barW}" y2="${y + 18}" stroke="${C.border}" stroke-opacity="0.3" stroke-width="2"/>`);
      lines.push(svgT(PAD + barW + 16, y + 14, ln, 16, 400, C.muted));
      y += 22;
    });
    y += 10;
  }
  if (talks.length) {
    lines.push(`<text x="${PAD + barW}" y="${y + 14}" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="${C.muted}" letter-spacing="0.1em">DISCURSOS DISPONIBLES</text>`);
    y += 30;
    talks.forEach((t) => {
      lines.push(`<rect x="${PAD + barW}" y="${y}" width="44" height="24" rx="4" fill="${C.surface}"/>`);
      lines.push(`<text x="${PAD + barW + 22}" y="${y + 16}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" font-weight="600" fill="${C.muted}">#${t.num}</text>`);
      lines.push(svgT(PAD + barW + 56, y + 16, t.title || '', 14, 400, C.text));
      y += 34;
    });
  }
  y += PAD;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}">
    <rect width="${W}" height="${y}" fill="${C.bg}"/>
    ${lines.join('\n    ')}
  </svg>`;
  return svg;
}

async function renderFormsTab() {
  const months = serviceYearMonths(currentServiceYear());
  const month = state.reportMonth && months.includes(state.reportMonth) ? state.reportMonth : months[0];
  const monthOpts = months.map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${MONTHS_ES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}</option>`).join('');
  const peopleOpts = (state.people || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(p => `<option value="${p.id}">${p.name || ''}</option>`).join('');
  const yearOpts = [currentServiceYear(), currentServiceYear() + 1].map(y => `<option value="${y}">${serviceYearLabel(y)}</option>`).join('');
  const card = (id, title, desc, sel, btns) => `
    <section class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6">
      <h3 class="font-headline-md text-headline-md text-primary mb-1">${title}</h3>
      <p class="font-body-md text-body-md text-on-surface-variant mb-4">${desc}</p>
      ${sel}
      <div class="flex gap-2 mt-4">${btns}</div>
    </section>`;
  const pdfPng = (kind) => `
      <button data-form="${kind}" data-fmt="pdf" class="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90"><span class="material-symbols-outlined">picture_as_pdf</span> PDF</button>
      <button data-form="${kind}" data-fmt="png" class="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-surface-container-high text-primary font-label-md text-label-md border border-outline-variant hover:bg-surface-variant"><span class="material-symbols-outlined">image</span> PNG</button>`;
  const cards = [
    card('predicacion', 'Informe de Predicación (S-1-S)', 'Informe de predicación y asistencia a las reuniones de la congregación.', `<select id="fPredMes" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 mb-2">${monthOpts}</select>`, pdfPng('predicacion')),
    card('registro', 'Registro de Asistencia (2 años)', 'Registro de asistencia a las reuniones, dos años de servicio.', `<p class="text-on-surface-variant text-body-md">Año de servicio: ${serviceYearLabel(currentServiceYear())} y ${serviceYearLabel(currentServiceYear() + 1)}</p>`, pdfPng('registro')),
    card('asistenciaMes', 'Informe de Asistencia Mensual (S-3-S)', 'Asistencia mensual por semanas (entre semana / fin de semana).', `<select id="fAsistMes" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 mb-2">${monthOpts}</select>`, pdfPng('asistenciaMes')),
    card('pubreg', 'Registro de Publicador', 'Formulario anual por publicador con su actividad del año de servicio.', `<select id="fPubPerson" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 mb-2">${peopleOpts}</select><select id="fPubYear" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 mb-2">${yearOpts}</select>`, pdfPng('pubreg')),
  ].join('');
  return `<h2 class="font-headline-md text-headline-md text-primary mb-4">Formularios descargables</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${cards}</div>`;
}

function bindFormsTab() {
  document.querySelectorAll('button[data-form]').forEach(b => {
    if (b.disabled) return;
    b.onclick = () => {
      const kind = b.dataset.form, fmt = b.dataset.fmt;
      if (kind === 'predicacion') downloadPredicacion($('#fPredMes').value, fmt);
      else if (kind === 'registro') downloadRegistro(currentServiceYear(), fmt);
      else if (kind === 'asistenciaMes') downloadAsistenciaMes($('#fAsistMes').value, fmt);
      else if (kind === 'pubreg') downloadPubReg($('#fPubPerson').value, fmt, $('#fPubYear').value);
    };
  });
}

function computeTalkRanking(allArr) {
  const map = {};
  allArr.forEach(a => {
    const add = (num, title, date) => {
      if (!num) return;
      const k = String(num);
      if (!map[k]) map[k] = { num, title: title || '', count: 0, last: '' };
      map[k].count++;
      if (date && (!map[k].last || date > map[k].last)) map[k].last = date;
      if (!map[k].title && title) map[k].title = title;
    };
    add(a.externalTalk?.num, a.externalTalk?.title, a.externalTalk?.date);
    (a.localSpeakers || []).forEach(ls => add(ls.num, ls.title, ls.date));
  });
  return Object.values(map).sort((x, y) => y.count - x.count || (x.last < y.last ? -1 : x.last > y.last ? 1 : 0));
}

async function computePredicacion(month) {
  const report = await db.getActivity(month) || { id: month, people: {} };
  const sy = serviceYearOfMonth(month);
  const att = await db.getAttendance(sy) || { id: sy, midweek: {}, weekend: {} };
  const pub = { n: 0, c: 0 }, aux = { n: 0, c: 0, h: 0 }, reg = { n: 0, c: 0, h: 0 };
  state.people.forEach(p => {
    const v = report.people?.[p.id] || {};
    if (!v.actividad) return;
    const c = Number(v.cursos) || 0;
    if (p.precursorRegular === true) { reg.n++; reg.c += c; reg.h += Number(v.horas) || 0; }
    else if (v.auxiliar) { aux.n++; aux.c += c; aux.h += Number(v.horas) || 0; }
    else { pub.n++; pub.c += c; }
  });
  const dates = meetingDatesForYear(sy, state.config || {}, state.config?.events || {}).weekend.filter(d => d.date.startsWith(month) && !d.blank);
  const totals = dates.map(d => att.weekend?.[d.date]).filter(t => t != null);
  const promFin = totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : '';
  return { pub, aux, reg, activos: pub.n + aux.n + reg.n, promFin };
}

async function computeRegistro(year) {
  const cfg = state.config || {}, events = state.config?.events || {};
  const att = await db.getAttendance(year) || { id: year, midweek: {}, weekend: {} };
  const out = {};
  ['midweek', 'weekend'].forEach(kind => {
    const dates = meetingDatesForYear(year, cfg, events)[kind];
    const byMonth = {};
    dates.forEach(d => { (byMonth[d.date.slice(0, 7)] ||= []).push(d); });
    out[kind] = serviceYearMonths(year).map(m => {
      const ds = byMonth[m] || [];
      const nonBlank = ds.filter(d => !d.blank);
      const total = nonBlank.reduce((s, d) => s + (att[kind]?.[d.date] ?? 0), 0);
      const reuniones = nonBlank.length;
      return { month: m, reuniones, total, promedio: reuniones ? Math.round(total / reuniones) : 0 };
    });
  });
  return out;
}

async function computeAsistenciaMes(month) {
  const sy = serviceYearOfMonth(month);
  const cfg = state.config || {}, events = state.config?.events || {};
  const att = await db.getAttendance(sy) || { id: sy, midweek: {}, weekend: {} };
  const build = (kind) => {
    const ds = meetingDatesForYear(sy, cfg, events)[kind].filter(d => d.date.startsWith(month) && !d.blank);
    const weeks = {};
    ds.forEach(d => {
      const dt = new Date(d.date + 'T00:00:00');
      const w = Math.min(5, Math.ceil(dt.getDate() / 7));
      (weeks[w] ||= []).push(d);
    });
    const cells = [];
    let total = 0;
    for (let w = 1; w <= 5; w++) {
      const sum = (weeks[w] || []).reduce((s, d) => s + (att[kind]?.[d.date] ?? 0), 0);
      total += sum;
      cells.push(sum || '');
    }
    const reuniones = ds.length;
    return { cells, total, promedio: reuniones ? Math.round(total / reuniones) : 0 };
  };
  return { midweek: build('midweek'), weekend: build('weekend') };
}

const FORM_HEAD = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>T</title><script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet"/><style>body{font-family:'Inter',sans-serif;background:#f3f4f6;display:flex;justify-content:center;padding:2rem}@media print{body{background:#fff;padding:0}}.font-serif-title{font-family:'Playfair Display',serif}.form-input-line{border-bottom:1px dotted #000;background:#f8fafc;min-height:1.5rem}.table-cell-input{background:#f8fafc;width:100%;min-height:2rem;display:flex;align-items:center;justify-content:center;font-weight:600}</style></head><body>`;

function printHtmlWindow(html, title) {
  const w = window.open('', '_blank');
  if (!w) { toast('Permite ventanas emergentes para imprimir.', 'error'); return; }
  w.document.write(html.replace('<title>T</title>', `<title>${escapeHtml(title)}</title>`));
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
}

function buildPredicacionHtml(month, d, cfg) {
  const cong = escapeHtml(cfg?.congregacion || '');
  const ciudad = escapeHtml(cfg?.ciudad || '');
  const provincia = escapeHtml(cfg?.provincia || '');
  const monthName = `${MONTHS_ES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
  const num = escapeHtml(cfg?.congregacionNumero || '');
  const cell = (v) => `<div class="table-cell-input">${v != null && v !== '' ? escapeHtml(String(v)) : ''}</div>`;
  return `${FORM_HEAD}<main class="bg-white p-8 w-full max-w-4xl shadow-lg border border-gray-200">
<header class="text-center mb-8"><h1 class="font-serif-title font-bold text-xl md:text-2xl leading-tight uppercase">Informe de Predicación y de Asistencia<br/>A Las Reuniones de la Congregación</h1></header>
<section class="mb-6 space-y-4 text-sm md:text-base">
<div class="flex flex-col md:flex-row gap-4"><div class="flex-1 flex flex-col"><div class="form-input-line w-full">${cong}</div><span class="text-center text-xs mt-1">(Nombre de la congregación)</span></div>
<div class="flex-1 flex flex-col"><div class="form-input-line w-full">${ciudad}</div><span class="text-center text-xs mt-1">(Ciudad)</span></div>
<div class="flex-1 flex flex-col"><div class="form-input-line w-full">${provincia}</div><span class="text-center text-xs mt-1">(Provincia o estado)</span></div></div>
<div class="flex flex-col md:flex-row gap-4 items-end"><div class="flex items-center gap-2 flex-1"><span class="whitespace-nowrap font-medium">Informe de</span><div class="flex-1 flex flex-col"><div class="form-input-line w-full">${monthName}</div><span class="text-center text-xs mt-1">(Mes y año)</span></div></div>
<div class="flex items-center gap-2 flex-1 justify-end"><span class="whitespace-nowrap font-medium">Número de la congregación:</span><div class="w-32 form-input-line">${num}</div></div></div>
</section>
<section class="mb-6"><table class="w-full border-collapse border border-black text-sm md:text-base"><thead><tr><th class="border border-black p-2 w-1/3"></th><th class="border border-black p-2 w-1/5 font-semibold text-center leading-tight">Cuántos<br/>informaron</th><th class="border border-black p-2 w-1/5 font-semibold text-center leading-tight">Cursos<br/>bíblicos</th><th class="border border-black p-2 w-1/4 font-semibold text-center">Horas</th></tr></thead><tbody>
<tr><td class="border border-black p-2 font-medium">Publicadores</td><td class="border border-black p-1">${cell(d.pub.n)}</td><td class="border border-black p-1">${cell(d.pub.c)}</td><td class="border border-black p-1 bg-gray-500"></td></tr>
<tr><td class="border border-black p-2 font-medium">Precursores auxiliares</td><td class="border border-black p-1">${cell(d.aux.n)}</td><td class="border border-black p-1">${cell(d.aux.c)}</td><td class="border border-black p-1">${cell(d.aux.h)}</td></tr>
<tr><td class="border border-black p-2 font-medium">Precursores regulares</td><td class="border border-black p-1">${cell(d.reg.n)}</td><td class="border border-black p-1">${cell(d.reg.c)}</td><td class="border border-black p-1">${cell(d.reg.h)}</td></tr>
</tbody></table></section>
<section class="flex flex-col md:flex-row gap-6 mb-12 text-sm md:text-base">
<div class="flex border border-black w-fit"><div class="p-2 font-medium border-r border-black flex items-center leading-tight">Publicadores<br/>activos</div><div class="w-24 p-1">${cell(d.activos)}</div></div>
<div class="flex border border-black w-fit"><div class="p-2 font-medium border-r border-black flex items-center leading-tight">Promedio de asistencia a<br/>la reunión del fin de semana</div><div class="w-24 p-1">${cell(d.promFin)}</div></div>
</section>
<footer class="flex justify-between items-end text-sm mt-12 relative"><div class="font-medium absolute bottom-0 left-0">S-1-S 11/23</div><div class="w-1/2 ml-auto flex flex-col items-center"><div class="form-input-line w-full mb-1"></div><span class="text-xs">(Secretario)</span></div></footer>
</main></body></html>`;
}

function buildPredicacionSvg(month, d, cfg) {
  const W = 850, H = 1100;
  const cong = cfg?.congregacion || 'Congregación';
  const monthName = `${MONTHS_ES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
  const P = [];
  P.push(`<text x="${W / 2}" y="60" text-anchor="middle" font-family="serif" font-size="24" font-weight="700" fill="#000">INFORME DE PREDICACIÓN Y DE ASISTENCIA</text>`);
  P.push(`<text x="${W / 2}" y="90" text-anchor="middle" font-family="serif" font-size="18" font-weight="700" fill="#000">A LAS REUNIONES DE LA CONGREGACIÓN</text>`);
  P.push(`<text x="60" y="140" font-family="sans-serif" font-size="15" fill="#000">${escapeHtml(cong)}</text>`);
  P.push(`<text x="60" y="170" font-family="sans-serif" font-size="15" fill="#000">Informe de ${monthName}</text>`);
  const rows = [['Publicadores', d.pub.n, d.pub.c, ''], ['Precursores auxiliares', d.aux.n, d.aux.c, d.aux.h], ['Precursores regulares', d.reg.n, d.reg.c, d.reg.h]];
  let y = 230;
  P.push(`<rect x="50" y="${y}" width="${W - 100}" height="28" fill="none" stroke="#000"/>`);
  P.push(`<text x="60" y="${y + 19}" font-family="sans-serif" font-size="14" font-weight="700" fill="#000">Categoría</text>`);
  P.push(`<text x="430" y="${y + 19}" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="700" fill="#000">Informaron</text>`);
  P.push(`<text x="580" y="${y + 19}" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="700" fill="#000">Cursos</text>`);
  P.push(`<text x="720" y="${y + 19}" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="700" fill="#000">Horas</text>`);
  y += 28;
  rows.forEach(r => {
    P.push(`<rect x="50" y="${y}" width="${W - 100}" height="38" fill="none" stroke="#000"/>`);
    P.push(`<text x="60" y="${y + 25}" font-family="sans-serif" font-size="14" fill="#000">${r[0]}</text>`);
    P.push(`<text x="430" y="${y + 25}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#000">${r[1]}</text>`);
    P.push(`<text x="580" y="${y + 25}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#000">${r[2]}</text>`);
    P.push(`<text x="720" y="${y + 25}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#000">${r[3]}</text>`);
    y += 38;
  });
  P.push(`<text x="60" y="${y + 36}" font-family="sans-serif" font-size="15" fill="#000">Publicadores activos: ${d.activos}</text>`);
  P.push(`<text x="60" y="${y + 64}" font-family="sans-serif" font-size="15" fill="#000">Promedio asistencia fin de semana: ${d.promFin}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${P.join('')}</svg>`;
}

function registroHtmlTable(title, rows, promedio) {
  const body = rows.map(r => `<tr><td>${MONTHS_ES[Number(r.month.slice(5)) - 1]}</td><td>${r.reuniones}</td><td>${r.total}</td><td>${r.promedio}</td></tr>`).join('');
  return `<table class="w-full custom-table"><thead><tr><th>${title}</th><th>Número de<br/>reuniones</th><th>Asistencia<br/>total</th><th>Promedio de<br/>asistencia<br/>semanal</th></tr></thead><tbody>${body}<tr><td class="text-right font-bold bg-gray-50" colspan="3">Promedio de asistencia mensual</td><td class="bg-gray-50">${promedio}</td></tr></tbody></table>`;
}

function buildRegistroHtml(year, data, data2) {
  const avg = (arr) => { const t = arr.reduce((s, r) => s + r.total, 0); return arr.length ? Math.round(t / arr.length) : 0; };
  const css = `<style>.custom-table th,.custom-table td{border:1px solid #d1d5db;padding:.5rem;text-align:center}.custom-table th{background:#f9fafb;font-weight:600;font-size:.8rem}.custom-table td{font-size:.8rem;height:1.6rem}.custom-table td:first-child{text-align:left;font-weight:600;width:25%}</style>`;
  return `${FORM_HEAD}${css}<main class="bg-white w-full max-w-5xl p-8 shadow-lg border border-gray-200">
<header class="mb-8 text-center"><h1 class="text-2xl font-serif font-bold uppercase">Registro de Asistencia a las Reuniones de Congregación</h1></header>
<section class="mb-12"><h2 class="text-xl font-bold mb-4">Reunión de entre semana</h2><div class="grid grid-cols-2 gap-0 border border-gray-300">${registroHtmlTable('Año de servicio', data.midweek, avg(data.midweek))}${registroHtmlTable('', data2.midweek, avg(data2.midweek))}</div></section>
<section><h2 class="text-xl font-bold mb-4">Reunión del fin de semana</h2><div class="grid grid-cols-2 gap-0 border border-gray-300">${registroHtmlTable('Año de servicio', data.weekend, avg(data.weekend))}${registroHtmlTable('', data2.weekend, avg(data2.weekend))}</div></section>
</main></body></html>`;
}

function buildRegistroSvg(year, data, data2) {
  const W = 1200;
  const colW = [230, 110, 110, 90];
  const tableW = colW.reduce((a, b) => a + b, 0);
  const rowH = 26;
  const avg = (arr) => { const t = arr.reduce((s, r) => s + r.total, 0); return arr.length ? Math.round(t / arr.length) : 0; };
  const drawTable = (x, y, title, rows, prom) => {
    const P = [];
    P.push(`<text x="${x}" y="${y - 8}" font-family="sans-serif" font-size="15" font-weight="700" fill="#000">${title}</text>`);
    let yy = y;
    P.push(`<rect x="${x}" y="${yy}" width="${tableW}" height="${rowH}" fill="none" stroke="#000"/>`);
    const heads = ['Mes', 'Reun.', 'Total', 'Prom.'];
    let cx = x;
    heads.forEach((h, i) => { P.push(`<text x="${cx + 6}" y="${yy + 18}" font-family="sans-serif" font-size="13" fill="#000">${h}</text>`); cx += colW[i]; });
    yy += rowH;
    rows.forEach(r => {
      P.push(`<rect x="${x}" y="${yy}" width="${tableW}" height="${rowH}" fill="none" stroke="#000"/>`);
      const vals = [MONTHS_ES[Number(r.month.slice(5)) - 1], String(r.reuniones), String(r.total), String(r.promedio)];
      let cxp = x;
      vals.forEach((v, i) => { P.push(`<text x="${cxp + 6}" y="${yy + 18}" font-family="sans-serif" font-size="13" fill="#000">${v}</text>`); cxp += colW[i]; });
      yy += rowH;
    });
    P.push(`<rect x="${x}" y="${yy}" width="${tableW}" height="${rowH}" fill="#eee" stroke="#000"/>`);
    P.push(`<text x="${x + 6}" y="${yy + 18}" font-family="sans-serif" font-size="13" font-weight="700" fill="#000">Promedio mensual</text>`);
    P.push(`<text x="${x + tableW - colW[3] + 6}" y="${yy + 18}" font-family="sans-serif" font-size="13" fill="#000">${prom}</text>`);
    return { svg: P.join(''), h: yy + rowH - y };
  };
  const t1 = drawTable(40, 110, `Entre semana · ${serviceYearLabel(year)}`, data.midweek, avg(data.midweek));
  const t2 = drawTable(620, 110, `Entre semana · ${serviceYearLabel(year + 1)}`, data2.midweek, avg(data2.midweek));
  const y2 = Math.max(t1.h, t2.h) + 130;
  const t3 = drawTable(40, y2, `Fin de semana · ${serviceYearLabel(year)}`, data.weekend, avg(data.weekend));
  const t4 = drawTable(620, y2, `Fin de semana · ${serviceYearLabel(year + 1)}`, data2.weekend, avg(data2.weekend));
  const H = y2 + Math.max(t3.h, t4.h) + 30;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${t1.svg}${t2.svg}${t3.svg}${t4.svg}</svg>`;
}

function buildAsistenciaMesHtml(month, d, cfg) {
  const cong = escapeHtml(cfg?.congregacion || '');
  const monthName = `${MONTHS_ES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
  const row = (label, r) => `<tr class="divide-x-2 divide-black h-24"><td class="p-3 text-left align-middle bg-white">${label}</td>${r.cells.map(c => `<td class="p-2 bg-white text-center font-bold">${c}</td>`).join('')}<td class="p-2 bg-white text-center font-bold">${r.total}</td><td class="p-2 bg-white text-center font-bold">${r.promedio}</td></tr>`;
  return `${FORM_HEAD}<style>.input-line{border-bottom:1px dotted #000;display:inline-block;min-width:150px}</style><main class="bg-white max-w-4xl mx-auto p-8 shadow-lg border border-gray-200 flex flex-col">
<header class="text-center mb-6"><h1 class="text-2xl md:text-3xl font-bold uppercase tracking-wide mb-4">Informe de Asistencia a las Reuniones</h1><p class="text-sm font-semibold">(La asistencia se contará una sola vez a mitad de cada reunión. Recuerden contar también a las personas aisladas o confinadas en casa que estén conectadas).</p></header>
<section class="flex flex-col sm:flex-row justify-between items-end mb-6 gap-4 font-bold text-sm"><div class="flex items-center"><label class="mr-2">Nombre de la congregación:</label><span class="input-line">${cong}</span></div><div class="flex items-center"><label class="mr-2">Mes:</label><span class="input-line">${monthName}</span></div></section>
<section class="overflow-x-auto border-2 border-black"><table class="w-full text-center border-collapse"><thead><tr class="border-b-2 border-black text-xs font-bold"><th class="p-2 w-1/5 bg-white"></th><th class="p-2 bg-white">Primera<br/>semana</th><th class="p-2 bg-white">Segunda<br/>semana</th><th class="p-2 bg-white">Tercera<br/>semana</th><th class="p-2 bg-white">Cuarta<br/>semana</th><th class="p-2 bg-white">Quinta<br/>semana</th><th class="p-2 bg-white">Total</th><th class="p-2 bg-white">Promedio</th></tr></thead><tbody class="divide-y-2 divide-black font-bold text-sm">${row('Reunión<br/>de entre<br/>semana', d.midweek)}${row('Reunión<br/>del fin de<br/>semana', d.weekend)}</tbody></table></section>
<footer class="mt-8 text-sm font-semibold"><p>S-3-S 10/15</p></footer>
</main></body></html>`;
}

function buildAsistenciaMesSvg(month, d, cfg) {
  const W = 850, H = 1000;
  const cong = cfg?.congregacion || 'Congregación';
  const monthName = `${MONTHS_ES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
  const P = [];
  P.push(`<text x="${W / 2}" y="50" text-anchor="middle" font-family="serif" font-size="22" font-weight="700" fill="#000">INFORME DE ASISTENCIA A LAS REUNIONES</text>`);
  P.push(`<text x="60" y="90" font-family="sans-serif" font-size="14" fill="#000">${escapeHtml(cong)} — ${monthName}</text>`);
  const cols = [200, 90, 90, 90, 90, 90, 90, 90];
  const tableW = cols.reduce((a, b) => a + b, 0);
  const rowH = 60;
  let y = 130;
  P.push(`<rect x="50" y="${y}" width="${tableW}" height="34" fill="none" stroke="#000"/>`);
  const heads = ['', 'S1', 'S2', 'S3', 'S4', 'S5', 'Total', 'Prom.'];
  let cx = 50;
  heads.forEach((h, i) => { P.push(`<text x="${cx + 6}" y="${y + 22}" font-family="sans-serif" font-size="13" font-weight="700" fill="#000">${h}</text>`); cx += cols[i]; });
  y += 34;
  [['Entre semana', d.midweek], ['Fin de semana', d.weekend]].forEach(([lab, r]) => {
    P.push(`<rect x="50" y="${y}" width="${tableW}" height="${rowH}" fill="none" stroke="#000"/>`);
    P.push(`<text x="56" y="${y + 36}" font-family="sans-serif" font-size="14" fill="#000">${lab}</text>`);
    let cxp = 50 + cols[0];
    r.cells.forEach(c => { P.push(`<text x="${cxp + 45}" y="${y + 36}" text-anchor="middle" font-family="sans-serif" font-size="15" font-weight="700" fill="#000">${c}</text>`); cxp += cols[r.cells.indexOf(c) + 1]; });
    P.push(`<text x="${50 + cols[0] + cols[1] + cols[2] + cols[3] + cols[4] + cols[5] + 45}" y="${y + 36}" text-anchor="middle" font-family="sans-serif" font-size="15" font-weight="700" fill="#000">${r.total}</text>`);
    P.push(`<text x="${50 + cols[0] + cols[1] + cols[2] + cols[3] + cols[4] + cols[5] + cols[6] + 45}" y="${y + 36}" text-anchor="middle" font-family="sans-serif" font-size="15" font-weight="700" fill="#000">${r.promedio}</text>`);
    y += rowH;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${P.join('')}</svg>`;
}

async function downloadPredicacion(month, fmt) {
  const d = await computePredicacion(month);
  const cfg = { ...state.config, congregacion: await db.getSetting('congregation', '') };
  if (fmt === 'png') {
    const blob = await svgToPngBlob(buildPredicacionSvg(month, d, cfg));
    await compartirPng(blob, `predicacion-${month}.png`);
  } else {
    printHtmlWindow(buildPredicacionHtml(month, d, cfg), `Informe de predicación ${month}`);
  }
}

async function downloadRegistro(year, fmt) {
  const data = await computeRegistro(year);
  const data2 = await computeRegistro(year + 1);
  if (fmt === 'png') {
    const blob = await svgToPngBlob(buildRegistroSvg(year, data, data2));
    await compartirPng(blob, `registro-asistencia-${year}.png`);
  } else {
    printHtmlWindow(buildRegistroHtml(year, data, data2), `Registro de asistencia ${year}`);
  }
}

async function downloadAsistenciaMes(month, fmt) {
  const d = await computeAsistenciaMes(month);
  const cfg = { ...state.config, congregacion: await db.getSetting('congregation', '') };
  if (fmt === 'png') {
    const blob = await svgToPngBlob(buildAsistenciaMesSvg(month, d, cfg));
    await compartirPng(blob, `asistencia-${month}.png`);
  } else {
    printHtmlWindow(buildAsistenciaMesHtml(month, d, cfg), `Informe de asistencia ${month}`);
  }
}

async function computePubReg(person, year) {
  const months = serviceYearMonths(year);
  const out = [];
  let totalHoras = 0, totalCursos = 0;
  for (const m of months) {
    const rep = await db.getActivity(m) || { id: m, people: {} };
    const v = rep.people?.[person.id] || {};
    const horas = Number(v.horas) || 0;
    const cursos = Number(v.cursos) || 0;
    totalHoras += horas; totalCursos += cursos;
    out.push({ label: MONTHS_ES[Number(m.slice(5)) - 1], actividad: !!v.actividad, cursos, auxiliar: !!v.auxiliar, horas, notas: v.notas || '' });
  }
  return { months: out, totalHoras, totalCursos };
}

function buildPubRegHtml(person, year, d) {
  const name = escapeHtml(person.name || '');
  const nac = escapeHtml(person.nacimiento || '');
  const bau = escapeHtml(person.bautismo || '');
  const hombre = person.sexo === 'M' || person.sexo === 'H';
  const mujer = person.sexo === 'F';
  const anciano = /anciano/i.test(person.cargo || '');
  const siervo = /siervo/i.test(person.cargo || '');
  const precReg = person.precursorRegular === true;
  const chk = (b) => b ? 'checked' : '';
  const rows = d.months.map(m => `<tr class="h-8">
<td class="table-cell-border p-1 text-left pl-2 font-semibold bg-white">${m.label}</td>
<td class="table-cell-border p-1 text-center"><input class="form-checkbox h-4 w-4" type="checkbox" ${chk(m.actividad)} disabled/></td>
<td class="table-cell-border p-1 text-center">${m.cursos || ''}</td>
<td class="table-cell-border p-1 text-center"><input class="form-checkbox h-4 w-4" type="checkbox" ${chk(m.auxiliar)} disabled/></td>
<td class="table-cell-border p-1 text-center">${m.horas || ''}</td>
<td class="table-cell-border p-1 text-left pl-2">${escapeHtml(m.notas || '')}</td>
</tr>`).join('');
  const style = `<style>
    body{font-family:'Playfair Display',serif;background:#f9f9f9;color:#1a1c18}
    .form-checkbox{border-radius:0;border-color:#74796d;color:#1a3636}
    .table-cell-border{border:1px solid #74796d}
    .table-header-bg{background:#fff}
    .row-bg-light{background:#f4f8fe}
    @media print{body{background:#fff;padding:0}}
  </style>`;
  return `${FORM_HEAD}${style}<main class="w-full max-w-4xl bg-white shadow-md rounded-lg p-6 md:p-10 border border-surface-dim">
    <header class="text-center mb-6"><h1 class="text-xl md:text-2xl font-bold uppercase tracking-wider text-primary">Registro de Publicador de la Congregación</h1></header>
    <section class="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm md:text-base font-semibold">
      <div class="space-y-2 bg-[#f4f8fe] p-2 rounded">
        <div class="flex items-center"><label class="w-40 shrink-0">Nombre:</label><div class="flex-grow border-b border-surface-dim">${name}</div></div>
        <div class="flex items-center"><label class="w-40 shrink-0">Fecha de nacimiento:</label><div class="flex-grow border-b border-surface-dim">${nac}</div></div>
        <div class="flex items-center"><label class="w-40 shrink-0">Fecha de bautismo:</label><div class="flex-grow border-b border-surface-dim">${bau}</div></div>
      </div>
      <div class="flex flex-col justify-center space-y-2 bg-[#f4f8fe] p-2 rounded">
        <div class="flex space-x-8">
          <label class="inline-flex items-center"><input class="form-checkbox h-4 w-4" type="checkbox" ${chk(hombre)} disabled/><span class="ml-2">Hombre</span></label>
          <label class="inline-flex items-center"><input class="form-checkbox h-4 w-4" type="checkbox" ${chk(mujer)} disabled/><span class="ml-2">Mujer</span></label>
        </div>
        <div class="flex space-x-8">
          <label class="inline-flex items-center"><input class="form-checkbox h-4 w-4" type="checkbox" disabled/><span class="ml-2">Otras ovejas</span></label>
          <label class="inline-flex items-center"><input class="form-checkbox h-4 w-4" type="checkbox" disabled/><span class="ml-2">Ungido</span></label>
        </div>
      </div>
    </section>
    <section class="mb-6 flex flex-wrap gap-4 text-sm md:text-base font-semibold">
      <label class="inline-flex items-center"><input class="form-checkbox h-4 w-4" type="checkbox" ${chk(anciano)} disabled/><span class="ml-2">Anciano</span></label>
      <label class="inline-flex items-center"><input class="form-checkbox h-4 w-4" type="checkbox" ${chk(siervo)} disabled/><span class="ml-2">Siervo ministerial</span></label>
      <label class="inline-flex items-center"><input class="form-checkbox h-4 w-4" type="checkbox" ${chk(precReg)} disabled/><span class="ml-2">Precursor regular</span></label>
      <label class="inline-flex items-center"><input class="form-checkbox h-4 w-4" type="checkbox" disabled/><span class="ml-2">Precursor especial</span></label>
      <label class="inline-flex items-center"><input class="form-checkbox h-4 w-4" type="checkbox" disabled/><span class="ml-2">Misionero que sirve en el campo</span></label>
    </section>
    <section class="overflow-x-auto"><table class="w-full text-center border-collapse text-sm md:text-base">
      <thead><tr class="font-bold table-header-bg">
        <th class="table-cell-border p-2 w-1/6 row-bg-light">Año de servicio</th>
        <th class="table-cell-border p-2 w-1/6">Participación en el ministerio</th>
        <th class="table-cell-border p-2 w-1/12">Cursos bíblicos</th>
        <th class="table-cell-border p-2 w-1/12">Precursor auxiliar</th>
        <th class="table-cell-border p-2 w-1/4">Horas<span class="font-normal text-xs"><br/>(Si es precursor o misionero que sirve en el campo)</span></th>
        <th class="table-cell-border p-2 w-1/4">Notas</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="h-8 font-bold"><td class="text-right pr-2" colspan="4">Total</td><td class="table-cell-border p-1 bg-white text-center">${d.totalHoras}</td><td class="table-cell-border p-1 bg-white"></td></tr>
      </tbody>
    </table></section>
  </main>`;
}

function buildPubRegSvg(person, year, d) {
  const W = 800;
  const P = [];
  P.push(`<text x="${W / 2}" y="50" text-anchor="middle" font-family="serif" font-size="20" font-weight="700" fill="#000">REGISTRO DE PUBLICADOR DE LA CONGREGACIÓN</text>`);
  P.push(`<text x="40" y="90" font-family="sans-serif" font-size="14" fill="#000">${escapeHtml(person.name || '')}</text>`);
  P.push(`<text x="40" y="115" font-family="sans-serif" font-size="13" fill="#000">Nac: ${escapeHtml(person.nacimiento || '')}   Baut: ${escapeHtml(person.bautismo || '')}</text>`);
  const roles = [];
  if (/anciano/i.test(person.cargo || '')) roles.push('Anciano');
  if (/siervo/i.test(person.cargo || '')) roles.push('Siervo');
  if (person.precursorRegular === true) roles.push('Precursor regular');
  P.push(`<text x="40" y="138" font-family="sans-serif" font-size="13" fill="#000">${roles.join(', ')}</text>`);
  const cols = [150, 90, 80, 80, 80, 200];
  const labels = ['Mes', 'Part.', 'Cursos', 'Aux.', 'Horas', 'Notas'];
  const totalW = cols.reduce((a, b) => a + b, 0);
  let x = 40, y = 165;
  P.push(`<rect x="40" y="${y}" width="${totalW}" height="26" fill="none" stroke="#000"/>`);
  labels.forEach((l, i) => { P.push(`<text x="${x + 6}" y="${y + 18}" font-family="sans-serif" font-size="12" fill="#000">${l}</text>`); x += cols[i]; });
  y += 26;
  d.months.forEach(m => {
    P.push(`<rect x="40" y="${y}" width="${totalW}" height="24" fill="none" stroke="#000"/>`);
    const vals = [m.label, m.actividad ? 'X' : '', String(m.cursos || ''), m.auxiliar ? 'X' : '', String(m.horas || ''), m.notas || ''];
    let cx = 40;
    vals.forEach((v, i) => { P.push(`<text x="${cx + 6}" y="${y + 16}" font-family="sans-serif" font-size="12" fill="#000">${escapeHtml(String(v))}</text>`); cx += cols[i]; });
    y += 24;
  });
  P.push(`<rect x="40" y="${y}" width="${totalW}" height="26" fill="#eee" stroke="#000"/>`);
  P.push(`<text x="46" y="${y + 18}" font-family="sans-serif" font-size="13" font-weight="700" fill="#000">Total</text>`);
  P.push(`<text x="${40 + 150 + 90 + 80 + 80 + 6}" y="${y + 18}" font-family="sans-serif" font-size="13" font-weight="700" fill="#000">${d.totalHoras}</text>`);
  const H = y + 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${P.join('')}</svg>`;
}

async function downloadPubReg(pid, fmt, year) {
  const person = state.people.find(p => String(p.id) === String(pid));
  if (!person) { toast('Selecciona un publicador', 'error'); return; }
  const d = await computePubReg(person, Number(year));
  if (fmt === 'png') {
    const blob = await svgToPngBlob(buildPubRegSvg(person, Number(year), d));
    await compartirPng(blob, `registro-publicador-${person.id}-${year}.png`);
  } else {
    printHtmlWindow(buildPubRegHtml(person, Number(year), d), `Registro de publicador ${person.name}`);
  }
}

async function renderGroupSummary() {
  state.month = null;
  renderTop();
  const me = currentUser();
  const year = currentServiceYear();
  const groups = (me?.grupos || []).length ? me.grupos : [];
  const members = state.people.filter(p => groups.length ? groups.includes(p.grupoId) : false);
  const { rows, totals } = await computeServiceYearMetrics(year);
  const groupRows = rows.filter(r => members.some(m => m.name === r.name));
  const history = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const mid = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const rep = await db.getActivity(mid);
    const active = rep ? Object.values(rep.people || {}).filter(v => v.actividad).length : 0;
    history.push({ mid, active });
  }
  const histRows = history.map(h => `<tr class="border-b border-outline-variant/40"><td class="p-2">${MONTHS_ES[Number(h.mid.slice(5)) - 1]} ${h.mid.slice(0, 4)}</td><td class="p-2 text-center">${h.active}</td></tr>`).join('');
  const app = $('#app');
  app.innerHTML = `<div class="mb-6"><h1 class="font-display-lg text-display-lg text-primary">Mi grupo</h1><p class="text-on-surface-variant font-body-lg">Actividad, métricas e historial de los últimos 6 meses.</p></div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-4 text-center"><div class="font-display-sm text-display-sm text-primary">${groupRows.length}</div><div class="font-label-sm text-label-sm text-on-surface-variant">Publicadores</div></div>
      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-4 text-center"><div class="font-display-sm text-display-sm text-primary">${groupRows.filter(r => r.active > 0).length}</div><div class="font-label-sm text-label-sm text-on-surface-variant">Activos (año)</div></div>
      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-4 text-center"><div class="font-display-sm text-display-sm text-primary">${groupRows.reduce((s, r) => s + r.courses, 0)}</div><div class="font-label-sm text-label-sm text-on-surface-variant">Cursos</div></div>
      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-4 text-center"><div class="font-display-sm text-display-sm text-primary">${groupRows.reduce((s, r) => s + r.hours, 0)}</div><div class="font-label-sm text-label-sm text-on-surface-variant">Horas</div></div>
    </div>
    <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-4 mb-6">
      <h3 class="font-title-md text-title-md text-primary mb-3">Historial (6 meses)</h3>
      <table class="w-full text-left"><thead><tr class="bg-surface-container border-b border-outline-variant"><th class="p-2">Mes</th><th class="p-2 text-center">Activos</th></tr></thead><tbody>${histRows}</tbody></table>
    </div>`;
}

async function renderHome() {
  state.month = null;
  if (isSupabaseConfigured() && !isAuthenticated()) { renderWelcome(); return; }
  const months = await db.listMonths();
  months.sort((a, b) => b.id.localeCompare(a.id));
  _homeMonths = months;
  _homeAseos = await db.listAseos();
  _homeSalidas = await db.listSalidas();
  _homeAtencion = await db.listAtencion();
  const generalWeek = currentGeneralWeek(homeWeekOffset);
  const app = $('#app');
  app.innerHTML = `
    <div class="mb-6 text-center">
      <h1 class="font-headline-lg text-[32px] md:text-[40px] leading-tight text-primary uppercase tracking-wide">Tablero | ${currentWeekRangeLabel()}</h1>
    </div>

    <!-- Bento Grid -->
    <div class="grid grid-cols-1 md:grid-cols-12 gap-gutter">
      <section class="md:col-span-12">
        ${generalWeek ? generalWeekBox({ ...generalWeek, dashboard: true }) : `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-8 text-center text-on-surface-variant">No hay programas cargados para la semana en curso.</div>`}
      </section>
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
        </div>
        <div id="homeEvents" class="space-y-6"></div>
      </section>
    </div>
  `;
  const prevWeekBtn = $('[data-home-week-prev]');
  if (prevWeekBtn) prevWeekBtn.onclick = () => { homeWeekOffset--; renderHome(); };
  const nextWeekBtn = $('[data-home-week-next]');
  if (nextWeekBtn) nextWeekBtn.onclick = () => { homeWeekOffset++; renderHome(); };
  const homeWeekImgBtn = $('[data-home-week-img]');
  if (homeWeekImgBtn && generalWeek) homeWeekImgBtn.onclick = async () => {
    homeWeekImgBtn.disabled = true;
    try {
      const cur = String(generalWeek.saturday || isoDate(new Date())).slice(0, 7);
      const blob = await svgToPngBlob(generalWeekExportSvg(generalWeek, cur, { mobile: isUserRole() || isIaRole() }));
      const compartido = await compartirPng(blob, `semana-${cur}-${homeWeekOffset + 1}.png`);
      if (!compartido) toast('Imagen descargada: adjúntala en WhatsApp.', 'success');
    } catch (err) {
      console.error(err);
      toast('No se pudo generar la imagen.', 'error');
    } finally {
      homeWeekImgBtn.disabled = false;
    }
  };
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
let _homeSalidas = [];
let _homeAtencion = [];
let homeWeekOffset = 0;

// Devuelve lunes y sábado (YYYY-MM-DD) de la semana en curso.
function currentWeekDates(offset = 0) {
  const now = new Date();
  const daysSinceMon = (now.getDay() + 6) % 7; // 0=lunes
  const monday = new Date(now); monday.setDate(now.getDate() - daysSinceMon + (offset * 7));
  const saturday = new Date(monday); saturday.setDate(monday.getDate() + 5);
  return { monday: isoDate(monday), saturday: isoDate(saturday) };
}
function currentWeekRangeLabel(offset = homeWeekOffset) {
  const { monday, saturday } = currentWeekDates(offset);
  const start = new Date(monday + 'T00:00:00');
  const end = new Date(saturday + 'T00:00:00');
  end.setDate(end.getDate() + 1);
  const startDay = start.getDate();
  const endDay = end.getDate();
  const startMonth = MONTHS_ES[start.getMonth()].toUpperCase();
  const endMonth = MONTHS_ES[end.getMonth()].toUpperCase();
  return start.getMonth() === end.getMonth()
    ? `${startDay}-${endDay} DE ${endMonth}`
    : `${startDay} DE ${startMonth} - ${endDay} DE ${endMonth}`;
}

// Busca la semana del programa mensual cuya fecha (sábado) es la semana en curso.
function findCurrentFinWeek(offset = 0) {
  const { saturday } = currentWeekDates(offset);
  for (const m of _homeMonths) {
    const w = (m.weeks || []).find(x => x.date === saturday);
    if (w) return { month: m, week: w };
  }
  return null;
}
function currentGeneralWeek(offset = 0) {
  const { monday, saturday } = currentWeekDates(offset);
  const finMatch = findCurrentFinWeek(offset);
  const fin = finMatch ? finMatch.week : null;
  const mw = state.midweeks.find(m => String(m.id) >= monday && String(m.id) <= saturday) || null;
  const aseoWeek = _homeAseos.flatMap(a => a.weeks || []).find(w => w.saturday === saturday) || null;
  const salidasWeek = _homeSalidas.flatMap(p => p.weeks || []).find(w => w.saturday === saturday) || null;
  const laboresWeek = _homeAtencion.flatMap(p => p.weeks || []).find(w => w.saturday === saturday) || null;
  if (!fin && !mw && !aseoWeek && !salidasWeek && !laboresWeek) return null;
  const allSaturdays = [...new Set([
    ..._homeMonths.flatMap(m => (m.weeks || []).map(w => w.date)),
    ...state.midweeks.map(m => {
      const d = new Date(String(m.id) + 'T00:00:00');
      d.setDate(d.getDate() + (5 - ((d.getDay() + 6) % 7)));
      return isoDate(d);
    }),
    ..._homeAseos.flatMap(a => (a.weeks || []).map(w => w.saturday)),
    ..._homeSalidas.flatMap(p => (p.weeks || []).map(w => w.saturday)),
    ..._homeAtencion.flatMap(p => (p.weeks || []).map(w => w.saturday)),
  ])].filter(Boolean).filter(d => d.slice(0, 7) === saturday.slice(0, 7)).sort();
  return {
    fin,
    mw,
    i: Math.max(0, allSaturdays.indexOf(saturday)),
    aseoGroup: aseoWeek?.group || null,
    outings: salidasWeek?.outings || null,
    sinSalida: salidasWeek?.sinSalida === true,
    finLabores: laboresWeek,
    sunday: isoDate(new Date(new Date(saturday + 'T00:00:00').getTime() + 86400000)),
    saturday,
  };
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
    if (w && w.group) {
      const num = aseoWeekGroupNum(w);
      return num != null ? String(num) : deptNameOf(w.group);
    }
  }
  return 'Sin asignar';
}
function finWeekAssignDetail() {
  const { saturday } = currentWeekDates();
  for (const a of _homeAseos) {
    const w = (a.weeks || []).find(x => x.saturday === saturday);
    if (w && w.group) {
      const d = state.departments.find(x => String(x.id) === String(w.group));
      if (d && d.labores) return d.labores;
      break;
    }
  }
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
      <button id="genAllBtn" data-admin class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-secondary text-on-secondary font-label-md text-label-md hover:opacity-90 transition-all active:scale-95" title="Genera el programa mensual completo (conserva lo manual/bloqueado)">
        <span class="material-symbols-outlined text-[18px]">auto_awesome</span> Generar programa mensual completo
      </button>
    </div>
    <div class="flex gap-2 mb-8 border-b border-outline-variant flex-wrap">
      ${tabs.map(t => `<button data-tab="${t.id}" class="newTab px-5 py-3 font-label-md text-label-md transition-colors">${t.label}</button>`).join('')}
    </div>
    <div id="newEstados" class="flex flex-wrap gap-2 mb-4"></div>
    <div id="newBody"></div>
  `;

  const goMonth = (m) => { state.progMonth = m; renderNew(); };
  $('#progMonth').onchange = (e) => goMonth(e.target.value);
  app.querySelectorAll('[data-month]').forEach(b => b.onclick = () => goMonth(b.dataset.month));
  $('#autoBtn').onclick = () => go('algoritmo');
  const genAll = $('#genAllBtn');
  if (genAll) genAll.onclick = async () => {
    genAll.disabled = true;
    try {
      const month = state.progMonth;
      const ok = await confirmarRegeneracion(month, 'all');
      if (!ok) return;
      const r = await generateProgram(month, 'all');
      toast(r.vacios
        ? `Programa mensual generado: ${r.asignados} asignación(es), ${r.vacios} sin cubrir. Revise cada pestaña y pulse Guardar.`
        : `Programa mensual generado: ${r.asignados} asignación(es). Revise y pulse Guardar.`, r.vacios ? 'info' : 'success');
      renderNewBody();
    } catch (err) {
      console.error(err);
      toast('Error al generar: ' + (err.message || err), 'error');
    } finally {
      genAll.disabled = false;
    }
  };

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

  // Estados calculados por programa (BORRADOR/PARCIAL/GENERADO).
  (async () => {
    const [midweeks, months, salidas, atencion] = await Promise.all([db.listMidweeks(), db.listMonths(), db.listSalidas(), db.listAtencion()]);
    const m = state.progMonth;
    const est = estadoProgramas({
      midweeks: midweeks.filter(x => String(x.id).slice(0, 7) === m),
      months: months.filter(x => x.id === m),
      salidas: salidas.filter(p => p.id === m),
      atencion: atencion.filter(p => p.id === m),
    });
    const chip = (label, s) => {
      const cls = s.estado === 'GENERADO' ? 'bg-tertiary-fixed text-on-tertiary-fixed'
        : s.estado === 'PARCIAL' ? 'bg-secondary-container text-on-secondary-container'
        : 'bg-surface-variant text-on-surface-variant';
      return `<span class="px-3 py-1 rounded-full font-label-md text-label-md ${cls}">${label}: ${s.estado} (${s.pct}%)</span>`;
    };
    $('#newEstados').innerHTML = `${chip('Entre semana', est.entre)}${chip('Fin de semana', est.fin)}${chip('Labores', est.labores)}`;
  })();
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
    (program && program.weeks || []).forEach((w, wi) => {
      if (w.sinSalida) return;
      (w.outings || []).forEach((o, oi) => {
        if (!o.oradorSalida) out.push({ key: `sal_${wi}_${oi}`, label: `Orador de salida ${oi + 1}` });
      });
    });
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
    const salTotal = (d.sal?.weeks || []).reduce((a, w) => a + (w.sinSalida ? 0 : (w.outings || []).length), 0);
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

    // Card 3: Salidas (siempre a mano; solo muestra qué falta).
    cards.push(card({
      id: 'salidas', icono: 'campaign', titulo: 'Salidas', desc: 'Oradores para las salidas a congregaciones (siempre a mano)',
      faltan: salMissing, pct: pct(salDone, salTotal), done: salMissing.length === 0 && !!d.sal && (d.sal.weeks || []).length > 0,
      resumen: sesion.reportes.salidas ? `${sesion.reportes.salidas.asignados} asignaciones hechas` : '',
      accion: `<button data-ver="salidas" class="px-3 py-2 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Ver</button>`,
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
      { id: 'atencion', titulo: 'Atención' },
      { id: 'fin', titulo: 'Fin de semana' },
    ];
    const pasoDone = {
      entre: !faltaGuia && mwMissing.length === 0,
      atencion: labMissing.length === 0,
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
  const nombres = Object.fromEntries(state.people.map(p => [String(p.id), invertName(p.name)]));
  const out = runEngine(state.people, { midweeks: mwMes, months: [], salidas: [], atencion: [] }, { scope: 'entre', entreOpts: { historial, nombres } });
  await Promise.all(out.midweeks.map(w => db.putMidweek(w)));
  state.midweeks = await db.listMidweeks();
  const r = out.reportes.entre || { asignados: 0, vacios: [] };
  return {
    asignados: r.asignados,
    vacios: r.vacios.map(v => ({ semana: v.semana, rol: v.labore })),
    motivos: r.motivos,
    flexiones: r.flexiones,
  };
}

async function etapaAtencion(month) {
  const [midweeks, labores, months] = await Promise.all([db.listMidweeks(), db.listAtencion(), db.listMonths()]);
  const mwMes = midweeks.filter(m => String(m.id).slice(0, 7) === month);
  const labMes = labores.filter(p => p.id === month);
  const mesMes = months.filter(m => m.id === month);
  const out = runEngine(state.people, { midweeks: mwMes, months: mesMes, salidas: [], atencion: labMes }, {
    scope: 'labores',
    atencionOpts: { serviceRolesOnlyMale: (state.config && state.config.algorithm && state.config.algorithm.serviceRolesOnlyMale) !== false, months: mesMes },
  });
  // Las labores de entre semana se guardan en cada week.labores del midweek.
  await Promise.all(out.atencion.map(p => db.putAtencion(p)));
  await Promise.all(out.midweeks.map(w => db.putMidweek(w)));
  state.midweeks = await db.listMidweeks();
  const r = out.reportes.atencion || { asignados: 0, vacios: [] };
  return {
    asignados: r.asignados,
    vacios: r.vacios.map(v => ({ semana: v.semana, rol: v.labore })),
  };
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

  // Primero se completan los vacíos de entre semana (con acomodación/salidas en
  // cuenta) y después fin de semana + salidas, que usan ese contexto (E1/E2).
  const outEntre = runEngine(state.people, { midweeks: mwMes, months: mesMes, salidas: salMes, atencion: labMes }, { scope: 'entre' });
  const out = runEngine(state.people, { midweeks: outEntre.midweeks, months: mesMes, salidas: salMes, atencion: labMes }, { scope: 'fin' });

  await Promise.all(out.midweeks.map(w => db.putMidweek(w)));
  await Promise.all(out.months.map(m => db.putMonth(m)));
  await Promise.all(out.salidas.map(s => db.putSalidas(s)));
  state.midweeks = await db.listMidweeks();

  const rEnt = outEntre.reportes.entre || { asignados: 0, vacios: [] };
  const rFin = out.reportes.fin || { asignados: 0, vacios: [] };
  const rSal = out.reportes.salidas || { asignados: 0, vacios: [] };
  return {
    asignados: rEnt.asignados + rFin.asignados + rSal.asignados,
    vacios: [...rEnt.vacios.map(v => ({ semana: v.semana, rol: v.labore })),
             ...rFin.vacios.map(v => ({ semana: v.semana, rol: v.labore })),
             ...rSal.vacios.map(v => ({ semana: v.semana, rol: v.labore }))],
  };
}

/* ================================================================== */
/* ETAPA 4/5: GENERACIÓN POR ÁMBITO DESDE LOS EDITORES                */
/* ================================================================== */

const TAB_SCOPE = { entre: 'entre', fin: 'fin', atencion: 'labores' };
const SCOPE_LABELS = { entre: 'Reunión de entre semana', fin: 'Reunión de fin de semana', labores: 'Labores', all: 'programa mensual completo' };

// ¿El ámbito del mes tiene ya alguna asignación? (para decidir si advertir)
async function scopeTieneAsignaciones(month, scope) {
  const [midweeks, months, salidas, atencion] = await Promise.all([db.listMidweeks(), db.listMonths(), db.listSalidas(), db.listAtencion()]);
  const mwMes = midweeks.filter(m => String(m.id).slice(0, 7) === month);
  const mesMes = months.filter(m => m.id === month);
  const salMes = salidas.filter(p => p.id === month);
  const labMes = atencion.filter(p => p.id === month);
  const entries = extractAssignments(
    (scope === 'entre' || scope === 'labores' || scope === 'all') ? mwMes : [],
    (scope === 'fin' || scope === 'all') ? mesMes : [],
    [],
    (scope === 'labores' || scope === 'all') ? labMes : [],
    state.people,
  );
  return entries.length > 0;
}

// Modal de confirmación (spec 16): solo si el ámbito ya tiene asignaciones.
function confirmarRegeneracion(month, scope) {
  return new Promise(async (resolve) => {
    const tiene = await scopeTieneAsignaciones(month, scope);
    if (!tiene) return resolve(true);
    const label = SCOPE_LABELS[scope] || scope;
    const mesTxt = `${MONTHS_ES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
    openModal(`
      <div class="text-center">
        <span class="material-symbols-outlined text-6xl text-warning mb-2">auto_awesome</span>
        <h3 class="font-headline-md text-headline-md text-primary mb-1">Generar ${label}</h3>
        <p class="text-on-surface-variant text-sm mb-1">${mesTxt}</p>
        <p class="text-on-surface-variant text-sm mb-2 mt-3">Esta acción volverá a generar el programa seleccionado y podría reemplazar las asignaciones automáticas existentes.</p>
        <p class="text-on-surface-variant text-sm mb-6">Las asignaciones manuales/bloqueadas se conservarán.</p>
        <div class="flex gap-3 justify-center">
          <button id="genCancel" class="px-5 py-2.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cancelar</button>
          <button id="genGo" class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Continuar</button>
        </div>
      </div>`);
    $('#genCancel').onclick = () => { closeModal(); resolve(false); };
    $('#genGo').onclick = () => { closeModal(); resolve(true); };
  });
}

// Genera (o regenera) el ámbito de un mes usando el motor único: borra SOLO las
// asignaciones automáticas del ámbito, conserva manuales/bloqueadas, ejecuta y
// persiste como borrador local (el botón Guardar del editor sube a Supabase).
async function generateProgram(month, scope) {
  const [midweeks, months, salidas, atencion] = await Promise.all([
    db.listMidweeks(), db.listMonths(), db.listSalidas(), db.listAtencion(),
  ]);
  const mwMes = midweeks.filter(m => String(m.id).slice(0, 7) === month);
  const mesMes = months.filter(m => m.id === month);
  const salMes = salidas.filter(p => p.id === month);
  const labMes = atencion.filter(p => p.id === month);
  const base = { midweeks: mwMes, months: mesMes, salidas: salMes, atencion: labMes };

  const clearKeys = scope === 'entre' ? ['midweeks']
    : scope === 'fin' ? ['months']
    : scope === 'labores' ? ['atencion', 'midweeks']
    : ['midweeks', 'months', 'atencion'];
  const limpio = { ...base };
  for (const k of clearKeys) limpio[k] = clearAutoSlots({ [k]: base[k] })[k];

  const cfg = await db.getConfig();
  const algo = { ...defaultAlgorithmConfig(), ...((cfg.algorithm) || {}) };
  const log = await db.listAssignmentLog();
  const historial = log.map(e => ({ personId: String(e.personId || ''), date: String(e.date || ''), roleKey: String(e.roleKey || '') }));
  const nombres = Object.fromEntries(state.people.map(p => [String(p.id), invertName(p.name)]));

  const out = runEngine(state.people, limpio, {
    scope,
    entreOpts: { historial, nombres, readerLevel: algo.studentReaderLevel },
    finOpts: {
      permanentConductorId: algo.permanentConductorId,
      permanentConductorBackupId: algo.permanentConductorBackupId,
      permanentConductorBackupId2: algo.permanentConductorBackupId2,
    },
    atencionOpts: { serviceRolesOnlyMale: algo.serviceRolesOnlyMale !== false, months: limpio.months },
  });

  const persist = { entre: ['midweeks'], fin: ['months'], labores: ['atencion', 'midweeks'], all: ['midweeks', 'months', 'atencion'] }[scope] || [];
  const writes = [];
  if (persist.includes('midweeks')) out.midweeks.forEach(w => writes.push(db.putMidweek(w)));
  if (persist.includes('months')) out.months.forEach(m => writes.push(db.putMonth(m)));
  if (persist.includes('salidas')) out.salidas.forEach(s => writes.push(db.putSalidas(s)));
  if (persist.includes('atencion')) out.atencion.forEach(a => writes.push(db.putAtencion(a)));
  await Promise.all(writes);
  state.midweeks = await db.listMidweeks();
  await syncAssignmentLog();

  const total = Object.values(out.reportes).reduce((s, r) => s + (r && r.asignados || 0), 0);
  const vacios = Object.values(out.reportes).reduce((s, r) => s + ((r && r.vacios) || []).length, 0);
  return { asignados: total, vacios };
}

// Botón "Generar automáticamente" por pestaña de Programas.
function bindGenerarAmbito(bar, scope) {
  bar.innerHTML = `
    <button id="newGenBtn" data-admin class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-on-secondary font-label-md text-label-md hover:opacity-90 transition-all active:scale-95">
      <span class="material-symbols-outlined text-[18px]">auto_awesome</span> Generar automáticamente
    </button>`;
  const btn = $('#newGenBtn');
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const month = state.progMonth;
      const ok = await confirmarRegeneracion(month, scope);
      if (!ok) return;
      const r = await generateProgram(month, scope);
      toast(r.vacios
        ? `Generado: ${r.asignados} asignación(es), ${r.vacios} sin cubrir. Revise y pulse Guardar.`
        : `Generado: ${r.asignados} asignación(es). Revise y pulse Guardar.`, r.vacios ? 'info' : 'success');
      renderNewBody();
    } catch (err) {
      console.error(err);
      toast('Error al generar: ' + (err.message || err), 'error');
    } finally {
      btn.disabled = false;
    }
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
  $('#algoBarWorkload').innerHTML = svgBarras(byPerson.map(r => ({ label: invertName(r.name), value: r.count })));
  $('#algoLineTimeline').innerHTML = svgLinea(historyTimeline(log).map(r => ({ label: r.month.slice(2), value: r.total })));
  $('#algoDonaRoles').innerHTML = svgDona(distributionByLabore(log).slice(0, 8).map(r => ({ label: r.label, value: r.total })));
  const pairStats = pairRoleStats(log);
  $('#algoBarPairs').innerHTML = pairStats.length
    ? svgBarras(pairStats.map(r => ({ label: invertName(r.name), value: r.encargado + r.ayudante, sub: `${r.encargado}E / ${r.ayudante}A` })))
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
        nombres: Object.fromEntries(people.map(p => [String(p.id), invertName(p.name)])),
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
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined text-[20px]">play_arrow</span> Generar';
    }
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
  await subirStores(['midweeks', 'months', 'salidas', 'atencion']);
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
      <div id="pvBalance" class="mb-4"></div>
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
  $('#pvBalance').innerHTML = redaccionBalancePropuesta(p);
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
    people: state.people,
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

// Resumen de equilibrio segmentado por cargo/género en la propuesta.
function redaccionBalancePropuesta(p) {
  const b = (p && p.balance) || balanceReport(p.assignments, state.people);
  const celdas = [
    ['Ancianos en reunión', b.ancianosEnReunion],
    ['Ministeriales en reunión', b.ministerialesEnReunion],
    ['Publicadores en reunión', b.publicadoresEnReunion],
    ['Publicadores en servicio', b.publicadoresEnServicio],
    ['Ancianos en servicio', b.ancianosEnServicio],
    ['Ministeriales en servicio', b.ministerialesEnServicio],
    ['Mujeres en presentaciones', b.mujeresEnPresentaciones],
    ['Sin participación', b.sinParticipar],
  ];
  const total = celdas.reduce((a, [, v]) => a + (v || 0), 0);
  return `<div class="rounded-xl border border-primary/30 bg-primary-container/10 p-4">
    <div class="flex items-center gap-2 mb-3">
      <span class="material-symbols-outlined text-primary">balance</span>
      <h4 class="font-label-lg text-label-lg text-on-surface">Equilibrio de asignación</h4>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
      ${celdas.map(([l, v]) => `<div class="rounded-lg bg-surface-container-lowest border border-outline-variant/50 p-2.5 text-center">
        <div class="font-headline-md text-headline-md text-primary">${v ?? 0}</div>
        <div class="text-[10px] text-on-surface-variant leading-tight">${escapeHtml(l)}</div>
      </div>`).join('')}
    </div>
    <p class="text-[11px] text-on-surface-variant mt-2">Personas distintas por segmento (no asignaciones). ${b.sinParticipar ? 'Hay personas sin participación en el mes.' : 'Todos participan en el mes.'}</p>
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
    <span class="text-sm text-on-surface">${escapeHtml(invertName(x.name))}</span>
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
      `No participan en programas hasta que se les marque una labor.`,
      g.universales.map(x => fila(x, 'Sin labor marcada')).join('')));
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
  const scope = TAB_SCOPE[state.newTab] || '';
  const showGen = !!scope;
  body.innerHTML = showGen
    ? `<div id="newGenBar" class="flex justify-end mb-4"></div><div id="newTabBody"></div>`
    : `<div id="newTabBody"></div>`;
  const tabBody = $('#newTabBody');
  if (showGen) bindGenerarAmbito($('#newGenBar'), scope);
  if (state.newTab === 'entre') { renderMidweeks({ embed: tabBody, month: state.progMonth }); return; }
  if (state.newTab === 'atencion') { renderAtencion(state.progMonth, { embed: tabBody }); return; }
  if (state.newTab === 'atencionGrupo') { renderAtencionGrupo(state.progMonth, { embed: tabBody }); return; }
  if (state.newTab === 'salidas') { renderSalidas(state.progMonth, { embed: tabBody }); return; }
  if (state.newTab === 'general') { renderGeneralMonth(state.progMonth, { embed: tabBody }); return; }
  renderNewFin(tabBody, state.progMonth);
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
      const filled = m.weeks.filter(w => w.type === 'assembly' || camposFinSemana(w).every(({ campo }) => Boolean(w[campo]))).length;
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
      <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Nombre de la congregación</label>
      <input type="text" data-cong-field="nombre" data-cong-idx="${i}" value="${escapeAttr(c.nombre || '')}" placeholder="Ej. Centro, Norte, San Pablo…" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
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
  const guardar = () => {
    const idx = parseInt(node.dataset.congIdx, 10);
    const field = node.dataset.congField;
    if (!state.month || !state.month.outings || !state.month.outings[idx]) return;
    state.month.outings[idx][field] = node.value;
  };
  // `input` guarda en cada tecla (el nombre no se pierde al re-renderizar);
  // `change` cubre selects y campos de hora al desenfocar.
  node.addEventListener('input', guardar);
  node.addEventListener('change', guardar);
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
  const talkVal = o.tituloDiscurso || '';
  return `<div class="bg-secondary-container/20 border border-secondary/50 rounded-lg p-4 space-y-3" data-outing="${weekIdx}.${outIdx}">
    <div class="flex items-center justify-between">
      <span class="font-label-md text-label-md text-secondary uppercase">Orador ${outIdx + 1}</span>
      <div class="flex items-center gap-2">
        <button data-outing-del="${weekIdx}.${outIdx}" class="text-error" title="Eliminar orador"><span class="material-symbols-outlined text-[18px]">delete</span></button>
      </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div class="space-y-1">
        <label class="font-label-md text-label-md text-on-surface-variant">Orador</label>
        <select data-outing-field="oradorSalida" data-outing-idx="${weekIdx}.${outIdx}" data-people data-labore="salida" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
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
  const labore = campoFinLabore(name) || '';
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
  const valStr = asStr(val);
  if (!valStr) return false;
  return m.weeks.some((w, i) => i !== weekIdx && asStr(w[field]) === valStr);
}

function fillPeople(sel) {
  if (sel.dataset.idx === undefined) return;       // ignorar selects de salidas (usan data-outing-idx)
  const current = parseInt(sel.dataset.idx, 10);
  const field = sel.dataset.field;
  if (!state.month || !state.month.weeks[current]) return;
  const val = asId(state.month.weeks[current][field]);
  const labore = sel.dataset.labore || '';
  const list = eligiblePeople(state.month.weeks[current], state.people, labore, val);
  sel.innerHTML = `<option value="">— Sin asignar —</option>` +
    list.map(p => `<option value="${p.id}" ${String(p.id) === asStr(val) ? 'selected' : ''}>${escapeHtml(invertName(p.name))}</option>`).join('');
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
  const val = outing ? asId(outing.oradorSalida) : '';
  const labore = sel.dataset.labore || 'salida';
  const list = eligiblePeople(state.month.weeks[wi], state.people, labore, val);
  sel.innerHTML = `<option value="">— Sin asignar —</option>` +
    list.map(p => `<option value="${p.id}" ${String(p.id) === asStr(val) ? 'selected' : ''}>${escapeHtml(invertName(p.name))}</option>`).join('');
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
    toast(`${hard.length} conflicto(s) en este programa; se guardarán igualmente. Revise los avisos parpadeantes.`, 'info');
  }
  // Envolver en formato {id, src, locked}: lo que el usuario cambió pasa a
  // MANUAL/bloqueado; lo no tocado conserva su origen (AUTO sigue siendo AUTO).
  const stored = await db.getMonth(state.month.id);
  const changed = changedManualKeys({ months: stored ? [stored] : [] }, { months: [state.month] });
  const wrapped = wrapManualPrograms({ months: [state.month] }, changed).months[0];
  wrapped.updatedAt = Date.now();
  state.month = wrapped;
  await db.putMonth(wrapped);
  await syncAssignmentLog();
  await subirStores(['months']);
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
  // Programa de aseo del mes: para mostrar el grupo asignado en la columna Grupo.
  const aseo = await db.getAseo(state.monthId).catch(() => null);
  state.aseoWeeks = (aseo && aseo.weeks) || [];
  // Labores de atención del mes: para incluirlas en la vista lista.
  const atencion = await db.getAtencion(state.monthId).catch(() => null);
  state.atencionWeeks = (atencion && atencion.weeks) || [];
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

    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6 no-print">
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
  // Labores de atención de la semana (del programa de atención) + grupo semanal.
  const atencionSemana = (state.atencionWeeks.find(x => String(x.saturday) === String(w.date)) || {}).labores || {};
  const grupoSemana = (state.aseoWeeks.find(x => String(x.saturday) === String(w.date)) || {}).group;
  if (w.type === 'normal') {
    rows.push(['Presidente', presName, 'person']);
    rows.push(['Discurso Público', w.tituloDiscurso || '—', 'mic_external_on']);
    rows.push(['Orador', w.orador || '—', 'campaign']);
    rows.push(['Conductor Atalaya', personNameOf(w.conductor), 'menu_book']);
    rows.push(['Lector', personNameOf(w.lector), 'library_books']);
    rows.push(['Grupo semanal', grupoSemana ? deptNameOf(grupoSemana) : deptNameOf(w.departamento), 'handshake']);
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
    ${previewLaboresBox(atencionSemana)}
  </div>`;
}

function previewTabla() {
  const aseoGroupFor = (sat) => {
    const w = (state.aseoWeeks || []).find(x => String(x.saturday) === String(sat));
    return (w && w.group) ? String(w.group) : '';
  };
  const rows = state.month.weeks.map((w, i) => {
    const date = new Date(w.date + 'T00:00:00');
    const dateStr = date.toLocaleDateString('es', { day: '2-digit' });
    const dateAsam = date.toLocaleDateString('es', { day: '2-digit', month: 'long' });

    if (w.type === 'assembly' || w.type === 'commemoration') {
      const label = w.type === 'assembly' ? 'Asamblea' : 'Conmemoración';
      return `<tr class="transition-colors"><td class="p-4 bg-surface-variant/50 text-center" colspan="7" data-label="${label}">
        <div class="py-4">
          <div class="font-headline-md text-headline-md text-primary uppercase tracking-widest font-bold">${label} — ${dateAsam}</div>
        </div></td></tr>`;
    }
    const grupoAseo = aseoGroupFor(w.date);
    const grupoId = grupoAseo || (w.departamento || '');
    const grupoNum = aseoWeekGroupNum({ group: grupoId });
    let grupoTxt = '—';
    if (grupoNum != null) grupoTxt = String(grupoNum);
    else if (grupoId) { const m = String(grupoId).match(/\d+$/); if (m) grupoTxt = m[0]; }
    let cells = {
      title: '—', chairman: '—', speaker: '—', conductor: '—', reader: '—', attendance: '—',
    };
    if (w.type === 'normal') {
      cells.title = escapeHtml(w.tituloDiscurso || '—');
      cells.chairman = escapeHtml(personNameOf(w.presidente));
      cells.speaker = escapeHtml(w.orador || '—');
      cells.conductor = escapeHtml(personNameOf(w.conductor));
      cells.reader = escapeHtml(personNameOf(w.lector));
      cells.attendance = escapeHtml(grupoTxt);
    } else if (w.type === 'supervisor') {
      cells.title = `${escapeHtml(w.discursoSupervisor1 || '—')}<div class="text-caption text-secondary mt-0.5">Discurso público</div>${w.discursoSupervisor2 ? `<div class="mt-1.5">${escapeHtml(w.discursoSupervisor2)}<div class="text-caption text-secondary">Discurso de servicio</div></div>` : ''}`;
      cells.chairman = escapeHtml(personNameOf(w.presidente));
      cells.speaker = `${escapeHtml(w.nombreSupervisor || '—')}<div class="text-caption text-on-surface-variant">Superintendente</div>`;
      cells.conductor = escapeHtml(personNameOf(w.estudioSinLectura));
      cells.reader = 'Sin lectura';
      cells.attendance = escapeHtml(grupoTxt);
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
      <td class="p-4 align-top ${highlight}" data-label="Fecha"><div class="font-body-md text-body-md text-primary font-semibold whitespace-nowrap ${big ? 'text-lg pt-3' : ''}">${dateStr}</div></td>
      <td class="p-4 align-top ${highlight}" data-label="Presidente"><div class="font-body-md text-body-md ${big ? 'text-lg pt-3' : ''}">${cells.chairman}</div></td>
      <td class="p-4 align-top ${highlight}" data-label="Discurso"><div class="font-body-md text-body-md text-primary leading-snug font-medium ${big ? 'text-lg pt-3' : ''}">${cells.title}</div></td>
      <td class="p-4 align-top ${highlight}" data-label="Orador"><div class="font-body-md text-body-md font-semibold ${big ? 'text-lg pt-3' : ''}">${cells.speaker}</div></td>
      <td class="p-4 align-top ${highlight}" data-label="Estudio"><div class="font-body-md text-body-md ${big ? 'text-lg pt-3' : ''}">${cells.conductor}</div></td>
      <td class="p-4 align-top ${highlight}" data-label="Lector"><div class="font-body-md text-body-md ${big ? 'text-lg pt-3' : ''}">${cells.reader}</div></td>
      <td class="p-4 align-top ${highlight}" data-label="Grupo"><div class="font-body-md text-body-md text-primary font-bold ${big ? 'text-lg pt-3' : ''}">${cells.attendance}</div></td>
    </tr>`;
  }).join('');
  return `<div class="tabla-programa responsive-table overflow-x-auto">
    <table class="w-full text-left" style="border-collapse: separate; border-spacing: 0 0.75rem; min-width:0;">
      <colgroup>
        <col class="w-[7%]">
        <col class="w-[14%]">
        <col class="w-[30%]">
        <col class="w-[14%]">
        <col class="w-[14%]">
        <col class="w-[14%]">
        <col class="w-[7%]">
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
  if (!Array.isArray(program.congregations)) program.congregations = [];
  state.month = null;
  renderTop();
  state.month = { weeks: program.weeks, outings: program.congregations };
  const app = $('#app');
  const outs = program.congregations || [];
  app.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6 no-print">
      <div class="flex items-center gap-2">
        <button id="btnEditOut" class="flex items-center gap-2 px-4 py-2 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-all active:scale-95">
          <span class="material-symbols-outlined text-[20px]">edit</span> Editar
        </button>
        <button id="btnPreviewOut" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:shadow-lg transition-all active:scale-95">
          <span class="material-symbols-outlined text-[20px]">visibility</span> Vista Final Programa
        </button>
      </div>
      <div class="flex items-center gap-2" id="outModeSel">
        <span class="text-sm text-on-surface-variant font-label-md">Formato:</span>
        <button data-outmode="a4" class="outModeBtn px-3 py-1.5 rounded-lg border border-primary bg-primary text-on-primary font-label-md text-label-md">A4 vertical</button>
        <button data-outmode="movil" class="outModeBtn px-3 py-1.5 rounded-lg border border-outline text-on-surface-variant font-label-md text-label-md">Móvil 16:9</button>
      </div>
    </div>

    <div id="outingsContent" class="outings-doc outings-mode-a4 bg-surface-container-lowest editorial-shadow rounded-xl border border-outline-variant p-4 md:p-8"></div>
  `;
  $('#btnEditOut').onclick = () => go('salidas', { monthId: state.monthId });
  $('#btnPreviewOut').onclick = () => go('preview', { monthId: state.monthId });
  aplicarModoSalidas(outingsMode);
  app.querySelectorAll('[data-outmode]').forEach(b => b.onclick = () => aplicarModoSalidas(b.dataset.outmode));

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

// Modo de salida de la vista de salidas: 'a4' (vertical A4) o 'movil' (16:9).
let outingsMode = 'a4';

function aplicarModoSalidas(mode) {
  outingsMode = mode;
  const doc = $('#outingsContent');
  if (doc) {
    doc.classList.toggle('outings-mode-a4', mode === 'a4');
    doc.classList.toggle('outings-mode-movil', mode === 'movil');
  }
  document.querySelectorAll('.outModeBtn').forEach(b => {
    const on = b.dataset.outmode === mode;
    b.classList.toggle('bg-primary', on);
    b.classList.toggle('text-on-primary', on);
    b.classList.toggle('border-primary', on);
    b.classList.toggle('border-outline', !on);
    b.classList.toggle('text-on-surface-variant', !on);
  });
  // El tamaño de hoja para imprimir/PDF depende del modo (A4 vertical o 16:9).
  let st = document.getElementById('outingsPageCss');
  if (!st) { st = document.createElement('style'); st.id = 'outingsPageCss'; document.head.appendChild(st); }
  st.textContent = mode === 'movil'
    ? '@page { size: 90mm 160mm; margin: 5mm; }'
    : '@page { size: A4 portrait; margin: 10mm; }';
  renderOutingsContent();
}

function actionBtnOut(label, icon, id) {
  return `<button id="${id}" class="flex items-center gap-2 px-5 py-2 rounded-lg border border-secondary text-secondary font-label-md text-label-md hover:bg-secondary-fixed transition-all active:scale-95">
    <span class="material-symbols-outlined text-[20px]">${icon}</span> ${label}
  </button>`;
}

function renderOutingsContent() {
  const c = $('#outingsContent');
  if (!c) return;
  const m = state.month;
  const outs = m.outings || [];
  const y = Number(state.monthId.slice(0, 4));
  const mes = Number(state.monthId.slice(5, 7));
  const mesTxt = `${MONTHS_ES[mes - 1].toUpperCase()} ${y}`;
  const congs = outs.filter(c => c.nombre);
  const sinCongs = '<span class="text-[#8a8271] italic">Sin congregaciones</span>';
  const title = `SALIDAS  |  ${mesTxt}`;
  const congsLine = congs.map(c => {
    const diaLabel = c.dia === 'domingo' ? 'Domingos' : 'Sábados';
    return `Congregación ${escapeHtml(c.nombre)} — ${diaLabel} ${c.hora || ''}`;
  }).join('  |  ');
  const header = `
    <div class="outings-head mb-5 pb-4 border-b border-[#e7e3db]">
      <div class="outings-title">${title}</div>
      <div class="outings-congs-line">${congsLine || sinCongs}</div>
    </div>`;

  if (outingsMode === 'movil') {
    const rows = m.weeks.map((w, i) => outingMovilCard(w, i)).join('');
    c.innerHTML = `${header}<div class="outings-movil space-y-4">${rows}</div>`;
    return;
  }

  const weekRows = m.weeks.map((w, i) => outingWeekRow(w, i)).join('');
  c.innerHTML = `${header}
    <div class="overflow-x-auto">
      <table class="outings-tabla w-full text-left border-collapse">
        <thead>
          <tr class="bg-[#f4f1ec] text-[#6b6454]">
            <th class="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">Semana / Fecha</th>
            <th class="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">Orador</th>
            <th class="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">Discurso</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[#e7e3db]">${weekRows}</tbody>
      </table>
    </div>`;
}

// Bloque "Semana N" + fecha (texto). Compartido por los dos formatos.
function celdaFecha(i, fechaText) {
  return `
    <div class="outing-semana text-[10px] uppercase tracking-[0.22em] text-[#9a927f] mb-1">Semana ${i + 1}</div>
    <div class="outing-fecha text-lg md:text-xl font-semibold text-[#3f3a2e] leading-tight">${fechaText}</div>`;
}

function outingWeekRow(w, i) {
  const date = new Date(w.saturday + 'T00:00:00');
  const dia = date.getDate();
  const outs = Array.isArray(w.outings) ? w.outings : [];
  if (w.sinSalida) {
    return `<tr class="align-top">
      <td class="px-4 py-3 w-[150px]">${celdaFecha(i, String(dia))}</td>
      <td class="px-4 py-3 text-[#8a8271] italic" colspan="2">Sin salida esta semana</td>
    </tr>`;
  }
  const names = outs.map(o =>
    `<div class="py-1.5 font-semibold text-[#2f2a20] text-lg">${escapeHtml(personNameOf(o.oradorSalida))}</div>`).join('');
  const talks = outs.map(o =>
    `<div class="py-1.5 text-[#6b6454] text-base">${escapeHtml(o.tituloDiscurso || '—')}</div>`).join('');
  return `<tr class="align-top">
    <td class="px-4 py-3 w-[150px]">${celdaFecha(i, String(dia))}</td>
    <td class="px-4 py-3 w-2/5">${names || '<span class="text-[#8a8271] italic text-sm">—</span>'}</td>
    <td class="px-4 py-3 w-2/5">${talks || '<span class="text-[#8a8271] italic text-sm">—</span>'}</td>
  </tr>`;
}

// Formato móvil 16:9: semana + fecha (día de la semana) arriba y el discurso a
// lo ancho debajo.
function outingMovilCard(w, i) {
  const date = new Date(w.saturday + 'T00:00:00');
  const dia = date.getDate();
  const weekday = capitalize(date.toLocaleDateString('es', { weekday: 'long' }));
  const fechaTxt = `${weekday} ${dia}`;
  const outs = Array.isArray(w.outings) ? w.outings : [];
  if (w.sinSalida) {
    return `<div class="outings-movil-row border border-[#e7e3db] rounded-lg p-3">
      ${celdaFecha(i, fechaTxt)}
      <div class="text-[#8a8271] italic mt-1">Sin salida esta semana</div>
    </div>`;
  }
  const items = outs.map(o => `
    <div class="mt-2">
      <div class="font-semibold text-[#2f2a20] text-lg">${escapeHtml(personNameOf(o.oradorSalida))}</div>
      <div class="text-[#6b6454] text-base">${escapeHtml(o.tituloDiscurso || '—')}</div>
    </div>`).join('');
  return `<div class="outings-movil-row border border-[#e7e3db] rounded-lg p-3">
    ${celdaFecha(i, fechaTxt)}
    ${items || '<div class="text-[#8a8271] italic mt-1">—</div>'}
  </div>`;
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
    if (w.sinSalida) { lines.push('Sin salida esta semana'); return; }
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
async function waOutings() {
  toast('Generando imagen…', 'info');
  try {
    const blob = await svgToPngBlob(outingsExportSvg());
    const compartido = await compartirPng(blob, `salidas-${state.month.id}.png`);
    if (!compartido) toast('Imagen descargada: adjúntala en WhatsApp.', 'success');
  } catch (err) { console.error(err); toast('No se pudo generar la imagen. Use Imprimir > Guardar como PDF.', 'error'); }
}
async function imageOutings() {
  const node = $('#outingsContent');
  if (!node) return;
  toast('Generando imagen…', 'info');
  try {
    // Export vía SVG puro: el enfoque SVG+foreignObject contamina el canvas
    // ("Tainted canvases"), así que el programa de salidas se dibuja con
    // texto/rect nativos de SVG, que sí se pueden rasterizar a PNG.
    const svg = outingsExportSvg();
    const blob = await svgToPngBlob(svg);
    downloadBlob(blob, `salidas-${state.month.id}.png`);
    toast('Imagen descargada', 'success');
  } catch (err) { console.error(err); toast('No se pudo generar la imagen. Use Imprimir > Guardar como PDF.', 'error'); }
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
  { id: 'presidente',   label: 'Presidente (entre semana)' },
  { id: 'presidenteFin', label: 'Presidente fin de semana' },
  { id: 'conductor1',   label: 'Cond. Atalaya' },
  { id: 'conductor2',   label: 'Cond. Libro' },
  { id: 'orador',       label: 'Orador (discurso)' },
  { id: 'salida',       label: 'Orador de salida' },
  { id: 'lector1',      label: 'Lector Atalaya' },
  { id: 'lector2',      label: 'Lector Libro' },
  { id: 'audio',        label: 'Sonido' },
  { id: 'microf',       label: 'Micrófono' },
  { id: 'plataforma',   label: 'Plataforma' },
  { id: 'acomodador',   label: 'Acomodador' },
  { id: 'asignacion1',  label: 'Lectura' },
  { id: 'asignacion2',  label: 'Presentación' },
  { id: 'asignacion3',  label: 'Discurso Estudiantil' },
  { id: 'asignacion4',  label: 'Discurso Reunión (vida)' },
  { id: 'discursoInicial', label: 'Discurso inicial Tesoros' },
  { id: 'perlas',       label: 'Perlas' },
];

async function renderLists() {
  state.month = null;
  renderTop();
  await refreshCatalogs();
  const app = $('#app');
  if (isUserRole() && !['personas', 'grupos', 'departamentos'].includes(state.listsTab)) state.listsTab = 'personas';
  const tab = state.listsTab;
  const isPersonas = tab === 'personas';
  const isGrupos = tab === 'grupos';
  const isDeptos = tab === 'departamentos';
  const isAsig = tab === 'asignaciones';
  const isHist = tab === 'historial';
  const tabCls = (t) => `px-4 py-2 font-label-md text-label-md rounded-lg transition-colors ${tab === t ? 'bg-primary text-on-primary shadow' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'}`;
  app.innerHTML = `
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
      <div>
        <h1 class="font-headline-lg text-headline-lg text-primary mb-2">Congregación</h1>
        <p class="text-on-surface-variant font-body-md text-body-md">Personas, grupos, labores e historial del equipo.</p>
      </div>
      <div class="flex flex-wrap gap-2" id="listsTabs">
        <button data-tab="personas" class="${tabCls('personas')}">Personas</button>
        <button data-tab="grupos" class="${tabCls('grupos')}">Grupos</button>
        <button data-tab="departamentos" class="${tabCls('departamentos')}">Labores</button>
        <button data-tab="asignaciones" class="${tabCls('asignaciones')}">Asignaciones</button>
        ${isUserRole() ? '' : `<button data-tab="historial" class="${tabCls('historial')}">Historial</button>`}
      </div>
    </div>

    ${isPersonas && !isUserRole() ? `
    <div class="flex flex-col sm:flex-row items-center gap-4 mb-4 flex-wrap">
      <div class="relative w-full sm:w-64">
        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span>
        <input id="pSearch" class="w-full bg-surface-container-low border border-outline-variant rounded-full py-2 pl-10 pr-4 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-body-md font-body-md" placeholder="Buscar miembro..." type="text">
      </div>
      <div class="relative w-full sm:w-40">
        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">filter_alt</span>
        <select id="pGenderFilter" class="w-full bg-surface-container-low border border-outline-variant rounded-full py-2 pl-10 pr-4 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-body-md font-body-md">
          <option value="">Todos</option>
          <option value="masculino">Hombre</option>
          <option value="femenino">Mujer</option>
        </select>
      </div>
      <div class="relative w-full sm:w-44">
        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">badge</span>
        <select id="pCargoFilter" class="w-full bg-surface-container-low border border-outline-variant rounded-full py-2 pl-10 pr-4 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-body-md font-body-md">
          <option value="">Todos los cargos</option>
          ${CARGOS.map(c => `<option value="${c.id}">${c.label}</option>`).join('')}
        </select>
      </div>
      <button data-admin class="whitespace-nowrap flex items-center justify-center gap-2 border ${state.listsShowInactive ? 'bg-secondary-container text-on-secondary-container border-secondary-container' : 'border-outline text-on-surface-variant'} px-4 py-2 rounded-lg font-label-md text-label-md hover:bg-surface-container-high transition-colors" id="toggleInactive">
        <span class="material-symbols-outlined text-[18px]">history_toggle_off</span>
        <span>${state.listsShowInactive ? 'Ocultar desactivados' : 'Ver desactivados'}</span>
      </button>
    </div>` : ''}

    <div class="bg-surface-container-lowest rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.04)] border border-outline-variant overflow-hidden">
      <div id="pList" class="overflow-auto max-h-[68vh] p-3 sm:p-4 grid grid-cols-1 xl:grid-cols-2 gap-3 content-start"></div>
    </div>

    <div class="mt-6 flex justify-between flex-wrap gap-3">
      <div class="flex flex-wrap gap-3">
        ${(isDeptos || isAsig || isHist) ? `<button id="manageLaboresBtn" data-admin class="bg-surface-container-low text-on-surface-variant px-4 py-2 rounded-lg font-label-md text-label-md hover:bg-surface-variant transition-colors flex items-center gap-2"><span class="material-symbols-outlined text-[18px]">manage_accounts</span> Gestionar Labores</button>` : ''}
        ${isGrupos ? `<button id="assignGroupBtn" data-admin class="bg-surface-container-low text-on-surface-variant px-4 py-2 rounded-lg font-label-md text-label-md hover:bg-surface-variant transition-colors flex items-center gap-2"><span class="material-symbols-outlined text-[18px]">group</span> Asignar Grupos</button>
        <button id="manageGroupsBtn" data-admin class="bg-surface-container-low text-on-surface-variant px-4 py-2 rounded-lg font-label-md text-label-md hover:bg-surface-variant transition-colors flex items-center gap-2"><span class="material-symbols-outlined text-[18px]">settings</span> Gestionar Grupos</button>` : ''}
      </div>
      ${(isPersonas || isHist) ? `<button id="addMemberBtn" data-admin class="bg-primary text-on-primary px-4 py-2 rounded-lg font-label-md text-label-md hover:opacity-90 transition-opacity flex items-center gap-2"><span class="material-symbols-outlined text-[18px]">add</span> Añadir Miembro</button>` : ''}
    </div>
  `;

  $('#listsTabs').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.listsTab = b.dataset.tab; renderLists(); });
  const agb = $('#assignGroupBtn');
  if (agb) agb.onclick = openGroupAssignmentModal;
  const mgb = $('#manageGroupsBtn');
  if (mgb) mgb.onclick = renderGruposConfigModal;
  const manageLaboresBtn = $('#manageLaboresBtn');
  if (manageLaboresBtn) manageLaboresBtn.onclick = renderLaboresModal;

  if (isHist) { renderListsHistorial(); return; }
  if (isGrupos) { renderListsGrupos(); return; }
  if (isDeptos) { renderListsDepartamentos(); return; }
  if (isAsig) { renderListsAsignaciones(); return; }

  const addMemberBtn = $('#addMemberBtn');
  if (addMemberBtn) addMemberBtn.onclick = openAddMemberModal;
  const toggleInactiveBtn = $('#toggleInactive');
  if (toggleInactiveBtn) toggleInactiveBtn.onclick = () => { state.listsShowInactive = !state.listsShowInactive; renderLists(); };

  const search = $('#pSearch');
  const genderFilter = $('#pGenderFilter');
  const cargoFilter = $('#pCargoFilter');
  const applyFilter = () => {
    const q = normalizeStr(search.value);
    const gen = genderFilter.value;
    const cargo = cargoFilter.value;
    let anyVisible = false;
    document.querySelectorAll('#pList .person-card, #pList .person-card-mobile').forEach(card => {
      const matchName = card.dataset.norm.includes(q);
      const matchGen = !gen || card.dataset.genero === gen;
      const matchCargo = !cargo || card.dataset.cargo === cargo;
      const show = matchName && matchGen && matchCargo;
      card.classList.toggle('is-hidden', !show);
      if (show) anyVisible = true;
    });
    const hasCards = document.querySelectorAll('#pList .person-card, #pList .person-card-mobile').length > 0;
    const empty = $('#pEmpty');
    if (empty) empty.classList.toggle('hidden', !hasCards || anyVisible);
  };
  if (!isUserRole()) {
    search.addEventListener('input', applyFilter);
    genderFilter.addEventListener('change', applyFilter);
    cargoFilter.addEventListener('change', applyFilter);
  }

  const pList = $('#pList');
  pList.className = 'overflow-auto max-h-[68vh] p-0';
  const inactivos = state.listsShowInactive ? await db.listPeopleInactive() : [];
  const rows = [
    ...state.people.map(p => renderPersonCard(p, false, false)),
    ...inactivos.map(p => renderPersonCard(p, false, true)),
  ];
  if (isUserRole()) {
    pList.innerHTML = `<div class="overflow-x-auto">
      <table class="w-full text-left border-collapse min-w-[420px]">
        <thead><tr class="bg-surface-container border-b border-outline-variant">
          <th class="px-3 py-2 font-label-md text-label-md text-on-surface-variant uppercase">Nombre</th>
          <th class="px-3 py-2 font-label-md text-label-md text-on-surface-variant uppercase text-right">Acciones</th>
        </tr></thead>
        <tbody class="divide-y divide-outline-variant/40">${state.people.length ? state.people.map(renderUserPersonRow).join('') : '<tr><td colspan="2" class="p-6 text-center text-on-surface-variant text-sm">Sin personas.</td></tr>'}</tbody>
      </table>
    </div>`;
    pList.querySelectorAll('[data-user-profile]').forEach(b => b.onclick = () => {
      const person = state.people.find(x => String(x.id) === String(b.dataset.userProfile));
      if (person) openPersonProfile(person);
    });
    return;
  }
  pList.innerHTML = `
    <div class="space-y-3 md:hidden">${state.people.length || inactivos.length ? [...state.people.map(p => renderPersonMobileCard(p, false)), ...inactivos.map(p => renderPersonMobileCard(p, true))].join('') : '<div class="p-6 text-center text-on-surface-variant text-sm bg-surface-container-lowest rounded-xl border border-outline-variant">Sin personas. Añada un miembro para comenzar.</div>'}</div>
    <div class="hidden md:block overflow-x-auto">
      <table class="w-full text-left border-collapse min-w-[720px]">
        <thead><tr class="bg-surface-container border-b border-outline-variant">
          <th class="px-3 py-2 font-label-md text-label-md text-on-surface-variant uppercase">Miembro</th>
          <th class="px-3 py-2 font-label-md text-label-md text-on-surface-variant uppercase">Grupo</th>
          <th class="px-3 py-2 font-label-md text-label-md text-on-surface-variant uppercase">Género</th>
          <th class="px-3 py-2 font-label-md text-label-md text-on-surface-variant uppercase">Calificación</th>
          <th class="px-3 py-2 font-label-md text-label-md text-on-surface-variant uppercase">Cargo</th>
          <th class="px-3 py-2 font-label-md text-label-md text-on-surface-variant uppercase text-right">Acciones</th>
        </tr></thead>
        <tbody class="divide-y divide-outline-variant/40">${rows.length ? rows.join('') : '<tr><td colspan="6" class="p-6 text-center text-on-surface-variant text-sm">Sin personas. Añada un miembro para comenzar.</td></tr>'}</tbody>
      </table>
    </div>
  <div id="pEmpty" class="p-6 text-center text-on-surface-variant text-sm hidden">Sin resultados para el filtro actual.</div>`;
  renderPersonCardBindings(false);
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
  // Las labores visibles dependen del género elegido: las mujeres solo pueden
  // participar en presentaciones (asignacion2), igual que en los chips del perfil.
  const renderLabores = () => {
    const genero = document.querySelector('[data-attr="genero"]').value;
    const visibles = genero === 'femenino' ? state.labores.filter(r => r.id === 'asignacion2') : state.labores;
    const marcadas = new Set(Array.from(document.querySelectorAll('[data-mr]:checked')).map(c => c.dataset.mr));
    $('#mdLabores').innerHTML = visibles.map(r =>
      `<label class="flex items-center gap-1.5 cursor-pointer text-[12px] font-label-md text-on-surface-variant"><input type="checkbox" data-mr="${r.id}" class="text-primary accent-primary" ${marcadas.has(r.id) ? 'checked' : ''}> ${r.label}</label>`
    ).join('');
  };
  renderLabores();
  document.querySelector('[data-attr="genero"]').addEventListener('change', renderLabores);
  $('#mdCancel2').onclick = closeModal;
  $('#mdForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#mdName').value.trim();
    if (!name) { toast('Escribe un nombre', 'error'); return; }
    const labores = Array.from(document.querySelectorAll('[data-mr]:checked')).map(c => c.dataset.mr);
    const attrs = readPersonAttrs();
    // Defensa en profundidad: descartar labores no permitidas para el género.
    const persona = { genero: attrs.genero };
    const laboresFiltradas = attrs.genero === 'femenino' ? labores.filter(l => laboreAllowedForPerson(persona, l)) : labores;
    try {
      const newId = await db.addPerson({ name, labores: laboresFiltradas, ...attrs });
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

// Paleta sutil de colores por grupo (1..N).
const GRUPO_COLORES = [
  { bg: '#e7e5f4', text: '#4c3f9e' },
  { bg: '#d8efe2', text: '#1f7a4d' },
  { bg: '#fde8d7', text: '#a85b1a' },
  { bg: '#fde3e3', text: '#b23b3b' },
  { bg: '#dbeaf6', text: '#1f6fa8' },
  { bg: '#f3e2f7', text: '#8b3f9e' },
  { bg: '#f4ead1', text: '#8a6d1f' },
  { bg: '#e2edf0', text: '#2f7f8f' },
];
function grupoColorFor(grupoId) {
  const n = Number(String(grupoId).replace(/\D/g, ''));
  if (!isFinite(n) || n <= 0) return null;
  return GRUPO_COLORES[(n - 1) % GRUPO_COLORES.length];
}
// Avatar: si la persona tiene grupo asignado muestra su NÚMERO con el color del
// grupo; si no, las iniciales (estilo actual).
function avatarHtml(p, size = 'w-10 h-10') {
  const gc = p && p.grupoId ? grupoColorFor(p.grupoId) : null;
  const text = gc ? String(p.grupoId) : initialsOf(p && p.name);
  const cls = gc ? '' : avatarClassFor(p && p.name);
  const style = gc ? ` style="background:${gc.bg};color:${gc.text}"` : '';
  return `<div class="${size} rounded-full ${cls} flex items-center justify-center font-label-md text-label-md font-bold shrink-0"${style}>${text}</div>`;
}

// Mapa de labores a categoría para la presentación en 3 columnas.
// La presidencia aparece en ambas columnas (ES y FS) porque son cargos distintos.
const LABOR_CATEGORY = {
  // Entre semana
  presidente: 'es',
  discursoInicial: 'es',
  perlas: 'es',
  asignacion1: 'es',
  asignacion2: 'es',
  asignacion3: 'es',
  asignacion4: 'es',
  conductor2: 'es',
  lector2: 'es',
  // Fin de semana
  presidenteFin: 'fs',
  conductor1: 'fs',
  lector1: 'fs',
  orador: 'fs',
  salida: 'fs',
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
  // La presidencia de entre semana (es) y la de fin de semana (fs) son cargos
  // distintos y ya constan por separado en LABOR_CATEGORY.
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

// Fila de persona (vista Personas → tabla). Muestra avatar (número de grupo),
// nombre, grupo, género, calificación, cargo y acciones (ver perfil / borrar).
function renderPersonCard(p, editMode, isInactive = false) {
  const gen = p.genero === 'femenino' ? 'Femenino' : p.genero === 'masculino' ? 'Masculino' : '—';
  const cal = CALIFICACIONES.includes(p.calificacion) ? p.calificacion : '—';
  const cargo = cargoOf(p);
  const grupo = p.grupoId ? deptNameOf(p.grupoId) : '—';
  const acciones = isInactive
    ? `<button data-prestore="${p.id}" class="p-1.5 rounded-lg text-primary hover:bg-primary-fixed" title="Restaurar"><span class="material-symbols-outlined text-[18px]">undo</span></button>`
    : `
      <button data-profile="${p.id}" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-colors" title="Ver perfil">Ver perfil</button>
      <button data-pdel="${p.id}" data-admin class="inline-flex items-center justify-center p-1.5 rounded-lg text-error hover:bg-error-container" title="Quitar de la lista"><span class="material-symbols-outlined text-[18px]">delete</span></button>`;
  return `<tr class="person-card ${isInactive ? 'is-inactive' : ''}" data-norm="${escapeAttr(normalizeStr(p.name))}" data-genero="${escapeAttr(p.genero || '')}" data-cargo="${escapeAttr(cargoOf(p).id)}" data-pid="${p.id}">
    <td class="px-3 py-2">
      <div class="flex items-center gap-3">
        ${avatarHtml(p, 'w-9 h-9')}
        <div class="min-w-0">
          <p class="font-body-md text-body-md font-semibold text-on-surface truncate">${escapeHtml(p.name)}</p>
          ${isInactive ? '<span class="text-[11px] text-error font-label-md">Desactivada</span>' : ''}
        </div>
      </div>
    </td>
    <td class="px-3 py-2 whitespace-nowrap font-medium text-on-surface">${escapeHtml(grupo)}</td>
    <td class="px-3 py-2 whitespace-nowrap text-on-surface-variant">${gen}</td>
    <td class="px-3 py-2 whitespace-nowrap">${cal}</td>
    <td class="px-3 py-2 whitespace-nowrap">${cargo.label}</td>
    <td class="px-3 py-2 whitespace-nowrap">
      <div class="flex items-center gap-1 justify-end">${acciones}</div>
    </td>
  </tr>`;
}

function renderUserPersonRow(p) {
  return `<tr class="person-card" data-pid="${p.id}">
    <td class="px-3 py-3"><div class="flex items-center gap-3">${avatarHtml(p, 'w-9 h-9')}<span class="font-body-md text-body-md font-semibold text-on-surface">${escapeHtml(p.name)}</span></div></td>
    <td class="px-3 py-3 text-right"><button data-user-profile="${p.id}" class="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-colors">Ver perfil</button></td>
  </tr>`;
}

function renderPersonMobileCard(p, isInactive = false) {
  const grupo = p.grupoId ? deptNameOf(p.grupoId) : 'Sin grupo';
  const acciones = isInactive
    ? `<button data-prestore-mobile="${p.id}" class="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-colors" title="Restaurar"><span class="material-symbols-outlined text-[18px]">undo</span> Restaurar</button>`
    : `
      <button data-profile-mobile="${p.id}" class="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-colors" title="Ver perfil">Ver perfil</button>
      <button data-pdel-mobile="${p.id}" data-admin class="inline-flex items-center justify-center p-2.5 rounded-lg text-error hover:bg-error-container" title="Quitar de la lista"><span class="material-symbols-outlined text-[18px]">delete</span></button>`;
  return `<article class="person-card-mobile md:hidden ${isInactive ? 'is-inactive' : ''}" data-norm="${escapeAttr(normalizeStr(p.name))}" data-genero="${escapeAttr(p.genero || '')}" data-cargo="${escapeAttr(cargoOf(p).id)}" data-pid="${p.id}">
    <div class="flex items-start gap-3">
      ${avatarHtml(p, 'w-11 h-11')}
      <div class="min-w-0 flex-1">
        <p class="font-body-md text-body-md font-semibold text-on-surface truncate">${escapeHtml(p.name)}</p>
        <p class="text-xs text-on-surface-variant truncate">${escapeHtml(grupo)}</p>
        ${isInactive ? '<span class="text-[11px] text-error font-label-md">Desactivada</span>' : ''}
        <div class="mt-3 flex items-center gap-2">${acciones}</div>
      </div>
    </div>
  </article>`;
}

function renderPersonCardBindings(editMode) {
  $('#pList').querySelectorAll('[data-profile]').forEach(b => b.onclick = () => {
    const person = state.people.find(x => String(x.id) === String(b.dataset.profile));
    if (person) openPersonProfile(person);
  });
  $('#pList').querySelectorAll('[data-profile-mobile]').forEach(b => b.onclick = () => {
    const person = state.people.find(x => String(x.id) === String(b.dataset.profileMobile));
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
  $('#pList').querySelectorAll('[data-prestore-mobile]').forEach(b => b.onclick = async () => {
    if (await confirmDialog('¿Restaurar esta persona? Volverá a aparecer en las listas y podrá recibir asignaciones.')) {
      await db.restorePerson(b.dataset.prestoreMobile);
      renderLists();
    }
  });
  $('#pList').querySelectorAll('[data-pdel]').forEach(b => b.onclick = async () => {
    if (await confirmDialog('¿Quitar a esta persona? No recibirá más asignaciones y quedará oculta; su historial se conserva y puede restaurarse después.')) { await db.deletePerson(b.dataset.pdel); renderLists(); }
  });
  $('#pList').querySelectorAll('[data-pdel-mobile]').forEach(b => b.onclick = async () => {
    if (await confirmDialog('¿Quitar a esta persona? No recibirá más asignaciones y quedará oculta; su historial se conserva y puede restaurarse después.')) { await db.deletePerson(b.dataset.pdelMobile); renderLists(); }
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

/* ---------- Vista Grupos (Personas) ---------- */
function renderListsGrupos() {
  const list = $('#pList');
  list.className = 'overflow-auto max-h-[68vh] p-3 sm:p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 content-start';
  const grupos = state.departments;
  if (!grupos.length) { list.innerHTML = '<p class="text-on-surface-variant text-sm col-span-full">No hay grupos creados.</p>'; return; }
  list.innerHTML = grupos.map(g => {
    const miembros = state.people.filter(p => p.activo !== false && String(p.grupoId || '') === String(g.id));
    const gc = grupoColorFor(g.id);
    const color = gc ? { background: gc.bg, color: gc.text } : { background: '#f4f1ec', color: '#6b6454' };
    return `<button data-grupo="${g.id}" class="text-left bg-surface-container-lowest rounded-xl border border-outline-variant p-5 hover:border-primary hover:shadow-lg transition-all">
      <div class="flex items-center justify-between mb-2 gap-2">
        <span class="font-headline-md text-headline-md" style="color:${color.color}">${escapeHtml(g.name)}</span>
        <span class="px-2 py-0.5 rounded-full font-label-md text-label-md shrink-0" style="background:${color.background};color:${color.color}">${miembros.length}</span>
      </div>
      <div class="text-sm text-on-surface-variant">${miembros.length ? miembros.map(m => escapeHtml(m.name.split(' ')[0])).join(' · ') : 'Sin miembros'}</div>
    </button>`;
  }).join('');
  list.querySelectorAll('[data-grupo]').forEach(b => b.onclick = () => renderGrupoInterior(b.dataset.grupo));
}

// Interior de un grupo: vista completa (no modal) con la lista de miembros.
function renderGrupoInterior(grupoId) {
  const g = state.departments.find(d => String(d.id) === String(grupoId));
  if (!g) return;
  const list = $('#pList');
  list.className = '';
  const miembros = state.people.filter(p => p.activo !== false && String(p.grupoId || '') === String(grupoId));
  const gc = grupoColorFor(grupoId);
  list.innerHTML = `
    <div class="mb-3 flex items-center gap-3 flex-wrap">
      <button data-gvolver class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container transition-colors">
        <span class="material-symbols-outlined text-[18px]">arrow_back</span> Grupos
      </button>
      ${gc ? `<div class="w-10 h-10 rounded-full flex items-center justify-center font-bold shrink-0" style="background:${gc.bg};color:${gc.text}">${String(grupoId)}</div>` : ''}
      <div class="flex items-center gap-2 ml-auto" data-admin>
        <button data-grenombrar class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container transition-colors">
          <span class="material-symbols-outlined text-[18px]">edit</span> Renombrar
        </button>
        <button data-gocultar class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-error/40 text-error font-label-md text-label-md hover:bg-error-container transition-colors">
          <span class="material-symbols-outlined text-[18px]">visibility_off</span> Ocultar
        </button>
      </div>
    </div>
    <h2 class="font-headline-lg text-headline-lg text-primary mb-1">${escapeHtml(g.name)}</h2>
    <p class="text-on-surface-variant font-body-md mb-4">${miembros.length} miembro(s)</p>
    <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead><tr class="bg-surface-container border-b border-outline-variant">
            <th class="px-3 py-2 font-label-md text-label-md text-on-surface-variant uppercase">Miembro</th>
            <th class="px-3 py-2 font-label-md text-label-md text-on-surface-variant uppercase">Cargo</th>
          </tr></thead>
          <tbody class="divide-y divide-outline-variant/40">
            ${miembros.length ? miembros.map(m => `<tr><td class="px-3 py-2"><div class="flex items-center gap-3">${avatarHtml(m, 'w-9 h-9')}<span class="font-body-md text-body-md text-on-surface">${escapeHtml(m.name)}</span></div></td><td class="px-3 py-2 text-on-surface-variant">${cargoOf(m).label}</td></tr>`).join('') : '<tr><td colspan="2" class="p-6 text-center text-on-surface-variant text-sm">Sin miembros en este grupo.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
  list.querySelector('[data-gvolver]').onclick = () => renderListsGrupos();
  const renombrar = list.querySelector('[data-grenombrar]');
  if (renombrar) renombrar.onclick = async () => {
    const nuevo = promptText('Renombrar grupo', g.name);
    if (nuevo == null) return;
    if (!nuevo.trim()) { toast('Nombre vacío', 'error'); return; }
    await db.updateDepartment({ ...g, name: nuevo.trim() });
    await refreshCatalogs();
    toast('Grupo actualizado', 'success');
    renderListsGrupos();
  };
  const ocultar = list.querySelector('[data-gocultar]');
  if (ocultar) ocultar.onclick = async () => {
    if (!await confirmDialog(`¿Ocultar el grupo "${g.name}"? Se quita de las listas y puede restaurarse después.`, 'Ocultar')) return;
    await db.deleteDepartment(g.id);
    await refreshCatalogs();
    toast('Grupo oculto', 'success');
    renderListsGrupos();
  };
}

/* ---------- Vista Labores (servicio) ---------- */
function renderListsDepartamentos() {
  const list = $('#pList');
  list.className = 'overflow-auto max-h-[68vh] p-3 sm:p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 content-start';
  const labores = state.labores.filter(r => isServiceLabore(r.id));
  if (!labores.length) { list.innerHTML = '<p class="text-on-surface-variant text-sm col-span-full">No hay labores de servicio definidos.</p>'; return; }
  list.innerHTML = labores.map(r => {
    const personas = state.people.filter(p => p.activo !== false && Array.isArray(p.labores) && p.labores.includes(r.id));
    return `<button data-departamento="${r.id}" class="text-left bg-surface-container-lowest rounded-xl border border-outline-variant p-5 hover:border-primary hover:shadow-lg transition-all">
      <div class="flex items-center justify-between mb-1 gap-2">
        <span class="font-headline-md text-headline-md text-primary">${escapeHtml(r.label)}</span>
        <span class="px-2 py-0.5 rounded-full bg-surface-variant text-on-surface-variant font-label-md text-label-md shrink-0">${personas.length}</span>
      </div>
      <div class="text-sm text-on-surface-variant">${personas.length ? personas.map(p => escapeHtml(p.name.split(' ')[0])).join(' · ') : 'Nadie asignado'}</div>
    </button>`;
  }).join('');
  list.querySelectorAll('[data-departamento]').forEach(b => b.onclick = () => renderDepartamentoInterior(b.dataset.departamento));
}

/* ---------- Vista Asignaciones (discursos, conducciones, lecturas…) ---------- */
function renderListsAsignaciones() {
  const list = $('#pList');
  list.className = 'overflow-auto max-h-[68vh] p-3 sm:p-4 content-start';
  const asignaciones = state.labores.filter(r => isAssignmentLabore(r.id));
  if (!asignaciones.length) { list.innerHTML = '<p class="text-on-surface-variant text-sm col-span-full">No hay asignaciones definidas.</p>'; return; }

  const card = (r) => {
    const personas = state.people.filter(p => p.activo !== false && Array.isArray(p.labores) && p.labores.includes(r.id));
    return `<button data-departamento="${r.id}" class="text-left bg-surface-container-lowest rounded-xl border border-outline-variant p-5 hover:border-primary hover:shadow-lg transition-all">
      <div class="flex items-center justify-between mb-1 gap-2">
        <span class="font-headline-md text-headline-md text-primary">${escapeHtml(r.label)}</span>
        <span class="px-2 py-0.5 rounded-full bg-surface-variant text-on-surface-variant font-label-md text-label-md shrink-0">${personas.length}</span>
      </div>
      <div class="text-sm text-on-surface-variant">${personas.length ? personas.map(p => escapeHtml(p.name.split(' ')[0])).join(' · ') : 'Nadie asignado'}</div>
    </button>`;
  };

  const header = (g) => {
    const cls = g.sub ? 'mt-5 mb-2 text-caption font-label-md text-label-md text-on-surface-variant uppercase tracking-widest' : 'mt-2 mb-3 font-headline-md text-headline-md text-primary';
    const grid = g.sub ? '' : ' grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3';
    return `<div class="${cls}">${escapeHtml(g.title)}</div><div class="${grid}">`;
  };

  let html = '';
  for (const g of ASIGNACION_GRUPOS) {
    const roles = asignaciones.filter(r => LABORE_GRUPO[r.id] === g.id);
    if (!roles.length) continue;
    html += header(g) + roles.map(card).join('') + '</div>';
  }
  const otras = asignaciones.filter(r => !LABORE_GRUPO[r.id]);
  if (otras.length) {
    html += header({ sub: false, title: 'Otras' }) + otras.map(card).join('') + '</div>';
  }
  list.innerHTML = html;
  list.querySelectorAll('[data-departamento]').forEach(b => b.onclick = () => renderDepartamentoInterior(b.dataset.departamento));
}

// Interior de un departamento (labor): vista completa con lista de asignados y
// la opción de agregar más miembros a esa labor.
function renderDepartamentoInterior(laboreId) {
  const r = state.labores.find(x => String(x.id) === String(laboreId));
  if (!r) return;
  const esAsig = isAssignmentLabore(String(laboreId));
  const list = $('#pList');
  list.className = '';
  const render = () => {
    const personas = state.people.filter(p => p.activo !== false && Array.isArray(p.labores) && p.labores.includes(String(laboreId)));
    // En las asignaciones solo pueden participar quienes cumplen la regla de género
    // (mujeres únicamente en presentaciones); por eso solo se ofrece agregar a esos.
    const puedeLabore = (m) => !esAsig || laboreAllowedForPerson(m, String(laboreId));
    const sinLabor = state.people.filter(p => p.activo !== false && !(Array.isArray(p.labores) && p.labores.includes(String(laboreId))) && puedeLabore(p));
    list.innerHTML = `
      <div class="mb-3">
        <button data-dvolver class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container transition-colors">
          <span class="material-symbols-outlined text-[18px]">arrow_back</span> ${esAsig ? 'Asignaciones' : 'Labores'}
        </button>
      </div>
      <h2 class="font-headline-lg text-headline-lg text-primary mb-1">${escapeHtml(r.label)}</h2>
      <p class="text-on-surface-variant font-body-md mb-4">${personas.length} persona(s) con esta ${esAsig ? 'asignación' : 'labor'}.</p>
      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden mb-6">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead><tr class="bg-surface-container border-b border-outline-variant">
              <th class="px-3 py-2 font-label-md text-label-md text-on-surface-variant uppercase">Miembro</th>
              <th class="px-3 py-2 font-label-md text-label-md text-on-surface-variant uppercase">Cargo</th>
            </tr></thead>
            <tbody class="divide-y divide-outline-variant/40">
              ${personas.length ? personas.map(m => `<tr><td class="px-3 py-2"><div class="flex items-center gap-3">${avatarHtml(m, 'w-9 h-9')}<span class="font-body-md text-body-md text-on-surface">${escapeHtml(m.name)}</span></div></td><td class="px-3 py-2 text-on-surface-variant">${cargoOf(m).label}</td></tr>`).join('') : '<tr><td colspan="2" class="p-6 text-center text-on-surface-variant text-sm">Nadie asignado a esta labor.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      ${sinLabor.length ? `
      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-5">
        <h3 class="font-headline-md text-headline-md text-primary mb-2">Agregar miembros</h3>
        <div class="max-h-52 overflow-y-auto rounded-lg border border-outline-variant divide-y divide-outline-variant/40 mb-3">
          ${sinLabor.map(m => `<label class="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-surface-container">${avatarHtml(m, 'w-8 h-8')}<span class="flex-1 text-sm text-on-surface truncate">${escapeHtml(m.name)}</span><input type="checkbox" data-agregar="${m.id}" class="accent-primary w-4 h-4 shrink-0"></label>`).join('')}
        </div>
        <button id="dlabAdd" data-admin class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-opacity">Agregar seleccionados</button>
      </div>` : ''}`;
    list.querySelector('[data-dvolver]').onclick = () => esAsig ? renderListsAsignaciones() : renderListsDepartamentos();
    const addBtn = $('#dlabAdd');
    if (addBtn) addBtn.onclick = async () => {
      const ids = [...list.querySelectorAll('[data-agregar]:checked')].map(cb => cb.dataset.agregar);
      if (!ids.length) { toast('Marca al menos una persona', 'error'); return; }
      const btn = addBtn;
      btn.disabled = true;
      try {
        for (const id of ids) {
          const person = state.people.find(x => String(x.id) === String(id));
          if (!person) continue;
          person.labores = Array.isArray(person.labores) ? person.labores : [];
          if (!person.labores.includes(String(laboreId))) person.labores.push(String(laboreId));
          await db.updatePerson(person);
        }
        state.people = await db.listPeople();
        toast(`${ids.length} agregado(s) a ${r.label}`, 'success');
        render();
      } finally { btn.disabled = false; }
    };
  };
  render();
}

// Gestión de Grupos (única: vista Congregación → pestaña Grupos).
// La cantidad de grupos es el nº de departamentos activos; al guardar, crea u
// oculta grupos en la DB (store departments) y eso se propaga al resto de la app.
async function renderGruposConfigModal() {
  const n = Math.max(state.departments.length, 1);
  const grupos = state.departments
    .map(d => { const m = /^(?:grupo\s*)?(\d+)$/i.exec(String(d.name || '').trim()); return { d, num: m ? Number(m[1]) : null }; })
    .sort((a, b) => (a.num ?? 999) - (b.num ?? 999));
  const rows = grupos.map(({ d }) => `
    <div class="flex items-center gap-2">
      <span class="w-16 shrink-0 font-label-md text-label-md text-on-surface-variant">${escapeHtml(d.name)}</span>
      <input type="text" data-glab="${d.id}" value="${escapeAttr(d.labores || '')}" placeholder="Labor del grupo (p. ej. Aseo)" class="flex-1 bg-surface-bright border border-outline-variant rounded-lg p-2 font-body-md focus:border-primary" autocomplete="off">
    </div>`).join('');
  openModal(`
    <div>
      <h3 class="font-headline-md text-headline-md text-primary mb-1">Gestionar Grupos</h3>
      <p class="text-on-surface-variant text-sm mb-4">Indique cuántos grupos de atención hay en la congregación y asigne la labor de cada grupo. Se crean (o se ocultan) los grupos necesarios y el cambio se propaga a toda la app.</p>
      <div class="space-y-4">
        <div>
          <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Cantidad de grupos</label>
          <select id="gcfgCant" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
            ${Array.from({ length: 12 }, (_, i) => i + 1).map(x => `<option value="${x}" ${x === n ? 'selected' : ''}>${x} grupo${x > 1 ? 's' : ''}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Labores de grupo</label>
          <div class="space-y-2 max-h-[40vh] overflow-y-auto">${rows}</div>
        </div>
      </div>
      <div class="flex flex-wrap gap-3 justify-end mt-5">
        <button id="gcfgRotate" class="px-5 py-2.5 rounded-lg border border-secondary text-secondary font-label-md text-label-md hover:bg-secondary-container">Aplicar rotación a todos los programas</button>
        <button id="gcfgCancel" class="px-5 py-2.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container transition-colors">Cancelar</button>
        <button id="gcfgSave" class="px-6 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-opacity">Guardar</button>
      </div>
    </div>`);
  $('#gcfgCancel').onclick = closeModal;
  $('#gcfgSave').onclick = async () => {
    const nn = Math.max(parseInt($('#gcfgCant').value, 10) || n, 1);
    await ensureGroupCountGlobal(nn);
    const inputs = [...document.querySelectorAll('#modalCard [data-glab]')];
    for (const inp of inputs) {
      const d = state.departments.find(x => String(x.id) === String(inp.dataset.glab));
      if (!d) continue;
      const lab = inp.value.trim();
      if ((d.labores || '') !== lab) {
        await db.updateDepartment({ ...d, labores: lab });
      }
    }
    await refreshCatalogs();
    closeModal();
    toast('Grupos guardados', 'success');
    renderLists();
  };
  $('#gcfgRotate').onclick = async () => {
    const nn = Math.max(parseInt($('#gcfgCant').value, 10) || n, 1);
    const { meses, semanas } = await aplicarRotacionAseos(nn);
    toast(`Rotación aplicada a ${meses} programa(s) de aseo · ${semanas} semana(s)`, 'success');
  };
}

// Re-aplica la rotación correlativa de grupos a todos los programas de aseo.
async function aplicarRotacionAseos(n) {
  const aseos = await db.listAseos();
  aseos.sort((a, b) => a.id.localeCompare(b.id)); // cronológico
  let semanas = 0;
  for (const a of aseos) {
    if (!Array.isArray(a.weeks) || !a.weeks.length) continue;
    const start = await nextAseoStart(a.id, n); // continúa del mes anterior
    let prev = start;
    for (const w of a.weeks) {
      if (prev == null) { w.group = ''; continue; }
      w.group = groupDeptForNum(prev);
      prev = (prev % n) + 1;
      semanas++;
    }
    await db.putAseo(a);
  }
  return { meses: aseos.length, semanas };
}

// Asegura que existan exactamente `n` grupos activos (numerados "Grupo i" o "i").
async function ensureGroupCountGlobal(n) {
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

  const buildRows = (list) => list.map(m => {
    const canGive = m.canGiveButNot.length
      ? m.canGiveButNot.map(labelOfLabore).join(', ')
      : '<span class="text-on-surface-variant/60">—</span>';
    return `<tr class="hover:bg-surface-container-low transition-colors" data-norm="${escapeAttr(normalizeStr(m.name))}">
      <td class="p-4 font-body-md text-body-md font-medium text-on-surface flex items-center gap-3 sticky left-0 bg-surface-container-lowest group-hover:bg-surface-container-low transition-colors z-10">
        ${avatarHtml(m, 'w-8 h-8')}
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
          <th data-sort="name" class="p-4 font-label-md text-label-md text-on-surface-variant sticky left-0 top-0 bg-surface-container z-30 min-w-[200px] cursor-pointer hover:text-primary">Miembro ⤥</th>
          <th data-sort="lastMonth" class="p-4 font-label-md text-label-md text-on-surface-variant text-center whitespace-nowrap cursor-pointer hover:text-primary" title="Cantidad de asignaciones en los últimos 30 días">Último mes ⤥</th>
          <th data-sort="perMonth" class="p-4 font-label-md text-label-md text-on-surface-variant text-center whitespace-nowrap cursor-pointer hover:text-primary" title="Promedio de asignaciones por mes">Promedio / mes ⤥</th>
          <th data-sort="total" class="p-4 font-label-md text-label-md text-on-surface-variant text-center whitespace-nowrap cursor-pointer hover:text-primary" title="Total de asignaciones registradas">Total ⤥</th>
          <th class="p-4 font-label-md text-label-md text-on-surface-variant text-left" title="Labores que puede dar (las tiene) pero aún no le han tocado">Puede dar, no le ha tocado</th>
          <th data-sort="lastDate" class="p-4 font-label-md text-label-md text-on-surface-variant text-center whitespace-nowrap cursor-pointer hover:text-primary" title="Fecha de su última asignación (orden ascendente = hace más tiempo)">Última asignación ⤥</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant/50">${buildRows(metrics)}</tbody>
    </table>`;

  // Ordenamiento SOLO de visualización (transitorio): al recargar vuelve al
  // orden original (última asignación más antigua primero).
  pList.querySelectorAll('th[data-sort]').forEach(th => {
    th.onclick = () => {
      const key = th.dataset.sort;
      const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
      th.dataset.dir = dir;
      const sorted = metrics.slice().sort((a, b) => {
        if (key === 'name') return dir === 'asc' ? a.name.localeCompare(b.name, 'es') : b.name.localeCompare(a.name, 'es');
        const va = key === 'lastDate' ? (a[key] || '') : Number(a[key] || 0);
        const vb = key === 'lastDate' ? (b[key] || '') : Number(b[key] || 0);
        return dir === 'asc' ? (va > vb ? 1 : va < vb ? -1 : 0) : (va < vb ? 1 : va > vb ? -1 : 0);
      });
      pList.querySelector('tbody').innerHTML = buildRows(sorted);
    };
  });

  const search = $('#pSearch');
  if (search) search.addEventListener('input', () => {
    const q = normalizeStr(search.value);
    document.querySelectorAll('#pList tbody tr').forEach(tr => {
      tr.style.display = tr.dataset.norm.includes(q) ? '' : 'none';
    });
  });

  $('#manageLaboresBtn').onclick = renderLaboresModal;
  $('#addMemberBtn').onclick = openAddMemberModal;
  const assignGroupBtn2 = $('#assignGroupBtn');
  if (assignGroupBtn2) assignGroupBtn2.onclick = openGroupAssignmentModal;
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
      <div>
        <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Fecha de nacimiento</label>
        <input data-attr="nacimiento" type="date" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
      </div>
      <div>
        <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Fecha de bautismo</label>
        <input data-attr="bautismo" type="date" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
      </div>
    </div>
    <label class="flex items-center gap-2 text-left font-label-md text-label-md text-on-surface-variant cursor-pointer">
      <input data-attr="precursorRegular" type="checkbox" class="accent-primary"> Precursor regular
    </label>
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
  const nacimiento = (document.querySelector('[data-attr="nacimiento"]') || {}).value || '';
  const bautismo = (document.querySelector('[data-attr="bautismo"]') || {}).value || '';
  const precursorRegular = !!(document.querySelector('[data-attr="precursorRegular"]') || {}).checked;
  return { genero, calificacion, enlace, cargo, nacimiento, bautismo, precursorRegular };
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
  const userMode = isUserRole();
  p.labores = Array.isArray(p.labores) ? p.labores : [];
  const cal = CALIFICACIONES.includes(p.calificacion) ? p.calificacion : 'A';
  const genOpts = GENEROS.map(([v, l]) => `<option value="${v}" ${p.genero === v ? 'selected' : ''}>${l}</option>`).join('');
  const calOpts = CALIFICACIONES.map(c => `<option value="${c}" ${cal === c ? 'selected' : ''}>${c}${c === 'D' ? ' (enlace)' : ''}</option>`).join('');
  const enlOpts = `<option value="">— Sin enlace —</option>` +
    state.people.filter(x => String(x.id) !== String(p.id)).map(x => `<option value="${x.id}" ${p.enlace === String(x.id) ? 'selected' : ''}>${escapeHtml(x.name)}</option>`).join('');
   const laborCols = renderLaborColumns(p, !userMode);
  openModal(`
    <div>
      <div class="flex items-start gap-3 mb-4">
        ${avatarHtml(p, 'w-12 h-12')}
        <div class="flex-1 min-w-0">
           <input id="pfName" type="text" value="${escapeAttr(p.name)}" ${userMode ? 'readonly' : ''} class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2 font-headline-md text-headline-md text-primary focus:border-primary" autocomplete="off">
          <p class="text-on-surface-variant text-sm mt-1">${p.genero === 'femenino' ? 'Femenino' : p.genero === 'masculino' ? 'Masculino' : 'Colaborador'} · ${cargoOf(p).label} · Calificación ${cal}${p.enlace ? ' · Enlazado' : ''}</p>
        </div>
      </div>
      <div class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Género</label>
           <select id="pfGenero" ${userMode ? 'disabled' : ''} class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${genOpts}</select>
          </div>
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Calificación</label>
           <select id="pfCalif" ${userMode ? 'disabled' : ''} class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${calOpts}</select>
          </div>
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Cargo</label>
            <select id="pfCargo" ${userMode ? 'disabled' : ''} class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${cargosOpts(cargoOf(p).id)}</select>
          </div>
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Fecha de nacimiento</label>
            <input id="pfNacimiento" type="date" value="${escapeAttr(p.nacimiento || '')}" ${userMode ? 'readonly' : ''} class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          </div>
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Fecha de bautismo</label>
            <input id="pfBautismo" type="date" value="${escapeAttr(p.bautismo || '')}" ${userMode ? 'readonly' : ''} class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          </div>
          <label class="flex items-center gap-2 font-label-md text-label-md text-on-surface-variant cursor-pointer self-end pb-2">
            <input id="pfPrecursorRegular" type="checkbox" ${p.precursorRegular === true ? 'checked' : ''} ${userMode ? 'disabled' : ''} class="accent-primary"> Precursor regular
          </label>
        </div>
        <div>
          <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Enlace (pareja designada)</label>
           <select id="pfEnlace" ${userMode ? 'disabled' : ''} class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${enlOpts}</select>
          <p class="text-on-surface-variant text-caption mt-1">Si la calificación es D, solo podrá tener asignación en pareja con la persona enlazada (enlace unidireccional). En cualquier otro caso el enlace es mutuo: la persona enlazada también quedará enlazada a él.</p>
        </div>
        <div>
          <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Grupo</label>
           <select id="pfGrupo" ${userMode ? 'disabled' : ''} class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
            <option value="">Sin grupo</option>
            ${state.departments.map(d => `<option value="${d.id}" ${String(d.id) === String(p.grupoId || '') ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
          </select>
          <p class="text-on-surface-variant text-caption mt-1">Asigna la persona a un grupo (programa de aseo).</p>
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
         ${userMode ? '' : '<button id="pfSave" class="px-6 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Guardar</button>'}
      </div>
    </div>`);

  $('#pfHistory').innerHTML = await personHistoryMarkup(p.id);

  $('#pfLabores').querySelectorAll('.labor-chip').forEach(cb => cb.onclick = () => {
    if (cb.disabled) return;
    cb.classList.toggle('is-on');
  });

  $('#pfCancel').onclick = closeModal;
  const saveProfile = $('#pfSave');
  if (saveProfile) saveProfile.onclick = async () => {
    p.name = ($('#pfName').value || '').trim() || p.name;
    p.genero = $('#pfGenero').value;
    p.calificacion = $('#pfCalif').value;
    p.cargo = $('#pfCargo').value;
    p.cargos = [p.cargo];
    p.nacimiento = $('#pfNacimiento').value || '';
    p.bautismo = $('#pfBautismo').value || '';
    p.precursorRegular = $('#pfPrecursorRegular').checked === true;
    p.grupoId = $('#pfGrupo').value || '';
    p.labores = [...$('#pfLabores').querySelectorAll('.labor-chip.is-on')].map(c => c.dataset.plabore);
    await applyEnlace(p, $('#pfEnlace').value);
    const orig = state.people.find(x => String(x.id) === String(p.id));
    if (orig) Object.assign(orig, p);
    await db.updatePerson(p);
    state.people = await db.listPeople();
    closeModal();
    toast('Perfil actualizado', 'success');
    renderLists();
  };
}

// Vista especial para asignar grupos en lote: elige un grupo, marca participantes
// y asigna. Los asignados salen de la lista; cuando no queda nadie se ofrece
// "Volver a asignar" (reasigna desde cero con confirmación).
async function openGroupAssignmentModal() {
  let pool = state.people.filter(p => p.activo !== false && !String(p.grupoId || ''));
  const renderModal = () => {
    const total = state.people.filter(p => p.activo !== false).length;
    const asignados = total - pool.length;
    if (!pool.length) {
      openModal(`
        <div class="text-center py-4">
          <span class="material-symbols-outlined text-6xl text-tertiary mb-2 inline-block">group</span>
          <h3 class="font-headline-md text-headline-md text-primary mb-1">Asignación de grupos</h3>
          <p class="text-on-surface-variant text-sm mb-1">Todos los participantes están asignados a un grupo.</p>
          <p class="text-on-surface-variant text-sm mb-6">${asignados} de ${total} asignados.</p>
          <div class="flex gap-3 justify-center">
            <button id="gaClose" class="px-5 py-2.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container transition-colors">Cerrar</button>
            <button id="gaReset" class="px-5 py-2.5 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-colors">Volver a asignar</button>
          </div>
        </div>`);
      $('#gaClose').onclick = closeModal;
      $('#gaReset').onclick = async () => {
        if (!(await confirmDialog('¿Volver a asignar los grupos desde cero? Se quitarán los grupos actuales de todos los participantes y podrás asignarlos de nuevo.', 'Reasignar grupos'))) return;
        for (const p of state.people) {
          if (p.grupoId) { p.grupoId = ''; await db.updatePerson(p); }
        }
        state.people = await db.listPeople();
        pool = state.people.filter(x => x.activo !== false && !String(x.grupoId || ''));
        renderLists();
        renderModal();
      };
      return;
    }
    openModal(`
      <div>
        <div class="flex items-center justify-between gap-3 mb-3">
          <h3 class="font-headline-md text-headline-md text-primary">Asignar grupos</h3>
          <span class="text-sm text-on-surface-variant font-label-md">${pool.length} sin asignar · ${asignados} asignados</span>
        </div>
        <div class="mb-3">
          <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Grupo</label>
          <select id="gaGrupo" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
            <option value="">Elegir grupo</option>
            ${state.departments.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}
          </select>
        </div>
        <div class="max-h-[50vh] overflow-y-auto rounded-lg border border-outline-variant divide-y divide-outline-variant/40">
          ${pool.map(p => `
            <label class="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-surface-container">
              ${avatarHtml(p, 'w-9 h-9')}
              <span class="flex-1 font-body-md text-body-md text-on-surface truncate">${escapeHtml(p.name)}</span>
              <input type="checkbox" data-gapid="${p.id}" class="accent-primary w-4 h-4 shrink-0">
            </label>`).join('')}
        </div>
        <div class="flex flex-wrap gap-3 justify-between mt-4">
          <button id="gaAll" class="px-4 py-2 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container transition-colors">Marcar todos</button>
          <button id="gaAsign" class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-opacity">Asignar seleccionados</button>
        </div>
      </div>`);
    $('#gaAll').onclick = () => { document.querySelectorAll('#modalCard [data-gapid]').forEach(cb => cb.checked = true); };
    $('#gaAsign').onclick = async () => {
      const grupo = $('#gaGrupo').value;
      if (!grupo) { toast('Elige un grupo primero', 'error'); return; }
      const seleccionados = [...document.querySelectorAll('#modalCard [data-gapid]:checked')].map(cb => cb.dataset.gapid);
      if (!seleccionados.length) { toast('Marca al menos una persona', 'error'); return; }
      const btn = $('#gaAsign');
      btn.disabled = true;
      try {
        for (const id of seleccionados) {
          const person = state.people.find(x => String(x.id) === String(id));
          if (!person) continue;
          person.grupoId = grupo;
          await db.updatePerson(person);
        }
        state.people = await db.listPeople();
        pool = state.people.filter(x => x.activo !== false && !String(x.grupoId || ''));
        toast(`${seleccionados.length} asignado(s) al grupo`, 'success');
        renderLists();
        renderModal();
      } finally { btn.disabled = false; }
    };
  };
  renderModal();
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
    desc: 'Lista de participantes. Use la plantilla descargable (.xlsx con listas desplegables), complétela y súbala directamente.',
    pdfHint: 'Se extraen nombre, sexo, calificación, cargo y grupo de la plantilla .xlsx.',
  },
  {
    key: 'midweeks',
    title: 'Guía de Actividades',
    icon: 'auto_stories',
    desc: 'Programa de las reuniones de entre semana. Se acumulan las guías por fecha; las fechas ya cargadas se pueden reescribir.',
    pdfHint: 'Se extrae el programa de la guía (PDF o EPUB) y se añade semana a semana por su fecha.',
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
          <span class="flex items-center gap-1 text-caption text-on-surface-variant"><span class="material-symbols-outlined text-[16px]">info</span> Llene la plantilla (Nombre, Sexo, Calificación, Cargo, Grupo) y súbala .xlsx directamente aquí.</span>
        </div>` : ''}
      <div data-slot="pdf">
        <label for="upl-pdf-${t.key}" class="block w-full cursor-pointer border-2 border-dashed border-outline-variant rounded-lg p-5 text-center hover:border-primary hover:bg-primary-fixed/10 transition-colors">
          <span class="material-symbols-outlined text-4xl text-on-surface-variant block mx-auto mb-2">${t.key === 'midweeks' ? 'auto_stories' : t.key === 'people' ? 'table_view' : 'picture_as_pdf'}</span>
          <span class="font-label-md text-label-md text-primary">${t.key === 'midweeks' ? 'Seleccionar archivo PDF o EPUB' : t.key === 'people' ? 'Seleccionar archivo XLSX' : 'Seleccionar archivo PDF'}</span>
          <span class="block text-caption text-on-surface-variant mt-1">${t.pdfHint}</span>
        </label>
        <input id="upl-pdf-${t.key}" type="file" accept="${t.key === 'midweeks' ? '.pdf,application/pdf,.epub,application/epub+zip' : t.key === 'people' ? '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : '.pdf,application/pdf'}" class="hidden" data-upload-pdf="${t.key}">
      </div>
      <p id="upl-status-${t.key}" class="mt-3 font-label-md text-label-md text-on-surface-variant hidden"></p>
    </div>
  `).join('');

  app.innerHTML = `
    <div class="mb-10">
      <h1 class="font-display-lg text-display-lg text-primary mb-2">Carga de Archivos</h1>
      <p class="font-body-lg text-body-lg text-on-surface-variant">Suba un archivo PDF (o EPUB para la Guía de Actividades) y la app extraerá la información para revisar antes de guardarla.</p>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-gutter">${cards}</div>
    <div id="uploadSummary" class="mt-8"></div>
  `;

  app.querySelector('[data-dl-template]').onclick = downloadPeopleTemplate;

  // Carga de archivo → valida el tipo y pide confirmación antes de guardar.
  app.querySelectorAll('input[data-upload-pdf]').forEach(input => {
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const type = input.dataset.uploadPdf;
      const status = $(`#upl-status-${type}`);
      const isEpub = /\.epub$/i.test(file.name) || file.type === 'application/epub+zip';
      const isXlsx = /\.xlsx$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      showStatus(status, isEpub ? `Extrayendo ${file.name} (EPUB)…` : isXlsx ? `Extrayendo ${file.name} (XLSX)…` : `Extrayendo ${file.name} con pdf.js…`, 'text-on-surface-variant');
      try {
        // Personas desde plantilla .xlsx (nombre, sexo, calificación, cargo, grupo).
        if (type === 'people' && isXlsx) {
          const buffer = await file.arrayBuffer();
          const rows = await parsePeopleXlsx(buffer);
          const { personas, warnings } = personasFromXlsx(rows);
          if (!personas.length) {
            const cab = (rows[0] || []).filter(Boolean).join(', ') || '(vacío)';
            showStatus(status, `No se encontraron filas con nombre en la plantilla. Cabeceras detectadas: ${cab}. Revisa que hayas usado la plantilla descargada.`, 'text-error');
            return;
          }
          let msg = `Se detectaron ${personas.length} personas. ¿Guardar y reemplazar la lista de participantes?`;
          if (warnings && warnings.length) msg += '\n\nAvisos:\n• ' + warnings.slice(0, 8).join('\n• ');
          const ok = await confirmDialog(msg, 'Guardar');
          if (!ok) { showStatus(status, 'Carga cancelada', 'text-on-surface-variant'); return; }
          await db.replaceAllPeople(personas);
          await refreshCatalogs();
          showStatus(status, '✓ Datos guardados.', 'text-tertiary-fixed');
          renderUploadSummary();
          toast('Datos guardados', 'success');
          return;
        }

        let text;
        if (isEpub) {
          const buffer = await file.arrayBuffer();
          text = normalizeMidweekHeaders(await extractEpubText(buffer));
        } else {
          text = await extractPdfText(file);
        }

        if (type === 'midweeks') {
          const summary = midweekGuideSummary(text);
          if (!summary) {
            showStatus(status, 'Este archivo no se reconoce como una Guía de Actividades. Se esperan los títulos "Tesoros de la Biblia", "Seamos Mejores Maestros" y "Nuestra Vida Cristiana", o cabeceras de semanas "D-D DE MES".', 'text-error');
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

// Descarga la plantilla de participantes (.xlsx con listas desplegables).
// Columnas: Nombre, Sexo, Calificación, Cargo y Grupo.
async function downloadPeopleTemplate() {
  try {
    const buffer = await generatePeopleTemplate();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, 'plantilla-participantes.xlsx');
    toast('Plantilla descargada (xlsx con listas desplegables)', 'success');
  } catch (e) {
    toast('Error al generar la plantilla: ' + e.message, 'error');
  }
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
        ${avatarHtml(p, 'w-8 h-8')}
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
  const usuarios = isSupabaseConfigured() ? (await obtenerUsuarios()) : [];
  const userGroupsHtml = usuarios.filter(u => u.rol === 'user').map(u => {
    const sel = Array.isArray(u.grupos) ? u.grupos.map(String) : [];
    const checks = state.departments.map(d => `<label class="flex items-center gap-2 text-sm"><input type="checkbox" data-ug="${escapeAttr(u.id)}" value="${escapeAttr(String(d.id))}" ${sel.includes(String(d.id)) ? 'checked' : ''} class="accent-primary">${escapeHtml(d.name)}</label>`).join('');
    return `<div class="border border-outline-variant rounded-lg p-3"><div class="font-label-md text-label-md mb-2">${escapeHtml(u.email || u.id)}</div><div class="flex flex-wrap gap-3">${checks || '<span class="text-on-surface-variant text-sm">Sin grupos.</span>'}</div></div>`;
  }).join('') || '<p class="text-on-surface-variant text-sm">No hay usuarios con rol «user».</p>';
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

      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 space-y-6" data-admin>
        <div>
          <h3 class="font-headline-md text-headline-md text-primary mb-1">Acceso de usuarios</h3>
          <p class="text-on-surface-variant text-sm">Lista de correos autorizados para iniciar sesión (con correo/contraseña). Solo los correos que aparecen aquí pueden entrar y ver los datos. Un correo por línea; cada usuario mantiene su propio rol.</p>
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

      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 space-y-6" data-admin>
        <div>
          <h3 class="font-headline-md text-headline-md text-primary mb-1">Asignación de grupos a usuarios</h3>
          <p class="text-on-surface-variant text-sm">Los usuarios con rol <b>user</b> solo ven el resumen de los grupos que les asignes. Marca los grupos de cada usuario.</p>
        </div>
        <div id="userGroupsBox" class="space-y-4">${userGroupsHtml}</div>
        <div class="flex gap-3 pt-2">
          <button id="userGroupsSave" class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Guardar asignación</button>
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
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Ciudad</label>
            <input id="setCiudad" type="text" value="${escapeAttr(config.ciudad || '')}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          </div>
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Provincia o estado</label>
            <input id="setProvincia" type="text" value="${escapeAttr(config.provincia || '')}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          </div>
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Número de congregación</label>
            <input id="setNum" type="text" value="${escapeAttr(config.congregacionNumero || '')}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          </div>
        </div>
        <button id="setSave" class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Guardar</button>

        <div class="border-t border-outline-variant pt-6">
          <h3 class="font-headline-md text-headline-md text-primary mb-2">Mantenimiento de datos</h3>
          <p class="text-on-surface-variant text-sm mb-3">Los datos viven en Supabase y se sincronizan automáticamente. Las acciones destructivas requieren tu contraseña de admin.</p>
          <div class="flex flex-col sm:flex-row gap-3 flex-wrap">
            <button id="setBorrarPersonas" data-admin class="px-4 py-2 rounded-lg border border-error text-error font-label-md text-label-md hover:bg-error-container">Borrar personas</button>
            <button id="setBorrarProgramas" data-admin class="px-4 py-2 rounded-lg border border-error text-error font-label-md text-label-md hover:bg-error-container">Borrar programas</button>
            <button id="setBorrarReuniones" data-admin class="px-4 py-2 rounded-lg border border-error text-error font-label-md text-label-md hover:bg-error-container">Borrar reuniones</button>
            <button id="setResetFabrica" data-admin class="px-4 py-2 rounded-lg border border-error text-error font-label-md text-label-md hover:bg-error-container">Restaurar valores de fábrica</button>
          </div>
          <p id="setSyncStatus" class="text-on-surface-variant text-caption mt-2"></p>
          <p class="text-on-surface-variant text-caption mt-1">"Borrar personas" elimina solo la lista de participantes. "Borrar programas" elimina los programas mensuales (fin de semana, salidas, acomodación y su historial). "Borrar reuniones" elimina las reuniones de entre semana. "Restaurar valores de fábrica" borra todo (conservando tu cuenta de admin).</p>
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
    };
    await db.setConfig(cfg);
    state.config = cfg;
    toast('Configuración guardada', 'success');
  };

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

  // ---- Asignación de grupos a usuarios (rol user) ----
  const ugSave = $('#userGroupsSave');
  if (ugSave) ugSave.onclick = async () => {
    const updates = {};
    document.querySelectorAll('[data-ug]').forEach(cb => {
      const uid = cb.dataset.ug;
      (updates[uid] ||= new Set());
      if (cb.checked) updates[uid].add(cb.value);
    });
    for (const uid of Object.keys(updates)) {
      const doc = usuarios.find(u => String(u.id) === String(uid)) || {};
      await guardarUsuario(uid, { email: doc.email, rol: doc.rol || 'user', grupos: [...updates[uid]] });
    }
    toast('Asignación de grupos guardada', 'success');
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

  $('#setSave').onclick = async () => {
    await db.setSetting('congregation', $('#setCong').value.trim());
    const cfg = await db.getConfig();
    cfg.ciudad = $('#setCiudad').value.trim();
    cfg.provincia = $('#setProvincia').value.trim();
    cfg.congregacionNumero = $('#setNum').value.trim();
    await db.setConfig(cfg);
    state.config = cfg;
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

  // Borrar solo PERSONAS (conserva programas, grupos, discursos y config).
  $('#setBorrarPersonas').onclick = async () => {
    if (!await confirmarAdmin()) return;
    if (!await confirmDialog('Se borrarán en Supabase y en el dispositivo TODOS los participantes. Los grupos, programas, discursos y configuración se conservan. ¿Continuar?', 'Borrar personas')) return;
    const btn = $('#setBorrarPersonas');
    btn.disabled = true;
    try {
      const borrados = await borrarSoloParticipantes();
      await db.borrarSoloParticipantesLocal();
      await refreshCatalogs();
      toast(`Personas borradas · ${borrados} documentos en Supabase`, 'success');
    } catch (err) {
      toast('Error al borrar personas: ' + (err.message || err), 'error');
    } finally {
      btn.disabled = false;
    }
  };

  // Borrar solo PROGRAMAS (mensuales, salidas, acomodación y su historial).
  $('#setBorrarProgramas').onclick = async () => {
    if (!await confirmarAdmin()) return;
    if (!await confirmDialog('Se borrarán en Supabase y en el dispositivo los PROGRAMAS MENSUALES (fin de semana, salidas, acomodación/aseo y su historial de asignaciones). Los PARTICIPANTES, grupos, reuniones de entre semana y configuración se conservan, para poder generar los programas de nuevo desde cero. ¿Continuar?', 'Borrar programas')) return;
    const btn = $('#setBorrarProgramas');
    btn.disabled = true;
    btn.textContent = 'Borrando…';
    try {
      const borrados = await borrarSoloProgramas();
      await db.borrarSoloProgramasLocal();
      await refreshCatalogs();
      toast(`Programas borrados · ${borrados} documentos en Supabase`, 'success');
    } catch (err) {
      toast('Error al borrar programas: ' + (err.message || err), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Borrar programas';
    }
  };

  // Borrar solo REUNIONES de entre semana.
  $('#setBorrarReuniones').onclick = async () => {
    if (!await confirmarAdmin()) return;
    if (!await confirmDialog('Se borrarán en Supabase y en el dispositivo las REUNIONES DE ENTRE SEMANA (la Guía de Actividades cargada). Los participantes, grupos, programas mensuales y configuración se conservan. ¿Continuar?', 'Borrar reuniones')) return;
    const btn = $('#setBorrarReuniones');
    btn.disabled = true;
    btn.textContent = 'Borrando…';
    try {
      const borrados = await borrarSoloReuniones();
      await db.borrarSoloReunionesLocal();
      await refreshCatalogs();
      toast(`Reuniones borradas · ${borrados} documentos en Supabase`, 'success');
    } catch (err) {
      toast('Error al borrar reuniones: ' + (err.message || err), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Borrar reuniones';
    }
  };

  // Restaurar valores de fábrica: borra todo menos la cuenta admin.
  $('#setResetFabrica').onclick = async () => {
    if (!await confirmarAdmin()) return;
    if (!await confirmDialog('Se borrarán TODOS los registros (personas, grupos, reuniones, programas, asignaciones, configuración) en Supabase y en el dispositivo. Las colecciones quedarán vacías y se conservará tu cuenta de admin. Esta acción NO se puede deshacer. ¿Continuar?', 'Restaurar valores de fábrica')) return;
    const btn = $('#setResetFabrica');
    btn.disabled = true;
    btn.textContent = 'Restaurando…';
    try {
      const uid = currentUser() && currentUser().uid;
      const borrados = await limpiarTodasLasColecciones(uid);
      await db.limpiarIndexedDBLocal();
      await refreshCatalogs();
      toast(`Valores de fábrica restaurados · ${borrados} documentos en Supabase`, 'success');
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
      'inactivo': ['text-on-surface-variant', 'Sincronización inactiva (Supabase no configurado)'],
      'conectado': ['text-tertiary', 'Sincronización con Supabase activa'],
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
  const atencionLabores = { sonido: ['audio', 'sonido'], microfono: ['microf'], plataforma: ['plataforma'], acomodacion: ['acomodador'] };
  const atencionOpts = (week, curVal, collector, key) => {
    const req = atencionLabores[key] || [];
    const curId = asStr(curVal);
    const pred = (p) => atencionPred(p) && (req.length === 0 || (Array.isArray(p.labores) && p.labores.some(r => req.includes(r))));
    const list = eligiblePeople(week, state.people, pred, asId(curVal), collector);
    if (curId && !list.some(p => String(p.id) === curId)) {
      const cur = state.people.find(p => String(p.id) === curId);
      if (cur) list.push(cur);
    }
    return `<option value="">— Sin asignar —</option>` +
      list.map(p => `<option value="${p.id}" ${String(p.id) === curId ? 'selected' : ''}>${escapeHtml(invertName(p.name))}</option>`).join('');
  };

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
            <select data-atencion-wi="${fin.wi}" data-atencion-key="${key}" data-atencion-si="${si}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-1.5 text-sm font-body-md focus:border-primary">${atencionOpts(fin.w, curVal, null, key)}</select>
            <span class="text-[9px] uppercase text-on-surface-variant/70 tracking-wider">FS</span>
          </div>`);
        } else if (curVal) {
          bits.push(`<div class="text-sm font-semibold text-on-surface">${escapeHtml(personNameOf(curVal))} <span class="text-[9px] uppercase text-on-surface-variant">FS</span></div>`);
        }
        if (mw) {
          bits.push(`<div class="flex flex-col gap-0.5">
            <select data-mwatencion-key="${key}" data-mwatencion-si="${si}" data-mwatencion-id="${mw.id}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-1.5 text-sm font-body-md focus:border-primary">${atencionOpts(mw, mwName, collectMidweekPersons, key)}</select>
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
        const cells = columns.map(c => `<td class="p-4 text-center font-body-md text-body-md align-top" data-label="Sem. ${c.i + 1}">${c.cell(d.key, si)}</td>`).join('');
        rows.push(`<tr class="border-b border-outline-variant/40">
          <td class="p-4 font-body-md text-body-md text-on-surface whitespace-nowrap" data-label="Labor">${escapeHtml(d.label)}${d.count > 1 ? ` ${si + 1}` : ''}</td>
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

    const toolbar = `
      <div class="flex flex-wrap items-center gap-2 mb-4 no-print">
        <button id="labPrint" class="flex items-center gap-2 px-4 py-2 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-all active:scale-95">
          <span class="material-symbols-outlined text-[20px]">print</span> Imprimir
        </button>
        <button id="labPdf" class="flex items-center gap-2 px-4 py-2 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-all active:scale-95">
          <span class="material-symbols-outlined text-[20px]">picture_as_pdf</span> Exportar PDF
        </button>
        <button id="labImg" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-all active:scale-95">
          <span class="material-symbols-outlined text-[20px]">image</span> Guardar Imagen
        </button>
        <button id="labWa" class="flex items-center gap-2 px-4 py-2 rounded-lg border border-secondary text-secondary font-label-md text-label-md hover:bg-secondary-fixed transition-all active:scale-95">
          <span class="material-symbols-outlined text-[20px]">share</span> WhatsApp
        </button>
      </div>`;

    root.innerHTML = `
      <div class="${embed ? 'mb-0' : 'mb-8'}">
        ${title}
        ${toolbar}
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
          : `<div class="responsive-table bg-surface-container-lowest rounded-xl border border-outline-variant p-6 md:p-8 overflow-x-auto">
              <table class="w-full text-left border-collapse min-w-[640px]">${thead}<tbody>${rows.join('')}</tbody></table>
            </div>`}
    `;

    const monthSel = $('#labMonth');
    if (monthSel) monthSel.onchange = (e) => go('atencion', { monthId: e.target.value });
    const createBtn = root.querySelector('#laboresCreate');
    if (createBtn) createBtn.onclick = createProgram;
    const bindBtn2 = (id, fn) => { const bEl = root.querySelector('#' + id); if (bEl) bEl.onclick = fn; };
    bindBtn2('labPrint', () => window.print());
    bindBtn2('labPdf', () => window.print());
    bindBtn2('labImg', () => imageAtencion(cur));
    bindBtn2('labWa', () => waAtencion(cur));
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
        const next = val ? slotOf(val) : '';
        if (Array.isArray(week.labores[key])) week.labores[key][si] = next;
        else week.labores[key] = next;
        await db.putAtencion(program);
        await syncAssignmentLog();
        await subirStores(['atencion']);
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
        const next = val ? slotOf(val) : '';
        if (Array.isArray(week.labores[key])) week.labores[key][si] = next;
        else week.labores[key] = next;
        await db.putMidweek(week);
        state.midweeks = await db.listMidweeks();
        await syncAssignmentLog();
        await subirStores(['midweeks']);
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

  const n = Math.max(state.departments.length, 1);
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
      // Compatibilidad: algunos datos solo traen `saturday`; se deriva lunes/domingo.
      const monday = w.monday || addDays(w.saturday, -5);
      const sunday = w.sunday || addDays(w.saturday, 1);
      const range = `${shortDate(monday)} – ${shortDate(sunday)}`;
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
  // Normalización: los programas antiguos pueden no traer congregaciones.
  if (program && !Array.isArray(program.congregations)) program.congregations = [];
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
      const rows = (w.outings || []).map((o, j) => outingRow(o, i, j)).join('');
      const sinSalida = w.sinSalida === true;
      return `<section class="bg-surface-container-lowest rounded-xl border border-outline-variant p-5 md:p-6">
        <div class="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div class="flex items-center gap-3 flex-wrap">
            <h3 class="font-headline-md text-headline-md text-primary">Semana ${i + 1}</h3>
            <span class="px-3 py-1 bg-secondary-container text-on-secondary-container font-label-md text-label-md rounded-full">${escapeHtml(dateStr)}</span>
            ${sinSalida ? `<span class="px-3 py-1 bg-tertiary-container text-on-tertiary-container font-label-md text-label-md rounded-full">Sin salida esta semana</span>` : ''}
          </div>
          <label class="flex items-center gap-2 cursor-pointer select-none" title="Marcar esta semana como sin salida a congregación">
            <input type="checkbox" data-sinsalida="${i}" ${sinSalida ? 'checked' : ''} class="accent-primary w-4 h-4">
            <span class="font-label-md text-label-md text-on-surface-variant">Sin salida</span>
          </label>
        </div>
        ${sinSalida
          ? `<div class="rounded-lg bg-surface-variant/40 border border-dashed border-outline-variant p-4 text-sm text-on-surface-variant">No hay salida a congregación esta semana.</div>`
          : `<div class="grid grid-cols-1 gap-4" data-outing-list="${i}">${rows}</div>
             <div class="mt-4 flex justify-end">
               <button data-outing-add="${i}" class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary text-on-secondary font-label-md text-label-md hover:bg-secondary-container transition-colors">
                 <span class="material-symbols-outlined text-[18px]">person_add</span> Agregar orador
               </button>
             </div>`}
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
        : `<section id="salidasCong" class="bg-surface-container-lowest rounded-xl border border-outline-variant p-5 md:p-6 mb-6">
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
    if (addCong) addCong.onclick = () => {
      program.congregations = program.congregations || [];
      program.congregations.push(newCongregation());
      render();
      // Enfocar el campo de nombre de la congregación recién agregada para
      // escribir directamente.
      requestAnimationFrame(() => {
        const inputs = congWrap.querySelectorAll('input[data-cong-field="nombre"]');
        const ultimo = inputs[inputs.length - 1];
        if (ultimo) { ultimo.focus(); ultimo.select(); }
      });
    };

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
    list.querySelectorAll('[data-sinsalida]').forEach(cb => cb.onchange = () => {
      const wi = parseInt(cb.dataset.sinsalida, 10);
      program.weeks[wi].sinSalida = cb.checked === true;
      render();
    });

    const programBtn = embed ? embed.querySelector('#salidasProgram') : $('#salidasProgram');
    if (programBtn) programBtn.onclick = () => go('outings', { monthId: cur });
    const saveBtn = embed ? embed.querySelector('#salidasSave') : $('#salidasSave');
    if (saveBtn) saveBtn.onclick = async () => {
      const stored = await db.getSalidas(cur);
      const changed = changedManualKeys({ salidas: stored ? [stored] : [] }, { salidas: [program] });
      const wrapped = wrapManualPrograms({ salidas: [program] }, changed).salidas[0];
      wrapped.updatedAt = Date.now();
      await db.putSalidas(wrapped);
      program = wrapped;
      await syncAssignmentLog();
      await subirStores(['salidas']);
      toast('Salidas guardadas', 'success');
    };
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

  const boxes = [];
  const weekDatas = sundays.map((sunday, i) => {
    const fin = finBySunday.get(sunday) || null;
    const mw = mwBySunday.get(sunday) || null;
    const aseoWeek = aseoBySunday.get(sunday) || null;
    const salidasWeek = salidasBySunday.get(sunday) || null;
    const laboresWeek = laboresBySunday.get(sunday) || null;
    const saturday = fin ? fin.date : (aseoWeek ? aseoWeek.saturday : (laboresWeek ? laboresWeek.saturday : (salidasWeek ? salidasWeek.saturday : null)));
    const data = {
      fin,
      mw,
      i,
      aseoGroup: aseoWeek && aseoWeek.group ? aseoWeek.group : null,
      outings: salidasWeek ? (salidasWeek.outings || []) : null,
      sinSalida: salidasWeek ? salidasWeek.sinSalida === true : false,
      finLabores: laboresWeek || null,
      sunday,
      saturday,
    };
    boxes.push(generalWeekBox(data));
    return data;
  });

  const title = embed ? '' : `
    <h1 class="font-headline-lg text-headline-lg text-primary mb-2">Vista Mensual General</h1>
    <p class="font-body-lg text-body-lg text-on-surface-variant mb-4">Todas las reuniones del mes, semana por semana.</p>`;

  const conflictsBar = `
    <div class="flex justify-end mb-4 no-print">
      <button id="genConflictsBtn" data-admin class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-error text-error font-label-md text-label-md hover:bg-error-container transition-colors">
        <span class="material-symbols-outlined text-[18px]">warning</span> Conflictos mensuales
      </button>
    </div>`;

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
    ${conflictsBar}
    ${boxes.length
      ? `<div class="space-y-6">${boxes.join('')}</div>`
      : `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-10 text-center">
          <span class="material-symbols-outlined text-primary text-5xl mb-3 inline-block">calendar_month</span>
          <p class="text-on-surface-variant font-body-lg">No hay programas ni reuniones de entre semana cargados para este mes.</p>
        </div>`}
  `;
  const monthSel = $('#generalMonth');
  if (monthSel) monthSel.onchange = (e) => go('general', { monthId: e.target.value });
  const genConflicts = $('#genConflictsBtn');
  if (genConflicts) genConflicts.onclick = () => go('conflictos', { monthId: cur });
  // Imagen por semana (SVG puro → PNG; comparte o descarga).
  root.querySelectorAll('[data-week-img]').forEach(btn => {
    btn.onclick = async () => {
      const idx = parseInt(btn.dataset.weekImg, 10);
      btn.disabled = true;
      try {
        const blob = await svgToPngBlob(generalWeekExportSvg(weekDatas[idx], cur));
        const compartido = await compartirPng(blob, `semana-${cur}-${idx + 1}.png`);
        if (!compartido) toast('Imagen descargada: adjúntala en WhatsApp.', 'success');
      } catch (err) { console.error(err); toast('No se pudo generar la imagen.', 'error'); }
      finally { btn.disabled = false; }
    };
  });
}

// Cuadro de una semana en la vista mensual general.
function generalWeekBox({ fin, mw, i, aseoGroup, outings, sinSalida, finLabores, sunday, saturday, dashboard = false }) {
  const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
  const header = mw ? mw.header : (fin ? fmt(fin.date) : (saturday ? fmt(saturday) : (sunday ? fmt(sunday) : '')));
  return `
  <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-5 md:p-6">
    <div class="flex items-center justify-between gap-3 flex-wrap mb-4">
      <h3 class="font-headline-md text-headline-md text-primary">${dashboard ? (homeWeekOffset === 0 ? 'Semana actual' : 'Semana siguiente') : `Semana ${i + 1}`}</h3>
      <div class="flex items-center gap-2 flex-wrap">
        ${dashboard ? `<button data-home-week-prev class="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-outline-variant text-primary hover:bg-primary-fixed disabled:opacity-40 disabled:cursor-not-allowed" title="Semana anterior" ${homeWeekOffset === 0 ? 'disabled' : ''}><span class="material-symbols-outlined">chevron_left</span></button>` : ''}
        <span class="px-3 py-1 bg-secondary-container text-on-secondary-container font-label-md text-label-md rounded-full">${escapeHtml(header)}</span>
        ${dashboard ? `<button data-home-week-next class="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-outline-variant text-primary hover:bg-primary-fixed" title="Semana siguiente"><span class="material-symbols-outlined">chevron_right</span></button>${isUserRole() ? `<button data-home-week-img class="no-print inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-all active:scale-95" title="Descargar imagen de esta semana"><span class="material-symbols-outlined text-[16px]">image</span> Imagen</button>` : ''}` : `<button data-week-img="${i}" class="no-print inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-all active:scale-95" title="Enviar imagen de esta semana">
          <span class="material-symbols-outlined text-[16px]">image</span> Imagen
        </button>`}
      </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="rounded-lg border border-outline-variant p-4 bg-indigo-50/50">
        <p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-3 flex items-center gap-2">
          <span class="material-symbols-outlined text-[18px]">auto_stories</span> Entre Semana
        </p>
        ${mw ? generalEsContent(mw) : '<p class="text-sm text-on-surface-variant">Sin reunión de entre semana.</p>'}
      </div>
      <div class="rounded-lg border border-outline-variant p-4 bg-amber-50/50">
        <p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-3 flex items-center gap-2">
          <span class="material-symbols-outlined text-[18px]">record_voice_over</span> Fin de Semana
        </p>
        ${fin ? generalFsContent(fin, outings, sinSalida) : '<p class="text-sm text-on-surface-variant">Sin programa de fin de semana.</p>'}
      </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      <div class="rounded-lg border border-outline-variant p-4 bg-emerald-50/50">${generalLabores({ fin, mw, finLabores })}</div>
      <div class="rounded-lg border border-outline-variant p-4 bg-violet-50/50 flex flex-col justify-center">${generalGroup(fin, aseoGroup, dashboard)}</div>
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
      <div class="text-sm text-on-surface font-semibold mt-0.5">Presidente: <span class="font-bold">${escapeHtml(personNameOf(w.presidente))}</span></div>
      <div class="text-[11px] text-on-surface-variant mt-1">♪ ${escapeHtml(introSong || '—')} · ${escapeHtml(w.introTitle || '')} (${w.introMins || 1} min.)</div>
    </div>
    ${section((w.sections || []).find(s => s.id === 'tesoros'))}
    ${section((w.sections || []).find(s => s.id === 'maestros'))}
    ${section((w.sections || []).find(s => s.id === 'vida'))}
    <div class="text-[11px] text-on-surface-variant border-t border-outline-variant/30 pt-1 mt-1">${escapeHtml(w.closingTitle || 'Palabras de conclusión')} (${w.closingMins || 3} mins.) · ♪ ${escapeHtml(w.songOut || '—')}</div>
    <div class="text-[11px] text-on-surface-variant mt-0.5">Oración final: <span class="font-semibold text-on-surface">${escapeHtml(mwConductorEstudio(w) || 'el conductor del Estudio Bíblico')}</span></div>`;
}

// Reunión de fin de semana compacta para el cuadro semanal.
function generalFsContent(w, outings, sinSalida) {
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
    if (sinSalida) {
      rows.push(['Salida', 'Sin salida esta semana']);
    } else {
      const salidas = outings != null ? outings : (w.outings || []);
      salidas.forEach((o, j) => rows.push([`Salida ${j + 1}`, personNameOf(o.oradorSalida)]));
    }
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
function generalGroup(fin, aseoGroup, dashboard = false) {
  const grupoId = aseoGroup || (fin && fin.departamento) || '';
  const num = aseoWeekGroupNum({ group: grupoId });
  const grupo = num != null ? (dashboard ? `Grupo ${num}` : String(num)) : (grupoId ? deptNameOf(grupoId) : '—');
  const desc = state.config?.groups?.labores || '';
  return `
    <div class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-3 flex items-center gap-2">
      <span class="material-symbols-outlined text-[18px]">handshake</span> ${dashboard ? 'Hospitalidad y aseo' : 'Grupo de la semana'}
    </div>
    <div class="text-center">
      <div class="font-headline-lg text-[40px] leading-none text-primary">${escapeHtml(grupo)}</div>
      ${desc ? `<p class="text-xs text-on-surface-variant mt-2">${escapeHtml(desc)}</p>` : ''}
    </div>`;
}

/* ---------- Exportación de una semana (vista general) en SVG puro ---------- */
function generalWeekExportSvg(data, cur, opts = {}) {
  const { fin, mw, i, aseoGroup, outings, sinSalida, finLabores } = data;
  const mobile = opts.mobile === true;
  const W = mobile ? 720 : 900, PAD = 40, cw = W - PAD * 2;
  const C = { title: '#3f3a2e', sub: '#6b6454', line: '#e7e3db', name: '#2f2a20' };
  const mesTxt = `${MONTHS_ES[Number(cur.slice(5)) - 1].toUpperCase()} ${cur.slice(0, 4)}`;
  const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
  const header = mw ? mw.header : (fin ? fmt(fin.date) : (data.saturday ? fmt(data.saturday) : (data.sunday ? fmt(data.sunday) : '')));

  const rows = [];

  const esLines = [];
  esLines.push({ t: `Lectura: ${mw ? (mw.reading || '—') : '—'}`, s: 14, w: 400, f: C.sub });
  esLines.push({ t: `Presidente: ${personNameOf(mw ? mw.presidente : null)}`, s: 16, w: 700, f: C.name });
  (mw ? (mw.sections || []) : []).forEach(sec => (sec.parts || []).forEach(p => {
    const nm = mwSlotsFor(sec, p).map(s => { const v = (p.assignments || {})[s.key]; return v ? personNameOf(v) : null; }).filter(Boolean).join(' · ');
    esLines.push({ t: `${p.num}. ${p.title} (${p.mins})${nm ? ' — ' + nm : ''}`, s: 13, w: 400, f: C.name });
  }));
  if (mw) {
    esLines.push({ t: `${mw.closingTitle || 'Palabras de conclusión'} (${mw.closingMins || 3} mins.) · ♪ ${mw.songOut || '—'}`, s: 13, w: 400, f: C.sub });
    esLines.push({ t: `Oración final: ${mwConductorEstudio(mw) || 'el conductor del Estudio Bíblico'}`, s: 13, w: 600, f: C.name });
  }
  rows.push({ label: 'ENTRE SEMANA', fill: '#eef2ff', lines: esLines });

  const fsLines = [];
  if (fin && fin.type === 'assembly') fsLines.push({ t: 'Asamblea · sin reunión local', s: 14, w: 400, f: C.sub });
  else if (fin) {
    if (fin.type === 'normal') {
      fsLines.push({ t: `Presidente: ${personNameOf(fin.presidente)}`, s: 14, w: 400, f: C.name });
      fsLines.push({ t: `Discurso: ${fin.tituloDiscurso || '—'}`, s: 14, w: 400, f: C.name });
      fsLines.push({ t: `Orador: ${fin.orador || '—'}`, s: 14, w: 400, f: C.name });
      fsLines.push({ t: `Conductor: ${personNameOf(fin.conductor)}`, s: 14, w: 400, f: C.name });
      fsLines.push({ t: `Lector: ${personNameOf(fin.lector)}`, s: 14, w: 400, f: C.name });
      if (sinSalida) fsLines.push({ t: 'Salida: Sin salida esta semana', s: 14, w: 400, f: C.sub });
      else { const sals = outings != null ? outings : (fin.outings || []); sals.forEach((o, j) => fsLines.push({ t: `Salida ${j + 1}: ${personNameOf(o.oradorSalida)}`, s: 14, w: 400, f: C.name })); }
    } else if (fin.type === 'supervisor') {
      fsLines.push({ t: `Presidente: ${personNameOf(fin.presidente)}`, s: 14, w: 400, f: C.name });
      fsLines.push({ t: `Superintendente: ${fin.nombreSupervisor || '—'}`, s: 14, w: 400, f: C.name });
      fsLines.push({ t: `Discurso público: ${fin.discursoSupervisor1 || '—'}`, s: 14, w: 400, f: C.name });
      fsLines.push({ t: `Estudio: ${personNameOf(fin.estudioSinLectura)}`, s: 14, w: 400, f: C.name });
      fsLines.push({ t: `Discurso de servicio: ${fin.discursoSupervisor2 || '—'}`, s: 14, w: 400, f: C.name });
    } else {
      fsLines.push({ t: `Discurso: ${fin.tituloDiscurso || '—'}`, s: 14, w: 400, f: C.name });
      fsLines.push({ t: `Presidente: ${personNameOf(fin.presidente)}`, s: 14, w: 400, f: C.name });
      fsLines.push({ t: `Orador: ${fin.orador || '—'}`, s: 14, w: 400, f: C.name });
    }
  }
  rows.push({ label: 'FIN DE SEMANA', fill: '#fffbeb', lines: fsLines });

  const labLines = [];
  const slotN = (week, key, si) => { const l = ensureAtencion(week).labores; return (Array.isArray(l[key]) ? l[key][si] : (si === 0 ? l[key] : '')) || ''; };
  const fsWeek = finLabores || fin;
  ATENCION_DEF.forEach(({ key, label, count }) => {
    for (let si = 0; si < count; si++) {
      const fsN = fsWeek ? slotN(fsWeek, key, si) : '';
      const mwN = mw ? slotN(mw, key, si) : '';
      const parts = [];
      if (fsN) parts.push(personNameOf(fsN) + ' (FS)');
      if (mwN) parts.push(personNameOf(mwN) + ' (ES)');
      labLines.push({ t: `${label}${count > 1 ? ' ' + (si + 1) : ''}: ${parts.length ? parts.join(' · ') : '—'}`, s: 13, w: 400, f: C.name });
    }
  });
  rows.push({ label: 'LABORES', fill: '#ecfdf5', lines: labLines });

  const grupoId = aseoGroup || (fin && fin.departamento) || '';
  const grupoNum = aseoWeekGroupNum({ group: grupoId });
  const grupo = grupoNum != null ? String(grupoNum) : (grupoId ? deptNameOf(grupoId) : '—');
  rows.push({ label: 'GRUPO', fill: '#f5f3ff', lines: [{ t: grupo, s: 22, w: 700, f: C.title }] });

  if (mobile) {
    const groupRow = rows.pop();
    const bodyRows = rows;
    const P = [];
    const H = 1280;
    P.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
    P.push(svgT(W / 2, 30, `Semana ${i + 1} · ${mesTxt}`, 22, 700, C.title, 'middle'));
    P.push(svgT(W / 2, 57, header, 16, 400, C.sub, 'middle'));
    P.push(`<rect x="${PAD}" y="78" width="${cw}" height="150" rx="14" fill="${groupRow.fill}" stroke="${C.line}" stroke-width="1"/>`);
    P.push(svgT(W / 2, 112, 'GRUPO DE LA SEMANA', 18, 700, C.sub, 'middle'));
    P.push(svgT(W / 2, 198, groupRow.lines[0].t, 92, 700, C.title, 'middle'));
    const card = (row, x, y, width, height) => {
      P.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="${row.fill}" stroke="${C.line}" stroke-width="1"/>`);
      P.push(svgT(x + 18, y + 30, row.label, 14, 700, C.sub));
      let yy = y + 58;
      row.lines.forEach(line => { P.push(svgT(x + 18, yy, line.t, 13, line.w, line.f)); yy += 18; });
    };
    card(bodyRows[0], PAD, 250, cw, 300);
    card(bodyRows[1], PAD, 590, cw, 280);
    card(bodyRows[2], PAD, 910, cw, 280);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${P.join('')}</svg>`;
  }

  let H = PAD + 32 + 20 + 10;
  rows.forEach(r => H += 44 + r.lines.length * 24 + 12);
  H += PAD;

  const P = [];
  P.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  let y = PAD;
  P.push(svgT(W / 2, y + 22, `Semana ${i + 1} · ${mesTxt}`, 20, 700, C.title, 'middle'));
  y += 32;
  P.push(svgT(W / 2, y + 16, header, 14, 400, C.sub, 'middle'));
  y += 20;
  P.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${C.line}" stroke-width="1"/>`);
  y += 10;
  rows.forEach(r => {
    const bh = 44 + r.lines.length * 24 + 12;
    P.push(`<rect x="${PAD}" y="${y}" width="${cw}" height="${bh}" rx="10" fill="${r.fill}" stroke="${C.line}" stroke-width="1"/>`);
    P.push(svgT(PAD + 16, y + 26, r.label, 12, 700, C.sub));
    let yy = y + 44;
    r.lines.forEach(ln => { P.push(svgT(PAD + 16, yy, ln.t, ln.s, ln.w, ln.f)); yy += 24; });
    y += bh + 12;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${P.join('')}</svg>`;
}

/* ---------- CONFLICTOS MENSUALES: análisis caso a caso ---------- */
const REGLA_TXT = {
  E1: 'E1 · Más de una asignación (entre semana + acomodación) en la misma semana.',
  E2: 'E2 · Más de una asignación (fin de semana + acomodación + salidas) en la misma semana.',
  E3: 'E3 · La misma asignación de entre semana se repite en el mes.',
  E4: 'E4 · El mismo cargo de fin de semana se repite en el mes.',
  E5: 'E5 · Más de una salida en el mes.',
  E6: 'E6 · Repetido en la misma reunión de entre semana.',
  E7: 'E7 · Repetido en la misma reunión de fin de semana.',
  E8: 'E8 · Repetido en las salidas del mismo día.',
};
const ATENCION_ROL = { acomodacion: 'acomodador', microfono: 'microf', plataforma: 'plataforma', sonido: 'audio' };

// Vista de conflictos mensuales: persona, asignaciones con fecha, autorizar
// excepción (alcance puntual: persona+regla+semana) o cambiar persona, y regla.
async function renderConflictos(mes) {
  state.month = null;
  renderTop();
  const app = $('#app');
  const [months, midweeks, labores, salidas] = await Promise.all([
    db.listMonths(), db.listMidweeks(), db.listAtencion(), db.listSalidas(),
  ]);
  const mwMes = midweeks.filter(m => String(m.id).startsWith(mes));
  const mesMes = months.filter(m => m.id === mes);
  const salMes = salidas.filter(p => p.id === mes);
  const labMes = labores.filter(p => p.id === mes);
  const ctx = { midweeks: mwMes, months: mesMes, salidas: salMes, atencion: labMes, people: state.people };
  const all = collectPersonAssignments(ctx);
  // Conflictos intra-reunión: repetidos dentro de la misma semana/reunión.
  const intra = [];
  const agrupar = (map, regla) => map.forEach((asigs) => {
    if (asigs.length > 1) {
      const a0 = asigs[0];
      intra.push({ value: a0.value, semana: a0.semana, mes, programa: a0.programa, rol: a0.rol, detalle: a0.detalle, regla, otros: asigs.slice(1).map(a => a.detalle) });
    }
  });
  const entreDup = new Map(), finDup = new Map(), salDup = new Map();
  all.forEach(a => {
    if (a.programa === 'entre') { const k = `${a.value}|${a.semana}`; if (!entreDup.has(k)) entreDup.set(k, []); entreDup.get(k).push(a); }
    else if (a.programa === 'fin') { const k = `${a.value}|${a.semana}`; if (!finDup.has(k)) finDup.set(k, []); finDup.get(k).push(a); }
    else if (a.programa === 'salida') { const k = `${a.value}|${a.semana}`; if (!salDup.has(k)) salDup.set(k, []); salDup.get(k).push(a); }
  });
  agrupar(entreDup, 'E6'); agrupar(finDup, 'E7'); agrupar(salDup, 'E8');
  const conflicts = [...computeCrossConflicts(ctx), ...intra];
  const config = await db.getConfig();
  const excepciones = Array.isArray(config.excepciones) ? config.excepciones : [];
  const exKey = (c) => `${c.value}|${c.regla}|${c.semana}`;

  const weekSunday = (iso) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 6); return isoDate(d); };
  const mwBySunday = new Map();
  mwMes.forEach(m => mwBySunday.set(weekSunday(m.id), m));
  const finBySunday = new Map();
  mesMes.forEach(mm => (mm.weeks || []).forEach(w => finBySunday.set(weekSunday(w.date), { rec: mm, week: w })));
  const atencionBySunday = new Map();
  labMes.forEach(p => (p.weeks || []).forEach(w => atencionBySunday.set(weekSunday(w.saturday), { rec: p, week: w })));
  const salidasBySunday = new Map();
  salMes.forEach(p => (p.weeks || []).forEach(w => salidasBySunday.set(weekSunday(w.saturday), { rec: p, week: w })));

  const resolverSlot = (a) => {
    const key = String(a.rol || '');
    if (a.programa === 'entre') {
      const mw = mwBySunday.get(String(a.semana));
      if (!mw) return null;
      if (key === 'presidente') return { rec: mw, store: 'midweeks', labore: 'presidente', collector: collectMidweekPersons, get: () => mw.presidente, set: (v) => { mw.presidente = v; } };
      if (key.startsWith('atencion_')) {
        const m = key.match(/^atencion_(\w+)_(\d+)$/);
        if (m) { const d = ATENCION_DEF.find(x => x.key === m[1]); const si = +m[2]; return { rec: mw, store: 'midweeks', labore: ATENCION_ROL[m[1]] || '', get: () => { const l = ensureAtencion(mw).labores; const arr = Array.isArray(l[m[1]]) ? l[m[1]] : [l[m[1]] || '']; return arr[si]; }, set: (v) => { const l = ensureAtencion(mw).labores; if (Array.isArray(l[m[1]])) l[m[1]][si] = v; else l[m[1]] = v; } }; }
      }
      const m = key.match(/^parte(\d+)\.(\d+)\.(.+)$/);
      if (m) {
        const si = +m[1], num = +m[2], slot = m[3];
        const sec = mw.sections[si];
        const part = sec && (sec.parts || []).find(p => p.num === num);
        const sl = part && mwSlotsFor(sec, part).find(s => s.key === slot);
        return { rec: mw, store: 'midweeks', labore: sl && sl.labore, collector: collectMidweekPersons, get: () => (part.assignments || {})[slot], set: (v) => { if (!part.assignments) part.assignments = {}; part.assignments[slot] = v; } };
      }
    }
    if (a.programa === 'fin') {
      const fb = finBySunday.get(String(a.semana));
      if (!fb) return null;
      return { rec: fb.rec, store: 'months', labore: campoFinLabore(key) || '', collector: collectWeekPersons, get: () => fb.week[key], set: (v) => { fb.week[key] = v; } };
    }
    if (a.programa === 'acomodacion') {
      const ab = atencionBySunday.get(String(a.semana));
      if (!ab) return null;
      const m = key.match(/^(\w+)_(\d+)$/);
      if (m) { const d = ATENCION_DEF.find(x => x.key === m[1]); const si = +m[2]; return { rec: ab.rec, store: 'atencion', labore: ATENCION_ROL[m[1]] || '', get: () => { const l = ensureAtencion(ab.week).labores; const arr = Array.isArray(l[m[1]]) ? l[m[1]] : [l[m[1]] || '']; return arr[si]; }, set: (v) => { const l = ensureAtencion(ab.week).labores; if (Array.isArray(l[m[1]])) l[m[1]][si] = v; else l[m[1]] = v; } }; }
    }
    if (a.programa === 'salida') {
      const sb = salidasBySunday.get(String(a.semana));
      if (!sb) return null;
      const m = key.match(/^salida_(\d+)_(\d+)$/);
      if (m) { const oi = +m[2]; const o = (sb.week.outings || [])[oi]; if (!o) return null; return { rec: sb.rec, store: 'salidas', labore: 'salida', get: () => o.oradorSalida, set: (v) => { o.oradorSalida = v; } }; }
    }
    return null;
  };

  const personasDisponibles = (res) => {
    const cur = asId(res.get());
    let pred;
    if (res.labore === 'presidente' || res.labore === 'orador') pred = res.labore;
    else if (['audio', 'sonido', 'microf', 'plataforma', 'acomodador'].includes(res.labore)) {
      const req = { sonido: ['audio', 'sonido'], microfono: ['microf'], plataforma: ['plataforma'], acomodacion: ['acomodador'] }[res.labore] || [res.labore];
      const male = (state.config && state.config.algorithm && state.config.algorithm.serviceRolesOnlyMale) !== false;
      pred = (p) => isAtencionPerson(p) && (!male || p.genero !== 'femenino') && (Array.isArray(p.labores) && p.labores.some(r => req.includes(r)));
    } else pred = res.labore;
    return eligiblePeople(res.week ? res.week : {}, state.people, pred, cur, res.collector || null);
  };

  const persistir = async (res) => {
    if (res.store === 'midweeks') { await db.putMidweek(res.rec); state.midweeks = await db.listMidweeks(); }
    else if (res.store === 'months') { await db.putMonth(res.rec); }
    else if (res.store === 'atencion') { await db.putAtencion(res.rec); }
    else if (res.store === 'salidas') { await db.putSalidas(res.rec); }
    await syncAssignmentLog();
  };

  const render = () => {
    const conflictsVivos = conflicts.filter(c => !excepciones.some(e => e && `${e.personaId}|${e.regla}|${e.semana}` === exKey(c)));
    const monthLabel = `${MONTHS_ES[Number(mes.slice(5)) - 1]} ${mes.slice(0, 4)}`;
    app.innerHTML = `
      <div class="mb-4">
        <button data-cvolver class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container transition-colors">
          <span class="material-symbols-outlined text-[18px]">arrow_back</span> General
        </button>
      </div>
      <h1 class="font-headline-lg text-headline-lg text-primary mb-1">Conflictos mensuales</h1>
      <p class="text-on-surface-variant font-body-md mb-4">${monthLabel} · ${conflicts.length} conflicto(s) · ${excepciones.length} autorizado(s). Analiza caso a caso: autoriza excepción o cambia la persona.</p>
      ${!conflicts.length ? '<p class="text-on-surface-variant text-sm">No hay conflictos este mes.</p>' : `
      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead><tr class="bg-surface-container border-b border-outline-variant">
              <th class="p-3 font-label-md text-label-md text-on-surface-variant uppercase">Persona</th>
              <th class="p-3 font-label-md text-label-md text-on-surface-variant uppercase">Asignaciones</th>
              <th class="p-3 font-label-md text-label-md text-on-surface-variant uppercase">Acción</th>
              <th class="p-3 font-label-md text-label-md text-on-surface-variant uppercase">Regla</th>
            </tr></thead>
            <tbody class="divide-y divide-outline-variant/40">${conflicts.map(c => conflictoFila(c)).join('')}</tbody>
          </table>
        </div>
      </div>`}`;

    app.querySelector('[data-cvolver]').onclick = () => go('general', { monthId: mes });

    function conflictoFila(c) {
      const autorizada = excepciones.some(e => e && `${e.personaId}|${e.regla}|${e.semana}` === exKey(c));
      const persona = state.people.find(x => String(x.id) === String(c.value));
      const asigs = all.filter(a => String(a.value) === String(c.value) && (
        (c.regla === 'E1' || c.regla === 'E2') ? String(a.semana) === String(c.semana)
        : (c.regla === 'E6' || c.regla === 'E7' || c.regla === 'E8') ? (String(a.semana) === String(c.semana) && String(a.programa) === String(c.programa))
        : c.regla === 'E5' ? (String(a.mes) === String(c.mes) && a.programa === 'salida')
        : (String(a.mes) === String(c.mes) && String(a.programa) === String(c.programa) && String(a.rol) === String(c.rol))
      )).slice(0, 4);
      const asigHtml = asigs.length ? asigs.map(a => {
        const res = resolverSlot(a);
        const opts = res ? personasDisponibles(res) : [];
        return `<div class="py-1 border-b border-outline-variant/30 last:border-0">
          <div class="text-sm font-medium text-on-surface">${escapeHtml(a.rol.split('_').join(' ').replace('atencion ', ''))} · <span class="text-on-surface-variant">${escapeHtml(a.semana)}</span></div>
          ${res ? `<select data-cambiar="${c.value}|${c.regla}|${c.semana}|${a.rol}" class="mt-1 w-full bg-surface-bright border border-outline-variant rounded-lg p-1.5 text-sm font-body-md focus:border-primary">
            <option value="">— Cambiar a —</option>
            ${opts.map(p => `<option value="${p.id}">${escapeHtml(invertName(p.name))}</option>`).join('')}
          </select>` : ''}
        </div>`;
      }).join('') : '<span class="text-on-surface-variant text-sm">—</span>';
      return `<tr class="${autorizada ? 'opacity-60' : ''}">
        <td class="p-3">${avatarHtml(persona, 'w-8 h-8')}<div class="mt-1 text-sm font-semibold text-on-surface">${escapeHtml(persona ? invertName(persona.name) : c.value)}</div></td>
        <td class="p-3 min-w-[220px]">${asigHtml}</td>
        <td class="p-3">
          ${autorizada
            ? `<button data-desautorizar="${exKey(c)}" class="px-2.5 py-1 rounded-lg border border-outline text-on-surface-variant font-label-md text-label-md hover:bg-surface-container">Quitar autorización</button>`
            : `<button data-autorizar="${exKey(c)}" class="px-2.5 py-1 rounded-lg border border-tertiary text-tertiary font-label-md text-label-md hover:bg-tertiary-fixed/40">Autorizar excepción</button>`}
        </td>
        <td class="p-3"><span class="text-xs text-on-surface-variant">${REGLA_TXT[c.regla] || c.regla}</span></td>
      </tr>`;
    }

    // Autorizar excepción (alcance puntual: persona+regla+semana).
    [...app.querySelectorAll('[data-autorizar]')].forEach(b => b.onclick = async () => {
      if (!(await confirmDialog('¿Autorizar esta excepción? Este conflicto puntual dejará de mostrarse como pendiente.', 'Autorizar excepción'))) return;
      const [pid, regla, semana] = b.dataset.autorizar.split('|');
      excepciones.push({ personaId: pid, regla, semana, autorizadaEn: Date.now() });
      const cfg = await db.getConfig();
      cfg.excepciones = excepciones;
      await db.setConfig(cfg);
      state.config = cfg;
      toast('Excepción autorizada', 'success');
      render();
    });
    [...app.querySelectorAll('[data-desautorizar]')].forEach(b => b.onclick = async () => {
      const k = b.dataset.desautorizar;
      const idx = excepciones.findIndex(e => e && `${e.personaId}|${e.regla}|${e.semana}` === k);
      if (idx >= 0) excepciones.splice(idx, 1);
      const cfg = await db.getConfig();
      cfg.excepciones = excepciones;
      await db.setConfig(cfg);
      state.config = cfg;
      toast('Autorización retirada', 'success');
      render();
    });
    // Cambiar persona: reasigna el slot.
    [...app.querySelectorAll('[data-cambiar]')].forEach(sel => sel.onchange = async () => {
      if (!sel.value) return;
      const [pid, regla, semana, rol] = sel.dataset.cambiar.split('|');
      const a = all.find(x => String(x.value) === pid && String(x.rol) === rol && String(x.semana) === semana);
      const res = a && resolverSlot(a);
      if (!res) { toast('No se pudo resolver el puesto para cambiarlo.', 'error'); return; }
      res.set(sel.value ? { id: sel.value, src: 'MANUAL', locked: true } : '');
      await persistir(res);
      toast('Asignación cambiada', 'success');
      render();
    });
  };

  render();
}

/* ---------- MIDWEEK: editor de una semana ---------- */
// Mapea cada parte de entre semana a sus puestos y al rol que la cubre
// (lógica compartida con el algoritmo, en logic.js).
function mwSlotsFor(sec, part) {
  return midweekSlotsOf(sec, part);
}

// Quien conduce el Estudio Bíblico de la Congregación (última parte de "Nuestra
// Vida Cristiana"). No es una asignación aparte: es quien da la oración final.
function mwConductorEstudio(w) {
  const vida = (w.sections || []).find(s => String(s.id) === 'vida');
  if (!vida || !Array.isArray(vida.parts) || !vida.parts.length) return null;
  const ultima = vida.parts[vida.parts.length - 1];
  const v = ultima && ultima.assignments && ultima.assignments.conductor;
  return v ? personNameOf(v) : null;
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
  const presList = state.people.filter(p => laboreEligible(p, 'presidente'));
  for (const person of presList) {
    presOpts.push(`<option value="${person.id}" ${asStr(week.presidente) === String(person.id) ? 'selected' : ''}>${escapeHtml(invertName(person.name))}</option>`);
  }
  editor.innerHTML = `
    <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-5 md:p-6">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Presidente</h2>
          <p class="text-sm text-on-surface-variant mt-0.5">Da la bienvenida y ordena el programa.</p>
        </div>
        <div class="w-full md:w-1/2 lg:w-2/5">
          <select data-mw-presidente class="mwSel w-full bg-surface-bright border ${!week.presidente ? 'border-error' : 'border-outline-variant'} rounded-lg p-2.5 font-body-lg font-bold focus:border-primary">${presOpts.join('')}</select>
          ${!week.presidente ? `<div class="mt-2 text-xs text-on-surface-variant" data-mwsugwrap="presidente">Sugerencias: ${mwSuggestChips(week, 'presidente', [], (p) => laboreEligible(p, 'presidente'), (list) => list)}</div>` : ''}
        </div>
      </div>
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
          opts.push(`<option value="${person.id}" ${asStr(cur) === String(person.id) ? 'selected' : ''}>${escapeHtml(invertName(person.name))}</option>`);
        }
        const missing = !cur;
        return `<div class="flex-1 min-w-[160px]">
          <label class="block font-label-md text-label-md text-on-surface-variant mb-1">${escapeHtml(s.label)} ${missing ? '<span class="text-error font-bold text-[10px] uppercase ml-1">Falta</span>' : ''}<span data-mwbadge="${si}.${p.num}.${s.key}" class="mw-conflict-badge hidden items-center gap-1 text-error font-bold text-[10px] uppercase conflict-dot"><span class="material-symbols-outlined text-[14px]">warning</span> Conflicto</span></label>
          <select data-sec="${si}" data-part="${p.num}" data-slot="${s.key}"
            class="mwSel w-full bg-surface-bright border ${missing ? 'border-error' : 'border-outline-variant'} rounded-lg p-2.5 font-body-md focus:border-primary">${opts.join('')}</select>
          ${missing ? `<div class="mt-1.5 flex flex-wrap gap-1 text-[11px]" data-mwsugwrap="${si}.${p.num}.${s.key}">${mwSuggestChips(week, `${si}.${p.num}.${s.key}`, list, roleFilter, collectMidweekPersons)}</div>` : ''}
        </div>`;
      }).join('');
      const esEstudio = sec.id === 'vida' && (sec.parts || []).indexOf(p) === (sec.parts || []).length - 1;
      const oracionFinalRow = esEstudio ? `
        <div class="flex items-center justify-end gap-2 md:flex-col md:items-end md:justify-center">
          <span class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Oración final</span>
          <span data-oracion-final class="font-body-lg font-bold ${ap.conductor ? 'text-on-surface' : 'text-on-surface-variant italic'}">${escapeHtml(ap.conductor ? personNameOf(ap.conductor) : 'Quien conduce el estudio')}</span>
        </div>` : '';
      return `<div class="flex flex-col md:flex-row gap-3 md:items-center md:gap-4 bg-surface-container-low rounded-lg p-4 border border-outline-variant">
        <div class="min-w-[32px] h-8 px-2 rounded-full bg-primary text-on-primary flex items-center justify-center font-label-md text-label-md">${p.num}</div>
        <div class="flex-1">
          <p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">${p.mins} min</p>
          <p class="font-body-lg text-body-lg text-on-surface">${escapeHtml(p.title)}</p>
          ${pairWarning(sec, p)}
        </div>
        <div class="flex-1 flex flex-wrap gap-3">${slotFields}</div>
        ${oracionFinalRow}
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
    const pairs = mwPairErrors(editor);
    if (dup.size) {
      mwRefreshConflicts(editor, week);
      toast('Hay personas repetidas en esta reunión; se guardará igualmente. Revise los campos resaltados.', 'info');
    }
    if (pairs.length) {
      toast(`Pareja no compatible: ${invertName(pairs[0].a.name)} / ${invertName(pairs[0].b.name)}. Se guardará igualmente; revise la asignación.`, 'info');
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
    // Envolver en formato {id, src, locked}: lo cambiado → MANUAL; lo no tocado
    // conserva su origen (las asignaciones AUTO no se pierden al editar a mano).
    const stored = await db.getMidweek(id);
    const changed = changedManualKeys({ midweeks: stored ? [stored] : [] }, { midweeks: [week] });
    const wrapped = wrapManualPrograms({ midweeks: [week] }, changed).midweeks[0];
    wrapped.updatedAt = Date.now();
    await db.putMidweek(wrapped);
    state.midweeks = await db.listMidweeks();
    await syncAssignmentLog();
    await subirStores(['midweeks']);
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
    if (sel.hasAttribute('data-mw-presidente')) return; // ya se cuenta como mw_presidente
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
    // Si cambia el conductor del Estudio Bíblico, la oración final se actualiza
    // en vivo (no es una asignación aparte: es una extensión de esa persona).
    const target = document.querySelector('[data-oracion-final]');
    if (!target || !wk || node.dataset.slot !== 'conductor' || !node.dataset.sec) return;
    const vida = (wk.sections || []).find(s => String(s.id) === 'vida');
    const num = vida && vida.parts && vida.parts.length ? String(vida.parts[vida.parts.length - 1].num) : null;
    if (String(node.dataset.sec) === String((wk.sections || []).indexOf(vida)) && num && node.dataset.part === num) {
      target.textContent = node.value ? personNameOf(node.value) : 'Quien conduce el estudio';
      target.classList.toggle('italic', !node.value);
    }
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
        <button id="mwImg" class="flex items-center gap-2 px-4 py-2 rounded-lg border border-secondary text-secondary font-label-md text-label-md hover:bg-secondary-fixed transition-all active:scale-95">
          <span class="material-symbols-outlined text-[20px]">image</span> Guardar Imagen
        </button>
        <button id="mwWa" class="flex items-center gap-2 px-4 py-2 rounded-lg border border-secondary text-secondary font-label-md text-label-md hover:bg-secondary-fixed transition-all active:scale-95">
          <span class="material-symbols-outlined text-[20px]">share</span> WhatsApp
        </button>
      </div>
    </div>
    <div id="mwPreviewContent"></div>
  `;
  $('[data-back]').onclick = () => go('midweek', { monthId: id });
  $('#mwPrint').onclick = () => window.print();
  $('#mwPdf').onclick = () => window.print();
  $('#mwImg').onclick = () => imageMidweek(id);
  $('#mwWa').onclick = () => waMidweek(id);

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
  const oracionFinalName = mwConductorEstudio(w);
  return `
    <header class="mb-4">
      <h1 class="text-2xl font-bold text-gray-600 mb-1">${escapeHtml(w.header)}</h1>
      <p class="text-blue-custom font-bold text-lg mb-2">${escapeHtml(w.reading || '')}</p>
      <p class="text-gray-600 text-sm mb-2">Presidente: <span class="font-bold text-gray-800">${escapeHtml(personNameOf(w.presidente))}</span></p>
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
    ${previewLaboresBox(ensureAtencion(w).labores)}
    <footer>
      <div class="mw-sep mb-3"></div>
      <div class="flex items-center text-sm mb-1">
        <span class="font-bold mr-1">Oración final:</span>
        <span class="${oracionFinalName ? '' : 'text-gray-500 italic'}">${oracionFinalName ? escapeHtml(oracionFinalName) : 'el conductor del Estudio Bíblico'}</span>
      </div>
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
        <button id="mwMImg" class="flex items-center gap-2 px-4 py-2 rounded-lg border border-secondary text-secondary font-label-md text-label-md hover:bg-secondary-fixed transition-all active:scale-95">
          <span class="material-symbols-outlined text-[20px]">image</span> Guardar Imagen
        </button>
        <button id="mwMWa" class="flex items-center gap-2 px-4 py-2 rounded-lg border border-secondary text-secondary font-label-md text-label-md hover:bg-secondary-fixed transition-all active:scale-95">
          <span class="material-symbols-outlined text-[20px]">share</span> WhatsApp
        </button>
      </div>
    </div>
    <div id="mwMonthContent"></div>
  `;
  $('[data-back]').onclick = () => go('midweeks');
  $('#mwMPrint').onclick = () => window.print();
  $('#mwMPdf').onclick = () => window.print();
  $('#mwMImg').onclick = () => imageMidweekMonth(cur);
  $('#mwMWa').onclick = () => waMidweekMonth(cur);
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
  const oracionFinalName = mwConductorEstudio(w);
  return `
  <article class="border border-gray-300 rounded-md p-2.5" style="break-inside:avoid;page-break-inside:avoid;">
    <div class="text-center mb-1.5">
      <div class="font-bold text-sm text-gray-800">${escapeHtml(w.header)}</div>
      <div class="text-[10px] text-gray-600">${escapeHtml(w.reading || '')}</div>
      <div class="text-[10px] text-gray-600">Presidente: <b>${escapeHtml(personNameOf(w.presidente))}</b></div>
      <div class="text-[9px] text-gray-500 mt-0.5">♪ Canción ${escapeHtml(introSong || '')} y oración · ${escapeHtml(w.introTitle || 'Palabras de introducción')} (${w.introMins || 1} min.)</div>
    </div>
    ${section((w.sections || []).find(s => s.id === 'tesoros'), '#0f7685')}
    ${section((w.sections || []).find(s => s.id === 'maestros'), '#b8860b')}
    ${section((w.sections || []).find(s => s.id === 'vida'), '#9e2a2b')}
    <div class="text-[9px] text-gray-600 border-t border-gray-200 pt-1 mt-1">
      ${escapeHtml(w.closingTitle || 'Palabras de conclusión')} (${w.closingMins || 3} mins.) · ♪ Canción ${escapeHtml(w.songOut || '')} ·
      Oración final: <b class="text-gray-800">${oracionFinalName ? escapeHtml(oracionFinalName) : '—'}</b>
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
function previewLaboresBox(labores) {
  const l = labores || {};
  const rows = ATENCION_DEF.map(({ key, label, count }) => {
    const slots = Array.isArray(l[key]) ? l[key] : [l[key] || ''];
    const names = Array.from({ length: count }, (_, si) => {
      const v = asId(slots[si]);
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

// WhatsApp comparte el programa como IMAGEN (SVG puro → PNG), no como texto.
async function waProgram() {
  toast('Generando imagen…', 'info');
  try {
    const blob = await svgToPngBlob(programaExportSvg());
    const compartido = await compartirPng(blob, `programa-${state.month.id}.png`);
    if (!compartido) toast('Imagen descargada: adjúntala en WhatsApp.', 'success');
  } catch (err) { console.error(err); toast('No se pudo generar la imagen. Use Imprimir > Guardar como PDF.', 'error'); }
}

async function imageProgram() {
  toast('Generando imagen…', 'info');
  try {
    const blob = await svgToPngBlob(programaExportSvg());
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
  sanitizarClonExport(clone);
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

// Evita que el canvas se contamine ("Tainted canvases") al exportar: el SVG
// con foreignObject no puede cargar fuentes remotas ni imágenes, así que se
// fuerza tipografía del sistema, se eliminan fondos con url() y se convierten
// las <table> a <div> (Chrome contamina el canvas con tablas en foreignObject).
// Así la imagen queda autocontenida y toBlob no falla.
function sanitizarClonExport(clone) {
  const reemplazar = (sel, display) => {
    clone.querySelectorAll(sel).forEach(el => {
      const div = document.createElement('div');
      for (const a of Array.from(el.attributes)) div.setAttribute(a.name, a.value);
      div.style.boxSizing = 'border-box';
      while (el.firstChild) div.appendChild(el.firstChild);
      el.replaceWith(div);
    });
  };
  reemplazar('table', 'table');
  reemplazar('thead', 'table-header-group');
  reemplazar('tbody', 'table-row-group');
  reemplazar('tr', 'table-row');
  reemplazar('th', 'table-cell');
  reemplazar('td', 'table-cell');

  for (const el of [clone, ...clone.querySelectorAll('*')]) {
    el.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    for (const p of ['backgroundImage', 'maskImage', 'webkitMaskImage', 'borderImageSource']) {
      const v = el.style[p];
      if (v && v.includes('url(')) el.style[p] = 'none';
    }
  }
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

/* ---------- Exportación de salidas en SVG puro ---------- */
// El método SVG+foreignObject contamina el canvas en algunos navegadores
// ("Tainted canvases may not be exported"). El programa de salidas se dibuja
// con texto/rect nativos de SVG (sin foreignObject), que sí se rasteriza.

let _svgCtx = null;
function svgMeasure() {
  if (!_svgCtx) _svgCtx = document.createElement('canvas').getContext('2d');
  return _svgCtx;
}
function svgEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function svgTextLines(text, size, maxW) {
  const ctx = svgMeasure();
  ctx.font = `${size}px system-ui, sans-serif`;
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width <= maxW || !cur) cur = test;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function svgT(x, y, text, size, weight, fill, anchor = 'start') {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="${size}" font-weight="${weight || 400}" fill="${fill}">${svgEscape(text)}</text>`;
}

function outingsExportSvg() {
  const m = state.month;
  const yNum = Number(state.monthId.slice(0, 4));
  const mes = Number(state.monthId.slice(5, 7));
  const mesTxt = `${MONTHS_ES[mes - 1].toUpperCase()} ${yNum}`;
  const congs = (m.outings || []).filter(c => c.nombre);
  const congsLine = congs.map(c =>
    `Congregación ${c.nombre} — ${c.dia === 'domingo' ? 'Domingos' : 'Sábados'} ${c.hora || ''}`).join('  |  ') || 'Sin congregaciones';
  const weeks = m.weeks || [];
  const movil = outingsMode === 'movil';
  const W = movil ? 540 : 900;
  const PAD = movil ? 22 : 46;
  const cw = W - PAD * 2;
  const C = { title: '#3f3a2e', sub: '#6b6454', small: '#9a927f', name: '#2f2a20', line: '#e7e3db', head: '#6b6454', headbg: '#f4f1ec', muted: '#8a8271' };

  // ---- altura total ----
  const tTitle = movil ? 24 : 32;
  const tCong = movil ? 15 : 19;
  let H = PAD + tTitle + 10 + tCong + 12 + 1 + (movil ? 12 : 18);
  const rows = weeks.map((w) => {
    const date = new Date(w.saturday + 'T00:00:00');
    const dia = date.getDate();
    const weekday = capitalize(date.toLocaleDateString('es', { weekday: 'long' }));
    const outs = Array.isArray(w.outings) ? w.outings : [];
    if (movil) {
      let cardH = 12 + 15 + 6 + 26;
      if (w.sinSalida) cardH += 24;
      else if (outs.length) {
        outs.forEach(o => {
          cardH += 8 + 22;
          cardH += svgTextLines(o.tituloDiscurso || '—', 15, cw - 28).length * 20;
        });
      } else cardH += 22;
      H += cardH + 14;
      return { dia, weekday, outs, cardH };
    }
    let rh = 42;
    if (w.sinSalida) rh = Math.max(rh, 32);
    else if (outs.length) {
      let oh = 0, dh = 0;
      outs.forEach(o => {
        oh += 24;
        dh += svgTextLines(o.tituloDiscurso || '—', 16, cw - 150 - 300 - 22).length * 21;
      });
      rh = Math.max(rh, Math.max(oh, dh) + 18);
    } else rh = Math.max(rh, 44);
    H += rh;
    return { dia, weekday, outs, rh };
  });
  H += PAD;

  const P = [];
  P.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  let y = PAD;
  P.push(svgT(W / 2, y + tTitle, `SALIDAS  |  ${mesTxt}`, tTitle, 600, C.title, 'middle'));
  y += tTitle + 10;
  P.push(svgT(W / 2, y + tCong, congsLine, tCong, 400, C.sub, 'middle'));
  y += tCong + 12;
  P.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${C.line}" stroke-width="1"/>`);
  y += movil ? 12 : 18;

  if (movil) {
    const mw = cw - 28;
    rows.forEach((r, i) => {
      const w = weeks[i];
      P.push(`<rect x="${PAD}" y="${y}" width="${cw}" height="${r.cardH}" rx="10" fill="#ffffff" stroke="${C.line}" stroke-width="1"/>`);
      let yy = y + 18;
      P.push(svgT(PAD + 14, yy, `Semana ${i + 1}`, 11, 600, C.small));
      yy += 20;
      P.push(svgT(PAD + 14, yy, `${r.weekday} ${r.dia}`, 21, 600, C.title));
      yy += 30;
      if (w.sinSalida) { P.push(svgT(PAD + 14, yy, 'Sin salida esta semana', 15, 400, C.muted, 'start')); }
      else if (r.outs.length) {
        r.outs.forEach(o => {
          P.push(svgT(PAD + 14, yy, personNameOf(o.oradorSalida), 17, 600, C.name));
          yy += 22;
          svgTextLines(o.tituloDiscurso || '—', 15, mw).forEach(ln => {
            P.push(svgT(PAD + 14, yy, ln, 15, 400, C.sub));
            yy += 20;
          });
        });
      } else { P.push(svgT(PAD + 14, yy, '—', 15, 400, C.muted)); }
      y += r.cardH + 14;
    });
  } else {
    const col1 = 150, col2 = 300;
    const x1 = PAD, x2 = PAD + col1, x3 = PAD + col1 + col2;
    const w3 = cw - col1 - col2 - 22;
    P.push(`<rect x="${PAD}" y="${y}" width="${cw}" height="38" fill="${C.headbg}"/>`);
    P.push(svgT(x1 + 12, y + 24, 'Semana / Fecha', 13, 600, C.head));
    P.push(svgT(x2 + 12, y + 24, 'Orador', 13, 600, C.head));
    P.push(svgT(x3 + 12, y + 24, 'Discurso', 13, 600, C.head));
    y += 38;
    rows.forEach((r, i) => {
      const w = weeks[i];
      const y0 = y;
      let yy = y + 26;
      P.push(svgT(x1 + 12, yy - 12, `Semana ${i + 1}`, 11, 600, C.small));
      P.push(svgT(x1 + 12, yy + 16, String(r.dia), 22, 600, C.title));
      yy = y + 26;
      if (w.sinSalida) {
        P.push(svgT(x2 + 12, yy, 'Sin salida esta semana', 15, 400, C.muted, 'start'));
      } else if (r.outs.length) {
        let oy = y + 26, dy = y + 26;
        r.outs.forEach(o => {
          P.push(svgT(x2 + 12, oy, personNameOf(o.oradorSalida), 17, 600, C.name));
          oy += 24;
          svgTextLines(o.tituloDiscurso || '—', 16, w3).forEach(ln => {
            P.push(svgT(x3 + 12, dy, ln, 16, 400, C.sub));
            dy += 21;
          });
        });
      } else {
        P.push(svgT(x2 + 12, yy, '—', 15, 400, C.muted));
      }
      P.push(`<line x1="${PAD}" y1="${y0 + r.rh}" x2="${W - PAD}" y2="${y0 + r.rh}" stroke="${C.line}" stroke-width="1"/>`);
      y += r.rh;
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${P.join('')}</svg>`;
}

function svgToPngBlob(svgStr) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const c = document.createElement('canvas');
      c.width = img.width * scale;
      c.height = img.height * scale;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, img.width, img.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob falló')), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG no decodificó')); };
    img.src = url;
  });
}

// Comparte un PNG como archivo (WhatsApp vía menú del sistema en móvil) o, si no
// es posible, lo descarga para adjuntarlo.
async function compartirPng(pngBlob, filename) {
  const file = new File([pngBlob], filename, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return true; }
    catch (e) { if (e.name === 'AbortError') return true; }
  }
  downloadBlob(pngBlob, filename);
  return false;
}

/* ---------- Exportación de entre semana en SVG puro (semanal y mensual) ---------- */
function midweekSvgLayout(w, y0) {
  const W = 760, PAD = 40, cw = W - PAD * 2;
  const C = { title: '#3f3a2e', sub: '#6b6454', name: '#2f2a20', line: '#d8d4cc' };
  const P = [];
  let y = y0;
  P.push(svgT(W / 2, y + 24, w.header || w.id, 20, 700, C.title, 'middle'));
  y += 30;
  P.push(svgT(W / 2, y + 14, `Lectura: ${w.reading || '—'}`, 13, 400, C.sub, 'middle'));
  y += 20;
  P.push(svgT(W / 2, y + 16, `Presidente: ${personNameOf(w.presidente)}`, 15, 700, C.name, 'middle'));
  y += 26;
  (w.sections || []).forEach(sec => {
    P.push(svgT(PAD, y + 14, sec.title, 13, 700, C.sub));
    y += 18;
    (sec.parts || []).forEach(p => {
      const nm = mwSlotsFor(sec, p).map(s => { const v = (p.assignments || {})[s.key]; return v ? personNameOf(v) : null; }).filter(Boolean).join(' · ');
      svgTextLines(`${p.num}. ${p.title} (${p.mins})${nm ? ' — ' + nm : ''}`, 13, cw - 8).forEach(ln => { P.push(svgT(PAD, y + 14, ln, 13, 400, C.name)); y += 18; });
    });
  });
  const l = ensureAtencion(w).labores;
  P.push(svgT(PAD, y + 14, 'ATENCIÓN · TRAS BAMBALINAS', 11, 700, C.sub));
  y += 18;
  ATENCION_DEF.forEach(({ key, label, count }) => {
    const arr = Array.isArray(l[key]) ? l[key] : [l[key] || ''];
    const names = Array.from({ length: count }, (_, si) => { const v = asId(arr[si]); return v ? personNameOf(v) : null; }).filter(Boolean);
    P.push(svgT(PAD, y + 14, `${label}: ${names.length ? names.join(' · ') : '—'}`, 12, 400, C.name));
    y += 17;
  });
  P.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${C.line}" stroke-width="1"/>`);
  y += 14;
  P.push(svgT(PAD, y + 14, `${w.closingTitle || 'Palabras de conclusión'} (${w.closingMins || 3} mins.)`, 13, 400, C.name));
  y += 18;
  P.push(svgT(PAD, y + 14, `Oración final: ${mwConductorEstudio(w) || 'el conductor del Estudio Bíblico'}`, 13, 600, C.name));
  y += 24;
  return { parts: P, nextY: y, W };
}

function midweekExportSvg(w) {
  const { parts, nextY, W } = midweekSvgLayout(w, 40);
  const H = nextY + 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${parts.join('')}</svg>`;
}

function midweekMonthExportSvg(weeks) {
  const W = 760, PAD = 40;
  const C = { title: '#3f3a2e', sub: '#6b6454' };
  const P = [];
  P.push(svgT(W / 2, 62, 'REUNIONES DE ENTRE SEMANA', 20, 700, C.title, 'middle'));
  let y = 88;
  weeks.forEach((w, i) => {
    if (i > 0) y += 14;
    const lay = midweekSvgLayout(w, y);
    P.push(...lay.parts);
    y = lay.nextY + 18;
  });
  const H = y + PAD;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${P.join('')}</svg>`;
}

async function imageMidweek(id) {
  const w = state.midweeks.find(x => String(x.id) === String(id));
  if (!w) return;
  toast('Generando imagen…', 'info');
  try { const blob = await svgToPngBlob(midweekExportSvg(w)); downloadBlob(blob, `entre-semana-${id}.png`); toast('Imagen descargada', 'success'); }
  catch (err) { console.error(err); toast('No se pudo generar la imagen. Use Imprimir > Guardar como PDF.', 'error'); }
}

async function waMidweek(id) {
  const w = state.midweeks.find(x => String(x.id) === String(id));
  if (!w) return;
  toast('Generando imagen…', 'info');
  try { const blob = await svgToPngBlob(midweekExportSvg(w)); const c = await compartirPng(blob, `entre-semana-${id}.png`); if (!c) toast('Imagen descargada: adjúntala en WhatsApp.', 'success'); }
  catch (err) { console.error(err); toast('No se pudo generar la imagen. Use Imprimir > Guardar como PDF.', 'error'); }
}

async function imageMidweekMonth(cur) {
  const weeks = state.midweeks.filter(m => String(m.id).startsWith(cur)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!weeks.length) return;
  toast('Generando imagen…', 'info');
  try { const blob = await svgToPngBlob(midweekMonthExportSvg(weeks)); downloadBlob(blob, `entre-semana-${cur}.png`); toast('Imagen descargada', 'success'); }
  catch (err) { console.error(err); toast('No se pudo generar la imagen. Use Imprimir > Guardar como PDF.', 'error'); }
}

async function waMidweekMonth(cur) {
  const weeks = state.midweeks.filter(m => String(m.id).startsWith(cur)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!weeks.length) return;
  toast('Generando imagen…', 'info');
  try { const blob = await svgToPngBlob(midweekMonthExportSvg(weeks)); const c = await compartirPng(blob, `entre-semana-${cur}.png`); if (!c) toast('Imagen descargada: adjúntala en WhatsApp.', 'success'); }
  catch (err) { console.error(err); toast('No se pudo generar la imagen. Use Imprimir > Guardar como PDF.', 'error'); }
}

/* ---------- Exportación del programa de fin de semana en SVG puro ---------- */
// Carta horizontal (11×8.5"), columna ancha de discurso y grupo desde el
// programa de aseo. Sin foreignObject para no contaminar el canvas.

function programaExportSvg() {
  const m = state.month;
  const W = 1056, PAD = 44;
  const cw = W - PAD * 2;
  const frac = [0.07, 0.14, 0.30, 0.14, 0.14, 0.14, 0.07]; // Fecha Pres. Discurso Orador Estudio Lector Grupo
  const xs = [], ws = [];
  let acc = 0;
  for (const f of frac) { ws.push(cw * f); xs.push(PAD + acc); acc += cw * f; }
  const C = { title: '#3f3a2e', sub: '#6b6454', line: '#e7e3db', head: '#6b6454', headbg: '#f4f1ec', name: '#2f2a20' };
  const mesTxt = `${MONTHS_ES[m.month - 1].toUpperCase()} ${m.year}`;
  const aseoGroupFor = (sat) => {
    const w = (state.aseoWeeks || []).find(x => String(x.saturday) === String(sat));
    return (w && w.group) ? String(w.group) : '';
  };
  const grupoTxt = (w) => {
    const g = aseoGroupFor(w.date) || (w.departamento || '');
    const num = g ? aseoWeekGroupNum({ group: g }) : null;
    if (num != null) return String(num);
    if (g) { const m = String(g).match(/\d+$/); if (m) return m[0]; }
    return '—';
  };

  const rowsInfo = m.weeks.map((w) => {
    const date = new Date(w.date + 'T00:00:00');
    const dia = String(date.getDate());
    if (w.type === 'assembly' || w.type === 'commemoration') {
      const label = w.type === 'assembly' ? 'ASAMBLEA' : 'CONMEMORACIÓN';
      const fechaLarga = date.toLocaleDateString('es', { day: '2-digit', month: 'long' });
      return { band: true, label: `${label} — ${fechaLarga}` };
    }
    const celdas = { f: dia, p: '', d: [], o: '', e: '', l: '', g: '', rh: 50 };
    if (w.type === 'normal') {
      celdas.p = personNameOf(w.presidente);
      celdas.d = svgTextLines(w.tituloDiscurso || '—', 15, ws[2] - 22);
      celdas.o = w.orador || '—';
      celdas.e = personNameOf(w.conductor);
      celdas.l = personNameOf(w.lector);
      celdas.g = grupoTxt(w);
    } else if (w.type === 'supervisor') {
      celdas.p = personNameOf(w.presidente);
      celdas.d = svgTextLines(w.discursoSuperior1 || '—', 15, ws[2] - 22)
        .concat(w.discursoSupervisor2 ? ['', ...svgTextLines(w.discursoSupervisor2 || '—', 15, ws[2] - 22)] : []);
      celdas.o = w.nombreSupervisor || '—';
      celdas.e = personNameOf(w.estudioSinLectura);
      celdas.l = 'Sin lectura';
      celdas.g = grupoTxt(w);
    }
    celdas.rh = Math.max(50, celdas.d.length * 20 + 34);
    return celdas;
  });

  let H = PAD + 18 + 34 + 40 + 14 + 38;
  rowsInfo.forEach(r => H += (r.band ? 52 : r.rh));
  H += PAD;

  const P = [];
  P.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  let y = PAD;
  P.push(svgT(W / 2, y + 16, 'REUNION PUBLICA', 14, 600, C.sub, 'middle'));
  y += 34;
  P.push(svgT(W / 2, y + 30, mesTxt, 34, 700, C.title, 'middle'));
  y += 44;
  P.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${C.line}" stroke-width="1"/>`);
  y += 14;
  const heads = ['Fecha', 'Presidente', 'Discurso', 'Orador', 'Estudio', 'Lector', 'Grupo'];
  P.push(`<rect x="${PAD}" y="${y}" width="${cw}" height="38" fill="${C.headbg}"/>`);
  heads.forEach((h, i) => P.push(svgT(xs[i] + 12, y + 24, h, 13, 600, C.head)));
  y += 38;

  rowsInfo.forEach((r) => {
    if (r.band) {
      P.push(`<rect x="${PAD}" y="${y}" width="${cw}" height="50" fill="#f7f4ef"/>`);
      P.push(svgT(W / 2, y + 31, r.label, 17, 700, C.title, 'middle'));
      y += 52;
      return;
    }
    const y0 = y;
    P.push(svgT(xs[0] + 12, y0 + 26, r.f, 22, 700, C.title));
    P.push(svgT(xs[1] + 12, y0 + 26, r.p, 16, 400, C.name));
    r.d.forEach((ln, li) => P.push(svgT(xs[2] + 12, y0 + 26 + li * 20, ln, 15, 400, C.title)));
    P.push(svgT(xs[3] + 12, y0 + 26, r.o, 16, 600, C.name));
    P.push(svgT(xs[4] + 12, y0 + 26, r.e, 16, 400, C.name));
    P.push(svgT(xs[5] + 12, y0 + 26, r.l, 16, 400, C.name));
    P.push(svgT(xs[6] + 12, y0 + 26, r.g, 15, 700, C.title));
    P.push(`<line x1="${PAD}" y1="${y0 + r.rh}" x2="${W - PAD}" y2="${y0 + r.rh}" stroke="${C.line}" stroke-width="1"/>`);
    y += r.rh;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${P.join('')}</svg>`;
}

/* ---------- Exportación del programa de labores (atención) en SVG puro ---------- */
// Matriz de labores (fin de semana + entre semana) con el mismo agrupado por
// domingo que la vista de atención.

async function laboresExportSvg(cur) {
  const program = await db.getAtencion(cur);
  const mesTxt = `${MONTHS_ES[Number(cur.slice(5)) - 1].toUpperCase()} ${cur.slice(0, 4)}`;
  const weekSunday = (iso) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 6); return isoDate(d); };
  const finBySunday = new Map();
  ((program && program.weeks) || []).forEach((w, wi) => finBySunday.set(weekSunday(w.saturday), { w, wi }));
  const mwBySunday = new Map();
  state.midweeks.forEach(m => mwBySunday.set(weekSunday(m.id), m));
  const sundays = [...new Set([...finBySunday.keys(), ...mwBySunday.keys()])].filter(s => s.startsWith(cur)).sort();

  const W = 900, PAD = 40;
  const colW = Math.max(120, (W - PAD * 2) / Math.max(1, sundays.length));
  const firstW = 150;
  const C = { title: '#3f3a2e', sub: '#6b6454', line: '#e7e3db', head: '#6b6454', headbg: '#f4f1ec', name: '#2f2a20' };

  const colLabels = sundays.map((s) => {
    const mw = mwBySunday.get(s);
    if (mw) return { a: `Sem. ${(finBySunday.get(s) ? Array.from(finBySunday.keys()).indexOf(s) : 0) + 1}`, b: mw.header || '' };
    const fin = finBySunday.get(s);
    const fecha = fin ? new Date(fin.w.saturday + 'T00:00:00').toLocaleDateString('es', { day: '2-digit', month: 'short' }) : s.slice(5).replace('-', '/');
    return { a: `Sem. ${Array.from(finBySunday.keys()).indexOf(s) + 1}`, b: fecha };
  });

  const laborRows = [];
  for (const d of ATENCION_DEF) {
    for (let si = 0; si < d.count; si++) {
      laborRows.push({ label: `${d.label}${d.count > 1 ? ` ${si + 1}` : ''}`, key: d.key, si });
    }
  }

  const cellLines = (s, key, si) => {
    const lines = [];
    const fin = finBySunday.get(s);
    if (fin) { const v = asId(((fin.w.labores || {})[key] || [])[si]); if (v) lines.push(personNameOf(v)); }
    const mw = mwBySunday.get(s);
    if (mw) { const v = asId(((mw.labores || {})[key] || [])[si]); if (v) lines.push(personNameOf(v)); }
    return lines;
  };

  const H = PAD + 34 + 12 + 40 + laborRows.length * 46 + PAD;
  const P = [];
  P.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  let y = PAD;
  P.push(svgT(W / 2, y + 24, `ATENCIÓN · TRAS BAMBALINAS`, 22, 700, C.title, 'middle'));
  y += 30;
  P.push(svgT(W / 2, y + 16, mesTxt, 15, 400, C.sub, 'middle'));
  y += 22;
  P.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${C.line}" stroke-width="1"/>`);
  y += 14;
  P.push(`<rect x="${PAD}" y="${y}" width="${W - PAD * 2}" height="38" fill="${C.headbg}"/>`);
  P.push(svgT(PAD + 12, y + 24, 'Labor', 13, 600, C.head));
  colLabels.forEach((cl, ci) => {
    const cx = PAD + firstW + ci * colW;
    P.push(svgT(cx + colW / 2, y + 18, cl.a, 12, 600, C.head, 'middle'));
    P.push(svgT(cx + colW / 2, y + 32, cl.b, 10, 400, C.sub, 'middle'));
  });
  y += 38;
  laborRows.forEach((lr) => {
    const y0 = y;
    P.push(svgT(PAD + 12, y0 + 28, lr.label, 14, 600, C.name));
    colLabels.forEach((_, ci) => {
      const cx = PAD + firstW + ci * colW;
      const lines = cellLines(sundays[ci], lr.key, lr.si);
      if (!lines.length) { P.push(svgT(cx + colW / 2, y0 + 28, '—', 13, 400, C.sub, 'middle')); return; }
      lines.forEach((ln, li) => P.push(svgT(cx + colW / 2, y0 + 26 + li * 18, ln, 13, 400, C.name, 'middle')));
    });
    P.push(`<line x1="${PAD}" y1="${y0 + 46}" x2="${W - PAD}" y2="${y0 + 46}" stroke="${C.line}" stroke-width="1"/>`);
    y += 46;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${P.join('')}</svg>`;
}

async function imageAtencion(cur) {
  toast('Generando imagen…', 'info');
  try {
    const blob = await svgToPngBlob(await laboresExportSvg(cur));
    downloadBlob(blob, `labores-${cur}.png`);
    toast('Imagen descargada', 'success');
  } catch (err) { console.error(err); toast('No se pudo generar la imagen. Use Imprimir > Guardar como PDF.', 'error'); }
}

async function waAtencion(cur) {
  toast('Generando imagen…', 'info');
  try {
    const blob = await svgToPngBlob(await laboresExportSvg(cur));
    const compartido = await compartirPng(blob, `labores-${cur}.png`);
    if (!compartido) toast('Imagen descargada: adjúntala en WhatsApp.', 'success');
  } catch (err) { console.error(err); toast('No se pudo generar la imagen. Use Imprimir > Guardar como PDF.', 'error'); }
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
  const all = state.departmentsAll.length ? state.departmentsAll : state.departments;
  const d = all.find(x => String(x.id) === String(w.group));
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
  id = asId(id);
  if (!id) return '—';
  const p = state.people.find(x => String(x.id) === String(id));
  return p ? invertName(p.name) : '—';
}
function personOf(id) {
  id = asId(id);
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
  return `<p class="flex items-center gap-1 text-error font-bold text-[10px] uppercase conflict-dot"><span class="material-symbols-outlined text-[14px]">warning</span> Pareja no compatible (${escapeHtml(invertName(a.name))} / ${escapeHtml(invertName(b.name))})</p>`;
}
function deptNameOf(id) {
  if (!id) return '—';
  // Resuelve contra los grupos activos y, si hace falta, también contra los
  // ocultos (inactivos): una persona puede seguir teniendo su grupo aunque la
  // congregación lo haya ocultado temporalmente.
  let d = state.departments.find(x => String(x.id) === String(id));
  if (!d && Array.isArray(state.departmentsAll)) d = state.departmentsAll.find(x => String(x.id) === String(id));
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
    people: state.people,
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
