// sync.js - Sincronización IndexedDB ↔ Firestore (Fase 5)
// =========================================================
// Conecta el punto único de escritura de db.js (onSync) con Firestore para que
// los cambios locales se reflejen en la nube, y descarga la nube al iniciar.
//
// Opción A aprobada: IndexedDB sigue siendo la fuente de verdad local (offline);
// Firestore actúa como espejo en la nube. Esta capa NO reemplaza las lecturas
// de la app: la app sigue leyendo de db.js y esta capa sincroniza en segundo
// plano.
//
// Mapeo store local → colección Firestore:
//   people      → participantes   (con transformación de campos)
//   departments → grupos
//   midweeks    → reuniones
//   months/salidas/atencion/aseos → programas (se fusionan por mes)
//   assignment_log → asignaciones
//   settings    → configuracion/general

import * as db from './db.js';
import { batchWrite, isFirebaseReady } from './firestore.js';
import { isFirebaseConfigured } from './firebase-config.js';

let _enabled = false;
let _syncing = false;
let _lastStatus = { state: 'inactivo', detail: '', at: null };

// Estado actual de la sincronización (para la interfaz).
export function syncStatus() {
  return _lastStatus;
}

function setStatus(state, detail) {
  _lastStatus = { state, detail, at: Date.now() };
  // Hook opcional para la UI
  if (typeof window !== 'undefined') {
    const evt = new CustomEvent('reunion-sync', { detail: _lastStatus });
    window.dispatchEvent(evt);
  }
}

// ¿La sincronización está activa?
export function isSyncEnabled() {
  return _enabled;
}

// Convierte un registro de personas (IndexedDB) a documento Firestore.
function personaADocumento(p) {
  return {
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
      createdAt: p.createdAt || Date.now(),
    },
  };
}

// Convierte un registro de grupo (departments) a documento Firestore.
function grupoADocumento(g) {
  return {
    collection: 'grupos',
    id: String(g.id),
    data: {
      nombre: g.name || '',
      orden: g.orden || 0,
      labores: g.labores || '',
      activo: g.activo !== false,
      createdAt: g.createdAt || Date.now(),
    },
  };
}

// Convierte una semana de entre semana (midweeks) a documento Firestore.
function reunionADocumento(mw) {
  return {
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
      sections: (mw.sections || []).map(sec => ({
        id: sec.id,
        title: sec.title,
        parts: (sec.parts || []).map(p => ({ num: p.num, title: p.title, mins: p.mins, assignments: p.assignments || {} })),
      })),
      createdAt: mw.createdAt || Date.now(),
    },
  };
}

// Convierte los 4 programas del mes (months/salidas/atencion/aseos) a UN
// documento Firestore programas/{mes}. Devuelve null si no hay ningún dato.
async function mesADocumento(mes) {
  const [month, sal, ate, aseo] = await Promise.all([
    db.getMonth(mes),
    db.getSalidas(mes),
    db.getAtencion(mes),
    db.getAseo(mes),
  ]);
  if (!month && !sal && !ate && !aseo) return null;

  const porFecha = new Map();
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

  const semanas = [...porFecha.keys()].sort().map(fecha => {
    const { mes, sal, ate, aseo } = porFecha.get(fecha);
    const base = mes || sal || ate || aseo || {};
    return {
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
      salidas: ((sal && sal.outings) || (mes && mes.outings) || []).map(o => ({ oradorSalida: (o && o.oradorSalida) || '', tituloDiscurso: (o && o.tituloDiscurso) || '' })),
      atencion: (ate && ate.labores) || (mes && mes.labores) || {},
      aseo: (aseo && aseo.group) ? { grupo: aseo.group } : {},
    };
  });

  return {
    collection: 'programas',
    id: mes,
    data: {
      mes,
      year: month ? month.year : Number(mes.slice(0, 4)),
      month: month ? month.month : Number(mes.slice(5, 7)),
      semanas,
      published: month ? !!month.published : false,
      createdAt: month ? month.createdAt : Date.now(),
    },
  };
}

