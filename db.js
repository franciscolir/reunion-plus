// db.js - Capa de acceso a IndexedDB
// Stores: months (programas mensuales), people, departments, settings

const DB_NAME = 'reunion-plus';
const DB_VERSION = 3;
const STORE_MONTHS = 'months';       // key: "YYYY-MM"
const STORE_PEOPLE = 'people';       // keyPath: id (auto)
const STORE_DEPARTMENTS = 'departments'; // keyPath: id (auto)
const STORE_SETTINGS = 'settings';   // key: string
const STORE_TALKS = 'talks';        // keyPath: num (discurso n°)
const STORE_MIDWEEKS = 'midweeks';   // key: "YYYY-MM-DD" (reunión de entre semana)

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

// ===== MONTHS =====
export async function getMonth(id) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_MONTHS).get(id));
}

export async function putMonth(month) {
  const db = await openDB();
  month.updatedAt = Date.now();
  if (!month.createdAt) month.createdAt = month.updatedAt;
  return reqToPromise(tx(db, STORE_MONTHS, 'readwrite').put(month));
}

export async function deleteMonth(id) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_MONTHS, 'readwrite').delete(id));
}

export async function listMonths() {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_MONTHS).getAll());
}

// ===== PEOPLE =====
export async function listPeople() {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_PEOPLE).getAll());
  return all.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export async function addPerson(payload) {
  const db = await openDB();
  let record;
  if (typeof payload === 'string') {
    const name = payload.trim();
    if (!name) throw new Error('Nombre vacío');
    record = { name, roles: [], createdAt: Date.now() };
  } else {
    const name = (payload.name || '').trim();
    if (!name) throw new Error('Nombre vacío');
    record = { name, roles: Array.isArray(payload.roles) ? payload.roles : [], createdAt: Date.now() };
  }
  return reqToPromise(tx(db, STORE_PEOPLE, 'readwrite').add(record));
}

export async function updatePerson(person) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_PEOPLE, 'readwrite').put(person));
}

export async function deletePerson(id) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_PEOPLE, 'readwrite').delete(id));
}

// Personas filtradas por rol. Si una persona no tiene `roles` (datos antiguos),
// se incluye en todos los roles para no romper programas existentes.
export async function listPeopleByRole(role) {
  const all = await listPeople();
  return all.filter(p => !Array.isArray(p.roles) || p.roles.length === 0 || p.roles.includes(role));
}

// Reemplaza los roles de una persona existente.
export async function setPersonRoles(id, roles) {
  const p = await listPeople();
  const person = p.find(x => String(x.id) === String(id));
  if (!person) throw new Error('Persona no encontrada');
  person.roles = Array.isArray(roles) ? roles : [];
  return updatePerson(person);
}

// ===== DEPARTMENTS =====
export async function listDepartments() {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_DEPARTMENTS).getAll());
  return all.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export async function addDepartment(name, opts = {}) {
  const db = await openDB();
  name = (name || '').trim();
  if (!name) throw new Error('Nombre vacío');
  const record = { name, createdAt: Date.now() };
  if (opts.orden !== undefined) record.orden = opts.orden;
  if (opts.labores !== undefined) record.labores = opts.labores;
  return reqToPromise(tx(db, STORE_DEPARTMENTS, 'readwrite').add(record));
}

export async function updateDepartment(dept) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_DEPARTMENTS, 'readwrite').put(dept));
}

export async function deleteDepartment(id) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_DEPARTMENTS, 'readwrite').delete(id));
}

// ===== SETTINGS =====
export async function getSetting(key, fallback = null) {
  const db = await openDB();
  const v = await reqToPromise(tx(db, STORE_SETTINGS).get(key));
  return v === undefined ? fallback : v;
}

export async function setSetting(key, value) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_SETTINGS, 'readwrite').put(value, key));
}

// ===== ROLES (lista editable de roles del equipo) =====
const SETTING_ROLES = 'roles';
export async function getRoles(fallback = null) {
  const v = await getSetting(SETTING_ROLES, null);
  return Array.isArray(v) && v.length ? v : fallback;
}
export async function setRoles(roles) {
  return setSetting(SETTING_ROLES, Array.isArray(roles) ? roles : []);
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

export async function getTalk(num) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_TALKS).get(num));
}

