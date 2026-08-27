// logic.js - Funciones puras de Reunión+ (sin DOM, testeables en Node)
// Exportadas para que app.js las importe y tests.js las verifique.

export const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// Niveles de calificación de los colaboradores (D = requiere enlace de pareja).
export const CALIFICACIONES = ['A', 'B', 'C', 'D'];

// Configuración por defecto del motor de asignación automática (funciones puras,
// reutilizada por db.js y testeada en tests.mjs).
export function defaultAlgorithmConfig() {
  return {
    maxAssignmentsPerMeeting: 1,
    maxSameAssignmentPerMonth: 1,
    sameAssignmentMonthlyMode: 'PREFERRED', // PREFERRED | LIMIT | STRICT
    mixedGenderPairing: 'ALLOWED_LOW',      // NOT_ALLOWED | ALLOWED_LOW | ALLOWED_MEDIUM | ALLOWED_HIGH
    balancePairRoles: true,
    prioritizeUnassignedThisWeek: true,
    protectScarceRoles: true,
    prioritizeWomenInStudentAssignments: true,
    numberOfProposals: 3,
    permanentConductorId: '',
    permanentConductorBackupId: '',
    permanentConductorBackupId2: '',
    studentReaderLevel: 'CD',
    serviceRolesOnlyMale: true,
  };
}

export function defaultScoringConfig() {
  return {
    workloadBalance: 30,
    roleRotation: 20,
    weeklyBalance: 15,
    monthlyRepetition: 15,
    scarceRoleProtection: 10,
    pairRoleBalance: 5,
    studentOpportunityBalance: 5,
  };
}

export const WEEK_TYPES = {
  normal:       { label: 'Normal',               icon: 'calendar_today' },
  supervisor:   { label: 'Visita Superintendente',icon: 'verified' },
  assembly:     { label: 'Asamblea',              icon: 'event_busy' },
  commemoration:{ label: 'Conmemoración',         icon: 'stars' },
};

// Mapea el nombre interno del campo al rol de la lista de personas.
// Si un campo no está aquí (ej. orador de reunión normal), es texto libre.
export const FIELD_LABORE = {
  presidente:        'presidente',
  conductor:         'conductor1',   // Conductor Atalaya (fin de semana)
  lector:            'lector1',      // Lector Atalaya (fin de semana)
  estudioSinLectura: 'conductor1',
  oradorSalida:      'salida',
};

export const FIELD_LABELS = {
  tituloDiscurso: 'título del discurso',
  presidente: 'presidente',
  orador: 'orador',
  conductor: 'conductor',
  lector: 'lector',
  departamento: 'grupo de atención',
  nombreSupervisor: 'nombre del supervisor',
  discursoSupervisor1: 'discurso público',
  discursoSupervisor2: 'discurso de servicio',
  estudioSinLectura: 'estudio (sin lectura)',
};

export function normalizeStr(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Invierte "Apellido Nombre" -> "Nombre Apellido": la persona está registrada
// con el apellido primero y en los programas se muestra el nombre de pila antes.
// El último token se trata como nombre de pila; el resto, como apellidos.
export function invertName(name) {
  const s = String(name || '').trim();
  const parts = s.split(/\s+/);
  if (parts.length < 2) return s;
  return [parts[parts.length - 1], ...parts.slice(0, -1)].join(' ');
}

// Busca discursos por número o palabra clave.
// `talks` es el array [{num, title}] completo.
export function searchTalks(query, talks, limit = 30) {
  const q = normalizeStr(query).trim();
  if (!q) return (talks || []).slice(0, limit);
  const isNumber = /^\d+$/.test(q);
  const results = [];
  for (const t of (talks || [])) {
    if (isNumber && String(t.num) === q) { results.unshift(t); continue; }
    if (isNumber && String(t.num).startsWith(q)) { results.push(t); continue; }
    if (normalizeStr(t.title).includes(q)) results.push(t);
    if (results.length >= limit * 2) break;
  }
  return results.slice(0, limit);
}

// Extrae el número de discurso de un título tipo "10. El Reino de Dios" (o "10").
export function talkNumFromTitle(str) {
  if (str == null) return null;
  const m = String(str).match(/^\s*(\d+)\s*\./);
  if (m) return Number(m[1]);
  const n = String(str).match(/^\s*(\d+)\s*$/);
  if (n) return Number(n[1]);
  return null;
}

// Cuenta cuántas veces un discurso (por número) se programó en reuniones de
// fin de semana locales (programas mensuales: campo tituloDiscurso de cada semana).
// Devuelve { count, last } donde last es la fecha "YYYY-MM-DD" más reciente.
export function countTalkUsage(months, num) {
  let count = 0;
  let last = null;
  const target = Number(num);
  if (!target) return { count, last };
  for (const m of (months || [])) {
    const weeks = Array.isArray(m?.weeks) ? m.weeks : [];
    for (const w of weeks) {
      const n = talkNumFromTitle(w?.tituloDiscurso);
      if (n === target) {
        count++;
        if (w.date && (last === null || w.date > last)) last = w.date;
      }
    }
  }
  return { count, last };
}

// Sábados de un mes. month: 1-12.
export function saturdaysOf(year, month) {
  const out = [];
  const d = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0).getDate();
  for (let day = 1; day <= last; day++) {
    d.setDate(day);
    if (d.getDay() === 6) out.push(new Date(d));
  }
  return out;
}

// Convierte una fecha JS a "YYYY-MM-DD" local.
export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Tipo de reunión que corresponde a una fecha según la configuración general.
// La configuración lista fechas de conmemoración, visitas de superintendente (rango
// desde/hasta) y asambleas (1 o 3 días). `iso` debe ser "YYYY-MM-DD".
// `events` = { commemorations:[], visits:[], assemblies:[] } (se extienden desde db.defaultConfig).
// `weekDays` = { wkDay, midDay } días de reunión pública y de entre semana (0=dom..6=sáb).
// La conmemoración se marca según la SEMANA que contiene la fecha (no solo la fecha exacta),
// y se suspende la reunión que corresponda: pública si cae fin de semana, de entre semana si cae entre semana.
export function eventTypeForDate(events, iso, weekDays) {
  if (!events) return 'normal';
  const wkDay = (weekDays && weekDays.wkDay != null) ? weekDays.wkDay : 6;
  const midDay = (weekDays && weekDays.midDay != null) ? weekDays.midDay : 2;
  const dowOf = (d) => new Date(d + 'T00:00:00').getDay();
  const inRange = (from, to) => from && to && iso >= from && iso <= to;
  const visitFrom = (v) => v.from || (v.date ? v.date : null);
  const visitTo = (v) => v.to || v.from || (v.date ? v.date : null);
  if ((events.commemorations || []).some(d => {
    if (d === iso) return true;
    const dDow = dowOf(d);
    const satD = addDays(d, (6 - dDow) % 7);
    return iso === satD;
  })) return 'commemoration';
  if ((events.visits || []).some(v => inRange(visitFrom(v), visitTo(v)))) return 'supervisor';
  if ((events.assemblies || []).some(a => {
    if (a.from && a.to) return inRange(a.from, a.to);
    const start = a.from || a.date;
    const days = Number(a.days) || 1;
    return inRange(start, addDays(start, days - 1));
  })) return 'assembly';
  return 'normal';
}

export const DAYS_ES_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Suma días a una fecha "YYYY-MM-DD" y devuelve otra "YYYY-MM-DD".
export function addDays(iso, days) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return isoDate(dt);
}

// Devuelve los `n` meses (ids "YYYY-MM") terminando en `monthId` inclusive,
// en orden descendente (el más reciente primero). Útil para ventanas móviles.
export function lastMonths(monthId, n = 6) {
  const [y, m] = monthId.split('-').map(Number);
  const out = [];
  let yy = y, mm = m;
  for (let i = 0; i < n; i++) {
    out.push(`${yy}-${String(mm).padStart(2, '0')}`);
    mm -= 1;
    if (mm === 0) { mm = 12; yy -= 1; }
  }
  return out;
}

// Regularidad de entrega de informes (ventana de los últimos `n` meses).
// Un participante es IRREGULAR si en al menos uno de los meses evaluados no
// entregó su informe; lo es una sola vez aunque falte en varios meses. La
// unidad de cálculo es siempre el participante único.
//   entregó(mes, pid) = precursorRegular || actividad === true
//   regularidad = (regulares / total) × 100
// `reports` = documentos de actividad [{ id: "YYYY-MM", people: { [pid]: { actividad } } }]
// `months`  = lista de ids "YYYY-MM" a evaluar (p.ej. lastMonths(...)).
export function computeRegularity(people, reports, months) {
  const byMonth = {};
  (reports || []).forEach(r => { byMonth[r.id] = (r && r.people) || {}; });
  const evaluados = (people || []).filter(p => p.activo !== false);
  const irregular = new Set();
  for (const p of evaluados) {
    const pioneer = p.precursorRegular === true;
    let missed = false;
    for (const m of months) {
      const v = byMonth[m] && byMonth[m][p.id];
      const delivered = pioneer || (v && v.actividad === true);
      if (!delivered) { missed = true; break; }
    }
    if (missed) irregular.add(String(p.id));
  }
  const total = evaluados.length;
  const irregularCount = irregular.size;
  const regularCount = total - irregularCount;
  const percentage = total ? Math.round((regularCount / total) * 100) : 0;
  return { total, regular: regularCount, irregular: irregularCount, percentage };
}

/* =============================================================== */
/* FORMATO DE ASIGNACIÓN: { id, src, locked }                       */
/*                                                                  */
/* Una casilla de persona (presidente, conductor, una parte de      */
/* entre semana, un orador de salida, un puesto de atencion...)     */
/* puede guardarse como id simple (datos antiguos) o como objeto:   */
/*   { id: <personId>, src: 'MANUAL'|'AUTO', locked: bool }         */
/*                                                                  */
/* · src = 'MANUAL': la puso el usuario (por defecto locked).       */
/* · src = 'AUTO'  : la puso el generador (regenerable).            */
/* · locked: si está bloqueada, el generador jamás la toca.         */
/*                                                                  */
/* El motor puro trabaja con ids simples; el envoltorio (db/app/    */
/* sync) se encarga de aplicar/leer este formato.                   */
/* =============================================================== */

// Extrae el id de una casilla (id simple u objeto {id}).
export function asId(v) {
  return (v && typeof v === 'object' && 'id' in v) ? v.id : v;
}

// Normaliza una casilla a string de id ('' si está vacía).
export function asStr(v) {
  const id = asId(v);
  return id === null || id === undefined ? '' : String(id);
}

// Envuelve un id simple en el formato de asignación. Si ya es objeto lo
// devuelve tal cual (conserva su src/locked).
export function slotOf(v, src = 'MANUAL', locked = null) {
  if (v && typeof v === 'object' && 'id' in v) return v;
  return { id: v === null || v === undefined ? '' : v, src, locked: locked === null ? src === 'MANUAL' : !!locked };
}

// Aplica el resultado de una edición MANUAL del usuario: si la casilla no
// cambió de persona conserva su origen (AUTO/MANUAL); si cambió (o se asignó
// de nuevo) pasa a MANUAL y queda bloqueada.
export function applyManual(prevVal, newVal) {
  const newId = asStr(newVal);
  if (!newId) return '';
  if (asStr(prevVal) === newId && prevVal && typeof prevVal === 'object' && 'id' in prevVal) return prevVal;
  return { id: asId(newVal), src: 'MANUAL', locked: true };
}

// Aplica el resultado de una generación automática. Las casillas manuales/
// bloqueadas se conservan tal cual; las rellenadas ahora se marcan AUTO.
export function applyAuto(prevVal, newVal) {
  const newId = asStr(newVal);
  if (!newId) return '';
  if (asStr(prevVal) === newId && prevVal && typeof prevVal === 'object' && prevVal.src === 'MANUAL') return prevVal;
  return { id: asId(newVal), src: 'AUTO', locked: false };
}

// ¿Una casilla es manual o está bloqueada? (las que el generador no toca).
// Un id simple se trata como manual (datos antiguos, no perder trabajo).
function esManualOVista(v) {
  if (v === null || v === undefined || v === '') return false;
  if (typeof v !== 'object') return true;
  if (!('id' in v)) return false;
  return v.src === 'MANUAL' || v.locked === true;
}

// --- Visitantes por tipo de programa (devuelven copias) ---
// Cada visitor recibe (claveGlobalUnica, valorActual) y devuelve el nuevo valor
// o undefined para no tocar la casilla.

// Acomodación (objeto labores {key: id | [ids]}) → claves "atencion_<key>_<si>".
function mapAtencionLabores(labores, visitor) {
  const l = labores || {};
  const out = {};
  for (const d of ATENCION_DEF) {
    const v = l[d.key];
    if (v === undefined) { out[d.key] = v; continue; }
    const values = Array.isArray(v) ? v : [v];
    const mapped = values.map((id, si) => {
      const next = visitor(`atencion_${d.key}_${si}`, id);
      return next === undefined ? id : next;
    });
    out[d.key] = Array.isArray(v) ? mapped : (mapped[0] ?? '');
  }
  return out;
}

// Entre semana: presidente + sections[].parts[].assignments + labores.
export function mapMidweekSlots(week, visitor) {
  const w = { ...week, sections: (week.sections || []).map((sec, si) => ({
    ...sec,
    parts: (sec.parts || []).map(p => {
      const ap = { ...(p.assignments || {}) };
      for (const [slot, val] of Object.entries(ap)) {
        const next = visitor(`mw_${si}_${p.num}_${slot}`, val);
        if (next !== undefined) ap[slot] = next;
      }
      return { ...p, assignments: ap };
    }),
  })) };
  const nextPres = visitor('mw_presidente', week.presidente);
  if (nextPres !== undefined) w.presidente = nextPres;
  w.labores = mapAtencionLabores(week.labores || {}, visitor);
  return w;
}

// Fin de semana (months.weeks): campos de persona → "fin_<date>_<campo>".
const FIN_FIELDS = ['presidente', 'conductor', 'lector', 'estudioSinLectura'];
export function mapFinWeekSlots(week, visitor) {
  const w = { ...week };
  for (const f of FIN_FIELDS) {
    if (f in w) {
      const next = visitor(`fin_${w.date}_${f}`, w[f]);
      if (next !== undefined) w[f] = next;
    }
  }
  return w;
}

// Salidas: outings[].oradorSalida → "sal_<saturday>_<oi>".
export function mapSalidasSlots(prog, visitor) {
  return {
    ...prog,
    weeks: (prog.weeks || []).map(w => ({
      ...w,
      outings: (w.outings || []).map((o, oi) => {
        const next = visitor(`sal_${w.saturday}_${oi}`, o.oradorSalida);
        return next !== undefined ? { ...o, oradorSalida: next } : o;
      }),
    })),
  };
}

// Atencion: weeks[].labores → "ate_<saturday>_<key>_<si>".
export function mapAtencionSlots(prog, visitor) {
  return {
    ...prog,
    weeks: (prog.weeks || []).map(w => ({
      ...w,
      labores: mapAtencionLabores(w.labores || {}, (k, v) => visitor(`ate_${w.saturday}_${k}`, v)),
    })),
  };
}

// Claves de las casillas que el generador no debe tocar (manuales/bloqueadas).
export function manualSlotKeys(programs) {
  const keys = new Set();
  const visit = (visitor) => {
    (programs.midweeks || []).forEach(w => mapMidweekSlots(w, (k, v) => { if (esManualOVista(v)) keys.add(k); return undefined; }));
    (programs.months || []).forEach(m => (m.weeks || []).forEach(w => mapFinWeekSlots(w, (k, v) => { if (esManualOVista(v)) keys.add(k); return undefined; })));
    (programs.salidas || []).forEach(s => mapSalidasSlots(s, (k, v) => { if (esManualOVista(v)) keys.add(k); return undefined; }));
    (programs.atencion || []).forEach(a => mapAtencionSlots(a, (k, v) => { if (esManualOVista(v)) keys.add(k); return undefined; }));
    return keys;
  };
  return visit();
}

// Borra SOLO las casillas automáticas (deja las manuales/bloqueadas intactas).
export function clearAutoSlots(programs) {
  return {
    midweeks: (programs.midweeks || []).map(w => mapMidweekSlots(w, (k, v) => (esManualOVista(v) ? v : ''))),
    months: (programs.months || []).map(m => ({ ...m, weeks: (m.weeks || []).map(w => mapFinWeekSlots(w, (k, v) => (esManualOVista(v) ? v : ''))) })),
    salidas: (programs.salidas || []).map(s => mapSalidasSlots(s, (k, v) => (esManualOVista(v) ? v : ''))),
    atencion: (programs.atencion || []).map(a => mapAtencionSlots(a, (k, v) => (esManualOVista(v) ? v : ''))),
  };
}

// Deja todos los valores de persona como ids simples (para pasar al motor puro).
export function unwrapPrograms(programs) {
  return {
    midweeks: (programs.midweeks || []).map(w => mapMidweekSlots(w, (k, v) => asId(v))),
    months: (programs.months || []).map(m => ({ ...m, weeks: (m.weeks || []).map(w => mapFinWeekSlots(w, (k, v) => asId(v))) })),
    salidas: (programs.salidas || []).map(s => mapSalidasSlots(s, (k, v) => asId(v))),
    atencion: (programs.atencion || []).map(a => mapAtencionSlots(a, (k, v) => asId(v))),
  };
}

// Vuelve a envolver los valores tras una generación: manual→MANUAL, resto→AUTO.
export function wrapGeneratedPrograms(programs, manualKeys = new Set()) {
  const wr = (k, v) => {
    const plain = asId(v);
    if (!asStr(plain)) return '';
    return manualKeys.has(k) ? { id: plain, src: 'MANUAL', locked: true } : { id: plain, src: 'AUTO', locked: false };
  };
  return {
    midweeks: (programs.midweeks || []).map(w => mapMidweekSlots(w, (k, v) => wr(k, v))),
    months: (programs.months || []).map(m => ({ ...m, weeks: (m.weeks || []).map(w => mapFinWeekSlots(w, (k, v) => wr(k, v))) })),
    salidas: (programs.salidas || []).map(s => mapSalidasSlots(s, (k, v) => wr(k, v))),
    atencion: (programs.atencion || []).map(a => mapAtencionSlots(a, (k, v) => wr(k, v))),
  };
}

// Envuelve los valores de una semana tras una edición MANUAL: las casillas que
// el usuario cambió quedan MANUAL/bloqueadas; las no tocadas conservan origen.
export function wrapManualPrograms(programs, manualKeys = new Set()) {
  const wr = (k, v) => {
    const plain = asId(v);
    if (!asStr(plain)) return '';
    if (manualKeys.has(k)) return { id: plain, src: 'MANUAL', locked: true };
    if (v && typeof v === 'object' && 'id' in v) return v;
    return { id: plain, src: 'MANUAL', locked: true };
  };
  return {
    midweeks: (programs.midweeks || []).map(w => mapMidweekSlots(w, (k, v) => wr(k, v))),
    months: (programs.months || []).map(m => ({ ...m, weeks: (m.weeks || []).map(w => mapFinWeekSlots(w, (k, v) => wr(k, v))) })),
    salidas: (programs.salidas || []).map(s => mapSalidasSlots(s, (k, v) => wr(k, v))),
    atencion: (programs.atencion || []).map(a => mapAtencionSlots(a, (k, v) => wr(k, v))),
  };
}

