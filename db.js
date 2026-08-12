// db.js - Capa de acceso a IndexedDB
// Stores: months (programas mensuales), people, departments, settings, talks, midweeks, aseos

const DB_NAME = 'reunion-plus';
const DB_VERSION = 7;
const STORE_MONTHS = 'months';       // key: "YYYY-MM"
const STORE_PEOPLE = 'people';       // keyPath: id (auto)
const STORE_DEPARTMENTS = 'departments'; // keyPath: id (auto)
const STORE_SETTINGS = 'settings';   // key: string
const STORE_TALKS = 'talks';        // keyPath: num (discurso n°)
const STORE_MIDWEEKS = 'midweeks';   // key: "YYYY-MM-DD" (reunión de entre semana)
const STORE_ASEOS = 'aseos';        // key: "YYYY-MM" (programa de aseo por mes)
const STORE_SALIDAS = 'salidas';    // key: "YYYY-MM" (programa de salidas por mes)
const STORE_ATENCION = 'atencion';  // key: "YYYY-MM" (programa de atención/acomodación por mes)
const STORE_ASSIGNMENT_LOG = 'assignment_log'; // keyPath: id (compuesto person+date+program+role) · historial de asignaciones

let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_MONTHS)) {
        const s = db.createObjectStore(STORE_MONTHS, { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(STORE_PEOPLE)) {
        const s = db.createObjectStore(STORE_PEOPLE, { keyPath: 'id', autoIncrement: true });
        s.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_DEPARTMENTS)) {
        const s = db.createObjectStore(STORE_DEPARTMENTS, { keyPath: 'id', autoIncrement: true });
        s.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS);
      }
      if (!db.objectStoreNames.contains(STORE_TALKS)) {
        const s = db.createObjectStore(STORE_TALKS, { keyPath: 'num' });
        s.createIndex('title', 'title', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MIDWEEKS)) {
        db.createObjectStore(STORE_MIDWEEKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ASEOS)) {
        db.createObjectStore(STORE_ASEOS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SALIDAS)) {
        db.createObjectStore(STORE_SALIDAS, { keyPath: 'id' });
      }
      // Migración v6→v7: el store de labores de acomodación pasa a llamarse
      // 'atencion' (los "roles" del equipo pasan a llamarse "labores").
      // Se usa la transacción de cambio de versión ya abierta (no se puede
      // llamar db.transaction() dentro de onupgradeneeded).
      if (db.objectStoreNames.contains('labores') && !db.objectStoreNames.contains(STORE_ATENCION)) {
        e.target.transaction.objectStore('labores').name = STORE_ATENCION;
      }
      if (!db.objectStoreNames.contains(STORE_ATENCION)) {
        db.createObjectStore(STORE_ATENCION, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ASSIGNMENT_LOG)) {
        db.createObjectStore(STORE_ASSIGNMENT_LOG, { keyPath: 'id' });
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(db, store, mode = 'readonly') {
  return db.transaction(store, mode).objectStore(store);
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ===== COMMIT / SYNC (punto único de escritura) =====
// Toda escritura pasa por commit(), que es el único lugar donde se notifica a
// los hooks de sincronización (p. ej. Firebase). Los hooks se registran con
// onSync(); mientras no haya ninguno (o estén en pausa), los stores modificados
// se acumulan en una cola pendiente para no perder cambios. Al registrar un
// hook se drena la cola.
const syncHooks = new Set();
const pendingSync = []; // nombres de store modificados pendientes de sincronizar

// Registra un hook que se llamará con cada store modificado. Devuelve una
// función para desregistrarlo. Al registrar el primero se drena la cola.
export function onSync(hook) {
  syncHooks.add(hook);
  if (syncHooks.size === 1 && pendingSync.length) {
    const pend = pendingSync.splice(0);
    for (const store of pend) fireSync(store);
  }
  return () => syncHooks.delete(hook);
}

function fireSync(store) {
  for (const h of syncHooks) {
    try { h(store); } catch (e) { console.warn('[Reunión+] Fallo en hook de sincronización', e); }
  }
}

function markDirty(store) {
  if (syncHooks.size) fireSync(store);
  else if (!pendingSync.includes(store)) pendingSync.push(store);
}

// Ejecuta una escritura en el store indicado y marca el store como modificado
// (dispara la sincronización). `run(store)` recibe el objectStore en modo
// readwrite y debe devolver lo que la función exportada debía devolver.
async function commit(storeName, run) {
  const db = await openDB();
  const store = tx(db, storeName, 'readwrite');
  const result = await run(store);
  markDirty(storeName);
  return result;
}

// Es igual que commit() pero no marca el store como modificado (para escrituras
// de seed/importación que no deben sincronizarse registro a registro).
async function commitSilent(storeName, run) {
  const db = await openDB();
  const store = tx(db, storeName, 'readwrite');
  return run(store);
}

// ===== MONTHS =====
export async function getMonth(id) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_MONTHS).get(id));
}

