// tests.mjs - Tests unitarios de funciones puras de Reunión+
// Ejecutar: node tests.mjs

import {
  MONTHS_ES, WEEK_TYPES, FIELD_ROLE, FIELD_LABELS,
  normalizeStr, searchTalks, saturdaysOf,
  collectWeekPersons, labelOfKey, labelOf,
  computeConflicts, computeOutingConflicts, weekComplete,
  capitalize, capField, escapeHtml, escapeAttr, cryptoId,
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

console.log(`\n=== Resultado: ${pass} PASS, ${fail} FAIL ===\n`);
process.exit(fail > 0 ? 1 : 0);
