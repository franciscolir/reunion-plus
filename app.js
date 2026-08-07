// app.js - Lógica principal de Reunión+
import * as db from './db.js';
import {
  MONTHS_ES, WEEK_TYPES, FIELD_ROLE, FIELD_LABELS,
  normalizeStr, searchTalks, saturdaysOf,
  collectWeekPersons, labelOfKey, labelOf,
  computeConflicts, computeOutingConflicts, weekComplete,
  dedupPersons, eligiblePeople, isLaborePerson, LABORES_DEF, collectMidweekPersons,
  capitalize, escapeHtml, escapeAttr, cryptoId,
  isoDate, eventTypeForDate, upcomingEvents, DAYS_ES_NAMES, addDays,
  convertPdfToData, convertPdfTalks, convertPdfPeople, convertPdfMidweeks,
} from './logic.js';

/* ---------- Estado ---------- */
const state = {
  view: 'home',           // home | new | edit | preview | outings | lists | uploads | labores | laboresGrupo | salidas | general | settings | about | midweeks | midweek | midweekPreview | midweekMonthPreview | midweekList
  newTab: 'fin',          // 'fin' | 'entre' | 'labores' | 'laboresGrupo' | 'salidas' | 'general' (en Programas)
  monthId: null,          // "YYYY-MM"
  month: null,
  previewMode: 'lista',   // lista | tabla
  people: [],
  departments: [],
  talks: [],              // lista de discursos públicos [{num, title}]
  roles: [],              // roles del equipo [{id, label}]
  midweeks: [],           // reuniones de entre semana
  config: null,           // configuración general
  toastsOpen: new Set(),
  mwMonth: null,          // mes seleccionado en la vista mensual de entre semana
  progMonth: null,        // mes seleccionado en Programas (selector global)
};

/* ---------- INIT ---------- */
init();

async function init() {
  await db.seedIfEmpty();
  await refreshCatalogs();
  registerSW();
  bindGlobal();
  window.addEventListener('hashchange', router);
  router();
}