export async function putMonth(month) {
  month.updatedAt = Date.now();
  if (!month.createdAt) month.createdAt = month.updatedAt;
  return commit(STORE_MONTHS, (store) => reqToPromise(store.put(month)));
}

export async function deleteMonth(id) {
  return commit(STORE_MONTHS, (store) => reqToPromise(store.delete(id)));
}

export async function listMonths() {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_MONTHS).getAll());
}

// ===== PEOPLE =====
export async function listPeople() {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_PEOPLE).getAll());
  // Compatibilidad: las personas guardadas con el campo antiguo `roles` se leen
  // como `labores` (renombrado).
  return all
    .map(p => ({ ...p, labores: Array.isArray(p.labores) ? p.labores : (Array.isArray(p.roles) ? p.roles : []) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export async function addPerson(payload) {
  let record;
  if (typeof payload === 'string') {
    const name = payload.trim();
    if (!name) throw new Error('Nombre vacío');
    record = { name, labores: [], cargos: [], genero: '', calificacion: '', createdAt: Date.now() };
  } else {
    const name = (payload.name || '').trim();
    if (!name) throw new Error('Nombre vacío');
    record = {
      name,
      labores: Array.isArray(payload.labores) ? payload.labores : (Array.isArray(payload.roles) ? payload.roles : []),
      cargos: Array.isArray(payload.cargos) ? payload.cargos : (typeof payload.cargos === 'string' && payload.cargos ? payload.cargos.split(',').map(s => s.trim()).filter(Boolean) : []),
      genero: payload.genero || '',
      calificacion: payload.calificacion || '',
      enlace: payload.enlace || '',
      createdAt: Date.now(),
    };
  }
  return commit(STORE_PEOPLE, (store) => reqToPromise(store.add(record)));
}

export async function updatePerson(person) {
  return commit(STORE_PEOPLE, (store) => reqToPromise(store.put(person)));
}

export async function deletePerson(id) {
  return commit(STORE_PEOPLE, (store) => reqToPromise(store.delete(id)));
}

export async function clearPeople() {
  return commit(STORE_PEOPLE, (store) => reqToPromise(store.clear()));
}

// Reemplaza toda la lista de personas desde un archivo con formato de
// participantes.json: { roles: { <labor>: [nombres...], ... } }.
// Inserta personas únicas (por nombre) con sus labores (puestos del equipo).
export async function replaceAllPeople(data) {
  const rolesMap = (data && (data.roles || data.participantes)) || {};
  const merged = {};
  for (const [role, names] of Object.entries(rolesMap)) {
    for (const name of (Array.isArray(names) ? names : [])) {
      const key = String(name).trim().toLowerCase();
      if (!key) continue;
      if (!merged[key]) merged[key] = { name: String(name).trim(), labores: [] };
      if (!merged[key].labores.includes(role)) merged[key].labores.push(role);
    }
  }
  const list = Object.values(merged);
  const now = Date.now();
  // Reemplazo atómico en una sola transacción (sin disparar sync por persona).
  return commit(STORE_PEOPLE, (store) => new Promise((resolve, reject) => {
    let pending = 1 + list.length;
    const done = () => { pending--; if (pending === 0) resolve(list.length); };
    const cl = store.clear();
    cl.onsuccess = done; cl.onerror = () => reject(cl.error);
    for (const p of list) {
      const r = store.add({ ...p, labores: p.labores, createdAt: now });
      r.onsuccess = done; r.onerror = () => reject(r.error);
    }
  }));
}

// Personas filtradas por labor (puesto del equipo). Si una persona no tiene
// `labores` (datos antiguos), se incluye en todos los puestos para no romper
// programas existentes.
export async function listPeopleByLabore(labore) {
  const all = await listPeople();
  return all.filter(p => !Array.isArray(p.labores) || p.labores.length === 0 || p.labores.includes(labore));
}

// Reemplaza las labores (puestos del equipo) de una persona existente.
export async function setPersonLabores(id, labores) {
  const p = await listPeople();
  const person = p.find(x => String(x.id) === String(id));
  if (!person) throw new Error('Persona no encontrada');
  person.labores = Array.isArray(labores) ? labores : [];
  person.updatedAt = Date.now();
  return updatePerson(person);
}

// ===== DEPARTMENTS =====
export async function listDepartments() {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_DEPARTMENTS).getAll());
  return all.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export async function addDepartment(name, opts = {}) {
  name = (name || '').trim();
  if (!name) throw new Error('Nombre vacío');
  const record = { name, createdAt: Date.now() };
  if (opts.orden !== undefined) record.orden = opts.orden;
  if (opts.labores !== undefined) record.labores = opts.labores;
  return commit(STORE_DEPARTMENTS, (store) => reqToPromise(store.add(record)));
}

export async function updateDepartment(dept) {
  return commit(STORE_DEPARTMENTS, (store) => reqToPromise(store.put(dept)));
}

export async function deleteDepartment(id) {
  return commit(STORE_DEPARTMENTS, (store) => reqToPromise(store.delete(id)));
}

// ===== SETTINGS =====
export async function getSetting(key, fallback = null) {
  const db = await openDB();
  const v = await reqToPromise(tx(db, STORE_SETTINGS).get(key));
  return v === undefined ? fallback : v;
}

export async function setSetting(key, value) {
  return commit(STORE_SETTINGS, (store) => reqToPromise(store.put(value, key)));
}

// ===== LABORES (lista editable de puestos del equipo) =====
const SETTING_LABORES = 'labores';
const SETTING_ROLES_OLD = 'roles'; // clave antigua (migración)
export async function getLabores(fallback = null) {
  let v = await getSetting(SETTING_LABORES, null);
  if (Array.isArray(v) && v.length) return v;
  // Migración: leer la lista antigua guardada como 'roles'.
  v = await getSetting(SETTING_ROLES_OLD, null);
  if (Array.isArray(v) && v.length) {
    await setSetting(SETTING_LABORES, v);
    return v;
  }
  return fallback;
}
export async function setLabores(labores) {
  return setSetting(SETTING_LABORES, Array.isArray(labores) ? labores : []);
}

// ===== CONFIG (configuración general) =====
const SETTING_CONFIG = 'config';
export function defaultConfig() {
  return {
    schedule: { day: 6, time: '10:00' }, // día (0=domingo..6=sábado) y hora de comienzo
    midweek: { day: 2, time: '19:00' }, // reunión de entre semana: día y hora
    events: { commemorations: [], visits: [], assemblies: [] },
    groups: { cantidad: 3, start: 1, labores: '' }, // nº de grupos, grupo inicial (1-based), labores comunes
  };
}
export async function getConfig() {
  const v = await getSetting(SETTING_CONFIG, null);
  if (!v || typeof v !== 'object') return defaultConfig();
  return {
    schedule: { ...defaultConfig().schedule, ...(v.schedule || {}) },
    midweek: { ...defaultConfig().midweek, ...(v.midweek || {}) },
    events: {
      commemorations: Array.isArray(v.events?.commemorations) ? v.events.commemorations : [],
      visits: Array.isArray(v.events?.visits) ? v.events.visits : [],
      assemblies: Array.isArray(v.events?.assemblies) ? v.events.assemblies : [],
    },
    groups: { ...defaultConfig().groups, ...(v.groups || {}) },
  };
}
export async function setConfig(cfg) {
  return setSetting(SETTING_CONFIG, cfg);
}

// ===== TALKS (lista de discursos públicos) =====
export async function listTalks() {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_TALKS).getAll());
  return all.sort((a, b) => a.num - b.num);
}