// Índice clave→valor (id string) de todos los puestos de los programas.
function collectSlotValues(programs) {
  const map = new Map();
  const set = (k, v) => map.set(k, asStr(v));
  (programs.midweeks || []).forEach(w => mapMidweekSlots(w, (k, v) => { set(k, v); return undefined; }));
  (programs.months || []).forEach(m => (m.weeks || []).forEach(w => mapFinWeekSlots(w, (k, v) => { set(k, v); return undefined; })));
  (programs.salidas || []).forEach(s => mapSalidasSlots(s, (k, v) => { set(k, v); return undefined; }));
  (programs.atencion || []).forEach(a => mapAtencionSlots(a, (k, v) => { set(k, v); return undefined; }));
  return map;
}

// Claves de las casillas cuyo valor cambió entre dos estados (para un guardado
// manual: lo que el usuario tocó se marca MANUAL; lo demás conserva su origen).
export function changedManualKeys(before, after) {
  const b = collectSlotValues(before || {});
  const a = collectSlotValues(after || {});
  const keys = new Set();
  for (const [k, val] of a) {
    const prev = b.get(k) || '';
    if (val && val !== prev) keys.add(k);
  }
  return keys;
}

/* ================================================================== */
/* GENERADOR ÚNICO: ejecuta el motor existente sobre los datos del     */
/* mes (ya envueltos), conservando lo manual/bloqueado y marcando lo   */
/* nuevo como AUTO. Es la puerta única para generar por ámbito o todo. */
/* ================================================================== */

// Ejecuta los motores según `opts.scope` ('entre'|'fin'|'labores'|'all').
// Devuelve { midweeks, months, salidas, atencion, reportes } ya envueltos.
// NOTA: el programa de SALIDAS no se automatiza (siempre se hace a mano); los
// motores solo lo LEEN como contexto (p. ej. para el conductor permanente).
export function runEngine(people, programs, opts = {}) {
  const scope = opts.scope || 'all';
  const manualKeys = manualSlotKeys(programs);
  const p = unwrapPrograms(programs);
  const reportes = {};
  const ctxV2 = {
    restricciones: opts.restricciones || [],
    excepciones: opts.excepciones || [],
    capacidades: opts.capacidades || [],
  };

  if (scope === 'all' || scope === 'entre') {
    reportes.entre = automatizarEntreSemana(people, p.midweeks, opts.ocupadosEntre || null, { ...(opts.entreOpts || {}), ...ctxV2 });
  }
  if (scope === 'all' || scope === 'fin') {
    reportes.fin = automatizarFinSemana(people, p.months, p.salidas, p.atencion, p.midweeks, { ...(opts.finOpts || {}), ...ctxV2 });
  }
  if (scope === 'all' || scope === 'labores') {
    reportes.atencion = automatizarAtencion(people, p.atencion, p.midweeks, { ...(opts.atencionOpts || {}), ...ctxV2 });
  }

  const wrapped = wrapGeneratedPrograms(p, manualKeys);
  return { ...wrapped, reportes };
}

// Último día de un evento (rango desde/hasta, o fecha + días).
export function eventEndDate(ev) {
  if (!ev) return null;
  const from = ev.from || ev.date || null;
  if (ev.to) return ev.to;
  if (from) return addDays(from, (Number(ev.days) || 1) - 1);
  return null;
}

// Devuelve la lista de eventos futuros (incluido hoy) ordenados por fecha.
// Cada item: { type:'commemoration'|'supervisor'|'assembly', date:'YYYY-MM-DD', end:'YYYY-MM-DD'|null }
// Se pueden limitar a `max` próximos.
export function upcomingEvents(events, fromIso, max = 5) {
  if (!events) return [];
  const out = [];
  const push = (date, type, end) => { if (date && date >= fromIso) out.push({ type, date, end: end && end !== date ? end : null }); };
  (events.commemorations || []).forEach(d => push(d, 'commemoration'));
  (events.visits || []).forEach(v => push(v.from || v.date, 'supervisor', eventEndDate(v)));
  (events.assemblies || []).forEach(a => push(a.from || a.date, 'assembly', eventEndDate(a)));
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, max);
}

// ¿Hay un evento programado para la fecha exacta `date`?
export function isSpecialDate(events, date) {
  return eventTypeForDate(events, date) !== 'normal';
}

// Recoge todas las asignaciones de PERSONA (por ID) de una semana:
// atencion de la reunión principal + oradores de salidas. Devuelve
// [{ value: '<id>', key: 'presidente' | 'conductor' | 'lector' | 'estudioSinLectura' | 'salida_0' | ... }]
// 'orador' (texto libre) NO se incluye porque no es un ID de persona.
export function collectWeekPersons(w) {
  const out = [];
  const mainFields = [];
  if (w.type === 'normal') mainFields.push('presidente', 'conductor', 'lector');
  else if (w.type === 'supervisor') mainFields.push('presidente', 'estudioSinLectura');
  else if (w.type === 'commemoration') mainFields.push('presidente');
  for (const f of mainFields) {
    const v = asId(w[f]);
    if (v) out.push({ value: String(v), key: f });
  }
  if (Array.isArray(w.outings) && !w.sinSalida) {
    w.outings.forEach((o, j) => {
      const v = asId(o.oradorSalida);
      if (v) out.push({ value: String(v), key: `salida_${j}` });
    });
  }
  // Labores tras bambalinas: también cuentan para no repetir a una persona
  // dentro de la misma reunión de fin de semana.
  collectAtencionPersons(w.labores).forEach(x => out.push(x));
  return out;
}

// Labores operativas (tras bambalinas) que también cuentan para detectar
// personas duplicadas dentro de una reunión. Fuente única de verdad: el editor
// (app.js) y la validación (aquí) usan esta misma definición.
export const ATENCION_DEF = [
  { key: 'acomodacion', label: 'Acomodación', icon: 'weekend', count: 2 },
  { key: 'microfono',   label: 'Micrófono',   icon: 'mic', count: 2 },
  { key: 'plataforma',  label: 'Plataforma',  icon: 'grid_on', count: 1 },
  { key: 'sonido',      label: 'Sonido',      icon: 'volume_up', count: 1 },
];

// Labores considerados de atención (sostienen la reunión). Filtran quién aparece
// en los selectores de atencion, igual que el resto de filtros por rol.
export const ATENCION_ROLES = [
  'audio', 'sonido', 'microf', 'plataforma', 'acomodador',
];

// Cargos de congregación: todos son publicadores por defecto.
const CARGO_NIVEL = { publicador: 1, ministerial: 2, anciano: 3 };
export function cargoNivel(p) {
  const c = Array.isArray(p && p.cargos) && p.cargos.length ? p.cargos[0] : 'publicador';
  return CARGO_NIVEL[c] || 1;
}
export function esPublicador(p) { return cargoNivel(p) === 1; }
export function esAnciano(p) { return cargoNivel(p) >= 3; }

// ¿La persona puede asignarse a atención? Debe tener marcada alguna labor de
// atención; sin labores no puede usarse en ningún programa.
export function isAtencionPerson(p) {
  return Array.isArray(p?.labores) && p.labores.length > 0 && p.labores.some(r => ATENCION_ROLES.includes(r));
}

// Recolecta las personas asignadas a atencion → [{value, key}].
// key: "atencion_<clave>_<slotIdx>".
export function collectAtencionPersons(atencion) {
  const out = [];
  const l = atencion || {};
  for (const d of ATENCION_DEF) {
    const v = l[d.key];
    const values = Array.isArray(v) ? v : [v];
    for (let si = 0; si < d.count; si++) {
      const id = asId(values[si]);
      if (id) out.push({ value: String(id), key: `atencion_${d.key}_${si}` });
    }
  }
  return out;
}

// Recolecta TODAS las personas de una reunión de entresemana:
// todos los "pads" con asignación en todas las secciones + atencion.
// key: "mw_<si>_<num>_<slot>" (si=sección, num=nº de parte, slot=rol).
export function collectMidweekPersons(week) {
  const out = [];
  const pres = asId(week.presidente);
  if (pres) out.push({ value: String(pres), key: 'mw_presidente' });
  (week.sections || []).forEach((sec, si) => {
    (sec.parts || []).forEach(p => {
      const ap = p.assignments || {};
      Object.entries(ap).forEach(([slot, id]) => {
        const pid = asId(id);
        if (pid) out.push({ value: String(pid), key: `mw_${si}_${p.num}_${slot}`, sectionTitle: sec.title, partNum: p.num, slot });
      });
    });
  });
  collectAtencionPersons(week.labores).forEach(x => out.push(x));
  return out;
}

// A partir de una lista [{value,key}] devuelve {byValue, dupKeys}
// para detectar personas repetidas dentro de la misma reunión.
export function dedupPersons(persons) {
  const byValue = {};
  (persons || []).forEach(item => { (byValue[item.value] ||= []).push(item); });
  const dupKeys = new Set();
  Object.values(byValue).forEach(items => { if (items.length > 1) items.forEach(i => dupKeys.add(i.key)); });
  return { byValue, dupKeys };
}

// Ids de personas ya asignadas en la semana (reunión + salidas + atencion).
// Para entre semana se pasa el colector collectMidweekPersons.
export function assignedIds(week, collector) {
  return new Set((collector || collectWeekPersons)(week).map(x => x.value));
}

// Personas elegibles para un puesto: deben cumplir el rol/predicado y NO estar ya
// asignadas en la misma semana, salvo la que ya ocupa ese puesto (currentId).
// `labore` puede ser un id de labor o una función predicado (p.ej. isAtencionPerson).
export function eligiblePeople(week, people, labore, currentId, collector) {
  const assigned = assignedIds(week, collector);
  const match = typeof labore === 'function'
    ? labore
    : (labore ? (p) => laboreEligible(p, labore) : () => true);
  return people.filter(p => match(p) && (!assigned.has(String(p.id)) || String(p.id) === asStr(currentId)));
}

export function labelOf(f) { return FIELD_LABELS[f] || f; }

// Etiqueta legible de un "key" de asignación (para mensajes de error).
export function labelOfKey(key) {
  if (key.startsWith('salida_')) return `orador de salida ${parseInt(key.slice(7), 10) + 1}`;
  if (key.startsWith('atencion_')) {
    const m = key.match(/^atencion_(\w+)_(\d+)$/);
    if (m) {
      const d = ATENCION_DEF.find(x => x.key === m[1]);
      const label = d ? d.label : m[1];
      const suffix = d && d.count > 1 ? ` ${Number(m[2]) + 1}` : '';
      return `labores de ${label.toLowerCase()}${suffix}`;
    }
  }
  return labelOf(key);
}

// Validación: missing + duplicates (intra-semana, reunión principal + salidas).
export function computeConflicts(month) {
  const perWeek = month.weeks.map(() => ({ duplicates: [], missing: [], outingDuplicates: [] }));
  const errors = [];
  month.weeks.forEach((w, i) => {
    let required = [];
    if (w.type === 'normal') {
      required = ['presidente', 'tituloDiscurso', 'orador', 'conductor', 'lector'];
    } else if (w.type === 'supervisor') {
      required = ['presidente', 'nombreSupervisor', 'discursoSupervisor1', 'estudioSinLectura'];
    } else if (w.type === 'commemoration') {
      required = ['presidente', 'tituloDiscurso', 'orador'];
    }
    required.forEach(f => {
      const v = w[f];
      if (asStr(v) === '') {
        perWeek[i].missing.push(f);
        errors.push(`Semana ${i + 1}: falta ${labelOf(f)}`);
      }
    });
    const pool = collectWeekPersons(w);
    const byValue = {};
    pool.forEach(item => { (byValue[item.value] ||= []).push(item.key); });
    const dupKeys = new Set();
    Object.entries(byValue).forEach(([, keys]) => {
      if (keys.length > 1) keys.forEach(k => dupKeys.add(k));
    });
    if (dupKeys.size) {
      pool.forEach(item => {
        if (dupKeys.has(item.key) && !perWeek[i].duplicates.includes(item.key)) {
          perWeek[i].duplicates.push(item.key);
        }
      });
      dupKeys.forEach(k => {
        if (k.startsWith('salida_')) {
          const j = parseInt(k.slice(7), 10);
          if (!perWeek[i].outingDuplicates.includes(j)) perWeek[i].outingDuplicates.push(j);
        }
      });
      Object.entries(byValue).forEach(([val, keys]) => {
        if (keys.length > 1) {
          const labels = keys.map(labelOfKey);
          errors.push(`Semana ${i + 1}: ${labels.join(' y ')} asignados a la misma persona`);
        }
      });
    }
  });
  return { perWeek, errors };
}

// Duplicados sólo de salidas para una semana concreta.
export function computeOutingConflicts(month, i) {
  const w = month.weeks[i];
  const pool = collectWeekPersons(w);
  const byValue = {};
  pool.forEach(item => { (byValue[item.value] ||= []).push(item.key); });
  const duplicates = [];
  Object.entries(byValue).forEach(([, keys]) => {
    if (keys.length > 1) {
      keys.forEach(k => {
        if (k.startsWith('salida_')) {
          const j = parseInt(k.slice(7), 10);
          if (!duplicates.includes(j)) duplicates.push(j);
        }
      });
    }
  });
  return { duplicates };
}

// Conflictos de una reunión de entresemana: personas repetidas dentro de la
// misma reunión (todos los pads + atencion). Devuelve { dupKeys, errors }.
export function computeMidweekConflicts(week) {
  const persons = collectMidweekPersons(week);
  const { dupKeys } = dedupPersons(persons);
  const labelOf = (item) => {
    if (item && item.key && item.key.startsWith('mw_')) {
      return (item.sectionTitle || 'Sección') + ' · parte ' + item.partNum + ' · ' + FIELD_LABELS[item.slot] || item.slot;
    }
    return labelOfKey(item && item.key);
  };
  const errors = [];
  persons.forEach((item, idx) => {
    if (!dupKeys.has(item.key)) return;
    const partners = persons
      .map((e, j) => ({ e, j }))
      .filter(({ e, j }) => j !== idx && e.value === item.value && e.key !== item.key)
      .map(({ e }) => labelOf(e));
    errors.push(`${labelOf(item)} y ${partners.join(', ')}: misma persona`);
  });
  return { dupKeys, errors };
}

// ¿Tiene conflictos de duplicados la reunión de entresemana?
export function midweekComplete(week) {
  return computeMidweekConflicts(week).errors.length === 0;
}

export function weekComplete(w) {
  const c = computeConflicts({ weeks: [w] }).perWeek[0];
  return c.missing.length === 0 && c.duplicates.length === 0 && c.outingDuplicates.length === 0;
}

export function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