async function refreshCatalogs() {
  state.people = await db.listPeople();
  state.departments = await db.listDepartments();
  state.talks = await db.listTalks();
  state.midweeks = await db.listMidweeks();
  state.config = await db.getConfig();
  const saved = await db.getRoles(null);
  state.roles = (saved && Array.isArray(saved) && saved.length)
    ? saved
    : DEFAULT_ROLES.map(r => ({ ...r }));
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

function bindGlobal() {
  document.getElementById('settingsBtn').addEventListener('click', () => go('settings'));
  document.getElementById('sideAbout').addEventListener('click', () => go('about'));
  document.getElementById('sideNewMonth').addEventListener('click', () => go('new'));
  document.getElementById('navToggle').addEventListener('click', () => {
    document.getElementById('sideNav').classList.toggle('hidden');
  });
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();
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
    case 'edit':     renderEdit(); break;
    case 'preview':  renderPreview(); break;
    case 'outings':  renderOutings(); break;
    case 'lists':    renderLists(); break;
    case 'uploads':  renderUploads(); break;
    case 'midweeks': renderMidweeks(); break;
    case 'midweek':  renderMidweek(segs[1]); break;
    case 'midweekPreview': renderMidweekPreview(segs[1]); break;
    case 'midweekMonthPreview': renderMidweekMonthPreview(segs[1]); break;
    case 'midweekList': renderMidweekList(); break;
    case 'labores':  renderLabores(segs[1]); break;
    case 'laboresGrupo': renderLaboresGrupo(segs[1]); break;
    case 'salidas':  renderSalidas(segs[1]); break;
    case 'general':  renderGeneralMonth(segs[1]); break;
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

function openModal(html) {
  const root = $('#modalRoot');
  $('#modalCard').innerHTML = html;
  $('#modalCard').classList.add('modal-enter');
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
function renderTop() {
  const nav = $('#topNav');
  const items = [
    { id: 'home', label: 'Inicio' },
    { id: 'lists', label: 'Listas' },
    { id: 'uploads', label: 'Carga' },
    { id: 'settings', label: 'Ajustes' },
  ];
  nav.innerHTML = items.map(i =>
    `<button data-go="${i.id}" class="font-label-md text-label-md ${state.view === i.id ? 'text-primary border-b-2 border-primary pb-1' : 'text-on-surface-variant hover:text-primary'} transition-colors h-full px-2">${i.label}</button>`
  ).join('');
  nav.querySelectorAll('button').forEach(b => b.onclick = () => go(b.dataset.go));

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
  const items = [
    { id: 'home', icon: 'calendar_month', label: 'Tablero', view: 'home' },
    { id: 'new', icon: 'add_circle', label: 'Programa', view: 'new' },
    { id: 'lists', icon: 'group', label: 'Personas y Deptos.', view: 'lists' },
    { id: 'uploads', icon: 'upload_file', label: 'Carga de Archivos', view: 'uploads' },
    { id: 'settings', icon: 'settings', label: 'Ajustes', view: 'settings' },
  ];
  const nav = $('#sideNavItems');
  nav.innerHTML = items.map(i =>
    `<button data-go="${i.id}" class="flex items-center gap-3 px-4 py-3 ${state.view === i.view ? 'bg-secondary-container text-on-secondary-container rounded-lg font-bold' : 'text-on-surface-variant hover:bg-surface-variant rounded-lg'} transition-all w-full text-left">
      <span class="material-symbols-outlined">${i.icon}</span>
      <span class="font-label-md text-label-md">${i.label}</span>
    </button>`
  ).join('');
  nav.querySelectorAll('button').forEach(b => b.onclick = () => go(b.dataset.go));
}

/* ---------- HOME: Tablero principal ---------- */
async function renderHome() {
  state.month = null;
  const months = await db.listMonths();
  months.sort((a, b) => b.id.localeCompare(a.id));
  _homeMonths = months;
  const app = $('#app');
  app.innerHTML = `
    <div class="mb-10 md:flex justify-between items-end gap-4">
      <div>
        <h1 class="font-display-lg text-display-lg text-primary mb-2">Tablero Principal</h1>
        <p class="font-body-lg text-body-lg text-on-surface-variant">Resumen de actividades y asignaciones para la semana en curso.</p>
      </div>
      <button id="btnNew" class="flex items-center gap-2 bg-primary text-on-primary px-5 py-3 rounded-lg font-label-md text-label-md hover:shadow-lg transition-all active:scale-95 whitespace-nowrap">
        <span class="material-symbols-outlined text-[20px]">add_circle</span>
        Nuevo Programa
      </button>
    </div>

    <!-- Bento Grid -->
    <div class="grid grid-cols-1 md:grid-cols-12 gap-gutter">
      <!-- Columna izquierda: reuniones -->
      <div class="md:col-span-8 md:grid-rows-1 flex flex-col gap-4">
        <!-- Entre Semana -->
        <div class="flex-1 bg-surface-container-lowest rounded-xl p-6 border border-outline-variant shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
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
        </div>
        <!-- Fin de Semana -->
        <div class="flex-1 bg-surface-container-lowest rounded-xl p-6 border border-outline-variant shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
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
  document.querySelectorAll('[data-go-settings]').forEach(b => b.onclick = () => go('settings'));

  renderHomeEvents($('#homeEvents'));
}

// ---- Helpers de la semana en curso para el tablero ----
// Almacena los meses cargados para las tarjetas de resumen.
let _homeMonths = [];

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
  const cur = findCurrentFinWeek();
  if (!cur) return '—';
  // El grupo de la semana sale de la rotación (cantidad + grupo inicial),
  // contando las semanas normales previas dentro del mismo programa mensual.
  const cfg = state.config?.groups || {};
  const n = Number(cfg.cantidad) || 0;
  if (!n) return cur.week.departamento ? deptNameOf(cur.week.departamento) : 'Sin asignar';
  const start = Number(cfg.start) || 1;
  const weeks = cur.month.weeks || [];
  let k = -1;
  for (const w of weeks) {
    if (w.type !== 'normal') continue;
    k++;
    if (w.date === cur.week.date) break;
  }
  const grupo = ((start - 1 + Math.max(k, 0)) % n) + 1;
  return `${grupo}`;
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
  const months = await db.listMonths();
  const mwMonths = [...new Set(state.midweeks.map(m => String(m.id).slice(0, 7)))];
  const dataMonths = [...new Set([...months.map(m => m.id), ...mwMonths])];
  if (!state.progMonth) {
    const today = isoDate(new Date()).slice(0, 7);
    state.progMonth = dataMonths.includes(today) ? today : (dataMonths[0] || today);
  }
  const allMonths = [...new Set([...dataMonths, state.progMonth])].sort((a, b) => b.localeCompare(a));

  const tabs = [
    { id: 'fin', label: 'Reunión de Fin de Semana' },
    { id: 'entre', label: 'Reunión de Entre Semana' },
    { id: 'labores', label: 'Acomodacion' },
    { id: 'laboresGrupo', label: 'Aseo' },
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
    </div>
    <div class="flex gap-2 mb-8 border-b border-outline-variant flex-wrap">
      ${tabs.map(t => `<button data-tab="${t.id}" class="newTab px-5 py-3 font-label-md text-label-md transition-colors">${t.label}</button>`).join('')}
    </div>
    <div id="newBody"></div>
  `;

  const goMonth = (m) => { state.progMonth = m; renderNew(); };
  $('#progMonth').onchange = (e) => goMonth(e.target.value);
  app.querySelectorAll('[data-month]').forEach(b => b.onclick = () => goMonth(b.dataset.month));

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

async function renderNewBody() {
  const body = $('#newBody');
  if (!body) return;
  if (state.newTab === 'entre') { renderMidweeks({ embed: body, month: state.progMonth }); return; }
  if (state.newTab === 'labores') { renderLabores(state.progMonth, { embed: body }); return; }
  if (state.newTab === 'laboresGrupo') { renderLaboresGrupo(state.progMonth, { embed: body }); return; }
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
      <button id="nmCreate" class="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:opacity-90 active:scale-95 transition-all">
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
    applyGroupRotationToWeeks(weeks, state.config?.groups?.cantidad || 0, Number(state.config?.groups?.start) || 1);
    const monthObj = { id, year, month, weeks, published: false };
    await db.putMonth(monthObj);
    toast('Programa creado', 'success');
    go('edit', { monthId: id });
  };
}

// Marca automáticamente el tipo de reunión de cada semana según las fechas
// especiales de la configuración general (conmemoración, visita, asamblea).
function applyConfigWeekTypes(weeks) {
  const events = state.config?.events || {};
  let marked = 0;
  for (const w of weeks) {
    const type = eventTypeForDate(events, w.date);
    if (type !== 'normal') {
      w.type = type;
      marked++;
    }
  }
  if (marked > 0) toast(`${marked} semana(s) marcada(s) según la configuración general`, 'success');
  return weeks;
}

// Asigna el grupo de atención (departamento) a las semanas normales de forma
// correlativa (rotación). `n` es la cantidad de grupos y `start` (1-based) el
// grupo inicial. Reutiliza los grupos ya existentes en la DB (por nombre "Grupo i"
// o número "i"), creándolos si hiciera falta. Devuelve cuántas semanas se asignaron.
function applyGroupRotationToWeeks(weeks, n, start) {
  n = Math.max(n || 0, 0);
  if (!n) { for (const w of weeks) { if (w.type === 'normal') w.departamento = ''; } return 0; }
  const deptFor = (i) => {
    const d = state.departments.find(x => {
      const name = String(x.name || '').trim();
      const m = /^(?:grupo\s*)?(\d+)$/i.exec(name);
      return m && parseInt(m[1], 10) === i;
    });
    return d ? d.id : '';
  };
  let assigned = 0, k = 0;
  for (const w of weeks) {
    if (w.type !== 'normal') continue;
    w.departamento = deptFor(((start - 1 + k) % n) + 1);
    k++; assigned++;
  }
  return assigned;
}

/* ---------- EDIT: editor de semanas ---------- */
async function renderEdit() {
  if (!state.monthId) { go('home'); return; }
  let m = await db.getMonth(state.monthId);
  if (!m) { toast('Programa no encontrado', 'error'); go('home'); return; }
  ensureOutings(m);
  state.month = m;
  renderTop();
  const app = $('#app');
  app.innerHTML = `
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
      <div>
        <h1 class="font-headline-lg text-headline-lg text-primary">Edición Mensual</h1>
        <p class="text-on-surface-variant font-body-lg text-body-lg max-w-2xl">Organice las sesiones y roles para ${MONTHS_ES[m.month - 1]} ${m.year}. Evite duplicidad de personas en la misma reunión.</p>
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
      const role = sel?.dataset.role || '';
      quickAddPerson(role).then(refreshPeopleSelects);
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
  const typeOpts = Object.entries(WEEK_TYPES).map(([k, v]) =>
    `<option value="${k}" ${w.type === k ? 'selected' : ''}>${v.label}</option>`
  ).join('');

  return `<section class="week-card-accent bg-surface-container-lowest rounded-lg shadow-[0px_4px_20px_rgba(0,0,0,0.04)] p-6 md:p-8 border ${w.type !== 'normal' ? 'border-primary' : 'border-outline-variant'} hover:shadow-[0px_8px_30px_rgba(0,0,0,0.08)] transition-shadow">
    <div class="flex flex-col lg:flex-row gap-8">
      <div class="lg:w-1/4">
        <h3 class="font-headline-md text-headline-md text-primary mb-1">Semana ${i + 1}</h3>
        <div class="mb-2 flex items-center gap-1 text-secondary font-bold text-[10px] uppercase">
          <span class="material-symbols-outlined text-[14px]">${WEEK_TYPES[w.type].icon}</span> ${WEEK_TYPES[w.type].label}
        </div>
        <div class="inline-block px-3 py-1 bg-primary text-on-primary font-label-md text-label-md rounded">${fullDate}</div>
        <div class="mt-4 space-y-2">
          <label class="font-label-md text-label-md text-on-surface-variant">Tipo de Reunión</label>
          <select data-field="type" data-idx="${i}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2 font-body-md focus:border-primary">${typeOpts}</select>
        </div>
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
        <select data-outing-field="oradorSalida" data-outing-idx="${weekIdx}.${outIdx}" data-people data-role="orador" class="w-full bg-surface-bright border ${dup ? 'border-error' : 'border-outline-variant'} rounded-lg p-2.5 font-body-md focus:border-primary">
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
  const role = FIELD_ROLE[name] || '';
  const hasConflict = conflicts.duplicates?.includes(name);
  const missing = conflicts.missing?.includes(name);
  const repeated = sameFieldOtherWeek(name, idx);
  const badge = hasConflict
    ? `<span class="flex items-center gap-1 text-error font-bold text-[10px] uppercase conflict-dot"><span class="material-symbols-outlined text-[14px]">warning</span> Conflicto</span>`
    : repeated
      ? `<span class="flex items-center gap-1 text-secondary font-bold text-[10px] uppercase conflict-dot"><span class="material-symbols-outlined text-[14px]">event_repeat</span> Ya designado este mes</span>`
      : '';
  const errClass = (hasConflict || missing) ? 'bg-error-container/20 border-error' : 'border-outline-variant';
  const roleHint = role ? `data-role="${role}"` : '';
  return `<div class="space-y-2 relative">
    <label class="font-label-md text-label-md text-on-surface-variant flex items-center justify-between gap-2 flex-wrap">${label} ${badge}</label>
    <div class="flex gap-2">
      <select data-field="${name}" data-idx="${idx}" data-people ${roleHint} class="flex-1 bg-surface-bright border ${errClass} rounded-lg p-2.5 font-body-md focus:border-primary">
        <option value="">— Sin asignar —</option>
      </select>
   </div>
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
  const role = sel.dataset.role || '';
  const list = eligiblePeople(state.month.weeks[current], state.people, role, val);
  sel.innerHTML = `<option value="">— Sin asignar —</option>` +
    list.map(p => `<option value="${p.id}" ${String(p.id) === String(val) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
}

// Rellena un select de orador de salida (data-outing-idx="wi.oi")
function fillOutingPeople(sel) {
  const parts = (sel.dataset.outingIdx || '').split('.').map(Number);
  if (parts.length !== 2 || !state.month || !state.month.weeks[parts[0]]) return;
  const [wi, oi] = parts;
  const outing = state.month.weeks[wi].outings?.[oi];
  const val = outing ? outing.oradorSalida : '';
  const role = sel.dataset.role || 'orador';
  const list = eligiblePeople(state.month.weeks[wi], state.people, role, val);
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

    if (field === 'type') {
      state.month.weeks[idx] = { ...state.month.weeks[idx] };
      renderWeeks();
    } else {
      // re-renderizar tarjetas para reflejar conflictos (change se dispara tras blur)
      renderWeeks();
    }
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
  toast('Cambios guardados', 'success');
}

/* ---------- Validación ---------- */
// (collectWeekPersons, labelOfKey, computeConflicts, weekComplete se importan de logic.js)

/* ---------- PREVIEW: lista y tabla ---------- */
async function renderPreview() {
  if (!state.monthId) { go('home'); return; }
  const m = await db.getMonth(state.monthId);
  if (!m) { toast('Programa no encontrado', 'error'); go('home'); return; }
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
  let m = await db.getMonth(state.monthId);
  if (!m) { toast('Programa no encontrado', 'error'); go('home'); return; }
  ensureOutings(m);
  state.month = m;
  renderTop();
  const app = $('#app');
  const outs = m.outings || [];
  app.innerHTML = `
    <div class="mb-10 text-center md:text-left">
      <div class="flex items-center gap-3 mb-2 justify-center md:justify-start">
        <span class="editorial-line w-12 hidden md:block"></span>
        <p class="font-label-md text-label-md text-secondary uppercase tracking-widest">Programa de Salidas</p>
      </div>
      <h1 class="font-display-lg text-display-lg text-primary mb-2 leading-tight">${MONTHS_ES[m.month - 1].toUpperCase()} ${m.year} — Salidas</h1>
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
  $('#btnEditOut').onclick = () => go('edit', { monthId: state.monthId });
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
  const date = new Date(w.date + 'T00:00:00');
  const dateStr = date.toLocaleDateString('es', { day: '2-digit', month: 'long' });
  if (w.type !== 'normal') {
    return `<tr class="transition-colors"><td class="p-6 bg-surface-variant/40" colspan="3">
      <span class="font-headline-md text-headline-md text-outline uppercase tracking-widest">${WEEK_TYPES[w.type].label}</span>
      <span class="font-body-md text-body-md text-on-surface-variant ml-2">${dateStr} — Sin salida</span>
    </td></tr>`;
  }
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
  const lines = [];
  lines.push(`*Programa de Salidas - ${MONTHS_ES[m.month - 1]} ${m.year}*`);
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
    if (w.type !== 'normal') return;
    const date = new Date(w.date + 'T00:00:00');
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
const DEFAULT_ROLES = [
  { id: 'presidente',   label: 'Presidente' },
  { id: 'conductor1',   label: 'Cond. Atalaya' },
  { id: 'conductor2',   label: 'Cond. Libro' },
  { id: 'orador',       label: 'Orador' },
  { id: 'lector1',      label: 'Lector Atalaya' },
  { id: 'lector2',      label: 'Lector Libro' },
  { id: 'audio',        label: 'Audio' },
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
        <div class="relative w-full sm:w-64">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline" data-icon="search">search</span>
          <input id="pSearch" class="w-full bg-surface-container-low border border-outline-variant rounded-full py-2 pl-10 pr-4 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-body-md font-body-md" placeholder="Buscar miembro..." type="text">
        </div>
        <button class="whitespace-nowrap flex items-center justify-center gap-2 border border-primary text-primary w-full sm:w-auto px-4 py-2 rounded-lg font-label-md text-label-md hover:bg-surface-container-high transition-colors" id="toggleEditMode">
          <span class="material-symbols-outlined text-[18px]">lock_open</span>
          <span id="editText">Desbloquear</span>
        </button>
      </div>
    </div>

    <div class="bg-surface-container-lowest rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.04)] border border-outline-variant overflow-hidden">
      <div class="overflow-auto max-h-[70vh]">
        <table class="w-full text-left border-collapse" id="rolesTable">
          <thead><tr class="bg-surface-container border-b border-outline-variant"></tr></thead>
          <tbody class="divide-y divide-outline-variant/50" id="pList"></tbody>
        </table>
      </div>
    </div>

    <div class="mt-6 flex justify-between flex-wrap gap-3">
      <div class="flex flex-wrap gap-3">
        <button id="manageRolesBtn" class="bg-surface-container-low text-on-surface-variant px-4 py-2 rounded-lg font-label-md text-label-md hover:bg-surface-variant transition-colors flex items-center gap-2">
          <span class="material-symbols-outlined text-[18px]">manage_accounts</span> Gestionar Roles
        </button>
      </div>
      <button id="addMemberBtn" class="bg-primary text-on-primary px-4 py-2 rounded-lg font-label-md text-label-md hover:opacity-90 transition-opacity flex items-center gap-2">
        <span class="material-symbols-outlined text-[18px]">add</span> Añadir Miembro
      </button>
    </div>
  `;

  const thead = app.querySelector('#rolesTable thead tr');
  thead.innerHTML = `
    <th class="p-4 font-label-md text-label-md text-on-surface-variant sticky left-0 top-0 bg-surface-container z-30 min-w-[220px]">Miembro del Equipo</th>
    ${state.roles.map(r => `<th class="p-4 font-label-md text-label-md text-on-surface-variant text-center w-14 whitespace-nowrap sticky top-0 bg-surface-container z-20" title="${escapeAttr(r.label)}">
      <button data-markrole="${r.id}" class="material-symbols-outlined text-[16px] hover:text-primary block mx-auto mb-1" title="Marcar ${escapeAttr(r.label)} para todos">select_all</button>
      <div class="rotate-180" style="writing-mode: vertical-rl; letter-spacing: 0.05em;">${r.label}</div>
    </th>`).join('')}
  `;

  app.querySelectorAll('[data-markrole]').forEach(btn => btn.onclick = async () => {
    const first = document.querySelector('#pList .role-checkbox');
    if (first && first.disabled) { toast('Desbloquea la edición primero', 'info'); return; }
    const role = btn.dataset.markrole;
    const lbl = (state.roles.find(r => r.id === role) || {}).label || role;
    const add = state.people.some(p => !(Array.isArray(p.roles) && p.roles.includes(role)));
    for (const p of state.people) {
      const roles = Array.isArray(p.roles) ? [...p.roles] : [];
      if (add) { if (!roles.includes(role)) roles.push(role); }
      else { const i = roles.indexOf(role); if (i !== -1) roles.splice(i, 1); }
      await db.setPersonRoles(p.id, roles);
      p.roles = roles;
    }
    document.querySelectorAll(`#pList .role-checkbox[data-prole="${role}"]`).forEach(cb => cb.checked = add);
    toast(add ? `"${lbl}" marcado para todos` : `"${lbl}" desmarcado de todos`, 'success');
  });

  let editMode = false;
  const toggleBtn = $('#toggleEditMode');
  toggleBtn.onclick = () => {
    editMode = !editMode;
    if (editMode) {
      toggleBtn.classList.remove('border-primary', 'text-primary');
      toggleBtn.classList.add('bg-primary', 'text-on-primary', 'hover:bg-primary/90');
      toggleBtn.lastElementChild.textContent = 'Guardar y Bloquear';
      $('#pList').querySelectorAll('.role-checkbox').forEach(cb => cb.disabled = false);
    } else {
      toggleBtn.classList.add('border-primary', 'text-primary');
      toggleBtn.classList.remove('bg-primary', 'text-on-primary', 'hover:bg-primary/90');
      toggleBtn.lastElementChild.textContent = 'Desbloquear';
      $('#pList').querySelectorAll('.role-checkbox').forEach(cb => cb.disabled = true);
    }
  };
  $('#addMemberBtn').onclick = () => {
    openModal(`
    <div class="text-center">
      <span class="material-symbols-outlined text-6xl text-primary mb-2">person_add</span>
      <h3 class="font-headline-md text-headline-md text-primary mb-4">Añadir Miembro</h3>
      <form id="mdForm" class="space-y-4">
        <input id="mdName" type="text" placeholder="Nombre completo" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary" autocomplete="off">
        <div class="flex flex-wrap justify-center gap-2" id="mdRoles"></div>
        <div class="flex gap-3 justify-center pt-2">
          <button type="button" id="mdCancel2" class="px-5 py-2.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cancelar</button>
          <button type="submit" class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Agregar</button>
        </div>
      </form>
    </div>`);
    $('#mdRoles').innerHTML = state.roles.map(r =>
      `<label class="flex items-center gap-1.5 cursor-pointer text-[12px] font-label-md text-on-surface-variant"><input type="checkbox" data-mr="${r.id}" class="text-primary accent-primary"> ${r.label}</label>`
    ).join('');
    $('#mdCancel2').onclick = closeModal;
    $('#mdForm').onsubmit = async (e) => {
      e.preventDefault();
      const name = $('#mdName').value.trim();
      if (!name) { toast('Escribe un nombre', 'error'); return; }
      const roles = Array.from(document.querySelectorAll('[data-mr]:checked')).map(c => c.dataset.mr);
      try { await db.addPerson({ name, roles }); closeModal(); toast('Miembro agregado', 'success'); renderLists(); }
      catch (err) { toast(err.message, 'error'); }
    };
  };

  $('#manageRolesBtn').onclick = renderRolesModal;

  const search = $('#pSearch');
  search.addEventListener('input', () => {
    const q = normalizeStr(search.value);
    document.querySelectorAll('#pList tr').forEach(tr => {
      tr.style.display = tr.dataset.norm.includes(q) ? '' : 'none';
    });
  });

  $('#pList').innerHTML = state.people.map(renderRows).join('') || `
    <tr><td colspan="${state.roles.length + 1}" class="p-6 text-center text-on-surface-variant text-sm">Sin personas. Añada un miembro para comenzar.</td></tr>`;
  renderRowsBindings();
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

function renderRows(p) {
  const roles = Array.isArray(p.roles) ? p.roles : [];
  const checks = state.roles.map(r => {
    const on = roles.includes(r.id);
    return `<td class="p-3 text-center"><div class="checkbox-cell"><input type="checkbox" data-prole="${r.id}" data-pid="${p.id}" class="text-primary role-checkbox" ${on ? 'checked' : ''} disabled></div></td>`;
  }).join('');
  return `<tr class="hover:bg-surface-container-low transition-colors group" data-norm="${escapeAttr(normalizeStr(p.name))}">
    <td class="p-4 font-body-md text-body-md font-medium text-on-surface flex items-center gap-3 sticky left-0 bg-surface-container-lowest group-hover:bg-surface-container-low transition-colors z-10 border-l-4 border-l-transparent hover:border-l-primary">
      <div class="w-8 h-8 rounded-full ${avatarClassFor(p.name)} flex items-center justify-center font-label-md text-label-md font-bold">${initialsOf(p.name)}</div>
      <span class="truncate">${escapeHtml(p.name)}</span>
      <button data-markall="${p.id}" class="ml-auto text-on-surface-variant hover:text-primary material-symbols-outlined text-[18px]" title="Marcar todos los roles">select_all</button>
      <button data-pdel="${p.id}" class="text-error opacity-0 group-hover:opacity-100 transition-opacity material-symbols-outlined text-[18px]" title="Eliminar">delete</button>
    </td>
    ${checks}
  </tr>`;
}

function renderRowsBindings() {
  $('#pList').querySelectorAll('[data-markall]').forEach(b => b.onclick = async () => {
    const tr = b.closest('tr');
    const cbs = [...tr.querySelectorAll('.role-checkbox')];
    if (cbs.length && cbs[0].disabled) { toast('Desbloquea la edición primero', 'info'); return; }
    const anyUnchecked = cbs.some(cb => !cb.checked);
    const pid = parseInt(b.dataset.markall, 10);
    const person = state.people.find(x => String(x.id) === String(pid));
    if (!person) return;
    const roles = anyUnchecked ? state.roles.map(r => r.id) : [];
    await db.setPersonRoles(pid, roles);
    person.roles = roles;
    cbs.forEach(cb => cb.checked = anyUnchecked);
    toast(anyUnchecked ? 'Todos los roles marcados' : 'Roles desmarcados', 'success');
  });
  $('#pList').querySelectorAll('[data-pdel]').forEach(b => b.onclick = async () => {
    if (await confirmDialog('¿Eliminar esta persona?')) { await db.deletePerson(parseInt(b.dataset.pdel, 10)); renderLists(); }
  });
  $('#pList').querySelectorAll('[data-prole]').forEach(cb => cb.onchange = async () => {
    const pid = parseInt(cb.dataset.pid, 10);
    const role = cb.dataset.prole;
    const person = state.people.find(x => String(x.id) === String(pid));
    if (!person) return;
    const roles = Array.isArray(person.roles) ? [...person.roles] : [];
    const idx = roles.indexOf(role);
    if (cb.checked && idx === -1) roles.push(role);
    else if (!cb.checked && idx !== -1) roles.splice(idx, 1);
    await db.setPersonRoles(pid, roles);
    person.roles = roles;
  });
}

function renderRolesModal() {
  openModal(`
    <h3 class="font-headline-md text-headline-md text-primary mb-2">Roles del equipo</h3>
    <p class="text-on-surface-variant font-body-md text-body-md mb-4">Cree, renombre o elimine los roles que se asignan a los miembros.</p>
    <form id="rForm" class="flex gap-2 mb-4">
      <input id="rName" type="text" placeholder="Nuevo rol (p. ej. Sonido)" class="flex-1 bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
      <button class="px-4 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 whitespace-nowrap">Agregar</button>
    </form>
    <ul id="rList" class="divide-y divide-outline-variant max-h-80 overflow-y-auto"></ul>
    <button id="mdCloseR" class="mt-5 w-full px-5 py-2.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cerrar</button>
  `);
  $('#rList').innerHTML = state.roles.map(r => `<li class="flex items-center justify-between py-3 gap-3 group">
    <span class="font-body-md text-body-md">${escapeHtml(r.label)}</span>
    <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button data-redit="${r.id}" class="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-variant" title="Renombrar"><span class="material-symbols-outlined text-[18px]">edit</span></button>
      <button data-rdel="${r.id}" class="p-1.5 rounded-lg text-error hover:bg-error-container" title="Eliminar"><span class="material-symbols-outlined text-[18px]">delete</span></button>
    </div>
  </li>`).join('') || `<li class="py-3 text-on-surface-variant text-sm">Sin roles.</li>`;
  $('#rList').querySelectorAll('[data-redit]').forEach(b => b.onclick = () => editRoleModal(b.dataset.redit));
  $('#rList').querySelectorAll('[data-rdel]').forEach(b => b.onclick = async () => {
    const id = b.dataset.rdel;
    const role = state.roles.find(r => r.id === id);
    if (!role) return;
    if (!await confirmDialog(`¿Eliminar el rol "${role.label}"? Se quitará de todos los miembros.`, 'Eliminar')) return;
    state.roles = state.roles.filter(r => r.id !== id);
    await db.setRoles(state.roles);
    for (const p of state.people) {
      if (Array.isArray(p.roles) && p.roles.includes(id)) {
        p.roles = p.roles.filter(x => x !== id);
        await db.setPersonRoles(p.id, p.roles);
      }
    }
    toast('Rol eliminado', 'success');
    renderRolesModal();
  });
  $('#rForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#rName').value.trim();
    if (!name) { toast('Escribe un nombre', 'error'); return; }
    if (state.roles.some(r => r.label.toLowerCase() === name.toLowerCase())) { toast('Ese rol ya existe', 'error'); return; }
    state.roles.push({ id: 'role_' + cryptoId(), label: name });
    await db.setRoles(state.roles);
    toast('Rol agregado', 'success');
    renderRolesModal();
  };
  $('#mdCloseR').onclick = () => { closeModal(); renderLists(); };
}

function editRoleModal(id) {
  const role = state.roles.find(r => r.id === id);
  if (!role) return;
  openModal(`
    <h3 class="font-headline-md text-headline-md text-primary mb-4">Renombrar rol</h3>
    <input id="editRName" type="text" value="${escapeAttr(role.label)}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary mb-4">
    <div class="flex gap-3 justify-end">
      <button id="editRCancel" class="px-4 py-2 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cancelar</button>
      <button id="editROk" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Guardar</button>
    </div>
  `);
  const save = async () => {
    const name = $('#editRName').value.trim();
    if (!name) { toast('Escribe un nombre', 'error'); return; }
    if (state.roles.some(r => r.id !== id && r.label.toLowerCase() === name.toLowerCase())) { toast('Ese rol ya existe', 'error'); return; }
    role.label = name;
    await db.setRoles(state.roles);
    toast('Rol actualizado', 'success');
    closeModal();
    renderRolesModal();
  };
  $('#editRCancel').onclick = () => { closeModal(); renderRolesModal(); };
  $('#editROk').onclick = save;
  $('#editRName').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
}

/* ---------- UPLOADS: carga de archivos para completar la base de datos ---------- */
const UPLOAD_TYPES = [
  {
    key: 'talks',
    title: 'Conferencias',
    icon: 'campaign',
    desc: 'Lista de discursos públicos (discursos.json).',
    jsonHint: 'Formato: [{ "num": 1, "title": "..." }, ...] o { "discursos": [...] }',
    pdfHint: 'Se extraen los títulos de discursos del PDF para revisar.',
  },
  {
    key: 'people',
    title: 'Personas',
    icon: 'group',
    desc: 'Lista de participantes con sus roles (participantes.json).',
    jsonHint: 'Formato: { "roles": { "presidente": ["Nombre", ...], ... } }',
    pdfHint: 'Se extraen nombres y roles del PDF para revisar.',
  },
  {
    key: 'midweeks',
    title: 'Guía de Actividades',
    icon: 'auto_stories',
    desc: 'Programa de las reuniones de entre semana (midweeks.json).',
    jsonHint: 'Formato: { "weeks": [...] }',
    pdfHint: 'Se extrae el programa de la revisa para regenerar las semanas.',
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
      <div class="flex rounded-lg border border-outline-variant overflow-hidden mb-4" data-format-switch>
        <button data-fmt="json" data-jsonsel="${t.key}" class="flex-1 py-2 font-label-md text-label-md bg-primary text-on-primary">JSON</button>
        <button data-fmt="pdf" data-pdfsel="${t.key}" class="flex-1 py-2 font-label-md text-label-md text-on-surface-variant">PDF</button>
      </div>
      <div data-slot="json">
        <label for="upl-${t.key}" class="block w-full cursor-pointer border-2 border-dashed border-outline-variant rounded-lg p-5 text-center hover:border-primary hover:bg-primary-fixed/10 transition-colors">
          <span class="material-symbols-outlined text-4xl text-on-surface-variant block mb-2">file_upload</span>
          <span class="font-label-md text-label-md text-primary">Seleccionar archivo JSON</span>
          <span class="block text-caption text-on-surface-variant mt-1">${t.jsonHint}</span>
        </label>
        <input id="upl-${t.key}" type="file" accept=".json,application/json" class="hidden" data-upload="${t.key}">
      </div>
      <div data-slot="pdf" class="hidden">
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
      <p class="font-body-lg text-body-lg text-on-surface-variant">Suba un archivo JSON (o PDF) y la app completará su base de datos local. Los nuevos datos reemplazan los del tipo elegido.</p>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-gutter">${cards}</div>
    <div id="uploadSummary" class="mt-8"></div>
  `;

  // Conmutador JSON / PDF por tarjeta
  app.querySelectorAll('[data-jsonsel]').forEach(btn => {
    const key = btn.dataset.jsonsel;
    btn.addEventListener('click', () => setUploadFormat(key, 'json'));
  });
  app.querySelectorAll('[data-pdfsel]').forEach(btn => {
    const key = btn.dataset.pdfsel;
    btn.addEventListener('click', () => setUploadFormat(key, 'pdf'));
  });

  // Carga de JSON
  app.querySelectorAll('input[data-upload]').forEach(input => {
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const type = input.dataset.upload;
      const status = $(`#upl-status-${type}`);
      showStatus(status, `Leyendo ${file.name}…`, 'text-on-surface-variant');
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        openJsonReview(type, await loadSerialized(data, type), text);
      } catch (e) {
        showStatus(status, `Error: ${e.message}. Verifique el formato del archivo.`, 'text-error');
      }
    });
  });

  // Carga de PDF → intenta convertir y abre revisión
  app.querySelectorAll('input[data-upload-pdf]').forEach(input => {
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const type = input.dataset.uploadPdf;
      const status = $(`#upl-status-${type}`);
      showStatus(status, `Extrayendo ${file.name} con OCR/pdf.js…`, 'text-on-surface-variant');
      try {
        const text = await extractPdfText(file);
        const { data, warnings } = convertPdfToData(type, text);
        if (!data) { showStatus(status, 'No se pudo interpretar este PDF. Revíselo a mano en la vista "Revisar PDF".', 'text-error'); openPdfTextReview(type, text); return; }
        openJsonReview(type, JSON.stringify(data, null, 2), text, warnings);
      } catch (e) {
        showStatus(status, `Error al leer PDF: ${e.message}`, 'text-error');
      }
    });
  });

  await renderUploadSummary();
}