export async function clearTalks() {
  return commit(STORE_TALKS, (store) => reqToPromise(store.clear()));
}

export async function bulkPutTalks(talks) {
  return commit(STORE_TALKS, (store) => new Promise((resolve, reject) => {
    let pending = talks.length;
    if (pending === 0) return resolve();
    for (const t of talks) {
      const r = store.put(t);
      r.onsuccess = () => { pending--; if (pending === 0) resolve(); };
      r.onerror = () => reject(r.error);
    }
  }));
}

// Reemplaza toda la lista de discursos (carga desde JSON): clear + put atómicos.
export async function replaceAllTalks(talks) {
  return commit(STORE_TALKS, (store) => new Promise((resolve, reject) => {
    let pending = 1 + talks.length;
    const done = () => { pending--; if (pending === 0) resolve(); };
    const cl = store.clear();
    cl.onsuccess = done; cl.onerror = () => reject(cl.error);
    for (const t of talks) {
      const r = store.put(t);
      r.onsuccess = done; r.onerror = () => reject(r.error);
    }
  }));
}

// Reemplaza discursos aceptando un array [{num,title}] o { discursos:[...] } o { talks:[...] }.
export async function replaceTalksFromFile(data) {
  const list = Array.isArray(data) ? data
    : (Array.isArray(data?.discursos) ? data.discursos
      : (Array.isArray(data?.talks) ? data.talks : []));
  const normalized = list.map(d => ({ num: Number(d.num), title: String(d.title ?? '') })).filter(d => d.num && d.title);
  await replaceAllTalks(normalized);
  return normalized.length;
}