export function escapeAttr(s) {
  return String(s ?? '').replace(/["'<>]/g, c => ({ '"':'&quot;',"'":'&#39;','<':'&lt;','>':'&gt;' }[c]));
}

export function cryptoId() { return 'w_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

// Palabras comunes del español para separar los títulos que el PDF de la JW
// extrae "comprimidos" (las letras vienen separadas y se fusionan).
const SPANISH_WORDS = [
  'abandonar','abraham','aceptar','acerca','acuerdo','además','adón','adoración','adorar','agua','ahora','alabanza',
  'amigos','amistad','amor','ángel','ángeles','antes','antiguo','añadir','año','años','aprender','aprendió','apóstol',
  'apostoles','aprender','aprender','aprobar','arma','asamblea','asistir','aunque','autoridad','ayudar','ayudó','bautismo',
  'beber','belleza','beneficio','bendición','biblia','biblico','biblicos','bien','buena','bueno','buenos','buscar','busquemos','cabezas','cada',
  'cambio','caminar','canción','cantar','casa','causa','cayó','centro','cielo','cielos','ciencia','cinco','ciudad','clave',
  'conversaciones','congregacion','conocer','conocerá','conozco','comenzar','como','compartir','comportamiento','comprensión','con','confiar','confianza',
  'conocer','conseguir','consejo','considerar','consuelo','contra','corazón','correcta','corregir','cosas','creación',
  'creador','crecer','creer','creyó','cristiana','cristianas','cristiano','cristianos','cuando','cuatro','cuidar','cuidado',
  'culpa','cultura','cumplir','cura','curso','dar','damos','de','debemos','deber','decidir','decir','dejar','del','demostrar',
  'derecho','desanimado','descansar','desde','deseo','deseos','después','día','días','diez','diferencia','difícil','dignidad',
  'dios','dirección','discurso','discípulo','discípulos','discipulo','discipulos','dispuesto','distinto','donde','dos','durante','edad','ejemplo',
  'ejercer','el','él','ella','ellas','ellos','empezar','empiece','emplear','en','encontrar','enemigo','enojado','enseñanza',
  'enseñanzas','enseñar','entender','entendimiento','entonces','entre','envidia','es','esclavos','escondidas','escrito',
  'escrituras','escuchar','ese','esfuerzo','eso','espacio','especial','esperanza','espíritu','está','estar','este','estilo',
  'esto','estos','estudio','eterno','evitar','exacta','excelente','excusas','éxito','experiencia','explicar','familia',
  'favor','fe','felicidad','feliz','fin','final','firme','fiel','fieles','formación','forma','fortalecer','frase','frecuencia',
  'fruto','frutos','fue','fuego','futuro','gente','gestión','gracia','gran','grandes','grupo','guerra','gusto','hablar',
  'hacer','haga','hagamos','hambre','hasta','hay','hijos','hogar','hombre','hombres','honestidad','honra','honrar','hora',
  'hoy','ideas','idolatría','igual','importante','imitar','influencia','información','inicio','injusticia','inmenso',
  'instrucción','interesado','invitar','ir','jefe','jehova','jesús','joven','jóvenes','juego','juicio','junto','justicia',
  'justo','juventud','lado','lago','lamentar','le','lectura','leer','lengua','lenguaje','lealtad','ley','libertad','libro',
  'líder','límite','línea','lo','lograr','los','lugar','luna','luz','madurez','madre','maestro','maestros','malo','malos',
  'mandamiento','manera','mano','manos','mar','más','materia','matrimonio','me','medida','mejor','mejores','membresía',
  'memoria','menos','mente','mensaje','mensajero','merece','merecer','meta','mi','miedo','mientras','mil','miles','minutos',
  'mío','mirada','misa','mismo','moción','modo','momento','mundo','mucha','muchas','mucho','muchos','muerte','mujer',
  'mujeres','multiplicación','mundo','mutua','nacimiento','nación','naciones','nada','nadie','natural','necesidad',
  'necesitamos','niño','niños','no','nombre','norte','nos','nosotros','nueva','nuevas','nuevo','nuevos','número','obedecer',
  'obedezcamos','obra','obras','obtener','ocasión','ocho','ocupado','ofrecer','oír','ojos','ola','olvidar','orden','ordenó',
  'oreja','origen','oración','orar','oro','otra','otras','otro','otros','padre','padres','palabra','palabras','pan','para',
  'parecer','parte','pasar','paso','paz','pecado','pelear','peligro','pensar','pensamiento','pequeño','perder','perdón',
  'perdonar','perfecta','perfecto','perlas','permanecer','permitir','pero','persona','personas','pesar','piedad','poder','poderoso',
  'podemos','poner','por','porque','poseer','práctica','precioso','premio','preocupación','preparación','presencia',
  'presentación','presidente','prestar','príncipe','principio','probar','problema','prodigio','profeta','programa',
  'promesa','pronto','propósito','proteger','protección','providencia','prueba','publicación','pueblo','puede','pueden',
  'que','querer','querido','quién','quiere','quieren','realidad','realizar','recibir','recompensa','reconocer','recordar',
  'recuerdo','recurso','redimir','reflexión','reforma','refugio','regla','regresar','reino','relación','relevancia',
  'religión','renovación','reparar','repetir','respeto','respirar','respuesta','revisitas','restaurar','resultado','reunión','revelación',
  'rey','reyes','riqueza','robusto','romper','rosa','sabiduría','sabio','saber','sacar','sacrificio','sagrada','salir',
  'salud','sangre','santo','santos','se','secuencia','seguir','según','seguridad','seis','semanas','sentido','sentimiento',
  'señal','ser','será','servicio','servir','sí','sida','siempre','siete','siglo','significado','siguiente','símbolo','simple',
  'sin','sinceridad','sobre','sociedad','sol','soldado','solo','sólo','solución','sombra','son','sostener','su','subrayar',
  'sucedió','suficiente','sufrimiento','superación','superintendente','surgir','temor','tener','tenga','tengo','tensión',
  'teología','tercero','tesoro','tesoros','tiempo','tierra','tipo','título','toda','todas','todo','todos','tomar','trabajar',
  'trabajo','tranquilidad','tratar','tres','tribulación','tristeza','tu','tú','tus','última','último','un','una','unas',
  'universo','uno','unos','utilizar','valor','varios','venir','ver','verdad','verdadera','verdadero','vestir','vez','viaje',
  'vida','vidas','viejo','vienen','vinieron','virtud','visión','visita','vital','vivir','voluntad','volver','vosotros',
  'voz','vuelve','y','ya','yo',
].sort((a, b) => b.length - a.length);

// Separa las palabras de un texto "comprimido" (sin espacios) usando la lista de
// palabras comunes. Solo separa donde hay una palabra conocida; los tramos sin
// palabra conocida quedan juntos (no empeora el texto).
// P. ej: "jehovamerecequeleobedezcamos" → "jehova merece que le obedezcamos".
export function splitWords(s) {
  const t = String(s || '').trim().toLowerCase().replace(/[ıİ]/g, 'i');
  if (!t) return '';
  const out = [];
  let i = 0;
  while (i < t.length) {
    let w = null;
    for (const cand of SPANISH_WORDS) {
      if (t.startsWith(cand, i)) { w = cand; break; }
    }
    if (w) { out.push(w); i += w.length; continue; }
    // Sin palabra en esta posición: buscar la palabra conocida más larga hacia adelante
    // y dejar el tramo anterior junto.
    let best = null;
    for (let k = i + 1; k <= t.length; k++) {
      for (const cand of SPANISH_WORDS) {
        if (t.startsWith(cand, k) && (!best || cand.length > best.len)) best = { k, len: cand.length };
      }
    }
    if (best) { out.push(t.slice(i, best.k)); i = best.k; }
    else { out.push(t.slice(i)); i = t.length; }
  }
  return out.join(' ');
}

// Pone en mayúscula la primera letra del título (ignorando puntuación inicial).
export function capTitle(s) {
  const t = String(s || '');
  for (let i = 0; i < t.length; i++) {
    if (/[a-záéíóúüñ]/i.test(t[i])) return t.slice(0, i) + t[i].toUpperCase() + t.slice(i + 1);
  }
  return t;
}

/* ---------- Conversión de texto extraído de PDF (carga de archivos) ---------- */
// Los PDF de la JW (Guía de Actividades, lista de discursos, etc.) separan los
// caracteres ("6 -1 2 D E J U L I O"). Estas funciones convierten el texto
// extraído a la estructura de datos de la app.

// Convierte el texto extraído según el tipo. Devuelve { data, warnings }.
export function convertPdfToData(type, text, opts = {}) {
  if (type === 'talks') return convertPdfTalks(text);
  if (type === 'midweeks') return convertPdfMidweeks(text);
  if (type === 'people') return convertPdfPeople(text, opts);
  return { data: null, warnings: ['Tipo desconocido'] };
}

export function convertPdfTalks(text) {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const talks = [];
  const re = /^(?:discurso\s*)?(\d{1,3})\s*[.:-]\s*(.+)$/i;
  for (const ln of lines) {
    const m = ln.match(re);
    if (m) talks.push({ num: Number(m[1]), title: m[2].replace(/[_*\u2022•]/g, '').trim() });
  }
  if (!talks.length) return { data: null, warnings: ['No se detectaron discursos numerados'] };
  return { data: { discursos: talks }, warnings: [] };
}

// Extrae personas desde el texto de un PDF. Soporta dos formatos:
//   1) Tabla con encabezado (plantilla Excel/Word descargable de Reunión+):
//        "Nombre | Género | Calificación | Grupo | Labores"
//        cada fila: "Ana Pérez | Femenino | B | 2 | presidente, conductor"
//      El encabezado puede variar (colunas en otro orden o con otros nombres);
//      se detecta una fila que contenga "nombre" y al menos uno de
//      "género|género|calificación|grupo|labores".
//   2) Roles: líneas con nombre de puesto (presidente, lector, etc.) y debajo
//      los nombres de quienes lo ejercen (formato clásico de participantes.json).
// Devuelve { data, warnings } con data = { personas: [...] } en el caso tabla y
// data = { roles: {...} } en el caso roles (compatible con db.replaceAllPeople).
export function convertPdfPeople(text, opts = {}) {
  const laboresConocidas = Array.isArray(opts.labores) ? opts.labores : [];
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);

  // ---- Formato 1: tabla con encabezado ----
  // El encabezado puede venir en una sola línea ("Nombre Género Calificación") o
  // partido en varias (cada celda en su propia línea). Buscamos la línea con
  // "nombre" y una línea cercana con "género/calificación/grupo/labores"; todo
  // hasta esa línea es el encabezado y el resto son filas de datos.
  const encabezadoRe = /(género|genero|calificaci|grupo|labores|sexo)/i;
  const nombreIdx = lines.findIndex(l => /nombre/i.test(l));
  let headerEndIdx = -1;
  if (nombreIdx !== -1) {
    for (let j = nombreIdx; j < lines.length && j < nombreIdx + 6; j++) {
      if (encabezadoRe.test(lines[j])) { headerEndIdx = j; break; }
    }
  }
  if (headerEndIdx !== -1) {
    const personas = [];
    // Líneas que son solo palabras de encabezado (pueden quedar sueltas si el
    // encabezado se parte en varias líneas).
    const soloEncabezado = /^(nombre|género|genero|calificaci[oó]n|grupo\w*|labores|sexo)s?[|]?$/i;
    for (let i = headerEndIdx + 1; i < lines.length; i++) {
      const ln = lines[i].replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!ln || /^[-–—|=_*·]+$/.test(ln)) continue;
      if (soloEncabezado.test(ln)) continue;
      const p = parsePersonRow(ln, { laboresConocidas });
      if (p && p.name) personas.push(p);
    }
    if (personas.length) {
      return {
        data: { personas },
        warnings: [`Se detectaron ${personas.length} personas en formato tabla. Verifique que los campos (género y calificación) se hayan asignado correctamente.`],
      };
    }
    return { data: null, warnings: ['Se detectó una tabla de personas pero no se reconocieron filas con datos. Revise que cada fila contenga al menos un nombre.'] };
  }

  // ---- Formato 2: roles + nombres ----
  const roles = {};
  let currentRole = null;
  const roleRe = /^(presidente|conductor|lector|orador|atencion|microf\w*|plataforma|audio|video|acomodador|limpieza|seguridad|cronometrador|auxiliar|semanero)s?\s*$/i;
  const nameRe = /^[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+(?:\s+[A-ZÁÉÍÓÚÜÑ]?[a-záéíóúüñ]+){1,5}$/;
  for (const ln of lines) {
    const rm = ln.match(roleRe);
    if (rm) { currentRole = rm[1].toLowerCase(); if (!roles[currentRole]) roles[currentRole] = []; continue; }
    if (currentRole && nameRe.test(ln)) roles[currentRole].push(ln.replace(/[-–•.*]+$/g, '').trim());
  }
  const total = Object.values(roles).reduce((a, r) => a + r.length, 0);
  if (!total) return { data: null, warnings: ['No se detectaron nombres de personas'] };
  return { data: { roles }, warnings: ['Roles detectados: ' + (Object.keys(roles).join(', ') || 'revisar')] };
}

// Parsea una fila de la tabla de personas. Devuelve
// { name, genero, calificacion, grupoId, labores } o null.
// Barrido izquierda-derecha: el nombre es todo hasta el primer campo conocido
// (género, calificación A-D, grupo "N" o "Grupo N"). Lo que queda son labores.
function parsePersonRow(line, { laboresConocidas = [] } = {}) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  let name = '';
  let genero = '';
  let calificacion = '';
  let grupoId = '';
  const labores = [];

  const reG = /^(masculino|femenino|hombre|mujer|varón|varon)$/i;
  const reC = /^[A-D]$/i;
  const reGrupo = /^(?:grupo)?(\d{1,2})$/i;

  // Encontrar el primer índice de campo conocido (género/calificación/grupo).
  // Ese índice marca el fin del nombre.
  let nameEndIdx = tokens.length; // por defecto: todo es nombre
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const lower = t.toLowerCase();
    if (reG.test(t) || reC.test(t) || reGrupo.test(t)) {
      nameEndIdx = i;
      break;
    }
  }

  // Nombre = tokens [0 .. nameEndIdx-1]
  name = tokens.slice(0, nameEndIdx).join(' ');

  // Resto: procesar campos conocidos y labores.
  for (let i = nameEndIdx; i < tokens.length; i++) {
    const t = tokens[i];
    const lower = t.toLowerCase();
    if (reG.test(t) && !genero) { genero = lower === 'femenino' || lower === 'mujer' ? 'femenino' : 'masculino'; continue; }
    if (reC.test(t) && !calificacion) { calificacion = t.toUpperCase(); continue; }
    const gm = t.match(reGrupo);
    if (gm && !grupoId) { grupoId = gm[1]; continue; }
    // Labor: normalizar quitando puntuación final y comparar con laboresConocidas.
    const norm = t.replace(/[,\.;:]+$/, '').toLowerCase();
    if (laboresConocidas.map(l => l.toLowerCase()).includes(norm)) {
      labores.push(t.replace(/[,\.;:]+$/, ''));
      continue;
    }
    // Si no coincide con conocidas pero parece labor (letras/números, sin ser solo números).
    if (/^[a-záéíóúüñ0-9]+$/i.test(t) && !/^\d+$/.test(t) && !reG.test(t) && !reC.test(t)) {
      labores.push(t.replace(/[,\.;:]+$/, ''));
    }
  }

  // Si el nombre quedó vacío (no hubo campos conocidos), usar toda la línea como nombre.
  if (!name) name = tokens.join(' ');

  const uniq = [...new Set(labores.filter(Boolean))];
  return { name, genero, calificacion, grupoId, labores: uniq };
}

