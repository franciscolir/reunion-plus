// db.js - Capa de acceso a IndexedDB
// Stores: months (programas mensuales), people, departments, settings, talks, midweeks, aseos

import { defaultAlgorithmConfig, mapMidweekSlots, mapFinWeekSlots, mapSalidasSlots, mapAtencionSlots, addDays } from './logic.js';

const DB_NAME = 'reunion-plus';
const DB_VERSION = 12;
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
const STORE_ACTIVITY = 'activity';     // key: "YYYY-MM" (actividad de publicadores por mes)
const STORE_ATTENDANCE = 'attendance'; // key: año de servicio "YYYY" (asistencia por semana)
const STORE_ARRANGEMENTS = 'arrangements'; // key: "YYYY-MM" (intercambio, oradores, catálogo)
const STORE_REPORTS = 'reports'; // legacy: migrado a activity/attendance/arrangements en v10
const STORE_CARGOS = 'cargos';           // keyPath: id (catálogo de cargos: anciano, ministerial, publicador, etc.)
const STORE_CAPACIDADES = 'capacidades'; // keyPath: id (cargo → labores que otorga)
const STORE_SPEAKER_TALKS = 'speaker_talks'; // keyPath: id (orador ↔ discurso N:N)
const STORE_AUDIT_LOG = 'audit_log';     // keyPath: id (historial de modificaciones)
const STORE_ACT_REVISION = 'actividad_revision'; // keyPath: id (actividad pendiente de revisión por admin)

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
      if (!db.objectStoreNames.contains(STORE_REPORTS)) {
        db.createObjectStore(STORE_REPORTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ACTIVITY)) {
        db.createObjectStore(STORE_ACTIVITY, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ATTENDANCE)) {
        db.createObjectStore(STORE_ATTENDANCE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ARRANGEMENTS)) {
        db.createObjectStore(STORE_ARRANGEMENTS, { keyPath: 'id' });
      }

      // v11: Nuevos stores para el modelo de datos mejorado
      if (!db.objectStoreNames.contains(STORE_CARGOS)) {
        const s = db.createObjectStore(STORE_CARGOS, { keyPath: 'id', autoIncrement: true });
        s.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CAPACIDADES)) {
        const s = db.createObjectStore(STORE_CAPACIDADES, { keyPath: 'id', autoIncrement: true });
        s.createIndex('cargoId', 'cargoId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SPEAKER_TALKS)) {
        const s = db.createObjectStore(STORE_SPEAKER_TALKS, { keyPath: 'id', autoIncrement: true });
        s.createIndex('personId', 'personId', { unique: false });
        s.createIndex('talkNum', 'talkNum', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_AUDIT_LOG)) {
        const s = db.createObjectStore(STORE_AUDIT_LOG, { keyPath: 'id', autoIncrement: true });
        s.createIndex('entity', 'entity', { unique: false });
        s.createIndex('entityId', 'entityId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_ACT_REVISION)) {
        db.createObjectStore(STORE_ACT_REVISION, { keyPath: 'id', autoIncrement: true });
      }

      // Migración v7→v8: las asignaciones de persona pasan a formato
      // {id, src, locked}. Los datos existentes se marcan MANUAL (bloqueados)
      // para no perder trabajo del usuario; los vacíos quedan como ''.
      if (e.oldVersion < 8) {
        const t = e.target.transaction;
        const wrap = (v) => {
          if (v && typeof v === 'object' && 'id' in v) return v;
          return v ? { id: v, src: 'MANUAL', locked: true } : '';
        };
        const migrarStore = (name, mapFn) => {
          if (!t.objectStoreNames.contains(name)) return;
          const st = t.objectStore(name);
          const cur = st.openCursor();
          cur.onsuccess = (ev) => {
            const c = ev.target.result;
            if (!c) return;
            c.update(mapFn(c.value));
            c.continue();
          };
        };
        migrarStore(STORE_MONTHS, (m) => ({ ...m, weeks: (m.weeks || []).map(w => mapFinWeekSlots(w, (k, v) => wrap(v))) }));
        migrarStore(STORE_MIDWEEKS, (w) => mapMidweekSlots(w, (k, v) => wrap(v)));
        migrarStore(STORE_SALIDAS, (s) => mapSalidasSlots(s, (k, v) => wrap(v)));
        migrarStore(STORE_ATENCION, (a) => mapAtencionSlots(a, (k, v) => wrap(v)));
      }

      // Migración v9→v10: el store genérico 'reports' (claves activity:/attendance:/arrangements:)
      // se divide en tres stores dedicados. Se copia cada registro al store correspondiente
      // (sin el prefijo) y se borra del store legacy.
      if (e.oldVersion < 10) {
        const t = e.target.transaction;
        if (t.objectStoreNames.contains(STORE_REPORTS)) {
          const cur = t.objectStore(STORE_REPORTS).openCursor();
          cur.onsuccess = (ev) => {
            const c = ev.target.result;
            if (!c) return;
            const v = c.value || {};
            const id = String(v.id || '');
            if (id.startsWith('activity:')) t.objectStore(STORE_ACTIVITY).put({ ...v, id: id.slice(9) });
            else if (id.startsWith('attendance:')) t.objectStore(STORE_ATTENDANCE).put({ ...v, id: id.slice(11) });
            else if (id.startsWith('arrangements:')) t.objectStore(STORE_ARRANGEMENTS).put({ ...v, id: id.slice(13) });
            c.delete();
            c.continue();
          };
        }
      }

      // Migración v10→v11: Nuevo modelo de datos mejorado.
      // 1. Semilla de catálogo de cargos por defecto
      // 2. Campos nuevos en personas (phone, email, prioridad)
      // 3. Campo encargadoId en departments
      // 4. Agregar estado a informes de actividad
      if (e.oldVersion < 11) {
        const t = e.target.transaction;
        const DEFAULT_CARGOS = [
          { name: 'Publicador', nivel: 1 },
          { name: 'Siervo Ministerial', nivel: 2 },
          { name: 'Anciano', nivel: 3 },
        ];
        if (t.objectStoreNames.contains(STORE_CARGOS)) {
          const cs = t.objectStore(STORE_CARGOS);
          for (const c of DEFAULT_CARGOS) {
            cs.add({ ...c, activo: true, createdAt: Date.now() });
          }
        }
        // Migrar personas: asegurar que tengan los campos nuevos
        if (t.objectStoreNames.contains(STORE_PEOPLE)) {
          const cur = t.objectStore(STORE_PEOPLE).openCursor();
          cur.onsuccess = (ev) => {
            const c = ev.target.result;
            if (!c) return;
            const p = c.value || {};
            let changed = false;
            if (!('phone' in p)) { p.phone = ''; changed = true; }
            if (!('email' in p)) { p.email = ''; changed = true; }
            if (!('prioridad' in p)) { p.prioridad = 0; changed = true; }
            if (changed) c.update(p);
            c.continue();
          };
        }
        // Migrar departments: asegurar encargadoId
        if (t.objectStoreNames.contains(STORE_DEPARTMENTS)) {
          const cur = t.objectStore(STORE_DEPARTMENTS).openCursor();
          cur.onsuccess = (ev) => {
            const c = ev.target.result;
            if (!c) return;
            const d = c.value || {};
            if (!('encargadoId' in d)) { d.encargadoId = ''; c.update(d); }
            c.continue();
          };
        }
        // Migrar informes de actividad: agregar estado 'enviado' por defecto
        if (t.objectStoreNames.contains(STORE_ACTIVITY)) {
          const cur = t.objectStore(STORE_ACTIVITY).openCursor();
          cur.onsuccess = (ev) => {
            const c = ev.target.result;
            if (!c) return;
            const a = c.value || {};
            if (!('estado' in a)) { a.estado = 'enviado'; c.update(a); }
            c.continue();
          };
        }
        // Migrar reuniones de entre semana: agregar estado 'normal' por defecto
        if (t.objectStoreNames.contains(STORE_MIDWEEKS)) {
          const cur = t.objectStore(STORE_MIDWEEKS).openCursor();
          cur.onsuccess = (ev) => {
            const c = ev.target.result;
            if (!c) return;
            const w = c.value || {};
            if (!('estado' in w)) { w.estado = 'normal'; c.update(w); }
            c.continue();
          };
        }
        // Migrar programas de fin de semana: agregar estado 'normal' en cada semana
        if (t.objectStoreNames.contains(STORE_MONTHS)) {
          const cur = t.objectStore(STORE_MONTHS).openCursor();
          cur.onsuccess = (ev) => {
            const c = ev.target.result;
            if (!c) return;
            const m = c.value || {};
            if (Array.isArray(m.weeks)) {
              let changed = false;
              const weeks = m.weeks.map(w => {
                if (w && !('estado' in w)) { changed = true; return { ...w, estado: 'normal' }; }
                return w;
              });
              if (changed) c.update({ ...m, weeks });
            }
            c.continue();
          };
        }
      }

      // Migración v11→v12: la semana inicia el lunes. Se añade `monday` a cada
      // semana de months/aseos/atencion/salidas (derivado de sábado/fecha).
      if (e.oldVersion < 12) {
        const t = e.target.transaction;
        const normalizarSemana = (w) => {
          if (!w || typeof w !== 'object') return w;
          const saturday = w.saturday || (w.date ? w.date : (w.monday ? addDays(w.monday, 5) : null));
          const monday = w.monday || (w.date ? addDays(w.date, -5) : (saturday ? addDays(saturday, -5) : null));
          const sunday = w.sunday || (saturday ? addDays(saturday, 1) : null);
          return { ...w, monday, saturday, sunday };
        };
        const migrarWeeks = (name) => {
          if (!t.objectStoreNames.contains(name)) return;
          const cur = t.objectStore(name).openCursor();
          cur.onsuccess = (ev) => {
            const c = ev.target.result;
            if (!c) return;
            const rec = c.value || {};
            if (Array.isArray(rec.weeks)) {
              c.update({ ...rec, weeks: rec.weeks.map(normalizarSemana) });
            } else if (rec && rec.weeks) {
              c.update({ ...rec, weeks: normalizarSemana(rec.weeks) });
            } else {
              c.update(rec);
            }
            c.continue();
          };
        };
        migrarWeeks(STORE_MONTHS);
        migrarWeeks(STORE_ASEOS);
        migrarWeeks(STORE_SALIDAS);
        migrarWeeks(STORE_ATENCION);
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(db, store, mode = 'readonly') {
  return db.transaction(store, mode).objectStore(store);
}

const DEFAULT_CARGOS = [
  { id: 'publicador',  name: 'Publicador',        nivel: 1 },
  { id: 'ministerial', name: 'Siervo Ministerial', nivel: 2 },
  { id: 'anciano',     name: 'Anciano',           nivel: 3 },
];

// Capaciadades que otorga cada cargo por defecto (laborId). Los publicadores
// dependen siempre de las labores marcadas explícitamente; los cargos de
// responsabilidad habilitan las labores de dirección que suelen desempeñar.
const DEFAULT_CAPACIDADES = [
  { cargoId: 'anciano',     laborId: 'presidente' },
  { cargoId: 'anciano',     laborId: 'presidenteFin' },
  { cargoId: 'anciano',     laborId: 'conductor1' },
  { cargoId: 'anciano',     laborId: 'conductor2' },
  { cargoId: 'anciano',     laborId: 'orador' },
  { cargoId: 'anciano',     laborId: 'salida' },
  { cargoId: 'anciano',     laborId: 'lector1' },
  { cargoId: 'anciano',     laborId: 'lector2' },
  { cargoId: 'anciano',     laborId: 'acomodador' },
  { cargoId: 'anciano',     laborId: 'microf' },
  { cargoId: 'anciano',     laborId: 'plataforma' },
  { cargoId: 'anciano',     laborId: 'asignacion1' },
  { cargoId: 'anciano',     laborId: 'asignacion2' },
  { cargoId: 'anciano',     laborId: 'asignacion3' },
  { cargoId: 'anciano',     laborId: 'asignacion4' },
  { cargoId: 'anciano',     laborId: 'discursoInicial' },
  { cargoId: 'anciano',     laborId: 'perlas' },
  { cargoId: 'ministerial', laborId: 'presidente' },
  { cargoId: 'ministerial', laborId: 'presidenteFin' },
  { cargoId: 'ministerial', laborId: 'conductor1' },
  { cargoId: 'ministerial', laborId: 'conductor2' },
  { cargoId: 'ministerial', laborId: 'orador' },
  { cargoId: 'ministerial', laborId: 'salida' },
  { cargoId: 'ministerial', laborId: 'lector1' },
  { cargoId: 'ministerial', laborId: 'lector2' },
  { cargoId: 'ministerial', laborId: 'acomodador' },
  { cargoId: 'ministerial', laborId: 'microf' },
  { cargoId: 'ministerial', laborId: 'plataforma' },
  { cargoId: 'ministerial', laborId: 'asignacion1' },
  { cargoId: 'ministerial', laborId: 'asignacion2' },
  { cargoId: 'ministerial', laborId: 'asignacion3' },
  { cargoId: 'ministerial', laborId: 'asignacion4' },
  { cargoId: 'ministerial', laborId: 'discursoInicial' },
  { cargoId: 'ministerial', laborId: 'perlas' },
];

function seedCargosIfEmpty(db) {
  try {
    const t = db.transaction(STORE_CARGOS, 'readwrite');
    const store = t.objectStore(STORE_CARGOS);
    const countReq = store.count();
    countReq.onsuccess = () => {
      if (countReq.result === 0) {
        const now = Date.now();
        for (const c of DEFAULT_CARGOS) {
          store.add({ ...c, activo: true, createdAt: now });
        }
      }
    };
  } catch (_) { /* ignore */ }
}

function seedCapacidadesIfEmpty(db) {
  try {
    const t = db.transaction([STORE_CARGOS, STORE_CAPACIDADES], 'readwrite');
    const cargoStore = t.objectStore(STORE_CARGOS);
    const capStore = t.objectStore(STORE_CAPACIDADES);
    cargoStore.count().onsuccess = (ce) => {
      if (ce.target.result === 0) return; // los cargos aún no existen
      capStore.count().onsuccess = (pe) => {
        if (pe.target.result > 0) return;
        const now = Date.now();
        for (const c of DEFAULT_CAPACIDADES) {
          capStore.add({ ...c, activo: true, createdAt: now });
        }
      };
    };
  } catch (_) { /* ignore */ }
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ===== COMMIT / SYNC (punto único de escritura) =====
// Toda escritura pasa por commit(), que es el único lugar donde se notifica a
// los hooks de sincronización (p. ej. Supabase). Los hooks se registran con
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
// Normaliza las semanas de un programa: compatibilidad con datos que todavía
// usan el campo `tipo` (Supabase/migraciones) en lugar de `type`.
function normalizarWeeks(month) {
  if (!month || !Array.isArray(month.weeks)) return month;
  return {
    ...month,
    weeks: month.weeks.map(w => {
      if (w && !w.type && w.tipo) return { ...w, type: w.tipo };
      return w;
    }),
  };
}

export async function getMonth(id) {
  const db = await openDB();
  return normalizarWeeks(await reqToPromise(tx(db, STORE_MONTHS).get(id)));
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
  const all = await reqToPromise(tx(db, STORE_MONTHS).getAll());
  return all.map(normalizarWeeks);
}

// ===== PEOPLE =====
// Lista todas las personas (activas e inactivas). Las inactivas se ocultan por
// defecto (borrado lógico: se conserva el registro para no romper historial).
async function listPeopleRaw() {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_PEOPLE).getAll());
  // Compatibilidad: las personas guardadas con el campo antiguo `roles` se leen
  // como `labores` (renombrado).
  return all
    .map(p => ({ ...p, labores: Array.isArray(p.labores) ? p.labores : (Array.isArray(p.roles) ? p.roles : []) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export async function listPeople() {
  return (await listPeopleRaw()).filter(p => p.activo !== false);
}

export async function listPeopleAll() {
  return listPeopleRaw();
}

export async function listPeopleInactive() {
  return (await listPeopleRaw()).filter(p => p.activo === false);
}

export async function addPerson(payload) {
  let record;
  if (typeof payload === 'string') {
    const name = payload.trim();
    if (!name) throw new Error('Nombre vacío');
    record = { name, labores: [], cargos: ['publicador'], genero: '', calificacion: '', phone: '', email: '', prioridad: 0, activo: true, createdAt: Date.now() };
  } else {
    const name = (payload.name || '').trim();
    if (!name) throw new Error('Nombre vacío');
    record = {
      name,
      labores: Array.isArray(payload.labores) ? payload.labores : (Array.isArray(payload.roles) ? payload.roles : []),
      cargos: payload.cargo ? [payload.cargo] : (Array.isArray(payload.cargos) && payload.cargos.length ? payload.cargos : (typeof payload.cargos === 'string' && payload.cargos ? payload.cargos.split(',').map(s => s.trim()).filter(Boolean) : ['publicador'])),
      genero: payload.genero || '',
      calificacion: payload.calificacion || '',
      enlace: payload.enlace || '',
      phone: payload.phone || '',
      email: payload.email || '',
      prioridad: payload.prioridad || 0,
      nacimiento: payload.nacimiento || '',
      bautismo: payload.bautismo || '',
      precursorRegular: payload.precursorRegular === true,
      activo: payload.activo !== false,
      createdAt: Date.now(),
    };
  }
  return commit(STORE_PEOPLE, (store) => reqToPromise(store.add(record)));
}

export async function updatePerson(person) {
  return commit(STORE_PEOPLE, (store) => reqToPromise(store.put(person)));
}

// Borrado lógico: marca la persona como inactiva (se oculta de las listas) y
// limpia los enlaces de pareja que otros tuvieran hacia ella.
export async function deletePerson(id) {
  const all = await listPeopleRaw();
  const person = all.find(x => String(x.id) === String(id));
  if (!person) return;
  await commit(STORE_PEOPLE, (store) => {
    for (const other of all) {
      if (String(other.enlace || '') === String(id)) {
        other.enlace = '';
        store.put(other);
      }
    }
    person.activo = false;
    person.deletedAt = Date.now();
    return reqToPromise(store.put(person));
  });
}

// Reactiva una persona previamente marcada como inactiva.
export async function restorePerson(id) {
  const person = (await listPeopleRaw()).find(x => String(x.id) === String(id));
  if (!person) return;
  person.activo = true;
  delete person.deletedAt;
  return commit(STORE_PEOPLE, (store) => reqToPromise(store.put(person)));
}

export async function clearPeople() {
  return commit(STORE_PEOPLE, (store) => reqToPromise(store.clear()));
}

// Reemplaza toda la lista de personas desde un archivo. Acepta dos formatos:
//   1) { roles: { <labor>: [nombres...], ... } } o { participantes: {...} }
//   2) [{ name, genero, calificacion, grupoId, labores, enlace, ... }]
// Inserta personas únicas (por nombre) con sus atributos.
export async function replaceAllPeople(data) {
  const now = Date.now();
  let list;
  if (Array.isArray(data)) {
    list = data.map(p => ({
      name: String(p.name || '').trim(),
      labores: Array.isArray(p.labores) ? p.labores : (Array.isArray(p.roles) ? p.roles : []),
      cargos: Array.isArray(p.cargos) ? p.cargos : [],
      genero: p.genero || '',
      calificacion: p.calificacion || '',
      enlace: p.enlace || '',
      phone: p.phone || '',
      email: p.email || '',
      prioridad: p.prioridad || 0,
      grupoId: p.grupoId || '',
      activo: p.activo !== false,
    })).filter(p => p.name);
  } else {
    const rolesMap = (data && (data.roles || data.participantes)) || {};
    const merged = {};
    for (const [role, names] of Object.entries(rolesMap)) {
      for (const name of (Array.isArray(names) ? names : [])) {
        const key = String(name).trim().toLowerCase();
        if (!key) continue;
        if (!merged[key]) merged[key] = { name: String(name).trim(), labores: [], activo: true };
        if (!merged[key].labores.includes(role)) merged[key].labores.push(role);
      }
    }
    list = Object.values(merged);
  }
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
async function listDepartmentsRaw() {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_DEPARTMENTS).getAll());
  return all.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export async function listDepartments() {
  return (await listDepartmentsRaw()).filter(d => d.activo !== false);
}

export async function listDepartmentsAll() {
  return listDepartmentsRaw();
}

export async function listDepartmentsInactive() {
  return (await listDepartmentsRaw()).filter(d => d.activo === false);
}

export async function addDepartment(name, opts = {}) {
  name = (name || '').trim();
  if (!name) throw new Error('Nombre vacío');
  const record = { name, activo: true, encargadoId: opts.encargadoId || '', createdAt: Date.now() };
  if (opts.orden !== undefined) record.orden = opts.orden;
  if (opts.labores !== undefined) record.labores = opts.labores;
  return commit(STORE_DEPARTMENTS, (store) => reqToPromise(store.add(record)));
}

export async function updateDepartment(dept) {
  return commit(STORE_DEPARTMENTS, (store) => reqToPromise(store.put(dept)));
}

// Borrado lógico: marca el departamento como inactivo (se oculta de las listas).
export async function deleteDepartment(id) {
  const dept = (await listDepartmentsRaw()).find(x => String(x.id) === String(id));
  if (!dept) return;
  dept.activo = false;
  dept.deletedAt = Date.now();
  return commit(STORE_DEPARTMENTS, (store) => reqToPromise(store.put(dept)));
}

// Reactiva un departamento previamente marcado como inactivo.
export async function restoreDepartment(id) {
  const dept = (await listDepartmentsRaw()).find(x => String(x.id) === String(id));
  if (!dept) return;
  dept.activo = true;
  delete dept.deletedAt;
  return commit(STORE_DEPARTMENTS, (store) => reqToPromise(store.put(dept)));
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
    algorithm: defaultAlgorithmConfig(),
    emailsPermitidos: [], // whitelist de correos autorizados para iniciar sesión
    excepciones: [], // conflictos autorizados (alcance puntual: persona+regla+semana)
    congregacionNumero: '', // número de la congregación (S-1-S / S-3-S)
    ciudad: '',
    provincia: '',
  };
}

export async function getConfig() {
  const v = await getSetting(SETTING_CONFIG, null);
  if (!v || typeof v !== 'object') return defaultConfig();
  const def = defaultConfig();
  return {
    schedule: { ...def.schedule, ...(v.schedule || {}) },
    midweek: { ...def.midweek, ...(v.midweek || {}) },
    events: {
      commemorations: Array.isArray(v.events?.commemorations) ? v.events.commemorations : [],
      visits: Array.isArray(v.events?.visits) ? v.events.visits : [],
      assemblies: Array.isArray(v.events?.assemblies) ? v.events.assemblies : [],
    },
    algorithm: { ...defaultAlgorithmConfig(), ...(v.algorithm || {}) },
    emailsPermitidos: Array.isArray(v.emailsPermitidos) ? v.emailsPermitidos.map(e => String(e).trim().toLowerCase()).filter(Boolean) : [],
    excepciones: Array.isArray(v.excepciones) ? v.excepciones : [],
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
  const prev = await listTalks().catch(() => []);
  const prevBlocked = new Map(prev.map(t => [Number(t.num), !!t.blocked]));
  const normalized = list.map(d => {
    const num = Number(d.num);
    return { num, title: String(d.title ?? ''), blocked: prevBlocked.has(num) ? prevBlocked.get(num) : false };
  }).filter(d => d.num && d.title);
  await replaceAllTalks(normalized);
  return normalized.length;
}

// CRUD individual de discursos (la vista de resumen los edita uno a uno).
export async function addTalk(num, title) {
  num = Number(num);
  if (!num) throw new Error('Número de discurso inválido');
  title = String(title || '').trim();
  if (!title) throw new Error('Título vacío');
  const exists = await listTalks().then(l => l.some(t => Number(t.num) === num));
  if (exists) throw new Error('Ese número de discurso ya existe');
  return commit(STORE_TALKS, (store) => reqToPromise(store.put({ num, title, blocked: false, createdAt: Date.now() })));
}

export async function updateTalk(talk) {
  const num = Number(talk?.num);
  if (!num) throw new Error('Número de discurso inválido');
  const title = String(talk.title || '').trim();
  if (!title) throw new Error('Título vacío');
  const record = { num, title, updatedAt: Date.now() };
  if (talk.createdAt) record.createdAt = talk.createdAt;
  if (talk.blocked !== undefined) record.blocked = !!talk.blocked;
  return commit(STORE_TALKS, (store) => reqToPromise(store.put(record)));
}

export async function deleteTalk(num) {
  return commit(STORE_TALKS, (store) => reqToPromise(store.delete(Number(num))));
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

// Añade semanas de entre semana SIN borrar las existentes (carga acumulativa de
// guías por fecha). Si una semana con el mismo id ya existe, se sobrescribe.
export async function mergeMidweeks(weeks) {
  const list = (Array.isArray(weeks) ? weeks : [])
    .map((w, i) => (w && w.id) ? w : ({ ...w, id: midweekFallbackId(w, i) }));
  if (!list.length) return 0;
  return commit(STORE_MIDWEEKS, (store) => new Promise((resolve, reject) => {
    let pending = list.length;
    const done = () => { pending--; if (pending === 0) resolve(list.length); };
    for (const w of list) {
      const r = store.put(w);
      r.onsuccess = done; r.onerror = () => reject(r.error);
    }
  }));
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

// ===== SEED =====
// Ya no se siembran datos desde archivos JSON: la fuente de verdad es Supabase
// (la app descarga desde la nube al iniciar sesión si la base local está vacía).
// seedIfEmpty se mantiene como no-op por compatibilidad con init().
export async function seedIfEmpty() {
  // Sin seed JSON. Los datos llegan vía sync.js (pull desde Supabase).
}

// Exportar todo (backup)
export async function exportAll() {
  return {
    months: await listMonths(),
    people: await listPeopleAll(),
    departments: await listDepartmentsAll(),
    talks: await listTalks(),
    midweeks: await listMidweeks(),
    aseos: await listAseos(),
    salidas: await listSalidas(),
    atencion: await listAtencion(),
    assignmentLog: await listAssignmentLog(),
    activity: await listActivity(),
    attendance: await listAttendance(),
    arrangements: await listArrangements(),
    cargos: await listCargos(),
    capacidades: await listCapacidades(),
    speakerTalks: await listSpeakerTalks(),
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
// bucles al descargar datos desde Supabase. Son de uso interno de sync.js.

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
  await commitSilent(STORE_DEPARTMENTS, (store) => reqToPromise(store.put({ id, name, activo: true, createdAt: Date.now() })));
}

// Escribe una persona con id concreto (sin disparar sync). Usado en el pull por registro.
export async function putPersonSilent(person) {
  person.updatedAt = Date.now();
  if (!person.createdAt) person.createdAt = person.updatedAt;
  await commitSilent(STORE_PEOPLE, (store) => reqToPromise(store.put(person)));
}

// Escribe un departamento con id concreto (sin disparar sync).
export async function putDepartmentSilent(dept) {
  dept.updatedAt = Date.now();
  if (!dept.createdAt) dept.createdAt = dept.updatedAt;
  await commitSilent(STORE_DEPARTMENTS, (store) => reqToPromise(store.put(dept)));
}

// Escribe un discurso (sin disparar sync). Usado en el pull por registro.
export async function putTalkSilent(talk) {
  talk.updatedAt = Date.now();
  if (!talk.createdAt) talk.createdAt = talk.updatedAt;
  await commitSilent(STORE_TALKS, (store) => reqToPromise(store.put(talk)));
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

// Reemplaza toda la lista de discursos (sin disparar sync). Usado en el pull.
export async function replaceAllTalksSilent(talks) {
  await commitSilent(STORE_TALKS, (store) => new Promise((resolve, reject) => {
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

// ===== Mantenimiento local (borrado de datos) =====
// Limpia TODOS los stores de IndexedDB (excepto settings de sesión) sin disparar
// sync. Se usa tras limpiar Supabase para dejar la caché local vacía.
export async function limpiarIndexedDBLocal() {
  const db = await openDB();
  const stores = [STORE_MONTHS, STORE_PEOPLE, STORE_DEPARTMENTS, STORE_TALKS, STORE_MIDWEEKS, STORE_ASEOS, STORE_SALIDAS, STORE_ATENCION, STORE_ASSIGNMENT_LOG, STORE_CARGOS, STORE_CAPACIDADES, STORE_SPEAKER_TALKS, STORE_AUDIT_LOG];
  for (const s of stores) {
    if (db.objectStoreNames.contains(s)) {
      await commitSilent(s, (store) => reqToPromise(store.clear()));
    }
  }
  // resetear settings de datos (config por defecto), conservando la sesión si la hubiera
  await setSettingSilent('congregation', '');
  await setSettingSilent('lastMonthId', null);
  await setConfigSilent(await defaultConfig());
}

// Borra de IndexedDB local las personas, reuniones (entre semana), programas
// mensuales y su historial, sin tocar grupos, discursos ni configuración.
// Sin disparar sync.
export async function borrarParticipantesReunionesProgramasLocal() {
  const db = await openDB();
  const stores = [STORE_PEOPLE, STORE_MIDWEEKS, STORE_MONTHS, STORE_SALIDAS, STORE_ATENCION, STORE_ASEOS, STORE_ASSIGNMENT_LOG];
  for (const s of stores) {
    if (db.objectStoreNames.contains(s)) {
      await commitSilent(s, (store) => reqToPromise(store.clear()));
    }
  }
}

// Borra SOLO los participantes locales, conservando el resto. Sin disparar sync.
export async function borrarSoloParticipantesLocal() {
  const db = await openDB();
  if (db.objectStoreNames.contains(STORE_PEOPLE)) {
    await commitSilent(STORE_PEOPLE, (store) => reqToPromise(store.clear()));
  }
}

// Borra SOLO las reuniones de entre semana locales, conservando el resto. Sin disparar sync.
export async function borrarSoloReunionesLocal() {
  const db = await openDB();
  if (db.objectStoreNames.contains(STORE_MIDWEEKS)) {
    await commitSilent(STORE_MIDWEEKS, (store) => reqToPromise(store.clear()));
  }
}

// Borra SOLO los programas locales (meses, salidas, atencion, aseos e historial),
// conservando participantes, grupos, reuniones, discursos y configuración.
// Sin disparar sync.
export async function borrarSoloProgramasLocal() {
  const db = await openDB();
  const stores = [STORE_MONTHS, STORE_SALIDAS, STORE_ATENCION, STORE_ASEOS, STORE_ASSIGNMENT_LOG];
  for (const s of stores) {
    if (db.objectStoreNames.contains(s)) {
      await commitSilent(s, (store) => reqToPromise(store.clear()));
    }
  }
}

export async function getActivity(id) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_ACTIVITY).get(String(id)));
}

export async function putActivity(report) {
  return commit(STORE_ACTIVITY, (store) => reqToPromise(store.put({ ...report, id: String(report.id), updatedAt: Date.now() })));
}

export async function putActivitySilent(report) {
  return commitSilent(STORE_ACTIVITY, (store) => reqToPromise(store.put({ ...report, id: String(report.id) })));
}

// Sin tocar sync (para pull desde la nube).
export async function putActividadRevisionSilent(r) {
  const db = await openDB();
  return commitSilent(STORE_ACT_REVISION, (store) => reqToPromise(store.put(r)));
}

export async function listActivity() {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_ACTIVITY).getAll());
}

// ===== ACTIVIDAD REVISION (pendiente de revisión del admin) =====
// El user escribe aquí; solo el admin la copia a actividad definitiva.
export async function addActividadRevision(entry) {
  const db = await openDB();
  return commit(STORE_ACT_REVISION, (store) => reqToPromise(store.add({
    grupoId: entry.grupoId,
    monthId: entry.monthId,
    personId: entry.personId,
    nombre: entry.nombre || '',
    actividad: !!entry.actividad,
    auxiliar: entry.auxiliar || false,
    cursos: Number(entry.cursos) || 0,
    horas: Number(entry.horas) || 0,
    notas: entry.notas || '',
    createdAt: Date.now(),
    ...entry,
  })));
}

export async function listActividadRevision(grupoId = null, monthId = null) {
  const db = await openDB();
  let all = await reqToPromise(tx(db, STORE_ACT_REVISION).getAll());
  if (grupoId) all = all.filter(r => String(r.grupoId) === String(grupoId));
  if (monthId) all = all.filter(r => String(r.monthId) === String(monthId));
  return all;
}

export async function deleteActividadRevision(id) {
  return commit(STORE_ACT_REVISION, (store) => reqToPromise(store.delete(id)));
}

export async function clearActividadRevision(grupoId, monthId) {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_ACT_REVISION).getAll());
  const toDelete = all.filter(r =>
    String(r.grupoId) === String(grupoId) &&
    String(r.monthId) === String(monthId)
  );
  return commit(STORE_ACT_REVISION, (store) => Promise.all(
    toDelete.map(r => reqToPromise(store.delete(r.id)))
  ));
}

export async function getAttendance(id) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_ATTENDANCE).get(String(id)));
}

export async function putAttendance(report) {
  return commit(STORE_ATTENDANCE, (store) => reqToPromise(store.put({ ...report, id: String(report.id), updatedAt: Date.now() })));
}

export async function putAttendanceSilent(report) {
  return commitSilent(STORE_ATTENDANCE, (store) => reqToPromise(store.put({ ...report, id: String(report.id) })));
}

export async function listAttendance() {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_ATTENDANCE).getAll());
}

export async function getArrangements(id) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_ARRANGEMENTS).get(String(id)));
}