// ===== MIDWEEKS (reuniones de entre semana) =====
export async function listMidweeks() {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_MIDWEEKS).getAll());
  return all.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export async function getMidweek(id) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_MIDWEEKS).get(id));
}

export async function putMidweek(week) {
  week.updatedAt = Date.now();
  if (!week.createdAt) week.createdAt = week.updatedAt;
  return commit(STORE_MIDWEEKS, (store) => reqToPromise(store.put(week)));
}

export async function deleteMidweek(id) {
  return commit(STORE_MIDWEEKS, (store) => reqToPromise(store.delete(id)));
}

export async function clearMidweeks() {
  return commit(STORE_MIDWEEKS, (store) => reqToPromise(store.clear()));
}

// Reemplaza todas las reuniones de entresemana desde un archivo tipo midweeks.json:
// { weeks: [...] } o un array directo de semanas. Devuelve el nº de semanas cargadas.
export async function replaceAllMidweeks(data) {
  const weeks = (Array.isArray(data) ? data : (Array.isArray(data?.weeks) ? data.weeks : []))
    .map((w, i) => (w && w.id) ? w : ({ ...w, id: midweekFallbackId(w, i) }));
  // clear + put atómicos en una sola transacción.
  return commit(STORE_MIDWEEKS, (store) => new Promise((resolve, reject) => {
    let pending = 1 + weeks.length;
    const done = () => { pending--; if (pending === 0) resolve(weeks.length); };
    const cl = store.clear();
    cl.onsuccess = done; cl.onerror = () => reject(cl.error);
    for (const w of weeks) {
      const r = store.put(w);
      r.onsuccess = done; r.onerror = () => reject(r.error);
    }
  }));
}

