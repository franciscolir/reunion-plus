// tests-integration.mjs - Tests de integración de Reunión+
// Capa de datos real (db.js sobre IndexedDB con fake-indexeddb) + flujos
// cruzados entre lógica (logic.js) y persistencia.
// Ejecutar: node tests-integration.mjs

import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as db from './db.js';
import {
  convertPdfPeople,
  extractAssignments,
  assignmentMetrics,
  saturdaysOf,
} from './logic.js';

const DB_NAME = 'reunion-plus';
const STORES = ['months', 'people', 'departments', 'settings', 'talks', 'midweeks', 'aseos', 'salidas', 'atencion', 'assignment_log'];
const LABORES = [
  { id: 'presidente', label: 'Presidente' },
  { id: 'audio', label: 'Audio' },
  { id: 'asignacion1', label: 'Lectura' },
];

function openRaw(name, version) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onsuccess = (e) => { const d = e.target.result; d.onversionchange = () => d.close(); resolve(d); };
    req.onerror = () => reject(req.error);
  });
}

beforeEach(async () => {
  await db.limpiarIndexedDBLocal();
  await db.setLabores([]);
});

// --- Esquema ---
test('esquema v7 crea todos los stores', async () => {
  await db.listPeople(); // fuerza la apertura/creación del esquema
  const d = await openRaw(DB_NAME, 7);
  const names = [...d.objectStoreNames];
  d.close();
  for (const s of STORES) assert.ok(names.includes(s), `falta el store "${s}"`);
});

// --- CRUD personas ---
test('people CRUD y atributos (género/calificación)', async () => {
  const id = await db.addPerson({ name: 'Ana María', genero: 'femenino', calificacion: 'B' });
  assert.ok(id, 'devuelve id');
  let list = await db.listPeople();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Ana María');
  assert.equal(list[0].genero, 'femenino');
  assert.equal(list[0].calificacion, 'B');

  await db.updatePerson({ ...list[0], calificacion: 'D' });
  list = await db.listPeople();
  assert.equal(list[0].calificacion, 'D');

  await db.deletePerson(id);
  assert.equal((await db.listPeople()).length, 0, 'se oculta de la lista activa');
  const inactivos = await db.listPeopleInactive();
  assert.equal(inactivos.length, 1, 'queda registrada como inactiva');
  assert.equal(inactivos[0].activo, false, 'flag activo:false');
  await db.restorePerson(id);
  assert.equal((await db.listPeople()).length, 1, 'restaurada vuelve a la lista activa');
});

test('departments borrado lógico (ocultar y restaurar)', async () => {
  const id = await db.addDepartment('Grupo 1');
  assert.ok(id);
  assert.equal((await db.listDepartments()).length, 1);
  await db.deleteDepartment(id);
  assert.equal((await db.listDepartments()).length, 0, 'se oculta de la lista activa');
  assert.equal((await db.listDepartmentsInactive()).length, 1, 'queda como inactivo');
  await db.restoreDepartment(id);
  assert.equal((await db.listDepartments()).length, 1, 'restaurado vuelve a la lista activa');
});

test('labores por persona y filtro listPeopleByLabore', async () => {
  const id = await db.addPerson({ name: 'Juan', labores: ['presidente'] });
  await db.setPersonLabores(id, ['presidente', 'audio']);
  const list = await db.listPeople();
  assert.deepEqual(list[0].labores, ['presidente', 'audio']);
  const libres = await db.listPeopleByLabore('audio');
  assert.equal(libres.length, 1);
  assert.equal(libres[0].name, 'Juan');
});

test('replaceAllPeople con lista y con roles map (dedup por nombre)', async () => {
  const n = await db.replaceAllPeople([
    { name: 'A', labores: ['audio'] },
    { name: 'B', labores: [] },
  ]);
  assert.equal(n, 2);
  assert.equal((await db.listPeople()).length, 2);

  const n2 = await db.replaceAllPeople({ roles: { audio: ['Carlos', 'Diana'], plataforma: ['Diana'] } });
  assert.equal(n2, 2, 'Diana aparece una sola vez');
  const list = await db.listPeople();
  const diana = list.find(p => p.name === 'Diana');
  assert.deepEqual(diana.labores, ['audio', 'plataforma']);
});

// --- Config y labores ---
test('config por defecto y persistencia de labores del equipo', async () => {
  const cfg = await db.getConfig();
  assert.equal(cfg.schedule.day, 6);
  assert.equal(typeof cfg.algorithm, 'object');
  assert.equal(cfg.algorithm.maxAssignmentsPerMeeting, 1);

  await db.setConfig({ schedule: { day: 0, time: '09:00' } });
  const c2 = await db.getConfig();
  assert.equal(c2.schedule.day, 0);

  await db.setLabores(LABORES);
  const saved = await db.getLabores();
  assert.deepEqual(saved.map(r => r.id), ['presidente', 'audio', 'asignacion1']);
});

