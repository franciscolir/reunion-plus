// tests.mjs - Tests unitarios de funciones puras de Reunión+
// Ejecutar: node tests.mjs

import {
  MONTHS_ES, WEEK_TYPES, FIELD_ROLE, FIELD_LABELS,
  normalizeStr, searchTalks, saturdaysOf,
  collectWeekPersons, labelOfKey, labelOf,
  computeConflicts, computeOutingConflicts, weekComplete,
  collectLaboresPersons, collectMidweekPersons, computeMidweekConflicts, dedupPersons, eligiblePeople,
  LABORES_DEF, LABORE_ROLES, isLaborePerson, splitWords,
  capitalize, escapeHtml, escapeAttr, cryptoId,
  isoDate, eventTypeForDate, upcomingEvents, isSpecialDate, DAYS_ES_NAMES, addDays, eventEndDate,
  convertPdfToData, convertPdfTalks, convertPdfPeople, convertPdfMidweeks, midweekGuideSummary, rebuildPdfWords,
  computeCrossConflicts, canBePair,
  midweekSlotsOf, automatizarEntreSemana, automatizarAcomodacion, automatizarFinSemana,
  isStudentPerson, isStudentRole,
  extractAssignments, assignmentMetrics,
} from './logic.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${extra}`); }
}
function eq(name, got, want) {
  const cond = JSON.stringify(got) === JSON.stringify(want);
  ok(name, cond, `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}

console.log('\n=== Reunión+ tests ===\n');

// --- normalizeStr ---
console.log('[normalizeStr]');
ok('quita tildes', normalizeStr('José') === 'jose');
ok('lowercase', normalizeStr('NIÑO') === 'nino');
ok('vacío', normalizeStr('') === '');

// --- saturdaysOf ---
console.log('[saturdaysOf]');
const satsFeb2026 = saturdaysOf(2026, 2);
ok('feb 2026 tiene 4 sábados', satsFeb2026.length === 4, `got=${satsFeb2026.length}`);
ok('feb 2026 primer sábado es 7', satsFeb2026[0].getDate() === 7);
ok('feb 2026 último sábado es 28', satsFeb2026[3].getDate() === 28);
const satsAug2025 = saturdaysOf(2025, 8);
ok('ago 2025 tiene 5 sábados', satsAug2025.length === 5, `got=${satsAug2025.length}`);
ok('ago 2025 primer sábado es 2', satsAug2025[0].getDate() === 2);
ok('ago 2025 último sábado es 30', satsAug2025[4].getDate() === 30);

// --- searchTalks ---
console.log('[searchTalks]');
const talks = [
  { num: 1, title: '¿Puede la Biblia ayudarte?' },
  { num: 12, title: '¿Qué es el Reino de Dios?' },
  { num: 100, title: '¿Por qué permite Dios el sufrimiento?' },
];
eq('vacío devuelve todos (limitados)', searchTalks('', talks, 30), talks);
eq('número exacto al principio', searchTalks('12', talks)[0], { num: 12, title: '¿Qué es el Reino de Dios?' });
ok('prefijo numérico funciona', searchTalks('1', talks).some(t => t.num === 1));
ok('palabra clave funciona', searchTalks('sufrimiento', talks).some(t => t.num === 100));
ok('sin tildes en keyword', searchTalks('reino', talks).some(t => t.num === 12));
ok('limit respeta tope', searchTalks('', talks, 2).length === 2);

// --- collectWeekPersons ---
console.log('[collectWeekPersons]');
eq('semana normal con todas las asignaciones', collectWeekPersons({
  type: 'normal', presidente: 1, conductor: 2, lector: 3, outings: [{ oradorSalida: 4 }, { oradorSalida: 5 }],
}), [
  { value: '1', key: 'presidente' },
  { value: '2', key: 'conductor' },
  { value: '3', key: 'lector' },
  { value: '4', key: 'salida_0' },
  { value: '5', key: 'salida_1' },
]);
eq('semana assembly no recoge personas', collectWeekPersons({ type: 'assembly' }), []);
eq('semana supervisor recoge presidente y estudio', collectWeekPersons({
  type: 'supervisor', presidente: 7, estudioSinLectura: 9,
}), [
  { value: '7', key: 'presidente' },
  { value: '9', key: 'estudioSinLectura' },
]);
eq('semana commemoration recoge solo presidente', collectWeekPersons({
  type: 'commemoration', presidente: 11,
}), [{ value: '11', key: 'presidente' }]);
eq('omite valores vacíos', collectWeekPersons({
  type: 'normal', presidente: '', conductor: 0, lector: null, outings: [{ oradorSalida: '' }],
}), []);
eq('orador texto libre no se incluye (no es ID)', collectWeekPersons({
  type: 'normal', presidente: 1, orador: 'Juan Pérez', outings: [],
}), [{ value: '1', key: 'presidente' }]);

// --- computeConflicts ---
console.log('[computeConflicts]');
const monthEmpty = { weeks: [{ type: 'normal', outings: [{ oradorSalida: '' }] }] };
const c1 = computeConflicts(monthEmpty);
ok('semana normal vacía tiene 5 missing', c1.perWeek[0].missing.length === 5, `got=${c1.perWeek[0].missing.length}`);
ok('semana normal vacía genera 5 errors', c1.errors.length === 5);

// Duplicado intra-semana: presidente = oradorSalida
const monthDup = { weeks: [{
  type: 'normal',
  presidente: 5, tituloDiscurso: 'T', orador: 'X', conductor: 6, lector: 7, departamento: 1,
  outings: [{ oradorSalida: 5 }],
}] };
const c2 = computeConflicts(monthDup);
ok('duplicado presidente==oradorSalida detectado', c2.perWeek[0].duplicates.includes('presidente'));
ok('outing duplicado indexado', c2.perWeek[0].outingDuplicates.includes(0));
ok('genera mensaje de error de duplicado', c2.errors.some(e => e.includes('asignados a la misma persona')));

// Sin duplicados (todo bien)
const monthOk = { weeks: [{
  type: 'normal',
  presidente: 1, tituloDiscurso: 'T', orador: 'X', conductor: 2, lector: 3, departamento: 4,
  outings: [{ oradorSalida: 5 }],
}] };
const c3 = computeConflicts(monthOk);
ok('semana completa sin duplicados: 0 missing', c3.perWeek[0].missing.length === 0);
ok('semana completa sin duplicados: 0 duplicates', c3.perWeek[0].duplicates.length === 0);
ok('semana completa sin errors', c3.errors.length === 0);

// Assembly no tiene required
const monthAsm = { weeks: [{ type: 'assembly' }] };
const c4 = computeConflicts(monthAsm);
ok('assembly: 0 missing', c4.perWeek[0].missing.length === 0);
ok('assembly: 0 errors', c4.errors.length === 0);

// Supervisor con required
const monthSup = { weeks: [{ type: 'supervisor' }] };
const c5 = computeConflicts(monthSup);
ok('supervisor vacío: 4 missing', c5.perWeek[0].missing.length === 4, `got=${c5.perWeek[0].missing.length}`);

// Conmemoración
const monthCom = { weeks: [{ type: 'commemoration' }] };
const c6 = computeConflicts(monthCom);
ok('conmemoración vacía: 3 missing', c6.perWeek[0].missing.length === 3, `got=${c6.perWeek[0].missing.length}`);

// --- computeOutingConflicts ---
console.log('[computeOutingConflicts]');
const w1 = { type: 'normal', presidente: 1, outings: [{ oradorSalida: 1 }, { oradorSalida: 2 }] };
const oc1 = computeOutingConflicts({ weeks: [w1] }, 0);
ok('outing 0 duplicada con presidente', oc1.duplicates.includes(0));
const w2 = { type: 'normal', presidente: 1, outings: [{ oradorSalida: 2 }, { oradorSalida: 3 }] };
const oc2 = computeOutingConflicts({ weeks: [w2] }, 0);
ok('sin duplicados en salidas', oc2.duplicates.length === 0);

// --- weekComplete ---
console.log('[weekComplete]');
ok('semana vacía no completa', weekComplete({ type: 'normal', outings: [] }) === false);
ok('semana assembly completa', weekComplete({ type: 'assembly' }) === true);
ok('semana completa normal', weekComplete({
  type: 'normal',
  presidente: 1, tituloDiscurso: 'T', orador: 'X', conductor: 2, lector: 3, departamento: 4,
  outings: [{ oradorSalida: 5 }],
}) === true);
ok('semana con duplicado no completa', weekComplete({
  type: 'normal',
  presidente: 1, tituloDiscurso: 'T', orador: 'X', conductor: 2, lector: 3, departamento: 4,
  outings: [{ oradorSalida: 1 }],
}) === false);

// --- labelOfKey / labelOf ---
console.log('[labelOfKey / labelOf]');
eq('labelOfKey salida_0', labelOfKey('salida_0'), 'orador de salida 1');
eq('labelOfKey salida_3', labelOfKey('salida_3'), 'orador de salida 4');
eq('labelOfKey presidente', labelOfKey('presidente'), 'presidente');
eq('labelOf tituloDiscurso', labelOf('tituloDiscurso'), 'título del discurso');
eq('labelOf desconocido', labelOf('xyz'), 'xyz');

// --- escape ---
console.log('[escape]');
eq('escapeHtml <', escapeHtml('<'), '&lt;');
eq('escapeHtml >', escapeHtml('>'), '&gt;');
eq('escapeHtml &', escapeHtml('&'), '&amp;');
eq('escapeHtml "', escapeHtml('"'), '&quot;');
eq('escapeHtml texto seguro', escapeHtml('Hola'), 'Hola');
eq('escapeHtml null', escapeHtml(null), '');
eq('escapeHtml undefined', escapeHtml(undefined), '');
eq('escapeAttr "', escapeAttr('"'), '&quot;');
eq('escapeAttr <', escapeAttr('<'), '&lt;');

// --- capitalize ---
console.log('[capitalize]');
eq('capitalize', capitalize('hola mundo'), 'Hola mundo');
eq('capitalize vacío', capitalize(''), '');

// --- cryptoId ---
console.log('[cryptoId]');
const id1 = cryptoId(), id2 = cryptoId();
ok('cryptoId genera string no vacío', typeof id1 === 'string' && id1.length > 0);
ok('cryptoId único', id1 !== id2);
ok('cryptoId prefijo w_', id1.startsWith('w_'));

// --- constants ---
console.log('[constants]');
ok('MONTHS_ES 12 meses', MONTHS_ES.length === 12);
ok('WEEK_TYPES 4 tipos', Object.keys(WEEK_TYPES).length === 4);
ok('FIELD_ROLE mapea estudioSinLectura a conductor1', FIELD_ROLE.estudioSinLectura === 'conductor1');
ok('FIELD_ROLE mapea oradorSalida a orador', FIELD_ROLE.oradorSalida === 'orador');
ok('FIELD_ROLE mapea conductor a conductor1', FIELD_ROLE.conductor === 'conductor1');
ok('FIELD_ROLE mapea lector a lector1', FIELD_ROLE.lector === 'lector1');

// --- isoDate ---
console.log('[isoDate]');
eq('isoDate básico', isoDate(new Date(2026, 6, 6)), '2026-07-06');
eq('isoDate con ceros', isoDate(new Date(2026, 0, 5)), '2026-01-05');

// --- eventTypeForDate ---
console.log('[eventTypeForDate]');
const cfgEvents = {
  commemorations: ['2026-04-04'],
  visits: [{ from: '2026-05-13', to: '2026-05-16' }],
  assemblies: [{ from: '2026-06-11', to: '2026-06-13', days: 3 }],
};
eq('conmemoración detectada', eventTypeForDate(cfgEvents, '2026-04-04'), 'commemoration');
eq('visita en rango (inicio)', eventTypeForDate(cfgEvents, '2026-05-13'), 'supervisor');
eq('visita en rango (fin)', eventTypeForDate(cfgEvents, '2026-05-16'), 'supervisor');
eq('visita en rango (medio)', eventTypeForDate(cfgEvents, '2026-05-14'), 'supervisor');
eq('fuera del rango es normal', eventTypeForDate(cfgEvents, '2026-05-17'), 'normal');
eq('asamblea día 1', eventTypeForDate(cfgEvents, '2026-06-11'), 'assembly');
eq('asamblea día 3', eventTypeForDate(cfgEvents, '2026-06-13'), 'assembly');
eq('asamblea día 4 es normal', eventTypeForDate(cfgEvents, '2026-06-14'), 'normal');
eq('asamblea 1 día', eventTypeForDate({ assemblies: [{ from: '2026-06-11', days: 1 }] }, '2026-06-12'), 'normal');
eq('asamblea de 3 días con rango (desde)', eventTypeForDate({ assemblies: [{ from: '2026-06-11', to: '2026-06-13', days: 3 }] }, '2026-06-11'), 'assembly');
eq('asamblea de 3 días con rango (hasta)', eventTypeForDate({ assemblies: [{ from: '2026-06-11', to: '2026-06-13', days: 3 }] }, '2026-06-13'), 'assembly');
eq('asamblea de 3 días con rango (fuera)', eventTypeForDate({ assemblies: [{ from: '2026-06-11', to: '2026-06-13', days: 3 }] }, '2026-06-14'), 'normal');
eq('asamblea legacy sin days = 1 día', eventTypeForDate({ assemblies: [{ date: '2026-06-11' }] }, '2026-06-12'), 'normal');
eq('visita legacy con date', eventTypeForDate({ visits: [{ date: '2026-05-16' }] }, '2026-05-16'), 'supervisor');
eq('fecha sin evento es normal', eventTypeForDate(cfgEvents, '2026-07-06'), 'normal');
eq('sin eventos devuelve normal', eventTypeForDate(null, '2026-04-04'), 'normal');

// --- isSpecialDate ---
console.log('[isSpecialDate]');
ok('es fecha especial', isSpecialDate(cfgEvents, '2026-04-04'));
ok('es fecha especial (rango)', isSpecialDate(cfgEvents, '2026-05-15'));
ok('no es fecha especial', !isSpecialDate(cfgEvents, '2026-07-06'));

// --- addDays ---
console.log('[addDays]');
eq('addDays +1', addDays('2026-06-11', 1), '2026-06-12');
eq('addDays +2 cruza mes', addDays('2026-06-30', 2), '2026-07-02');
eq('addDays 0', addDays('2026-06-11', 0), '2026-06-11');
eq('addDays null', addDays(null, 1), null);

// --- eventEndDate ---
console.log('[eventEndDate]');
eq('fin de visita', eventEndDate({ from: '2026-05-13', to: '2026-05-16' }), '2026-05-16');
eq('fin asamblea 3 días', eventEndDate({ date: '2026-06-11', days: 3 }), '2026-06-13');
eq('fin asamblea 1 día', eventEndDate({ date: '2026-06-11', days: 1 }), '2026-06-11');

// --- upcomingEvents ---
console.log('[upcomingEvents]');
const up = upcomingEvents(cfgEvents, '2026-05-01', 5);
eq('filtra solo futuros y ordena', up.map(e => e.date), ['2026-05-13', '2026-06-11']);
eq('incluye fecha exacta=from', upcomingEvents({ commemorations: ['2026-05-16'] }, '2026-05-16')[0].type, 'commemoration');
eq('excluye fechas pasadas', upcomingEvents({ commemorations: ['2026-04-04'] }, '2026-05-01'), []);
eq('límite max', upcomingEvents(cfgEvents, '2026-01-01', 1).length, 1);
eq('end de visita en upcoming', upcomingEvents(cfgEvents, '2026-05-01', 5)[0].end, '2026-05-16');
eq('end de asamblea en upcoming', upcomingEvents(cfgEvents, '2026-05-01', 5)[1].end, '2026-06-13');

// --- Labores: collectLaboresPersons ---
console.log('[collectLaboresPersons]');
eq('labores vacías no recoge personas', collectLaboresPersons(undefined), []);
eq('labores completas recoge 3 personas', collectLaboresPersons({
  acomodacion: [1, 2], microfono: ['', 3], plataforma: 4, sonido: '',
}).map(x => x.value), ['1', '2', '3', '4']);
ok('claves labores correctas', collectLaboresPersons({ acomodacion: [1, 2] }).map(x => x.key).join(','), 'labores_acomodacion_0,labores_acomodacion_1');

// --- collectWeekPersons incluye labores (fin de semana) ---
console.log('[collectWeekPersons + labores]');
eq('fin de semana incluye labores', collectWeekPersons({
  type: 'normal', presidente: 1, conductor: 2, lector: 3, outings: [{ oradorSalida: 5 }],
  labores: { acomodacion: [6, 7], microfono: ['', ''], plataforma: '', sonido: '' },
}).map(p => p.value), ['1', '2', '3', '5', '6', '7']);
eq('fin de semana sin labores no rompe', collectWeekPersons({ type: 'normal', presidente: 1 }), [{ value: '1', key: 'presidente' }]);

// --- computeConflicts + labores (fin de semana) ---
console.log('[computeConflicts + labores]');
const mwLabDup = computeConflicts({ weeks: [{
  type: 'normal', presidente: 1, tituloDiscurso: 'T', orador: 'X', conductor: 2, lector: 3, departamento: 4,
  outings: [], labores: { acomodacion: [1, 5], microfono: ['', ''], plataforma: '', sonido: '' },
}] });
ok('labores repetidas con presidente detectadas', mwLabDup.perWeek[0].duplicates.includes('labores_acomodacion_0'));
ok('labores no repetidas no marcan', !mwLabDup.perWeek[0].duplicates.includes('labores_acomodacion_1'));

// --- collectMidweekPersons ---
console.log('[collectMidweekPersons]');
const mwk = {
  sections: [{ title: 'TESOROS', parts: [{ num: 1, assignments: { conductor: '10' } }] }],
  labores: { acomodacion: ['10', ''], microfono: ['', ''], plataforma: '', sonido: '' },
};
eq('recoge pads y labores de entresemana', collectMidweekPersons(mwk).map(p => p.value), ['10', '10']);

// --- computeMidweekConflicts ---
console.log('[computeMidweekConflicts]');
const mwkDup = {
  sections: [{ title: 'TESOROS', parts: [
    { num: 1, assignments: { conductor: '10' } },
    { num: 3, assignments: { lector: '10' } },
  ] }],
  labores: { acomodacion: ['', ''], microfono: ['', ''], plataforma: '', sonido: '' },
};
ok('entresemana detecta persona repetida en 2 partes', computeMidweekConflicts(mwkDup).errors.length > 0);
ok('dupKeys incluye ambas partes', computeMidweekConflicts(mwkDup).dupKeys.has('mw_0_3_lector'));
ok('recoge el presidente de entre semana', collectMidweekPersons({ presidente: '20', sections: [], labores: {} }).some(p => p.key === 'mw_presidente' && p.value === '20'));
ok('presidente repetido con una parte se detecta', computeMidweekConflicts({
  presidente: '10',
  sections: [{ title: 'TESOROS', parts: [{ num: 1, assignments: { conductor: '10' } }] }],
  labores: {},
}).dupKeys.has('mw_presidente'));
const mwkOk = {
  sections: [{ title: 'TESOROS', parts: [
    { num: 1, assignments: { conductor: '10' } },
    { num: 3, assignments: { lector: '11' } },
  ] }],
  labores: { acomodacion: ['', ''], microfono: ['', ''], plataforma: '', sonido: '' },
};
ok('entresemana sin duplicados: 0 errors', computeMidweekConflicts(mwkOk).errors.length === 0);

// --- labelOfKey labores ---
console.log('[labelOfKey labores]');
ok('etiqueta de labores acomodacion 2', labelOfKey('labores_acomodacion_1') === 'labores de acomodación 2');
ok('etiqueta de labores plataforma (1 solo)', labelOfKey('labores_plataforma_0') === 'labores de plataforma');

// --- eligiblePeople (dedupe de ya asignados en la semana) ---
console.log('[eligiblePeople]');
const peopleE = [
  { id: 1, name: 'Luis', roles: ['presidente', 'lector', 'acomodador'] },
  { id: 2, name: 'Pedro', roles: ['presidente', 'lector'] },
  { id: 3, name: 'Juan', roles: ['lector'] },
  { id: 4, name: 'Ana', roles: [] },
];
const weekLuis = { type: 'normal', presidente: 1, outings: [], labores: {} };
ok('excluye a los ya asignados en la misma semana', eligiblePeople(weekLuis, peopleE, 'lector', '').map(p => p.name).sort().join(',') === 'Ana,Juan,Pedro');
ok('mantiene al que ya ocupa el puesto', eligiblePeople(weekLuis, peopleE, 'presidente', 1).some(p => p.id === 1));
ok('permite elegir en otra semana al asignado en esta (dedupe es intra-semana)', eligiblePeople({ type: 'normal', presidente: 2, outings: [], labores: {} }, peopleE, 'presidente', '').some(p => p.id === 1));
ok('sin rol aplica solo el dedupe de asignados', eligiblePeople(weekLuis, peopleE, '', '').length === 3);
ok('soporta predicado (labores) y excluye al asignado', eligiblePeople({ type: 'normal', labores: { acomodacion: ['1', ''] } }, peopleE, isLaborePerson, '').map(p => p.name).join(',') === 'Ana');

// --- Convertidores de PDF (carga de archivos) ---
console.log('[convertPdfMidweeks]');
// Texto representativo del formato de la Guía de Actividades (letras separadas,
// partes y lecturas fragmentadas en varias líneas).
const guideText = [
  '6 -1 2 D E J U L I O J E R E M',
  '´ I A S 1 3 - 1 5',
  'C a n c i',
  '´',
  'o n 1 2 3 y o r a c i',
  '´',
  'o n',
  'T E S OROS',
  'DE L A B I BL I A',
  '1 . J eho v',
  '´',
  'a merece q ue le obedez c amos (1 0 m ins . )',
  'S E A M OS',
  'M E JORE S M A E S T ROS',
  'N U E S T R A',
  'V I D A C R I S T I A N A',
  '1 3 -1 9 D E J U L I O',
  'J E R E M I A S 1 6 , 1 7',
].join('\n');
const gd = convertPdfMidweeks(guideText);
const gweeks = gd.data ? gd.data.weeks : [];
ok('detecta 2 semanas', gweeks.length === 2, `got=${gweeks.length}`);
ok('cada semana trae id (lunes)', gweeks.every(w => /^\d{4}-\d{2}-\d{2}$/.test(String(w.id))), `ids=${gweeks.map(w => w.id).join(',')}`);
ok('id de la semana 1 es el lunes', gweeks[0] && gweeks[0].id === '2026-07-06');
ok('separar palabras de título comprimido', splitWords('jehovamerecequeleobedezcamos') === 'jehova merece que le obedezcamos');
ok('separar palabras: perlas escondidas', splitWords('busquemosperlasescondidas') === 'busquemos perlas escondidas');
ok('la semana de traslape conserva el lunes del mes de la cabecera', convertPdfMidweeks('28 -4 D E S E P T I E M B R E\nT E S O R O S\n1 . Titulo (10 mins.)').data.weeks[0].id === '2026-09-28');
ok('la cabecera de traslape muestra el mes de fin', convertPdfMidweeks('28 -4 D E S E P T I E M B R E\nT E S O R O S\n1 . Titulo (10 mins.)').data.weeks[0].header === '28-4 DE OCTUBRE');
ok('formato completo de traslape detectado', convertPdfMidweeks('28 DE SEPTIEMBRE A 4 DE OCTUBRE\nT E S O R O S\n1 . Titulo (10 mins.)').data.weeks[0].id === '2026-09-28');
ok('cabecera de traslape usa el mes de fin', convertPdfMidweeks('28 DE SEPTIEMBRE A 4 DE OCTUBRE\nT E S O R O S\n1 . Titulo (10 mins.)').data.weeks[0].header === '28-4 DE OCTUBRE');
ok('cabecera semana 1', gweeks[0] && gweeks[0].header === '6-12 DE JULIO');
ok('cabecera semana 2', gweeks[1] && gweeks[1].header === '13-19 DE JULIO');
ok('lectura semana 1', gweeks[0] && gweeks[0].reading === 'JEREMIAS 13-15', `got=${gweeks[0] && JSON.stringify(gweeks[0].reading)}`);
ok('lectura semana 2', gweeks[1] && gweeks[1].reading === 'JEREMIAS 16,17');
ok('cada semana tiene las 3 secciones', gweeks.every(w => w.sections.map(s => s.id).join(',') === 'tesoros,maestros,vida'));
ok('sin cabeceras repetidas', new Set(gweeks.map(w => w.header)).size === gweeks.length);
ok('sin texto deja datos nulos', convertPdfMidweeks('texto sin semanas').data === null);

console.log('[rebuildPdfWords]');
// Simula los ítems que devuelve pdf.js (getTextContent): cada glifo con su
// posición (transform[4]=x, transform[5]=y), width y height.
{
  const fs = 10;
  const glyph = (str, x, y) => ({ str, transform: [1,0,0,1,x,y], width: str.length * 6, height: fs });
  const items = [
    // Fila 1 (y=100): "6-12 DE JULIO" con huecos reales entre palabras.
    glyph('6', 10, 100), glyph('-', 16, 100), glyph('1', 20, 100), glyph('2', 26, 100),
    glyph('D', 48, 100), glyph('E', 54, 100),
    glyph('J', 80, 100), glyph('U', 86, 100), glyph('L', 92, 100), glyph('I', 98, 100), glyph('O', 104, 100),
    // Fila 2 (y=90): "JEREMIAS 13-15"
    glyph('J', 10, 90), glyph('E', 16, 90), glyph('R', 22, 90), glyph('E', 28, 90), glyph('M', 34, 90), glyph('I', 40, 90), glyph('A', 46, 90), glyph('S', 52, 90),
    glyph('1', 78, 90), glyph('3', 84, 90), glyph('-', 90, 90), glyph('1', 94, 90), glyph('5', 100, 90),
  ];
  const txt = rebuildPdfWords(items);
  const lines = txt.split('\n');
  ok('agrupa por filas (2 líneas)', lines.length === 2, `txt=${JSON.stringify(txt)}`);
  ok('inserta espacio entre palabras', lines[0] === '6-12 DE JULIO', `l0=${JSON.stringify(lines[0])}`);
  ok('segunda fila con espacio antes del rango', lines[1] === 'JEREMIAS 13-15', `l1=${JSON.stringify(lines[1])}`);
}
{
  // La guía imprime Tesoros (izquierda) y Seamos Mejores Maestros (derecha) en
  // dos columnas cuyas filas se intercalan verticalmente. rebuildPdfWords debe
  // emitir primero la columna izquierda completa y luego la derecha para que el
  // parser asigne cada parte a su sección.
  const fs = 10;
  const glyph = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y], width: str.length * 6, height: fs });
  const items = [];
  // Izquierda (x≈50): "TESOROS DE LA BIBLIA", "1. Discurso (10 mins.)", "2. Perlas (10 mins.)"
  // Derecha (x≈250): "SEAMOS MEJORES MAESTROS", "4. Empiece conversaciones (4 mins.)"
  // Las filas se alternan: izq/derecha/izq/derecha para simular el intercalado.
  const izq = [
    [100, 'TESOROS'], [100, 'DE LA BIBLIA'],
    [90, '1. Discurso (10 mins.)'],
    [80, '2. Perlas escondidas (10 mins.)'],
  ];
  const der = [
    [95, 'SEAMOS MEJORES MAESTROS'],
    [70, '4. Empiece conversaciones (4 mins.)'],
  ];
  // Los glifos de cada columna se repiten para superar el umbral mínimo de
  // detección (la página real tiene miles de glifos).
  let n = 0;
  for (let rep = 0; rep < 5; rep++) {
    izq.forEach(([y, txt]) => { for (const ch of txt) { items.push(glyph(ch, 50 + n++ * 2, y)); } });
    der.forEach(([y, txt]) => { for (const ch of txt) { items.push(glyph(ch, 250 + n++ * 2, y)); } });
  }
  const out = rebuildPdfWords(items);
  const izqIdx = out.indexOf('TESOROS');
  const derIdx = out.indexOf('MEJORES MAESTROS');
  ok('columnas: izquierda (Tesoros) antes que derecha (Maestros)', izqIdx !== -1 && derIdx !== -1 && izqIdx < derIdx, `out=${JSON.stringify(out.slice(0, 120))}`);
  ok('columnas: partes de Tesoros y Maestros sin mezclar',
    /1\.\s*Discurso[\s\S]*2\.\s*Perlas/.test(out) && /4\.\s*Empiece/.test(out),
    `out=${JSON.stringify(out.slice(0, 200))}`);
}
{
  // Texto naturalmente espaciado (lo que produce rebuildPdfWords): el parser
  // debe respetar los títulos sin usar el diccionario.
  const natural = [
    '6-12 DE JULIO',
    'JEREMIAS 13-15',
    'CANCIÓN 123 y oración',
    'TESOROS DE LA BIBLIA',
    '1. Jehová merece que le obedezcamos (10 mins.)',
    'SEAMOS MEJORES MAESTROS',
    'NUESTRA VIDA CRISTIANA',
    '13-19 DE JULIO',
    'JEREMIAS 16,17',
  ].join('\n');
  const w = convertPdfMidweeks(natural).data.weeks;
  ok('parsea 2 semanas con texto natural', w.length === 2);
  ok('título natural sin diccionario', w[0].sections[0].parts.some(p => p.title === 'Jehová merece que le obedezcamos'));
  ok('lectura natural', w[0].reading === 'JEREMIAS 13-15');
}
{
  // Avisos de completitud: una semana sin lectura ni canciones debe avisar.
  const res = convertPdfMidweeks('6-12 DE JULIO\nTESOROS DE LA BIBLIA\n1. Título (10 mins.)');
  ok('avisa de semanas incompletas', res.warnings.some(x => /incompleta/.test(x)));
}
{
  // Semana completa no debe avisar de incompletitud.
  const res = convertPdfMidweeks([
    '6-12 DE JULIO', 'JEREMIAS 13-15', 'CANCIÓN 1 y oración',
    'TESOROS DE LA BIBLIA', '1. Título (10 mins.)',
    'SEAMOS MEJORES MAESTROS', '2. Otro (5 mins.)',
    'NUESTRA VIDA CRISTIANA', '3. Más (5 mins.)',
    'CANCIÓN 2',
  ].join('\n'));
  ok('sin avisos de incompletitud', !res.warnings.some(x => /incompleta/.test(x)));
}

console.log('[midweekGuideSummary]');
ok('reconoce guía por cabeceras', midweekGuideSummary(guideText).weeksCount === 2);
ok('null sin títulos ni cabeceras', midweekGuideSummary('texto cualquiera') === null);
ok('válida por títulos de las tres secciones',
  midweekGuideSummary('REUNIÓN DE ENTRE SEMANA\nTESOROS DE LA BIBLIA\nSEAMOS MEJORES MAESTROS\nNUESTRA VIDA CRISTIANA')?.weeksCount === 0);
ok('válida por títulos con letras separadas',
  midweekGuideSummary('T E S O R O S  D E  L A  B I B L I A\nSEAMOS MEJORES MAESTROS\nNUESTRA VIDA CRISTIANA')?.weeksCount === 0);
ok('no válida si falta una sección', midweekGuideSummary('TESOROS DE LA BIBLIA\nSEAMOS MEJORES MAESTROS') === null);
ok('año detectado por títulos', midweekGuideSummary('GUÍA 2026\nTESOROS DE LA BIBLIA\nSEAMOS MEJORES MAESTROS\nNUESTRA VIDA CRISTIANA')?.year === 2026);

console.log('[convertPdfTalks]');
ok('detecta discursos numerados', convertPdfTalks('1. La Biblia\n2- El Reino\n3: Esperanza').data.discursos.length === 3);
ok('sin discursos devuelve nulo', convertPdfTalks('nada').data === null);

console.log('[convertPdfPeople]');
ok('detecta nombres por rol', convertPdfPeople('presidente\nJuan Pérez\nlector\nMaría López\n').data.roles.presidente.includes('Juan Pérez'));

console.log('[convertPdfToData]');
ok('despacha por tipo', convertPdfToData('midweeks', guideText).data.weeks.length === 2);
ok('tipo desconocido devuelve nulo', convertPdfToData('otro', 'x').data === null);

// --- Conflictos cruzados entre programas ---
console.log('[computeCrossConflicts]');
// E1: misma semana, entre semana (presidente) + acomodación (misma persona).
{
  const ctx = {
    midweeks: [{ id: '2026-09-07', presidente: '1', sections: [] }],
    months: [],
    labores: [{ id: '2026-09', weeks: [{ saturday: '2026-09-12', labores: { acomodacion: ['1', ''] } }] }],
    salidas: [],
  };
  const c = computeCrossConflicts(ctx);
  ok('E1: entre semana + acomodación misma semana', c.some(x => x.regla === 'E1' && x.value === '1'));
}
// E2: misma semana, fin de semana (presidente) + acomodación.
{
  const ctx = {
    midweeks: [],
    months: [{ id: '2026-09', month: 9, weeks: [{ date: '2026-09-12', presidente: '2', type: 'normal' }] }],
    labores: [{ id: '2026-09', weeks: [{ saturday: '2026-09-12', labores: { microfono: ['2', ''] } }] }],
    salidas: [],
  };
  const c = computeCrossConflicts(ctx);
  ok('E2: fin de semana + acomodación misma semana', c.some(x => x.regla === 'E2' && x.value === '2'));
}
// E3: mismo mes, entre semana, misma asignación en 2 semanas.
{
  const ctx = {
    midweeks: [
      { id: '2026-09-07', sections: [{ title: 'T', parts: [{ num: 1, assignments: { conductor: '3' } }] }] },
      { id: '2026-09-14', sections: [{ title: 'T', parts: [{ num: 1, assignments: { conductor: '3' } }] }] },
    ],
    months: [], labores: [], salidas: [],
  };
  const c = computeCrossConflicts(ctx);
  ok('E3: misma asignación entre semana repetida en el mes', c.some(x => x.regla === 'E3' && x.value === '3'));
}
// E4: mismo mes, fin de semana, mismo campo en 2 semanas.
{
  const ctx = {
    midweeks: [],
    months: [{ id: '2026-09', month: 9, weeks: [
      { date: '2026-09-05', presidente: '4', type: 'normal' },
      { date: '2026-09-12', presidente: '4', type: 'normal' },
    ] }],
    labores: [], salidas: [],
  };
  const c = computeCrossConflicts(ctx);
  ok('E4: mismo campo fin de semana repetido en el mes', c.some(x => x.regla === 'E4' && x.value === '4'));
}
// E5: mismo mes, salidas, más de una salida.
{
  const ctx = {
    midweeks: [], months: [],
    labores: [],
    salidas: [{ id: '2026-09', weeks: [
      { saturday: '2026-09-05', outings: [{ oradorSalida: '5' }] },
      { saturday: '2026-09-12', outings: [{ oradorSalida: '5' }] },
    ] }],
  };
  const c = computeCrossConflicts(ctx);
  ok('E5: más de una salida en el mes', c.some(x => x.regla === 'E5' && x.value === '5'));
}
// Sin conflictos.
{
  const ctx = {
    midweeks: [{ id: '2026-09-07', presidente: '1', sections: [] }],
    months: [{ id: '2026-09', month: 9, weeks: [{ date: '2026-09-12', presidente: '2', type: 'normal' }] }],
    labores: [], salidas: [],
  };
  ok('sin conflictos cruzados', computeCrossConflicts(ctx).length === 0);
}

// --- Compatibilidad de parejas (canBePair) ---
console.log('[canBePair]');
const p = (id, cal, gen, enl = '') => ({ id, calificacion: cal, genero: gen, enlace: enl });
ok('A+B válido', canBePair(p(1, 'A', 'masculino'), p(2, 'B', 'masculino')));
ok('B+B válido', canBePair(p(1, 'B', 'femenino'), p(2, 'B', 'femenino')));
ok('A+C mismo género válido', canBePair(p(1, 'A', 'masculino'), p(2, 'C', 'masculino')));
// A+C con distinto género sin enlace → inválido por mixto.
ok('A+C mixto sin enlace inválido', canBePair(p(1, 'A', 'masculino'), p(2, 'C', 'femenino')) === false);
// A+C sin género definido → válido por tabla.
ok('A+C sin género válido', canBePair(p(1, 'A', ''), p(2, 'C', '')) === true);
ok('A+A inválido', canBePair(p(1, 'A', ''), p(2, 'A', '')) === false);
// D solo con su enlace mutuo.
ok('D con su enlace válido', canBePair(p(1, 'D', 'masculino', '2'), p(2, 'D', 'masculino', '1')));
ok('D sin enlace mutuo inválido', canBePair(p(1, 'D', 'masculino', ''), p(2, 'D', 'masculino', '1')) === false);
// Mismo género siempre válido (aunque calificación A+A).
ok('mismo género A+A válido', canBePair(p(1, 'A', 'masculino'), p(2, 'A', 'masculino')));
// Mixto solo si enlazados.
ok('mixto enlazados válido', canBePair(p(1, 'A', 'masculino', '2'), p(2, 'B', 'femenino', '1')));
ok('mixto sin enlace inválido', canBePair(p(1, 'A', 'masculino'), p(2, 'B', 'femenino')) === false);
ok('misma persona inválido', canBePair(p(1, 'A', ''), p(1, 'A', '')) === false);
// Sin calificación/género registrado no se puede juzgar → permitido (evita bloquear
// la asignación de presentaciones cuando faltan datos).
ok('sin calificación ni género: permitida', canBePair(p(1, '', ''), p(2, '', '')) === true);
ok('una sola sin calificación: permitida', canBePair(p(1, '', ''), p(2, 'A', '')) === true);
// Mixto sin enlace sigue inválido aunque falte la calificación.
ok('mixto sin enlace inválido aunque falte calificación', canBePair(p(1, '', 'masculino'), p(2, 'A', 'femenino')) === false);

console.log('[isStudentPerson / isStudentRole]');
ok('isStudentRole asignacion2', isStudentRole('asignacion2') === true);
ok('isStudentRole asignacion4 falso', isStudentRole('asignacion4') === false);
ok('isStudentPerson con rol de presentación', isStudentPerson({ roles: ['asignacion2'] }));
ok('isStudentPerson con rol de lectura', isStudentPerson({ roles: ['asignacion1'] }));
ok('isStudentPerson sin roles', isStudentPerson({ roles: [] }));
ok('isStudentPerson con rol ajeno', !isStudentPerson({ roles: ['presidente'] }));

// --- Estructura de midweeks.json (datos para el análisis de reuniones) ---
console.log('[estructura midweeks.json]');
const mwJson = JSON.parse(readFileSync(new URL('./midweeks.json', import.meta.url), 'utf8'));
const mwWeeks = mwJson.weeks || [];
ok('midweeks.json tiene semanas', mwWeeks.length > 0);
ok('cada semana tiene secciones tesoros/maestros/vida', mwWeeks.every(w => {
  const ids = (w.sections || []).map(s => s.id).join(',');
  return ids === 'tesoros,maestros,vida';
}));
ok('las partes tienen num, title y mins', mwWeeks.every(w => (w.sections || []).every(s => (s.parts || []).every(p => p.num && p.title && typeof p.mins === 'number'))));
ok('cada semana tiene id y header', mwWeeks.every(w => w.id && w.header));
ok('tesoros siempre tiene 3 partes', mwWeeks.every(w => (w.sections.find(s => s.id === 'tesoros') || {}).parts.length === 3));

// --- LABORES_DEF / LABORE_ROLES / isLaborePerson ---
console.log('[LABORES_DEF / labore roles]');
eq('LABORES_DEF 4 roles con icono y cantidad', LABORES_DEF.map(d => `${d.key}:${d.count}:${!!d.icon}`), ['acomodacion:2:true', 'microfono:2:true', 'plataforma:1:true', 'sonido:1:true']);
ok('LABORE_ROLES incluye roles de atención', ['audio', 'microf', 'plataforma', 'acomodador'].every(r => LABORE_ROLES.includes(r)));
ok('isLaborePerson con rol de atención', isLaborePerson({ name: 'X', roles: ['audio'] }));
ok('isLaborePerson sin roles incluida', isLaborePerson({ name: 'X' }));
ok('isLaborePerson con roles ajenos excluida', !isLaborePerson({ name: 'X', roles: ['presidente'] }));

// --- midweekSlotsOf ---
console.log('[midweekSlotsOf]');
{
  const week = {
    sections: [
      { id: 'tesoros', parts: [
        { num: 1, title: 'Discurso', mins: 10 },
        { num: 2, title: 'Perlas', mins: 10 },
        { num: 3, title: 'Lectura', mins: 4 },
      ]},
      { id: 'maestros', parts: [
        { num: 1, title: 'Presentación', mins: 15 },
        { num: 2, title: 'Discurso estudiantil', mins: 5 },
      ]},
      { id: 'vida', parts: [
        { num: 1, title: 'Discurso', mins: 15 },
        { num: 2, title: 'Estudio Bíblico', mins: 30 },
      ]},
    ],
  };
  const [tes, mas, vida] = week.sections;
  const slot = (sec, p) => midweekSlotsOf(sec, p).map(s => `${s.key}:${s.role}`);
  eq('tesoros discurso es asignacion4', slot(tes, tes.parts[0]), ['conductor:asignacion4']);
  eq('tesoros perlas es asignacion4', slot(tes, tes.parts[1]), ['conductor:asignacion4']);
  eq('tesoros lectura es asignacion1', slot(tes, tes.parts[2]), ['lector:asignacion1']);
  eq('maestros presentación es pareja asignacion2', slot(mas, mas.parts[0]), ['estudiante:asignacion2', 'ayudante:asignacion2']);
  eq('maestros discurso estudiantil es asignacion3', slot(mas, mas.parts[1]), ['conductor:asignacion3']);
  eq('vida discurso es asignacion4', slot(vida, vida.parts[0]), ['conductor:asignacion4']);
  eq('vida estudio bíblico es conductor2+lector2', slot(vida, vida.parts[1]), ['conductor:conductor2', 'lector:lector2']);
}

// --- automatizarEntreSemana ---
console.log('[automatizarEntreSemana]');
{
  const personas = [];
  for (let i = 1; i <= 30; i++) {
    const mod = i % 5;
    const roles = mod === 0 ? ['presidente']
      : mod === 1 ? ['asignacion1', 'asignacion2', 'asignacion3']
      : mod === 2 ? ['asignacion4', 'asignacion2']
      : mod === 3 ? ['conductor1', 'lector1', 'presidente', 'conductor2', 'lector2']
      : ['asignacion2', 'asignacion3'];
    personas.push({ id: i, name: `P${i}`, roles, calificacion: i % 3 === 0 ? 'A' : (i % 3 === 1 ? 'B' : 'C'), genero: null, enlace: null });
  }
  const mkWeek = (id) => ({
    id,
    header: id,
    presidente: '',
    sections: [
      { id: 'tesoros', title: 'Tesoros', parts: [
        { num: 1, title: 'Discurso', mins: 10 },
        { num: 2, title: 'Perlas', mins: 10 },
        { num: 3, title: 'Lectura', mins: 4 },
      ]},
      { id: 'maestros', title: 'Seamos mejores maestros', parts: [
        { num: 1, title: 'Presentación', mins: 15 },
        { num: 2, title: 'Discurso estudiantil', mins: 5 },
      ]},
      { id: 'vida', title: 'Nuestra vida cristiana', parts: [
        { num: 1, title: 'Discurso', mins: 15 },
        { num: 2, title: 'Estudio Bíblico', mins: 30 },
      ]},
    ],
  });
  const weeks = [mkWeek('2026-07-06'), mkWeek('2026-07-13')];
  const rep = automatizarEntreSemana(personas, weeks);
  ok('entre semana rellena todos los puestos', rep.vacios.length === 0, JSON.stringify(rep.vacios));
  ok('asigna presidente en cada semana', weeks.every(w => w.presidente));

  // E2: sin persona duplicada dentro de una misma semana.
  const dupes = weeks.map(w => {
    const ids = [w.presidente];
    w.sections.forEach(sec => sec.parts.forEach(p => Object.values(p.assignments || {}).forEach(id => { if (id) ids.push(String(id)); })));
    return ids.length === new Set(ids).size;
  });
  ok('sin personas repetidas en la misma semana', dupes.every(Boolean));

  // E3: la misma parte (si_num_slot) no se repite con la misma persona en el mes.
  const e3ok = ['0_1_conductor', '0_3_lector', '1_1_estudiante', '1_1_ayudante', '2_1_conductor', '2_2_conductor', '2_2_lector']
    .every(k => {
      const ids = weeks.map(w => {
        const [si, num, slot] = k.split('_');
        const sec = w.sections[Number(si)];
        const part = sec.parts.find(p => String(p.num) === num);
        return part ? (part.assignments || {})[slot] : '';
      }).filter(Boolean);
      return ids.length === new Set(ids).size;
    });
  ok('la misma parte no se repite con la misma persona en el mes', e3ok);

  // Parejas de presentación respetan canBePair.
  const pairsOk = weeks.every(w => {
    const sec = w.sections[1];
    const part = sec.parts[0];
    const a = (part.assignments || {}).estudiante;
    const b = (part.assignments || {}).ayudante;
    if (!a || !b) return false;
    return canBePair(personas.find(p => String(p.id) === String(a)), personas.find(p => String(p.id) === String(b)));
  });
  ok('las parejas de presentación cumplen canBePair', pairsOk);

  // No sobreescribe lo ya asignado.
  const w2 = mkWeek('2026-07-20');
  w2.presidente = '5';
  w2.sections[0].parts[0].assignments = { conductor: '7' };
  const antes = w2.sections[0].parts[0].assignments.conductor;
  automatizarEntreSemana(personas, [w2]);
  eq('conserva el presidente ya asignado', w2.presidente, '5');
  eq('conserva la parte ya asignada', w2.sections[0].parts[0].assignments.conductor, antes);

  // Exclusión de personas ocupadas en la misma semana (acomodación/salidas).
  const w3 = mkWeek('2026-07-27');
  const ocupados = new Map([['2026-08-01', new Set(['1', '2', '3'])]]); // sábado de esa semana
  automatizarEntreSemana(personas, [w3], ocupados);
  const idsW3 = [w3.presidente];
  w3.sections.forEach(sec => sec.parts.forEach(p => Object.values(p.assignments || {}).forEach(id => { if (id) idsW3.push(String(id)); })));
  ok('no asigna a personas ocupadas esa semana (E1/E2)',
    !idsW3.includes('1') && !idsW3.includes('2') && !idsW3.includes('3'));

  // El Estudio Bíblico solo exige el rol (conductor2/lector2), sin compatibilidad de
  // pareja: aunque la pareja no cumpliría canBePair (D sin enlace), se conserva.
  const soloRol = [
    { id: 1, name: 'Conductor', roles: ['conductor2'], calificacion: 'D' },
    { id: 2, name: 'Lector', roles: ['lector2'] },
  ];
  const weekEstudio = mkWeek('2026-08-03');
  const partEstudio = weekEstudio.sections[2].parts[1]; // Estudio Bíblico
  partEstudio.assignments = { conductor: '1', lector: '2' };
  const repEst = automatizarEntreSemana(soloRol, [weekEstudio]);
  const rolesVacios = repEst.vacios.map(v => v.role);
  ok('estudio bíblico no exige compatibilidad de pareja',
    partEstudio.assignments.conductor === '1' && partEstudio.assignments.lector === '2'
    && !rolesVacios.includes('conductor2') && !rolesVacios.includes('lector2'));

  // El pool de estudiantes acepta a quien tenga cualquier rol de estudiante:
  // personas con solo "lectura" (asignacion1) pueden tomar presentaciones (asignacion2).
  const estudiantesLectura = [
    { id: 1, name: 'SL A', roles: ['asignacion1'] },
    { id: 2, name: 'SL B', roles: ['asignacion1'] },
    { id: 3, name: 'SL C', roles: ['asignacion1'] },
    { id: 4, name: 'SL D', roles: ['asignacion1'] },
  ];
  const weekPres = mkWeek('2026-08-10');
  automatizarEntreSemana(estudiantesLectura, [weekPres]);
  const partPres = weekPres.sections[1].parts[0]; // Presentación (pareja)
  ok('estudiantes con rol de lectura pueden participar en presentación',
    (partPres.assignments || {}).estudiante === '2' && (partPres.assignments || {}).ayudante === '3');
}

// --- automatizarAcomodacion ---
console.log('[automatizarAcomodacion]');
{
  const people = [];
  for (let i = 1; i <= 16; i++) people.push({ id: i, name: `A${i}`, roles: i <= 8 ? ['audio', 'microf'] : ['acomodador'] });
  const midweeks = [
    { id: '2026-07-06', presidente: 1, sections: [{ id: 'tesoros', parts: [{ num: 1, title: 'Discurso', mins: 10, assignments: { conductor: 2 } }] }] },
    { id: '2026-07-13', presidente: 4, sections: [{ id: 'tesoros', parts: [{ num: 1, title: 'Discurso', mins: 10, assignments: { conductor: 5 } }] }] },
  ];
  const lab = {
    id: '2026-07',
    weeks: [
      { saturday: '2026-07-11', labores: { acomodacion: ['', ''], microfono: ['', ''], plataforma: '', sonido: '' } },
      { saturday: '2026-07-18', labores: { acomodacion: ['', ''], microfono: ['', ''], plataforma: '', sonido: '' } },
    ],
  };
  const rep = automatizarAcomodacion(people, [lab], midweeks);
  const sat11 = lab.weeks[0].labores, sat18 = lab.weeks[1].labores;
  const ocupados11 = Object.values(sat11).flatMap(v => Array.isArray(v) ? v : [v]);
  const ocupados18 = Object.values(sat18).flatMap(v => Array.isArray(v) ? v : [v]);
  ok('no asigna a nadie que esté en entre semana esa semana (E1)',
    !ocupados11.includes('1') && !ocupados11.includes('2') && !ocupados18.includes('4') && !ocupados18.includes('5'));
  ok('sin repetir a la misma persona dos veces en la misma semana',
    new Set(ocupados11.filter(Boolean)).size === ocupados11.filter(Boolean).length &&
    new Set(ocupados18.filter(Boolean)).size === ocupados18.filter(Boolean).length);
  // Mismo labore clave no se repite con la misma persona en el mes.
  const porClave = {};
  [sat11, sat18].forEach(l => Object.entries(l).forEach(([k, v]) => {
    (Array.isArray(v) ? v : [v]).forEach((id, si) => { if (id) (porClave[`${k}_${si}`] ||= []).push(String(id)); });
  }));
  ok('el mismo labore no se repite con la misma persona en el mes',
    Object.values(porClave).every(arr => arr.length === new Set(arr).size));
  ok('acomodación asigna puestos', rep.asignados > 0);
  // Las labores de entre semana (week.labores del midweek) también se rellenan.
  ok('rellena labores de entre semana en el midweek',
    midweeks.every(mw => Object.values(mw.labores || {}).some(v => (Array.isArray(v) ? v : [v]).some(x => x))));
  // La persona en labores ES no debe ser la misma que en FS del mismo sábado.
  const mw1 = midweeks[0].labores, mw2 = midweeks[1].labores;
  const es1 = Object.values(mw1).flatMap(v => Array.isArray(v) ? v : [v]).filter(Boolean);
  const es2 = Object.values(mw2).flatMap(v => Array.isArray(v) ? v : [v]).filter(Boolean);
  const fs11 = Object.values(sat11).flatMap(v => Array.isArray(v) ? v : [v]).filter(Boolean);
  const fs18 = Object.values(sat18).flatMap(v => Array.isArray(v) ? v : [v]).filter(Boolean);
  ok('labores ES no repiten persona con FS del mismo sábado',
    es1.every(id => !fs11.includes(String(id))) && es2.every(id => !fs18.includes(String(id))));
  ok('labores ES no asignan a quien participa en la reunión ES esa semana',
    !es1.includes('1') && !es1.includes('2') && !es2.includes('4') && !es2.includes('5'));
}

// --- automatizarFinSemana ---
console.log('[automatizarFinSemana]');
{
  const people = [];
  for (let i = 1; i <= 6; i++) people.push({ id: i, name: `F${i}`, roles: ['presidente', 'conductor1', 'lector1'] });
  const months = [{
    id: '2026-07', year: 2026, month: 7,
    weeks: [
      { type: 'normal', date: '2026-07-11', presidente: '', conductor: '', lector: '', orador: '' },
      { type: 'normal', date: '2026-07-18', presidente: '', conductor: '', lector: '', orador: '' },
    ],
  }];
  const salidas = [{ id: '2026-07', weeks: [{ saturday: '2026-07-11', outings: [{ oradorSalida: 1 }] }] }];
  const labores = [{ id: '2026-07', weeks: [{ saturday: '2026-07-18', labores: { acomodacion: [2, ''], microfono: ['', ''], plataforma: '', sonido: '' } }] }];
  const rep = automatizarFinSemana(people, months, salidas, labores);
  ok('fin de semana rellena todos los campos', rep.vacios.length === 0, JSON.stringify(rep.vacios));
  ok('asigna 6 campos en 2 semanas normales', rep.asignados === 6);
  const w1 = months[0].weeks[0], w2 = months[0].weeks[1];
  ok('excluye a quien tiene salida esa semana', ![w1.presidente, w1.conductor, w1.lector].includes('1'));
  ok('excluye a quien está en acomodación esa semana', ![w2.presidente, w2.conductor, w2.lector].includes('2'));
  ok('mismo campo no se repite con la misma persona en el mes',
    ['presidente', 'conductor', 'lector'].every(f => w1[f] !== w2[f]));
  ok('sin personas repetidas dentro de la misma semana',
    new Set([w1.presidente, w1.conductor, w1.lector]).size === 3 &&
    new Set([w2.presidente, w2.conductor, w2.lector]).size === 3);
  // No sobreescribe lo ya asignado.
  const w3 = { type: 'normal', date: '2026-07-25', presidente: '3', conductor: '', lector: '', orador: '' };
  const meses2 = [{ id: '2026-07', year: 2026, month: 7, weeks: [w3] }];
  automatizarFinSemana(people, meses2, [], []);
  eq('conserva el presidente ya asignado en fin de semana', w3.presidente, '3');
}

// --- extractAssignments ---
console.log('[extractAssignments]');
{
  const people = [
    { id: 1, name: 'Ana' }, { id: 2, name: 'Ben' }, { id: 3, name: 'Carlos' },
    { id: 4, name: 'Diana' }, { id: 5, name: 'Elena' },
  ];
  const midweeks = [{
    id: '2026-08-10', header: '10-16 DE AGOSTO',
    presidente: '1',
    labores: { acomodacion: ['2', '5'], microfono: ['', ''], plataforma: '', sonido: '' },
    sections: [
      { id: 'tesoros', title: 'Tesoros', parts: [
        { num: 1, title: 'Discurso', mins: 10, assignments: { conductor: '2' } },
        { num: 2, title: 'Lectura', mins: 4, assignments: { lector: '3' } },
      ]},
      { id: 'maestros', title: 'Maestros', parts: [
        { num: 3, title: 'Presentación', mins: 5, assignments: { estudiante: '4', ayudante: '5' } },
      ]},
    ],
  }];
  const months = [{
    id: '2026-08', year: 2026, month: 8,
    weeks: [{ type: 'normal', date: '2026-08-15', presidente: '1', conductor: '2', lector: '3', orador: 'Orador' }],
  }];
  const salidas = [{ id: '2026-08', weeks: [{ saturday: '2026-08-15', outings: [{ oradorSalida: 4 }] }] }];
  const labores = [{ id: '2026-08', weeks: [{ saturday: '2026-08-15', labores: { acomodacion: [5, ''], microfono: ['', ''], plataforma: '', sonido: '' } }] }];
  const entries = extractAssignments(midweeks, months, salidas, labores, people);

  ok('extrae presidente de entre semana', entries.some(e => e.personId === '1' && e.program === 'entre' && e.roleKey === 'presidente'));
  ok('extrae conductor de entre semana', entries.some(e => e.personId === '2' && e.program === 'entre' && e.roleKey === 'asignacion4'));
  ok('extrae lector de entre semana', entries.some(e => e.personId === '3' && e.program === 'entre' && e.roleKey === 'asignacion1'));
  ok('extrae pareja estudiante+ayudante', entries.some(e => e.personId === '4' && e.roleKey === 'asignacion2') && entries.some(e => e.personId === '5' && e.roleKey === 'asignacion2'));
  ok('extrae presidente de fin de semana', entries.some(e => e.personId === '1' && e.program === 'fin'));
  ok('extrae orador de salida', entries.some(e => e.personId === '4' && e.program === 'salidas'));
  ok('extrae labores', entries.some(e => e.personId === '5' && e.program === 'labores' && e.roleKey === 'labores_acomodacion_0'));
  ok('extrae labores de entre semana (midweek.labores)',
    entries.some(e => e.personId === '5' && e.program === 'labores' && e.roleKey === 'labores_acomodacion_1'));
  ok('no incluye el orador de texto libre', !entries.some(e => e.roleKey === 'orador' && e.program === 'fin'));
  const ana = entries.filter(e => e.personId === '1');
  ok('nombre de la persona se resuelve', ana.length > 0 && ana.every(e => e.name === 'Ana'));
  // Idempotencia: re-extraer no cambia los ids.
  const ids1 = entries.map(e => e.id).sort();
  const ids2 = extractAssignments(midweeks, months, salidas, labores, people).map(e => e.id).sort();
  eq('ids estables (idempotente)', ids1, ids2);
}

// --- assignmentMetrics ---
console.log('[assignmentMetrics]');
{
  const people = [
    { id: 1, name: 'Ana', roles: ['presidente', 'asignacion1'] },
    { id: 2, name: 'Ben', roles: ['conductor1'] },
    { id: 3, name: 'Carlos', roles: ['audio'] },
    { id: 4, name: 'Diana', roles: ['presidente'] },
  ];
  const roles = [
    { id: 'presidente', label: 'Presidente' },
    { id: 'conductor1', label: 'Conductor' },
    { id: 'asignacion1', label: 'Lectura' },
    { id: 'audio', label: 'Audio' },
  ];
  const entries = [
    { id: '1_2026-07-06_entre_presidente', personId: '1', date: '2026-07-06', program: 'entre', roleKey: 'presidente' },
    { id: '1_2026-07-13_entre_presidente', personId: '1', date: '2026-07-13', program: 'entre', roleKey: 'presidente' },
    { id: '2_2026-07-06_fin_conductor1', personId: '2', date: '2026-07-06', program: 'fin', roleKey: 'conductor1' },
  ];
  const now = new Date('2026-07-20T12:00:00'); // dentro de 30 días de las fechas
  const metrics = assignmentMetrics(entries, people, roles, now);
  const m1 = metrics.find(m => m.personId === '1');
  const m2 = metrics.find(m => m.personId === '2');
  const m3 = metrics.find(m => m.personId === '3');
  const m4 = metrics.find(m => m.personId === '4');

  ok('total de asignaciones de Ana = 2', m1.total === 2);
  ok('último mes de Ana = 2', m1.lastMonth === 2);
  ok('promedio por mes de Ana = 2', m1.perMonth === 2);
  eq('última asignación de Ana', m1.lastDate, '2026-07-13');
  ok('puede dar pero no le ha tocado: Ana tiene asignacion1 sin asignar',
    m1.canGiveButNot.includes('asignacion1') && !m1.canGiveButNot.includes('presidente'));
  ok('Ben con conductor1 asignado no tiene faltantes', m2.canGiveButNot.length === 0);
  ok('Carlos (audio) puede dar pero no le ha tocado', m3.canGiveButNot.includes('audio'));
  ok('Diana sin asignaciones tiene total 0 y presidente pendiente', m4.total === 0 && m4.canGiveButNot.includes('presidente'));
  ok('Diana sin fecha de última asignación', m4.lastDate === '');
}

console.log(`\n=== Resultado: ${pass} PASS, ${fail} FAIL ===\n`);
process.exit(fail > 0 ? 1 : 0);
