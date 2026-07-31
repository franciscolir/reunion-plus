// app.js - Lógica principal de Reunión+
import * as db from './db.js';

/* ---------- Estado ---------- */
const state = {
  view: 'home',           // home | new | edit | preview | lists | settings | about
  monthId: null,          // "YYYY-MM"
  month: null,
  previewMode: 'lista',   // lista | tabla
  people: [],
  departments: [],
  talks: [],              // lista de discursos públicos [{num, title}]
  toastsOpen: new Set(),
};

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const WEEK_TYPES = {
  normal:      { label: 'Normal',              icon: 'calendar_today' },
  supervisor:  { label: 'Visita del Supervisor',icon: 'verified' },
  assembly:    { label: 'Asamblea',             icon: 'event_busy' },
  commemoration:{ label: 'Conmemoración',       icon: 'stars' },
};

// Mapea el nombre interno del campo al rol de la lista de personas.
// Si un campo no está aquí (ej. orador de reunión normal), es texto libre.
const FIELD_ROLE = {
  presidente:        'presidente',
  conductor:         'conductor',
  lector:            'lector',
  estudioSinLectura: 'conductor',
  oradorSalida:      'orador',
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
    { id: 'home', icon: 'calendar_month', label: 'Programas', view: 'home' },
    { id: 'new', icon: 'add_circle', label: 'Nuevo Programa', view: 'new' },
    { id: 'lists', icon: 'group', label: 'Personas y Deptos.', view: 'lists' },
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

/* ---------- HOME: listado y selección de mes ---------- */
async function renderHome() {
  state.month = null;
  const months = await db.listMonths();
  months.sort((a, b) => b.id.localeCompare(a.id));
  const app = $('#app');
  app.innerHTML = `
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10">
      <div>
        <h1 class="font-display-lg text-display-lg text-primary mb-2">Programa de Reuniones</h1>
        <p class="text-on-surface-variant font-body-lg text-body-lg max-w-2xl">Prepare el programa mensual en minutos. Seleccione el mes para comenzar o continúe con un programa existente.</p>
      </div>
      <button id="btnNew" class="flex items-center gap-2 bg-primary text-on-primary px-5 py-3 rounded-lg font-label-md text-label-md hover:shadow-lg transition-all active:scale-95">
        <span class="material-symbols-outlined text-[20px]">add_circle</span>
        Nuevo Programa
      </button>
    </div>
    <div id="monthsList" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter"></div>
  `;
  $('#btnNew').onclick = () => go('new');

  const list = $('#monthsList');
  if (months.length === 0) {
    list.innerHTML = `<div class="col-span-full text-center py-16 border-2 border-dashed border-outline-variant rounded-xl">
      <span class="material-symbols-outlined text-primary text-6xl mb-4">calendar_month</span>
      <p class="text-on-surface-variant font-body-lg">Aún no hay programas creados. Pulse "Nuevo Programa" para comenzar.</p>
    </div>`;
    return;
  }
  list.innerHTML = months.map(m => {
    const filled = m.weeks.filter(w => w.type === 'assembly' || weekComplete(w, m)).length;
    const pct = Math.round((filled / m.weeks.length) * 100);
    return `<article class="week-card-accent bg-surface-container-lowest rounded-lg shadow-[0px_4px_20px_rgba(0,0,0,0.04)] p-6 border border-outline-variant hover:shadow-[0px_8px_30px_rgba(0,0,0,0.08)] transition-shadow flex flex-col gap-4">
      <div class="flex justify-between items-start">
        <div>
          <span class="inline-block px-3 py-1 ${m.published ? 'bg-tertiary-fixed text-on-tertiary-fixed' : 'bg-secondary-container text-on-secondary-container'} font-label-md text-label-md rounded-full">${m.published ? 'Final' : 'Borrador'}</span>
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
      renderHome();
    }
  });
}

/* ---------- NEW: selección de mes/año + opciones ---------- */
async function renderNew() {
  state.month = null;
  const months = await db.listMonths();
  const now = new Date();
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const app = $('#app');
  app.innerHTML = `
    <h1 class="font-headline-lg text-headline-lg text-primary mb-6">Nuevo Programa</h1>
    <div class="max-w-xl bg-surface-container-lowest rounded-xl shadow-[0px_4px_20px_rgba(0,0,0,0.04)] p-6 md:p-8 border border-outline-variant">
      <div class="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Mes</label>
          <select id="nmMonth" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
            ${MONTHS_ES.map((n, i) => `<option value="${i + 1}" ${i === now.getMonth() ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block font-label-md text-label-md text-on-surface-variant mb-2">Año</label>
          <select id="nmYear" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary"></select>
        </div>
      </div>

      <div class="bg-surface-container rounded-lg p-4 mb-6">
        <p class="font-label-md text-label-md text-on-surface-variant uppercase mb-2">Sábados detectados</p>
        <div id="nmPreview" class="flex flex-wrap gap-2"></div>
      </div>

      ${months.length > 0 ? `
      <div class="border-t border-outline-variant pt-6 mb-6">
        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" id="nmDuplicate" class="w-5 h-5 accent-primary">
          <span class="font-body-lg text-body-lg text-on-surface">Usar el mes anterior como base</span>
        </label>
        <select id="nmDupFrom" class="w-full mt-3 bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary disabled:opacity-50">
          ${months.sort((a, b) => b.id.localeCompare(a.id)).map(m => `<option value="${m.id}">${MONTHS_ES[m.month - 1]} ${m.year}</option>`).join('')}
        </select>
      </div>` : ''}

      <button id="nmCreate" class="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:opacity-90 active:scale-95 transition-all">
        Crear Programa
      </button>
    </div>
  `;
  const yearSel = $('#nmYear');
  yearSel.innerHTML = years.map(y => `<option value="${y}" ${y === now.getFullYear() ? 'selected' : ''}>${y}</option>`).join('');

  const preview = () => {
    const m = parseInt($('#nmMonth').value, 10);
    const y = parseInt(yearSel.value, 10);
    const sats = saturdaysOf(y, m);
    $('#nmPreview').innerHTML = sats.length
      ? sats.map(s => `<span class="px-3 py-1 bg-primary text-on-primary rounded font-label-md text-label-md">${formatShort(s)}</span>`).join('')
      : `<span class="text-error font-label-md">No hay sábados en este mes.</span>`;
  };
  $('#nmMonth').onchange = preview;
  yearSel.onchange = preview;
  preview();

  const dupChk = $('#nmDuplicate');
  const dupSel = $('#nmDupFrom');
  if (dupChk) dupChk.onchange = () => dupSel.disabled = !dupChk.checked;
  if (dupSel) dupSel.disabled = true;

  $('#nmCreate').onclick = async () => {
    const m = parseInt($('#nmMonth').value, 10);
    const y = parseInt(yearSel.value, 10);
    const id = `${y}-${String(m).padStart(2, '0')}`;
    if (await db.getMonth(id)) {
      if (!await confirmDialog(`Ya existe un programa para ${MONTHS_ES[m - 1]} ${y}. ¿Sobreescribirlo?`, 'Sobreescribir')) return;
    }
    const sats = saturdaysOf(y, m);
    let weeks = sats.map(d => newWeek(d));
    if (dupChk?.checked && dupSel?.value) {
      const src = await db.getMonth(dupSel.value);
      if (src && src.weeks.length) {
        // Copiar asignaciones del mes anterior, alineando por orden de semana
        weeks = weeks.map((w, i) => {
          const tpl = src.weeks[i] || src.weeks[src.weeks.length - 1];
          return { ...tpl, date: w.date, id: w.id };
        });
        toast('Asignaciones copiadas del mes anterior', 'success');
      }
    }
    const month = { id, year: y, month: m, weeks, published: false };
    await db.putMonth(month);
    toast('Programa creado', 'success');
    go('edit', { monthId: id });
  };
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
        <button id="btnDupPrev" class="flex items-center justify-center gap-2 border border-outline px-4 py-2.5 rounded-lg font-label-md text-label-md hover:bg-surface-container transition-colors">
          <span class="material-symbols-outlined text-[20px]">content_copy</span>
          Copiar Mes Anterior
        </button>
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
    <div id="outingsBar"></div>
    <div id="weeksContainer" class="space-y-6"></div>
    <div class="mt-10 flex flex-col sm:flex-row gap-3 justify-end no-print">
      <button id="btnSave" class="flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-primary text-on-primary font-bold hover:opacity-90 active:scale-95 transition-all">
        <span class="material-symbols-outlined">save</span> Guardar Cambios
      </button>
    </div>
  `;
  renderOutingsBar();
  renderWeeks();
  $('#btnPreview').onclick = () => go('preview', { monthId: state.monthId });
  $('#btnOutings').onclick = () => go('outings', { monthId: state.monthId });
  $('#btnSave').onclick = saveMonth;
  $('#btnDupPrev').onclick = duplicatePrev;
}

/* ---------- EDIT: barra de congregaciones (datos de salida) ---------- */
function renderOutingsBar() {
  const bar = $('#outingsBar');
  if (!bar) return;
  const outs = state.month.outings || [];
  bar.innerHTML = `
    <div class="bg-secondary-container/40 border border-secondary rounded-lg p-4 md:p-5 mb-6">
      <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 class="font-headline-md text-headline-md text-secondary flex items-center gap-2">
          <span class="material-symbols-outlined">campaign</span> Datos de Salida
        </h2>
        <button id="addCongBtn" class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-secondary text-secondary font-label-md text-label-md hover:bg-secondary-fixed/60 transition-colors">
          <span class="material-symbols-outlined text-[18px]">add</span> Agregar congregación
        </button>
      </div>
      <div id="congList" class="grid grid-cols-1 md:grid-cols-2 gap-4"></div>
      <p class="text-on-surface-variant text-caption mt-3">Estos datos se incluirán en la Vista de Salidas. Puede haber varias congregaciones visitadas en el mes.</p>
    </div>
  `;
  const list = $('#congList');
  list.innerHTML = outs.map((c, i) => congCard(c, i)).join('');
  list.querySelectorAll('[data-cong-field]').forEach(bindCongFieldChange);
  list.querySelectorAll('[data-cong-del]').forEach(b => b.onclick = async () => {
    if (state.month.outings.length <= 1) { toast('Debe haber al menos una congregación', 'error'); return; }
    if (await confirmDialog('¿Eliminar esta congregación?')) {
      state.month.outings.splice(parseInt(b.dataset.congDel, 10), 1);
      renderOutingsBar();
    }
  });
  $('#addCongBtn').onclick = () => {
    state.month.outings.push(newCongregation());
    renderOutingsBar();
  };
}

function congCard(c, i) {
  return `<div class="bg-surface-container-lowest rounded-lg p-4 border border-outline-variant space-y-3" data-cong-idx="${i}">
    <div class="flex items-center justify-between">
      <span class="font-label-md text-label-md text-secondary uppercase">Congregación ${i + 1}</span>
      <button data-cong-del="${i}" class="text-error" title="Eliminar"><span class="material-symbols-outlined text-[18px]">delete</span></button>
    </div>
    <div>
      <label class="block font-label-md text-label-md text-on-surface-variant mb-1">Nombre de la congregación</label>
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
  container.querySelectorAll('select[data-dept]').forEach(fillDepartments);
  container.querySelectorAll('[data-add-person]').forEach(b => {
    b.onclick = () => {
      const sel = b.parentElement?.querySelector('select[data-people]');
      const role = sel?.dataset.role || '';
      quickAddPerson(role).then(refreshPeopleSelects);
    };
  });
  container.querySelectorAll('[data-add-dept]').forEach(b => {
    b.onclick = () => quickAddDepartment().then(refreshDeptSelects);
  });
  container.querySelectorAll('[data-talkpicker]').forEach(bindTalkPicker);
  bindOutingControls(container);
}

/* ---------- Talk Picker: buscador de discurso por nº o palabra clave ---------- */
function normalizeStr(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function searchTalks(query, limit = 30) {
  const q = normalizeStr(query).trim();
  if (!q) return state.talks.slice(0, limit);
  const isNumber = /^\d+$/.test(q);
  const results = [];
  for (const t of state.talks) {
    if (isNumber && String(t.num) === q) { results.unshift(t); continue; }
    if (isNumber && String(t.num).startsWith(q)) { results.push(t); continue; }
    if (normalizeStr(t.title).includes(q)) results.push(t);
    if (results.length >= limit * 2) break;
  }
  return results.slice(0, limit);
}

function bindTalkPicker(root) {
  const input = root.querySelector('input[data-field]');
  const box = root.querySelector('.talk-suggestions');
  if (!input || !box) return;
  let highlighted = -1;

  const render = (q) => {
    const results = searchTalks(q);
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
  const dateLabel = `${capitalize(date.toLocaleDateString('es', { weekday: 'long' }))} ${date.getDate()}`;
  const typeOpts = Object.entries(WEEK_TYPES).map(([k, v]) =>
    `<option value="${k}" ${w.type === k ? 'selected' : ''}>${v.label}</option>`
  ).join('');

  return `<section class="week-card-accent bg-surface-container-lowest rounded-lg shadow-[0px_4px_20px_rgba(0,0,0,0.04)] p-6 md:p-8 border ${w.type !== 'normal' ? 'border-primary' : 'border-outline-variant'} hover:shadow-[0px_8px_30px_rgba(0,0,0,0.08)] transition-shadow">
    <div class="flex flex-col lg:flex-row gap-8">
      <div class="lg:w-1/4">
        <div class="mb-2 flex items-center gap-1 text-secondary font-bold text-[10px] uppercase">
          <span class="material-symbols-outlined text-[14px]">${WEEK_TYPES[w.type].icon}</span> ${WEEK_TYPES[w.type].label}
        </div>
        <div class="inline-block px-3 py-1 bg-primary text-on-primary font-label-md text-label-md rounded mb-3">${dateLabel}</div>
        <h3 class="font-headline-md text-headline-md text-primary mb-1">Semana ${i + 1}</h3>
        <p class="text-on-surface-variant font-caption text-caption uppercase tracking-wider">${date.toLocaleDateString('es', { day: 'numeric', month: 'long' })}</p>
        <div class="mt-4 space-y-2">
          <label class="font-label-md text-label-md text-on-surface-variant">Tipo de Evento</label>
          <select data-field="type" data-idx="${i}" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2 font-body-md focus:border-primary">${typeOpts}</select>
        </div>
      </div>
      <div class="flex-1 space-y-6" data-fields="${i}">${fieldsFor(w, i, conflicts)}</div>
    </div>
    ${w.type === 'normal' ? outingsSection(w, i) : ''}
  </section>`;
}

/* ---------- EDIT: sección Salidas (sólo semanas normales) ---------- */
function outingsSection(w, i) {
  const outs = Array.isArray(w.outings) ? w.outings : [newOuting()];
  const occConflicts = computeOutingConflicts(state.month, i);
  const rows = outs.map((o, j) => outingRow(o, i, j, occConflicts)).join('');
  return `<div class="mt-6 pt-6 border-t-2 border-dashed border-secondary/40 rounded-lg">
    <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
      <div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-secondary">campaign</span>
        <h4 class="font-headline-md text-headline-md text-secondary">Salidas de esta semana</h4>
      </div>
      <button data-outing-add="${i}" class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary text-on-secondary font-label-md text-label-md hover:bg-secondary-container transition-colors">
        <span class="material-symbols-outlined text-[18px]">person_add</span> Agregar orador
      </button>
    </div>
    <div class="grid grid-cols-1 gap-4" data-outing-list="${i}">${rows}</div>
  </div>`;
}

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

function computeOutingConflicts(month, i) {
  const w = month.weeks[i];
  const outs = (Array.isArray(w.outings) ? w.outings : []);
  const seen = {};
  const duplicates = [];
  outs.forEach((o, j) => {
    const v = o.oradorSalida;
    if (!v) return;
    if (seen[v] === undefined) seen[v] = j;
    else duplicates.push(j);
  });
  return { duplicates };
}

function bindOutingControls(scope) {
  // selects de orador
  scope.querySelectorAll('select[data-outing-field][data-people]').forEach(sel => {
    fillOutingPeople(sel);
    sel.addEventListener('change', () => {
      const [wi, oi] = sel.dataset.outingIdx.split('.').map(Number);
      let v = sel.value; v = v === '' ? '' : parseInt(v, 10);
      state.month.weeks[wi].outings[oi].oradorSalida = v;
      renderWeeks();
    });
  });
  // input del discurso (talk picker reutilizado)
  scope.querySelectorAll('[data-talkpicker-out]').forEach(bindTalkPickerOut);
  // botón añadir orador
  scope.querySelectorAll('[data-outing-add]').forEach(b => b.onclick = () => {
    const wi = parseInt(b.dataset.outingAdd, 10);
    state.month.weeks[wi].outings.push(newOuting());
    renderWeeks();
  });
  // eliminar orador
  scope.querySelectorAll('[data-outing-del]').forEach(b => b.onclick = async () => {
    const [wi, oi] = b.dataset.outingDel.split('.').map(Number);
    if (state.month.weeks[wi].outings.length <= 1) { toast('Debe haber al menos un orador por semana', 'error'); return; }
    if (await confirmDialog('¿Eliminar este orador de la salida?')) {
      state.month.weeks[wi].outings.splice(oi, 1);
      renderWeeks();
    }
  });
}

// Talk picker para salidas (guarda en outings[oi].tituloDiscurso / talkNum)
function bindTalkPickerOut(root) {
  const input = root.querySelector('input[data-outing-field]');
  const box = root.querySelector('.talk-suggestions');
  if (!input || !box) return;
  let highlighted = -1;
  const render = (q) => {
    const results = searchTalks(q);
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
      ${textInput('nombreSupervisor', i, w.nombreSupervisor || '', 'Nombre del supervisor (a mano)', conflicts)}
      ${textInput('discursoSupervisor1', i, w.discursoSupervisor1 || '', 'Título del primer discurso del supervisor', conflicts)}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${peopleSelect('presidente', i, w.presidente, 'Presidente', conflicts)}
        ${peopleSelect('estudioSinLectura', i, w.estudioSinLectura, 'Conductor del estudio (sin lectura)', conflicts)}
        ${textInput('discursoSupervisor2', i, w.discursoSupervisor2 || '', 'Segundo discurso del supervisor', conflicts)}
      </div>`;
  }
  // normal
  return `
    ${talkPicker('tituloDiscurso', i, w.tituloDiscurso || '', 'Título del discurso público', conflicts)}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      ${peopleSelect('presidente', i, w.presidente, 'Presidente', conflicts)}
      ${textInput('orador', i, w.orador || '', 'Nombre del orador (a mano)', conflicts)}
      ${peopleSelect('conductor', i, w.conductor, 'Conductor del estudio grupal', conflicts)}
      ${peopleSelect('lector', i, w.lector, 'Lector', conflicts)}
      ${deptSelect('departamento', i, w.departamento, 'Grupo de atención', conflicts)}
    </div>`;
}

function textInput(name, idx, val, placeholder, conflicts) {
  const ok = !conflicts.missing?.includes(name);
  return `<div class="space-y-2">
    <label class="font-label-md text-label-md text-on-surface-variant">${capField(labelOf(name))}</label>
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
      ${capField(labelOf(name))}
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
  const badge = hasConflict ? `<span class="flex items-center gap-1 text-error font-bold text-[10px] uppercase conflict-dot"><span class="material-symbols-outlined text-[14px]">warning</span> Conflicto</span>` : '';
  const errClass = (hasConflict || missing) ? 'bg-error-container/20 border-error' : 'border-outline-variant';
  const roleHint = role ? `data-role="${role}"` : '';
  return `<div class="space-y-2 relative">
    <label class="font-label-md text-label-md text-on-surface-variant flex items-center justify-between">${label} ${badge}</label>
    <div class="flex gap-2">
      <select data-field="${name}" data-idx="${idx}" data-people ${roleHint} class="flex-1 bg-surface-bright border ${errClass} rounded-lg p-2.5 font-body-md focus:border-primary">
        <option value="">— Sin asignar —</option>
      </select>
      <button type="button" data-add-person class="px-2 rounded-lg border border-outline-variant hover:bg-surface-container transition-colors" title="Nueva persona"><span class="material-symbols-outlined text-[18px]">person_add</span></button>
    </div>
  </div>`;
}

function deptSelect(name, idx, val, label, conflicts) {
  const missing = conflicts.missing?.includes(name);
  const errClass = missing ? 'border-error' : 'border-outline-variant';
  return `<div class="space-y-2">
    <label class="font-label-md text-label-md text-on-surface-variant">${label}</label>
    <div class="flex gap-2">
      <select data-field="${name}" data-idx="${idx}" data-dept class="flex-1 bg-surface-bright border ${errClass} rounded-lg p-2.5 font-body-md focus:border-primary">
        <option value="">— Sin asignar —</option>
      </select>
      <button type="button" data-add-dept class="px-2 rounded-lg border border-outline-variant hover:bg-surface-container transition-colors" title="Nuevo grupo"><span class="material-symbols-outlined text-[18px]">create_new_folder</span></button>
    </div>
  </div>`;
}

function fillPeople(sel) {
  if (sel.dataset.idx === undefined) return;       // ignorar selects de salidas (usan data-outing-idx)
  const current = parseInt(sel.dataset.idx, 10);
  const field = sel.dataset.field;
  if (!state.month || !state.month.weeks[current]) return;
  const val = state.month.weeks[current][field];
  const role = sel.dataset.role || '';
  const list = role
    ? state.people.filter(p => !Array.isArray(p.roles) || p.roles.length === 0 || p.roles.includes(role))
    : state.people;
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
  const list = state.people.filter(p => !Array.isArray(p.roles) || p.roles.length === 0 || p.roles.includes(role));
  sel.innerHTML = `<option value="">— Sin asignar —</option>` +
    list.map(p => `<option value="${p.id}" ${String(p.id) === String(val) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
}
function fillDepartments(sel) {
  const current = parseInt(sel.dataset.idx, 10);
  const field = sel.dataset.field;
  const val = state.month.weeks[current][field];
  sel.innerHTML = `<option value="">— Sin asignar —</option>` +
    state.departments.map(d => `<option value="${d.id}" ${String(d.id) === String(val) ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('');
}
function refreshPeopleSelects() {
  document.querySelectorAll('select[data-people]').forEach(fillPeople);
}
function refreshDeptSelects() {
  document.querySelectorAll('select[data-dept]').forEach(fillDepartments);
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

async function duplicatePrev() {
  const months = await db.listMonths();
  const prev = months.filter(m => m.id < state.month.id).sort((a, b) => b.id.localeCompare(a.id))[0];
  if (!prev) { toast('No hay mes anterior disponible', 'info'); return; }
  if (!await confirmDialog(`¿Copiar las asignaciones de ${MONTHS_ES[prev.month - 1]} ${prev.year}? Se reemplazarán las asignaciones actuales.`, 'Copiar')) return;
  state.month.weeks = state.month.weeks.map((w, i) => {
    const tpl = prev.weeks[i] || prev.weeks[prev.weeks.length - 1];
    return { ...tpl, date: w.date, id: w.id };
  });
  await db.putMonth(state.month);
  toast('Asignaciones copiadas', 'success');
  renderEdit();
}

/* ---------- Validación ---------- */
function computeConflicts(month) {
  const perWeek = month.weeks.map(() => ({ duplicates: [], missing: [] }));
  const errors = [];
  month.weeks.forEach((w, i) => {
    // campos requeridos por tipo
    let required = [];
    let personFields = [];
    if (w.type === 'normal') {
      required = ['presidente', 'tituloDiscurso', 'orador', 'conductor', 'lector', 'departamento'];
      personFields = ['presidente', 'conductor', 'lector'];
    } else if (w.type === 'supervisor') {
      required = ['presidente', 'nombreSupervisor', 'discursoSupervisor1', 'estudioSinLectura'];
      personFields = ['presidente', 'estudioSinLectura'];
    } else if (w.type === 'commemoration') {
      required = ['presidente', 'tituloDiscurso', 'orador'];
      personFields = ['presidente'];
    }
    required.forEach(f => {
      const v = w[f];
      if (v === '' || v === undefined || v === null) {
        perWeek[i].missing.push(f);
        errors.push(`Semana ${i + 1}: falta ${labelOf(f)}`);
      }
    });
    // duplicados en misma reunión
    const seen = {};
    personFields.forEach(f => {
      const v = w[f];
      if (!v) return;
      if (seen[v]) {
        perWeek[i].duplicates.push(f);
        if (!perWeek[i].duplicates.includes(seen[v])) perWeek[i].duplicates.push(seen[v]);
        errors.push(`Semana ${i + 1}: ${labelOf(f)} y ${labelOf(seen[v])} asignados a la misma persona`);
      } else seen[v] = f;
    });
  });
  return { perWeek, errors };
}

function weekComplete(w, month) {
  const c = computeConflicts({ weeks: [w] }).perWeek[0];
  return c.missing.length === 0 && c.duplicates.length === 0;
}

/* ---------- PREVIEW: lista y tabla ---------- */
async function renderPreview() {
  if (!state.monthId) { go('home'); return; }
  const m = await db.getMonth(state.monthId);
  if (!m) { toast('Programa no encontrado', 'error'); go('home'); return; }
  state.month = m;
  renderTop();
  const app = $('#app');
  app.innerHTML = `
    <div class="mb-10 text-center md:text-left">
      <div class="flex items-center gap-3 mb-2 justify-center md:justify-start">
        <span class="editorial-line w-12 hidden md:block"></span>
        <p class="font-label-md text-label-md text-secondary uppercase tracking-widest">Programación Mensual</p>
      </div>
      <h1 class="font-display-lg text-display-lg text-primary mb-2 leading-tight">${MONTHS_ES[m.month - 1].toUpperCase()} ${m.year} — Programa de Reuniones</h1>
      <p class="font-body-lg text-body-lg text-on-surface-variant max-w-2xl">Visualización final. Revisa el programa antes de compartirlo o imprimirlo.</p>
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
    rows.push(['Discurso Público', w.tituloDiscurso || '—', 'mic_external_on']);
    rows.push(['Presidente', presName, 'person']);
    rows.push(['Orador', w.orador || '—', 'campaign']);
    rows.push(['Conductor (estudio)', personNameOf(w.conductor), 'menu_book']);
    rows.push(['Lector', personNameOf(w.lector), 'library_books']);
    rows.push(['Grupo de atención', deptNameOf(w.departamento), 'handshake']);
  } else if (w.type === 'supervisor') {
    rows.push(['Supervisor', w.nombreSupervisor || '—', 'supervisor_account']);
    rows.push(['1er Discurso Supervisor', w.discursoSupervisor1 || '—', 'campaign']);
    rows.push(['Presidente', presName, 'person']);
    rows.push(['Estudio (sin lectura)', personNameOf(w.estudioSinLectura), 'menu_book']);
    rows.push(['2do Discurso Supervisor', w.discursoSupervisor2 || '—', 'campaign']);
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
  </div>`;
}

function previewTabla() {
  const rows = state.month.weeks.map((w, i) => {
    const date = new Date(w.date + 'T00:00:00');
    const dateStr = date.toLocaleDateString('es', { day: '2-digit', month: 'long' });
    if (w.type === 'assembly') {
      return `<tr class="transition-colors"><td class="p-6 bg-surface-variant/50 text-center col-span-7" colspan="7">
        <div class="py-6">
          <div class="font-headline-md text-headline-md text-primary uppercase tracking-widest">Asamblea</div>
          <div class="font-body-lg text-body-lg text-on-surface-variant mt-1">${dateStr} — No hay reunión local</div>
        </div></td></tr>`;
    }
    let cells = {
      title: '—', chairman: '—', speaker: '—', conductor: '—', reader: '—', attendance: '—', badge: WEEK_TYPES[w.type].label
    };
    if (w.type === 'normal') {
      cells.title = w.tituloDiscurso || '—';
      cells.chairman = personNameOf(w.presidente);
      cells.speaker = w.orador || '—';
      cells.conductor = personNameOf(w.conductor);
      cells.reader = personNameOf(w.lector);
      cells.attendance = deptNameOf(w.departamento);
    } else if (w.type === 'supervisor') {
      cells.title = `${w.discursoSupervisor1 || '—'}<div class="text-caption text-secondary uppercase mt-1">1er discurso</div>${w.discursoSupervisor2 ? `<div class="mt-2">${escapeHtml(w.discursoSupervisor2)}<div class="text-caption text-secondary uppercase">2do discurso</div></div>` : ''}`;
      cells.chairman = personNameOf(w.presidente);
      cells.speaker = `${escapeHtml(w.nombreSupervisor || '—')}<div class="text-caption text-on-surface-variant">Supervisor</div>`;
      cells.conductor = `${personNameOf(w.estudioSinLectura)}<div class="text-caption text-on-surface-variant">sin lectura</div>`;
      cells.reader = '—';
    } else if (w.type === 'commemoration') {
      cells.title = w.tituloDiscurso || '—';
      cells.chairman = personNameOf(w.presidente);
      cells.speaker = w.orador || '—';
      cells.conductor = '—';
      cells.reader = '—';
      cells.attendance = 'Conmemoración';
      cells.badge = 'Conmemoración';
    }
    const highlight = w.type !== 'normal' ? 'bg-secondary-container/10' : '';
    return `<tr class="table-row-hover transition-colors">
      <td class="p-6 align-top ${highlight}">
        <div class="flex items-center gap-2 mb-1">
          <div class="font-headline-md text-headline-md text-primary">Semana ${i + 1}</div>
          <span class="px-2 py-0.5 ${w.type === 'normal' ? 'bg-outline text-on-surface' : 'bg-primary text-on-primary'} text-[10px] font-bold rounded uppercase tracking-tighter">${cells.badge}</span>
        </div>
        <div class="font-body-md text-body-md text-on-surface-variant">${dateStr}</div>
      </td>
      <td class="p-6 align-top max-w-xs ${highlight}"><div class="font-body-lg text-body-lg text-primary leading-tight font-semibold">${cells.title}</div></td>
      <td class="p-6 align-top ${highlight}"><div class="font-body-md text-body-md">${cells.chairman}</div></td>
      <td class="p-6 align-top ${highlight}"><div class="font-body-md text-body-md font-semibold">${cells.speaker}</div></td>
      <td class="p-6 align-top ${highlight}"><div class="font-body-md text-body-md">${cells.conductor}</div></td>
      <td class="p-6 align-top ${highlight}"><div class="font-body-md text-body-md">${cells.reader}</div></td>
      <td class="p-6 align-top ${highlight}"><div class="font-body-md text-body-md text-primary font-bold">${cells.attendance}</div></td>
    </tr>`;
  }).join('');
  return `<div class="overflow-x-auto">
    <table class="w-full text-left border-collapse min-w-[900px]">
      <thead>
        <tr class="bg-surface-container-low border-b border-outline-variant">
          <th class="p-6 font-label-md text-label-md text-secondary uppercase">Semana / Fecha</th>
          <th class="p-6 font-label-md text-label-md text-secondary uppercase">Discurso</th>
          <th class="p-6 font-label-md text-label-md text-secondary uppercase">Presidente</th>
          <th class="p-6 font-label-md text-label-md text-secondary uppercase">Orador</th>
          <th class="p-6 font-label-md text-label-md text-secondary uppercase">Estudio</th>
          <th class="p-6 font-label-md text-label-md text-secondary uppercase">Lector</th>
          <th class="p-6 font-label-md text-label-md text-secondary uppercase">Grupo</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant">${rows}</tbody>
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
const ALL_ROLES = [
  { id: 'presidente', label: 'Presidente' },
  { id: 'conductor',  label: 'Conductor / Estudio (sin lectura)' },
  { id: 'orador',     label: 'Orador (salidas)' },
  { id: 'lector',     label: 'Lector' },
];

async function renderLists() {
  state.month = null;
  renderTop();
  await refreshCatalogs();
  const app = $('#app');
  app.innerHTML = `
    <h1 class="font-headline-lg text-headline-lg text-primary mb-2">Personas y Grupos</h1>
    <p class="text-on-surface-variant font-body-lg text-body-lg mb-8">Administre las listas que se utilizan en los selectores. Marque los roles de cada persona. Los oradores se escriben a mano en cada programa.</p>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-gutter">
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-6">
        <div class="flex items-center justify-between mb-4">
          <h2 class="font-headline-md text-headline-md text-primary">Personas</h2>
          <span class="text-on-surface-variant font-label-md text-label-md">${state.people.length}</span>
        </div>
        <form id="pForm" class="flex gap-2 mb-4">
          <input id="pName" type="text" placeholder="Nombre completo" class="flex-1 bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          <button class="px-4 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Agregar</button>
        </form>
        <p class="text-on-surface-variant text-caption mb-4">Marque los roles en los que esta persona puede ser asignada:</p>
        <ul id="pList" class="divide-y divide-outline-variant"></ul>
      </div>
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-6">
        <div class="flex items-center justify-between mb-4">
          <h2 class="font-headline-md text-headline-md text-primary">Grupos</h2>
          <span class="text-on-surface-variant font-label-md text-label-md">${state.departments.length}</span>
        </div>
        <form id="dForm" class="flex gap-2 mb-4">
          <input id="dName" type="text" placeholder="Nombre del grupo" class="flex-1 bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary">
          <button class="px-4 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Agregar</button>
        </form>
        <ul id="dList" class="divide-y divide-outline-variant"></ul>
      </div>
    </div>
  `;
  $('#pForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#pName').value.trim();
    if (!name) return;
    try { await db.addPerson({ name, roles: [] }); $('#pName').value = ''; toast('Persona agregada', 'success'); }
    catch (err) { toast(err.message, 'error'); }
    renderLists();
  };
  $('#dForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#dName').value.trim();
    if (!name) return;
    try { await db.addDepartment(name); $('#dName').value = ''; toast('Grupo agregado', 'success'); }
    catch (err) { toast(err.message, 'error'); }
    renderLists();
  };

  $('#pList').innerHTML = state.people.map(p => {
    const roles = Array.isArray(p.roles) ? p.roles : [];
    const checks = ALL_ROLES.map(r => {
      const on = roles.includes(r.id);
      return `<button type="button" data-prole="${r.id}" data-pid="${p.id}"
        class="px-2.5 py-1 rounded-full text-[11px] font-label-md border transition-colors ${on ? 'bg-primary text-on-primary border-primary' : 'bg-surface-bright text-on-surface-variant border-outline-variant hover:bg-surface-container'}">${r.label}</button>`;
    }).join(' ');
    return `<li class="py-3 flex flex-col gap-2">
      <div class="flex items-center justify-between group">
        <span class="font-body-md text-body-md">${escapeHtml(p.name)}</span>
        <button data-pdel="${p.id}" class="text-error opacity-0 group-hover:opacity-100 transition-opacity"><span class="material-symbols-outlined text-[18px]">delete</span></button>
      </div>
      <div class="flex flex-wrap gap-1.5">${checks}</div>
    </li>`;
  }).join('') || `<li class="py-3 text-on-surface-variant text-sm">Sin personas.</li>`;

  $('#pList').querySelectorAll('[data-pdel]').forEach(b => b.onclick = async () => {
    if (await confirmDialog('¿Eliminar esta persona?')) { await db.deletePerson(parseInt(b.dataset.pdel, 10)); renderLists(); }
  });
  // Toggle de rol: añade/quita sin re-render completo (persiste en DB)
  $('#pList').querySelectorAll('[data-prole]').forEach(btn => btn.onclick = async () => {
    const pid = parseInt(btn.dataset.pid, 10);
    const role = btn.dataset.prole;
    const person = state.people.find(x => String(x.id) === String(pid));
    if (!person) return;
    const roles = Array.isArray(person.roles) ? [...person.roles] : [];
    const idx = roles.indexOf(role);
    if (idx === -1) roles.push(role); else roles.splice(idx, 1);
    await db.setPersonRoles(pid, roles);
    // actualizar UI local
    person.roles = roles;
    if (idx === -1) {
      btn.classList.add('bg-primary', 'text-on-primary', 'border-primary');
      btn.classList.remove('bg-surface-bright', 'text-on-surface-variant', 'border-outline-variant', 'hover:bg-surface-container');
    } else {
      btn.classList.remove('bg-primary', 'text-on-primary', 'border-primary');
      btn.classList.add('bg-surface-bright', 'text-on-surface-variant', 'border-outline-variant', 'hover:bg-surface-container');
    }
  });

  $('#dList').innerHTML = state.departments.map(d => `<li class="flex items-center justify-between py-3 group">
    <span class="font-body-md text-body-md">${escapeHtml(d.name)}</span>
    <button data-ddel="${d.id}" class="text-error opacity-0 group-hover:opacity-100 transition-opacity"><span class="material-symbols-outlined text-[18px]">delete</span></button>
  </li>`).join('') || `<li class="py-3 text-on-surface-variant text-sm">Sin grupos.</li>`;
  $('#dList').querySelectorAll('[data-ddel]').forEach(b => b.onclick = async () => {
    if (await confirmDialog('¿Eliminar este grupo?')) { await db.deleteDepartment(parseInt(b.dataset.ddel, 10)); renderLists(); }
  });
}

/* ---------- SETTINGS ---------- */
async function renderSettings() {
  state.month = null;
  renderTop();
  const congregation = await db.getSetting('congregation', '');
  const app = $('#app');
  app.innerHTML = `
    <h1 class="font-headline-lg text-headline-lg text-primary mb-6">Ajustes</h1>
    <div class="max-w-xl bg-surface-container-lowest rounded-xl border border-outline-variant p-6 space-y-6">
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
        <p class="text-on-surface-variant text-caption mt-3">"Recargar" vuelve a leer <code>participantes.json</code> y <code>discursos.json</code> sin borrar los programas.</p>
      </div>
    </div>
  `;
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
    const allRoles = ALL_ROLES.map(r => `<label class="flex items-center gap-2 text-sm">
      <input type="checkbox" data-prole="${r.id}" ${preselectRole === r.id ? 'checked' : ''} class="accent-primary">
      <span>${r.label}</span>
    </label>`).join('');
    openModal(`<div>
      <h3 class="font-headline-md text-headline-md text-primary mb-4">Agregar persona</h3>
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

async function quickAddDepartment() {
  return new Promise((resolve) => {
    openModal(`<div>
      <h3 class="font-headline-md text-headline-md text-primary mb-4">Agregar grupo</h3>
      <input id="qdName" type="text" placeholder="Nombre del grupo" class="w-full bg-surface-bright border border-outline-variant rounded-lg p-2.5 font-body-md focus:border-primary mb-4">
      <div class="flex gap-3 justify-end">
        <button id="qdCancel" class="px-4 py-2 rounded-lg border border-outline font-label-md text-label-md hover:bg-surface-container">Cancelar</button>
        <button id="qdOk" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90">Agregar</button>
      </div>
    </div>`);
    const submit = async () => {
      const name = $('#qdName').value.trim();
      if (!name) { toast('Nombre vacío', 'error'); return; }
      try { await db.addDepartment(name); await refreshCatalogs(); toast('Grupo agregado', 'success'); }
      catch (err) { toast(err.message, 'error'); }
      closeModal(); resolve();
    };
    $('#qdCancel').onclick = () => { closeModal(); resolve(); };
    $('#qdOk').onclick = submit;
    $('#qdName').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    $('#qdName').focus();
  });
}

/* ---------- Exportación ---------- */
function buildShareText() {
  const m = state.month;
  const congo = m && m.id;
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
      lines.push(`Supervisor: ${w.nombreSupervisor || '—'}`);
      lines.push(`1er discurso: ${w.discursoSupervisor1 || '—'}`);
      lines.push(`Presidente: ${personNameOf(w.presidente)}`);
      lines.push(`Estudio (sin lectura): ${personNameOf(w.estudioSinLectura)}`);
      lines.push(`2do discurso: ${w.discursoSupervisor2 || '—'}`);
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
function saturdaysOf(year, month) {
  // month: 1-12
  const out = [];
  const d = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0).getDate();
  for (let day = 1; day <= last; day++) {
    d.setDate(day);
    if (d.getDay() === 6) out.push(new Date(d));
  }
  return out;
}
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
  };
}

// Estructura de una salida (un orador con su discurso)
function newOuting() {
  return {
    id: cryptoId(),
    orador: '',         // id de persona con rol 'orador'
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
function cryptoId() { return 'w_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

function formatShort(date) {
  return date.toLocaleDateString('es', { day: '2-digit', month: 'short' });
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

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

const FIELD_LABELS = {
  tituloDiscurso: 'título del discurso',
  presidente: 'presidente',
  orador: 'orador',
  conductor: 'conductor',
  lector: 'lector',
  departamento: 'grupo de atención',
  nombreSupervisor: 'nombre del supervisor',
  discursoSupervisor1: 'primer discurso',
  discursoSupervisor2: 'segundo discurso',
  estudioSinLectura: 'estudio (sin lectura)',
};
function labelOf(f) { return FIELD_LABELS[f] || f; }
function capField(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeAttr(s) {
  return String(s ?? '').replace(/["'<>]/g, c => ({ '"':'&quot;',"'":'&#39;','<':'&lt;','>':'&gt;' }[c]));
}