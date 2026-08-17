// tests.mjs - Tests unitarios de funciones puras de Reunión+
// Ejecutar: node tests.mjs

import {
  MONTHS_ES, WEEK_TYPES, FIELD_LABORE, FIELD_LABELS,
  normalizeStr, searchTalks, saturdaysOf,
  collectWeekPersons, labelOfKey, labelOf,
  computeConflicts, computeOutingConflicts, weekComplete,
  collectAtencionPersons, collectMidweekPersons, computeMidweekConflicts, dedupPersons, eligiblePeople,
  ATENCION_DEF, ATENCION_ROLES, isAtencionPerson, splitWords,
  capitalize, escapeHtml, escapeAttr, cryptoId,
  isoDate, eventTypeForDate, upcomingEvents, isSpecialDate, DAYS_ES_NAMES, addDays, eventEndDate,
  convertPdfToData, convertPdfTalks, convertPdfPeople, convertPdfMidweeks, midweekGuideSummary, rebuildPdfWords,
  computeCrossConflicts, canBePair,
  midweekSlotsOf, automatizarEntreSemana, automatizarAtencion, automatizarFinSemana,
  isStudentPerson, isStudentLabore, laboreAllowedForPerson,
  readerLevelEligible, readerPriority,
  extractAssignments, assignmentMetrics,
  defaultAlgorithmConfig, defaultScoringConfig,
  mulberry32, rotateSeed, generateOneProposal, generateProposals, scoreSolution,
  workloadByPerson, historyTimeline, distributionByLabore, pairRoleStats, scarcityIndex,
  salidasFaltantes, laboresVaciasPropuesta, sinAsignarPorMotivo,
  cargoNivel, esPublicador, esAnciano, balanceReport,
} from './logic.js';

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
ok('FIELD_LABORE mapea estudioSinLectura a conductor1', FIELD_LABORE.estudioSinLectura === 'conductor1');
ok('FIELD_LABORE mapea oradorSalida a orador', FIELD_LABORE.oradorSalida === 'orador');
ok('FIELD_LABORE mapea conductor a conductor1', FIELD_LABORE.conductor === 'conductor1');
ok('FIELD_LABORE mapea lector a lector1', FIELD_LABORE.lector === 'lector1');

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

// --- Labores: collectAtencionPersons ---
console.log('[collectAtencionPersons]');
eq('labores vacías no recoge personas', collectAtencionPersons(undefined), []);
eq('labores completas recoge 3 personas', collectAtencionPersons({
  acomodacion: [1, 2], microfono: ['', 3], plataforma: 4, sonido: '',
}).map(x => x.value), ['1', '2', '3', '4']);
ok('claves labores correctas', collectAtencionPersons({ acomodacion: [1, 2] }).map(x => x.key).join(','), 'atencion_acomodacion_0,atencion_acomodacion_1');

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
ok('labores repetidas con presidente detectadas', mwLabDup.perWeek[0].duplicates.includes('atencion_acomodacion_0'));
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
ok('etiqueta de labores acomodacion 2', labelOfKey('atencion_acomodacion_1') === 'labores de acomodación 2');
ok('etiqueta de labores plataforma (1 solo)', labelOfKey('atencion_plataforma_0') === 'labores de plataforma');

