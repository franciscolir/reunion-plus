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
  return { data: { roles }, warnings: ['Roles detectados: ' + (Object.keys(roles).join(', ') || 'revisar')] };
}

// Convierte el texto de la Guía de Actividades en semanas. Detecta la cabecera de
// cada semana (rango + mes), su lectura, las secciones (Tesoros / Mejores Maestros /
// Vida Cristiana) y todas sus partes (número, título y minutos). El texto del PDF
// separa caracteres, así que los títulos salen "comprimidos" y se revisan en el modal.
export function convertPdfMidweeks(text) {
  const months = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  const clean = (s) => String(s).replace(/[\u0002\u0003]/g, ' ').replace(/\s+/g, ' ').trim();
  const compact = (s) => String(s).replace(/[\s\u0002\u0003´`]/g, '');
  const lines = text.split('\n').map(clean).filter(Boolean);

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

  // Cabeceras de sección: van en mayúsculas (el texto de prosa va en minúsculas).
  const sectionOf = (c) => {
    const u = String(c || '').toUpperCase();
    if (u !== String(c || '')) return null;
    if (u.includes('TESOROS')) return 'tesoros';
    if (u.includes('MAESTROS')) return 'maestros';
    if (u.includes('NUESTRAVIDA') || (u.includes('VIDA') && u.includes('CRISTIANA'))) return 'vida';
    return null;
  };
  const songNum = (c) => {
    const m = String(c || '').match(/CANCI\S*(\d{1,3})/i);
    return m ? Number(m[1]) : null;
  };
  const partMatch = (c) => {
    const m = String(c || '').match(/^(\d{1,2})[.)](.+?)\((\d{1,2})(?:mins?|min)\.?\)/);
    if (!m) return null;
    const title = capTitle(splitWords(m[2].replace(/[“”"_*\u2022•]/g, '').trim()));
    return { num: Number(m[1]), title, mins: Number(m[3]) };
  };
  // La lectura termina en la primera sección o canción que aparece tras la cabecera.
  const endOfReading = (buf) => {
    const upper = buf.toUpperCase();
    const cuts = ['TESOROS', 'SEAMOS', 'NUESTRAVIDA', 'CANCI'].map(k => {
      const i = upper.indexOf(k);
      return i === -1 ? Infinity : i;
    });
    return Math.min(...cuts);
  };

  const newWeek = (h) => {
    // El lunes es el día de inicio y está en el mes que indica la cabecera
    // (ej. "28-4 DE SEPTIEMBRE" → lunes 28 de septiembre; cruza a octubre).
    return {
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
    };
  };

  const weeks = [];
  let cur = null;
  let curSec = null;
  let phase = 'reading'; // reading | content
  let readingBuf = '';
  let buf = '';

  const addPart = (pm) => {
    const sec = curSec ? cur.sections.find(s => s.id === curSec) : null;
    if (!sec) return;
    // El PDF repite el contenido de una semana cuando ocupa varias páginas:
    // se descartan partes repetidas con el mismo número en la misma sección.
    if (sec.parts.some(p => p.num === pm.num)) return;
    sec.parts.push(pm);
  };

  for (const ln of lines) {
    const c = compact(ln);
    const h = headerOf(c);
    if (h) {
      // El PDF repite la cabecera de una semana cuando ocupa varias páginas:
      // si es la misma semana, se continúa acumulando en lugar de crear otra.
      if (cur && cur.header === h.header) continue;
      cur = newWeek(h);
      weeks.push(cur);
      phase = 'reading';
      curSec = null;
      readingBuf = h.rest || '';
      buf = '';
      continue;
    }
    if (!cur) continue;

    if (phase === 'reading') {
      readingBuf += c;
      const u = readingBuf.toUpperCase();
      const sec = sectionOf(u);
      if (sec) {
        cur.reading = tidyReading(readingBuf.slice(0, endOfReading(readingBuf)));
        curSec = sec;
        phase = 'content';
        buf = '';
        continue;
      }
      if (u.includes('CANCI') || u.includes('PALABRASDEINTRODUCCI')) {
        cur.reading = tidyReading(readingBuf.slice(0, endOfReading(readingBuf)));
        phase = 'content';
        buf = '';
        continue;
      }
      continue;
    }

    // contenido: canciones, secciones y partes
    const song = songNum(c);
    if (song) { if (!cur.songIn) cur.songIn = song; else cur.songOut = song; buf = ''; continue; }
    const sec = sectionOf(c);
    if (sec) { curSec = sec; buf = ''; continue; }
    if (/^\d{1,2}[.)]/.test(c)) { buf = c; continue; } // comienzo de parte
    buf += c;
    const pm = partMatch(buf);
    if (pm) { addPart(pm); buf = ''; }
  }
  if (cur && phase === 'reading') cur.reading = tidyReading(readingBuf.slice(0, endOfReading(readingBuf)));

  if (!weeks.length) return { data: null, warnings: ['No se detectaron semanas (formato "D-D DE MES"). Revise el texto manualmente.'] };
  // Quitar cabeceras repetidas (el texto del PDF repite la cabecera de cada página).
  const seen = new Set();
  const uniq = weeks.filter(w => { const k = w.header; if (seen.has(k)) return false; seen.add(k); return true; });
  return { data: { weeks: uniq }, warnings: [`Se detectaron ${uniq.length} semanas; revise títulos (el PDF separa las letras).`] };
}

// Resumen de la Guía de Actividades detectada: meses, año y nº de semanas.
// Devuelve null si el texto no se reconoce como guía.
export function midweekGuideSummary(text) {
  const { data, warnings } = convertPdfMidweeks(text);
  if (!data || !data.weeks || !data.weeks.length) return null;
  const monthsSet = new Set();
  let year = null;
  for (const w of data.weeks) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(w.id || ''))) continue;
    monthsSet.add(Number(w.id.slice(5, 7)));
    if (year == null) year = Number(w.id.slice(0, 4));
  }
  if (!monthsSet.size) return null;
  return {
    months: [...monthsSet].sort((a, b) => a - b).map(m => MONTHS_ES[m - 1]),
    year,
    weeksCount: data.weeks.length,
    weeks: data.weeks,
    warnings,
  };
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
// context = { midweeks, months, labores, salidas }
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
    LABORES_DEF.forEach(d => {
      const arr = Array.isArray(l[d.key]) ? l[d.key] : [l[d.key] || ''];
      arr.forEach((id, si) => { if (id) add(id, mes, semana, 'entre', `labores_${d.key}_${si}`, `${d.label} ${si + 1} (entre semana) · ${header}`); });
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

  // Acomodación (labores del fin de semana)
  (context.labores || []).forEach(p => (p.weeks || []).forEach(w => {
    const l = (w.labores || {});
    LABORES_DEF.forEach(d => {
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
  // Sin género: tabla de calificaciones.
  return PAR_LIMIT.some(([a, b]) => (c1 === a && c2 === b) || (c1 === b && c2 === a));
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
    if (idx === parts.length - 1) return [{ key: 'lector', label: 'Lector', role: 'asignacion1' }];
    return [{ key: 'conductor', label: idx === 0 ? 'Discurso' : 'Perlas', role: 'asignacion4' }];
  }
  if (secId === 'maestros') {
    // Presentaciones de 2 personas (asignacion2); si dice "discurso" es de 1 (asignacion3).
    if (/discurso/i.test(String(part.title || ''))) return [{ key: 'conductor', label: 'Discurso', role: 'asignacion3' }];
    return [{ key: 'estudiante', label: 'Estudiante', role: 'asignacion2' }, { key: 'ayudante', label: 'Ayudante', role: 'asignacion2' }];
  }
  if (secId === 'vida') {
    // Última parte = Estudio Bíblico de la Congregación (conductor2 + lector2);
    // las anteriores son discursos de la reunión (asignacion4).
    if (idx === parts.length - 1) return [{ key: 'conductor', label: 'Conductor', role: 'conductor2' }, { key: 'lector', label: 'Lector', role: 'lector2' }];
    return [{ key: 'conductor', label: 'Discurso', role: 'asignacion4' }];
  }
  return [{ key: 'conductor', label: 'Conductor' }];
}

// Roles "no estudiante" (discursos de la reunión y estudio).
const ROL_NO_ESTUDIANTE = new Set(['asignacion4', 'conductor2', 'lector2']);
// Roles "estudiante" (lectura + presentaciones + discurso estudiantil).
const ROL_ESTUDIANTE = new Set(['asignacion1', 'asignacion2', 'asignacion3']);

/* ---------- Automatización de asignaciones ---------- */
const ORDEN_CAL = ['A', 'B', 'C', 'D'];

// Personas con un rol (o sin roles definidos).
function peopleForRole(people, role) {
  return people.filter(p => !Array.isArray(p.roles) || p.roles.length === 0 || p.roles.includes(role));
}

// Mapa de los campos editables de la reunión de fin de semana según su tipo.
// Solo los campos listados se automatizan (el orador es texto libre/manual).
function camposFinSemana(w) {
  if (w.type === 'assembly') return [];
  if (w.type === 'commemoration') return [{ campo: 'presidente', role: 'presidente' }];
  if (w.type === 'supervisor') return [
    { campo: 'presidente', role: 'presidente' },
    { campo: 'estudioSinLectura', role: 'conductor1' },
  ];
  return [
    { campo: 'presidente', role: 'presidente' },
    { campo: 'conductor', role: 'conductor1' },
    { campo: 'lector', role: 'lector1' },
  ];
}

// Automatiza la reunión de entre semana de un mes. Muta `midweeks`
// (asigna week.presidente y p.assignments). Devuelve un reporte.
// Orden: presidente → discursos no estudiante → estudiantes (parejas canBePair).
// Reglas: sin repetir la misma parte en el mes (E3), sin duplicar a nadie en la
// misma semana (E2 intra-reunión). Solo rellena puestos vacíos.
// `ocupadosSemana`: opcional, Map sábado -> Set de personas ocupadas esa semana
// (p. ej. acomodación y salidas) que no deben recibir la parte (E1/E2).
export function automatizarEntreSemana(people, midweeks, ocupadosSemana = null) {
  const reporte = { asignados: 0, vacios: [] };
  const rolPorPersona = {}; // personaId -> Set de partes ya usadas en el mes (E3)
  const enSemana = {};      // weekId -> Set de personas ya asignadas esa semana

  const marcado = (pid, key, weekId) => {
    (rolPorPersona[pid] ||= new Set()).add(key);
    (enSemana[weekId] ||= new Set()).add(pid);
    reporte.asignados++;
  };
  const elegible = (p, key, weekId) => {
    if ((rolPorPersona[String(p.id)] || new Set()).has(key)) return false;
    if ((enSemana[weekId] || new Set()).has(String(p.id))) return false;
    const setOcup = ocupadosSemana ? (ocupadosSemana.get(addDays(weekId, 5)) || new Set()) : new Set();
    return !setOcup.has(String(p.id));
  };

  const elegir = (weekId, role, key) => {
    let cand = peopleForRole(people, role);
    // Prioridad de calificación solo para estudiantes.
    if (ROL_ESTUDIANTE.has(role)) {
      cand = cand.slice().sort((a, b) => ORDEN_CAL.indexOf(b.calificacion || '') - ORDEN_CAL.indexOf(a.calificacion || ''));
    }
    const p = cand.find(x => elegible(x, key, weekId));
    if (!p) { reporte.vacios.push({ semana: weekId, role, key }); return ''; }
    marcado(String(p.id), key, weekId);
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
        if (!ROL_NO_ESTUDIANTE.has(slot.role)) return;
        if (ap[slot.key]) return;
        const id = elegir(weekId, slot.role, `mw_${si}_${part.num}_${slot.key}`);
        if (id) ap[slot.key] = id;
      });
      part.assignments = ap;
    }));

    // 3. Estudiantes (lectura + presentaciones + discurso estudiantil), parejas con canBePair.
    (week.sections || []).forEach((sec, si) => (sec.parts || []).forEach(part => {
      const ap = { ...(part.assignments || {}) };
      const slots = midweekSlotsOf(sec, part);
      if (!slots.every(s => ROL_ESTUDIANTE.has(s.role))) return;
      if (slots.length === 2 && slots[0].role === 'asignacion2') {
        // Pareja estudiante + ayudante: buscar una pareja compatible libre.
        const keyA = `mw_${si}_${part.num}_${slots[0].key}`;
        const keyB = `mw_${si}_${part.num}_${slots[1].key}`;
        if (ap[slots[0].key] && ap[slots[1].key]) return;
        if (ap[slots[0].key] || ap[slots[1].key]) { reporte.vacios.push({ semana: weekId, role: 'asignacion2', key: keyA }); return; }
        const cand = peopleForRole(people, 'asignacion2')
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
          found = true;
          break;
        }
        if (!found) { reporte.vacios.push({ semana: weekId, role: 'asignacion2', key: keyA }); reporte.vacios.push({ semana: weekId, role: 'asignacion2', key: keyB }); }
      } else {
        // 1 persona (lectura asignacion1 o discurso estudiantil asignacion3).
        const slot = slots[0];
        if (!ap[slot.key]) {
          const id = elegir(weekId, slot.role, `mw_${si}_${part.num}_${slot.key}`);
          if (id) ap[slot.key] = id;
        }
      }
      part.assignments = ap;
    }));
  });

  return reporte;
}

// Automatiza la acomodación (labores de fin de semana) de un mes: reparte los
// puestos de LABORES_DEF con personas de atención libres en cada semana (sin
// estar en la reunión de entre semana de esa semana, E1). Muta `labores`
// ({ id, weeks:[{saturday, labores}] }). Solo rellena puestos vacíos y no repite
// el mismo labore a la misma persona dos veces en el mes. Devuelve reporte.
export function automatizarAcomodacion(people, labores, midweeks) {
  const reporte = { asignados: 0, vacios: [] };
  const ocupMw = new Map(); // saturday -> Set de personas de entre semana esa semana
  midweeks.forEach(mw => {
    const sat = addDays(mw.id, 5); // sábado de la semana del lunes
    const set = new Set();
    if (mw.presidente) set.add(String(mw.presidente));
    (mw.sections || []).forEach(sec => (sec.parts || []).forEach(p => Object.values(p.assignments || {}).forEach(id => { if (id) set.add(String(id)); })));
    ocupMw.set(sat, set);
  });
  const laboreMes = new Map(); // personaId -> Set de claves labore usadas en el mes

  labores.forEach(rec => (rec.weeks || []).forEach(w => {
    const sat = String(w.saturday);
    const l = w.labores || {};
    const ocup = new Set(ocupMw.get(sat) || []); // ya ocupados esa semana (entre semana + acomodación)
    // Normalizar puestos faltantes.
    LABORES_DEF.forEach(d => {
      if (l[d.key] === undefined) l[d.key] = d.count > 1 ? Array(d.count).fill('') : '';
    });
    // Registrar lo ya asignado.
    LABORES_DEF.forEach(d => {
      const v = l[d.key];
      (Array.isArray(v) ? v : [v]).forEach((id, si) => {
        if (!id) return;
        ocup.add(String(id));
        (laboreMes[String(id)] ||= new Set()).add(`${d.key}_${si}`);
      });
    });
    // Rellenar puestos vacíos.
    LABORES_DEF.forEach(d => {
      const v = l[d.key];
      for (let si = 0; si < d.count; si++) {
        const cur = Array.isArray(v) ? v[si] : (si === 0 ? v : '');
        if (cur) continue;
        const cand = people.filter(isLaborePerson)
          .find(x => !ocup.has(String(x.id)) && !((laboreMes[String(x.id)] || new Set()).has(`${d.key}_${si}`)));
        if (!cand) { reporte.vacios.push({ semana: sat, role: `${d.key}_${si}` }); continue; }
        if (Array.isArray(v)) v[si] = cand.id;
        else l[d.key] = cand.id;
        ocup.add(String(cand.id));
        (laboreMes[String(cand.id)] ||= new Set()).add(`${d.key}_${si}`);
        reporte.asignados++;
      }
    });
  }));
  return reporte;
}

// Automatiza la reunión de fin de semana: rellena los campos editables por
// persona (presidente, conductor, lector, estudioSinLectura según el tipo de
// semana) sin repetir a quienes ya están en acomodación o salidas esa semana
// (E2) ni repetir el mismo cargo en el mes (E4). Muta `months`. Devuelve reporte.
export function automatizarFinSemana(people, months, salidas, labores) {
  const reporte = { asignados: 0, vacios: [] };
  const cargoMes = {}; // personaId -> Set de cargos usados en el mes (E4)
  const ocupados = {}; // saturday -> Set de personas ocupadas (acomodación + salidas)

  const marcarOcupado = (sat, id) => {
    if (id) (ocupados[sat] ||= new Set()).add(String(id));
  };
  salidas.forEach(p => (p.weeks || []).forEach(w => (w.outings || []).forEach(o => marcarOcupado(String(w.saturday), o.oradorSalida))));
  labores.forEach(p => (p.weeks || []).forEach(w => {
    const l = w.labores || {};
    LABORES_DEF.forEach(d => {
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
    camposFinSemana(w).forEach(({ campo, role }) => {
      if (w[campo]) return;
      const p = peopleForRole(people, role)
        .find(x => !ocup.has(String(x.id)) && !((cargoMes[String(x.id)] || new Set()).has(campo)));
      if (!p) { reporte.vacios.push({ semana: sat, role: campo }); return; }
      w[campo] = p.id;
      (cargoMes[String(p.id)] ||= new Set()).add(campo);
      ocup.add(String(p.id));
      reporte.asignados++;
    });
  }));
  return reporte;
}
