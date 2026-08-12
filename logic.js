// logic.js - Funciones puras de Reunión+ (sin DOM, testeables en Node)
// Exportadas para que app.js las importe y tests.js las verifique.

export const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// Niveles de calificación de los colaboradores (D = requiere enlace de pareja).
export const CALIFICACIONES = ['A', 'B', 'C', 'D'];

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
  'audio', 'microf', 'plataforma', 'acomodador',
];

// ¿La persona puede asignarse a atencion? Sin labores (datos antiguos) se incluye,
// igual que hacen el resto de selectores filtrados por labor.
export function isAtencionPerson(p) {
  return !Array.isArray(p?.labores) || p.labores.length === 0 || p.labores.some(r => ATENCION_ROLES.includes(r));
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
      const id = values[si];
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
  if (week.presidente) out.push({ value: String(week.presidente), key: 'mw_presidente' });
  (week.sections || []).forEach((sec, si) => {
    (sec.parts || []).forEach(p => {
      const ap = p.assignments || {};
      Object.entries(ap).forEach(([slot, id]) => {
        if (id) out.push({ value: String(id), key: `mw_${si}_${p.num}_${slot}`, sectionTitle: sec.title, partNum: p.num, slot });
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
    : (labore ? (p) => !Array.isArray(p.labores) || p.labores.length === 0 || p.labores.includes(labore) : () => true);
  return people.filter(p => match(p) && (!assigned.has(String(p.id)) || String(p.id) === String(currentId)));
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
  // Formato del archivo participantes.json: clave `roles`.
  return { data: { roles }, warnings: ['Roles detectados: ' + (Object.keys(roles).join(', ') || 'revisar')] };
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
  return emitPdfLines(seq);
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
    add(mw.presidente, mes, semana, 'entre', 'presidente', `Presidente · ${header}`);
    (mw.sections || []).forEach((sec, si) => (sec.parts || []).forEach(p => {
      Object.entries(p.assignments || {}).forEach(([slot, id]) => {
        if (!id) return;
        add(id, mes, semana, 'entre', `parte${si}.${p.num}.${slot}`, `${sec.title} · parte ${p.num} (${slot}) · ${header}`);
      });
    }));
    const l = (mw.labores || {});
    ATENCION_DEF.forEach(d => {
      const arr = Array.isArray(l[d.key]) ? l[d.key] : [l[d.key] || ''];
      arr.forEach((id, si) => { if (id) add(id, mes, semana, 'entre', `atencion_${d.key}_${si}`, `${d.label} ${si + 1} (entre semana) · ${header}`); });
    });
  });

  // Fin de semana (programa mensual)
  (context.months || []).forEach(m => (m.weeks || []).forEach(w => {
    if (!/^\d{4}-\d{2}$/.test(String(m.id || ''))) return;
    const mes = m.id;
    const semana = weekSundayOf(w.date);
    const mesTxt = MONTHS_ES[Number(m.month) - 1] || mes;
    ['presidente', 'conductor', 'lector'].forEach(f => {
      if (w[f]) add(w[f], mes, semana, 'fin', f, `${labelOf(f)} · ${mesTxt}`);
    });
  }));

  // Acomodación (atencion del fin de semana)
  const atencion = (context.atencion || context.labores || []);
  atencion.forEach(p => (p.weeks || []).forEach(w => {
    const l = (w.labores || {});
    ATENCION_DEF.forEach(d => {
      const arr = Array.isArray(l[d.key]) ? l[d.key] : [l[d.key] || ''];
      arr.forEach((id, si) => { if (id) add(id, p.id, weekSundayOf(w.saturday), 'acomodacion', `${d.key}_${si}`, `${d.label} ${si + 1} (fin de semana)`); });
    });
  }));

  // Salidas
  (context.salidas || []).forEach(p => (p.weeks || []).forEach((w, wi) => (w.outings || []).forEach((o, oi) => {
    if (o.oradorSalida) add(o.oradorSalida, p.id, weekSundayOf(w.saturday), 'salida', `salida_${wi}_${oi}`, `Orador de salida · semana ${wi + 1}`);
  })));

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
      push(first, 'E3', items.slice(1).map(i => i.detalle));
      return;
    }
    // E4: mismo mes, fin, mismo campo (2 semanas distintas)
    if (items.every(i => i.value + '|' + i.mes + '|' + i.programa + '|' + i.rol === key1) && items[0].programa === 'fin') {
      push(first, 'E4', items.slice(1).map(i => i.detalle));
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
//  · D solo puede pareja con su enlace designado (enlace mutuo).
//  · Mismo género: siempre válido.
//  · Mixto (hombre+mujer): solo si están enlazados entre sí.
//  · Sin género definido: se aplica la tabla de calificaciones A+B · B+B · A+C.
export function canBePair(persona1, persona2) {
  if (!persona1 || !persona2) return false;
  if (String(persona1.id) === String(persona2.id)) return false;

  const cal = (p) => CALIFICACIONES.includes(p.calificacion) ? p.calificacion : '';
  const c1 = cal(persona1), c2 = cal(persona2);

  // Enlace único de D: solo con su pareja enlazada (mutuo).
  if (c1 === 'D' || c2 === 'D') {
    return String(persona1.enlace || '') === String(persona2.id) && String(persona2.enlace || '') === String(persona1.id);
  }

  const g1 = persona1.genero, g2 = persona2.genero;
  // Mismo género: siempre válido.
  if (g1 && g2 && g1 === g2) return true;
  // Mixto: solo si enlazados entre sí.
  if (g1 && g2 && g1 !== g2) {
    return String(persona1.enlace || '') === String(persona2.id) && String(persona2.enlace || '') === String(persona1.id);
  }
  // Sin género y sin calificación registrada: no se puede juzgar, se permite.
  if (!c1 || !c2) return true;
  // Sin género: tabla de calificaciones.
  return PAR_LIMIT.some(([a, b]) => (c1 === a && c2 === b) || (c1 === b && c2 === a));
}

// Labores de estudiantes (lectura + presentaciones + discurso estudiantil).
export const STUDENT_LABORES = ['asignacion1', 'asignacion2', 'asignacion3'];
export function isStudentLabore(labore) { return STUDENT_LABORES.includes(labore); }

// Persona que puede asumir partes de estudiante: sin labores definidas o con
// cualquiera de las labores de estudiante (lectura, presentación, discurso).
export function isStudentPerson(p) {
  return !Array.isArray(p?.labores) || p.labores.length === 0 || p.labores.some(r => STUDENT_LABORES.includes(r));
}

/* ---------- Estructura de partes de entre semana ---------- */
// Devuelve los puestos (slots) de una parte con su rol. Fuente única usada por
// el editor y por el algoritmo de automatización.
export function midweekSlotsOf(sec, part) {
  const secId = sec && sec.id;
  const parts = (sec && sec.parts) || [];
  const idx = parts.indexOf(part);
  if (secId === 'tesoros') {
    // Última parte = Lectura de la Biblia (asignacion1); el resto son discursos (asignacion4).
    if (idx === parts.length - 1) return [{ key: 'lector', label: 'Lector', labore: 'asignacion1' }];
    return [{ key: 'conductor', label: idx === 0 ? 'Discurso' : 'Perlas', labore: 'asignacion4' }];
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
const ROL_NO_ESTUDIANTE = new Set(['asignacion4', 'conductor2', 'lector2']);

/* ---------- Automatización de asignaciones ---------- */
const ORDEN_CAL = ['A', 'B', 'C', 'D'];

// Personas con una labor (o sin labores definidas).
function peopleForLabore(people, labore) {
  return people.filter(p => !Array.isArray(p.labores) || p.labores.length === 0 || p.labores.includes(labore));
}

// Mapa de los campos editables de la reunión de fin de semana según su tipo.
// Solo los campos listados se automatizan (el orador es texto libre/manual).
export function camposFinSemana(w) {
  if (w.type === 'assembly') return [];
  if (w.type === 'commemoration') return [{ campo: 'presidente', labore: 'presidente' }];
  if (w.type === 'supervisor') return [
    { campo: 'presidente', labore: 'presidente' },
    { campo: 'estudioSinLectura', labore: 'conductor1' },
  ];
  return [
    { campo: 'presidente', labore: 'presidente' },
    { campo: 'conductor', labore: 'conductor1' },
    { campo: 'lector', labore: 'lector1' },
  ];
}

// Automatiza la reunión de entre semana de un mes. Muta `midweeks`
// (asigna week.presidente y p.assignments). Devuelve un reporte.
// Orden: presidente → discursos no estudiante → estudiantes (parejas canBePair).
// Reglas: sin repetir la misma parte en el mes (E3), sin duplicar a nadie en la
// misma semana (E2 intra-reunión). Solo rellena puestos vacíos.
// `ocupadosSemana`: opcional, Map sábado -> Set de personas ocupadas esa semana
// (p. ej. acomodación y salidas) que no deben recibir la parte (E1/E2).
export function automatizarEntreSemana(people, midweeks, ocupadosSemana = null, opts = {}) {
  // `opts`: { historial, nombres } — historial: [{ personId, date, roleKey }] de
  // asignaciones pasadas para priorizar a quien participó hace más tiempo.
  const historial = opts.historial || [];
  const nombres = opts.nombres || {};
  const reporte = { asignados: 0, vacios: [], motivos: [], flexiones: [] };
  const rolPorPersona = {}; // personaId -> Set de partes ya usadas en el mes (E3)
  const enSemana = {};      // weekId -> Set de personas ya asignadas esa semana
  const cargaMes = {};      // personaId -> nº de asignaciones en el mes (carga)
  const ultima = {};        // personaId -> fecha ISO de la última asignación histórica

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
    reporte.asignados++;
  };

  // Reglas de elegibilidad (estrictas).
  const elegible = (p, key, weekId) => {
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
    let cand = isStudentLabore(labore) ? people.filter(isStudentPerson) : peopleForLabore(people, labore);
    // Orden de preferencia: calificación (estudiantes) → menor carga mensual →
    // última participación más antigua → nombre (estable).
    cand = cand.slice().sort((a, b) => {
      if (isStudentLabore(labore)) {
        const ca = ORDEN_CAL.indexOf(a.calificacion || '');
        const cb = ORDEN_CAL.indexOf(b.calificacion || '');
        if (ca !== cb) return ca - cb;
      }
      const caA = cargaMes[String(a.id)] || 0, caB = cargaMes[String(b.id)] || 0;
      if (caA !== caB) return caA - caB;
      const uA = ultima[String(a.id)] || '', uB = ultima[String(b.id)] || '';
      if (uA !== uB) return uA < uB ? -1 : 1; // antes = más antigua → primero
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    const filtro = (nivel) => (p) => {
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
    if (week.presidente) (enSemana[weekId] ||= new Set()).add(String(week.presidente));
    (week.sections || []).forEach((sec, si) => (sec.parts || []).forEach(part => {
      const slots = midweekSlotsOf(sec, part);
      slots.forEach(slot => {
        const id = (part.assignments || {})[slot.key];
        if (!id) return;
        const key = `mw_${si}_${part.num}_${slot.key}`;
        (rolPorPersona[String(id)] ||= new Set()).add(key);
        (enSemana[weekId] ||= new Set()).add(String(id));
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
          .slice().sort((a, b) => ORDEN_CAL.indexOf(b.calificacion || '') - ORDEN_CAL.indexOf(a.calificacion || ''));
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
export function automatizarAtencion(people, atencion, midweeks) {
  const reporte = { asignados: 0, vacios: [] };
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
  const laboreMes = new Map(); // personaId -> Set de claves labore usadas en el mes

  // Rellena los puestos vacíos de un objeto atencion `l` para una semana `sat`.
  // `prefijo` separa las claves de FS y ES para que no se bloqueen entre sí en
  // el mes (una persona puede hacer el mismo labore en una reunión distinta).
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
        (laboreMes[String(id)] ||= new Set()).add(`${prefijo}${d.key}_${si}`);
      });
    });
    ATENCION_DEF.forEach(d => {
      const v = l[d.key];
      for (let si = 0; si < d.count; si++) {
        const cur = Array.isArray(v) ? v[si] : (si === 0 ? v : '');
        if (cur) continue;
        const cand = people.filter(isAtencionPerson)
          .find(x => !ocup.has(String(x.id)) && !((laboreMes[String(x.id)] || new Set()).has(`${prefijo}${d.key}_${si}`)));
        if (!cand) { reporte.vacios.push({ semana: sat, labore: `${d.key}_${si}` }); continue; }
        if (Array.isArray(v)) v[si] = cand.id;
        else l[d.key] = cand.id;
        ocup.add(String(cand.id));
        (laboreMes[String(cand.id)] ||= new Set()).add(`${prefijo}${d.key}_${si}`);
        reporte.asignados++;
      }
    });
  };

  // Labores del fin de semana (programa de acomodación).
  atencion.forEach(rec => (rec.weeks || []).forEach(w => {
    rellenar(w.labores || {}, String(w.saturday), ocupMw.get(String(w.saturday)) || [], 'atencion_');
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

// Automatiza la reunión de fin de semana: rellena los campos editables por
// persona (presidente, conductor, lector, estudioSinLectura según el tipo de
// semana) sin repetir a quienes ya están en acomodación o salidas esa semana
// (E2) ni repetir el mismo cargo en el mes (E4). Muta `months`. Devuelve reporte.
export function automatizarFinSemana(people, months, salidas, atencion) {
  const reporte = { asignados: 0, vacios: [] };
  const cargoMes = {}; // personaId -> Set de cargos usados en el mes (E4)
  const ocupados = {}; // saturday -> Set de personas ocupadas (acomodación + salidas)

  const marcarOcupado = (sat, id) => {
    if (id) (ocupados[sat] ||= new Set()).add(String(id));
  };
  salidas.forEach(p => (p.weeks || []).forEach(w => (w.outings || []).forEach(o => marcarOcupado(String(w.saturday), o.oradorSalida))));
  atencion.forEach(p => (p.weeks || []).forEach(w => {
    const l = w.labores || {};
    ATENCION_DEF.forEach(d => {
      const v = l[d.key];
      (Array.isArray(v) ? v : [v]).forEach(id => marcarOcupado(String(w.saturday), id));
    });
  }));

  months.forEach(m => (m.weeks || []).forEach(w => {
    const sat = String(w.date);
    const ocup = new Set(ocupados[sat] || []);
    // Registrar lo ya asignado (E4) y ocupar la semana.
    camposFinSemana(w).forEach(({ campo }) => {
      const id = w[campo];
      if (id) { (cargoMes[String(id)] ||= new Set()).add(campo); ocup.add(String(id)); }
    });
    // Rellenar solo campos vacíos.
    camposFinSemana(w).forEach(({ campo, labore }) => {
      if (w[campo]) return;
      const p = peopleForLabore(people, labore)
        .find(x => !ocup.has(String(x.id)) && !((cargoMes[String(x.id)] || new Set()).has(campo)));
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
    if (w.presidente) push(w.presidente, date, 'entre', 'presidente', 'Presidente');
    (w.sections || []).forEach((sec, si) => (sec.parts || []).forEach(p => {
      midweekSlotsOf(sec, p).forEach(slot => {
        const id = (p.assignments || {})[slot.key];
        if (id) push(id, date, 'entre', slot.labore, slot.label);
      });
    }));
    // Labores de la reunión de entre semana (week.labores, gestionadas en acomodación).
    const l = w.labores || {};
    ATENCION_DEF.forEach(d => {
      const v = l[d.key];
      (Array.isArray(v) ? v : [v]).forEach((id, si) => {
        if (id) push(id, addDays(w.id, 5), 'atencion', `atencion_${d.key}_${si}`, `${d.label}${d.count > 1 ? ` ${si + 1}` : ''}`);
      });
    });
  });
  (months || []).forEach(m => (m.weeks || []).forEach(w => {
    const date = String(w.date);
    camposFinSemana(w).forEach(({ campo, labore }) => {
      if (w[campo]) push(w[campo], date, 'fin', labore, labelOf(campo));
    });
  }));
  (salidas || []).forEach(p => (p.weeks || []).forEach(w => (w.outings || []).forEach(o => {
    if (o.oradorSalida) push(o.oradorSalida, String(w.saturday), 'salidas', 'orador', 'Orador de salida');
  })));
  (atencion || []).forEach(p => (p.weeks || []).forEach(w => {
    const l = w.labores || {};
    ATENCION_DEF.forEach(d => {
      const v = l[d.key];
      (Array.isArray(v) ? v : [v]).forEach((id, si) => {
        if (id) push(id, String(w.saturday), 'atencion', `atencion_${d.key}_${si}`, `${d.label}${d.count > 1 ? ` ${si + 1}` : ''}`);
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
