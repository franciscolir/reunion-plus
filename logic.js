// logic.js - Funciones puras de Reunión+ (sin DOM, testeables en Node)
// Exportadas para que app.js las importe y tests.js las verifique.

export const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

export const WEEK_TYPES = {
  normal:       { label: 'Normal',               icon: 'calendar_today' },
  supervisor:   { label: 'Visita Superintendente',icon: 'verified' },
  assembly:     { label: 'Asamblea',              icon: 'event_busy' },
  commemoration:{ label: 'Conmemoración',         icon: 'stars' },
};

// Mapea el nombre interno del campo al rol de la lista de personas.
// Si un campo no está aquí (ej. orador de reunión normal), es texto libre.
export const FIELD_ROLE = {
  presidente:        'presidente',
  conductor:         'conductor1',   // Conductor Atalaya (fin de semana)
  lector:            'lector1',      // Lector Atalaya (fin de semana)
  estudioSinLectura: 'conductor1',
  oradorSalida:      'orador',
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
export function eventTypeForDate(events, iso) {
  if (!events) return 'normal';
  const inRange = (from, to) => from && to && iso >= from && iso <= to;
  const visitFrom = (v) => v.from || (v.date ? v.date : null);
  const visitTo = (v) => v.to || v.from || (v.date ? v.date : null);
  if ((events.commemorations || []).some(d => d === iso)) return 'commemoration';
  if ((events.visits || []).some(v => inRange(visitFrom(v), visitTo(v)))) return 'supervisor';
  if ((events.assemblies || []).some(a => {
    if (a.from && a.to) return inRange(a.from, a.to);
    const days = Number(a.days) || 1;
    return inRange(a.date, addDays(a.date, days - 1));
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
// roles de la reunión principal + oradores de salidas. Devuelve
// [{ value: '<id>', key: 'presidente' | 'conductor' | 'lector' | 'estudioSinLectura' | 'salida_0' | ... }]
// 'orador' (texto libre) NO se incluye porque no es un ID de persona.
export function collectWeekPersons(w) {
  const out = [];
  const mainFields = [];
  if (w.type === 'normal') mainFields.push('presidente', 'conductor', 'lector');
  else if (w.type === 'supervisor') mainFields.push('presidente', 'estudioSinLectura');
  else if (w.type === 'commemoration') mainFields.push('presidente');
  for (const f of mainFields) {
    const v = w[f];
    if (v) out.push({ value: String(v), key: f });
  }
  if (Array.isArray(w.outings)) {
    w.outings.forEach((o, j) => {
      const v = o.oradorSalida;
      if (v) out.push({ value: String(v), key: `salida_${j}` });
    });
  }
  // Labores tras bambalinas: también cuentan para no repetir a una persona
  // dentro de la misma reunión de fin de semana.
  collectLaboresPersons(w.labores).forEach(x => out.push(x));
  return out;
}

// Labores operativas (tras bambalinas) que también cuentan para detectar
// personas duplicadas dentro de una reunión. Fuente única de verdad: el editor
// (app.js) y la validación (aquí) usan esta misma definición.
export const LABORES_DEF = [
  { key: 'acomodacion', label: 'Acomodación', icon: 'weekend', count: 2 },
  { key: 'microfono',   label: 'Micrófono',   icon: 'mic', count: 2 },
  { key: 'plataforma',  label: 'Plataforma',  icon: 'grid_on', count: 1 },
  { key: 'sonido',      label: 'Sonido',      icon: 'volume_up', count: 1 },
];

// Roles considerados de atención (sostienen la reunión). Filtran quién aparece
// en los selectores de labores, igual que el resto de filtros por rol.
export const LABORE_ROLES = [
  'audio', 'microf', 'plataforma', 'acomodador',
];

// ¿La persona puede asignarse a labores? Sin roles (datos antiguos) se incluye,
// igual que hacen el resto de selectores filtrados por rol.
export function isLaborePerson(p) {
  return !Array.isArray(p?.roles) || p.roles.length === 0 || p.roles.some(r => LABORE_ROLES.includes(r));
}

// Recolecta las personas asignadas a labores → [{value, key}].
// key: "labores_<clave>_<slotIdx>".
export function collectLaboresPersons(labores) {
  const out = [];
  const l = labores || {};
  for (const d of LABORES_DEF) {
    const v = l[d.key];
    const values = Array.isArray(v) ? v : [v];
    for (let si = 0; si < d.count; si++) {
      const id = values[si];
      if (id) out.push({ value: String(id), key: `labores_${d.key}_${si}` });
    }
  }
  return out;
}

// Recolecta TODAS las personas de una reunión de entresemana:
// todos los "pads" con asignación en todas las secciones + labores.
// key: "mw_<si>_<num>_<slot>" (si=sección, num=nº de parte, slot=rol).
export function collectMidweekPersons(week) {
  const out = [];
  if (week.presidente) out.push({ value: String(week.presidente), key: 'mw_presidente' });
  (week.sections || []).forEach((sec, si) => {
    (sec.parts || []).forEach(p => {
      const ap = p.assignments || {};
      Object.entries(ap).forEach(([slot, id]) => {
        if (id) out.push({ value: String(id), key: `mw_${si}_${p.num}_${slot}`, sectionTitle: sec.title, partNum: p.num, slot });
      });
    });
  });
  collectLaboresPersons(week.labores).forEach(x => out.push(x));
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

// Ids de personas ya asignadas en la semana (reunión + salidas + labores).
// Para entre semana se pasa el colector collectMidweekPersons.
export function assignedIds(week, collector) {
  return new Set((collector || collectWeekPersons)(week).map(x => x.value));
}

// Personas elegibles para un puesto: deben cumplir el rol/predicado y NO estar ya
// asignadas en la misma semana, salvo la que ya ocupa ese puesto (currentId).
// `role` puede ser un id de rol o una función predicado (p.ej. isLaborePerson).
export function eligiblePeople(week, people, role, currentId, collector) {
  const assigned = assignedIds(week, collector);
  const match = typeof role === 'function'
    ? role
    : (role ? (p) => !Array.isArray(p.roles) || p.roles.length === 0 || p.roles.includes(role) : () => true);
  return people.filter(p => match(p) && (!assigned.has(String(p.id)) || String(p.id) === String(currentId)));
}

export function labelOf(f) { return FIELD_LABELS[f] || f; }

// Etiqueta legible de un "key" de asignación (para mensajes de error).
export function labelOfKey(key) {
  if (key.startsWith('salida_')) return `orador de salida ${parseInt(key.slice(7), 10) + 1}`;
  if (key.startsWith('labores_')) {
    const m = key.match(/^labores_(\w+)_(\d+)$/);
    if (m) {
      const d = LABORES_DEF.find(x => x.key === m[1]);
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
      if (v === '' || v === undefined || v === null) {
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
// misma reunión (todos los pads + labores). Devuelve { dupKeys, errors }.
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

/* ---------- Conversión de texto extraído de PDF (carga de archivos) ---------- */
// Los PDF de la JW (Guía de Actividades, lista de discursos, etc.) separan los
// caracteres ("6 -1 2 D E J U L I O"). Estas funciones convierten el texto
// extraído a la estructura de datos de la app.

// Convierte el texto extraído según el tipo. Devuelve { data, warnings }.
export function convertPdfToData(type, text) {
  if (type === 'talks') return convertPdfTalks(text);
  if (type === 'midweeks') return convertPdfMidweeks(text);
  if (type === 'people') return convertPdfPeople(text);
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

export function convertPdfPeople(text) {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
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

// Convierte el texto de la Guía de Actividades en semanas. Detecta la cabecera
// de cada semana (rango + mes), su lectura y crea la estructura de secciones
// (Tesoros / Mejores Maestros / Vida Cristiana) lista para completar en el editor.
// El texto del PDF separa caracteres y fragmenta las partes en varias líneas,
// por eso la lectura se reconstruye de forma compacta y los detalles de las
// partes quedan para revisar/editar.
export function convertPdfMidweeks(text) {
  const months = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  const clean = (s) => String(s).replace(/[\u0002\u0003]/g, ' ').replace(/\s+/g, ' ').trim();
  const compact = (s) => String(s).replace(/[\s\u0002\u0003´`]/g, '');
  const lines = text.split('\n').map(clean).filter(Boolean);

  const headerOf = (c) => {
    const monthRe = months.map(m => m).join('|');
    const m = c.match(new RegExp(`^(\\d{1,2})-(\\d{1,2})DE(${monthRe})(.*)$`, 'i'));
    if (!m) return null;
    const mt = months.indexOf(m[3].toUpperCase());
    if (mt < 0) return null;
    return { header: `${m[1]}-${m[2]} DE ${months[mt]}`, rest: m[4] };
  };

  // Da una forma legible a la lectura compacta. Ej: "JEREMIAS13-15" → "JEREMIAS 13-15".
  const tidyReading = (s) => {
    s = String(s || '').replace(/[´`]/g, '');
    s = s.replace(/(\d{1,2})\s*[-–]\s*(\d{1,2})/g, (m, a, b) => `${a}-${b}`);
    s = s.replace(/([A-Za-zÁÉÍÓÚÑáéíóúñ])(\d)/g, '$1 $2');
    return s.replace(/^(\d+)/, '$1 ').trim();
  };

  const newWeek = (header) => ({
    header,
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

  // La lectura termina en la primera sección o canción que aparece tras la cabecera.
  const endOfReading = (buf) => {
    const upper = buf.toUpperCase();
    const cuts = ['TESOROS', 'SEAMOS', 'NUESTRAVIDA', 'CANCI'].map(k => {
      const i = upper.indexOf(k);
      return i === -1 ? Infinity : i;
    });
    return Math.min(...cuts);
  };

  const weeks = [];
  let cur = null;
  let buf = '';
  for (const ln of lines) {
    const c = compact(ln);
    const h = headerOf(c);
    if (h) {
      if (cur) cur.reading = tidyReading(buf.slice(0, endOfReading(buf)));
      cur = newWeek(h.header);
      weeks.push(cur);
      buf = h.rest || '';
      continue;
    }
    if (!cur) continue;
    buf += c;
  }
  if (cur) cur.reading = tidyReading(buf.slice(0, endOfReading(buf)));

  if (!weeks.length) return { data: null, warnings: ['No se detectaron semanas (formato "D-D DE MES"). Revise el texto manualmente.'] };
  // Quitar cabeceras repetidas (el texto del PDF repite la cabecera de cada página).
  const seen = new Set();
  const uniq = weeks.filter(w => { const k = w.header; if (seen.has(k)) return false; seen.add(k); return true; });
  return { data: { weeks: uniq }, warnings: [`Se detectaron ${uniq.length} semanas; complete lecturas y partes en la revisión.`] };
}