export async function putArrangements(report) {
  return commit(STORE_ARRANGEMENTS, (store) => reqToPromise(store.put({ ...report, id: String(report.id), updatedAt: Date.now() })));
}

export async function putArrangementsSilent(report) {
  return commitSilent(STORE_ARRANGEMENTS, (store) => reqToPromise(store.put({ ...report, id: String(report.id) })));
}

export async function listArrangements() {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_ARRANGEMENTS).getAll());
}

export async function deleteArrangements(id) {
  return commit(STORE_ARRANGEMENTS, (store) => reqToPromise(store.delete(String(id))));
}

// ===== CARGOS (catálogo de cargos) =====
export async function listCargos() {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_CARGOS).getAll());
  if (all.length === 0) {
    const now = Date.now();
    await commitSilent(STORE_CARGOS, (store) => new Promise((resolve) => {
      let pending = DEFAULT_CARGOS.length;
      const done = () => { pending--; if (pending === 0) resolve(); };
      for (const c of DEFAULT_CARGOS) {
        const r = store.add({ ...c, activo: true, createdAt: now });
        r.onsuccess = done; r.onerror = done;
      }
    }));
    return reqToPromise(tx(db, STORE_CARGOS).getAll());
  }
  return all.sort((a, b) => (a.nivel || 0) - (b.nivel || 0));
}

