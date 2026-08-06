// tests.mjs - Tests unitarios de funciones puras de Reunión+
// Ejecutar: node tests.mjs

import {
  MONTHS_ES, WEEK_TYPES, FIELD_ROLE, FIELD_LABELS,
  normalizeStr, searchTalks, saturdaysOf,
  collectWeekPersons, labelOfKey, labelOf,
  computeConflicts, computeOutingConflicts, weekComplete,
  collectLaboresPersons, collectMidweekPersons, computeMidweekConflicts, dedupPersons,
  capitalize, capField, escapeHtml, escapeAttr, cryptoId,
  isoDate, eventTypeForDate, upcomingEvents, isSpecialDate, DAYS_ES_NAMES, addDays, eventEndDate,
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
ok('semana normal vacía tiene 6 missing', c1.perWeek[0].missing.length === 6, `got=${c1.perWeek[0].missing.length}`);
ok('semana normal vacía genera 6 errors', c1.errors.length === 6);

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

// --- capitalize / capField ---
console.log('[capitalize / capField]');
eq('capitalize', capitalize('hola mundo'), 'Hola mundo');
eq('capitalize vacío', capitalize(''), '');
eq('capField', capField('título'), 'Título');

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
ok('FIELD_ROLE mapea estudioSinLectura a conductor', FIELD_ROLE.estudioSinLectura === 'conductor');
ok('FIELD_ROLE mapea oradorSalida a orador', FIELD_ROLE.oradorSalida === 'orador');

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
ok('dupKeys incluye ambas partes', computeMidweekConflicts(mwkDup).dupKeys.has('mw_0_1_lector'));
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

console.log(`\n=== Resultado: ${pass} PASS, ${fail} FAIL ===\n`);
process.exit(fail > 0 ? 1 : 0);