async function renderUploadSummary() {
  const s = $('#uploadSummary');
  if (!s) return;
  const [people, talks, midweeks, depts] = await Promise.all([
    db.listPeople(), db.listTalks(), db.listMidweeks(), db.listDepartments(),
  ]);
  const rows = [
    ['Personas', people.length, 'group'],
    ['Departamentos', depts.length, 'apartment'],
    ['Conferencias', talks.length, 'campaign'],
    ['Semanas de entre semana', midweeks.length, 'auto_stories'],
  ].map(([label, n, icon]) => `<div class="flex items-center gap-3 bg-surface-container-lowest rounded-lg p-4 border border-outline-variant">
    <span class="material-symbols-outlined text-primary">${icon}</span>
    <div class="flex-1"><p class="font-label-md text-label-md text-on-surface-variant">${label}</p></div>
    <span class="font-headline-md text-headline-md text-primary">${n}</span>
  </div>`).join('');
  s.innerHTML = `<h2 class="font-headline-md text-headline-md text-primary mb-4">Base de datos actual</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${rows}</div>`;
}

// Muestra/oculta el conmutador JSON/PDF de una tarjeta.
function setUploadFormat(key, fmt) {
  const jsonBtn = document.querySelector(`[data-jsonsel="${key}"]`);
  const pdfBtn = document.querySelector(`[data-pdfsel="${key}"]`);
  const jsonInput = document.querySelector(`input[data-upload="${key}"]`);
  const pdfInput = document.querySelector(`input[data-upload-pdf="${key}"]`);
  if (jsonBtn) { jsonBtn.classList.toggle('bg-primary', fmt === 'json'); jsonBtn.classList.toggle('text-on-primary', fmt === 'json'); jsonBtn.classList.toggle('text-on-surface-variant', fmt !== 'json'); }
  if (pdfBtn) { pdfBtn.classList.toggle('bg-primary', fmt === 'pdf'); pdfBtn.classList.toggle('text-on-primary', fmt === 'pdf'); pdfBtn.classList.toggle('text-on-surface-variant', fmt !== 'pdf'); }
  if (jsonInput) jsonInput.parentElement.classList.toggle('hidden', fmt !== 'json');
  if (pdfInput) pdfInput.parentElement.classList.toggle('hidden', fmt !== 'pdf');
}

