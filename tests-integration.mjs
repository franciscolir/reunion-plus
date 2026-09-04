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
const STORES = ['months', 'people', 'departments', 'settings', 'talks', 'midweeks', 'aseos', 'salidas', 'atencion', 'assignment_log', 'reports', 'activity', 'attendance', 'arrangements', 'cargos', 'capacidades', 'speaker_talks', 'audit_log', 'actividad_revision'];
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
test('esquema v14 crea todos los stores', async () => {
  await db.listPeople(); // fuerza la apertura/creación del esquema
  const d = await openRaw(DB_NAME, 14);
  const names = [...d.objectStoreNames];
  d.close();
  for (const s of STORES) assert.ok(names.includes(s), `falta el store "${s}"`);
});

// --- Stores de informes (activity/attendance/arrangements) ---
test('informes: activity/attendance/arrangements CRUD', async () => {
  await db.putActivity({ id: '2026-09', people: { 1: { actividad: true, cursos: 3, horas: 10 } }, locked: false });
  await db.putAttendance({ id: '2026', midweek: { '2026-09-05': 25 }, weekend: { '2026-09-06': 40 } });
  await db.putArrangements({ id: '2026-09', congregation: 'Central', localSpeakers: [] });

  const act = await db.getActivity('2026-09');
  assert.equal(act.people['1'].horas, 10);
  const att = await db.getAttendance('2026');
  assert.equal(att.weekend['2026-09-06'], 40);
  const arr = await db.getArrangements('2026-09');
  assert.equal(arr.congregation, 'Central');

  assert.equal((await db.listActivity()).length, 1);
  assert.equal((await db.listAttendance()).length, 1);
  assert.equal((await db.listArrangements()).length, 1);

  await db.putActivitySilent({ id: '2026-10', people: {} });
  const silent = await db.getActivity('2026-10');
  assert.ok(silent && silent.id === '2026-10');
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

// borrarSoloProgramasLocal conserva participantes/grupos/config y borra programas.
test('integr: borrar solo programas conserva personas y borra programas', async () => {
  await db.addPerson({ name: 'Ana' });
  await db.addPerson({ name: 'Juan' });
  await db.putMidweek({ id: '2026-08-03', presidente: 1, sections: [] });
  await db.putMonth({ id: '2026-08', weeks: [] });
  await db.putSalidas({ id: '2026-08', weeks: [] });
  await db.putAtencion({ id: '2026-08', weeks: [] });
  await db.putAseo({ id: '2026-08', weeks: [] });
  await db.putAssignmentLog({ id: 'x_1', personId: '1' });
  assert.equal((await db.listMidweeks()).length, 1);
  assert.equal((await db.listMonths()).length, 1);

  await db.borrarSoloProgramasLocal();

  assert.equal((await db.listPeople()).length, 2, 'personas se conservan');
  assert.equal((await db.listMidweeks()).length, 1, 'reuniones entre semana se conservan');
  assert.equal((await db.listMonths()).length, 0, 'programas mensuales borrados');
  assert.equal((await db.listSalidas()).length, 0, 'salidas borradas');
  assert.equal((await db.listAtencion()).length, 0, 'acomodación borrada');
  assert.equal((await db.listAseos()).length, 0, 'aseos borrados');
  assert.equal((await db.listAssignmentLog()).length, 0, 'historial borrado');
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

// --- Nuevos stores del modelo v2 ---

test('cargos CRUD y semilla por defecto', async () => {
  let cargos = await db.listCargos();
  assert.equal(cargos.length, 3, 'semilla: publicador, ministerial, anciano');
  const ids = cargos.map(c => c.name);
  assert.ok(ids.includes('Publicador'));
  assert.ok(ids.includes('Siervo Ministerial'));
  assert.ok(ids.includes('Anciano'));

  const id = await db.addCargo({ name: 'Bautizado', nivel: 0 });
  assert.ok(id);
  cargos = await db.listCargos();
  assert.equal(cargos.length, 4);

  await db.updateCargo({ id, name: 'Bautizado Nuevo', nivel: 0 });
  const updated = await db.getCargo(id);
  assert.equal(updated.name, 'Bautizado Nuevo');

  await db.deleteCargo(id);
  assert.equal((await db.listCargos()).length, 3);
});

test('capacidades CRUD por cargo', async () => {
  const cargos = await db.listCargos();
  const anciano = cargos.find(c => c.name === 'Anciano');
  await db.addCapacidad({ cargoId: anciano.id, laborId: 'conductor1', label: 'Cond. Atalaya' });
  await db.addCapacidad({ cargoId: anciano.id, laborId: 'presidente', label: 'Presidente' });
  let caps = await db.listCapacidadesByCargo(anciano.id);
  assert.equal(caps.length, 2);

  await db.clearCapacidadesByCargo(anciano.id);
  caps = await db.listCapacidadesByCargo(anciano.id);
  assert.equal(caps.length, 0);
});

test('speaker_talks CRUD (orador ↔ discurso N:N)', async () => {
  const pid = await db.addPerson({ name: 'Juan' });
  await db.addSpeakerTalk({ personId: String(pid), talkNum: 1 });
  await db.addSpeakerTalk({ personId: String(pid), talkNum: 5 });
  let talks = await db.listSpeakerTalksByPerson(String(pid));
  assert.equal(talks.length, 2);

  let byTalk = await db.listSpeakerTalksByTalk(1);
  assert.equal(byTalk.length, 1);

  await db.clearSpeakerTalksByPerson(String(pid));
  assert.equal((await db.listSpeakerTalksByPerson(String(pid))).length, 0);
});

test('audit_log CRUD', async () => {
  await db.addAuditEntry({ entity: 'people', entityId: '1', action: 'update', field: 'name', oldValue: 'Ana', newValue: 'Ana María' });
  await db.addAuditEntry({ entity: 'people', entityId: '1', action: 'update', field: 'prioridad', oldValue: '0', newValue: '1' });
  let log = await db.listAuditLog();
  assert.equal(log.length, 2);
  const fields = log.map(e => e.field);
  assert.ok(fields.includes('name'));
  assert.ok(fields.includes('prioridad'));

  let byEntity = await db.listAuditLogByEntity('people', '1');
  assert.equal(byEntity.length, 2);
});

test('personas con prioridad se guardan correctamente', async () => {
  const id = await db.addPerson({ name: 'Test', prioridad: 5 });
  const list = await db.listPeople();
  const p = list.find(x => x.id === id);
  assert.equal(p.prioridad, 5);
});

test('departments con encargadoId', async () => {
  const pid = await db.addPerson({ name: 'Encargado' });
  const did = await db.addDepartment('Grupo Alpha', { encargadoId: String(pid) });
  const depts = await db.listDepartments();
  const d = depts.find(x => x.id === did);
  assert.equal(d.encargadoId, String(pid));
});

test('activity con estado', async () => {
  await db.putActivity({ id: '2026-11', people: {}, estado: 'borrador' });
  const act = await db.getActivity('2026-11');
  assert.equal(act.estado, 'borrador');
});

test('actividad_revision: id determinístico y reenvío no duplica', async () => {
  await db.addActividadRevision({ grupoId: 'g1', monthId: '2026-09', personId: '7', actividad: true, horas: 5 });
  const l1 = await db.listActividadRevision();
  assert.equal(l1.length, 1);
  assert.equal(l1[0].id, '2026-09|g1|7');
  assert.equal(l1[0].horas, 5);
  await db.addActividadRevision({ grupoId: 'g1', monthId: '2026-09', personId: '7', actividad: true, horas: 10 });
  const l2 = await db.listActividadRevision();
  assert.equal(l2.length, 1);
  assert.equal(l2[0].horas, 10);
  await db.addActividadRevision({ grupoId: 'g2', monthId: '2026-09', personId: '7', actividad: false });
  const l3 = await db.listActividadRevision();
  assert.equal(l3.length, 2);
  await db.clearActividadRevision('g1', '2026-09');
  const l4 = await db.listActividadRevision();
  assert.equal(l4.length, 1);
  assert.equal(l4[0].grupoId, 'g2');
});