export async function addCargo(cargo) {
  const record = { name: String(cargo.name || '').trim(), nivel: cargo.nivel || 1, activo: cargo.activo !== false, createdAt: Date.now() };
  if (!record.name) throw new Error('Nombre de cargo vacío');
  return commitSilent(STORE_CARGOS, (store) => reqToPromise(store.add(record)));
}

export async function updateCargo(cargo) {
  return commitSilent(STORE_CARGOS, (store) => reqToPromise(store.put({ ...cargo, updatedAt: Date.now() })));
}

export async function deleteCargo(id) {
  return commitSilent(STORE_CARGOS, (store) => reqToPromise(store.delete(id)));
}

export async function getCargo(id) {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_CARGOS).get(id));
}

// ===== CAPACIDADES (cargo → labores que otorga) =====
export async function listCapacidades() {
  const db = await openDB();
  let all = await reqToPromise(tx(db, STORE_CAPACIDADES).getAll());
  if (all.length === 0) {
    const now = Date.now();
    await commitSilent(STORE_CAPACIDADES, (store) => new Promise((resolve) => {
      let pending = DEFAULT_CAPACIDADES.length;
      if (pending === 0) return resolve();
      const done = () => { pending--; if (pending === 0) resolve(); };
      for (const c of DEFAULT_CAPACIDADES) {
        const r = store.add({ ...c, activo: true, createdAt: now });
        r.onsuccess = done; r.onerror = done;
      }
    }));
    all = await reqToPromise(tx(db, STORE_CAPACIDADES).getAll());
  }
  return all;
}

