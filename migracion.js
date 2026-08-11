// migracion.js - Herramienta temporal de migración IndexedDB → Firestore (Fase 4)
// ================================================================================
// Importa los datos actuales de la aplicación (IndexedDB vía db.exportAll()) al
// esquema Cloud Firestore aprobado. Es IDEMPOTENTE: cada documento usa el mismo
// id que en IndexedDB, así que re-ejecutarla sobrescribe sin duplicar.
//
// Los archivos JSON NO se eliminan ni se usan aquí como fuente primaria: la
// fuente de verdad actual es IndexedDB (los JSON solo son seed inicial).
//
// Esquema Firestore (aprobado):
//   participantes/{personaId}  { nombre, grupoId, labores[], cargos[], genero,
//                               calificacion, enlace, activo, updatedAt }
//   grupos/{grupoId}           { nombre, orden, labores, activo, updatedAt }
//   reuniones/{YYYY-MM-DD}     { fecha, tipo:'entre', lectura, canciones,
//                               secciones:[...], updatedAt }
//   programas/{YYYY-MM}        { mes, semanas:[...], published, updatedAt }
//                               (incluye fin de semana + salidas + atencion + aseo)
//   asignaciones/{id}          { fecha, reunionId, programaId, participanteId,
//                               actividadId, rol, program, updatedAt }
//   configuracion/general      { congregacion, config, laboresEquipo, updatedAt }
//   usuarios/{uid}             { email, rol } (se crea al autenticarse)

import { batchWrite } from './firestore.js';
import * as db from './db.js';