// Sube los datos de un store local modificado a Firestore.
async function pushStore(store) {
  if (!_enabled || _syncing) return;
  if (!(await isFirebaseReady())) return;
  _syncing = true;
  try {
    if (store === 'people') {
      const people = await db.listPeople();
      await batchWrite(people.map(personaADocumento));
      setStatus('ok', `participantes: ${people.length}`);
    } else if (store === 'departments') {
      const grupos = await db.listDepartments();
      await batchWrite(grupos.map(grupoADocumento));
      setStatus('ok', `grupos: ${grupos.length}`);
    } else if (store === 'midweeks') {
      const midweeks = await db.listMidweeks();
      await batchWrite(midweeks.map(reunionADocumento));
      setStatus('ok', `reuniones: ${midweeks.length}`);
    } else if (store === 'months' || store === 'salidas' || store === 'atencion' || store === 'aseos') {
      // Reconstruir los programas de todos los meses afectados (el store cambió
      // completo, no sabemos qué mes; se sincronizan todos los meses existentes).
      const meses = new Set([
        ...(await db.listMonths()).map(m => String(m.id)),
        ...(await db.listSalidas()).map(s => String(s.id)),
        ...(await db.listAtencion()).map(a => String(a.id)),
        ...(await db.listAseos()).map(a => String(a.id)),
      ]);
      const docs = [];
      for (const mes of meses) {
        const d = await mesADocumento(mes);
        if (d) docs.push(d);
      }
      await batchWrite(docs);
      setStatus('ok', `programas: ${docs.length}`);
    } else if (store === 'assignment_log') {
      const log = await db.listAssignmentLog();
      const docs = log.map(a => ({
        collection: 'asignaciones',
        id: String(a.id),
        data: {
          fecha: String(a.date || ''),
          reunionId: (a.program === 'entre') ? String(a.date || '') : '',
          programaId: String(a.date || '').slice(0, 7),
          participanteId: String(a.personId || ''),
          actividadId: String(a.roleKey || ''),
          rol: String(a.roleLabel || a.roleKey || ''),
          program: String(a.program || ''),
          createdAt: a.updatedAt || Date.now(),
        },
      }));
      await batchWrite(docs);
      setStatus('ok', `asignaciones: ${docs.length}`);
    } else if (store === 'settings') {
      const [congregation, lastMonthId, config, labores] = await Promise.all([
        db.getSetting('congregation', ''),
        db.getSetting('lastMonthId', null),
        db.getConfig(),
        db.getLabores(null),
      ]);
      await batchWrite([{
        collection: 'configuracion',
        id: 'general',
        data: {
          congregacion: congregation,
          lastMonthId,
          config,
          laboresEquipo: Array.isArray(labores) ? labores : [],
          createdAt: Date.now(),
        },
      }]);
      setStatus('ok', 'configuración: 1');
    }
  } catch (e) {
    console.warn('[Reunión+] Error al sincronizar store', store, e);
    setStatus('error', store + ': ' + (e.message || e));
  } finally {
    _syncing = false;
  }
}