export async function putTalk(talk) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_TALKS, 'readwrite').put(talk));
}

export async function clearTalks() {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_TALKS, 'readwrite').clear());
}

export async function bulkPutTalks(talks) {
  const db = await openDB();
  const store = tx(db, STORE_TALKS, 'readwrite');
  await new Promise((resolve, reject) => {
    let pending = talks.length;
    if (pending === 0) return resolve();
    for (const t of talks) {
      const r = store.put(t);
      r.onsuccess = () => { pending--; if (pending === 0) resolve(); };
      r.onerror = () => reject(r.error);
    }
  });
}

// Reemplaza toda la lista de discursos (carga desde JSON)
export async function replaceAllTalks(talks) {
  await clearTalks();
  await bulkPutTalks(talks);
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
  const db = await openDB();
  week.updatedAt = Date.now();
  if (!week.createdAt) week.createdAt = week.updatedAt;
  return reqToPromise(tx(db, STORE_MIDWEEKS, 'readwrite').put(week));
}

export async function deleteMidweek(id) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_MIDWEEKS, 'readwrite').delete(id));
}

export async function clearMidweeks() {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_MIDWEEKS, 'readwrite').clear());
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
    const store = tx(await openDB(), STORE_MIDWEEKS, 'readwrite');
    await new Promise((resolve, reject) => {
      let pending = weeks.length;
      if (pending === 0) return resolve();
      for (const w of weeks) {
        const r = store.put(w);
        r.onsuccess = () => { pending--; if (pending === 0) resolve(); };
        r.onerror = () => reject(r.error);
      }
    });
    console.log('[Reunión+] Reuniones de entre semana cargadas:', weeks.length);
  } catch (e) {
    console.warn('[Reunión+] No se pudo cargar midweeks.json', e);
  }
}

// Devuelve true si el programa de esa semana tiene alguna asignación de persona.
export function weekHasAssignments(week) {
  if (!week || !Array.isArray(week.sections)) return false;
  return week.sections.some(sec =>
    Array.isArray(sec.parts) && sec.parts.some(p => {
      const ap = p.assignments;
      return ap && Object.values(ap).some(v => v != null && String(v).trim() !== '');
    })
  );
}