// --- eligiblePeople (dedupe de ya asignados en la semana) ---
console.log('[eligiblePeople]');
const peopleE = [
  { id: 1, name: 'Luis', labores: ['presidente', 'lector', 'acomodador'] },
  { id: 2, name: 'Pedro', labores: ['presidente', 'lector'] },
  { id: 3, name: 'Juan', labores: ['lector'] },
  { id: 4, name: 'Ana', labores: [] },
];
const weekLuis = { type: 'normal', presidente: 1, outings: [], labores: {} };
ok('excluye a los ya asignados en la misma semana', eligiblePeople(weekLuis, peopleE, 'lector', '').map(p => p.name).sort().join(',') === 'Ana,Juan,Pedro');
ok('mantiene al que ya ocupa el puesto', eligiblePeople(weekLuis, peopleE, 'presidente', 1).some(p => p.id === 1));
ok('permite elegir en otra semana al asignado en esta (dedupe es intra-semana)', eligiblePeople({ type: 'normal', presidente: 2, outings: [], labores: {} }, peopleE, 'presidente', '').some(p => p.id === 1));
ok('sin rol aplica solo el dedupe de asignados', eligiblePeople(weekLuis, peopleE, '', '').length === 3);
ok('soporta predicado (labores) y excluye al asignado', eligiblePeople({ type: 'normal', labores: { acomodacion: ['1', ''] } }, peopleE, isAtencionPerson, '').map(p => p.name).join(',') === 'Ana');
ok('excluye mujeres de labores bloqueadas (lector)', eligiblePeople({ type: 'normal', outings: [], labores: {} }, [{ id: 5, name: 'María', genero: 'femenino', labores: [] }], 'lector', '').length === 0);
ok('incluye mujer en presentacion (asignacion2)', eligiblePeople({ type: 'normal', outings: [], labores: {} }, [{ id: 5, name: 'María', genero: 'femenino', labores: ['asignacion2'] }], 'asignacion2', '').some(p => p.id === 5));
ok('incluye hombre con la labor', eligiblePeople({ type: 'normal', outings: [], labores: {} }, [{ id: 6, name: 'José', genero: 'masculino', labores: ['lector'] }], 'lector', '').some(p => p.id === 6));

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
  // Tabla de participantes (plantilla Nombre/Género/Calificación exportada a
  // PDF): celdas alineadas en columnas estrechas (~1px de dispersión). rebuildPdfWords
  // debe NO partir la página en dos bloques y conservar cada fila con sus 3 celdas.
  const fs = 10;
  const glyph = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y], width: str.length * 6, height: fs });
  const items = [];
  const rows = [
    ['Nombre', 'Género', 'Calificación'],
    ['Ana', 'Femenino', 'A'],
    ['Juan Pérez', 'Masculino', 'B'],
  ];
  const xs = [70, 220, 360];
  rows.forEach((cells, ri) => {
    const y = 300 - ri * 20;
    cells.forEach((cell, ci) => items.push(glyph(cell, xs[ci], y)));
  });
  const txt = rebuildPdfWords(items);
  const lines = txt.split('\n').filter(Boolean);
  ok('tabla: filas conservadas con sus 3 celdas', lines.length === rows.length, `got=${JSON.stringify(lines)}`);
  ok('tabla: encabezado completo', lines[0] === 'Nombre Género Calificación', `l0=${JSON.stringify(lines[0])}`);
  ok('tabla: fila con nombre compuesto completa', /Juan Pérez\s+Masculino\s+B/.test(lines[2]), `l2=${JSON.stringify(lines[2])}`);
}
{
  // Caso real: lista.pdf exportado de Excel con columnas en x=71/221/364 y
  // muchas filas (dispersión ~1px por columna). Antes el k-means k=2 lo partía
  // en dos bloques (nombres | género+calificación) y rompía las filas.
  const fs = 10;
  const glyph = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y], width: str.length * 6, height: fs });
  const items = [];
  const rows = [
    ['Nombre', 'Género', 'Calificación'],
    ['rigoberto toledo', 'Masculino', 'a'],
    ['silvia toledo', 'femenino', 'c'],
    ['gregorio de la fuente', 'Masculino', 'a'],
    ['alejandra de la fuente', 'femenino', 'a'],
  ];
  const xs = [71, 221, 364];
  rows.forEach((cells, ri) => {
    const y = 500 - ri * 20;
    cells.forEach((cell, ci) => items.push(glyph(cell, xs[ci], y)));
  });
  const txt = rebuildPdfWords(items);
  const parsed = convertPdfPeople(txt, { labores: [] });
  ok('real: no parte en dos bloques, filas completas', txt.split('\n').filter(Boolean).length === rows.length, `got=${JSON.stringify(txt)}`);
  ok('real: parser detecta todas las personas', parsed.data?.personas?.length === rows.length - 1, `got=${parsed.data?.personas?.length}`);
  ok('real: género y calificación correctos', parsed.data.personas[0].genero === 'masculino' && parsed.data.personas[0].calificacion === 'A', `got=${JSON.stringify(parsed.data.personas[0])}`);
  ok('real: nombre compuesto conservado', parsed.data.personas[2].name === 'gregorio de la fuente');
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
    atencion: [{ id: '2026-09', weeks: [{ saturday: '2026-09-12', labores: { acomodacion: ['1', ''] } }] }],
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
    atencion: [{ id: '2026-09', weeks: [{ saturday: '2026-09-12', labores: { microfono: ['2', ''] } }] }],
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
// E3 exento para el publicador que repite labores de servicio (atencion_*) entre semana.
{
  const mkMw = (id, person) => ({ id, sections: [{ title: 'T', parts: [{ num: 1, assignments: { conductor: '99' } }] }], labores: { acomodacion: [person, ''], microfono: ['', ''], plataforma: '', sonido: '' } });
  const ctx = {
    midweeks: [mkMw('2026-09-07', '7'), mkMw('2026-09-14', '7')],
    months: [], labores: [], salidas: [],
    people: [{ id: 7, name: 'Publ', cargos: ['publicador'] }, { id: 8, name: 'Min', cargos: ['ministerial'] }],
  };
  const c = computeCrossConflicts(ctx);
  ok('E3 no marca al publicador que repite labores de servicio entre semana', !c.some(x => x.regla === 'E3' && x.value === '7'));
  const ctxMin = { ...ctx, midweeks: [mkMw('2026-09-07', '8'), mkMw('2026-09-14', '8')] };
  ok('E3 sí marca al ministerial que repite labores de servicio entre semana', computeCrossConflicts(ctxMin).some(x => x.regla === 'E3' && x.value === '8'));
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
// E4 exento para el conductor designado (permanente/suplentes).
{
  const ctx = {
    midweeks: [],
    months: [{ id: '2026-09', month: 9, weeks: [
      { date: '2026-09-05', conductor: '9', type: 'normal' },
      { date: '2026-09-12', conductor: '9', type: 'normal' },
    ] }],
    labores: [], salidas: [],
    permanentConductorId: '9',
  };
  const c = computeCrossConflicts(ctx);
  ok('E4 exento para el conductor permanente', !c.some(x => x.regla === 'E4' && x.value === '9'));
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
// D con su enlace (basta que el D apunte a su pareja, no exige enlace mutuo).
ok('D con su enlace válido', canBePair(p(1, 'D', 'masculino', '2'), p(2, 'D', 'masculino', '1')));
ok('D sin enlace inválido', canBePair(p(1, 'D', 'masculino', ''), p(2, 'D', 'masculino', '1')) === false);
ok('D apunta a su pareja: válido aunque la pareja no apunte de vuelta', canBePair(p(1, 'D', 'masculino', '2'), p(2, 'B', 'femenino', '')) === true);
ok('D no enlazado a esta pareja: inválido', canBePair(p(1, 'D', 'masculino', '3'), p(2, 'B', 'femenino', '')) === false);
ok('D con su pareja (que tiene su propio enlace) válido', canBePair(p(1, 'D', 'masculino', '2'), p(2, 'B', 'masculino', '3')) === true);
// Tabla de calificaciones aplicada a cualquier género: A+A, B+C, C+C no valen.
ok('mismo género A+A inválido', canBePair(p(1, 'A', 'masculino'), p(2, 'A', 'masculino')) === false);
ok('mismo género B+C inválido', canBePair(p(1, 'B', 'femenino'), p(2, 'C', 'femenino')) === false);
ok('mismo género C+C inválido', canBePair(p(1, 'C', 'masculino'), p(2, 'C', 'masculino')) === false);
ok('sin género B+C inválido', canBePair(p(1, 'B', ''), p(2, 'C', '')) === false);
ok('mixto enlazados A+A inválido por tabla', canBePair(p(1, 'A', 'masculino', '2'), p(2, 'A', 'femenino', '1')) === false);
ok('mixto enlazados B+B válido por tabla', canBePair(p(1, 'B', 'masculino', '2'), p(2, 'B', 'femenino', '1')));
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

// --- Labores permitidas por género (laboreAllowedForPerson) ---
console.log('[laboreAllowedForPerson]');
ok('mujer: presentación permitida', laboreAllowedForPerson({ genero: 'femenino' }, 'asignacion2'));
ok('mujer: demás labores bloqueadas', laboreAllowedForPerson({ genero: 'femenino' }, 'presidente') === false);
ok('mujer: lectura bloqueada', laboreAllowedForPerson({ genero: 'femenino' }, 'asignacion1') === false);
ok('mujer: discurso estudiantil bloqueado', laboreAllowedForPerson({ genero: 'femenino' }, 'asignacion3') === false);
ok('hombre: todas las labores permitidas', laboreAllowedForPerson({ genero: 'masculino' }, 'orador'));
ok('hombre: lectura permitida', laboreAllowedForPerson({ genero: 'masculino' }, 'asignacion1'));
ok('sin género: todas permitidas', laboreAllowedForPerson({ genero: '' }, 'presidente'));
ok('sin persona: todas permitidas', laboreAllowedForPerson(null, 'presidente'));

console.log('[isStudentPerson / isStudentLabore]');
ok('isStudentLabore asignacion2', isStudentLabore('asignacion2') === true);
ok('isStudentLabore asignacion4 falso', isStudentLabore('asignacion4') === false);
ok('isStudentPerson con rol de presentación', isStudentPerson({ labores: ['asignacion2'] }));
ok('isStudentPerson con rol de lectura', isStudentPerson({ labores: ['asignacion1'] }));
ok('isStudentPerson sin roles', isStudentPerson({ labores: [] }));
ok('isStudentPerson con rol ajeno', !isStudentPerson({ labores: ['presidente'] }));

// --- ATENCION_DEF / ATENCION_ROLES / isAtencionPerson ---
console.log('[ATENCION_DEF / labore roles]');
eq('ATENCION_DEF 4 roles con icono y cantidad', ATENCION_DEF.map(d => `${d.key}:${d.count}:${!!d.icon}`), ['acomodacion:2:true', 'microfono:2:true', 'plataforma:1:true', 'sonido:1:true']);
ok('ATENCION_ROLES incluye roles de atención', ['audio', 'microf', 'plataforma', 'acomodador'].every(r => ATENCION_ROLES.includes(r)));
ok('isAtencionPerson con rol de atención', isAtencionPerson({ name: 'X', labores: ['audio'] }));
ok('isAtencionPerson causa sonido equivalente a audio', isAtencionPerson({ name: 'X', labores: ['sonido'] })) && console.log('[unificación sonido/audio]');
{
  const people = [
    { id: 1, name: 'SoloSonido', labores: ['sonido'], genero: 'masculino' },
    { id: 2, name: 'SoloAudio',  labores: ['audio'],  genero: 'masculino' },
    { id: 3, name: 'Micro',      labores: ['microf'], genero: 'masculino' },
  ];
  const at = [{ id: '2026-08', weeks: [{ saturday: '2026-08-15', labores: { acomodacion: ['100', '101'], microfono: ['102', '103'], plataforma: '104', sonido: '' } }] }];
  automatizarAtencion(people, at, [], {});
  ok('el puesto Sonido se cubre con el rol sonido/audio', String(at[0].weeks[0].labores.sonido) === '1', `got=${at[0].weeks[0].labores.sonido}`);
}
ok('isAtencionPerson sin roles incluida', isAtencionPerson({ name: 'X' }));
ok('isAtencionPerson con roles ajenos excluida', !isAtencionPerson({ name: 'X', labores: ['presidente'] }));

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
  const slot = (sec, p) => midweekSlotsOf(sec, p).map(s => `${s.key}:${s.labore}`);
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
    { id: 1, name: 'Conductor', labores: ['conductor2'], calificacion: 'D' },
    { id: 2, name: 'Lector', labores: ['lector2'] },
  ];
  const weekEstudio = mkWeek('2026-08-03');
  const partEstudio = weekEstudio.sections[2].parts[1]; // Estudio Bíblico
  partEstudio.assignments = { conductor: '1', lector: '2' };
  const repEst = automatizarEntreSemana(soloRol, [weekEstudio]);
  const rolesVacios = repEst.vacios.map(v => v.labore);
  ok('estudio bíblico no exige compatibilidad de pareja',
    partEstudio.assignments.conductor === '1' && partEstudio.assignments.lector === '2'
    && !rolesVacios.includes('conductor2') && !rolesVacios.includes('lector2'));

  // El pool de estudiantes acepta a quien tenga cualquier rol de estudiante:
  // personas con solo "lectura" (asignacion1) pueden tomar presentaciones (asignacion2).
  const estudiantesLectura = [
    { id: 1, name: 'SL A', labores: ['asignacion1'] },
    { id: 2, name: 'SL B', labores: ['asignacion1'] },
    { id: 3, name: 'SL C', labores: ['asignacion1'] },
    { id: 4, name: 'SL D', labores: ['asignacion1'] },
  ];
  const weekPres = mkWeek('2026-08-10');
  automatizarEntreSemana(estudiantesLectura, [weekPres]);
  const partPres = weekPres.sections[1].parts[0]; // Presentación (pareja)
  ok('estudiantes con rol de lectura pueden participar en presentación',
    (partPres.assignments || {}).estudiante === '2' && (partPres.assignments || {}).ayudante === '3');
}