function showStatus(node, msg, cls) {
  if (!node) return;
  node.classList.remove('hidden');
  node.className = 'mt-3 font-label-md text-label-md ' + cls;
  node.textContent = msg;
}

// Serializa el objeto ya cargado del JSON a texto para mostrar en revisión.
function loadSerialized(data, type) {
  if (type === 'talks') {
    const arr = Array.isArray(data) ? data : (data?.discursos || data?.talks || []);
    return JSON.stringify(arr, null, 2);
  }
  return JSON.stringify(data, null, 2);
}

function openJsonReview(type, jsonText, rawText, warnings = []) {
  const label = (UPLOAD_TYPES.find(t => t.key === type) || { title: 'datos' }).title;
  openModal(`<div class="min-w-[80vw]">
    <h3 class="font-headline-md text-headline-md text-primary mb-2">Revisar ${label}</h3>
    <p class="font-body-md text-body-md text-on-surface-variant mb-4">Revise y edite el JSON. Al guardar se reemplazará la base de datos local de este tipo.</p>
    <div class="flex gap-3 items-center mb-3">
      <button id="rvFormat" class="px-3 py-1.5 rounded border border-outline font-label-md text-label-md text-on-surface-variant hover:bg-surface-container">Formatear</button>
      ${(warnings || []).length ? `<span class="font-label-md text-label-md text-on-surface-variant">${warnings.map(escapeHtml).join(' · ')}</span>` : ''}
    </div>
    <textarea id="rvJson" spellcheck="false" class="w-full h-[50vh] font-mono text-sm p-4 bg-surface-container border border-outline-variant rounded-lg focus:border-primary outline-none">${escapeHtml(jsonText)}</textarea>
    ${rawText ? `<details class="mt-3"><summary class="font-label-md text-label-md text-primary cursor-pointer">Ver texto extraído del PDF</summary><pre class="mt-2 p-3 rounded bg-surface-container text-xs whitespace-pre-wrap max-h-48 overflow-auto">${escapeHtml(rawText)}</pre></details>` : ''}
    <div class="flex justify-end gap-3 mt-4">
      <button id="rvCancel" class="px-5 py-2.5 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cancelar</button>
      <button id="rvSave" class="px-6 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Guardar</button>
    </div>
  </div>`);
  $('#rvCancel').onclick = closeModal;
  $('#rvFormat').onclick = () => {
    try { $('#rvJson').value = JSON.stringify(JSON.parse($('#rvJson').value), null, 2); }
    catch (e) { toast('JSON inválido: ' + e.message, 'error'); }
  };
  $('#rvSave').onclick = async () => {
    try {
      const parsed = JSON.parse($('#rvJson').value);
      let count = 0;
      if (type === 'talks') count = await db.replaceTalksFromFile(parsed);
      else if (type === 'people') count = await db.replaceAllPeople(parsed);
      else if (type === 'midweeks') count = await db.replaceAllMidweeks(parsed);
      await refreshCatalogs();
      closeModal();
      const status = $(`#upl-status-${type}`);
      showStatus(status, `✓ ${count} ${type === 'people' ? 'personas' : type === 'talks' ? 'discursos' : 'semanas'} guardados.`, 'text-tertiary-fixed');
      renderUploadSummary();
      toast('Base de datos actualizada', 'success');
    } catch (e) {
      toast('JSON inválido: ' + e.message, 'error');
    }
  };
}

// Revisión manual del texto extraído cuando no fue posible la conversión automática.
function openPdfTextReview(type, text) {
  const label = (UPLOAD_TYPES.find(t => t.key === type) || { title: 'datos' }).title;
  openModal(`
    <h3 class="font-headline-md text-headline-md text-primary mb-2">Texto extraído — ${label}</h3>
    <p class="font-body-md text-body-md text-on-surface-variant mb-4">No fue posible interpretar el PDF automáticamente. Puede copiar el texto o usarlo como guía para preparar su archivo JSON.</p>
    <pre class="p-3 rounded bg-surface-container text-xs whitespace-pre-wrap max-h-[60vh] overflow-auto">${escapeHtml(text)}</pre>
    <div class="flex justify-end gap-3 mt-4"><button class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90" data-close>Cerrar</button></div>
  `);
  document.querySelector('#modalCard [data-close]').onclick = closeModal;
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
    let lastY = null, line = '';
    for (const item of content.items) {
      if (item.str == null) continue;
      const y = Math.round(item.transform ? item.transform[5] : 0);
      if (lastY !== null && Math.abs(y - lastY) > 2) { out += line.trimEnd() + '\n'; line = ''; }
      line += (item.str || '') + ' ';
      lastY = y;
    }
    if (line.trim()) out += line.trimEnd() + '\n';
  }
  return out;
}

// Convierte el texto extraído a la estructura por tipo. Devuelve { data, warnings }.
// (convertPdfToData, convertPdfTalks, convertPdfPeople, convertPdfMidweeks se
//  importan de logic.js para poder probarse en Node.)

