import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Tablas del modelo documento que la IA puede escribir vía webhook. `usuarios`
// queda fuera a propósito (gestión de acceso). El id siempre es texto.
const WRITABLE_TABLES: Record<string, string> = {
  participantes: 'Participantes (personas). Campos: name, genero, calificacion, cargos[], grupoId, enlace, precursorRegular, nacimiento, bautismo, email, telefono, labores[], notas, restricciones[], excepciones[], speakerTalks[]',
  grupos: 'Grupos/departamentos de la congregación. Campos: name, encargadoId',
  reuniones: 'Reuniones de entre semana (id "YYYY-MM-DD"). Campos: header, reading, presidente, sections[], labores, estado',
  programas: 'Programa mensual de fin de semana (id "YYYY-MM"). Campos: weeks[], salidas, atencion, aseos',
  asignaciones: 'Historial de asignaciones (id compuesto). Campos: personId, date, role, program, labores[]',
  discursos: 'Discursos/conferencias (id = número). Campos: num, title',
  configuracion: 'Configuración general. Campos: schedule, midweek, emailsPermitidos[], algorithm, cargos, capacidades',
  actividad: 'Informe de actividad/predicación (id "activity:YYYY-MM"). Campos: people{}',
  asistencia: 'Asistencia por semana (id año "YYYY"). Campos: weeks[]',
  arreglos: 'Arreglos con congregaciones externas (id "c<timestamp>"). Campos: nombre, years{}, fijo',
  cargos: 'Catálogo de cargos (id auto). Campos: nombre, nivel',
  capacidades: 'Capacidades que otorga cada cargo (id auto). Campos: cargoId, laborId',
  excepciones: 'Excepciones por persona (id auto). Campos: personId, laborId, tipo',
  restricciones: 'Restricciones por persona (id auto). Campos: personId, laborId, permanente',
  speaker_talks: 'Orador ↔ discurso N:N (id auto). Campos: personId, talkNum',
  audit_log: 'Historial de modificaciones (id auto). Campos: entity, entityId, field, before, after, by',
};