// Normaliza una cabecera de columna: minúsculas y sin acentos.
function normalizeHeader(h) {
  return String(h || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// Mapea el cargo de la plantilla a los ids del sistema (publicador/ministerial/anciano).
function cargoIdOf(cargo) {
  const c = normalizeHeader(cargo);
  if (!c) return null;
  if (c.includes('anciano')) return 'anciano';
  if (c.includes('ministerial')) return 'ministerial';
  if (c.includes('publicador')) return 'publicador';
  return null;
}

// Convierte las filas de la plantilla .xlsx (array de arrays) a personas.
// La primera fila son las cabeceras: Nombre, Sexo, Calificación, Cargo, Grupo.
// Devuelve { personas, warnings }.
export function personasFromXlsx(rows) {
  const head = (rows[0] || []).map(normalizeHeader);
  const at = (names) => {
    for (const n of names) {
      const i = head.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const idx = {
    name: at(['nombre', 'name']),
    sexo: at(['sexo', 'genero', 'género']),
    cal: at(['calificacion', 'calificación', 'calif', 'cal']),
    cargo: at(['cargo', 'puesto']),
    grupo: at(['grupo']),
  };
  const clean = (v) => String(v == null ? '' : v).trim();
  const warnings = [];
  const personas = [];
  for (let i = 1; i < (rows || []).length; i++) {
    const r = rows[i] || [];
    const name = clean(r[idx.name]);
    if (!name) continue;
    const p = { name, genero: '', calificacion: '', cargos: [], grupoId: '' };
    const sexo = clean(r[idx.sexo]);
    if (/^fem|mujer|f$/.test(sexo.toLowerCase())) p.genero = 'femenino';
    else if (/^mas|^var|hombre|m$/.test(sexo.toLowerCase())) p.genero = 'masculino';
    const cal = clean(r[idx.cal]).toUpperCase().replace(/[^A-D]/g, '');
    if (/^[A-D]$/.test(cal)) p.calificacion = cal;
    const cargoId = cargoIdOf(clean(r[idx.cargo]));
    if (cargoId) p.cargos = [cargoId];
    const grupo = clean(r[idx.grupo]);
    const gm = /^(\d{1,2})$/.exec(grupo);
    if (gm) p.grupoId = gm[1];
    if (!p.genero) warnings.push(`Fila ${i + 1}: sin sexo válido (${name}).`);
    if (!p.calificacion) warnings.push(`Fila ${i + 1}: sin calificación válida (${name}).`);
    personas.push(p);
  }
  if (!personas.length) warnings.push('No se encontraron filas con nombre en la plantilla.');
  return { personas, warnings };
}

// Reconstruye el texto de una página PDF palabra por palabra a partir de los
// ítems de pdf.js (getTextContent). En lugar de unir caracteres con espacios al
// azar y re-separarlos con diccionario, usa la posición real de cada glifo:
// agrupa por fila (Y) y pone un espacio solo donde hay un hueco horizontal entre
// ítems (lectura "OCR por palabras"). Conserva hasEOL para los saltos de línea.
//
// La Guía de Actividades imprime Tesoros (izquierda) y Seamos Mejores Maestros
// (derecha) en DOS columnas cuyas filas se intercalan verticalmente. Si se emite
// fila a fila tal cual, las partes de ambas secciones se mezclan y el parser no
// las asigna a su sección. Por eso, cuando se detectan dos columnas, se emite
// primero toda la columna izquierda y luego la derecha.
export function rebuildPdfWords(items) {
  const seq = [];
  for (const it of items || []) {
    if (it.str == null || it.str === '') continue;
    // Descartar glifos decorativos (líneas de puntos/secciones del PDF).
    if (/^[\u0002\u0003]+$/.test(String(it.str))) continue;
    const t = it.transform || [1, 0, 0, 1, 0, 0];
    const fs = it.height || Math.abs(t[3]) || 10;
    seq.push({
      str: String(it.str),
      x: t[4] || 0,
      y: t[5] || 0,
      w: it.width || (String(it.str).length * fs * 0.55),
      fs,
      eol: !!it.hasEOL,
    });
  }
  if (!seq.length) return '';

  // Detectar dos columnas mediante agrupación en X (k-means k=2 sobre los
  // glifos de texto real). El hueco entre Tesoros (izquierda) y Seamos Mejores
  // Maestros (derecha) no se detecta como un hueco global porque las líneas
  // decorativas del PDF cruzan todo el ancho; el clustering separa los dos
  // bloques por su posición horizontal media.
  const glifos = seq.filter(i => !/^[\u0002\u0003\s]+$/.test(i.str));
  if (glifos.length >= 50) {
    // Si la página es una tabla con columnas alineadas y estrechas (p. ej. la
    // plantilla de participantes: Nombre | Género | Calificación), NO partir en
    // dos bloques: cada celda es un ítem casi en la misma X que su columna y la
    // fila debe conservarse completa para que el parser de personas la lea.
    if (!isTablePage(glifos)) {
      const col = clusterX(glifos.map(i => i.x));
      // Separación real de columnas: los centros de ambos bloques deben estar muy
      // alejados (>180px). Las páginas de una sola columna (p. ej. Nuestra Vida
      // Cristiana) también producen 2 clusters pero mucho más cercanos (~115px).
      if (col && col.centros[1] - col.centros[0] > 180 && col.ns[0] > glifos.length * 0.2 && col.ns[1] > glifos.length * 0.2) {
        const colMid = (col.centros[0] + col.centros[1]) / 2;
        const izq = seq.filter(i => i.x < colMid);
        const der = seq.filter(i => i.x >= colMid);
        const a = emitPdfLines(izq);
        const b = emitPdfLines(der);
        return a && b ? a + '\n' + b : (a || b);
      }
    }
  }
  return emitPdfLines(seq);
}

// Detecta si una página es una TABLA (celdas alineadas por columna, cada una en
// una X casi fija) frente a texto corrido de dos columnas (la Guía). En la Guía
// el texto fluye: los glifos de cada "columna" se extienden ~100-200px; en una
// tabla las celdas de una columna están en la misma X (dispersión < 40px).
// Prueba k=2..5: si en algún k TODAS las columnas son estrechas y con tamaño
// razonable, la página es una tabla.
function isTablePage(glifos) {
  const xs = glifos.map(i => i.x);
  for (let k = 2; k <= 5; k++) {
    let cs = [...xs].sort((a, b) => a - b);
    const step = Math.max(1, Math.floor(cs.length / k));
    const cent = [];
    for (let i = 0; i < k; i++) cent.push(cs[Math.min(cs.length - 1, i * step)]);
    for (let it = 0; it < 12; it++) {
      const groups = Array.from({ length: k }, () => []);
      for (const x of xs) {
        let bi = 0, bd = Infinity;
        for (let i = 0; i < k; i++) { const d = Math.abs(x - cent[i]); if (d < bd) { bd = d; bi = i; } }
        groups[bi].push(x);
      }
      let moved = 0;
      for (let i = 0; i < k; i++) {
        if (!groups[i].length) continue;
        const m = groups[i].reduce((a, b) => a + b, 0) / groups[i].length;
        if (Math.abs(m - cent[i]) > 0.01) { cent[i] = m; moved++; }
      }
      if (!moved) break;
    }
    const info = cent.map(c => {
      const grp = xs.filter(x => Math.abs(x - c) === Math.min(...cent.map(cc => Math.abs(x - cc))));
      const mn = Math.min(...grp), mx = Math.max(...grp);
      return { n: grp.length, spread: mx - mn };
    });
    const ok = info.every(g => g.spread < 40 && g.n >= xs.length * 0.1);
    if (ok) return true;
  }
  return false;
}

// Separa valores de X en dos grupos (k-means k=2, inicializado en los extremos).
// Devuelve { centros:[c0,c1], ns:[n0,n1] } o null si convergen a un solo grupo.
function clusterX(xs) {
  let c0 = Math.min(...xs);
  let c1 = Math.max(...xs);
  if (c1 - c0 < 50) return null;
  for (let it = 0; it < 12; it++) {
    const g0 = [], g1 = [];
    for (const x of xs) (Math.abs(x - c0) <= Math.abs(x - c1) ? g0 : g1).push(x);
    if (!g0.length || !g1.length) break;
    const m0 = g0.reduce((a, b) => a + b, 0) / g0.length;
    const m1 = g1.reduce((a, b) => a + b, 0) / g1.length;
    if (m0 === c0 && m1 === c1) break;
    c0 = m0; c1 = m1;
  }
  const n0 = xs.filter(x => Math.abs(x - c0) <= Math.abs(x - c1)).length;
  const n1 = xs.length - n0;
  return { centros: [c0, c1], ns: [n0, n1] };
}

// Agrupa los ítems en filas por proximidad vertical y emite una línea por fila
// con espacios donde hay huecos horizontales entre palabras.
function emitPdfLines(seq) {
  seq.sort((a, b) => b.y - a.y || a.x - b.x); // orden de lectura: filas de arriba abajo

  const lines = [];
  let cur = [];
  let lastY = null;
  const tol = (fs) => Math.max(1.5, fs * 0.5);
  for (const it of seq) {
    if (it.eol && cur.length) { lines.push(cur); cur = []; lastY = null; continue; }
    if (lastY !== null && Math.abs(it.y - lastY) > tol(it.fs)) { lines.push(cur); cur = []; }
    cur.push(it);
    lastY = it.y;
  }
  if (cur.length) lines.push(cur);

  const out = [];
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd = null;
    let prevFs = 10;
    for (const it of line) {
      if (prevEnd !== null) {
        const gap = it.x - prevEnd;
        // Un espacio de palabra ≈ 20-25 % de la altura de la fuente.
        if (gap > Math.max(prevFs, it.fs) * 0.2) text += ' ';
      }
      text += it.str;
      prevEnd = it.x + it.w;
      prevFs = it.fs;
    }
    out.push(text.replace(/\s+/g, ' ').trim());
  }
  return out.filter(Boolean).join('\n');
}

// Convierte el texto de la Guía de Actividades en semanas. Detecta la cabecera de
// cada semana (rango + mes), su lectura, las secciones (Tesoros / Mejores Maestros /
// Vida Cristiana) y todas sus partes (número, título y minutos).
//
// Arquitectura: en lugar de un parser línea-a-línea con estado frágil, se hace un
// barrido de anclas en DOS fases:
//  1) Tokenizar: localizar TODAS las anclas con su línea (cabeceras de semana,
//     secciones, partes y canciones) de forma independiente.
//  2) Ensamblar: ordenar las anclas por línea y asignar cada parte/canción a la
//     semana y sección cuya ancla es la más cercana anterior. Así funciona igual
//     con cabeceras cortas ("D-D DE MES"), extendidas ("D DE MES A D DE MES") y
//     semanas que cruzan de página.
export function convertPdfMidweeks(text) {
  const months = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  const clean = (s) => String(s).replace(/[\u0002\u0003]/g, ' ').replace(/\s+/g, ' ').trim();
  const compact = (s) => String(s).replace(/[\s\u0002\u0003´`]/g, '');
  const lines = text.split('\n').map(clean).filter(Boolean);

  // ---- Tokenizar cabeceras de semana ----
  const headerOf = (c) => {
    const re = new RegExp(`^(\\d{1,2})-(\\d{1,2})DE(${months.join('|')})(.*)$`, 'i');
    const m = c.match(re);
    if (m) {
      const mt = months.indexOf(m[3].toUpperCase());
      if (mt < 0) return null;
      const mIni = Number(m[1]);
      const mFin = Number(m[2]);
      // La cabecera indica el mes del lunes (inicio). Si la semana cruza al mes
      // siguiente (mIni > mFin, ej. "28-4 DE SEPTIEMBRE"), se muestra el mes de fin.
      const displayMonth = mIni > mFin ? ((mt + 1) % 12) : mt;
      return { header: `${mIni}-${mFin} DE ${months[displayMonth]}`, mIni, mFin, month: mt + 1, cross: false, rest: m[4] };
    }
    // Formato completo: "28 DE SEPTIEMBRE A 4 DE OCTUBRE" (meses de inicio y fin).
    // La cabecera normalizada usa el mes de fin, igual que "28-4 DE OCTUBRE".
    const re2 = new RegExp(`^(\\d{1,2})DE(${months.join('|')})A(\\d{1,2})DE(${months.join('|')})(.*)$`, 'i');
    const m2 = c.match(re2);
    if (m2) {
      const mtStart = months.indexOf(m2[2].toUpperCase());
      const mtEnd = months.indexOf(m2[4].toUpperCase());
      if (mtStart < 0 || mtEnd < 0) return null;
      return { header: `${m2[1]}-${m2[3]} DE ${months[mtEnd]}`, mIni: Number(m2[1]), mFin: Number(m2[3]), month: mtStart + 1, cross: false, rest: m2[5] };
    }
    return null;
  };

  // Año de la guía: el texto la menciona (p. ej. "... DE 2026"); si no se encuentra
  // se usa el año actual como referencia.
  const yearMatch = compact(text).match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();

  // Da una forma legible a la lectura compacta. Ej: "JEREMIAS13-15" → "JEREMIAS 13-15".
  const tidyReading = (s) => {
    s = String(s || '').replace(/[´`]/g, '');
    s = s.replace(/(\d{1,2})\s*[-–]\s*(\d{1,2})/g, (m, a, b) => `${a}-${b}`);
    s = s.replace(/([A-Za-zÁÉÍÓÚÑáéíóúñ])(\d)/g, '$1 $2');
    return s.replace(/^(\d+)/, '$1 ').trim();
  };

  // ---- Tokenizar secciones ----
  const sectionOf = (c) => {
    const u = String(c || '').toUpperCase();
    if (u !== String(c || '')) return null; // las cabeceras de sección van en mayúsculas
    if (u.includes('TESOROS')) return 'tesoros';
    if (u.includes('MAESTROS')) return 'maestros';
    if (u.includes('NUESTRAVIDA') || (u.includes('VIDA') && u.includes('CRISTIANA'))) return 'vida';
    return null;
  };

  // ---- Fase 1: localizar todas las anclas con su línea ----
  const weekAnchors = [];  // { line, header, mIni, mFin, month, rest }
  const secAnchors = [];   // { line, id }
  const songAnchors = [];  // { line, num }

  lines.forEach((ln, i) => {
    const c = compact(ln);
    const h = headerOf(c);
    if (h) { weekAnchors.push({ line: i, ...h }); return; }
    const sec = sectionOf(c);
    if (sec) { secAnchors.push({ line: i, id: sec }); return; }
    const song = /CANCI\S*?(\d{1,3})/i.exec(c);
    if (song) songAnchors.push({ line: i, num: Number(song[1]) });
  });

  // ---- Tokenizar partes ----
  // Se extrae el bloque de texto de cada sección (entre una cabecera de sección
  // y la siguiente ancla: sección, semana o fin del texto) y se buscan partes
  // dentro de él con un regex que cruza líneas. Así una parte cuyo título y
  // "(N mins.)" están en líneas distintas se captura igual.
  const nextSecOrWeek = [];
  {
    const nextAnchorLine = (line) => {
      let out = lines.length;
      for (const a of secAnchors) if (a.line > line && a.line < out) out = a.line;
      for (const a of weekAnchors) if (a.line > line && a.line < out) out = a.line;
      return out;
    };
    for (const sec of secAnchors) nextSecOrWeek.push(nextAnchorLine(sec.line));
  }

  const partAnchors = []; // { line, num, mins, nat, comp }
  const partRe = /(?:^|\n)\s*(\d{1,2})\s*[.)]\s*(.+?)\s*\(\s*(\d{1,2})\s*(?:mins?|min)\s*\.?\s*\)/gis;

  for (let ai = 0; ai < secAnchors.length; ai++) {
    const sec = secAnchors[ai];
    const block = lines.slice(sec.line, nextSecOrWeek[ai]).join('\n');
    let m;
    partRe.lastIndex = 0;
    while ((m = partRe.exec(block)) !== null) {
      const line = sec.line + block.slice(0, m.index).split('\n').length - 1;
      const natTitle = m[2].replace(/[“”"_*\u2022•´`˙˜]/g, ' ').replace(/\s+/g, ' ').trim();
      partAnchors.push({ line, num: Number(m[1]), mins: Number(m[3]), nat: natTitle, comp: compact(natTitle) });
    }
  }
  partAnchors.sort((a, b) => a.line - b.line);

  // ---- Fase 2: ensamblar semanas ----
  // El lunes es el día de inicio y está en el mes que indica la cabecera.
  const newWeek = (h) => ({
    id: `${year}-${String(h.month).padStart(2, '0')}-${String(h.mIni).padStart(2, '0')}`,
    header: h.header,
    type: 'normal', // normal | supervisor | assembly | commemoration (según evento)
    estado: 'normal', // estado de la reunión: normal | modificada | cancelada | trasladada | reemplazada
    reading: '',
    songIn: 0, songOut: 0,
    introTitle: 'Palabras de introducción', introMins: 1,
    closingTitle: 'Palabras de conclusión', closingMins: 3,
    sections: [
      { id: 'tesoros', title: 'Tesoros de la Biblia', parts: [] },
      { id: 'maestros', title: 'Seamos Mejores Maestros', parts: [] },
      { id: 'vida', title: 'Nuestra Vida Cristiana', parts: [] },
    ],
  });

  // Cabeceras repetidas (el PDF repite la cabecera de cada página): se conserva
  // la primera ocurrencia de cada semana y se descartan las repetidas.
  const seenWeeks = new Set();
  const weeks = [];
  for (const w of weekAnchors) {
    if (seenWeeks.has(w.header)) continue;
    seenWeeks.add(w.header);
    weeks.push(newWeek(w));
  }

  // Índice auxiliar: semana y sección más cercanas antes de una línea.
  const nearest = (anchors, line) => {
    let out = null;
    for (const a of anchors) if (a.line <= line) out = a; else break;
    return out;
  };

  for (const p of partAnchors) {
    const w = nearest(weekAnchors, p.line);
    const s = nearest(secAnchors, p.line);
    if (!w || !s) continue;
    const week = weeks.find(x => x.header === w.header);
    if (!week) continue;
    const sec = week.sections.find(x => x.id === s.id);
    if (!sec) continue;
    // Título: si la parte traía palabras reales (no letras sueltas), se respeta;
    // si era texto "comprimido", se separa con el diccionario.
    const tokens = p.nat.split(/\s+/).filter(Boolean);
    const badSingles = tokens.filter(x => x.length === 1 && !/^[aeiouy]$/i.test(x));
    const title = (badSingles.length === 0 && tokens.some(x => x.length > 1))
      ? capTitle(p.nat)
      : capTitle(splitWords(p.comp.replace(/[“”"_*\u2022•´`˙˜]/g, '').trim()));
    // Si la semana ya tiene ese número en la sección (el PDF repite contenido de
    // una semana en varias páginas, o las partes de la semana siguiente quedan
    // bajo la cabecera de la anterior), se busca la próxima semana que aún no
    // tenga esa parte en esa sección y se le asigna.
    let target = week;
    if (sec.parts.some(x => x.num === p.num)) {
      target = weeks.find(x => {
        const sx = x.sections.find(y => y.id === s.id);
        return sx && !sx.parts.some(y => y.num === p.num);
      });
      if (!target) continue;
    }
    const tSec = target.sections.find(x => x.id === s.id);
    if (!tSec || tSec.parts.some(x => x.num === p.num)) continue;
    tSec.parts.push({ num: p.num, title, mins: p.mins });
  }

  // Lectura y canciones por semana: entre la cabecera de la semana y la de la
  // siguiente, el primer bloque en mayúsculas (o el "rest" de la cabecera) es la
  // lectura, y las canciones se asignan como entrada/salida según su posición.
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const wa = weekAnchors.find(a => a.header === w.header);
    if (!wa) continue;
    const nextLine = i + 1 < weeks.length
      ? weekAnchors.find(a => a.header === weeks[i + 1].header).line
      : lines.length;

    // Lectura: el resto de la cabecera (formato corto) o, si viene separada, las
    // líneas en mayúsculas entre la cabecera y la primera canción/sección.
    let reading = tidyReading(wa.rest || '');
    // Si el "rest" es solo un fragmento (sin capítulos), buscar la lectura
    // completa en las líneas siguientes hasta la primera canción/sección.
    if (!/\d/.test(reading)) {
      let buf = String(wa.rest || '');
      for (let l = wa.line + 1; l < nextLine; l++) {
        const ln = lines[l];
        const c = compact(ln);
        const isSong = /CANCI\S*?(\d{1,3})/i.test(c);
        const isSec = sectionOf(c);
        if (isSec || isSong) break;
        buf += c;
      }
      // La lectura es el prefijo en mayúsculas (libro + capítulos) del bloque.
      const m = /^([A-ZÁÉÍÓÚÑ]{2,}[\s,\-0-9]*)/i.exec(buf);
      if (m && /\d/.test(m[1])) reading = tidyReading(m[1]);
    }
    // Formato extendido ("D DE MES A D DE MES"): la lectura no suele estar entre
    // la cabecera y la primera canción; viene como "running header" de la página
    // (texto en mayúsculas del tipo "LIBRO X, Y") en algún punto de la semana.
    if (!/\d/.test(reading)) {
      for (let l = wa.line; l < nextLine; l++) {
        const c = compact(lines[l] || '');
        const m = /^([A-ZÁÉÍÓÚÑ]{2,}[\s,\-0-9]*)$/i.exec(c);
        if (m && /\d/.test(m[1]) && !/CANCI/.test(m[1])) {
          reading = tidyReading(m[1]);
          break;
        }
      }
    }
    w.reading = reading;

    // Canciones: la primera canción de la semana es la de entrada; la última es
    // la de salida (la que aparece justo antes de la siguiente cabecera).
    const songs = songAnchors.filter(a => a.line > wa.line && a.line < nextLine).map(a => a.num);
    if (songs.length) { w.songIn = songs[0]; w.songOut = songs[songs.length - 1]; }
  }

  if (!weeks.length) return { data: null, warnings: ['No se detectaron semanas (formato "D-D DE MES"). Revise el texto manualmente.'] };
  const warnings = [`Se detectaron ${weeks.length} semanas; revise títulos y compruebe que cada semana tenga sus asignaciones.`];
  // Validación de completitud: cada semana debe traer lectura, canciones y partes.
  for (const w of weeks) {
    const issues = [];
    if (!w.reading) issues.push('lectura');
    if (!w.songIn) issues.push('canción inicial');
    if (!w.songOut) issues.push('canción final');
    for (const sec of w.sections) {
      if (!sec.parts.length) issues.push(sec.id === 'tesoros' ? 'Tesoros' : sec.id === 'maestros' ? 'Seamos Mejores Maestros' : 'Nuestra Vida Cristiana');
    }
    if (issues.length) {
      warnings.push(`La semana ${w.header} quedó incompleta (falta: ${issues.join(', ')}). Revise el texto extraído.`);
    }
  }
  return { data: { weeks }, warnings };
}

// Normaliza las cabeceras de semana de la Guía de Actividades al formato que
// entiende convertPdfMidweeks ("D-D DE MES" o "D DE MES A D DE MES"). El PDF ya
// trae ese formato; el EPUB suele traer "Semana del 28 de septiembre al 4 de
// octubre" y variantes. Las líneas que ya están en formato válido no se tocan.
export function normalizeMidweekHeaders(text) {
  const months = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  const MES = months.join('|');
  const reShort = new RegExp(`^(\\d{1,2})-\\d{1,2}\\s+DE\\s+(${MES})(?:\\s+.+)?$`, 'i');
  const reExt = new RegExp(`^(\\d{1,2})\\s+DE\\s+(${MES})\\s+A\\s+(\\d{1,2})\\s+DE\\s+(${MES})(?:\\s+.+)?$`, 'i');
  const reDelAl = new RegExp(`^(?:SEMANA\\s+)?DEL\\s+(\\d{1,2})\\s+DE\\s+(${MES})(?:\\s+DE\\s+\\d{4})?\\s+AL\\s+(\\d{1,2})\\s+DE\\s+(${MES})(?:\\s+DE\\s+\\d{4})?(?:\\s+.+)?$`, 'i');
  const reDelA = new RegExp(`^(?:SEMANA\\s+)?DEL\\s+(\\d{1,2})\\s+DE\\s+(${MES})(?:\\s+DE\\s+\\d{4})?\\s+A\\s+(\\d{1,2})\\s+DE\\s+(${MES})(?:\\s+DE\\s+\\d{4})?(?:\\s+.+)?$`, 'i');
  const reDelAlShort = new RegExp(`^(?:SEMANA\\s+)?DEL\\s+(\\d{1,2})\\s+(?:A|AL)\\s+(\\d{1,2})\\s+DE\\s+(${MES})(?:\\s+.+)?$`, 'i');
  const reDelSingle = new RegExp(`^(?:SEMANA\\s+)?DEL\\s+(\\d{1,2})\\s+DE\\s+(${MES})(?:\\s+DE\\s+\\d{4})?(?:\\s+.+)?$`, 'i');
  const reSemanaShort = new RegExp(`^SEMANA\\s+(\\d{1,2})[-–—](\\d{1,2})\\s+DE\\s+(${MES})(?:\\s+.+)?$`, 'i');
  const reSemanaExt = new RegExp(`^SEMANA\\s+(\\d{1,2})\\s+DE\\s+(${MES})\\s+A\\s+(\\d{1,2})\\s+DE\\s+(${MES})(?:\\s+.+)?$`, 'i');
  const out = [];
  for (const raw of String(text).split('\n')) {
    const c = String(raw).replace(/\s+/g, ' ').trim();
    if (!c) { out.push(raw); continue; }
    const u = c.toUpperCase().replace(/[´`]/g, '');
    if (reShort.test(u) || reExt.test(u)) { out.push(c); continue; }
    let m = reDelAl.exec(u);
    if (m) { const [, d1, mes1, d2, mes2] = m; out.push(mes1 === mes2 ? `${d1}-${d2} DE ${mes1}` : `${d1} DE ${mes1} A ${d2} DE ${mes2}`); continue; }
    m = reDelA.exec(u);
    if (m) { const [, d1, mes1, d2, mes2] = m; out.push(mes1 === mes2 ? `${d1}-${d2} DE ${mes1}` : `${d1} DE ${mes1} A ${d2} DE ${mes2}`); continue; }
    m = reDelAlShort.exec(u);
    if (m) { out.push(`${m[1]}-${m[2]} DE ${m[3]}`); continue; }
    m = reDelSingle.exec(u);
    if (m) { out.push(`${m[1]}-${m[1]} DE ${m[2]}`); continue; }
    m = reSemanaShort.exec(u);
    if (m) { out.push(`${m[1]}-${m[2]} DE ${m[3]}`); continue; }
    m = reSemanaExt.exec(u);
    if (m) { const [, d1, mes1, d2, mes2] = m; out.push(mes1 === mes2 ? `${d1}-${d2} DE ${mes1}` : `${d1} DE ${mes1} A ${d2} DE ${mes2}`); continue; }
    out.push(c);
  }
  return out.join('\n');
}

// ¿El texto contiene los títulos de las tres secciones de la Guía de Actividades?
function guideSectionsInText(text) {
  const c = String(text || '').replace(/[\s\u0002\u0003´`]/g, '').toUpperCase();
  return c.includes('TESOROS') &&
    c.includes('MAESTROS') &&
    (c.includes('NUESTRAVIDACRISTIANA') || (c.includes('VIDA') && c.includes('CRISTIANA')));
}

// Resumen de la Guía de Actividades detectada: meses, año y nº de semanas.
// Devuelve null si el texto no se reconoce como guía. Se considera guía válida
// si se detectan semanas con formato "D-D DE MES" o si contiene los títulos de
// las tres secciones (Tesoros de la Biblia, Seamos Mejores Maestros y Nuestra
// Vida Cristiana), aunque no se hayan podido extraer las semanas.
export function midweekGuideSummary(text) {
  const { data, warnings } = convertPdfMidweeks(text);
  if (data && data.weeks && data.weeks.length) {
    const monthsSet = new Set();
    let year = null;
    for (const w of data.weeks) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(w.id || ''))) continue;
      monthsSet.add(Number(w.id.slice(5, 7)));
      if (year == null) year = Number(w.id.slice(0, 4));
    }
    if (monthsSet.size) {
      return {
        months: [...monthsSet].sort((a, b) => a - b).map(m => MONTHS_ES[m - 1]),
        year,
        weeksCount: data.weeks.length,
        weeks: data.weeks,
        warnings,
      };
    }
  }
  // Válido por títulos aunque no se hayan detectado cabeceras de semana.
  if (guideSectionsInText(text)) {
    const yearMatch = String(text).replace(/[\s\u0002\u0003´`]/g, '').match(/\b(20\d{2})\b/);
    return {
      months: [],
      year: yearMatch ? Number(yearMatch[1]) : new Date().getFullYear(),
      weeksCount: 0,
      weeks: [],
      warnings: (warnings || []).concat('Se reconocieron los títulos de la guía, pero no se detectaron semanas con formato "D-D DE MES".'),
    };
  }
  return null;
}

/* ---------- Conflictos cruzados entre programas (contexto global) ---------- */
// Cada semana de la organización cierra en domingo. La reunión de entre semana
// (lunes) y la de fin de semana/acomodación/salidas (sábado) comparten domingo.
export function weekSundayOf(iso) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 6);
  return isoDate(d);
}

// Recolecta todas las asignaciones de persona de todos los programas.
// context = { midweeks, months, atencion, salidas }
// Cada item: { value (id persona), mes "YYYY-MM", semana (domingo), programa, rol, detalle }
export function collectPersonAssignments(context) {
  const out = [];
  const add = (id, mes, semana, programa, rol, detalle) => {
    if (id == null || id === '') return;
    out.push({ value: String(id), mes, semana, programa, rol, detalle });
  };

  // Entre semana
  (context.midweeks || []).forEach(mw => {
    const mes = String(mw.id || '').slice(0, 7);
    const semana = weekSundayOf(mw.id);
    const header = mw.header || mw.id || '';
    add(asId(mw.presidente), mes, semana, 'entre', 'presidente', `Presidente · ${header}`);
    (mw.sections || []).forEach((sec, si) => (sec.parts || []).forEach(p => {
      Object.entries(p.assignments || {}).forEach(([slot, id]) => {
        const pid = asId(id);
        if (!pid) return;
        add(pid, mes, semana, 'entre', `parte${si}.${p.num}.${slot}`, `${sec.title} · parte ${p.num} (${slot}) · ${header}`);
      });
    }));
    const l = (mw.labores || {});
    ATENCION_DEF.forEach(d => {
      const arr = Array.isArray(l[d.key]) ? l[d.key] : [l[d.key] || ''];
      arr.forEach((id, si) => { const pid = asId(id); if (pid) add(pid, mes, semana, 'entre', `atencion_${d.key}_${si}`, `${d.label} ${si + 1} (entre semana) · ${header}`); });
    });
  });

  // Fin de semana (programa mensual)
  (context.months || []).forEach(m => (m.weeks || []).forEach(w => {
    if (!/^\d{4}-\d{2}$/.test(String(m.id || ''))) return;
    const mes = m.id;
    const semana = weekSundayOf(w.date);
    const mesTxt = MONTHS_ES[Number(m.month) - 1] || mes;
    ['presidente', 'conductor', 'lector'].forEach(f => {
      const v = asId(w[f]);
      if (v) add(v, mes, semana, 'fin', f, `${labelOf(f)} · ${mesTxt}`);
    });
  }));

  // Acomodación (atencion del fin de semana)
  const atencion = (context.atencion || context.labores || []);
  atencion.forEach(p => (p.weeks || []).forEach(w => {
    const l = (w.labores || {});
    ATENCION_DEF.forEach(d => {
      const arr = Array.isArray(l[d.key]) ? l[d.key] : [l[d.key] || ''];
      arr.forEach((id, si) => { const pid = asId(id); if (pid) add(pid, p.id, weekSundayOf(w.saturday), 'acomodacion', `${d.key}_${si}`, `${d.label} ${si + 1} (fin de semana)`); });
    });
  }));

  // Salidas
  (context.salidas || []).forEach(p => (p.weeks || []).forEach((w, wi) => {
    if (w.sinSalida) return;
    (w.outings || []).forEach((o, oi) => {
      const v = asId(o.oradorSalida);
      if (v) add(v, p.id, weekSundayOf(w.saturday), 'salida', `salida_${wi}_${oi}`, `Orador de salida · semana ${wi + 1}`);
    });
  }));

  return out;
}

// Detecta conflictos cruzados entre programas según las reglas:
//  E1: misma semana, entre semana + acomodación (más de una entre ambos).
//  E2: misma semana, fin de semana + acomodación + salidas (más de una).
//  E3: mismo mes, entre semana, misma asignación repetida (mismo rol en 2 semanas).
//  E4: mismo mes, fin de semana, misma asignación repetida (mismo campo en 2 semanas).
//  E5: mismo mes, salidas, más de una salida.
// Devuelve [{ value, semana, mes, programa, otros: [detalle...], detalle, regla }]
export function computeCrossConflicts(context) {
  const a = collectPersonAssignments(context);
  const conflicts = [];
  const grupo = {};
  a.forEach(x => {
    const kSem = `${x.value}|${x.semana}`;
    (grupo[kSem] ||= []).push(x);
    const kMes = `${x.value}|${x.mes}|${x.programa}|${x.rol}`;
    (grupo[kMes] ||= []).push(x);
    const kSal = `${x.value}|${x.mes}`;
    (grupo[kSal] ||= []).push(x);
  });

  const push = (x, regla, otros) => {
    conflicts.push({ value: x.value, semana: x.semana, mes: x.mes, programa: x.programa, detalle: x.detalle, regla, otros });
  };

  Object.values(grupo).forEach(items => {
    if (items.length < 2) return;
    const [first] = items;
    const key0 = items[0].value + '|' + items[0].semana;
    const key1 = items[0].value + '|' + items[0].mes + '|' + items[0].programa + '|' + items[0].rol;
    const key2 = items[0].value + '|' + items[0].mes;

    // E1: misma semana, entre + acomodación
    if (items.every(i => i.value + '|' + i.semana === key0)) {
      const progs = items.map(i => i.programa);
      if (progs.includes('entre') && progs.includes('acomodacion')) {
        const entre = items.find(i => i.programa === 'entre');
        const aco = items.find(i => i.programa === 'acomodacion');
        push(entre, 'E1', [aco.detalle]);
        return;
      }
      const fin = progs.includes('fin'), acoP = progs.includes('acomodacion'), sal = progs.includes('salida');
      if ([fin, acoP, sal].filter(Boolean).length > 1) {
        const others = items.filter(i => i.programa !== 'fin' || progs.indexOf('fin') > -1);
        push(items.find(i => i.programa !== 'fin') || first, 'E2', items.filter(i => i !== (items.find(i => i.programa !== 'fin') || first)).map(i => i.detalle));
        return;
      }
    }
    // E3: mismo mes, entre, mismo rol (2 semanas distintas)
    if (items.every(i => i.value + '|' + i.mes + '|' + i.programa + '|' + i.rol === key1) && items[0].programa === 'entre') {
      // Los publicadores pueden repetir labores de servicio (atencion_*) de entre
      // semana durante el mes → no se avisa; ministerial/anciano sí se marca.
      const persona = (context.people || []).find(q => String(q.id) === String(items[0].value));
      const esServicio = String(items[0].rol).startsWith('atencion_');
      if (!(persona && esPublicador(persona) && esServicio)) {
        push(first, 'E3', items.slice(1).map(i => i.detalle));
      }
      return;
    }
    // E4: mismo mes, fin, mismo campo (2 semanas distintas)
    if (items.every(i => i.value + '|' + i.mes + '|' + i.programa + '|' + i.rol === key1) && items[0].programa === 'fin') {
      // Excepción: el conductor designado (permanente/suplentes) repite el cargo
      // de fin de semana de forma intencional → no se considera conflicto.
      const conductores = [context.permanentConductorId, context.permanentConductorBackupId, context.permanentConductorBackupId2].filter(Boolean).map(String);
      if (!(items[0].rol === 'conductor' && conductores.includes(items[0].value))) {
        push(first, 'E4', items.slice(1).map(i => i.detalle));
      }
      return;
    }
    // E5: mismo mes, salidas, más de una
    if (items.every(i => i.value + '|' + i.mes === key2) && items[0].programa === 'salida' && items.every(i => i.programa === 'salida') && items.length > 1) {
      push(first, 'E5', items.slice(1).map(i => i.detalle));
      return;
    }
  });

  // Evitar duplicados exactos
  const seen = new Set();
  return conflicts.filter(c => {
    const k = `${c.value}|${c.semana}|${c.mes}|${c.programa}|${c.rol}|${c.regla}|${(c.otros || []).join('|')}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ---------- Compatibilidad de parejas (calificación + género + enlace) ---------- */
// Pares de calificación válidos fuera del enlace D.
const PAR_LIMIT = [['A', 'B'], ['B', 'B'], ['A', 'C']];

// ¿dos colaboradores pueden ser pareja en una asignación de a 2?
// persona1/persona2: { id, calificacion, genero, enlace }
// Reglas:
// · D solo puede pareja con su enlace designado (unidireccional: basta que el
//    D apunte a su pareja, la pareja no tiene por qué apuntar de vuelta).
// · Mixto (hombre+mujer): solo si están enlazados entre sí.
// · Tabla de calificaciones A+B · B+B · A+C (aplica a cualquier género).
//    Quedan fuera: A+A, B+C, C+C y cualquier combinación con D sin enlace.
export function canBePair(persona1, persona2) {
  if (!persona1 || !persona2) return false;
  if (String(persona1.id) === String(persona2.id)) return false;

  const cal = (p) => CALIFICACIONES.includes(p.calificacion) ? p.calificacion : '';
  const c1 = cal(persona1), c2 = cal(persona2);

  // Enlace único de D: solo con su pareja enlazada (unidireccional).
  if (c1 === 'D' || c2 === 'D') {
    if (c1 === 'D') return String(persona1.enlace || '') === String(persona2.id);
    return String(persona2.enlace || '') === String(persona1.id);
  }

  const g1 = persona1.genero, g2 = persona2.genero;
  // Pareja mixta (hombre+mujer): solo si están enlazados entre sí.
  if (g1 && g2 && g1 !== g2) {
    const enlazados = String(persona1.enlace || '') === String(persona2.id) && String(persona2.enlace || '') === String(persona1.id);
    if (!enlazados) return false;
  }
  // Sin calificación registrada: no se puede juzgar la tabla, se permite.
  if (!c1 || !c2) return true;
  // Tabla de calificaciones permitidas: A+B · B+B · A+C (aplica a cualquier género).
  return PAR_LIMIT.some(([a, b]) => (c1 === a && c2 === b) || (c1 === b && c2 === a));
}

// Labores de estudiantes (lectura + presentaciones + discurso estudiantil).
export const STUDENT_LABORES = ['asignacion1', 'asignacion2', 'asignacion3'];

// Roles de ASIGNACIÓN de la reunión (discursos, conducciones, lecturas…).
// Las labores de SERVICIO (sonido, micrófono, plataforma, acomodador…) son el resto.
export const ASIGNACION_LABORES = ['presidente', 'presidenteFin', 'conductor1', 'conductor2', 'orador', 'salida', 'lector1', 'lector2', 'asignacion1', 'asignacion2', 'asignacion3', 'asignacion4', 'discursoInicial', 'perlas'];
export function isAssignmentLabore(id) { return ASIGNACION_LABORES.includes(String(id)); }
export function isServiceLabore(id) { return !isAssignmentLabore(id); }
export function isStudentLabore(labore) { return STUDENT_LABORES.includes(labore); }

// Los puestos separados aceptan a quien tiene la labor específica correspondiente
// o la labor general antigua (compatibilidad con perfiles ya guardados):
//  · Discurso inicial y Perlas de Tesoros ← labor general `asignacion4`.
//  · Presidencia de fin de semana ← labor `presidente` (antes cubría ambas).
//  · Orador de salida ← labor `orador` (antes cubría ambos discursos).
const ALIASES_LABORE = {
  discursoInicial: ['asignacion4', 'discursoInicial'],
  perlas: ['asignacion4', 'perlas'],
  presidenteFin: ['presidente', 'presidenteFin'],
  salida: ['orador', 'salida'],
};

// ¿La persona puede ejercer una labor? Debe tener al menos una labor marcada (los
// que no tienen ninguna no pueden usarse en ningún programa) y, si la labor tiene
// alias, se acepta cualquiera de ellos.
// Cuando se pasa `ctx` ({ restricciones, excepciones, capacidades }) aplica el
// modelo v2: capacidades otorgadas por cargo, restricciones y excepciones.
export function laboreEligible(p, labore, ctx) {
  if (ctx) return isEligibleV2(p, labore, ctx).eligible;
  const lista = ALIASES_LABORE[labore] || [labore];
  return (Array.isArray(p.labores) && p.labores.length > 0 && lista.some(l => (p.labores || []).includes(l)))
    && laboreAllowedForPerson(p, labore);
}

// ---- Modelo v2: restricciones, excepciones, capacidades por cargo ----
// Restricciones permanentes de una persona para una labor concreta.
// `restricciones` es un array de objetos { personId, laborId, permanente }.
export function hasRestriction(personId, labore, restricciones) {
  return (restricciones || []).some(r =>
    String(r.personId) === String(personId) && r.laborId === labore && r.permanente !== false && r.activo !== false
  );
}

// Excepciones: persona autorizada o restringida para una labor que normalmente
// no podría (o podría) hacer. `tipo: 'autorizar'` añade, 'restringir' quita.
export function hasException(personId, labore, excepciones) {
  const exc = (excepciones || []).find(e =>
    String(e.personId) === String(personId) && e.laborId === labore && e.activo !== false
  );
  return exc || null;
}

// Capacidades que otorga un cargo. Devuelve las labores que el cargo habilita.
export function cargoCapacities(cargoId, capacidades) {
  return (capacidades || []).filter(c => String(c.cargoId) === String(cargoId) && c.activo !== false).map(c => c.laborId);
}

// Comprobación completa de elegibilidad v2: labor base + restricciones +
// excepciones + capacidades por cargo. Devuelve { eligible, motivo }.
export function isEligibleV2(p, labore, { restricciones = [], excepciones = [], capacidades = [] } = {}) {
  const lista = ALIASES_LABORE[labore] || [labore];
  const base = Array.isArray(p.labores) && p.labores.length > 0 && lista.some(l => p.labores.includes(l));
  if (!base) {
    // Verificar si el cargo otorga esta capacidad
    const cargoCaps = (Array.isArray(p.cargos) ? p.cargos : []).flatMap(c => cargoCapacities(c, capacidades));
    if (!cargoCaps.includes(labore)) return { eligible: false, motivo: 'No tiene la labor requerida ni capacidad por cargo.' };
  }
  if (!laboreAllowedForPerson(p, labore)) return { eligible: false, motivo: 'Restricción de género.' };
  if (hasRestriction(p.id, labore, restricciones)) return { eligible: false, motivo: 'Restricción permanente registrada.' };
  const exc = hasException(p.id, labore, excepciones);
  if (exc && exc.tipo === 'restringir') return { eligible: false, motivo: 'Excepción individual: restringido para esta labor.' };
  return { eligible: true, motivo: exc && exc.tipo === 'autorizar' ? 'Autorizado por excepción individual.' : '' };
}

// Agrupación de las tarjetas de asignaciones (Congregación → Asignaciones).
// `estudiantes` es un subgrupo dentro de "Entre semana".
export const ASIGNACION_GRUPOS = [
  { id: 'entre-semana', title: 'Entre semana', sub: false },
  { id: 'estudiantes', title: 'Estudiantiles', sub: true },
  { id: 'fin-semana', title: 'Fin de semana', sub: false },
];
export const LABORE_GRUPO = {
  'presidente': 'entre-semana',
  'conductor2': 'entre-semana',
  'lector2': 'entre-semana',
  'discursoInicial': 'entre-semana',
  'perlas': 'entre-semana',
  'asignacion4': 'entre-semana',
  'asignacion1': 'estudiantes',
  'asignacion2': 'estudiantes',
  'asignacion3': 'estudiantes',
  'presidenteFin': 'fin-semana',
  'conductor1': 'fin-semana',
  'lector1': 'fin-semana',
  'orador': 'fin-semana',
  'salida': 'fin-semana',
};

// Persona que puede asumir partes de estudiante: debe tener marcada cualquiera de
// las labores de estudiante (lectura, presentación, discurso).
export function isStudentPerson(p) {
  return Array.isArray(p?.labores) && p.labores.length > 0 && p.labores.some(r => STUDENT_LABORES.includes(r));
}

// Labor de equipo permitida para una persona: las mujeres solo pueden tener la
// presentación (asignacion2); el resto de labores quedan bloqueadas en la UI.
export function laboreAllowedForPerson(person, labore) {
  if (person && person.genero === 'femenino') return labore === 'asignacion2';
  return true;
}

/* ---------- Estructura de partes de entre semana ---------- */
// Devuelve los puestos (slots) de una parte con su rol. Fuente única usada por
// el editor y por el algoritmo de automatización.
export function midweekSlotsOf(sec, part) {
  const secId = sec && sec.id;
  const parts = (sec && sec.parts) || [];
  const idx = parts.indexOf(part);
  if (secId === 'tesoros') {
    // Última parte = Lectura de la Biblia (asignacion1); la primera es el
    // Discurso inicial (discursoInicial); el resto son Perlas (perlas).
    if (idx === parts.length - 1) return [{ key: 'lector', label: 'Lector', labore: 'asignacion1' }];
    if (idx === 0) return [{ key: 'conductor', label: 'Discurso inicial', labore: 'discursoInicial' }];
    return [{ key: 'conductor', label: 'Perlas', labore: 'perlas' }];
  }
  if (secId === 'maestros') {
    // Presentaciones de 2 personas (asignacion2); si dice "discurso" es de 1 (asignacion3).
    if (/discurso/i.test(String(part.title || ''))) return [{ key: 'conductor', label: 'Discurso', labore: 'asignacion3' }];
    return [{ key: 'estudiante', label: 'Estudiante', labore: 'asignacion2' }, { key: 'ayudante', label: 'Ayudante', labore: 'asignacion2' }];
  }
  if (secId === 'vida') {
    // Última parte = Estudio Bíblico de la Congregación (conductor2 + lector2);
    // las anteriores son discursos de la reunión (asignacion4).
    if (idx === parts.length - 1) return [{ key: 'conductor', label: 'Conductor', labore: 'conductor2' }, { key: 'lector', label: 'Lector', labore: 'lector2' }];
    return [{ key: 'conductor', label: 'Discurso', labore: 'asignacion4' }];
  }
  return [{ key: 'conductor', label: 'Conductor' }];
}

// Labores "no estudiante" (discursos de la reunión y estudio).
const ROL_NO_ESTUDIANTE = new Set(['asignacion4', 'conductor2', 'lector2', 'discursoInicial', 'perlas']);

/* ---------- Automatización de asignaciones ---------- */
const ORDEN_CAL = ['A', 'B', 'C', 'D'];

export function readerLevelEligible(level, calificacion) {
  const idx = ORDEN_CAL.indexOf(calificacion);
  if (idx < 0) return true;
  const lvl = String(level || 'CD').toUpperCase();
  const maxIdx = (lvl === 'C' || lvl === 'D' || lvl === 'CD') ? ORDEN_CAL.length - 1 : ORDEN_CAL.indexOf(lvl);
  return maxIdx < 0 ? true : idx <= maxIdx;
}

export function readerPriority(calificacion) {
  const prio = { C: 0, D: 1, B: 2, A: 3 };
  return prio[calificacion] ?? 2;
}

// Personas con una labor marcada y que pueden ejercerla en la UI según la regla
// de género (laboreAllowedForPerson). Quienes no tienen labores quedan fuera.
function peopleForLabore(people, labore) {
  return people.filter(p => laboreEligible(p, labore));
}

// Mapa de los campos editables de la reunión de fin de semana según su tipo.
// Solo los campos listados se automatizan (el orador es texto libre/manual).
export function camposFinSemana(w) {
  if (w.type === 'assembly') return [];
  if (w.type === 'commemoration') return [{ campo: 'presidente', labore: 'presidenteFin' }];
  if (w.type === 'supervisor') return [
    { campo: 'presidente', labore: 'presidenteFin' },
    { campo: 'estudioSinLectura', labore: 'conductor1' },
  ];
  return [
    { campo: 'presidente', labore: 'presidenteFin' },
    { campo: 'conductor', labore: 'conductor1' },
    { campo: 'lector', labore: 'lector1' },
  ];
}

// Labor de un campo del FIN DE SEMANA: la presidencia es una asignación distinta
// de la de entre semana, así que usa `presidenteFin` en vez de `presidente`.
export function campoFinLabore(campo) {
  return campo === 'presidente' ? 'presidenteFin' : (FIELD_LABORE[campo] || '');
}

// Automatiza la reunión de entre semana de un mes. Muta `midweeks`
// (asigna week.presidente y p.assignments). Devuelve un reporte.
// Orden: presidente → discursos no estudiante → estudiantes (parejas canBePair).
// Reglas: sin repetir la misma parte en el mes (E3), sin duplicar a nadie en la
// misma semana (E2 intra-reunión). Solo rellena puestos vacíos.
// `ocupadosSemana`: opcional, Map sábado -> Set de personas ocupadas esa semana
// (p. ej. acomodación y salidas) que no deben recibir la parte (E1/E2).
export function automatizarEntreSemana(people, midweeks, ocupadosSemana = null, opts = {}) {
  // `opts`: { historial, nombres, restricciones, excepciones, capacidades }
  const historial = opts.historial || [];
  const nombres = opts.nombres || {};
  const restricciones = opts.restricciones || [];
  const excepciones = opts.excepciones || [];
  const capacidades = opts.capacidades || [];
  const reporte = { asignados: 0, vacios: [], motivos: [], flexiones: [] };
  const rolPorPersona = {}; // personaId -> Set de partes ya usadas en el mes (E3)
  const enSemana = {};      // weekId -> Set de personas ya asignadas esa semana
  const cargaMes = {};      // personaId -> nº de asignaciones en el mes (carga)
  const ultima = {};        // personaId -> fecha ISO de la última asignación histórica
  const totalAsig = {};     // personaId -> nº total de asignaciones en el mes (mujeres: máx. 1)

  // ---- Carga del historial (regla 6) ----
  historial.forEach(h => {
    const pid = String(h.personId);
    const d = String(h.date || '');
    if (d > (ultima[pid] || '')) ultima[pid] = d;
  });

  const contarCarga = (pid) => (rolPorPersona[pid] ? rolPorPersona[pid].size : 0);

  const marcado = (pid, key, weekId) => {
    (rolPorPersona[pid] ||= new Set()).add(key);
    (enSemana[weekId] ||= new Set()).add(pid);
    cargaMes[pid] = contarCarga(pid);
    totalAsig[pid] = (totalAsig[pid] || 0) + 1;
    reporte.asignados++;
  };

  // Reglas de elegibilidad (estrictas).
  const elegible = (p, key, weekId) => {
    if (p.genero === 'femenino' && (totalAsig[String(p.id)] || 0) >= 1) return false; // mujer: máx. 1 asignación al mes
    if ((rolPorPersona[String(p.id)] || new Set()).has(key)) return false; // E3: mismo puesto en el mes
    if ((enSemana[weekId] || new Set()).has(String(p.id))) return false;   // E2: repetido en la semana
    const setOcup = ocupadosSemana ? (ocupadosSemana.get(addDays(weekId, 5)) || new Set()) : new Set();
    if (setOcup.has(String(p.id))) return false;                            // E1: ocupado por acomodación/salidas
    return true;
  };

  // Orden de preferencia de candidatos: (a) calificación para estudiantes,
  // (b) menor carga mensual (regla 3), (c) última participación más antigua
  // (regla 6), (d) nombre (estable).
  const puntuar = (p, weekId) => {
    const pid = String(p.id);
    const cal = isStudentLabore(p.labore ?? '') ? ORDEN_CAL.indexOf(p.calificacion || '') : 0;
    const carga = cargaMes[pid] || 0;
    const ult = ultima[pid] || '';
    return { cal, carga, ult };
  };

  // Elige persona para un puesto. Niveles de flexibilización (regla 7):
  //   nivel 0: reglas estrictas
  //   nivel 1: permitir repetir el MISMO puesto en el mes (E3)
  //   nivel 2: permitir repetir persona en la semana (E2)
  // Nunca asigna a ocupados por acomodación/salidas (E1 no se flexibiliza).
  const elegir = (weekId, labore, key) => {
    const esLector = labore === 'asignacion1';
    const readerLevel = opts.readerLevel || 'CD';
    let cand = esLector
      ? people.filter(p => isStudentPerson(p) && readerLevelEligible(readerLevel, p.calificacion))
      : isStudentLabore(labore) ? people.filter(isStudentPerson) : peopleForLabore(people, labore);
    // Modelo v2: elegibilidad completa (labor base, capacidad por cargo,
    // restricciones y excepciones individuales).
    cand = cand.filter(p => isEligibleV2(p, labore, { restricciones, excepciones, capacidades }).eligible);
    // Orden de preferencia: calificación (estudiantes) → menor carga mensual →
    // última participación más antigua → nombre (estable).
    cand = cand.slice().sort((a, b) => {
      if (isStudentLabore(labore)) {
        if (esLector) {
          const pa = readerPriority(a.calificacion), pb = readerPriority(b.calificacion);
          if (pa !== pb) return pa - pb;
        } else {
          const ca = ORDEN_CAL.indexOf(a.calificacion || '');
          const cb = ORDEN_CAL.indexOf(b.calificacion || '');
          if (ca !== cb) return ca - cb;
        }
      }
      const caA = cargaMes[String(a.id)] || 0, caB = cargaMes[String(b.id)] || 0;
      if (caA !== caB) return caA - caB;
      const uA = ultima[String(a.id)] || '', uB = ultima[String(b.id)] || '';
      if (uA !== uB) return uA < uB ? -1 : 1; // antes = más antigua → primero
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    const filtro = (nivel) => (p) => {
      if (p.genero === 'femenino' && (totalAsig[String(p.id)] || 0) >= 1) return false; // mujer: máx. 1 asignación al mes (no se flexibiliza)
      if ((enSemana[weekId] || new Set()).has(String(p.id))) return nivel >= 2;
      if ((rolPorPersona[String(p.id)] || new Set()).has(key)) return nivel >= 1;
      const setOcup = ocupadosSemana ? (ocupadosSemana.get(addDays(weekId, 5)) || new Set()) : new Set();
      return !setOcup.has(String(p.id));
    };

    let p = cand.find(x => filtro(0)(x));
    let nivelUsado = 0;
    if (!p) { p = cand.find(x => filtro(1)(x)); nivelUsado = 1; }
    if (!p) { p = cand.find(x => filtro(2)(x)); nivelUsado = 2; }

    if (!p) {
      reporte.vacios.push({ semana: weekId, labore, key, imposible: true });
      return '';
    }

    // Motivos (algoritmo explicable).
    const pid = String(p.id);
    const motivos = [`Tiene el rol requerido (${labore}).`];
    if (!(rolPorPersona[pid] || new Set()).has(key)) {
      // no se repite el puesto en el mes
    } else {
      motivos.push('Se repitió el puesto en el mes por falta de candidatos (regla E3 flexibilizada).');
    }
    if (!(enSemana[weekId] || new Set()).has(pid)) {
      motivos.push('No participa en otra parte de esta semana.');
    } else {
      motivos.push('Se asignó pese a participar ya en la semana por falta de candidatos (regla E2 flexibilizada).');
    }
    if (nivelUsado > 0) {
      reporte.flexiones.push({ semana: weekId, labore, key, nivel: nivelUsado, personaId: pid });
      motivos.push(`Asignación imperfecta: se flexibilizó la regla de repetición (nivel ${nivelUsado}).`);
    }
    const resto = cand.filter(x => String(x.id) !== pid && filtro(0)(x));
    const cargaP = cargaMes[pid] || 0;
    if (resto.length && resto.every(x => (cargaMes[String(x.id)] || 0) >= cargaP)) {
      motivos.push('Es quien menor carga mensual tiene entre los disponibles.');
    }
    if (ultima[pid]) motivos.push(`Su última asignación registrada fue el ${ultima[pid]}.`);
    else if (!historial.length) motivos.push('Sin historial previo: se prioriza la distribución por rol.');

    reporte.motivos.push({ semana: weekId, labore, key, personaId: pid, nombre: (nombres[pid] || p.name || ''), motivos });

    marcado(pid, key, weekId);
    return String(p.id);
  };

  // 0. Registrar lo ya asignado para respetarlo (E2/E3).
  midweeks.forEach(week => {
    const weekId = String(week.id);
    if (week.presidente) {
      (enSemana[weekId] ||= new Set()).add(String(week.presidente));
      totalAsig[String(week.presidente)] = (totalAsig[String(week.presidente)] || 0) + 1;
    }
    (week.sections || []).forEach((sec, si) => (sec.parts || []).forEach(part => {
      const slots = midweekSlotsOf(sec, part);
      slots.forEach(slot => {
        const id = (part.assignments || {})[slot.key];
        if (!id) return;
        const key = `mw_${si}_${part.num}_${slot.key}`;
        (rolPorPersona[String(id)] ||= new Set()).add(key);
        (enSemana[weekId] ||= new Set()).add(String(id));
        totalAsig[String(id)] = (totalAsig[String(id)] || 0) + 1;
      });
    }));
  });

  midweeks.forEach(week => {
    const weekId = String(week.id);

    // 1. Presidente (solo si está vacío; se evita repetir a alguien de la misma semana).
    if (!week.presidente) {
      const pres = elegir(weekId, 'presidente', 'presidente');
      if (pres) week.presidente = pres;
    }

    // 2. Discursos no estudiante + estudio (por partes), solo puestos vacíos.
    (week.sections || []).forEach((sec, si) => (sec.parts || []).forEach(part => {
      const ap = { ...(part.assignments || {}) };
      midweekSlotsOf(sec, part).forEach(slot => {
        if (!ROL_NO_ESTUDIANTE.has(slot.labore)) return;
        if (ap[slot.key]) return;
        const id = elegir(weekId, slot.labore, `mw_${si}_${part.num}_${slot.key}`);
        if (id) ap[slot.key] = id;
      });
      part.assignments = ap;
    }));

    // 3. Estudiantes (lectura + presentaciones + discurso estudiantil), parejas con canBePair.
    (week.sections || []).forEach((sec, si) => (sec.parts || []).forEach(part => {
      const ap = { ...(part.assignments || {}) };
      const slots = midweekSlotsOf(sec, part);
      if (!slots.every(s => isStudentLabore(s.labore))) return;
      if (slots.length === 2 && slots[0].labore === 'asignacion2') {
        // Pareja estudiante + ayudante: buscar una pareja compatible libre.
        const keyA = `mw_${si}_${part.num}_${slots[0].key}`;
        const keyB = `mw_${si}_${part.num}_${slots[1].key}`;
        if (ap[slots[0].key] && ap[slots[1].key]) return;
        if (ap[slots[0].key] || ap[slots[1].key]) { reporte.vacios.push({ semana: weekId, labore: 'asignacion2', key: keyA }); return; }
        const cand = people.filter(isStudentPerson)
          .slice().sort((a, b) => {
            const w = (x) => x.genero === 'femenino' ? 0 : 1;
            const wa = w(a), wb = w(b);
            if (wa !== wb) return wa - wb;
            return ORDEN_CAL.indexOf(b.calificacion || '') - ORDEN_CAL.indexOf(a.calificacion || '');
          });
        let found = false;
        for (const a of cand) {
          if (!elegible(a, keyA, weekId)) continue;
          const b = cand.find(x => String(x.id) !== String(a.id) && elegible(x, keyB, weekId) && canBePair(a, x));
          if (!b) continue;
          marcado(String(a.id), keyA, weekId);
          marcado(String(b.id), keyB, weekId);
          ap[slots[0].key] = String(a.id);
          ap[slots[1].key] = String(b.id);
          reporte.motivos.push({
            semana: weekId, labore: 'asignacion2', key: keyA, personaId: String(a.id),
            nombre: (nombres[String(a.id)] || a.name || ''), motivos: ['Pareja de presentación compatible (calificación/género/enlace).', `Su última asignación registrada fue ${ultima[String(a.id)] || 'ninguna'}.`],
          });
          reporte.motivos.push({
            semana: weekId, labore: 'asignacion2', key: keyB, personaId: String(b.id),
            nombre: (nombres[String(b.id)] || b.name || ''), motivos: ['Pareja de presentación compatible (calificación/género/enlace).', `Su última asignación registrada fue ${ultima[String(b.id)] || 'ninguna'}.`],
          });
          found = true;
          break;
        }
        if (!found) { reporte.vacios.push({ semana: weekId, labore: 'asignacion2', key: keyA }); reporte.vacios.push({ semana: weekId, labore: 'asignacion2', key: keyB }); }
      } else {
        // 1 persona (lectura asignacion1 o discurso estudiantil asignacion3).
        const slot = slots[0];
        if (!ap[slot.key]) {
          const id = elegir(weekId, slot.labore, `mw_${si}_${part.num}_${slot.key}`);
          if (id) ap[slot.key] = id;
        }
      }
      part.assignments = ap;
    }));
  });

  return reporte;
}

// Automatiza la acomodación de un mes: reparte los puestos de ATENCION_DEF con
// personas de atención libres en cada semana. Rellena las atencion del fin de
// semana (`atencion`, { id, weeks:[{saturday, atencion}] }) y las de la reunión de
// entre semana (`midweeks`, en cada week.labores). Solo rellena puestos vacíos,
// no repite el mismo labore a la misma persona en el mes y evita asignar a quien
// ya participa en la reunión de entre semana de esa semana (E1). Devuelve reporte.
export function automatizarAtencion(people, atencion, midweeks, opts = {}) {
  const reporte = { asignados: 0, vacios: [] };
  // Si serviceRolesOnlyMale está activo (default), las labores de acomodación
  // solo admiten varones; alineado con el scoring y la vista de acomodación.
  const serviceRolesOnlyMale = opts.serviceRolesOnlyMale !== false;
  const restricciones = opts.restricciones || [];
  const excepciones = opts.excepciones || [];
  const capacidades = opts.capacidades || [];
  const cumpleV2 = (p, lab) => {
    // La restricción de género en acomodación la gobierna serviceRolesOnlyMale
    // (abajo), no laboreAllowedForPerson; aquí solo restricciones/excepciones
    // individuales y capacidad otorgada por cargo.
    if (hasRestriction(p.id, lab, restricciones)) return false;
    const exc = hasException(p.id, lab, excepciones);
    if (exc && exc.tipo === 'restringir') return false;
    return (Array.isArray(p.labores) && p.labores.includes(lab)) ||
      (Array.isArray(p.cargos) && p.cargos.some(c => cargoCapacities(c, capacidades).includes(lab)));
  };
  const esAtencion = (p) => isAtencionPerson(p) && (!serviceRolesOnlyMale || p.genero !== 'femenino');
  const ocupMw = new Map(); // saturday -> Set de personas de entre semana esa semana
  midweeks.forEach(mw => {
    const sat = addDays(mw.id, 5); // sábado de la semana del lunes
    const set = new Set();
    if (mw.presidente) set.add(String(mw.presidente));
    (mw.sections || []).forEach(sec => (sec.parts || []).forEach(p => Object.values(p.assignments || {}).forEach(id => { if (id) set.add(String(id)); })));
    // También cuentan las atencion de entre semana ya asignadas.
    const l = mw.labores || {};
    ATENCION_DEF.forEach(d => { const v = l[d.key]; (Array.isArray(v) ? v : [v]).forEach(id => { if (id) set.add(String(id)); }); });
    ocupMw.set(sat, set);
  });
  // Cargos de la reunión de fin de semana (presidente/conductor/lector) según el
  // sábado: la acomodación del fin de semana no debe solaparse con ellos (E2).
  // `months` llega por opts desde quienes lo ejecutan después de automatizar fin.
  const ocupFin = new Map(); // saturday -> Set de personas con cargo de fin de semana
  (opts.months || []).forEach(m => (m.weeks || []).forEach(w => {
    ['presidente', 'conductor', 'lector', 'estudioSinLectura'].forEach(c => {
      if (w[c]) {
        const set = new Set(ocupFin.get(String(w.date)) || []);
        set.add(String(w[c]));
        ocupFin.set(String(w.date), set);
      }
    });
  }));
  const laboreMes = new Map(); // personaId -> Set de claves labore usadas en el mes
  const sonidoMes = new Map(); // personaId -> nº de veces en sonido en el mes
  const cargaMes = new Map(); // personaId -> nº total de atenciones en el mes (reparto)

  // Sonido (audio) es una labor con pocos asignados: se rellena PRIMERO para que
  // nunca quede sin asignado. El resto se completa después.
  const ordenDef = [...ATENCION_DEF].sort((a, b) => (a.key === 'sonido' ? -1 : b.key === 'sonido' ? 1 : 0));

  // Rellena los puestos vacíos de un objeto atencion `l` para una semana `sat`.
  // `prefijo` separa las claves de FS y ES para que no se bloqueen entre sí en
  // el mes (una persona puede hacer el mismo labore en una reunión distinta).
  // Mapeo: cada puesto de ATENCION_DEF requiere la(s) labor(es) de persona correspondiente(s).
  const ATENCION_REQUIERE = {
    sonido: ['audio', 'sonido'],
    microfono: ['microf'],
    plataforma: ['plataforma'],
    acomodacion: ['acomodador'],
  };

  const rellenar = (l, sat, ocupInicial, prefijo) => {
    const ocup = new Set(ocupInicial || []);
    ATENCION_DEF.forEach(d => {
      if (l[d.key] === undefined) l[d.key] = d.count > 1 ? Array(d.count).fill('') : '';
    });
    ATENCION_DEF.forEach(d => {
      const v = l[d.key];
      (Array.isArray(v) ? v : [v]).forEach((id, si) => {
        if (!id) return;
        ocup.add(String(id));
        const k = `${prefijo}${d.key}_${si}`;
        if (!laboreMes.has(String(id))) laboreMes.set(String(id), new Set());
        laboreMes.get(String(id)).add(k);
        if (d.key === 'sonido') sonidoMes.set(String(id), (sonidoMes.get(String(id)) || 0) + 1);
        cargaMes.set(String(id), (cargaMes.get(String(id)) || 0) + 1);
      });
    });
    ordenDef.forEach(d => {
      const v = l[d.key];
      const laboresRequeridas = ATENCION_REQUIERE[d.key] || [];
      const esSonido = d.key === 'sonido';
      for (let si = 0; si < d.count; si++) {
        const cur = Array.isArray(v) ? v[si] : (si === 0 ? v : '');
        if (cur) continue;
        const claveLabore = `${prefijo}${d.key}_${si}`;
        // Solo se asignan personas con la labor exacta del puesto y libres esa
        // semana. Sonido ya NO relaja la exigencia de labor: si no hay candidato,
        // el puesto queda vacío y se reporta (como el resto de labores).
        const elegir = () => people
          .filter(p => laboresRequeridas.some(lab => cumpleV2(p, lab)))
          .filter(x => !serviceRolesOnlyMale || x.genero !== 'femenino')
          .filter(x => !ocup.has(String(x.id)))
          .filter(x => {
            // En labores de servicio, los publicadores pueden repetirse todo lo
            // necesario; los ministeriales/ancianos no repiten el mismo puesto en
            // el mes (para que no acaparen). En sonido, el anciano además se limita
            // a 2 veces al mes.
            if (esSonido && esAnciano(x)) return (sonidoMes.get(String(x.id)) || 0) < 2;
            if (esPublicador(x)) return true;
            return !((laboreMes.get(String(x.id)) || new Set()).has(claveLabore));
          })
          .sort((a, b) => {
            // Prioridad: publicadores primero → luego ministerial → por último anciano.
            const na = cargoNivel(a), nb = cargoNivel(b);
            if (na !== nb) return na - nb;
            // Equilibrio: quien menos atenciones tiene en el mes, primero.
            return (cargaMes.get(String(a.id)) || 0) - (cargaMes.get(String(b.id)) || 0);
          })[0];
        const cand = elegir();
        if (!cand) { reporte.vacios.push({ semana: sat, labore: `${d.key}_${si}` }); continue; }
        if (Array.isArray(v)) v[si] = cand.id;
        else l[d.key] = cand.id;
        ocup.add(String(cand.id));
        if (!laboreMes.has(String(cand.id))) laboreMes.set(String(cand.id), new Set());
        laboreMes.get(String(cand.id)).add(claveLabore);
        if (d.key === 'sonido') sonidoMes.set(String(cand.id), (sonidoMes.get(String(cand.id)) || 0) + 1);
        cargaMes.set(String(cand.id), (cargaMes.get(String(cand.id)) || 0) + 1);
        reporte.asignados++;
      }
    });
  };

  // Labores del fin de semana (programa de acomodación). Además de la reunión de
  // entre semana (E1), se evita a quien ya tiene cargo de fin de semana ese sábado
  // (presidente/conductor/lector) para no generar E2.
  atencion.forEach(rec => (rec.weeks || []).forEach(w => {
    const ocup = new Set(ocupMw.get(String(w.saturday)) || []);
    (ocupFin.get(String(w.saturday)) || []).forEach(id => ocup.add(String(id)));
    rellenar(w.labores || {}, String(w.saturday), ocup, 'atencion_');
  }));

  // Labores de entre semana (se guardan en cada week.labores del midweek).
  // Para no duplicar personas, se suma a los ocupados las del mismo sábado (FS).
  const fsPorSat = new Map();
  atencion.forEach(rec => (rec.weeks || []).forEach(w => {
    const set = new Set();
    const l = w.labores || {};
    ATENCION_DEF.forEach(d => { const v = l[d.key]; (Array.isArray(v) ? v : [v]).forEach(id => { if (id) set.add(String(id)); }); });
    fsPorSat.set(String(w.saturday), set);
  }));
  midweeks.forEach(mw => {
    const sat = addDays(mw.id, 5);
    const base = new Set(ocupMw.get(sat) || []);
    (fsPorSat.get(sat) || []).forEach(id => base.add(String(id)));
    // Inicializar atencion del midweek si aún no existen (garantiza persistir).
    if (!mw.labores) mw.labores = {};
    rellenar(mw.labores, mw.id, base, 'es_');
  });

  return reporte;
}

// Automatiza los oradores de salida de un mes: asigna a quien tenga la labor
// "orador" (o sin labores) y no esté ya ocupado esa semana por acomodación,
// salidas o la reunión de fin de semana. Muta `salidas` (plain). Devuelve reporte.
export function automatizarSalidas(people, salidas, { midweeks = [], months = [], atencion = [], restricciones = [], excepciones = [], capacidades = [] } = {}) {
  const reporte = { asignados: 0, vacios: [] };
  const ocupados = new Map();
  const marcar = (sat, id) => { if (id) { const s = new Set(ocupados.get(sat) || []); s.add(String(id)); ocupados.set(sat, s); } };
  atencion.forEach(p => (p.weeks || []).forEach(w => {
    const l = w.labores || {};
    ATENCION_DEF.forEach(dd => { const v = l[dd.key]; (Array.isArray(v) ? v : [v]).forEach(id => marcar(w.saturday, id)); });
  }));
  months.forEach(p => (p.weeks || []).forEach(w => {
    ['presidente', 'conductor', 'lector', 'estudioSinLectura'].forEach(f => marcar(w.date, w[f]));
  }));
  midweeks.forEach(w => {
    const sat = addDays(w.id, 5);
    if (w.presidente) marcar(sat, w.presidente);
    (w.sections || []).forEach(sec => (sec.parts || []).forEach(p => Object.values(p.assignments || {}).forEach(id => marcar(sat, id))));
  });
  const peopleForSalida = people.filter(p => isEligibleV2(p, 'salida', { restricciones, excepciones, capacidades }).eligible);
  salidas.forEach(p => (p.weeks || []).forEach(w => {
    if (w.sinSalida) return;
    const sat = String(w.saturday);
    const ocup = new Set(ocupados.get(sat) || []);
    (w.outings || []).forEach(o => {
      if (o.oradorSalida) { marcar(sat, o.oradorSalida); return; }
      const cand = peopleForSalida.find(x => !ocup.has(String(x.id)));
      if (!cand) { reporte.vacios.push({ semana: sat, labore: 'salida' }); return; }
      o.oradorSalida = cand.id;
      ocup.add(String(cand.id));
      marcar(sat, cand.id);
      reporte.asignados++;
    });
  }));
  return reporte;
}

// Salidas del mes sin orador asignado (puestos vacíos del programa de salidas).
export function salidasFaltantes(salidas) {
  const faltantes = [];
  (salidas || []).forEach(p => (p.weeks || []).forEach(w => {
    if (w.sinSalida) return;
    (w.outings || []).forEach((o, oi) => {
      if (!o || !asStr(o.oradorSalida)) faltantes.push({ saturday: String(w.saturday || ''), index: oi });
    });
  }));
  return faltantes;
}

// Estado calculado de cada programa de un mes (spec 33, decisión 6):
// BORRADOR (0%), PARCIAL (>0<100%), GENERADO (100%).
// `programs`: { midweeks, months, salidas, atencion } del mes.
// Devuelve { entre, fin, labores } con { pct, estado, done, total }.
export function estadoProgramas(programs) {
  const total = (done, t) => t === 0 ? 0 : Math.round((done / t) * 100);
  const estado = (p) => p <= 0 ? 'BORRADOR' : p >= 100 ? 'GENERADO' : 'PARCIAL';
  const res = (done, t) => { const pct = total(done, t); return { pct, estado: estado(pct), done, total: t }; };

  let entTotal = 0, entDone = 0;
  (programs.midweeks || []).forEach(w => {
    entTotal += 1;
    if (asStr(w.presidente)) entDone++;
    (w.sections || []).forEach(sec => (sec.parts || []).forEach(p => {
      midweekSlotsOf(sec, p).forEach(slot => {
        entTotal++;
        if (asStr((p.assignments || {})[slot.key])) entDone++;
      });
    }));
  });

  let finTotal = 0, finDone = 0;
  (programs.months || []).forEach(m => (m.weeks || []).forEach(w => {
    camposFinSemana(w).forEach(({ campo }) => {
      finTotal++;
      if (asStr(w[campo])) finDone++;
    });
  }));
  (programs.salidas || []).forEach(p => (p.weeks || []).forEach(w => {
    if (w.sinSalida) return;
    (w.outings || []).forEach(o => { finTotal++; if (asStr(o.oradorSalida)) finDone++; });
  }));

  let labTotal = 0, labDone = 0;
  const countLab = (labores) => {
    const l = labores || {};
    ATENCION_DEF.forEach(d => {
      const v = l[d.key];
      const arr = Array.isArray(v) ? v : [v];
      for (let si = 0; si < d.count; si++) {
        labTotal++;
        if (asStr(arr[si])) labDone++;
      }
    });
  };
  (programs.atencion || []).forEach(p => (p.weeks || []).forEach(w => countLab(w.labores)));
  (programs.midweeks || []).forEach(w => countLab(w.labores));

  return { entre: res(entDone, entTotal), fin: res(finDone, finTotal), labores: res(labDone, labTotal) };
}

const LABOR_LABEL = {
  'presidente': 'Presidente (entre semana)',
  'presidenteFin': 'Presidente fin de semana',
  'conductor1': 'Conductor (Atalaya)',
  'lector1': 'Lector (Atalaya)',
  'conductor2': 'Conductor (Estudio)',
  'lector2': 'Lector (Estudio)',
  'orador': 'Orador (discurso)',
  'salida': 'Orador de salida',
  'asignacion1': 'Lectura',
  'asignacion2': 'Presentación',
  'asignacion3': 'Discurso estudiantil',
  'asignacion4': 'Discurso de la reunión (vida cristiana)',
  'discursoInicial': 'Discurso inicial de Tesoros',
  'perlas': 'Perlas Espirituales',
};
const ATENCION_LABORE_TO_ROLE = { acomodacion: 'acomodador', microfono: 'microf', plataforma: 'plataforma', sonido: 'audio' };

// Etiqueta legible de una labor (puestos de la automatización).
function labelDeLabore(labore) {
  if (LABOR_LABEL[labore]) return LABOR_LABEL[labore];
  const base = String(labore).split('_')[0];
  const def = ATENCION_DEF.find(d => d.key === base);
  return def ? def.label : String(labore);
}

// Puestos que quedaron vacíos en una propuesta, agregados de los reportes de los
// motores. Devuelve [{ programa: 'entre'|'atencion'|'fin', semana, labore, label }].
export function laboresVaciasPropuesta(p) {
  const out = [];
  const r = (p && p.reportes) || {};
  const rec = (programa, ls) => (ls || []).forEach(v => {
    out.push({ programa, semana: String(v.semana || ''), labore: v.labore, label: labelDeLabore(v.labore) });
  });
  rec('entre', r.entre && r.entre.vacios);
  rec('atencion', r.atencion && r.atencion.vacios);
  rec('fin', r.fin && r.fin.vacios);
  return out;
}

// Personas activas sin ninguna asignación en la propuesta, agrupadas por motivo:
//  · conVacantes: su labor quedó sin cubrir en algún puesto (podrían cubrirlo).
//  · cubiertos:   sus labores quedaron cubiertas por otros (no quedaron puestos).
// ·  universales: sin labores definidas (el motor no los usa; esperan una labor).
// Cada entrada de conVacantes incluye `laboresVacantes` y `puestos` (nº de vacíos).
export function sinAsignarPorMotivo(p, people = []) {
  const asignados = new Set(((p && p.assignments) || []).map(a => String(a.personId)));
  const noAsignados = people.filter(x => x.activo !== false && !asignados.has(String(x.id)));
  const vacios = new Set();
  const puestosPorLabore = {};
  const rec = (ls, atencion) => (ls || []).forEach(v => {
    const k = atencion
      ? (ATENCION_LABORE_TO_ROLE[String(v.labore).split('_')[0]] || v.labore)
      : v.labore;
    vacios.add(k);
    puestosPorLabore[k] = (puestosPorLabore[k] || 0) + 1;
  });
  const r = (p && p.reportes) || {};
  rec(r.entre && r.entre.vacios, false);
  rec(r.atencion && r.atencion.vacios, true);
  rec(r.fin && r.fin.vacios, false);

  const universales = [], conVacantes = [], cubiertos = [];
  noAsignados.forEach(x => {
    const roles = Array.isArray(x.labores) ? x.labores : [];
    if (!roles.length) { universales.push(x); return; }
    const laboresVacantes = roles.filter(k => vacios.has(k));
    if (laboresVacantes.length) {
      conVacantes.push({ persona: x, laboresVacantes, puestos: laboresVacantes.reduce((s, k) => s + (puestosPorLabore[k] || 0), 0) });
    } else {
      cubiertos.push(x);
    }
  });
  return { universales, conVacantes, cubiertos };
}

// Automatiza la reunión de fin de semana: rellena los campos editables por
// persona (presidente, conductor, lector, estudioSinLectura según el tipo de
// semana) sin repetir a quienes ya están en acomodación o salidas esa semana
// (E2) ni repetir el mismo cargo en el mes (E4). Muta `months`. Devuelve reporte.
export function automatizarFinSemana(people, months, salidas, atencion, midweeks = [], opts = {}) {
  const reporte = { asignados: 0, vacios: [] };
  const cargoMes = {}; // personaId -> Set de cargos usados en el mes (E4)
  const ocupados = {}; // saturday -> Set de personas ocupadas (acomodación + salidas)
  const permId = opts.permanentConductorId ? String(opts.permanentConductorId) : '';
  const backupId = (opts.permanentConductorBackupId && String(opts.permanentConductorBackupId) !== permId) ? String(opts.permanentConductorBackupId) : '';
  const backupId2 = (opts.permanentConductorBackupId2 && String(opts.permanentConductorBackupId2) !== permId && String(opts.permanentConductorBackupId2) !== backupId) ? String(opts.permanentConductorBackupId2) : '';
  const restricciones = opts.restricciones || [];
  const excepciones = opts.excepciones || [];
  const capacidades = opts.capacidades || [];

  // Ocupados por SALIDAS (solo oradorSalida) — esto es lo que puede forzar al suplente.
  const ocupadosSalidas = {};
  const marcarOcupadoSalida = (sat, id) => {
    if (id) (ocupadosSalidas[sat] ||= new Set()).add(String(id));
  };
  salidas.forEach(p => (p.weeks || []).forEach(w => {
    if (w.sinSalida) return;
    (w.outings || []).forEach(o => marcarOcupadoSalida(String(w.saturday), o.oradorSalida));
  }));

  // Ocupados por ATENCION (acomodación FS + ES) — para E2 general.
  const ocupadosAtencion = {};
  const marcarOcupadoAtencion = (sat, id) => {
    if (id) (ocupadosAtencion[sat] ||= new Set()).add(String(id));
  };
  atencion.forEach(p => (p.weeks || []).forEach(w => {
    const l = w.labores || {};
    ATENCION_DEF.forEach(d => {
      const v = l[d.key];
      (Array.isArray(v) ? v : [v]).forEach(id => marcarOcupadoAtencion(String(w.saturday), id));
    });
  }));
  // También sumar atencion de entre semana (guardada en midweeks).
  midweeks.forEach(mw => {
    const sat = addDays(mw.id, 5);
    const l = mw.labores || {};
    ATENCION_DEF.forEach(d => {
      const v = l[d.key];
      (Array.isArray(v) ? v : [v]).forEach(id => marcarOcupadoAtencion(String(sat), id));
    });
  });

  months.forEach(m => (m.weeks || []).forEach(w => {
    const sat = String(w.date);
    // Ocupados por salidas esta semana (solo para decidir conductor).
    const ocupSal = new Set(ocupadosSalidas[sat] || []);
    // Ocupados por atencion esta semana (para E2 en resto de cargos).
    const ocupAte = new Set(ocupadosAtencion[sat] || []);
    // Conjunto combinado para E2 general.
    const ocup = new Set([...ocupSal, ...ocupAte]);

    // Registrar lo ya asignado (E4) y ocupar la semana.
    camposFinSemana(w).forEach(({ campo }) => {
      const id = w[campo];
      if (id) { (cargoMes[String(id)] ||= new Set()).add(campo); ocup.add(String(id)); }
    });

    // CONDUCTOR: siempre el permanente, salvo que ÉSTE esté en SALIDAS ese sábado.
    // Prioridad: permanente → suplente → 2º suplente. Solo estos 3 pueden conducir;
    // si todos están en salidas ese fin de semana, el puesto queda vacío.
    // La designación manual del usuario es la autoridad: no se exige labor conductor1
    // ni lo bloquea la acomodación; SOLO lo bloquea una salida (oradorSalida) ese día.
    if (!w.conductor && (permId || backupId || backupId2)) {
      const permOcupadoEnSalidas = permId && ocupSal.has(permId);
      const orden = permOcupadoEnSalidas
        ? [backupId, backupId2, permId].filter(Boolean)
        : [permId, backupId, backupId2].filter(Boolean);
      const buscar = (id) => {
        if (!id) return null;
        const persona = people.find(x => String(x.id) === String(id));
        if (!persona) return null;
        if (ocupSal.has(String(id))) return null;
        if (String(w.presidente || '') === String(id)) return null;
        return persona;
      };
      const p = buscar(orden[0]) || buscar(orden[1]) || buscar(orden[2]);
      if (p) {
        w.conductor = p.id;
        (cargoMes[String(p.id)] ||= new Set()).add('conductor');
        ocup.add(String(p.id));
        reporte.asignados++;
      }
    }

    // Rellenar solo campos vacíos (el conductor ya se resolvió).
    // El conductor permanente queda ocupado para el resto de cargos (E2).
    // Si se designaron conductores, el puesto conductor no se rellena genéricamente:
    // solo el permanente/suplentes pueden ocuparlo (caso excepcional → queda vacío).
    camposFinSemana(w).forEach(({ campo, labore }) => {
      if (w[campo]) return;
      if (campo === 'conductor' && (permId || backupId || backupId2)) return;
      let cands = peopleForLabore(people, labore).filter(p => isEligibleV2(p, labore, { restricciones, excepciones, capacidades }).eligible);
      const p = cands
        .filter(x => !ocup.has(String(x.id)) && !((cargoMes[String(x.id)] || new Set()).has(campo)))
        .sort((a, b) => (cargoMes[String(a.id)] || new Set()).size - (cargoMes[String(b.id)] || new Set()).size)[0];
      if (!p) { reporte.vacios.push({ semana: sat, labore: campo }); return; }
      w[campo] = p.id;
      (cargoMes[String(p.id)] ||= new Set()).add(campo);
      ocup.add(String(p.id));
      reporte.asignados++;
    });
  }));
  return reporte;
}

/* ---------- Historial de asignaciones ---------- */

// Extrae todas las asignaciones actuales de los programas en entradas de
// historial. Cada entrada: { id, personId, name, date, program, roleKey, roleLabel }.
//  · program: 'entre' (reunión de entre semana) | 'fin' (fin de semana)
//  ·          | 'salidas' | 'atencion' (acomodación)
//  · date: fecha de la semana (lunes para entre semana, sábado para el resto).
//  · id: compuesto persona+fecha+programa+puesto → re-sincronizar no duplica.
export function extractAssignments(midweeks, months, salidas, atencion, people = []) {
  const out = [];
  const nameOf = (id) => (people.find(p => String(p.id) === String(id)) || {}).name || '';
  const push = (personId, date, program, roleKey, roleLabel) => {
    if (!personId) return;
    const pid = String(personId);
    out.push({ id: `${pid}_${date}_${program}_${roleKey}`, personId: pid, name: nameOf(pid), date, program, roleKey, roleLabel });
  };
  (midweeks || []).forEach(w => {
    const date = String(w.id);
    const pres = asId(w.presidente);
    if (pres) push(pres, date, 'entre', 'presidente', 'Presidente');
    (w.sections || []).forEach((sec, si) => (sec.parts || []).forEach(p => {
      midweekSlotsOf(sec, p).forEach(slot => {
        const id = asId((p.assignments || {})[slot.key]);
        if (id) push(id, date, 'entre', slot.labore, slot.label);
      });
    }));
    // Labores de la reunión de entre semana (week.labores, gestionadas en acomodación).
    const l = w.labores || {};
    ATENCION_DEF.forEach(d => {
      const v = l[d.key];
      (Array.isArray(v) ? v : [v]).forEach((id, si) => {
        const pid = asId(id);
        if (pid) push(pid, addDays(w.id, 5), 'atencion', `atencion_${d.key}_${si}`, `${d.label}${d.count > 1 ? ` ${si + 1}` : ''}`);
      });
    });
  });
  (months || []).forEach(m => (m.weeks || []).forEach(w => {
    const date = String(w.date);
    camposFinSemana(w).forEach(({ campo, labore }) => {
      const v = asId(w[campo]);
      if (v) push(v, date, 'fin', labore, labelOf(campo));
    });
  }));
  (salidas || []).forEach(p => (p.weeks || []).forEach(w => {
    if (w.sinSalida) return;
    (w.outings || []).forEach(o => {
      const v = asId(o.oradorSalida);
      if (v) push(v, String(w.saturday), 'salidas', 'salida', 'Orador de salida');
    });
  }));
  (atencion || []).forEach(p => (p.weeks || []).forEach(w => {
    const l = w.labores || {};
    ATENCION_DEF.forEach(d => {
      const v = l[d.key];
      (Array.isArray(v) ? v : [v]).forEach((id, si) => {
        const pid = asId(id);
        if (pid) push(pid, String(w.saturday), 'atencion', `atencion_${d.key}_${si}`, `${d.label}${d.count > 1 ? ` ${si + 1}` : ''}`);
      });
    });
  }));
  return out;
}

// Clave de labor usada para comparar con `roleKey` de las entradas. Las labores
// de atencion (audio/micrófono/plataforma/acomodador) se agrupan bajo 'atencion_'.
function laboreKeyForLabore(rid) {
  return ATENCION_ROLES.includes(rid) ? 'atencion_' : rid;
}

// Métricas por persona a partir del historial: total, último mes (últimos 30
// días), promedio por mes, labores que puede dar pero no le han tocado y fecha de
// la última asignación. `now` se inyecta para poder probarlo.
export function assignmentMetrics(entries, people, labores, now = new Date()) {
  const nowIso = isoDate(now);
  const cutoff = String(addDays(nowIso, -30));
  const byPerson = {};
  (entries || []).forEach(e => { (byPerson[e.personId] ||= []).push(e); });
  const seenLabores = new Set(labores && labores.map(r => r.id));
  return people.map(p => {
    const list = byPerson[String(p.id)] || [];
    const dates = list.map(e => e.date).filter(Boolean);
    const months = new Set(dates.map(d => String(d).slice(0, 7)));
    const lastMonth = list.filter(e => e.date >= cutoff).length;
    const rolesOf = (Array.isArray(p.labores) && p.labores.length) ? p.labores : [];
    const seenKeys = new Set(list.map(e => e.roleKey.startsWith('atencion_') ? 'atencion_' : e.roleKey));
    const canGiveButNot = rolesOf.filter(r => seenLabores.has(r) && !seenKeys.has(laboreKeyForLabore(r)));
    const lastDate = dates.length ? dates.reduce((a, b) => (a > b ? a : b), '') : '';
    return {
      personId: String(p.id),
      name: p.name,
      total: list.length,
      lastMonth,
      perMonth: months.size ? list.length / months.size : 0,
      months: months.size,
      canGiveButNot,
      lastDate,
    };
  });
}

/* ================================================================== */
/* ETAPA 2-8: MOTOR CONFIGURABLE + PROPUESTAS + SCORING + GRÁFICOS     */
/* Envuelve las funciones automatizar* existentes sin modificarlas,    */
/* respetando assignmentConfig / assignmentScoringConfig.              */
/* ================================================================== */

// PRNG determinístico (mulberry32): misma seed → misma secuencia, para que la
// generación de propuestas sea reproducible.
export function mulberry32(seed) {
  let a = (seed >>> 0);
  return function () {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Devuelve la lista de personas rotada según un seed determinístico. Se usa para
// generar propuestas alternativas (mismo conjunto, orden de prioridad distinto).
export function rotateSeed(people, seed, rnd = null) {
  const rand = rnd || mulberry32(seed);
  const out = (people || []).slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ¿Cuántos candidatos válidos existen para una labor? `people` filtrados por
// tener la labor (o sin labores definidas). Usado para detectar escasez.
export function countCandidatesForLabore(people, labore) {
  return peopleForLabore(people, labore).length;
}

// Índice 0-1 de escasez de una labor: 1 = muy escasa (≤1 candidato), 0 = abundante
// (≥ threshold). `threshold` configura desde cuántos se considera "abundante".
export function scarcityIndex(people, labore, threshold = 4) {
  const n = countCandidatesForLabore(people, labore);
  if (n <= 1) return 1;
  if (n >= threshold) return 0;
  return (threshold - n) / (threshold - 1);
}

// Total de puestos de una reunión de entre semana (presidente + slots).
export function midweekTotalSlots(midweek) {
  let n = 1; // presidente
  (midweek.sections || []).forEach(sec => (sec.parts || []).forEach(p => { n += midweekSlotsOf(sec, p).length; }));
  return n;
}

// Clona en profundidad los datos de entrada (structuredClone disponible en Node 17+ y navegadores modernos).
function deepClone(x) {
  return typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x));
}

// Genera UNA propuesta de programa mensual completa. Rota el orden de candidatos
// (seed) para diversificar, ejecuta los motores existentes sobre datos clonados y
// devuelve la solución con sus asignaciones y reportes.
// `input`: { people, midweeks, months, salidas, atencion, historial, nombres }
export function generateOneProposal(input, config = {}, seed = 1) {
  const people = rotateSeed(input.people || [], seed);
  const config4 = { ...defaultAlgorithmConfig(), ...(config || {}) };
  const historial = input.historial || [];
  const nombres = input.nombres || {};

  // Datos del mes (ya en formato de asignación {id,src,locked}): se conserva lo
  // manual/bloqueado y lo nuevo se marca AUTO.
  const programs = {
    midweeks: input.midweeks || [],
    months: input.months || [],
    salidas: input.salidas || [],
    atencion: input.atencion || [],
  };
  const salidas = runEngine(people, programs, {
    scope: 'all',
    restricciones: input.restricciones || [],
    excepciones: input.excepciones || [],
    capacidades: input.capacidades || [],
    entreOpts: { historial, nombres, readerLevel: config4.studentReaderLevel },
    finOpts: {
      permanentConductorId: config4.permanentConductorId,
      permanentConductorBackupId: config4.permanentConductorBackupId,
      permanentConductorBackupId2: config4.permanentConductorBackupId2,
    },
    atencionOpts: { serviceRolesOnlyMale: config4.serviceRolesOnlyMale },
  });

  const assignments = extractAssignments(salidas.midweeks, salidas.months, salidas.salidas, salidas.atencion, input.people);
  const balance = balanceReport(assignments, input.people);
  return { seed, assignments, ...salidas, reportes: salidas.reportes, balance };
}

// Puntúa una solución 0-100 según assignmentScoringConfig y la configuración del
// motor. Devuelve { score, breakdown, warnings, valida }.
export function scoreSolution(assignments, { people = [], config = {}, scoring = null } = {}) {
  const cfg = { ...defaultAlgorithmConfig(), ...(config || {}) };
  const sc = { ...defaultScoringConfig(), ...(scoring || {}) };
  const byPerson = {};
  (assignments || []).forEach(a => { (byPerson[a.personId] ||= []).push(a); });

  const maxSame = Number(cfg.maxSameAssignmentPerMonth) || 1;
  const restriccion = {
    superaMaximo: [],
    mezclaProhibida: [],
    mujeresEnServicio: [],
  };

  (assignments || []).forEach(a => {
    // Mujeres solo en asignaciones estudiantiles/escenificaciones.
    const p = people.find(x => String(x.id) === String(a.personId));
    if (p && p.genero === 'femenino') {
      const laborEstudiantil = STUDENT_LABORES.includes(a.roleKey);
      const esAtencion = String(a.roleKey).startsWith('atencion_');
      if (!laborEstudiantil && (esAtencion || ['presidente', 'presidenteFin', 'conductor2', 'lector2', 'orador', 'salida', 'conductor1', 'lector1'].includes(a.roleKey))) {
        restriccion.mujeresEnServicio.push(`${p.name || a.personId} → ${a.roleLabel || a.roleKey}`);
      }
    }
    // Mujeres NO en labores de servicio (audio/micrófono/plataforma/acomodador).
    if (p && p.genero === 'femenino' && cfg.serviceRolesOnlyMale && String(a.roleKey).startsWith('atencion_')) {
      restriccion.mujeresEnServicio.push(`${p.name || a.personId} → ${a.roleLabel || a.roleKey}`);
    }
  });

  // Repetición de la misma labor en el mes por persona.
  // Excepción 1: el conductor designado (permanente/suplentes) repite el cargo de
  // fin de semana de forma intencional → se excluye del conteo de repeticiones.
  // Excepción 2: los publicadores pueden repetir labores de servicio
  // (acomodación: audio/micrófono/plataforma) durante el mes → no cuentan como
  // repetición (sin alerta ni penalización en el puntaje).
  // Excepción 3: la misma labor en programas distintos (entre semana vs fin de
  // semana) son labores diferentes → no se consideran repetición entre sí.
  const conductoresDesignados = [cfg.permanentConductorId, cfg.permanentConductorBackupId, cfg.permanentConductorBackupId2]
    .filter(Boolean).map(String);
  const countsKey = {};
  (assignments || []).forEach(a => {
    const k = `${a.personId}|${a.program || ''}|${a.roleKey}`;
    if (a.roleKey === 'conductor1' && conductoresDesignados.includes(String(a.personId))) return;
    const p = people.find(x => String(x.id) === String(a.personId));
    if (p && esPublicador(p) && String(a.roleKey).startsWith('atencion_')) return;
    countsKey[k] = (countsKey[k] || 0) + 1;
  });
  Object.entries(countsKey).forEach(([k, n]) => {
    if (n > maxSame) {
      const [pid, role] = k.split('|');
      const muestra = assignments.find(x => String(x.personId) === pid && String(x.roleKey) === role);
      const nombre = (muestra && (muestra.name || pid)) || pid;
      const labore = (muestra && (muestra.roleLabel || role)) || role;
      restriccion.superaMaximo.push(`${nombre} — ${labore} (${n})`);
    }
  });

  let valida = !restriccion.superaMaximo.length && !restriccion.mujeresEnServicio.length && !restriccion.mezclaProhibida.length;

  // breakdown por dimensión (0-100 cada una)
  const totalAsig = (assignments || []).length;
  const personasActivas = people.length;
  const participantes = Object.keys(byPerson).length;
  const means = Object.values(byPerson).map(l => l.length);
  const mean = means.length ? means.reduce((a, b) => a + b, 0) / means.length : 0;
  const variance = means.length ? means.reduce((a, b) => a + (b - mean) ** 2, 0) / means.length : 0;
  const std = Math.sqrt(variance);

  // workloadBalance: 100 - desviación de la carga ideal (uniforme).
  const workloadBalance = Math.max(0, 100 - (std * 12));

  // weeklyBalance: qué tan repartidas están las asignaciones por semana.
  const byWeek = {};
  (assignments || []).forEach(a => { byWeek[a.date] = (byWeek[a.date] || 0) + 1; });
  const weekCounts = Object.values(byWeek);
  const wvariance = weekCounts.length ? weekCounts.reduce((a, b) => a + (b - (totalAsig / Math.max(1, weekCounts.length))) ** 2, 0) / weekCounts.length : 0;
  const weeklyBalance = Math.max(0, 100 - (Math.sqrt(wvariance) * 18));

  // roleRotation: penaliza repetir la misma labor en el mes (respecto al límite).
  const extraRepeticiones = Object.values(countsKey).reduce((a, n) => a + Math.max(0, n - 1), 0);
  const roleRotation = Math.max(0, 100 - (extraRepeticiones * 12));

  // monthlyRepetition: cuánta gente no fue usada vs el ideal.
  const sinParticipar = Math.max(0, personasActivas - participantes);
  const monthlyRepetition = Math.max(0, 100 - (sinParticipar * 8));

  // scarceRoleProtection: si una labor escasa se repite mucho, penaliza menos al
  // protegger (los escasos se espera repitan).
  // pairRoleBalance: alternancia encargado/ayudante en presentaciones (asignacion2).
  const pairMap = {};
  (assignments || []).forEach(a => {
    if (a.roleKey === 'asignacion2') { (pairMap[a.personId] ||= []).push(a.roleLabel || ''); }
  });
  let pairBalance = 100;
  if (Object.keys(pairMap).length) {
    const imbalances = Object.values(pairMap).map(list => {
      const enc = list.filter(r => /encargado|estudiante/i.test(r)).length;
      const ayu = list.filter(r => /ayudante/i.test(r)).length;
      return list.length ? Math.abs(enc - ayu) / list.length : 0;
    });
    pairBalance = Math.max(0, 100 - (imbalances.reduce((a, b) => a + b, 0) / imbalances.length) * 100 * 0.6);
  }

  // scarceRoleProtection: se calcula como el nivel medio de escasez de las labores
  // asignadas; penaliza soluciones que no dejen margen en labores con pocos
  // candidatos. `people` con genero se usan solo para detectar escasez real.
  const scarceRoles = (cfg.scarceRoles || []).map(String);
  let scarceRoleProtection = 100;
  if (scarceRoles.length) {
    const nEscasasAsignadas = (assignments || []).filter(a => scarceRoles.includes(String(a.roleKey))).length;
    scarceRoleProtection = Math.max(0, 100 - (nEscasasAsignadas * 6));
  }

  const breakdown = {
    workloadBalance: Math.round(workloadBalance),
    roleRotation: Math.round(roleRotation),
    weeklyBalance: Math.round(weeklyBalance),
    monthlyRepetition: Math.round(monthlyRepetition),
    pairRoleBalance: Math.round(pairBalance),
    scarceRoleProtection: Math.round(scarceRoleProtection),
    studentOpportunityBalance: 100,
  };

  const pesoTotal = sc.workloadBalance + sc.roleRotation + sc.weeklyBalance + sc.monthlyRepetition + sc.scarceRoleProtection + sc.pairRoleBalance + (sc.studentOpportunityBalance || 0);
  const score = (breakdown.workloadBalance * sc.workloadBalance
    + breakdown.roleRotation * sc.roleRotation
    + breakdown.weeklyBalance * sc.weeklyBalance
    + breakdown.monthlyRepetition * sc.monthlyRepetition
    + breakdown.scarceRoleProtection * sc.scarceRoleProtection
    + breakdown.pairRoleBalance * sc.pairRoleBalance
    + breakdown.studentOpportunityBalance * (sc.studentOpportunityBalance || 0)
  ) / (pesoTotal || 1);

  const warnings = [];
  if (restriccion.superaMaximo.length) warnings.push(`Se supera el máximo de repetición mensual (${maxSame}) en: ${restriccion.superaMaximo.slice(0, 5).join(', ')}.`);
  if (restriccion.mujeresEnServicio.length) warnings.push(`Asignaciones de mujeres en labores no estudiantiles: ${restriccion.mujeresEnServicio.slice(0, 5).join(', ')}.`);
  if (sinParticipar > 0) warnings.push(`${sinParticipar} persona(s) sin participación en el mes.`);

  return { score: Math.round(score * 10) / 10, breakdown, warnings, valida, restricciones: restriccion };
}

// Elimina propuestas "diferenciadas": se conserva la primera que contiene cada
// patrón; el resto se deduplica usando una huella de asignaciones.
function fingerprint(sol) {
  return (sol.assignments || []).map(a => `${a.personId}:${a.date}:${a.roleKey}`).sort().join('|');
}

// Genera `n` propuestas distintas (semillas distintas), las puntúa y las ordena.
// Devuelve [{ seed, score, breakdown, warnings, valida, assignments }] (las N mejores).
export function generateProposals(input, config = {}, scoring = null, n = null) {
  const cfg = { ...defaultAlgorithmConfig(), ...(config || {}) };
  const cant = n || Number(cfg.numberOfProposals) || 3;
  const sols = [];
  const vistos = new Set();
  for (let seed = 1; seed <= cant * 4; seed++) {
    const sol = generateOneProposal(input, cfg, seed);
    const fp = fingerprint(sol);
    if (vistos.has(fp)) continue;
    vistos.add(fp);
    const scored = scoreSolution(sol.assignments, { people: input.people, config: cfg, scoring });
    sols.push({ seed, score: scored.score, breakdown: scored.breakdown, warnings: scored.warnings, valida: scored.valida, restricciones: scored.restricciones, assignments: sol.assignments, midweeks: sol.midweeks, months: sol.months, salidas: sol.salidas, atencion: sol.atencion, reportes: sol.reportes, balance: sol.balance });
    if (sols.length >= Math.max(4, cant)) break;
  }
  sols.sort((a, b) => b.score - a.score);
  return sols.slice(0, cant);
}

/* ============ HELPERS DE GRÁFICOS (vista algoritmo) ============ */

// Carga por persona (total de asignaciones actuales + histograma).
export function workloadByPerson(entries, people = []) {
  const mapa = {};
  (entries || []).forEach(e => { mapa[e.personId] = (mapa[e.personId] || 0) + 1; });
  return people.map(p => ({
    personId: String(p.id),
    name: p.name || '',
    count: mapa[String(p.id)] || 0,
  })).sort((a, b) => b.count - a.count);
}

// Serie temporal mensual: [{ month: "YYYY-MM", total }] (para gráfico de líneas).
export function historyTimeline(entries) {
  const mapa = {};
  (entries || []).forEach(e => {
    const m = String(e.date || '').slice(0, 7);
    if (m) mapa[m] = (mapa[m] || 0) + 1;
  });
  return Object.keys(mapa).sort().map(m => ({ month: m, total: mapa[m] }));
}

// Distribución por labor/rol: [{ labore, label, total }].
export function distributionByLabore(entries) {
  const mapa = {};
  (entries || []).forEach(e => {
    const key = String(e.roleKey || '');
    const agrupada = key.startsWith('atencion_') ? 'atencion_' : key;
    (mapa[agrupada] ||= { labore: agrupada, label: e.roleLabel || agrupada, total: 0 }).total++;
  });
  return Object.values(mapa).sort((a, b) => b.total - a.total);
}

// Estadísticas encargado/ayudante en presentaciones (asignacion2) por persona.
// Detecta encargado por el label del slot ('Estudiante' o 'Ayudante' de maestros).
export function pairRoleStats(entries) {
  const mapa = {};
  (entries || []).forEach(e => {
    if (e.roleKey !== 'asignacion2') return;
    (mapa[e.personId] ||= { personId: e.personId, name: e.name || '', encargado: 0, ayudante: 0 });
    if (/ayudante/i.test(String(e.roleLabel || ''))) mapa[e.personId].ayudante++;
    else mapa[e.personId].encargado++;
  });
  return Object.values(mapa).sort((a, b) => (b.encargado + b.ayudante) - (a.encargado + a.ayudante));
}

// Registro de equilibrio segmentado por cargo y género. Devuelve los contadores
// que permiten balancear las asignaciones del mes:
//  · ancianosEnReunion:  nº de asignaciones de ancianos en las reuniones (entre+fin)
//  · ministerialesEnReunion
//  · publicadoresEnReunion
//  · publicadoresEnServicio
//  · ancianosEnServicio / ministerialesEnServicio
//  · mujeresEnPresentaciones
//  · sinParticipar: personas activas sin ninguna asignación en el mes.
// Cada contador acumula el nº de personas DISTINTAS (no de asignaciones) para
// ver cuánta gente de cada segmento participó.
export function balanceReport(assignments, people = []) {
  const r = { ancianosEnReunion: 0, ministerialesEnReunion: 0, publicadoresEnReunion: 0, publicadoresEnServicio: 0, ancianosEnServicio: 0, ministerialesEnServicio: 0, mujeresEnPresentaciones: 0, sinParticipar: 0 };
  const byPerson = {};
  (assignments || []).forEach(a => { (byPerson[String(a.personId)] ||= []).push(a); });
  const idOf = (p) => String(p.id);
  people.forEach(p => {
    const lista = byPerson[idOf(p)] || [];
    if (!lista.length) { r.sinParticipar++; return; }
    const nivel = cargoNivel(p);
    const enReunion = lista.some(a => a.program === 'entre' || a.program === 'fin');
    const enServicio = lista.some(a => a.program === 'atencion');
    const enPresentacion = lista.some(a => a.roleKey === 'asignacion2');
    if (nivel === 1) { if (enReunion) r.publicadoresEnReunion++; if (enServicio) r.publicadoresEnServicio++; }
    else if (nivel === 2) { if (enReunion) r.ministerialesEnReunion++; if (enServicio) r.ministerialesEnServicio++; }
    else { if (enReunion) r.ancianosEnReunion++; if (enServicio) r.ancianosEnServicio++; }
    if (p.genero === 'femenino' && enPresentacion) r.mujeresEnPresentaciones++;
  });
  return r;
}