// Id de respaldo para una semana que no trae `id` (p. ej. JSON convertido sin id):
// se deriva del encabezado "D-D DE MES" con el año en curso, o se genera uno único.
function midweekFallbackId(w, i) {
  const m = /^(\d{1,2})-(\d{1,2})\s+DE\s+([A-ZÁÉÍÓÚÑ]{3,})$/i.exec(String(w?.header || ''));
  if (m) {
    const months = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
    const mes = months.indexOf(m[3].toUpperCase()) + 1;
    if (mes) {
      const y = new Date().getFullYear();
      return `${y}-${String(mes).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
    }
  }
  return `mw_${Date.now().toString(36)}_${i}`;
}

// Carga desde midweeks.json solo cuando el store está vacío.
export async function seedMidweeks() {
  const existing = await listMidweeks();
  if (existing.length > 0) return;
  try {
    const res = await fetch('./midweeks.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const data = await res.json();
    const weeks = Array.isArray(data.weeks) ? data.weeks : [];
    await commit(STORE_MIDWEEKS, (store) => new Promise((resolve, reject) => {
      let pending = weeks.length;
      if (pending === 0) return resolve();
      for (const w of weeks) {
        const r = store.put(w);
        r.onsuccess = () => { pending--; if (pending === 0) resolve(); };
        r.onerror = () => reject(r.error);
      }
    }));
    console.log('[Reunión+] Reuniones de entre semana cargadas:', weeks.length);
  } catch (e) {
    console.warn('[Reunión+] No se pudo cargar midweeks.json', e);
  }
}

// ===== ASEOS (programa de aseo por mes) =====
export async function getAseo(id) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_ASEOS).get(id));
}

export async function putAseo(aseo) {
  aseo.updatedAt = Date.now();
  if (!aseo.createdAt) aseo.createdAt = aseo.updatedAt;
  return commit(STORE_ASEOS, (store) => reqToPromise(store.put(aseo)));
}

export async function deleteAseo(id) {
  return commit(STORE_ASEOS, (store) => reqToPromise(store.delete(id)));
}

export async function listAseos() {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_ASEOS).getAll());
  return all.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

// ===== SALIDAS (programa de salidas por mes) =====
export async function getSalidas(id) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_SALIDAS).get(id));
}

export async function putSalidas(program) {
  program.updatedAt = Date.now();
  if (!program.createdAt) program.createdAt = program.updatedAt;
  return commit(STORE_SALIDAS, (store) => reqToPromise(store.put(program)));
}

export async function deleteSalidas(id) {
  return commit(STORE_SALIDAS, (store) => reqToPromise(store.delete(id)));
}

export async function listSalidas() {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_SALIDAS).getAll());
  return all.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

// ===== ATENCION (programa de atención/acomodación por mes) =====
export async function getAtencion(id) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_ATENCION).get(id));
}

export async function putAtencion(program) {
  program.updatedAt = Date.now();
  if (!program.createdAt) program.createdAt = program.updatedAt;
  return commit(STORE_ATENCION, (store) => reqToPromise(store.put(program)));
}

export async function deleteAtencion(id) {
  return commit(STORE_ATENCION, (store) => reqToPromise(store.delete(id)));
}

export async function listAtencion() {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_ATENCION).getAll());
  return all.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

// ===== ASSIGNMENT LOG (historial de asignaciones) =====
// Registro de cada asignación { id, personId, name, date, program, roleKey, roleLabel, updatedAt }.
// id compuesto: "${personId}_${date}_${program}_${roleKey}" → al re-asignar el mismo puesto a otra
// persona se crea una entrada nueva (la anterior se conserva) sin duplicar.
export async function listAssignmentLog() {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_ASSIGNMENT_LOG).getAll());
}

export async function getAssignmentLog(id) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_ASSIGNMENT_LOG).get(id));
}

// Inserta una entrada (put: si existe el mismo id, la sobrescribe).
export async function putAssignmentLog(entry) {
  entry.updatedAt = Date.now();
  return commit(STORE_ASSIGNMENT_LOG, (store) => reqToPromise(store.put(entry)));
}

// Guarda varias entradas en una sola transacción (upsert por id).
export async function bulkPutAssignmentLog(entries) {
  if (!entries.length) return;
  return commit(STORE_ASSIGNMENT_LOG, (store) => new Promise((resolve, reject) => {
    let pending = entries.length;
    for (const e of entries) {
      e.updatedAt = Date.now();
      const r = store.put(e);
      r.onsuccess = () => { pending--; if (pending === 0) resolve(); };
      r.onerror = () => reject(r.error);
    }
  }));
}

export async function clearAssignmentLog() {
  return commit(STORE_ASSIGNMENT_LOG, (store) => reqToPromise(store.clear()));
}

// ===== SEED inicial =====
// Datos iniciales de prueba/carga inicial. Los archivos JSON son SOLO seed y
// respaldo: la app no depende de ellos para funcionar (fuente real: IndexedDB
// local + Firestore en la nube). Si no existen, la app arranca igual con la
// base vacía.
export async function seedIfEmpty() {
  // Personas: solo si la base está vacía (primer uso). No se enriquece en cada
  // arranque (evita sobrescribir labores editadas).
  const people = await listPeople();
  if (people.length === 0) {
    await loadParticipantes();
  }

  // Grupos: solo si la base de grupos está vacía (evita re-sincronizar/borrar
  // grupos editados por el usuario en cada arranque).
  const depts = await listDepartments();
  if (depts.length === 0) {
    try {
      const res = await fetch('./grupos.json', { cache: 'no-cache' });
      if (res.ok) {
        const data = await res.json();
        const nombres = Array.isArray(data.grupos) ? data.grupos
          : (Array.isArray(data.departamentos) ? data.departamentos : []);
        for (const n of nombres.map(String)) await addDepartment(n);
      }
    } catch (e) { /* sin conexión: ignorar */ }
  }

  // Discursos: cargar desde discursos.json si la lista está vacía
  const talks = await listTalks();
  if (talks.length === 0) {
    try {
      const res = await fetch('./discursos.json', { cache: 'no-cache' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length) {
          await replaceAllTalks(data.map(d => ({ num: d.num, title: d.title })));
          console.log('[Reunión+] Discursos cargados:', data.length);
        }
      }
    } catch (e) {
      console.warn('[Reunión+] No se pudo cargar discursos.json', e);
    }
  }
  // Reuniones de entre semana: cargar desde midweeks.json si el store está vacío
  await seedMidweeks();
}


// Carga inicial de personas con roles y departamentos desde participantes.json
async function loadParticipantes() {
  try {
    const res = await fetch('./participantes.json', { cache: 'no-cache' });
    if (!res.ok) {
      // fallback a los ejemplos antiguos si no hay archivo
      const ejemplos = ['Carlos Mendoza', 'Elena Rivas', 'Miguel Á. Torres', 'Lucía Fernández', 'Marcos Ruiz', 'Sofía Gaviria'];
      for (const n of ejemplos) await addPerson({ name: n });
      return;
    }
    const data = await res.json();
    const rolesMap = data.roles || {};
    // Insertar personas únicas (por nombre) con sus labores
    const merged = {};
    for (const [role, names] of Object.entries(rolesMap)) {
      for (const name of names) {
        const key = String(name).trim().toLowerCase();
        if (!merged[key]) merged[key] = { name: String(name).trim(), labores: [] };
        if (!merged[key].labores.includes(role)) merged[key].labores.push(role);
      }
    }
    for (const p of Object.values(merged)) {
      await addPerson({ name: p.name, labores: p.labores });
    }
  } catch (e) {
    console.warn('[Reunión+] No se pudo cargar participantes.json', e);
  }
}


// Exportar todo (backup)
export async function exportAll() {
  return {
    months: await listMonths(),
    people: await listPeople(),
    departments: await listDepartments(),
    talks: await listTalks(),
    midweeks: await listMidweeks(),
    aseos: await listAseos(),
    salidas: await listSalidas(),
    atencion: await listAtencion(),
    assignmentLog: await listAssignmentLog(),
    settings: {
      congregation: await getSetting('congregation', ''),
      lastMonthId: await getSetting('lastMonthId', null),
      config: await getConfig(),
    },
    exportedAt: new Date().toISOString(),
  };
}

// ===== Helpers de sincronización (sync.js) =====
// Escriben en IndexedDB SIN disparar el hook de sync (commitSilent), para evitar
// bucles al descargar datos desde Firestore. Son de uso interno de sync.js.

// Reemplaza todas las personas desde la nube (participantes).
export async function replaceAllPeopleSilent(people) {
  await commitSilent(STORE_PEOPLE, (store) => new Promise((resolve, reject) => {
    let pending = 1 + people.length;
    const done = () => { pending--; if (pending === 0) resolve(); };
    const cl = store.clear();
    cl.onsuccess = done; cl.onerror = () => reject(cl.error);
    for (const p of people) {
      const r = store.add(p);
      r.onsuccess = done; r.onerror = () => reject(r.error);
    }
  }));
}

// Inserta un grupo con id concreto (sin disparar sync).
export async function addDepartmentWithIdPublic(name, id) {
  name = (name || '').trim();
  if (!name) return;
  await commitSilent(STORE_DEPARTMENTS, (store) => reqToPromise(store.put({ id, name, createdAt: Date.now() })));
}

// Reemplaza todos los grupos (sin disparar sync).
export async function replaceAllDepartmentsSilent(grupos) {
  await commitSilent(STORE_DEPARTMENTS, (store) => new Promise((resolve, reject) => {
    let pending = 1 + grupos.length;
    const done = () => { pending--; if (pending === 0) resolve(); };
    const cl = store.clear();
    cl.onsuccess = done; cl.onerror = () => reject(cl.error);
    for (const g of grupos) {
      const r = store.put(g);
      r.onsuccess = done; r.onerror = () => reject(r.error);
    }
  }));
}

// Escribe una semana de entre semana (sin disparar sync).
export async function putMidweekSilent(week) {
  week.updatedAt = Date.now();
  if (!week.createdAt) week.createdAt = week.updatedAt;
  await commitSilent(STORE_MIDWEEKS, (store) => reqToPromise(store.put(week)));
}

// Escribe un programa de fin de semana (sin disparar sync).
export async function putMonthSilent(month) {
  month.updatedAt = Date.now();
  if (!month.createdAt) month.createdAt = month.updatedAt;
  await commitSilent(STORE_MONTHS, (store) => reqToPromise(store.put(month)));
}

// Escribe un programa de salidas (sin disparar sync).
export async function putSalidasSilent(program) {
  program.updatedAt = Date.now();
  if (!program.createdAt) program.createdAt = program.updatedAt;
  await commitSilent(STORE_SALIDAS, (store) => reqToPromise(store.put(program)));
}

// Escribe un programa de atencion/acomodación (sin disparar sync).
export async function putAtencionSilent(program) {
  program.updatedAt = Date.now();
  if (!program.createdAt) program.createdAt = program.updatedAt;
  await commitSilent(STORE_ATENCION, (store) => reqToPromise(store.put(program)));
}

// Escribe un programa de aseo (sin disparar sync).
export async function putAseoSilent(aseo) {
  aseo.updatedAt = Date.now();
  if (!aseo.createdAt) aseo.createdAt = aseo.updatedAt;
  await commitSilent(STORE_ASEOS, (store) => reqToPromise(store.put(aseo)));
}

// Escribe una entrada del historial (sin disparar sync).
export async function putAssignmentLogSilent(entry) {
  entry.updatedAt = Date.now();
  if (!entry.createdAt) entry.createdAt = entry.updatedAt;
  await commitSilent(STORE_ASSIGNMENT_LOG, (store) => reqToPromise(store.put(entry)));
}

// Guarda un setting (sin disparar sync).
export async function setSettingSilent(key, value) {
  await commitSilent(STORE_SETTINGS, (store) => reqToPromise(store.put(value, key)));
}

// Guarda la configuración (sin disparar sync).
export async function setConfigSilent(cfg) {
  await setSettingSilent('config', cfg);
}

// Guarda las labores del equipo (sin disparar sync).
export async function setLaboresSilent(labores) {
  await setSettingSilent('labores', Array.isArray(labores) ? labores : []);
}