async function handleMeta() {
  return jsonRes({
    ok: true,
    app: 'Reunión+ — PWA para confeccionar el programa mensual de reuniones de la congregación (testigos de Jehová). Gestiona personas, asignaciones, informes de actividad/asistencia, intercambios con congregaciones externas y el catálogo de discursos.',

    dataModel: {
      pattern: 'Modelo documento: cada tabla tiene id (text PK) + data (jsonb) + updated_at (timestamptz). El documento completo de la app vive en el campo data.',
      note: 'Para escribir: usa la acción upsert con table, id y data. Para leer: consulta directamente la tabla (RLS permite lectura a usuarios autenticados).',
    },

    tables: {
      participantes: {
        purpose: 'Personas de la congregación (publicadores, siervos ministeriales, ancianos). Cada persona tiene un id autoincremental.',
        requiredFields: ['name'],
        optionalFields: {
          genero: 'M o F (requerido para determinar cargos disponibles)',
          calificacion: 'anciano | ministerial | publicador | inserto',
          cargos: 'Array de ids de cargo. Default: ["publicador"]. Si genero=F, solo se permite "publicador".',
          grupoId: 'id del grupo/departamento al que pertenece',
          enlace: 'id del enlace (persona asignada como enlace)',
          precursorRegular: 'boolean — true si es precursor regular',
          activo: 'boolean — false para ocultar sin borrar (default: true)',
          email: 'string — correo electrónico',
          telefono: 'string — número de teléfono',
          labores: 'Array de ids de labores asignadas (ver lista de labores abajo)',
          notas: 'string — notas libres',
          nacimiento: 'string — fecha de nacimiento (YYYY-MM-DD)',
          bautismo: 'string — fecha de bautismo (YYYY-MM-DD)',
          restricciones: 'Array de objetos {laborId, permanente} — labores que NO puede desempeñar',
          excepciones: 'Array de objetos {laborId, tipo} — labores extra que puede desempeñar aunque su cargo no se lo otorgue',
          speakerTalks: 'Array de números (nums de discurso que la persona puede dar como orador externo)',
        },
        rules: [
          'Cargos default: si no se envía cargos, se asigna ["publicador"].',
          'Restricción de género: si genero=F, solo se permite el cargo "publicador". Anciano y Siervo Ministerial son solo para hombres.',
          'Si se envían cargos no permitidos para el género, se filtran automáticamente.',
        ],
        example: '{ "action": "person", "data": { "name": "Juan Pérez", "genero": "M", "calificacion": "anciano", "cargos": ["anciano"], "grupoId": "1", "labores": ["presidente","conductor1","orador"] } }',
      },
      grupos: {
        purpose: 'Grupos/departamentos de la congregación (ej. Grupo 1, Grupo 2, Servicio, Sonido).',
        requiredFields: ['name'],
        optionalFields: {
          encargadoId: 'id del participante que es encargado del grupo',
        },
        example: '{ "action": "upsert", "table": "grupos", "id": "1", "data": { "name": "Grupo 1", "encargadoId": "5" } }',
      },
      reuniones: {
        purpose: 'Reuniones de entre semana (miércoles). Una por fecha. Contiene las asignaciones de roles y secciones del programa.',
        idFormat: 'YYYY-MM-DD (fecha de la reunión)',
        requiredFields: [],
        optionalFields: {
          header: 'string — encabezado de la reunión',
          reading: 'string — lectura de la biblia',
          presidente: 'personId — presidente de la reunión',
          sections: 'Array de secciones del programa, cada una con parts[] que contienen assignments{}',
          labores: 'Objeto con labores de la semana (sonido, microfono, etc.)',
          estado: 'normal | modificada | cancelada | trasladada | reemplazada',
        },
        note: 'La estructura sections/parts es compleja. Usa la acción assignment para asignar roles simples.',
      },
      programas: {
        purpose: 'Programa mensual de fin de semana (sábado/domingo). Contiene las semanas del mes con asignaciones de discursos y oradores.',
        idFormat: 'YYYY-MM (año-mes)',
        requiredFields: [],
        optionalFields: {
          weeks: 'Array de semanas, cada una con {id, presidente, discursos[], oradores}',
          salidas: 'Programa de oradores de salida',
          atencion: 'Labores de atención/acomodación',
          aseos: 'Programa de aseo',
        },
      },
      asignaciones: {
        purpose: 'Historial de todas las asignaciones realizadas. Registro de quién, cuándo y qué rol desempeñó.',
        idFormat: 'Compuesto (personId + date + program + role)',
        requiredFields: ['personId', 'date', 'role'],
        optionalFields: {
          program: 'string — programa asociado',
          labores: 'Array de labores desempeñadas',
        },
      },
      discursos: {
        purpose: 'Catálogo de discursos/bosquejos públicos. Cada discurso tiene un número y título.',
        idFormat: 'Número del discurso (string, ej. "1", "25")',
        requiredFields: ['num', 'title'],
        optionalFields: {},
        example: '{ "action": "upsert", "table": "discursos", "id": "1", "data": { "num": 1, "title": "LaStartupScript de Dios" } }',
      },
      configuracion: {
        purpose: 'Configuración general de la congregación. Horarios, algoritmo de asignación, emails permitidos.',
        idFormat: '"config" (único registro)',
        requiredFields: [],
        optionalFields: {
          schedule: '{ day: number (0=domingo..6=sábado) } — día de la reunión fin de semana',
          midweek: '{ day: number (0=domingo..6=miércoles) } — día de la reunión entre semana',
          emailsPermitidos: 'Array de emails autorizados a usar la app',
          algorithm: 'Configuración del algoritmo de asignación automática',
          cargos: 'Configuración de cargos',
          capacidades: 'Configuración de capacidades por cargo',
        },
      },
      actividad: {
        purpose: 'Informe mensual de actividad de predicación. UN registro por mes con todos los publicadores.',
        idFormat: 'activity:YYYY-MM (ej. activity:2026-08)',
        requiredFields: [],
        optionalFields: {
          people: {
            '<personId>': {
              actividad: 'boolean — participó en la predicación este mes',
              auxiliar: 'boolean — trabajó como auxiliar (solo visible si actividad=true)',
              cursos: 'number — cursos completados',
              horas: 'number — horas de predicación (solo se muestra si NO es precursor regular)',
              notas: 'string — observaciones',
            },
          },
        },
        note: 'Los precursores regulares muestran "Regular" en lugar de checkbox de actividad. Las horas se ingresan como número.',
        writeExample: '{ "action": "upsert", "table": "actividad", "id": "activity:2026-08", "data": { "people": { "5": { "actividad": true, "cursos": 1, "horas": 10 }, "12": { "actividad": true, "auxiliar": true, "horas": 5 } } } }',
      },
      asistencia: {
        purpose: 'Asistencia semanal a las reuniones. UN registro por año de servicio.',
        idFormat: 'YYYY (año de servicio, ej. 2026 = sept 2025 → ago 2026)',
        requiredFields: [],
        optionalFields: {
          midweek: { '<YYYY-MM-DD>': { total: 'number — asistentes', visitors: 'number — visitantes' } },
          weekend: { '<YYYY-MM-DD>': { total: 'number — asistentes', visitors: 'number — visitantes' } },
        },
        note: 'El año de servicio va de septiembre a agosto. Ej: "2026" = septiembre 2025 a agosto 2026.',
        writeExample: '{ "action": "upsert", "table": "asistencia", "id": "2026", "data": { "midweek": { "2026-08-27": { "total": 85, "visitors": 3 } }, "weekend": { "2026-08-30": { "total": 120, "visitors": 5 } } } }',
      },
      arreglos: {
        purpose: 'Intercambios con congregaciones externas. Cada fila = una congregación. Columnas = años de servicio.',
        idFormat: 'c<timestamp> (ej. c1724000000000)',
        requiredFields: ['congregation'],
        optionalFields: {
          fijo: 'boolean — si el mes se repite automáticamente cada año',
          years: {
            '<YYYY>': {
              month: 'number (0-11) — mes del intercambio (0=enero, 11=diciembre)',
              contact: 'string — nombre del coordinador de la otra congregación',
              phone: 'string — teléfono del coordinador',
              notes: 'string — notas del arreglo',
              localSpeakers: 'Array de { speaker: "nombre", num: "nums" } — oradores locales asignados',
            },
          },
        },
        writeExample: '{ "action": "upsert", "table": "arreglos", "id": "c1724000000000", "data": { "congregation": "Congregación Centro", "fijo": true, "years": { "2026": { "month": 2, "contact": "Juan", "phone": "555-1234", "localSpeakers": [{ "speaker": "Pedro", "num": "10, 25" }] } } } }',
      },
      cargos: {
        purpose: 'Catálogo de cargos de la congregación. Define los niveles de responsabilidad.',
        requiredFields: ['name'],
        optionalFields: {
          nivel: 'number — 1=publicador, 2=siervo ministerial, 3=anciano',
          activo: 'boolean — si el cargo está activo',
        },
        defaults: [
          { id: 'publicador', name: 'Publicador', nivel: 1 },
          { id: 'ministerial', name: 'Siervo Ministerial', nivel: 2 },
          { id: 'anciano', name: 'Anciano', nivel: 3 },
        ],
      },
      capacidades: {
        purpose: 'Define qué labores otorga cada cargo. Relación cargo → labores.',
        requiredFields: ['cargoId', 'laborId'],
        optionalFields: {
          label: 'string — etiqueta descriptiva',
          activo: 'boolean',
        },
        note: 'El cargo "anciano" otorga: presidente, presidenteFin, conductor1, conductor2, orador, salida, lector1, lector2, acomodador, microf, plataforma.',
      },
      excepciones: {
        purpose: 'Permite que una persona desempeñe labores que su cargo no otorga (o que estén restringidas).',
        requiredFields: ['personId', 'laborId'],
        optionalFields: {
          tipo: 'string — tipo de excepción',
        },
      },
      restricciones: {
        purpose: 'Restringe labores específicas para una persona (incluso si su cargo las otorga).',
        requiredFields: ['personId', 'laborId'],
        optionalFields: {
          permanente: 'boolean — si la restricción es permanente',
        },
      },
      speaker_talks: {
        purpose: 'Relación N:N entre oradores y discursos. Define qué discursos puede dar cada orador externo.',
        requiredFields: ['personId', 'talkNum'],
        optionalFields: {},
      },
      audit_log: {
        purpose: 'Historial de modificaciones. Registra cada cambio con antes/después.',
        requiredFields: ['entity', 'entityId', 'field', 'before', 'after'],
        optionalFields: {
          by: 'string — quién hizo el cambio',
        },
      },
    },

    labores: {
      description: 'Ids de labores disponibles para asignar a personas y usar en programas.',
      ids: {
        presidente: 'Presidente (entre semana)',
        presidenteFin: 'Presidente fin de semana',
        conductor1: 'Conductor de Atalaya',
        conductor2: 'Conductor del Libro',
        orador: 'Orador (discurso)',
        salida: 'Orador de salida',
        lector1: 'Lector Atalaya',
        lector2: 'Lector Libro',
        audio: 'Sonido',
        microf: 'Micrófono',
        plataforma: 'Plataforma',
        acomodador: 'Acomodador',
        asignacion1: 'Lectura',
        asignacion2: 'Presentación',
        asignacion3: 'Discurso Estudiantil',
        asignacion4: 'Discurso Reunión (vida)',
        discursoInicial: 'Discurso inicial Tesoros',
        perlas: 'Perlas',
      },
    },

    actions: {
      meta: {
        description: 'Devuelve esta documentación completa.',
        payload: '{ "action": "meta" }',
      },
      person: {
        description: 'Crear o actualizar una persona. Si se envía id, actualiza directamente. Si no, busca por nombre (ilike) y crea o actualiza.',
        requiredFields: ['data.name'],
        rules: [
          'Cargos default: si no se envía cargos, se asigna ["publicador"].',
          'Restricción de género: si genero=F, solo se permite "publicador". Anciano y Siervo Ministerial son solo para hombres.',
        ],
        payload: {
          action: 'person',
          id: '(opcional) id numérico existente para actualizar',
          data: {
            name: '(requerido) nombre completo',
            genero: 'M o F (requerido para determinar cargos)',
            calificacion: 'anciano | ministerial | publicador | inserto',
            cargos: 'Array de ids de cargo (default: ["publicador"]; si genero=F, solo "publicador")',
            grupoId: 'id del grupo',
            precursorRegular: 'boolean',
            activo: 'boolean (default true)',
            labores: 'Array de ids de labores',
          },
        },
        example: '{ "action": "person", "data": { "name": "Juan Pérez", "genero": "M", "calificacion": "anciano", "cargos": ["anciano"], "labores": ["presidente","conductor1"] } }',
      },
      upsert: {
        description: 'Escribir任意 registro en任意 tabla del modelo documento. Requiere table, id y data.',
        requiredFields: ['table', 'id', 'data'],
        payload: {
          action: 'upsert',
          table: 'nombre de la tabla (ver tablas arriba)',
          id: 'id del registro (texto)',
          data: 'objeto json con los campos a guardar',
        },
        example: '{ "action": "upsert", "table": "discursos", "id": "1", "data": { "num": 1, "title": "LaStartupScript de Dios" } }',
      },
      remove: {
        description: 'Eliminar un registro por id de任意 tabla.',
        requiredFields: ['table', 'id'],
        payload: { action: 'remove', table: 'tabla', id: 'id del registro' },
        example: '{ "action": "remove", "table": "participantes", "id": "5" }',
      },
      attendance: {
        description: 'Registrar actividad de predicación de una persona en un mes específico.',
        requiredFields: ['month', 'data'],
        payload: {
          action: 'attendance',
          month: 'YYYY-MM (mes del informe)',
          data: {
            personId: '(requerido) id de la persona',
            actividad: 'boolean — participó',
            auxiliar: 'boolean — es auxiliar',
            cursos: 'number — cursos completados',
            horas: 'number — horas de predicación',
            notas: 'string — observaciones',
          },
        },
        note: 'Esta acción es un atajo. Internamente escribe en la tabla actividad bajo la key people[personId].',
      },
      assignment: {
        description: 'Asignar personas a roles en el programa de una semana.',
        requiredFields: ['month', 'week', 'assignments'],
        payload: {
          action: 'assignment',
          month: 'YYYY-MM',
          week: 'YYYY-MM-DD (fecha de la reunión)',
          assignments: '{ "presidente": "personId", "conductor1": "personId", ... }',
        },
        note: 'Las keys de assignments son los ids de labores (ver sección labores arriba).',
      },
    },

    informs: {
      description: 'Sección Informes de la app. 4 pestañas: Actividad, Asistencia, Arreglos y Formularios.',
      tabs: {
        actividad: {
          description: 'Informe mensual de actividad de predicación por persona.',
          table: 'actividad',
          idFormat: 'activity:YYYY-MM',
          howToRead: 'Consulta la tabla actividad con el id "activity:YYYY-MM". El campo data.people contiene un objeto con los ids de personas como keys.',
          howToWrite: 'Usa upsert para escribir el registro completo del mes. Cada persona se guarda bajo data.people[personId].',
          fieldDetails: {
            'data.people.<personId>.actividad': 'boolean — si participó en predicación este mes',
            'data.people.<personId>.auxiliar': 'boolean — si fue auxiliar (solo si actividad=true)',
            'data.people.<personId>.cursos': 'number — cursos completados',
            'data.people.<personId>.horas': 'number — horas de predicación',
            'data.people.<personId>.notas': 'string — observaciones',
          },
        },
        asistencia: {
          description: 'Asistencia semanal a las reuniones (entre semana y fin de semana).',
          table: 'asistencia',
          idFormat: 'YYYY (año de servicio)',
          howToRead: 'Consulta asistencia con id = año de servicio. data.midweek y data.weekend contienen objetos keyed por fecha.',
          howToWrite: 'Usa upsert para agregar fechas. Cada fecha tiene {total, visitors}.',
          yearDefinition: 'Año de servicio: septiembre → agosto. Ej: 2026 = sept 2025 a agosto 2026.',
        },
        arreglos: {
          description: 'Intercambios con congregaciones externas. Tabla: filas = congregaciones, columnas = años.',
          table: 'arreglos',
          idFormat: 'c<timestamp>',
          howToRead: 'Cada registro es una congregación. data.years contiene los datos por año.',
          howToWrite: 'Usa upsert para crear/actualizar congregación. Para agregar un año, añade la key del año en data.years.',
        },
        formularios: {
          description: 'Descarga de formularios PDF. Solo visual en la app, sin endpoint de API.',
        },
      },
    },

    notes: [
      'Todos los registros usan el modelo documento: id (texto) + data (jsonb) + updated_at.',
      'La tabla usuarios está excluida (gestión de acceso).',
      'Las operaciones usan permisos de service role (bypass RLS).',
      'Para leer: consulta directamente la tabla con select. Para escribir: upsert con table+id+data.',
      'El año de servicio va de septiembre a agosto: 2026 = sept 2025 → ago 2026.',
      'Las labores disponibles están listadas en la sección labores. Usa esos ids para campos labores, assignments, etc.',
      'Los id de actividad siguen el formato "activity:YYYY-MM" y los de asistencia son el año de servicio.',
    ],
  });
}