// --- CRUD del resto de stores ---
test('discursos (talks) CRUD y reemplazo', async () => {
  await db.addTalk(1, '¿Puede la Biblia ayudarte?');
  await db.bulkPutTalks([{ num: 2, title: '¿Qué es el Reino?' }]);
  assert.equal((await db.listTalks()).length, 2);
  await db.replaceAllTalks([{ num: 3, title: 'Fe' }]);
  const list = await db.listTalks();
  assert.equal(list.length, 1);
  assert.equal(list[0].num, 3);
});

test('midweeks CRUD por id de fecha', async () => {
  await db.putMidweek({ id: '2026-09-02', sections: [] });
  await db.putMidweek({ id: '2026-09-09', sections: [] });
  assert.equal((await db.listMidweeks()).length, 2);
  const w = await db.getMidweek('2026-09-02');
  assert.ok(w, 'recupera por id');
  await db.deleteMidweek('2026-09-02');
  assert.equal((await db.listMidweeks()).length, 1);
});

test('months / aseos / salidas / atencion CRUD por id de mes', async () => {
  const month = { id: '2026-08', weeks: [] };
  await db.putMonth(month);
  assert.deepEqual((await db.getMonth('2026-08')).id, '2026-08');
  assert.equal((await db.listMonths()).length, 1);

  await db.putAseo({ id: '2026-08', weeks: [] });
  assert.equal((await db.listAseos()).length, 1);
  await db.deleteAseo('2026-08');

  await db.putSalidas({ id: '2026-08', weeks: [] });
  assert.equal((await db.listSalidas()).length, 1);
  await db.deleteSalidas('2026-08');

  await db.putAtencion({ id: '2026-08', weeks: [] });
  assert.equal((await db.listAtencion()).length, 1);
  await db.deleteAtencion('2026-08');

  await db.deleteMonth('2026-08');
  assert.equal((await db.listMonths()).length, 0);
});

// --- Flujos cruzados (integración real) ---
test('integr: importar personas desde PDF y persistirlas', async () => {
  const txt = [
    'Nombre Género Calificación Grupo Labores',
    'Ana Pérez Femenino A 1 presidente, conductor',
    'Juan López Masculino B 2 lector, orador',
  ].join('\n');
  const { data } = convertPdfPeople(txt, { labores: ['presidente', 'conductor', 'lector', 'orador'] });
  assert.equal(data.personas.length, 2);
  await db.replaceAllPeople(data.personas);
  const list = await db.listPeople();
  assert.equal(list.length, 2);
  const ana = list.find(p => p.name === 'Ana Pérez');
  assert.equal(ana.genero, 'femenino');
  assert.equal(ana.calificacion, 'A');
  assert.deepEqual(ana.labores, ['presidente', 'conductor']);
});

test('integr: programa entre semana → log de asignaciones → métricas', async () => {
  const persona = await db.addPerson({ name: 'Ana' });
  const week = {
    id: '2026-08-05',
    presidente: persona,
    sections: [{ id: 'tesoros', parts: [{ title: 'Lectura de la Biblia', assignments: { lector: persona } }] }],
    labores: {},
  };
  await db.putMidweek(week);

  const entries = extractAssignments(await db.listMidweeks(), [], [], [], await db.listPeople());
  assert.equal(entries.length, 2, 'presidente + lector');
  for (const e of entries) await db.putAssignmentLog(e);
  assert.equal((await db.listAssignmentLog()).length, 2);

  const metrics = assignmentMetrics(await db.listAssignmentLog(), await db.listPeople(), LABORES, new Date('2026-08-10'));
  const ana = metrics.find(m => m.personId === String(persona));
  assert.equal(ana.total, 2);
  assert.equal(ana.lastMonth, 2);
});

test('integr: sincronizar semanas del mes genera saturdays válidos', async () => {
  const sats = saturdaysOf(2026, 8);
  assert.equal(sats.length, 5);
  for (const w of sats) {
    await db.putMidweek({ id: w.toISOString().slice(0, 10), sections: [] });
  }
  assert.equal((await db.listMidweeks()).length, 5);
});

test('integr: historial idempotente (mismo puesto no duplica)', async () => {
  const p = await db.addPerson({ name: 'Luis' });
  const entry = { id: `${p}_2026-08-01_entre_presidente`, personId: String(p), name: 'Luis', date: '2026-08-01', program: 'entre', roleKey: 'presidente', roleLabel: 'Presidente' };
  await db.putAssignmentLog(entry);
  await db.putAssignmentLog({ ...entry });
  assert.equal((await db.listAssignmentLog()).length, 1);
});