// Convierte el resultado de db.exportAll() en documentos Firestore planos.
// Devuelve un array de { collection, id, data } listo para batchWrite.
export function convertirADocumentosFirestore(exported) {
  const docs = [];
  const now = Date.now();

  // ---- Participantes (people → participantes) ----
  for (const p of (exported.people || [])) {
    docs.push({
      collection: 'participantes',
      id: String(p.id),
      data: {
        nombre: p.name || '',
        grupoId: p.grupoId || '',
        labores: Array.isArray(p.labores) ? p.labores : [],
        cargos: Array.isArray(p.cargos) ? p.cargos : [],
        genero: p.genero || '',
        calificacion: p.calificacion || '',
        enlace: p.enlace || '',
        activo: p.activo !== false,
        createdAt: p.createdAt || now,
      },
    });
  }

  // ---- Grupos (departments → grupos) ----
  for (const g of (exported.departments || [])) {
    docs.push({
      collection: 'grupos',
      id: String(g.id),
      data: {
        nombre: g.name || '',
        orden: g.orden || 0,
        labores: g.labores || '',
        activo: g.activo !== false,
        createdAt: g.createdAt || now,
      },
    });
  }

  // ---- Reuniones de entre semana (midweeks → reuniones) ----
  for (const mw of (exported.midweeks || [])) {
    const sections = (mw.sections || []).map(sec => ({
      id: sec.id,
      title: sec.title,
      parts: (sec.parts || []).map(p => ({
        num: p.num,
        title: p.title,
        mins: p.mins,
        assignments: p.assignments || {},
      })),
    }));
    docs.push({
      collection: 'reuniones',
      id: String(mw.id),
      data: {
        fecha: String(mw.id),
        tipo: 'entre',
        lectura: mw.reading || '',
        canciones: { intro: mw.songIn || 0, salida: mw.songOut || 0 },
        introTitle: mw.introTitle || 'Palabras de introducción',
        introMins: mw.introMins || 1,
        closingTitle: mw.closingTitle || 'Palabras de conclusión',
        closingMins: mw.closingMins || 3,
        header: mw.header || '',
        sections,
        createdAt: mw.createdAt || now,
      },
    });
  }

  // ---- Programas mensuales (months + salidas + atencion + aseos → programas) ----
  // Se consolidan en UN documento por mes: semanas con fin de semana + salidas +
  // atencion (acomodación) + aseo, según lo aprobado.
  const meses = new Set([
    ...(exported.months || []).map(m => String(m.id)),
    ...(exported.salidas || []).map(s => String(s.id)),
    ...(exported.atencion || []).map(a => String(a.id)),
    ...(exported.aseos || []).map(a => String(a.id)),
  ]);
  const salidasByMes = new Map((exported.salidas || []).map(s => [String(s.id), s]));
  const atencionByMes = new Map((exported.atencion || []).map(a => [String(a.id), a]));
  const aseosByMes = new Map((exported.aseos || []).map(a => [String(a.id), a]));

  for (const mes of meses) {
    const month = (exported.months || []).find(m => String(m.id) === mes);
    const sal = salidasByMes.get(mes);
    const ate = atencionByMes.get(mes);
    const aseo = aseosByMes.get(mes);

    const semanas = [];
    // Fusiona por fecha las 4 fuentes paralelas (mes, salidas, atencion, aseo).
    const porFecha = new Map(); // fecha → { mes?, sal?, ate?, aseo? }
    const merge = (fecha, campo, valor) => {
      if (!fecha) return;
      const k = String(fecha);
      if (!porFecha.has(k)) porFecha.set(k, {});
      porFecha.get(k)[campo] = valor;
    };
    if (month) for (const w of (month.weeks || [])) merge(w.date, 'mes', w);
    if (sal) for (const w of (sal.weeks || [])) merge(w.saturday, 'sal', w);
    if (ate) for (const w of (ate.weeks || [])) merge(w.saturday, 'ate', w);
    if (aseo) for (const w of (aseo.weeks || [])) merge(w.saturday, 'aseo', w);

    // Orden cronológico de fechas únicas.
    const fechas = [...porFecha.keys()].sort();
    for (const fecha of fechas) {
      const { mes, sal, ate, aseo } = porFecha.get(fecha);
      const base = mes || sal || ate || aseo || {};
      const semana = {
        fecha,
        tipo: base.type || 'normal',
        tituloDiscurso: (mes && mes.tituloDiscurso) || '',
        presidente: (mes && mes.presidente) || '',
        orador: (mes && mes.orador) || '',
        conductor: (mes && mes.conductor) || '',
        lector: (mes && mes.lector) || '',
        estudioSinLectura: (mes && mes.estudioSinLectura) || '',
        discursoSupervisor1: (mes && mes.discursoSupervisor1) || '',
        discursoSupervisor2: (mes && mes.discursoSupervisor2) || '',
        nombreSupervisor: (mes && mes.nombreSupervisor) || '',
        departamento: (mes && mes.departamento) || '',
        // salidas: oradores (programa de salidas, o outings del mes si no hay)
        salidas: ((sal && sal.outings) || (mes && mes.outings) || []).map(o => ({ oradorSalida: (o && o.oradorSalida) || '', tituloDiscurso: (o && o.tituloDiscurso) || '' })),
        // atencion (acomodación) del fin de semana
        atencion: (ate && ate.labores) || (mes && mes.labores) || {},
        // aseo del mes
        aseo: (aseo && aseo.group) ? { grupo: aseo.group } : {},
      };
      semanas.push(semana);
    }

    docs.push({
      collection: 'programas',
      id: mes,
      data: {
        mes,
        year: month ? month.year : Number(mes.slice(0, 4)),
        month: month ? month.month : Number(mes.slice(5, 7)),
        semanas,
        published: month ? !!month.published : false,
        createdAt: month ? month.createdAt : now,
      },
    });
  }

  // ---- Asignaciones (assignment_log → asignaciones) ----
  for (const a of (exported.assignmentLog || [])) {
    const fecha = String(a.date || '');
    docs.push({
      collection: 'asignaciones',
      id: String(a.id),
      data: {
        fecha,
        reunionId: (a.program === 'entre') ? fecha : '',
        programaId: fecha ? fecha.slice(0, 7) : '',
        participanteId: String(a.personId || ''),
        actividadId: String(a.roleKey || ''),
        rol: String(a.roleLabel || a.roleKey || ''),
        program: String(a.program || ''),
        createdAt: a.updatedAt || now,
      },
    });
  }

  // ---- Configuración (settings → configuracion/general) ----
  docs.push({
    collection: 'configuracion',
    id: 'general',
    data: {
      congregacion: (exported.settings && exported.settings.congregation) || '',
      lastMonthId: (exported.settings && exported.settings.lastMonthId) || null,
      config: (exported.settings && exported.settings.config) || {},
      laboresEquipo: (exported.settings && exported.settings.laboresEquipo) || (exported.laboresEquipo || []),
      createdAt: now,
    },
  });

  return docs;
}

// Ejecuta la migración completa. Devuelve un reporte { colecciones: { colección: n }, total }.
// Si Firebase no está configurado, devuelve { error: 'firebase-no-configurado' }.
export async function migrarDatos() {
  const exported = await db.exportAll();
  const docs = convertirADocumentosFirestore(exported);
  const escrito = await batchWrite(docs);
  if (escrito === 0 && docs.length > 0) {
    return { error: 'firebase-no-configurado', totalDocs: docs.length };
  }
  const reporte = { total: docs.length, escrito, colecciones: {} };
  for (const d of docs) reporte.colecciones[d.collection] = (reporte.colecciones[d.collection] || 0) + 1;
  return reporte;
}