/* ---------- SETTINGS ---------- */
async function renderSettings() {
  state.month = null;
  renderTop();
  const congregation = await db.getSetting('congregation', '');
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
      <input data-cfg-type="${type}" type="date" value="${escapeAttr(it.date || '')}"
        class="cfg-date flex-1 bg-surface-bright border border-outline-variant rounded-lg p-2 font-body-md focus:border-primary">
      <button data-cfg-del="${i}" type="button" class="cfg-del material-symbols-outlined p-2 text-error hover:bg-error-container rounded-lg">close</button>
    </div>`;
  }).join('');

  app.innerHTML = `
    <h1 class="font-headline-lg text-headline-lg text-primary mb-6">Ajustes</h1>
    <div class="max-w-2xl space-y-6">

      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 space-y-6">
        <div>
          <h3 class="font-headline-md text-headline-md text-primary mb-1">Configuración General</h3>
          <p class="text-on-surface-variant text-sm mb-4">Horarios de las reuniones y fechas especiales. Las fechas especiales marcan automáticamente el tipo de reunión de la semana y se muestran en el inicio.</p>
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

        <div class="border-t border-outline-variant pt-5">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="font-label-md text-label-md text-on-surface uppercase tracking-wider">Conmemoración</p>
              <p class="text-on-surface-variant text-caption">La fecha se marcará como Conmemoración en esa semana.</p>
            </div>
          </div>
          <div id="cfgCommWrap">${cfgRow(config.events.commemorations, 'commemoration')}</div>
          <button id="cfgAddComm" type="button" class="mt-2 text-primary font-label-md text-label-md hover:underline flex items-center gap-1">
            <span class="material-symbols-outlined text-[18px]">add_circle</span> Añadir fecha
          </button>
        </div>

        <div class="border-t border-outline-variant pt-5">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="font-label-md text-label-md text-on-surface uppercase tracking-wider">Visita de Superintendente</p>
              <p class="text-on-surface-variant text-caption">Indique el rango de fechas (desde/hasta) de la visita.</p>
            </div>
          </div>
          <div id="cfgVisitWrap">${cfgRow(config.events.visits, 'visits')}</div>
          <button id="cfgAddVisit" type="button" class="mt-2 text-primary font-label-md text-label-md hover:underline flex items-center gap-1">
            <span class="material-symbols-outlined text-[18px]">add_circle</span> Añadir visita
          </button>
        </div>

        <div class="border-t border-outline-variant pt-5">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="font-label-md text-label-md text-on-surface uppercase tracking-wider">Asambleas</p>
              <p class="text-on-surface-variant text-caption">La fecha de inicio; elija si es de 1 día o de 3 días.</p>
            </div>
          </div>
          <div id="cfgAssemblyWrap">${cfgRow(config.events.assemblies, 'assemblies')}</div>
          <button id="cfgAddAssembly" type="button" class="mt-2 text-primary font-label-md text-label-md hover:underline flex items-center gap-1">
            <span class="material-symbols-outlined text-[18px]">add_circle</span> Añadir fecha
          </button>
        </div>

        <div class="flex gap-3 pt-2">
          <button id="cfgSave" class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Guardar</button>
        </div>
      </div>

      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 space-y-6">
        <div>
          <h3 class="font-headline-md text-headline-md text-primary mb-1">Gestión de Grupos</h3>
          <p class="text-on-surface-variant text-sm">Indique la cantidad de grupos de atención y cuál comienza el programa. Los grupos se asignan de forma correlativa (en rotación) a las semanas. Las labores son comunes a todos los grupos y sirven de referencia para los programas futuros.</p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Cantidad de grupos</label>
            <select id="grpCant" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary"></select>
          </div>
          <div>
            <label class="block font-label-md text-label-md text-on-surface-variant mb-2">El grupo que comienza el programa</label>
            <select id="grpStart" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary"></select>
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

      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 space-y-6">
        <div>
          <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Nombre de la congregación / grupo</label>
          <input id="setCong" type="text" value="${escapeAttr(congregation)}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          <p class="text-on-surface-variant text-caption mt-2">Aparece en los programas generados.</p>
        </div>
        <button id="setSave" class="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Guardar</button>

        <div class="border-t border-outline-variant pt-6">
          <h3 class="font-headline-md text-headline-md text-primary mb-2">Respaldo de datos</h3>
          <p class="text-on-surface-variant text-sm mb-3">Exporta toda la información (programas, personas, grupos, ajustes) como archivo JSON.</p>
          <div class="flex gap-3 flex-wrap">
            <button id="setExport" class="px-4 py-2 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Descargar respaldo</button>
            <label class="px-4 py-2 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container cursor-pointer">
              Restaurar <input id="setImport" type="file" accept="application/json" class="hidden">
            </label>
            <button id="setReloadLists" class="px-4 py-2 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Recargar personas/listas</button>
            <button id="setReset" class="px-4 py-2 rounded-lg border border-error text-error font-label-md text-label-md hover:bg-error-container">Reiniciar datos</button>
          </div>
          <p class="text-on-surface-variant text-caption mt-3">"Recargar" vuelve a leer <code>participantes.json</code> y <code>grupos.json</code> sin borrar los programas.</p>
        </div>
      </div>
    </div>
  `;

  // ---- Configuración General: añadir/eliminar fechas ----
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

  const bindAdd = (id, wrapId) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
      addRow(document.getElementById(wrapId), $(`#${wrapId}`).dataset.kind);
      bindDaysToggles(document.getElementById(wrapId));
    });
  };
  // Muestra/oculta el campo "hasta" según si la asamblea es de 3 días.
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
    wrap.querySelectorAll('[data-cfg-days]').forEach(d => {
      d.addEventListener('change', () => toggleDays(d.closest('.cfg-event-row')));
    });
  };
  // kind por contenedor
  document.getElementById('cfgCommWrap').dataset.kind = 'commemoration';
  document.getElementById('cfgVisitWrap').dataset.kind = 'visits';
  document.getElementById('cfgAssemblyWrap').dataset.kind = 'assemblies';
  bindCfgDel(document.getElementById('cfgCommWrap'));
  bindCfgDel(document.getElementById('cfgVisitWrap'));
  bindCfgDel(document.getElementById('cfgAssemblyWrap'));
  bindAdd('cfgAddComm', 'cfgCommWrap');
  bindAdd('cfgAddVisit', 'cfgVisitWrap');
  bindAdd('cfgAddAssembly', 'cfgAssemblyWrap');
  bindDaysToggles(document.getElementById('cfgAssemblyWrap'));

  $('#cfgSave').onclick = async () => {
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
    const cfg = {
      schedule: {
        day: parseInt($('#cfgDay').value, 10) || 6,
        time: $('#cfgTime').value || '10:00',
      },
      midweek: {
        day: parseInt($('#cfgMwDay').value, 10) || 2,
        time: $('#cfgMwTime').value || '19:00',
      },
      events: {
        commemorations: readRows('cfgCommWrap'),
        visits: readRows('cfgVisitWrap'),
        assemblies: readRows('cfgAssemblyWrap'),
      },
    };
    const prev = await db.getConfig();
    cfg.groups = prev.groups;
    await db.setConfig(cfg);
    state.config = cfg;
    toast('Configuración general guardada', 'success');
  };

  // ---- Gestión de Grupos: cantidad + grupo inicial + labores comunes ----
  const grpCant = $('#grpCant');
  const grpStart = $('#grpStart');
  const curCant = Number(config.groups?.cantidad) || Math.max(state.departments.length, 1) || 3;
  const curStart = Number(config.groups?.start) || 1;

  const fillGrpCant = () => {
    grpCant.innerHTML = Array.from({ length: 12 }, (_, i) => i + 1)
      .map(n => `<option value="${n}" ${n === curCant ? 'selected' : ''}>${n} grupo${n > 1 ? 's' : ''}</option>`).join('');
  };
  const fillGrpStart = () => {
    const n = Math.max(parseInt(grpCant.value, 10) || curCant, 1);
    grpStart.innerHTML = Array.from({ length: n }, (_, i) => i + 1)
      .map(i => `<option value="${i}" ${i === curStart ? 'selected' : ''}>Grupo ${i}</option>`).join('');
  };
  fillGrpCant();
  fillGrpStart();
  grpCant.onchange = () => {
    const n = Math.max(parseInt(grpCant.value, 10) || curCant, 1);
    grpStart.innerHTML = Array.from({ length: n }, (_, i) => i + 1)
      .map(i => `<option value="${i}">Grupo ${i}</option>`).join('');
  };

  // Asegura que existan exactamente `n` grupos (numerados "Grupo i" o "i") en la
  // DB, reutilizando los ya existentes para no perder referencias.
  async function ensureGroupCount(n) {
    const existing = await db.listDepartments();
    const byNum = new Map();
    for (const d of existing) {
      const m = /^(?:grupo\s*)?(\d+)$/i.exec(String(d.name || '').trim());
      if (m) byNum.set(parseInt(m[1], 10), d);
    }
    for (let i = 1; i <= n; i++) {
      if (!byNum.has(i)) await db.addDepartment(`Grupo ${i}`);
    }
    for (const d of existing) {
      const m = /^(?:grupo\s*)?(\d+)$/i.exec(String(d.name || '').trim());
      if (m && parseInt(m[1], 10) > n) await db.deleteDepartment(d.id);
    }
    state.departments = await db.listDepartments();
  }

  // Aplica la rotación correlativa a las semanas normales.
  const applyGroupRotation = (weeks) => {
    const n = Math.max(parseInt(grpCant.value, 10) || curCant, 1);
    const start = Math.max(parseInt(grpStart.value, 10) || curStart, 1);
    return applyGroupRotationToWeeks(weeks, n, start);
  };

  const saveGroups = async () => {
    const n = Math.max(parseInt(grpCant.value, 10) || curCant, 1);
    const start = Math.max(parseInt(grpStart.value, 10) || curStart, 1);
    await ensureGroupCount(n);
    const cfg = await db.getConfig();
    cfg.groups = { cantidad: n, start, labores: $('#grpLabores').value.trim() };
    await db.setConfig(cfg);
    state.config = cfg;
    toast('Grupos guardados', 'success');
  };
  $('#grpSave').onclick = saveGroups;

  $('#grpAuto').onclick = async () => {
    await saveGroups();
    const months = await db.listMonths();
    let total = 0;
    for (const m of months) {
      if (!m.weeks || !m.weeks.length) continue;
      total += applyGroupRotation(m.weeks);
      await db.putMonth(m);
    }
    toast(`Rotación aplicada a ${months.length} programa(s) · ${total} semana(s) asignada(s)`, 'success');
  };
  $('#setSave').onclick = async () => {
    await db.setSetting('congregation', $('#setCong').value.trim());
    toast('Ajustes guardados', 'success');
  };
  $('#setExport').onclick = async () => {
    const data = await db.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `reunion-plus-respaldo-${new Date().toISOString().slice(0, 10)}.json`);
  };
  $('#setImport').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!await confirmDialog('Restaurar reemplazará los datos actuales. ¿Continuar?', 'Restaurar')) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.people) for (const p of data.people) { await db.addPerson({ name: p.name, roles: Array.isArray(p.roles) ? p.roles : [] }); }
      if (data.departments) for (const d of data.departments) { if (d.id) await db.updateDepartment(d); else await db.addDepartment(d.name); }
      if (data.months) for (const m of data.months) await db.putMonth(m);
      if (data.settings?.congregation) await db.setSetting('congregation', data.settings.congregation);
      toast('Datos restaurados', 'success');
      renderSettings();
    } catch (err) { toast('Archivo inválido', 'error'); }
  };
  $('#setReloadLists').onclick = async () => {
    if (!await confirmDialog('Se recargarán las personas (participantes.json) y los grupos (grupos.json), sin borrar los programas.', 'Recargar')) return;
    // Reemplazar personas por las del archivo participantes.json
    try {
      const res = await fetch('./participantes.json', { cache: 'no-cache' });
      if (res.ok) {
        const data = await res.json();
        const rolesMap = data.roles || {};
        const merged = {};
        for (const [role, names] of Object.entries(rolesMap)) {
          for (const name of names) {
            const key = String(name).trim().toLowerCase();
            if (!merged[key]) merged[key] = { name: String(name).trim(), roles: [] };
            if (!merged[key].roles.includes(role)) merged[key].roles.push(role);
          }
        }
        for (const p of await db.listPeople()) await db.deletePerson(p.id);
        for (const p of Object.values(merged)) await db.addPerson(p);
      } else { toast('No se pudo leer participantes.json', 'error'); }
    } catch (err) { toast('Error: ' + err.message, 'error'); }
    // Reemplazar grupos por los del archivo grupos.json
    try {
      const res = await fetch('./grupos.json', { cache: 'no-cache' });
      if (res.ok) {
        const data = await res.json();
        const grupos = Array.isArray(data.grupos) ? data.grupos
          : (Array.isArray(data.departamentos) ? data.departamentos : []);
        for (const d of await db.listDepartments()) await db.deleteDepartment(d.id);
        for (const n of grupos) await db.addDepartment(String(n));
      } else { toast('No se pudo leer grupos.json', 'error'); }
    } catch (err) { toast('Error: ' + err.message, 'error'); }
    toast('Listas recargadas', 'success');
    renderSettings();
  };
  $('#setReset').onclick = async () => {
    if (!await confirmDialog('Esto borrará TODOS los programas, personas, grupos y discursos, y recargará los datos iniciales. ¿Continuar?', 'Reiniciar')) return;
    await indexedDB.deleteDatabase('reunion-plus');
    toast('Base reiniciada. Recargando…', 'success');
    setTimeout(() => location.reload(), 800);
  };
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