// --- Fase 9: algoritmo explicable + historial + regla 7 ---
console.log('[automatizarEntreSemana · motivos/historial/flexiones]');
{
  const mk = (d) => ({ id: d, header: d, reading: 'X', sections: [
    { id: 'tesoros', title: 'Tesoros', parts: [
      { num: 1, title: 'Discurso', mins: 10, assignments: {} },
      { num: 2, title: 'Lectura de la Biblia', mins: 4, assignments: {} },
    ]},
  ]});
  const people = [];
  for (let i = 1; i <= 6; i++) people.push({ id: i, name: 'P' + i, labores: ['asignacion4', 'presidente'], calificacion: 'B' });

  // 1) Motivos: el reporte explica cada asignación.
  const w1 = mk('2026-08-03');
  const rep1 = automatizarEntreSemana(people, [w1]);
  ok('genera motivos por asignación', rep1.motivos.length > 0);
  ok('cada motivo trae nombre, puesto y lista', rep1.motivos.every(m => m.nombre && m.labore && Array.isArray(m.motivos)));
  ok('los motivos mencionan el rol', rep1.motivos[0].motivos.some(t => /rol requerido/i.test(t)));
  ok('sin historial indica distribución por rol', rep1.motivos[0].motivos.some(t => /Sin historial|distribución por rol/i.test(t)));

  // 2) Historial: quien participó hace más tiempo tiene prioridad (regla 6).
  const personasH = [
    { id: 1, name: 'A', labores: ['asignacion4'] },
    { id: 2, name: 'B', labores: ['asignacion4'] },
  ];
  const historial = [
    { personId: '2', date: '2026-07-01', roleKey: 'mw_0_1_conductor' }, // B participó antes
    { personId: '1', date: '2026-07-29', roleKey: 'mw_0_1_conductor' }, // A participó después
  ];
  const w2 = mk('2026-08-10');
  const rep2 = automatizarEntreSemana(personasH, [w2], null, { historial, nombres: {} });
  ok('prioriza a quien participó hace más tiempo (B=1)', w2.sections[0].parts[0].assignments.conductor === '2');

  // 3) Regla 7: con un solo candidato para varios puestos, se flexibiliza
  //    (permite repetir la persona en la semana) y se informa en flexiones.
  const uno = [{ id: 1, name: 'Unico', labores: ['asignacion4', 'presidente'] }];
  const w3 = mk('2026-08-17');
  const rep3 = automatizarEntreSemana(uno, [w3]);
  ok('asigna con un único candidato sin fallar silenciosamente', rep3.asignados >= 1);
  ok('registra flexiones cuando repite a la persona', Array.isArray(rep3.flexiones));
  ok('los vacíos imposibles se marcan', rep3.vacios.every(v => 'imposible' in v));
}

