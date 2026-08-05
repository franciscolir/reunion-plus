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
  conductor:         'conductor',
  lector:            'lector',
  estudioSinLectura: 'conductor',
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
  return out;
}

export function labelOf(f) { return FIELD_LABELS[f] || f; }

// Etiqueta legible de un "key" de asignación (para mensajes de error).
export function labelOfKey(key) {
  if (key.startsWith('salida_')) return `orador de salida ${parseInt(key.slice(7), 10) + 1}`;
  return labelOf(key);
}

// Validación: missing + duplicates (intra-semana, reunión principal + salidas).
export function computeConflicts(month) {
  const perWeek = month.weeks.map(() => ({ duplicates: [], missing: [], outingDuplicates: [] }));
  const errors = [];
  month.weeks.forEach((w, i) => {
    let required = [];
    if (w.type === 'normal') {
      required = ['presidente', 'tituloDiscurso', 'orador', 'conductor', 'lector', 'departamento'];
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

export function weekComplete(w) {
  const c = computeConflicts({ weeks: [w] }).perWeek[0];
  return c.missing.length === 0 && c.duplicates.length === 0 && c.outingDuplicates.length === 0;
}

export function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
export function capField(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

export function escapeAttr(s) {
  return String(s ?? '').replace(/["'<>]/g, c => ({ '"':'&quot;',"'":'&#39;','<':'&lt;','>':'&gt;' }[c]));
}

export function cryptoId() { return 'w_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