async function handleUpsert(sb: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  const table = String(payload.table || '');
  const id = payload.id != null ? String(payload.id) : '';
  const data = payload.data;
  if (!table || !(table in WRITABLE_TABLES)) return jsonRes({ error: `Tabla no permitida: ${table}` }, 400);
  if (!id) return jsonRes({ error: 'Falta campo: id' }, 400);
  if (typeof data !== 'object' || data === null) return jsonRes({ error: 'Falta campo: data (objeto)' }, 400);

  const { error } = await sb
    .from(table)
    .upsert({ id, data, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) return jsonRes({ error: error.message }, 500);
  return jsonRes({ ok: true, action: 'upsert', table, id });
}

async function handleRemove(sb: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  const table = String(payload.table || '');
  const id = payload.id != null ? String(payload.id) : '';
  if (!table || !(table in WRITABLE_TABLES)) return jsonRes({ error: `Tabla no permitida: ${table}` }, 400);
  if (!id) return jsonRes({ error: 'Falta campo: id' }, 400);

  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) return jsonRes({ error: error.message }, 500);
  return jsonRes({ ok: true, action: 'remove', table, id, deleted: true });
}

async function authenticate(): Promise<{ sb: ReturnType<typeof createClient>; userId: string } | Response> {
  const email = Deno.env.get('ZAPIA_EMAIL');
  const password = Deno.env.get('ZAPIA_PASSWORD');
  if (!email || !password) return jsonRes({ error: 'Credenciales IA no configuradas en el servidor' }, 500);

  const anonUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const sb = createClient(anonUrl, anonKey);
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email, password });
  if (authErr || !auth?.user) return jsonRes({ error: 'Credenciales IA inválidas' }, 401);

  const { data: userDoc } = await sb
    .from('usuarios')
    .select('data')
    .eq('id', auth.user.id)
    .single();

  if (userDoc?.data?.rol !== 'ia') return jsonRes({ error: 'Rol no autorizado' }, 403);

  const adminSb = createClient(anonUrl, serviceKey);
  return { sb: adminSb, userId: auth.user.id };
}