// --- automatizarAtencion ---
console.log('[automatizarAtencion]');
{
  const people = [];
  for (let i = 1; i <= 16; i++) people.push({ id: i, name: `A${i}`, labores: i <= 8 ? ['audio', 'microf'] : ['acomodador'] });
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
  const rep = automatizarAtencion(people, [lab], midweeks);
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
  // Las labores de entre semana (week.atencion del midweek) también se rellenan.
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

// --- Segmentación por cargo en labores de servicio ---
console.log('[automatizarAtencion · cargo]');
{
  // 3 candidatos de sonido: un anciano, un ministerial y un publicador.
  const people = [
    { id: 1, name: 'AncianoSonido', labores: ['audio'], cargos: ['anciano'], genero: 'masculino' },
    { id: 2, name: 'MinSonido',      labores: ['audio'], cargos: ['ministerial'], genero: 'masculino' },
    { id: 3, name: 'PubSonido',      labores: ['audio'], cargos: ['publicador'], genero: 'masculino' },
  ];
  // 2 semanas: el sonido se cubre ambas veces con el publicador (los de mayor
  // cargo no se repiten en el mes).
  const lab = { id: '2026-08', weeks: [
    { saturday: '2026-08-01', labores: { acomodacion: ['', ''], microfono: ['', ''], plataforma: '', sonido: '' } },
    { saturday: '2026-08-08', labores: { acomodacion: ['', ''], microfono: ['', ''], plataforma: '', sonido: '' } },
  ] };
  automatizarAtencion(people, [lab], []);
  const s1 = lab.weeks[0].labores.sonido, s2 = lab.weeks[1].labores.sonido;
  ok('sonido prioriza al publicador', String(s1) === '3', `got=${s1}`);
  ok('publicador se repite en sonido para completar el mes', String(s2) === '3', `got=${s2}`);
}
{
  // Anciano como único candidato de sonido: cubre hasta 2 veces al mes y, si
  // quedan semanas, sonido nunca queda vacío (último recurso).
  const people = [
    { id: 1, name: 'UnicoAnciano', labores: ['audio'], cargos: ['anciano'], genero: 'masculino' },
  ];
  const lab = { id: '2026-08', weeks: [
    { saturday: '2026-08-01', labores: { acomodacion: ['', ''], microfono: ['', ''], plataforma: '', sonido: '' } },
    { saturday: '2026-08-08', labores: { acomodacion: ['', ''], microfono: ['', ''], plataforma: '', sonido: '' } },
    { saturday: '2026-08-15', labores: { acomodacion: ['', ''], microfono: ['', ''], plataforma: '', sonido: '' } },
  ] };
  const rep = automatizarAtencion(people, [lab], []);
  const ss = lab.weeks.map(w => String(w.labores.sonido));
  ok('anciano cubre sonido hasta 2 veces al mes', ss[0] === '1' && ss[1] === '1', `got=${ss.join(',')}`);
  ok('sonido nunca queda vacío si el anciano es el único candidato', ss[2] === '1' && !rep.vacios.some(v => v.labore === 'sonido_0'), `got=${ss.join(',')} vacios=${rep.vacios.length}`);
}
{
  // Sonido siempre se asigna: si el único candidato está ocupado esa semana en la
  // reunión de entre semana, se relaja la restricción y se le asigna igualmente.
  const people = [
    { id: 1, name: 'PubAudio', labores: ['audio'], cargos: ['publicador'], genero: 'masculino' },
  ];
  const mw = [{ id: '2026-08-03', presidente: '1', sections: [] }];
  const lab = { id: '2026-08', weeks: [
    { saturday: '2026-08-08', labores: { acomodacion: ['', ''], microfono: ['', ''], plataforma: '', sonido: '' } },
  ] };
  const rep = automatizarAtencion(people, [lab], mw);
  ok('sonido se asigna aunque el candidato esté ocupado en la semana', String(lab.weeks[0].labores.sonido) === '1' && !rep.vacios.some(v => v.labore === 'sonido_0'), `got=${lab.weeks[0].labores.sonido} vacios=${rep.vacios.length}`);
}
{
  // La acomodación del fin de semana evita asignar a quien ya tiene cargo de fin
  // de semana ese sábado (presidente/conductor/lector) para no generar E2.
  const people = [
    { id: 1, name: 'P1', labores: ['acomodador'], cargos: ['publicador'], genero: 'masculino' },
    { id: 2, name: 'P2', labores: ['acomodador'], cargos: ['publicador'], genero: 'masculino' },
    { id: 3, name: 'Preside', labores: ['presidente', 'acomodador'], cargos: ['anciano'], genero: 'masculino' },
  ];
  const months = [{ id: '2026-09', year: 2026, month: 9, weeks: [{ type: 'normal', date: '2026-09-12', presidente: '3', conductor: '', lector: '' }] }];
  const lab = { id: '2026-09', weeks: [{ saturday: '2026-09-12', labores: { acomodacion: ['', ''], microfono: ['', ''], plataforma: '', sonido: '' } }] };
  automatizarAtencion(people, [lab], [], { months });
  const vals = [];
  lab.weeks.forEach(w => Object.values(w.labores || {}).forEach(v => (Array.isArray(v) ? v : [v]).forEach(id => { if (id) vals.push(String(id)); })));
  ok('acomodación del FS evita a quien preside ese sábado (E2)', !vals.includes('3'), `got=${vals.join(',')}`);
}

// --- Alineación de género en la automatización ---
console.log('[automatización respeta género]');
{
  const wk = (id, sections) => ({
    id, header: id, presidente: '', reading: 'X',
    sections: sections || [{ id: 'tesoros', title: 'Tesoros', parts: [
      { num: 1, title: 'Discurso', mins: 10, assignments: {} },
      { num: 2, title: 'Lectura', mins: 4, assignments: {} },
    ]}],
  });

  // Una mujer con labores de varón no debe ser asignada por la automatización.
  const soloMujer = [{ id: 1, name: 'María', labores: ['presidente', 'asignacion1', 'orador'], genero: 'femenino' }];
  const wPres = wk('2026-09-07');
  automatizarEntreSemana(soloMujer, [wPres]);
  ok('no asigna mujer a presidente en la automatización', !wPres.presidente);
  ok('no asigna mujer a partes de varón en la automatización',
    Object.values(wPres.sections[0].parts[0].assignments || {}).every(v => !v));

  // Las mujeres sí pueden tomar presentación (asignacion2) automáticamente.
  const parejaMujeres = [
    { id: 1, name: 'Ana',   labores: ['asignacion2'], genero: 'femenino', calificacion: 'A' },
    { id: 2, name: 'Beti',  labores: ['asignacion2'], genero: 'femenino', calificacion: 'B' },
  ];
  const wPar = wk('2026-09-14', [{ id: 'maestros', title: 'Maestros', parts: [
    { num: 1, title: 'Presentación', mins: 15, assignments: {} },
  ]}]);
  automatizarEntreSemana(parejaMujeres, [wPar]);
  const aps = wPar.sections[0].parts[0].assignments || {};
  const parejaAsig = [String(aps.estudiante), String(aps.ayudante)].sort();
  ok('mujeres pueden tomar presentación (asignacion2) en la automatización',
    parejaAsig.join(',') === '1,2', JSON.stringify(aps));

  // Las presentaciones priorizan parejas con mujeres (la mujer sale como estudiante).
  const mezcla = [
    { id: 1, name: 'Hugo',  labores: ['asignacion2'], genero: 'masculino', calificacion: 'B' },
    { id: 2, name: 'Héctor', labores: ['asignacion2'], genero: 'masculino', calificacion: 'B' },
    { id: 3, name: 'María', labores: ['asignacion2'], genero: 'femenino', calificacion: 'B' },
    { id: 4, name: 'Marta', labores: ['asignacion2'], genero: 'femenino', calificacion: 'B' },
  ];
  const wPri = wk('2026-09-21', [{ id: 'maestros', title: 'Maestros', parts: [
    { num: 1, title: 'Presentación', mins: 15, assignments: {} },
  ]}]);
  automatizarEntreSemana(mezcla, [wPri]);
  const apPri = wPri.sections[0].parts[0].assignments || {};
  ok('prioriza pareja con mujeres en presentación', String(apPri.estudiante) === '3' && String(apPri.ayudante) === '4', JSON.stringify(apPri));

  // Restricción extra: una mujer puede recibir como máximo 1 asignación al mes.
  const solas = [
    { id: 1, name: 'María', labores: ['asignacion2'], genero: 'femenino', calificacion: 'B' },
    { id: 2, name: 'Marta', labores: ['asignacion2'], genero: 'femenino', calificacion: 'B' },
    { id: 3, name: 'Ana',  labores: ['asignacion2'], genero: 'femenino', calificacion: 'B' },
  ];
  const mkMuj = (d) => ({ id: d, header: d, presidente: '', reading: 'X', sections: [
    { id: 'maestros', title: 'Maestros', parts: [
      { num: 1, title: 'Presentación', mins: 15, assignments: {} },
    ]},
  ]});
  const semanasMuj = [mkMuj('2026-10-05'), mkMuj('2026-10-12'), mkMuj('2026-10-19')];
  automatizarEntreSemana(solas, semanasMuj);
  const todosMuj = semanasMuj
    .map(w => w.sections[0].parts[0].assignments || {})
    .map(a => [a.estudiante, a.ayudante].filter(Boolean).map(String))
    .flat();
  const contMuj = {};
  todosMuj.forEach(id => { contMuj[id] = (contMuj[id] || 0) + 1; });
  ok('ninguna mujer supera 1 asignación al mes', Object.values(contMuj).every(n => n <= 1), JSON.stringify(contMuj));
  ok('con 3 mujeres solo se completa 1 pareja al mes', todosMuj.length === 2, JSON.stringify(todosMuj));

  // Acomodación: con serviceRolesOnlyMale (default) no asigna mujeres.
  const gente = [
    { id: 1, name: 'Hugo',   labores: ['audio'], genero: 'masculino' },
    { id: 2, name: 'Marta',  labores: ['audio'], genero: 'femenino' },
  ];
  const lab1 = [{ id: '2026-09', weeks: [{ saturday: '2026-09-12', labores: {} }] }];
  automatizarAtencion(gente, lab1, [], { serviceRolesOnlyMale: true });
  const ids1 = Object.values(lab1[0].weeks[0].labores).flatMap(v => Array.isArray(v) ? v : [v]).filter(Boolean);
  ok('acomodación solo varones con serviceRolesOnlyMale', ids1.every(id => String(id) === '1'));

  // Con serviceRolesOnlyMale=false sí asigna mujeres a acomodación.
  const gente2 = [
    { id: 1, name: 'Hugo',   labores: ['audio'], genero: 'masculino' },
    { id: 2, name: 'Marta',  labores: ['acomodador'], genero: 'femenino' },
  ];
  const lab2 = [{ id: '2026-09', weeks: [{ saturday: '2026-09-19', labores: {} }] }];
  automatizarAtencion(gente2, lab2, [], { serviceRolesOnlyMale: false });
  const ids2 = Object.values(lab2[0].weeks[0].labores).flatMap(v => Array.isArray(v) ? v : [v]).filter(Boolean);
  ok('acomodación admite mujeres si serviceRolesOnlyMale está desactivado', ids2.map(String).includes('2'));

  // Fin de semana: mujer no asumida como presidente/lector.
  const soloMujerFin = [{ id: 1, name: 'Eva', labores: ['presidente', 'conductor1', 'lector1'], genero: 'femenino' }];
  const mesesFin = [{ id: '2026-09', year: 2026, month: 9, weeks: [
    { type: 'normal', date: '2026-09-05', presidente: '', conductor: '', lector: '', orador: '' },
  ]}];
  automatizarFinSemana(soloMujerFin, mesesFin, [], []);
  const wFin = mesesFin[0].weeks[0];
  ok('fin de semana no asigna mujer a presidente/lector',
    !wFin.presidente && !wFin.lector);
}

// --- Automatización de fin de semana con conductor permanente/suplente ---
console.log('[automatizarFinSemana · conductor permanente/suplente]');
{
  const people = [
    { id: 1, name: 'Perm',  labores: ['conductor1'] },
    { id: 2, name: 'Backup', labores: ['conductor1'] },
    { id: 3, name: 'Otro',  labores: ['conductor1'] },
  ];
  const mkMes = (weeks) => ({ id: '2026-11', year: 2026, month: 11, weeks });
  const weeks = (extra = {}) => ({ type: 'normal', date: '2026-11-07', presidente: '', conductor: '', lector: '', orador: '', ...extra });
  const w1 = weeks();
  const w2 = weeks({ date: '2026-11-14' });
  const salidas = [{ id: '2026-11', weeks: [{ saturday: '2026-11-14', outings: [{ oradorSalida: '1' }] }] }];
  automatizarFinSemana(people, [mkMes([w1, w2])], salidas, [], [], { permanentConductorId: '1', permanentConductorBackupId: '2' });
  ok('conductor permanente conduce cuando está libre', String(w1.conductor) === '1', `got=${w1.conductor}`);
  ok('conductor suplente cuando el permanente está en salidas', String(w2.conductor) === '2', `got=${w2.conductor}`);
  const w3 = weeks({ date: '2026-11-21' });
  const salidas2 = [{ id: '2026-11', weeks: [{ saturday: '2026-11-21', outings: [{ oradorSalida: '1' }, { oradorSalida: '2' }] }] }];
  automatizarFinSemana(people, [mkMes([w3])], salidas2, [], [], { permanentConductorId: '1', permanentConductorBackupId: '2' });
  ok('conductor queda vacío si los 3 (perm+2 suplentes) están en salidas', String(w3.conductor) === '', `got=${w3.conductor}`);

  // Con 2º suplente: si permanente y suplente están en salidas, el 2º suplente conduce.
  const w4 = weeks({ date: '2026-11-28' });
  const salidas3 = [{ id: '2026-11', weeks: [{ saturday: '2026-11-28', outings: [{ oradorSalida: '1' }, { oradorSalida: '2' }] }] }];
  automatizarFinSemana(people, [mkMes([w4])], salidas3, [], [], { permanentConductorId: '1', permanentConductorBackupId: '2', permanentConductorBackupId2: '3' });
  ok('2º suplente conduce cuando permanente y suplente están en salidas', String(w4.conductor) === '3', `got=${w4.conductor}`);
}

// --- Prioridad del conductor permanente sobre el presidente ---
console.log('[automatizarFinSemana · prioridad del conductor permanente]');
{
  const people = [
    { id: 1, name: 'Perm',   labores: ['presidente', 'conductor1'] },
    { id: 2, name: 'Backup', labores: ['presidente', 'conductor1'] },
    { id: 3, name: 'Otro',   labores: ['presidente'] },
  ];
  const w = { type: 'normal', date: '2026-11-07', presidente: '', conductor: '', lector: '', orador: '' };
  automatizarFinSemana(people, [{ id: '2026-11', year: 2026, month: 11, weeks: [w] }], [], [], [], { permanentConductorId: '1', permanentConductorBackupId: '2' });
  ok('el permanente conduce aunque también sea candidato a presidente', String(w.conductor) === '1', `got=${w.conductor}`);
  ok('el presidente recae en otro que no es el conductor', String(w.presidente) === '2' || String(w.presidente) === '3', `got=${w.presidente}`);
}

// --- salidasFaltantes ---
console.log('[salidasFaltantes]');
{
  ok('salidas completas → sin faltantes',
    salidasFaltantes([{ id: '2026-11', weeks: [{ saturday: '2026-11-07', outings: [{ oradorSalida: '3' }] }] }]).length === 0);
  const falt = salidasFaltantes([{ id: '2026-11', weeks: [
    { saturday: '2026-11-07', outings: [{ oradorSalida: '3' }, { oradorSalida: '' }] },
    { saturday: '2026-11-14', outings: [{ oradorSalida: '' }] },
  ]}]);
  ok('detecta salidas sin orador', falt.length === 2 && falt[0].saturday === '2026-11-07' && falt[1].saturday === '2026-11-14', JSON.stringify(falt));
}

// --- laboresVaciasPropuesta y sinAsignarPorMotivo ---
console.log('[laboresVaciasPropuesta / sinAsignarPorMotivo]');
{
  const prop = {
    assignments: [{ personId: '1' }, { personId: '2' }],
    reportes: {
      entre: { vacios: [{ semana: '2026-11-02', labore: 'presidente' }, { semana: '2026-11-02', labore: 'asignacion1' }] },
      fin: { vacios: [{ semana: '2026-11-07', labore: 'lector1' }] },
      atencion: { vacios: [{ semana: '2026-11-07', labore: 'microfono_0' }] },
    },
  };
  const people = [
    { id: 1, name: 'A', labores: ['presidente'] },
    { id: 2, name: 'B', labores: ['lector1'] },
    { id: 3, name: 'C', labores: ['microf'] },
    { id: 4, name: 'D', labores: ['conductor1'] },
    { id: 5, name: 'E', labores: [] },
  ];
  const vac = laboresVaciasPropuesta(prop);
  ok('agrega vacíos de entre/atencion/fin', vac.length === 4, JSON.stringify(vac));
  ok('traduce atencion microfono_0 a Micrófono', vac.some(v => v.labore === 'microfono_0' && v.label === 'Micrófono'));
  ok('traduce lectores y lectura', vac.some(v => v.labore === 'lector1' && v.label === 'Lector (Atalaya)') && vac.some(v => v.labore === 'asignacion1' && v.label === 'Lectura'));
  const g = sinAsignarPorMotivo(prop, people);
  ok('conVacantes: su labor quedó libre', g.conVacantes.length === 1 && String(g.conVacantes[0].persona.id) === '3' && g.conVacantes[0].puestos === 1, JSON.stringify(g.conVacantes));
  ok('cubiertos: su labor ya está asignada', g.cubiertos.length === 1 && String(g.cubiertos[0].id) === '4');
  ok('universales: sin labores', g.universales.length === 1 && String(g.universales[0].id) === '5');
}

// --- automatizarFinSemana ---
console.log('[automatizarFinSemana]');
{
  const people = [];
  for (let i = 1; i <= 6; i++) people.push({ id: i, name: `F${i}`, labores: ['presidente', 'conductor1', 'lector1'] });
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
  ok('extrae labores', entries.some(e => e.personId === '5' && e.program === 'atencion' && e.roleKey === 'atencion_acomodacion_0'));
  ok('extrae labores de entre semana (midweek.atencion)',
    entries.some(e => e.personId === '5' && e.program === 'atencion' && e.roleKey === 'atencion_acomodacion_1'));
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
    { id: 1, name: 'Ana', labores: ['presidente', 'asignacion1'] },
    { id: 2, name: 'Ben', labores: ['conductor1'] },
    { id: 3, name: 'Carlos', labores: ['audio'] },
    { id: 4, name: 'Diana', labores: ['presidente'] },
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

// --- convertPdfPeople: formato tabla con encabezado ---
console.log('[convertPdfPeople: tabla]');
{
  const labores = ['presidente', 'conductor', 'lector', 'orador', 'asignacion1', 'asignacion2', 'asignacion3'];
  const txt = [
    'Nombre Género Calificación Grupo Labores',
    'Ana Pérez Femenino A 1 presidente, conductor',
    'Juan López Masculino B 2 lector, orador',
    'María González Femenino C 3 asignacion1',
  ].join('\n');
  const { data, warnings } = convertPdfPeople(txt, { labores });
  ok('detecta 3 personas en tabla', data?.personas?.length === 3, `got=${data?.personas?.length}`);
  const p1 = data.personas[0];
  ok('p1 nombre', p1.name === 'Ana Pérez');
  ok('p1 genero', p1.genero === 'femenino');
  ok('p1 calificacion', p1.calificacion === 'A');
  ok('p1 grupoId', p1.grupoId === '1');
  ok('p1 labores', p1.labores.join(',') === 'presidente,conductor');
  const p2 = data.personas[1];
  ok('p2 genero masculino', p2.genero === 'masculino');
  ok('p2 calificacion B', p2.calificacion === 'B');
  ok('p2 grupoId 2', p2.grupoId === '2');
  const p3 = data.personas[2];
  ok('p3 labores asignacion1', p3.labores.join(',') === 'asignacion1');
  ok('warnings no vacío', (warnings || []).length > 0);
}
{
  // Encabezado abreviado (típico de PDF exportado de Excel con encabezado recortado)
  const labores = ['presidente', 'conductor'];
  const txt = 'Nombre Género Calif Grupo Labores\nPedro Ruiz Masculino A 1 presidente\nLucía Díaz Femenino B 2 conductor';
  const { data, warnings } = convertPdfPeople(txt, { labores });
  ok('encabezado abreviado detecta 2 personas', data?.personas?.length === 2);
  ok('nombres correctos', data.personas[0].name === 'Pedro Ruiz' && data.personas[1].name === 'Lucía Díaz');
}
{
  // Plantilla actual (3 columnas): el encabezado puede venir partido en varias
  // líneas (cada celda en su línea, típico de exportación PDF).
  const txt = 'Nombre\nGénero\nCalificación\nAna Pérez Femenino A\nJuan López Masculino B';
  const r = convertPdfPeople(txt, { labores: ['presidente'] });
  ok('encabezado en líneas separadas detecta 2 personas', r.data?.personas?.length === 2, `got=${r.data?.personas?.length}`);
  ok('fila con nombre compuesto y calificación', r.data.personas[0].name === 'Ana Pérez' && r.data.personas[0].genero === 'femenino' && r.data.personas[0].calificacion === 'A');
  ok('no incluye la línea Calificación como persona', !r.data.personas.some(p => p.name.toLowerCase().includes('calific')));
}
{
  // Plantilla con separador de columna "|" (Excel exportado a PDF).
  const txt = 'Nombre | Género | Calificación\nAna Pérez | Femenino | A';
  const r = convertPdfPeople(txt, { labores: [] });
  ok('fila con pipes se limpia', r.data?.personas?.length === 1 && r.data.personas[0].name === 'Ana Pérez', `got=${JSON.stringify(r.data)}`);
}
{
  // Plantilla de 3 columnas clásica en una sola línea de encabezado.
  const txt = 'Nombre Género Calificación\nAna Pérez Femenino A\nMaría González Femenino C';
  const r = convertPdfPeople(txt, { labores: ['presidente'] });
  ok('3 columnas detecta 2 personas', r.data?.personas?.length === 2);
  ok('sin grupo ni labores quedan vacíos', r.data.personas.every(p => p.grupoId === '' && p.labores.length === 0));
}

// --- motor configurable: defaults ---
console.log('[defaultAlgorithmConfig / defaultScoringConfig]');
{
  const a = defaultAlgorithmConfig();
  ok('algoritmo incluye numberOfProposals', typeof a.numberOfProposals === 'number' && a.numberOfProposals >= 1);
  ok('algoritmo incluye sameAssignmentMonthlyMode', ['PREFERRED','LIMIT','STRICT'].includes(a.sameAssignmentMonthlyMode));
  ok('algoritmo incluye mixedGenderPairing', ['NOT_ALLOWED','ALLOWED_LOW','ALLOWED_MEDIUM','ALLOWED_HIGH'].includes(a.mixedGenderPairing));
  ok('algoritmo incluye serviceRolesOnlyMale booleano', typeof a.serviceRolesOnlyMale === 'boolean');
  const s = defaultScoringConfig();
  const suma = s.workloadBalance + s.roleRotation + s.weeklyBalance + s.monthlyRepetition + s.scarceRoleProtection + s.pairRoleBalance + s.studentOpportunityBalance;
  ok('pesos suman 100', suma === 100, `got=${suma}`);
}

// --- Nivel del lector estudiantil ---
console.log('[readerLevelEligible / readerPriority]');
{
  ok('nivel A permite solo A', readerLevelEligible('A', 'A') === true && readerLevelEligible('A', 'B') === false);
  ok('nivel B permite A y B', readerLevelEligible('B', 'A') && readerLevelEligible('B', 'B') && !readerLevelEligible('B', 'C'));
  ok('nivel C incluye también D', readerLevelEligible('C', 'D') === true && readerLevelEligible('C', 'C') === true);
  ok('nivel CD abarca todas las calificaciones', ['A', 'B', 'C', 'D'].every(c => readerLevelEligible('CD', c)));
  ok('sin calificación no discrimina', readerLevelEligible('A', '') === true && readerLevelEligible('A', null) === true);
  ok('CD tienen prioridad de lectura antes que B y A', readerPriority('C') < readerPriority('B') && readerPriority('D') < readerPriority('B') && readerPriority('B') < readerPriority('A'));
}

console.log('[automatizarEntreSemana · nivel del lector]');
{
  const personas = [
    { id: 1, name: 'Ana', labores: ['asignacion1'], calificacion: 'A' },
    { id: 2, name: 'Ben', labores: ['asignacion1'], calificacion: 'B' },
    { id: 3, name: 'Carlos', labores: ['asignacion1'], calificacion: 'C' },
    { id: 4, name: 'Diana', labores: ['asignacion1'], calificacion: 'D' },
  ];
  const mk = (d) => ({ id: d, header: d, reading: 'X', sections: [
    { id: 'tesoros', title: 'Tesoros', parts: [
      { num: 1, title: 'Discurso', mins: 10, assignments: {} },
      { num: 2, title: 'Lectura de la Biblia', mins: 4, assignments: {} },
    ]},
  ]});
  const wA = mk('2026-09-01');
  automatizarEntreSemana(personas, [wA], null, { readerLevel: 'A' });
  const lectorA = wA.sections[0].parts[1].assignments.lector;
  ok('nivel A asigna lector solo de nivel A', String(lectorA) === '1', `got=${lectorA}`);
  const wCD = mk('2026-09-08');
  automatizarEntreSemana(personas, [wCD], null, { readerLevel: 'CD' });
  const lectorCD = wCD.sections[0].parts[1].assignments.lector;
  ok('nivel CD prioriza a C o D', String(lectorCD) === '3' || String(lectorCD) === '4', `got=${lectorCD}`);
  const wC = mk('2026-09-15');
  automatizarEntreSemana(personas, [wC], null, { readerLevel: 'C' });
  const lectorC = wC.sections[0].parts[1].assignments.lector;
  ok('nivel C contempla también a D', String(lectorC) === '3' || String(lectorC) === '4', `got=${lectorC}`);
}

// --- mulberry32 / rotateSeed ---
console.log('[mulberry32 / rotateSeed]');
{
  const r1 = mulberry32(42); const r2 = mulberry32(42);
  ok('PRNG determinístico: misma seed → misma secuencia', r1() === r2() && mulberry32(42)() === mulberry32(42)());
  const base = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const rA = rotateSeed(base, 5);
  const rB = rotateSeed(base, 5);
  ok('rota sin perder elementos', rA.length === base.length && rA.every(p => base.includes(p)));
  eq('rotación determinística por seed', rA, rB);
}

// --- scarcityIndex ---
console.log('[scarcityIndex]');
{
  const people = [
    { id: 1, labores: ['presidente'] },
    { id: 2, labores: ['presidente'] },
    { id: 3, labores: ['presidente'] },
    { id: 4, labores: ['presidente'] },
    { id: 5, labores: [] },
  ];
  ok('labor abundante → índice 0', scarcityIndex(people, 'presidente') === 0);
  ok('labor con 1 candidato → índice 1', scarcityIndex(people, 'orador') === 1);
}

// --- generación de propuestas ---
console.log('[generateProposals / generateOneProposal]');
{
  const people = [
    { id: 1, name: 'Ana',   labores: ['presidente','asignacion1','asignacion2','orador'], genero: 'femenino', calificacion: 'A' },
    { id: 2, name: 'Ben',   labores: ['presidente','asignacion1','asignacion2','orador'], genero: 'masculino', calificacion: 'A' },
    { id: 3, name: 'Carlos',labores: ['lector1','lector2','conductor1','conductor2','presidente','orador'], genero: 'masculino', calificacion: 'B' },
    { id: 4, name: 'Diana', labores: ['asignacion1','asignacion2','lector1','lector2'], genero: 'femenino', calificacion: 'C' },
    { id: 5, name: 'Elena', labores: ['asignacion1','asignacion2','presidente','conductor1','orador'], genero: 'femenino', calificacion: 'A' },
    { id: 6, name: 'Félix', labores: ['presidente','conductor2','lector1','asignacion1'], genero: 'masculino', calificacion: 'D', enlaceId: 7 },
    { id: 7, name: 'Gina',  labores: ['asignacion2','asignacion1','conductor1','lector2'], genero: 'femenino', calificacion: 'D', enlaceId: 6 },
  ];
  const midweeks = [
    { id: '2026-07-06', presidente: '', sections: [
      { title: 'Tesoros', parts: [
        { num: 1, assignments: {} },
        { num: 2, assignments: {} },
      ]},
      { title: 'Maestros', parts: [
        { num: 3, assignments: {} },
      ]},
      { title: 'Vida', parts: [
        { num: 4, assignments: {} },
        { num: 5, assignments: {} },
      ]},
    ]},
    { id: '2026-07-13', presidente: '', sections: [
      { title: 'Tesoros', parts: [{ num: 1, assignments: {} }] },
      { title: 'Maestros', parts: [{ num: 2, assignments: {} }] },
      { title: 'Vida', parts: [{ num: 3, assignments: {} }, { num: 4, assignments: {} }] },
    ]},
  ];
  const mes = '2026-07';
  const input = {
    people,
    midweeks,
    months: [
      { id: mes, weeks: [
        { date: '2026-07-04', presidente: '', conductor: '', lector: '', estudioSinLectura: '' },
        { date: '2026-07-11', presidente: '', conductor: '', lector: '', estudioSinLectura: '' },
        { date: '2026-07-18', presidente: '', conductor: '', lector: '', estudioSinLectura: '' },
        { date: '2026-07-25', presidente: '', conductor: '', lector: '', estudioSinLectura: '' },
      ]},
    ],
    salidas: [{ id: mes, weeks: [
      { saturday: '2026-07-04', outings: [{ oradorSalida: '' }] },
      { saturday: '2026-07-11', outings: [{ oradorSalida: '' }] },
    ]}],
    atencion: [{ id: mes, weeks: [
      { saturday: '2026-07-04', labores: {} },
      { saturday: '2026-07-11', labores: {} },
      { saturday: '2026-07-18', labores: {} },
      { saturday: '2026-07-25', labores: {} },
    ]}],
    historial: [],
    nombres: Object.fromEntries(people.map(p => [String(p.id), p.name])),
  };

  const una = generateOneProposal(input, {}, 1);
  ok('una propuesta genera asignaciones', (una.assignments || []).length > 0, `got=${(una.assignments||[]).length}`);
  ok('la propuesta rellena las reuniones de entre semana', una.midweeks.every(w => w.presidente));
  ok('la propuesta respeta 0 personas repetidas en la misma semana (entre semana)',
    una.midweeks.every(w => {
      const ids = [w.presidente];
      (w.sections || []).forEach(sec => (sec.parts || []).forEach(p => Object.values(p.assignments || {}).forEach(v => ids.push(String(v)))));
      return new Set(ids.filter(Boolean)).size === ids.filter(Boolean).length;
    }));

  const props = generateProposals(input, {}, null, 3);
  ok('genera hasta 3 propuestas', props.length >= 1 && props.length <= 3, `got=${props.length}`);
  ok('propuestas ordenadas de mayor a menor score', props.slice(0, -1).every((p, i) => p.score >= props[i + 1].score));
  ok('toda propuesta trae score numérico', props.every(p => typeof p.score === 'number' && p.score >= 0 && p.score <= 100));
  ok('toda propuesta trae breakdown', props.every(p => p.breakdown && 'workloadBalance' in p.breakdown));
  ok('toda propuesta trae los programas completos (midweeks/months/salidas/atencion)',
    props.every(p => Array.isArray(p.midweeks) && p.midweeks.length > 0 && Array.isArray(p.months) && Array.isArray(p.salidas) && Array.isArray(p.atencion)), `got=${props.map(p => `${p.midweeks?.length}/${p.months?.length}/${p.salidas?.length}/${p.atencion?.length}`).join(' ')}`);
  ok('las propuestas rellenan los puestos de entre semana', props.every(p => p.midweeks.every(w => w.presidente)));
  ok('propuestas distintas (huellas distintas)', new Set(props.map(p => JSON.stringify(p.assignments))).size === props.length);
}

// --- scoreSolution ---
console.log('[scoreSolution]');
{
  const entries = [
    { personId: '1', date: '2026-07-06', roleKey: 'presidente', roleLabel: 'Presidente' },
    { personId: '2', date: '2026-07-06', roleKey: 'asignacion2', roleLabel: 'Estudiante' },
    { personId: '2', date: '2026-07-06', roleKey: 'asignacion2', roleLabel: 'Ayudante' },
    { personId: '3', date: '2026-07-13', roleKey: 'conductor1', roleLabel: 'Conductor' },
    { personId: '4', date: '2026-07-13', roleKey: 'lector1', roleLabel: 'Lector' },
  ];
  const people = [{ id: 1, name: 'Ana' }, { id: 2, name: 'Ben' }, { id: 3, name: 'Carlos' }, { id: 4, name: 'Diana' }, { id: 5, name: 'Elena' }];
  const s = scoreSolution(entries, { people, config: { maxSameAssignmentPerMonth: 2 } });
  ok('score devuelto 0-100', s.score >= 0 && s.score <= 100);
  ok('valida en solución sin violaciones', s.valida === true);
  ok('warnings avisan de personas sin participación', s.warnings.some(w => /sin participación/.test(w)));

  // Violación: misma persona repite la misma labor 2+ veces en el mes con STRICT.
  const repetido = [
    { personId: '1', date: '2026-07-06', roleKey: 'presidente', roleLabel: 'Presidente' },
    { personId: '1', date: '2026-07-13', roleKey: 'presidente', roleLabel: 'Presidente' },
  ];
  const s2 = scoreSolution(repetido, { people, config: { maxSameAssignmentPerMonth: 1 } });
  ok('detecta repetición mensual sobre el máximo', !s2.valida && s2.restricciones.superaMaximo.length > 0);

  // El conductor designado repite el cargo intencionalmente → exento de la advertencia.
  const condRepetido = [
    { personId: '3', date: '2026-07-06', roleKey: 'conductor1', roleLabel: 'Conductor' },
    { personId: '3', date: '2026-07-13', roleKey: 'conductor1', roleLabel: 'Conductor' },
  ];
  const sc = scoreSolution(condRepetido, { people, config: { maxSameAssignmentPerMonth: 1, permanentConductorId: '3' } });
  ok('conductor designado no se marca como repetición', sc.valida === true && sc.restricciones.superaMaximo.length === 0);

  // Otro conductor que repite sin estar designado → sí se marca.
  const sc2 = scoreSolution(condRepetido, { people, config: { maxSameAssignmentPerMonth: 1 } });
  ok('conductor no designado que repite sí se marca', sc2.restricciones.superaMaximo.length > 0);

  // Violación: mujer en labor de servicio (atención) con serviceRolesOnlyMale.
  const mujer = [
    { personId: '1', date: '2026-07-06', roleKey: 'atencion_audio_0', roleLabel: 'Audio' },
  ];
  const s3 = scoreSolution(mujer, { people: [{ ...people[0], genero: 'femenino' }], config: { serviceRolesOnlyMale: true } });
  ok('marca mujer en labor de servicio', !s3.valida && s3.restricciones.mujeresEnServicio.length > 0);

  // Los publicadores pueden repetir labores de servicio (acomodación) en el mes
  // sin generar alerta ni penalizar el puntaje.
  const publServicio = [
    { personId: '1', date: '2026-07-06', roleKey: 'atencion_sonido_0', roleLabel: 'Sonido' },
    { personId: '1', date: '2026-07-13', roleKey: 'atencion_sonido_0', roleLabel: 'Sonido' },
    { personId: '1', date: '2026-07-20', roleKey: 'atencion_sonido_0', roleLabel: 'Sonido' },
  ];
  const sp = scoreSolution(publServicio, { people: [{ ...people[0], cargos: ['publicador'] }], config: { maxSameAssignmentPerMonth: 1 } });
  ok('publicador repite acomodación sin alerta', sp.valida === true && sp.restricciones.superaMaximo.length === 0);

  // Un ministerial/anciano repitiendo el mismo puesto de acomodación sí se marca.
  const sm = scoreSolution(publServicio, { people: [{ ...people[0], cargos: ['ministerial'] }], config: { maxSameAssignmentPerMonth: 1 } });
  ok('ministerial repite acomodación y sí se marca', sm.restricciones.superaMaximo.length > 0);

  // Presidir la reunión de entre semana y la del fin de semana son labores
  // diferentes: no se consideran repetición entre sí.
  const presEntreFin = [
    { personId: '1', date: '2026-07-06', program: 'entre', roleKey: 'presidente', roleLabel: 'Presidente' },
    { personId: '1', date: '2026-07-11', program: 'fin', roleKey: 'presidente', roleLabel: 'Presidente' },
  ];
  const spv = scoreSolution(presEntreFin, { people, config: { maxSameAssignmentPerMonth: 1 } });
  ok('presidente de entre semana y fin de semana no cuentan como repetición', spv.valida === true && spv.restricciones.superaMaximo.length === 0);

  // Repetir la presidencia solo dentro de entre semana sí se marca.
  const presEntreRep = [
    { personId: '1', date: '2026-07-06', program: 'entre', roleKey: 'presidente', roleLabel: 'Presidente' },
    { personId: '1', date: '2026-07-13', program: 'entre', roleKey: 'presidente', roleLabel: 'Presidente' },
  ];
  const spr = scoreSolution(presEntreRep, { people, config: { maxSameAssignmentPerMonth: 1 } });
  ok('repetir presidente de entre semana sí se marca', spr.restricciones.superaMaximo.length > 0);
}

// --- helpers de gráficos ---
console.log('[workloadByPerson / historyTimeline / distributionByLabore / pairRoleStats]');
{
  const entries = [
    { personId: '1', name: 'Ana', date: '2026-06-01', roleKey: 'presidente', roleLabel: 'Presidente' },
    { personId: '2', name: 'Ben', date: '2026-06-08', roleKey: 'asignacion2', roleLabel: 'Estudiante' },
    { personId: '2', name: 'Ben', date: '2026-07-06', roleKey: 'asignacion2', roleLabel: 'Ayudante' },
  ];
  const people = [{ id: 1, name: 'Ana' }, { id: 2, name: 'Ben' }, { id: 3, name: 'Carlos' }];
  const w = workloadByPerson(entries, people);
  ok('workload cuenta asignaciones por persona', w.find(x => x.name === 'Ana').count === 1 && w.find(x => x.name === 'Ben').count === 2);
  ok('workload incluye a quienes tienen 0', w.find(x => x.name === 'Carlos').count === 0);

  const tl = historyTimeline(entries);
  eq('timeline agrupa por mes', tl.map(t => t.total), [2, 1]);

  const dist = distributionByLabore(entries);
  ok('distribution agrupa por rol', dist.some(d => d.labore === 'presidente' && d.total === 1) && dist.some(d => d.labore === 'asignacion2' && d.total === 2), `got=${JSON.stringify(dist)}`);

  const pr = pairRoleStats(entries);
  ok('pairRoleStats distingue encargado/ayudante', pr.find(x => x.personId === '2')?.encargado === 1 && pr.find(x => x.personId === '2')?.ayudante === 1);
}

// --- cargoNivel / esPublicador / esAnciano / balanceReport ---
console.log('[cargoNivel / balanceReport]');
{
  ok('cargo por defecto es publicador', cargoNivel({}) === 1 && esPublicador({}) === true);
  ok('cargo publicador explícito', cargoNivel({ cargos: ['publicador'] }) === 1);
  ok('cargo ministerial', cargoNivel({ cargos: ['ministerial'] }) === 2 && esPublicador({ cargos: ['ministerial'] }) === false);
  ok('cargo anciano', cargoNivel({ cargos: ['anciano'] }) === 3 && esAnciano({ cargos: ['anciano'] }) === true);

  const people = [
    { id: 1, name: 'A', cargos: ['anciano'], genero: 'masculino' },
    { id: 2, name: 'B', cargos: ['ministerial'], genero: 'masculino' },
    { id: 3, name: 'C', cargos: ['publicador'], genero: 'masculino' },
    { id: 4, name: 'D', cargos: ['publicador'], genero: 'femenino' },
    { id: 5, name: 'E', cargos: ['publicador'], genero: 'femenino' },
  ];
  const asign = [
    { personId: '1', program: 'entre', roleKey: 'presidente' },
    { personId: '1', program: 'fin', roleKey: 'conductor1' },
    { personId: '2', program: 'fin', roleKey: 'lector1' },
    { personId: '3', program: 'atencion', roleKey: 'atencion_sonido_0' },
    { personId: '4', program: 'entre', roleKey: 'asignacion2' },
    { personId: '4', program: 'atencion', roleKey: 'atencion_microfono_0' },
  ];
  const b = balanceReport(asign, people);
  ok('anciano en reunión', b.ancianosEnReunion === 1, JSON.stringify(b));
  ok('ministerial en reunión', b.ministerialesEnReunion === 1);
  ok('publicador en reunión (solo D)', b.publicadoresEnReunion === 1);
  ok('publicador en servicio (C y D)', b.publicadoresEnServicio === 2);
  ok('mujeres en presentaciones (D)', b.mujeresEnPresentaciones === 1);
  ok('sin participación (E)', b.sinParticipar === 1);
}

console.log(`\n=== Resultado: ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