// Descarga todos los datos de Firestore y los escribe en IndexedDB (pull).
// Sobrescribe local con lo de la nube. Solo se invoca si no hay datos locales
// (primer uso en otro dispositivo) o al pulsar "Descargar desde Firebase".
export async function pullAll() {
  if (!(await isFirebaseReady())) return { error: 'firebase-no-disponible' };
  // Desactivar sync durante la escritura local para evitar bucles.
  const estaba = _enabled;
  _enabled = false;
  try {
    const f = await import('./firestore.js');
    const [participantes, grupos, reuniones, programas, asignaciones, configuracion] = await Promise.all([
      f.obtenerParticipantes(),
      f.obtenerGrupos(),
      f.obtenerReuniones(),
      f.obtenerProgramas(),
      f.obtenerAsignaciones(),
      f.obtenerConfiguracion(),
    ]);

    // personas: participantes → registros people
    const personasDesdeCloud = participantes.map(p => ({
      id: Number(p.id) || String(p.id),
      name: p.nombre || '',
      labores: p.labores || [],
      cargos: p.cargos || [],
      genero: p.genero || '',
      calificacion: p.calificacion || '',
      enlace: p.enlace || '',
      grupoId: p.grupoId || '',
      activo: p.activo !== false,
      createdAt: p.createdAt || Date.now(),
    }));
    await db.replaceAllPeopleSilent(personasDesdeCloud);

    // grupos
    await db.replaceAllDepartmentsSilent(grupos.map(g => ({
      id: String(g.id), name: g.nombre || '', orden: g.orden || 0, labores: g.labores || '', createdAt: g.createdAt || Date.now(),
    })));

    // reuniones
    for (const r of reuniones) {
      await db.putMidweekSilent({
        id: String(r.id),
        header: r.header || '',
        reading: r.lectura || '',
        songIn: (r.canciones && r.canciones.intro) || 0,
        songOut: (r.canciones && r.canciones.salida) || 0,
        introTitle: r.introTitle,
        introMins: r.introMins,
        closingTitle: r.closingTitle,
        closingMins: r.closingMins,
        sections: r.sections || [],
        createdAt: r.createdAt || Date.now(),
      });
    }

    // programas: des-fusionar en months/salidas/atencion/aseos
    for (const p of programas) await desplegarPrograma(p);

    // asignaciones
    for (const a of asignaciones) {
      await db.putAssignmentLogSilent({
        id: String(a.id),
        personId: String(a.participanteId || ''),
        date: String(a.fecha || ''),
        program: String(a.program || ''),
        roleKey: String(a.actividadId || ''),
        roleLabel: String(a.rol || ''),
        updatedAt: a.createdAt || Date.now(),
      });
    }

    // configuración
    if (configuracion) {
      if (configuracion.congregacion) await db.setSettingSilent('congregation', configuracion.congregacion);
      if (configuracion.lastMonthId) await db.setSettingSilent('lastMonthId', configuracion.lastMonthId);
      if (configuracion.config) await db.setConfigSilent(configuracion.config);
      if (Array.isArray(configuracion.laboresEquipo)) await db.setLaboresSilent(configuracion.laboresEquipo);
    }
    setStatus('ok', 'pull completado');
    return { ok: true, participantes: participantes.length, programas: programas.length };
  } catch (e) {
    console.warn('[Reunión+] Error en pull', e);
    setStatus('error', 'pull: ' + (e.message || e));
    return { error: e.message || String(e) };
  } finally {
    _enabled = estaba;
  }
}

// Des-fusiona un documento programas/{mes} en los 4 stores locales.
async function desplegarPrograma(prog) {
  const mes = String(prog.id || prog.mes);
  const semanas = (prog.semanas || []).map(s => ({
    ...s,
    date: s.fecha,
    outings: (s.salidas || []).map(o => ({ oradorSalida: o.oradorSalida, tituloDiscurso: o.tituloDiscurso })),
    labores: s.atencion || {},
    group: (s.aseo && s.aseo.grupo) || '',
  }));
  if (prog.mes && prog.month && semanas.length) {
    await db.putMonthSilent({ id: mes, year: prog.year, month: prog.month, weeks: semanas.map(w => ({ ...w, labores: undefined, group: undefined, salidas: undefined, atencion: undefined, aseo: undefined, outings: w.outings })), published: !!prog.published });
    await db.putSalidasSilent({ id: mes, weeks: semanas.map(w => ({ saturday: w.fecha, outings: w.outings })) });
    await db.putAtencionSilent({ id: mes, weeks: semanas.map(w => ({ saturday: w.fecha, labores: w.labores })) });
    await db.putAseoSilent({ id: mes, weeks: semanas.map(w => ({ saturday: w.fecha, group: w.group })) });
  }
}

// Activa la sincronización: registra el hook y arranca el pull inicial si el
// store local está vacío (primer uso en el dispositivo).
export async function iniciarSync() {
  if (_enabled) return;
  if (!isFirebaseConfigured()) { setStatus('inactivo', 'Firebase no configurado'); return; }
  const ready = await isFirebaseReady();
  if (!ready) { setStatus('inactivo', 'Firebase no disponible'); return; }
  _enabled = true;
  db.onSync(pushStore);
  setStatus('conectado', 'sincronización activa');
  await pullSiVacio();
}

// Si la base local está vacía, descarga los datos desde Firebase. Se usa al
// iniciar y después de iniciar sesión (en un segundo dispositivo con la cuenta
// ya creada, los datos llegan automáticamente).
export async function pullSiVacio() {
  if (!_enabled) return;
  const [people, programas] = await Promise.all([db.listPeople(), db.listMonths()]);
  if (people.length === 0 && programas.length === 0) {
    setStatus('syncing', 'descargando datos de Firebase…');
    await pullAll();
    setStatus('ok', 'datos descargados de Firebase');
  }
}