/* ---------- LABORES: vista mensual que combina ambas reuniones ---------- */
async function renderLabores(monthId, opts = {}) {
  const embed = opts.embed;
  if (!embed) {
    state.month = null;
    renderTop();
  }
  const root = embed || $('#app');
  const months = await db.listMonths();
  months.sort((a, b) => b.id.localeCompare(a.id));

  // Meses disponibles: programas de fin de semana + meses con reuniones de entre semana.
  const mwMonths = [...new Set(state.midweeks.map(m => String(m.id).slice(0, 7)))];
  const allMonths = [...new Set([...months.map(m => m.id), ...mwMonths])].sort((a, b) => b.localeCompare(a));
  const cur = (monthId && /^\d{4}-\d{2}$/.test(String(monthId))) ? String(monthId) : (allMonths[0] || isoDate(new Date()).slice(0, 7));
  const month = months.find(m => m.id === cur) || null;

  // Cada columna es una semana de la organización (domingo que cierra la semana).
  // La reunión de fin de semana (sábado) y la de entre semana (lunes) de la misma
  // semana comparten ese domingo, así ambas se alinean en una única matriz.
  const weekSunday = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 6); // lunes → domingo de la semana
    return isoDate(d);
  };
  const finBySunday = new Map();
  ((month && month.weeks) || []).forEach((w, wi) => finBySunday.set(weekSunday(w.date), { w, wi }));
  const mwBySunday = new Map();
  state.midweeks.forEach(m => mwBySunday.set(weekSunday(m.id), m));
  const sundays = [...new Set([...finBySunday.keys(), ...mwBySunday.keys()])]
    .filter(s => s.startsWith(cur))
    .sort();

  const slotValue = (week, key, si) => {
    const l = ensureLabores(week).labores;
    return (Array.isArray(l[key]) ? l[key][si] : (si === 0 ? l[key] : '')) || '';
  };
  const fmtShort = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
  const laboreOpts = (week, curVal) => `<option value="">— Sin asignar —</option>` +
    eligiblePeople(week, state.people, isLaborePerson, curVal).map(p => `<option value="${p.id}" ${String(p.id) === String(curVal) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');

  const columns = sundays.map((sunday, i) => {
    const fin = finBySunday.get(sunday); // { w, wi } | undefined
    const mw = mwBySunday.get(sunday);
    // Cada celda: selector editable para el fin de semana y el nombre de entre
    // semana como referencia (entre semana se edita en su propio editor).
    const cell = (key, si) => {
      const curVal = fin ? slotValue(fin.w, key, si) : '';
      const mwName = mw ? slotValue(mw, key, si) : '';
      const bits = [];
      if (fin && fin.w.type !== 'assembly') {
        bits.push(`<select data-labore-wi="${fin.wi}" data-labore-key="${key}" data-labore-si="${si}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-1.5 text-sm font-body-md focus:border-primary">${laboreOpts(fin.w, curVal)}</select>`);
      } else if (curVal) {
        bits.push(`<div class="text-sm font-semibold text-on-surface">${escapeHtml(personNameOf(curVal))} <span class="text-[9px] uppercase text-on-surface-variant">FS</span></div>`);
      }
      if (mwName) bits.push(`<div class="text-xs text-on-surface-variant mt-1">${escapeHtml(personNameOf(mwName))} <span class="text-[9px] uppercase">ES</span></div>`);
      return bits.length ? bits.join('') : '<span class="text-on-surface-variant text-sm">—</span>';
    };
    return {
      i,
      fin,
      mw,
      sub: mw ? mw.header : (fin ? fmtShort(fin.w.date) : ''),
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
  for (const d of LABORES_DEF) {
    for (let si = 0; si < d.count; si++) {
      const cells = columns.map(c => `<td class="p-4 text-center font-body-md text-body-md align-top">${c.cell(d.key, si)}</td>`).join('');
      rows.push(`<tr class="border-b border-outline-variant/40">
        <td class="p-4 font-body-md text-body-md text-on-surface whitespace-nowrap">${escapeHtml(d.label)}${d.count > 1 ? ` ${si + 1}` : ''}</td>
        ${cells}
      </tr>`);
    }
  }
  const empty = columns.length === 0;
  const title = embed
    ? ''
    : `<h1 class="font-display-lg text-display-lg text-primary mb-2">Labores del Mes</h1>
      <p class="font-body-lg text-body-lg text-on-surface-variant mb-4">Asignaciones de atención (tras bambalinas) de ambas reuniones · ${MONTHS_ES[Number(cur.slice(5)) - 1]} ${cur.slice(0, 4)}.</p>`;

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
    ${empty
      ? `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-10 text-center">
          <span class="material-symbols-outlined text-primary text-5xl mb-3 inline-block">work</span>
          <p class="text-on-surface-variant font-body-lg">No hay programas ni reuniones de entre semana cargados para este mes.</p>
        </div>`
      : `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 md:p-8 overflow-x-auto">
          <table class="w-full text-left border-collapse min-w-[640px]">${thead}<tbody>${rows.join('')}</tbody></table>
        </div>`}
  `;
  const monthSel = $('#labMonth');
  if (monthSel) monthSel.onchange = (e) => go('labores', { monthId: e.target.value });

  root.querySelectorAll('select[data-labore-wi]').forEach(sel => {
    sel.addEventListener('change', async () => {
      const wi = parseInt(sel.dataset.laboreWi, 10);
      const key = sel.dataset.laboreKey;
      const si = parseInt(sel.dataset.laboreSi, 10);
      const week = month.weeks[wi];
      if (!week) return;
      ensureLabores(week);
      const val = sel.value;
      if (Array.isArray(week.labores[key])) week.labores[key][si] = val;
      else week.labores[key] = val;
      await db.putMonth(month);
      toast('Labor asignada', 'success');
      renderLabores(cur, { embed });
    });
  });
}

/* ---------- LABOR GRUPO: asignación del grupo de atención por semana ---------- */
async function renderLaboresGrupo(monthId, opts = {}) {
  const embed = opts.embed;
  if (!embed) {
    state.month = null;
    renderTop();
  }
  const root = embed || $('#app');
  const months = await db.listMonths();
  months.sort((a, b) => b.id.localeCompare(a.id));
  const allMonths = months.map(m => m.id);
  const cur = (monthId && /^\d{4}-\d{2}$/.test(String(monthId))) ? String(monthId) : (allMonths[0] || isoDate(new Date()).slice(0, 7));
  const month = months.find(m => m.id === cur) || null;
  const weeks = (month && month.weeks) || [];

  // Grupos ordenados por número ("Grupo i" / "i"). El ciclo sigue la cantidad configurada.
  const numbered = state.departments
    .map(d => {
      const m = /^(?:grupo\s*)?(\d+)$/i.exec(String(d.name || '').trim());
      return { d, num: m ? Number(m[1]) : null };
    })
    .sort((a, b) => (a.num ?? 999) - (b.num ?? 999));
  const n = Number(state.config?.groups?.cantidad) || Math.max(numbered.filter(o => o.num !== null).length, 1) || state.departments.length || 1;
  const numOfDept = (id) => {
    const d = state.departments.find(x => String(x.id) === String(id));
    const m = d && /^(?:grupo\s*)?(\d+)$/i.exec(String(d.name || '').trim());
    return m ? Number(m[1]) : null;
  };
  const deptForNum = (num) => {
    const byNum = numbered.find(o => o.num === num);
    return byNum ? byNum.d.id : (numbered[(num - 1) % numbered.length]?.d.id || '');
  };
  const groupOpts = (curVal) => `<option value="">— Sin asignar —</option>` +
    state.departments.map(d => `<option value="${d.id}" ${String(d.id) === String(curVal) ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('');

  // Solo la primera semana con reunión (no asamblea) tiene selector; el resto se
  // asigna en correlativo con ciclo (al llegar al grupo N vuelve al 1).
  const startIdx = weeks.findIndex(w => w.type !== 'assembly');
  const startId = startIdx >= 0 ? weeks[startIdx].departamento : '';
  const assigned = [];
  let prevNum = startId ? numOfDept(startId) : null;
  weeks.forEach((w, i) => {
    if (w.type === 'assembly') { assigned.push(null); return; }
    if (i === startIdx) { assigned.push(startId); return; }
    if (prevNum == null) { assigned.push(''); return; }
    prevNum = (prevNum % n) + 1;
    assigned.push(deptForNum(prevNum));
  });

  const rows = weeks.map((w, i) => {
    const d = new Date(w.date + 'T00:00:00');
    const dateStr = capitalize(d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }));
    const typeBadge = w.type === 'normal' ? '' : `<span class="font-label-md text-label-md text-on-surface-variant uppercase text-[10px]">· ${WEEK_TYPES[w.type].label}</span>`;
    let groupCell;
    if (w.type === 'assembly') {
      groupCell = '<span class="text-on-surface-variant text-sm">Asamblea · sin reunión local</span>';
    } else if (i === startIdx) {
      groupCell = `<select data-wgroup="${i}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${groupOpts(w.departamento)}</select>`;
    } else {
      const name = assigned[i] ? deptNameOf(assigned[i]) : '—';
      groupCell = `<span class="font-body-md text-body-md font-semibold text-on-surface">${escapeHtml(name)}</span>`;
    }
    return `<tr class="border-b border-outline-variant/40">
      <td class="p-4 whitespace-nowrap">
        <div class="font-headline-md text-headline-md text-primary">Semana ${i + 1}</div>
      </td>
      <td class="p-4 font-body-md text-body-md text-on-surface">${dateStr} ${typeBadge}</td>
      <td class="p-4 min-w-[220px]">${groupCell}</td>
    </tr>`;
  }).join('');

  const title = embed
    ? ''
    : `<h1 class="font-display-lg text-display-lg text-primary mb-2">Labor Grupo</h1>
      <p class="font-body-lg text-body-lg text-on-surface-variant mb-4">Grupo de atención (aseo y hospitalidad) por semana · ${MONTHS_ES[Number(cur.slice(5)) - 1]} ${cur.slice(0, 4)}.</p>`;

  const monthSelBlock = embed ? '' : `
    <div class="mt-4 max-w-xs">
      <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Mes</label>
      <select id="labGrupoMonth" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
        ${allMonths.map(id => `<option value="${id}" ${id === cur ? 'selected' : ''}>${MONTHS_ES[Number(id.slice(5)) - 1]} ${id.slice(0, 4)}</option>`).join('')}
      </select>
    </div>`;

  root.innerHTML = `
    <div class="${embed ? 'mb-0' : 'mb-8'}">
      ${title}
      ${monthSelBlock}
    </div>
    ${!month
      ? `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-10 text-center">
          <span class="material-symbols-outlined text-primary text-5xl mb-3 inline-block">handshake</span>
          <p class="text-on-surface-variant font-body-lg">No hay programas de fin de semana para este mes.</p>
        </div>`
      : `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse min-w-[520px]">
              <thead><tr class="bg-surface-container border-b border-outline-variant">
                <th class="p-4 font-label-md text-label-md text-secondary uppercase">Semana</th>
                <th class="p-4 font-label-md text-label-md text-secondary uppercase">Fecha</th>
                <th class="p-4 font-label-md text-label-md text-secondary uppercase">Grupo de atención</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <p class="px-4 pb-4 text-on-surface-variant text-sm">Seleccione el grupo de la primera semana; las demás se asignan en correlativo (al llegar al grupo ${n} vuelve al 1).</p>
        </div>`}
  `;

  const monthSel = $('#labGrupoMonth');
  if (monthSel) monthSel.onchange = (e) => go('laboresGrupo', { monthId: e.target.value });

  root.querySelectorAll('select[data-wgroup]').forEach(sel => {
    sel.addEventListener('change', async () => {
      const idx = parseInt(sel.dataset.wgroup, 10);
      const startId = sel.value === '' ? '' : parseInt(sel.value, 10);
      let prevNum = startId ? numOfDept(startId) : null;
      weeks.forEach((w, i) => {
        if (w.type === 'assembly') return;
        if (i === idx) { w.departamento = startId; return; }
        if (prevNum == null) { w.departamento = ''; return; }
        prevNum = (prevNum % n) + 1;
        w.departamento = deptForNum(prevNum);
      });
      await db.putMonth(month);
      toast('Rotación de grupos aplicada', 'success');
      renderLaboresGrupo(cur, { embed });
    });
  });
}