export async function listCapacidadesByCargo(cargoId) {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_CAPACIDADES).getAll());
  return all.filter(c => String(c.cargoId) === String(cargoId));
}

export async function addCapacidad(cap) {
  const record = { cargoId: cap.cargoId, laborId: cap.laborId, label: cap.label || '', activo: cap.activo !== false, createdAt: Date.now() };
  return commitSilent(STORE_CAPACIDADES, (store) => reqToPromise(store.add(record)));
}

export async function updateCapacidad(cap) {
  return commitSilent(STORE_CAPACIDADES, (store) => reqToPromise(store.put({ ...cap, updatedAt: Date.now() })));
}

export async function deleteCapacidad(id) {
  return commitSilent(STORE_CAPACIDADES, (store) => reqToPromise(store.delete(id)));
}

export async function clearCapacidadesByCargo(cargoId) {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_CAPACIDADES).getAll());
  const toDelete = all.filter(c => String(c.cargoId) === String(cargoId));
  return commitSilent(STORE_CAPACIDADES, (store) => new Promise((resolve, reject) => {
    let pending = toDelete.length;
    if (pending === 0) return resolve();
    for (const c of toDelete) {
      const r = store.delete(c.id);
      r.onsuccess = () => { pending--; if (pending === 0) resolve(); };
      r.onerror = () => reject(r.error);
    }
  }));
}