async function handleAttendance(sb: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  const { month, week, data } = payload as { month: string; week: string; data: Record<string, unknown> };
  if (!month || !week || !data) return jsonRes({ error: 'Faltan campos: month, week, data' }, 400);

  const id = `activity:${month}`;
  const { data: existing } = await sb.from('actividad').select('data').eq('id', id).single();

  const report = existing?.data || { id, people: {} };
  if (!report.people) report.people = {};

  report.people[week] = {
    actividad: true,
    publicadores: Number(data.publishers) || 0,
    auxiliares: Number(data.auxiliary) || 0,
    horas: Number(data.hours) || 0,
    visitantes: Number(data.visitors) || 0,
    notas: data.notes || '',
    updatedAt: new Date().toISOString(),
  };

  const { error } = await sb
    .from('actividad')
    .upsert({ id, data: report, updated_at: new Date().toISOString() }, { onConflict: 'id' });

  if (error) return jsonRes({ error: error.message }, 500);
  return jsonRes({ ok: true, id, week });
}

async function handlePerson(sb: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  const idIn = payload.id != null ? String(payload.id) : '';
  const data = (payload.data || {}) as Record<string, unknown>;
  const name = String(data?.name || '').trim();
  if (!name) return jsonRes({ error: 'Falta campo: data.name' }, 400);

  const genero = String(data?.genero || '').toUpperCase();
  let cargos = Array.isArray(data?.cargos) ? [...data.cargos] : [];
  if (cargos.length === 0) cargos = ['publicador'];
  if (genero === 'F') {
    cargos = cargos.filter((c: string) => c === 'publicador');
    if (cargos.length === 0) cargos = ['publicador'];
  }

  const person: Record<string, unknown> = { ...data, name, genero, cargos, activo: data.activo !== false };

  if (idIn) {
    const { error } = await sb
      .from('participantes')
      .upsert({ id: idIn, data: person, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) return jsonRes({ error: error.message }, 500);
    return jsonRes({ ok: true, id: idIn, updated: true });
  }

  const { data: existing } = await sb
    .from('participantes')
    .select('id, data')
    .ilike('data->>name', name)
    .limit(1)
    .single();

  if (existing) {
    const merged = { ...existing.data, ...person };
    const { error } = await sb
      .from('participantes')
      .update({ data: merged, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) return jsonRes({ error: error.message }, 500);
    return jsonRes({ ok: true, id: existing.id, updated: true });
  }

  const id = crypto.randomUUID();
  const { error } = await sb
    .from('participantes')
    .insert({ id, data: person, updated_at: new Date().toISOString() });
  if (error) return jsonRes({ error: error.message }, 500);
  return jsonRes({ ok: true, id, created: true });
}

async function handleAssignment(sb: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  const { month, week, assignments } = payload as {
    month: string;
    week: string;
    assignments: Record<string, string>;
  };
  if (!month || !week || !assignments) return jsonRes({ error: 'Faltan campos: month, week, assignments' }, 400);

  const { data: existing } = await sb.from('programas').select('data').eq('id', month).single();
  const program = existing?.data || { midweeks: [] };

  let mw = program.midweeks?.find((w: Record<string, unknown>) => w.id === week);
  if (!mw) {
    if (!program.midweeks) program.midweeks = [];
    mw = { id: week, presidente: '', sections: [] };
    program.midweeks.push(mw);
  }

  for (const [field, personId] of Object.entries(assignments)) {
    if (field === 'presidente') {
      mw.presidente = personId;
    } else {
      for (const sec of mw.sections || []) {
        for (const part of sec.parts || []) {
          if (!part.assignments) part.assignments = {};
          if (field in part.assignments && !part.assignments[field]) {
            part.assignments[field] = personId;
          }
        }
      }
    }
  }

  const { error } = await sb
    .from('programas')
    .upsert({ id: month, data: program, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) return jsonRes({ error: error.message }, 500);
  return jsonRes({ ok: true, month, week });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405);

  const authResult = await authenticate();
  if (authResult instanceof Response) return authResult;

  const { sb } = authResult;
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return jsonRes({ error: 'JSON inválido' }, 400);
  }

  try {
    switch (payload.action) {
      case 'attendance': return await handleAttendance(sb, payload);
      case 'person': return await handlePerson(sb, payload);
      case 'assignment': return await handleAssignment(sb, payload);
      case 'upsert': return await handleUpsert(sb, payload);
      case 'remove': return await handleRemove(sb, payload);
      case 'meta': return await handleMeta();
      default: return jsonRes({ error: `Acción desconocida: ${payload.action}` }, 400);
    }
  } catch (err) {
    return jsonRes({ error: err.message || 'Error interno' }, 500);
  }
});