/* ---------- SALIDAS: programa de salidas del mes (oradores de fin de semana) ---------- */
async function renderSalidas(monthId, opts = {}) {
  const embed = opts.embed;
  if (!embed) { state.month = null; renderTop(); }
  const root = embed || $('#app');
  const months = await db.listMonths();
  months.sort((a, b) => b.id.localeCompare(a.id));
  const allMonths = months.map(m => m.id);
  const cur = (monthId && /^\d{4}-\d{2}$/.test(String(monthId))) ? String(monthId) : (allMonths[0] || isoDate(new Date()).slice(0, 7));
  const month = months.find(m => m.id === cur) || null;
  if (month) ensureOutings(month);
  state.month = month; // reutiliza outingRow / computeOutingConflicts / talk picker

  const render = () => {
    const title = embed
      ? ''
      : `<h1 class="font-display-lg text-display-lg text-primary mb-2">Salidas</h1>
        <p class="font-body-lg text-body-lg text-on-surface-variant mb-4">Programa de salidas a congregaciones · ${MONTHS_ES[Number(cur.slice(5)) - 1]} ${cur.slice(0, 4)}.</p>`;

    const blocks = month ? month.weeks.map((w, i) => {
      const date = new Date(w.date + 'T00:00:00');
      const dateStr = capitalize(date.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }));
      let body;
      if (w.type !== 'normal') {
        body = `<p class="text-on-surface-variant text-sm">${WEEK_TYPES[w.type].label} · sin salidas.</p>`;
      } else {
        const occ = computeOutingConflicts(month, i);
        const rows = (w.outings || []).map((o, j) => outingRow(o, i, j, occ)).join('');
        body = `<div class="grid grid-cols-1 gap-4" data-outing-list="${i}">${rows}</div>
          <div class="mt-4 flex justify-end">
            <button data-outing-add="${i}" class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary text-on-secondary font-label-md text-label-md hover:bg-secondary-container transition-colors">
              <span class="material-symbols-outlined text-[18px]">person_add</span> Agregar orador
            </button>
          </div>`;
      }
      return `<section class="bg-surface-container-lowest rounded-xl border border-outline-variant p-5 md:p-6">
        <div class="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h3 class="font-headline-md text-headline-md text-primary">Semana ${i + 1}</h3>
          <span class="px-3 py-1 bg-secondary-container text-on-secondary-container font-label-md text-label-md rounded-full">${escapeHtml(dateStr)}</span>
        </div>
        ${body}
      </section>`;
    }).join('') : '';

    const congs = month ? (month.outings || []).map((c, i) => congCard(c, i)).join('') : '';
    const monthSelBlock = embed ? '' : `
      <div class="mt-4 max-w-xs">
        <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Mes</label>
        <select id="salidasMonth" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          ${allMonths.map(id => `<option value="${id}" ${id === cur ? 'selected' : ''}>${MONTHS_ES[Number(id.slice(5)) - 1]} ${id.slice(0, 4)}</option>`).join('')}
        </select>
      </div>`;

    root.innerHTML = `
      <div class="${embed ? 'mb-0' : 'mb-8'}">
        ${title}
        ${monthSelBlock}
      </div>
      ${!month
        ? `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-10 text-center">
            <span class="material-symbols-outlined text-primary text-5xl mb-3 inline-block">campaign</span>
            <p class="text-on-surface-variant font-body-lg">No hay programas de fin de semana para este mes.</p>
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
    if (!month) return;

    // Congregaciones (datos de salida)
    const congWrap = embed ? embed.querySelector('#salidasCong') : $('#salidasCong');
    congWrap.querySelectorAll('[data-cong-field]').forEach(bindCongFieldChange);
    congWrap.querySelectorAll('[data-cong-del]').forEach(b => b.onclick = async () => {
      const i = parseInt(b.dataset.congDel, 10);
      if (month.outings.length <= 1) { toast('Debe haber al menos una congregación', 'error'); return; }
      if (await confirmDialog('¿Eliminar esta congregación?')) { month.outings.splice(i, 1); render(); }
    });
    const addCong = congWrap.querySelector('#addCongBtn');
    if (addCong) addCong.onclick = () => { month.outings.push(newCongregation()); render(); };

    const list = embed ? embed.querySelector('#salidasList') : $('#salidasList');
    list.querySelectorAll('select[data-outing-field][data-people]').forEach(sel => {
      fillOutingPeople(sel);
      sel.addEventListener('change', () => {
        const [wi, oi] = sel.dataset.outingIdx.split('.').map(Number);
        month.weeks[wi].outings[oi].oradorSalida = sel.value === '' ? '' : parseInt(sel.value, 10);
        render();
      });
    });
    list.querySelectorAll('[data-talkpicker-out]').forEach(bindTalkPickerOut);
    list.querySelectorAll('[data-outing-add]').forEach(b => b.onclick = () => {
      const wi = parseInt(b.dataset.outingAdd, 10);
      month.weeks[wi].outings.push(newOuting());
      render();
    });
    list.querySelectorAll('[data-outing-del]').forEach(b => b.onclick = async () => {
      const [wi, oi] = b.dataset.outingDel.split('.').map(Number);
      if (month.weeks[wi].outings.length <= 1) { toast('Debe haber al menos un orador por semana', 'error'); return; }
      if (await confirmDialog('¿Eliminar este orador de la salida?')) {
        month.weeks[wi].outings.splice(oi, 1);
        render();
      }
    });

    const programBtn = embed ? embed.querySelector('#salidasProgram') : $('#salidasProgram');
    if (programBtn) programBtn.onclick = () => go('outings', { monthId: cur });
    const saveBtn = embed ? embed.querySelector('#salidasSave') : $('#salidasSave');
    if (saveBtn) saveBtn.onclick = async () => { await db.putMonth(month); toast('Salidas guardadas', 'success'); };
  };

  render();
}