// ===== SPEAKER_TALKS (orador ↔ discurso N:N) =====
export async function listSpeakerTalks() {
  const db = await openDB();
  return reqToPromise(tx(db, STORE_SPEAKER_TALKS).getAll());
}

export async function listSpeakerTalksByPerson(personId) {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_SPEAKER_TALKS).getAll());
  return all.filter(s => String(s.personId) === String(personId));
}

export async function listSpeakerTalksByTalk(talkNum) {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_SPEAKER_TALKS).getAll());
  return all.filter(s => String(s.talkNum) === String(talkNum));
}

export async function addSpeakerTalk(st) {
  const record = { personId: st.personId, talkNum: st.talkNum, preparedAt: st.preparedAt || Date.now(), createdAt: Date.now() };
  return commitSilent(STORE_SPEAKER_TALKS, (store) => reqToPromise(store.add(record)));
}

export async function deleteSpeakerTalk(id) {
  return commitSilent(STORE_SPEAKER_TALKS, (store) => reqToPromise(store.delete(id)));
}

export async function clearSpeakerTalksByPerson(personId) {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_SPEAKER_TALKS).getAll());
  const toDelete = all.filter(c => String(c.personId) === String(personId));
  return commitSilent(STORE_SPEAKER_TALKS, (store) => new Promise((resolve, reject) => {
    let pending = toDelete.length;
    if (pending === 0) return resolve();
    for (const c of toDelete) {
      const r = store.delete(c.id);
      r.onsuccess = () => { pending--; if (pending === 0) resolve(); };
      r.onerror = () => reject(r.error);
    }
  }));
}

// ===== AUDIT_LOG (historial de modificaciones) =====
export async function listAuditLog() {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_AUDIT_LOG).getAll());
  return all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

export async function listAuditLogByEntity(entity, entityId) {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORE_AUDIT_LOG).getAll());
  const filtered = all.filter(e => e.entity === entity);
  return entityId ? filtered.filter(e => e.entityId === entityId) : filtered;
}

export async function addAuditEntry(entry) {
  const record = {
    entity: entry.entity,
    entityId: entry.entityId,
    action: entry.action || 'update',
    field: entry.field || '',
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    timestamp: Date.now(),
    createdAt: Date.now(),
  };
  return commitSilent(STORE_AUDIT_LOG, (store) => reqToPromise(store.add(record)));
}

export async function addAuditEntrySilent(entry) {
  const record = {
    entity: entry.entity,
    entityId: entry.entityId,
    action: entry.action || 'update',
    field: entry.field || '',
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    timestamp: Date.now(),
    createdAt: Date.now(),
  };
  await commitSilent(STORE_AUDIT_LOG, (store) => reqToPromise(store.add(record)));
}