// ===== SEED inicial =====
export async function seedIfEmpty() {
  // Cargar el archivo de participantes una sola vez al inicio (para comparar y migrar)
  let participantes = null;
  try {
    const res = await fetch('./participantes.json', { cache: 'no-cache' });
    if (res.ok) participantes = await res.json();
  } catch (e) { /* sin conexión primero: ignorar */ }

  const people = await listPeople();
  if (people.length === 0) {
    await loadParticipantes();
  } else if (participantes) {
    // Migración: borrar las personas de muestra antiguas (las que vinieron del
    // seed inicial de versiones previas) que no figuren en participantes.json.
    await removeLegacyPeople(people, participantes);
    // Luego enriquecer las restantes con sus roles.
    const refreshed = await listPeople();
    await enrichRolesFromParticipantes(refreshed, participantes);
  }

  const depts = await listDepartments();
  try {
    const res = await fetch('./grupos.json', { cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      const nombres = Array.isArray(data.grupos) ? data.grupos
        : (Array.isArray(data.departamentos) ? data.departamentos : []);
      await syncGroupsFromJson(depts, nombres.map(String));
    }
  } catch (e) { /* sin conexión: ignorar */ }
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

// Sincroniza los grupos (departamentos) de la DB con grupos.json:
//  · Si la DB está vacía, crea los grupos del archivo.
//  · Si los grupos actuales coinciden (por nombre) con los del archivo, no hace nada.
//  · En cualquier otro caso ( grupos de muestra antiguos como "Logística",
//    "Relaciones", etc., o listas modificadas), elimina los actuales y crea los
//    del archivo. Mantiene el ID de los grupos cuyo nombre se conserva para no
//    perder las asignaciones ya guardadas en los programas.
async function syncGroupsFromJson(existing, namesFromFile) {
  const fromFile = (namesFromFile || []).map(n => String(n).trim());
  const current = existing.map(d => String(d.name).trim());
  const sameSet =
    current.length === fromFile.length &&
    current.every(n => fromFile.includes(n)) &&
    fromFile.every(n => current.includes(n));

  if (sameSet) return; // nada que hacer

  if (existing.length === 0) {
    for (const n of fromFile) await addDepartment(n);
    return;
  }

  // Reemplazo preservando IDs por nombre coincidente.
  const keepByIdName = new Map(); // name(lower) -> id existente
  for (const d of existing) keepByIdName.set(String(d.name).trim().toLowerCase(), d.id);

  for (const d of existing) await deleteDepartment(d.id);
  for (const n of fromFile) {
    const oldId = keepByIdName.get(n.toLowerCase());
    if (oldId) await addDepartmentWithId(n, oldId);
    else await addDepartment(n);
  }
  console.log('[Reunión+] Grupos sincronizados desde grupos.json:', fromFile);
}

// Inserta un departamento con un id concreto (para preservar referencias).
async function addDepartmentWithId(name, id) {
  const db = await openDB();
  name = (name || '').trim();
  if (!name) throw new Error('Nombre vacío');
  return reqToPromise(tx(db, STORE_DEPARTMENTS, 'readwrite').put({ id, name, createdAt: Date.now() }));
}

// Personas de muestra de versiones previas del seed (no vienen de participantes.json).
const LEGACY_SAMPLE_NAMES = [
  'carlos mendoza', 'elena rivas', 'miguel á. torres', 'miguel a. torres',
  'lucía fernández', 'lucia fernández', 'marcos ruiz', 'sofía gaviria', 'sofia gaviria',
];

// Elimina las personas de muestra antiguas que no estén en participantes.json.
// Conserva cualquier persona añadida manualmente por el usuario.
async function removeLegacyPeople(existing, participantes) {
  const validNames = new Set(
    Object.values(participantes.roles || {})
      .flat()
      .map(n => String(n).trim().toLowerCase())
  );
  for (const p of existing) {
    const key = (p.name || '').trim().toLowerCase();
    if (LEGACY_SAMPLE_NAMES.includes(key) && !validNames.has(key)) {
      await deletePerson(p.id);
      console.log('[Reunión+] Eliminada persona de muestra antigua:', p.name);
    }
  }
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
    // Insertar personas únicas (por nombre) con sus roles
    const merged = {};
    for (const [role, names] of Object.entries(rolesMap)) {
      for (const name of names) {
        const key = String(name).trim().toLowerCase();
        if (!merged[key]) merged[key] = { name: String(name).trim(), roles: [] };
        if (!merged[key].roles.includes(role)) merged[key].roles.push(role);
      }
    }
    for (const p of Object.values(merged)) {
      await addPerson({ name: p.name, roles: p.roles });
    }
  } catch (e) {
    console.warn('[Reunión+] No se pudo cargar participantes.json', e);
  }
}

// Para personas ya creadas, sincroniza sus roles con los del archivo participantes.json
// (sin sobrescribir programas existentes). Conserva las personas añadidas a mano
// (simplemente no tendrán roles asignados a menos que coincidan por nombre).
async function enrichRolesFromParticipantes(existing, participantes) {
  if (!participantes) {
    try {
      const res = await fetch('./participantes.json', { cache: 'no-cache' });
      if (!res.ok) return;
      participantes = await res.json();
    } catch (e) { return; }
  }
  const rolesMap = participantes.roles || {};
  const rolesByName = {};
  for (const [role, names] of Object.entries(rolesMap)) {
    for (const name of names) {
      const key = String(name).trim().toLowerCase();
      if (!rolesByName[key]) rolesByName[key] = [];
      if (!rolesByName[key].includes(role)) rolesByName[key].push(role);
    }
  }
  for (const p of existing) {
    const roles = rolesByName[(p.name || '').trim().toLowerCase()];
    if (!roles) continue; // no está en el archivo: dejar intacta
    const current = Array.isArray(p.roles) ? p.roles : [];
    const merged = Array.from(new Set([...current, ...roles]));
    const sameOrder = merged.length === current.length && merged.every((r, i) => r === current[i]);
    if (!sameOrder) { p.roles = merged; await updatePerson(p); }
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
    settings: {
      congregation: await getSetting('congregation', ''),
      lastMonthId: await getSetting('lastMonthId', null),
      config: await getConfig(),
    },
    exportedAt: new Date().toISOString(),
  };
}