/* ---------- VISTA MENSUAL GENERAL: agrupa ambas reuniones por semana ---------- */
async function renderGeneralMonth(monthId, opts = {}) {
  const embed = opts.embed;
  if (!embed) { state.month = null; renderTop(); }
  const root = embed || $('#app');
  const months = await db.listMonths();
  months.sort((a, b) => b.id.localeCompare(a.id));

  const mwMonths = [...new Set(state.midweeks.map(m => String(m.id).slice(0, 7)))];
  const allMonths = [...new Set([...months.map(m => m.id), ...mwMonths])].sort((a, b) => b.localeCompare(a));
  const cur = (monthId && /^\d{4}-\d{2}$/.test(String(monthId))) ? String(monthId) : (allMonths[0] || isoDate(new Date()).slice(0, 7));
  const month = months.find(m => m.id === cur) || null;

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
  state.midweeks.forEach(m => mwBySunday.set(weekSunday(m.id), m));
  const sundays = [...new Set([...finBySunday.keys(), ...mwBySunday.keys()])]
    .filter(s => s.startsWith(cur))
    .sort();

  const boxes = sundays.map((sunday, i) => generalWeekBox({
    fin: finBySunday.get(sunday) || null,
    mw: mwBySunday.get(sunday) || null,
    i,
  }));

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
function generalWeekBox({ fin, mw, i }) {
  const header = mw ? mw.header : (fin ? new Date(fin.date + 'T00:00:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
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
        ${fin ? generalFsContent(fin) : '<p class="text-sm text-on-surface-variant">Sin programa de fin de semana.</p>'}
      </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      <div class="rounded-lg border border-outline-variant p-4">${generalLabores({ fin, mw })}</div>
      <div class="rounded-lg border border-outline-variant p-4 flex flex-col justify-center">${generalGroup(fin)}</div>
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
function generalFsContent(w) {
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
    (w.outings || []).forEach((o, j) => rows.push([`Salida ${j + 1}`, `${personNameOf(o.oradorSalida)}${o.tituloDiscurso ? ' · ' + o.tituloDiscurso : ''}`]));
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
function generalLabores({ fin, mw }) {
  const slot = (week, key, si) => {
    const l = ensureLabores(week).labores;
    return (Array.isArray(l[key]) ? l[key][si] : (si === 0 ? l[key] : '')) || '';
  };
  const rows = LABORES_DEF.map(({ key, label, count }) => {
    const bits = [];
    for (let si = 0; si < count; si++) {
      const finName = fin ? slot(fin, key, si) : '';
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
function generalGroup(fin) {
  const grupo = (fin && fin.departamento) ? deptNameOf(fin.departamento) : '—';
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
// Mapea cada parte de entre semana a sus puestos y al rol que la cubre.
// Se basa en la sección y la posición (no en el número de parte, que puede
// variar cuando "Seamos Mejores Maestros" tiene 4 asignaciones).
function mwSlotsFor(sec, part) {
  const secId = sec && sec.id;
  const parts = (sec && sec.parts) || [];
  const idx = parts.indexOf(part);
  if (secId === 'tesoros') {
    // Última parte = Lectura de la Biblia (asignacion1); el resto son discursos (asignacion4).
    if (idx === parts.length - 1) return [{ key: 'lector', label: 'Lector', role: 'asignacion1' }];
    return [{ key: 'conductor', label: idx === 0 ? 'Discurso' : 'Perlas', role: 'asignacion4' }];
  }
  if (secId === 'maestros') {
    // "Seamos Mejores Maestros": las presentaciones son de 2 personas (asignacion2);
    // si la parte dice "discurso" es de 1 persona (asignacion3).
    if (/discurso/i.test(String(part.title || ''))) return [{ key: 'conductor', label: 'Discurso', role: 'asignacion3' }];
    return [{ key: 'estudiante', label: 'Estudiante', role: 'asignacion2' }, { key: 'ayudante', label: 'Ayudante', role: 'asignacion2' }];
  }
  if (secId === 'vida') {
    // Última parte = Estudio Bíblico de la Congregación (conductor2 + lector2);
    // las anteriores son discursos de la reunión (asignacion4).
    if (idx === parts.length - 1) return [{ key: 'conductor', label: 'Conductor', role: 'conductor2' }, { key: 'lector', label: 'Lector', role: 'lector2' }];
    return [{ key: 'conductor', label: 'Discurso', role: 'asignacion4' }];
  }
  return [{ key: 'conductor', label: 'Conductor' }];
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
  const presList = state.people.filter(p => !Array.isArray(p.roles) || p.roles.length === 0 || p.roles.includes('presidente'));
  for (const person of presList) {
    presOpts.push(`<option value="${person.id}" ${String(week.presidente) === String(person.id) ? 'selected' : ''}>${escapeHtml(person.name)}</option>`);
  }
  editor.innerHTML = `
    <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-5 md:p-6">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-headline-md text-headline-md text-primary">Presidente</h2>
      </div>
      <select data-mw-presidente class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${presOpts.join('')}</select>
    </div>` + (week.sections || []).map((sec, si) => {
    const parts = (sec.parts || []).map(p => {
      const slots = mwSlotsFor(sec, p);
      const ap = p.assignments || {};
      const slotFields = slots.map(s => {
        const cur = ap[s.key];
        const opts = ['<option value="">— Sin asignar —</option>'];
        const list = eligiblePeople(week, state.people, s.role, cur, collectMidweekPersons);
        for (const person of list) {
          opts.push(`<option value="${person.id}" ${String(cur) === String(person.id) ? 'selected' : ''}>${escapeHtml(person.name)}</option>`);
        }
        return `<div class="flex-1 min-w-[160px]">
          <label class="block font-label-md text-label-md text-on-surface-variant mb-1">${escapeHtml(s.label)} <span data-mwbadge="${si}.${p.num}.${s.key}" class="mw-conflict-badge hidden items-center gap-1 text-error font-bold text-[10px] uppercase conflict-dot"><span class="material-symbols-outlined text-[14px]">warning</span> Conflicto</span></label>
          <select data-sec="${si}" data-part="${p.num}" data-slot="${s.key}"
            class="mwSel w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${opts.join('')}</select>
        </div>`;
      }).join('');
      return `<div class="flex flex-col md:flex-row gap-3 md:items-center md:gap-4 bg-surface-container-low rounded-lg p-4 border border-outline-variant">
        <div class="min-w-[32px] h-8 px-2 rounded-full bg-primary text-on-primary flex items-center justify-center font-label-md text-label-md">${p.num}</div>
        <div class="flex-1">
          <p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">${p.mins} min</p>
          <p class="font-body-lg text-body-lg text-on-surface">${escapeHtml(p.title)}</p>
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

  editor.innerHTML += `<div class="mt-6">${midweekLaboresEditor(week)}</div>`;
  mwRefreshConflicts(editor, week);
  editor.querySelectorAll('select[data-mw-presidente], select[data-mw-labore], select.mwSel').forEach(bindMwChange);
  editor.querySelectorAll('select[data-mw-labore]').forEach(bindMwLaboreChange);

  $('#mwSave').onclick = async () => {
    const dup = mwCurrentDupKeys(editor);
    if (dup.size) {
      mwRefreshConflicts(editor, week);
      toast('Hay personas repetidas en esta reunión. Revise los campos resaltados.', 'error');
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
    week.labores = ensureLabores(week).labores;
    const presSel = editor.querySelector('select[data-mw-presidente]');
    if (presSel) week.presidente = presSel.value;
    await db.putMidweek(week);
    state.midweeks = await db.listMidweeks();
    toast('Asignaciones guardadas', 'success');
    renderMidweek(id);
  };
}

/* Labores en el editor de midweek (se persisten en week.labores) */
function midweekLaboresEditor(week) {
  const w = ensureLabores(week);
  const l = w.labores;
  const rows = LABORES_DEF.map(({ key, label, icon, count }) => {
    const slots = Array.isArray(l[key]) && key !== 'plataforma' && key !== 'sonido'
      ? l[key]
      : [l[key] || ''];
    const fields = Array.from({ length: count }, (_, si) => {
      const cur = slots[si] || '';
      const opts = ['<option value="">— Sin asignar —</option>'];
      for (const p of eligiblePeople(w, state.people, isLaborePerson, cur, collectMidweekPersons)) {
        opts.push(`<option value="${p.id}" ${String(p.id) === String(cur) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`);
      }
      return `<div class="flex-1 min-w-[130px]">
        <label class="block font-label-md text-label-md text-on-surface-variant mb-1 text-[11px]">${si + 1} <span data-mwbadge="labores_${key}_${si}" class="mw-conflict-badge hidden items-center gap-1 text-error font-bold text-[10px] uppercase conflict-dot"><span class="material-symbols-outlined text-[14px]">warning</span> Conflicto</span></label>
        <select data-mw-labore="${key}" data-mw-labore-idx="${si}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">${opts.join('')}</select>
      </div>`;
    }).join('');
    return `<div class="flex items-start gap-3">
      <span class="material-symbols-outlined text-on-surface-variant mt-2.5">${icon}</span>
      <div class="flex-1">
        <label class="font-label-md text-label-md text-on-surface-variant mb-1 block">${label} <span class="text-caption text-on-surface-variant/70">×${count}</span></label>
        <div class="flex flex-wrap gap-2">${fields}</div>
      </div>
    </div>`;
  }).join('');
  return `<div class="rounded-lg border border-dashed border-on-surface-variant/40 bg-surface-bright/40 p-5">
    <div class="flex items-center gap-2 mb-1">
     <h2 class="font-headline-md text-headline-md text-on-surface-variant">Atención departamentos</h2>
    </div>
   <div class="space-y-4">${rows}</div>
  </div>`;
}

function bindMwLaboreChange(node) {
  node.addEventListener('change', () => {
    const editor = $('#mwEditor');
    const id = editor?.dataset.mwid;
    const wk = state.midweeks.find(w => String(w.id) === String(id));
    if (!wk) return;
    const labores = ensureLabores(wk).labores;
    const key = node.dataset.mwLabore;
    const slot = parseInt(node.dataset.mwLaboreIdx, 10);
    const val = node.value === '' ? '' : node.value;
    if (Array.isArray(labores[key])) labores[key][slot] = val;
    else labores[key] = val;
  });
}

/* ---------- MIDWEEK: detección de personas duplicadas (en vivo) ---------- */

// Relee los valores actuales de todos los selects (partes + labores) del editor
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
  editor.querySelectorAll('select[data-mw-labore]').forEach(sel => {
    const key = sel.dataset.mwLabore;
    const slot = parseInt(sel.dataset.mwLaboreIdx, 10);
    if (sel.value) persons.push({ value: String(sel.value), key: `labores_${key}_${slot}` });
  });
  return dedupPersons(persons).dupKeys;
}

// Estiliza selects duplicados y muestra un rótulo "Conflicto" parpadeante junto
// al campo, igual que en la reunión de fin de semana.
function mwRefreshConflicts(editor, week) {
  const dup = mwCurrentDupKeys(editor);

  // rótulo de conflicto junto a cada campo (pads y labores)
  editor.querySelectorAll('span[data-mwbadge]').forEach(badge => {
    const keyExpanded = badge.dataset.mwbadge.startsWith('mw_') || badge.dataset.mwbadge.startsWith('labores_')
      ? badge.dataset.mwbadge
      : `mw_${badge.dataset.mwbadge.split('.').join('_')}`;
    const isDup = dup.has(keyExpanded);
    badge.classList.toggle('hidden', !isDup);
    badge.classList.toggle('inline-flex', isDup);
  });

  // selects (pads + labores): borde rojo en duplicados
  editor.querySelectorAll('select.mwSel, select[data-mw-labore], select[data-mw-presidente]').forEach(sel => {
    let key;
    if (sel.classList.contains('mwSel')) key = `mw_${sel.dataset.sec}_${sel.dataset.part}_${sel.dataset.slot}`;
    else if (sel.dataset.mwLabore !== undefined) key = `labores_${sel.dataset.mwLabore}_${sel.dataset.mwLaboreIdx}`;
    else key = 'mw_presidente';
    const isDup = dup.has(key);
    sel.classList.toggle('border-error', isDup);
    sel.classList.toggle('border-outline-variant', !isDup);
  });
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
  const l = ensureLabores(w).labores;
  const rows = LABORES_DEF.map(({ key, label, count }) => {
    const slots = Array.isArray(l[key]) && key !== 'plataforma' && key !== 'sonido' ? l[key] : [l[key] || ''];
    const names = Array.from({ length: count }, (_, si) => { const v = slots[si] || ''; return v ? personNameOf(v) : null; }).filter(Boolean);
    return `<div class="flex justify-between text-[9px] leading-tight">
      <span class="text-gray-500">${label}</span>
      <span class="font-semibold text-gray-700 text-right">${names.length ? escapeHtml(names.join(' · ')) : '—'}</span>
    </div>`;
  }).join('');
  return `<div class="border-t border-dashed border-gray-300 mt-1.5 pt-1">
    <div class="text-[8px] uppercase tracking-widest text-gray-500 font-bold mb-0.5">LABORES · TRAS BAMBALINAS</div>
    ${rows}
  </div>`;
}

/* Cuadro de Atención departamentos (labores) para las vistas de lista */
function previewLaboresBox(w) {
  const l = ensureLabores(w).labores;
  const rows = LABORES_DEF.map(({ key, label, count }) => {
    const slots = Array.isArray(l[key]) && key !== 'plataforma' && key !== 'sonido'
      ? l[key]
      : [l[key] || ''];
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
    <div class="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">LABORES · TRAS BAMBALINAS</div>
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
async function quickAddPerson(preselectRole = '') {
  return new Promise((resolve) => {
    const allRoles = state.roles.map(r => `<label class="flex items-center gap-2 text-sm">
      <input type="checkbox" data-prole="${r.id}" ${preselectRole === r.id ? 'checked' : ''} class="accent-primary">
      <span>${r.label}</span>
    </label>`).join('');
    openModal(`<div>
      <h3 class="font-headline-md text-headline-md text-primary mb-4">Agregar</h3>
      <input id="qpName" type="text" placeholder="Nombre completo" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary mb-4">
      <p class="text-on-surface-variant font-label-md text-label-md mb-2">Roles:</p>
      <div class="grid grid-cols-2 gap-2 mb-4">${allRoles}</div>
      <div class="flex gap-3 justify-end">
        <button id="qpCancel" class="px-4 py-2 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cancelar</button>
        <button id="qpOk" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Agregar</button>
      </div>
    </div>`);
    const submit = async () => {
      const name = $('#qpName').value.trim();
      if (!name) { toast('Nombre vacío', 'error'); return; }
      const roles = Array.from(document.querySelectorAll('[data-prole]:checked')).map(c => c.dataset.prole);
      try { await db.addPerson({ name, roles }); await refreshCatalogs(); toast('Persona agregada', 'success'); }
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
  const iso = date.toISOString().slice(0, 10);
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
    labores: newLabores(),
  };
}

// Estructura por defecto de las labores de una semana (derivada de LABORES_DEF)
function newLabores() {
  return Object.fromEntries(LABORES_DEF.map(({ key, count }) => [key, count > 1 ? Array(count).fill('') : '']));
}

// Garantiza que una semana tenga su objeto de labores
function ensureLabores(w) {
  if (!w) w = {};
  if (!w.labores) w.labores = newLabores();
  const d = newLabores();
  LABORES_DEF.forEach(({ key }) => {
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

function personNameOf(id) {
  if (!id) return '—';
  const p = state.people.find(x => String(x.id) === String(id));
  return p ? p.name : '—';
}
function deptNameOf(id) {
  if (!id) return '—';
  const d = state.departments.find(x => String(x.id) === String(id));
  return d ? d.name : '—';
}