// sync.js - Sincronización IndexedDB ↔ Supabase (Fase 5)
// =========================================================
// Conecta el punto único de escritura de db.js (onSync) con Supabase para que
// los cambios locales se reflejen en la nube, y descarga la nube al iniciar.
//
// Opción A aprobada: IndexedDB sigue siendo la fuente de verdad local (offline);
// Supabase actúa como espejo en la nube. Esta capa NO reemplaza las lecturas
// de la app: la app sigue leyendo de db.js y esta capa sincroniza en segundo
// plano.
//
// Mapeo store local → colección Supabase:
//   people      → participantes   (con transformación de campos)
//   departments → grupos
//   midweeks    → reuniones
//   months/salidas/atencion/aseos → programas (se fusionan por mes)
//   assignment_log → asignaciones
//   settings    → configuracion/general

import * as db from './db.js';
import { addDays } from './logic.js';
import { batchWrite, isSupabaseReady } from './supabase.js?v=219';
import { isSupabaseConfigured } from './supabase-config.js?v=218';
import { isAdmin, isAuthenticated } from './auth.js';

let _enabled = false;
let _syncing = false;
let _lastStatus = { state: 'inactivo', detail: '', at: null };
let _dirty = false;

// ¿Hay cambios locales aún sin confirmar en Supabase? (nube roja)
export function hayCambiosPendientes() {
  return _dirty;
}

function dispatchDirty() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('reunion-dirty', { detail: { pending: _dirty } }));
  }
}

function marcarDirty() {
  if (!_dirty) { _dirty = true; dispatchDirty(); }
}

// Recalcula _dirty a partir de la cola de pendientes (fuente de verdad).
async function marcarSegunPendientes() {
  const pend = await leerPendientes();
  const nuevo = pend.length > 0;
  if (nuevo !== _dirty) { _dirty = nuevo; dispatchDirty(); }
  return _dirty;
}

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

// Última fecha/hora de un guardado CONFIRMADO en Supabase (no un cambio local).
let _lastSavedAt = null;
export function lastSavedAt() {
  return _lastSavedAt;
}

async function registrarGuardado() {
  _lastSavedAt = Date.now();
  try { await db.setSettingSilent('lastSavedAt', new Date(_lastSavedAt).toISOString()); } catch (e) { /* noop */ }
}

// Todos los stores se encolan para subir al pulsar "Sincronizar".
// El indicador de "Cambios sin guardar" aparece automáticamente al encolar.
function marcarLocal(store) {
  encolarPendienteAsync(store).then(() => marcarDirty());
}

// Sube explícitamente un conjunto de stores (al pulsar Guardar en un editor).
// Respeta la cola offline y el estado de sincronización.
export async function subirStores(stores) {
  if (!_enabled) return { error: 'inactivo' };
  if (!navigator.onLine) { (stores || []).forEach(s => encolarPendienteAsync(s).then(() => marcarDirty())); return { error: 'offline' }; }
  if (!(await isSupabaseReady())) { (stores || []).forEach(s => encolarPendienteAsync(s).then(() => marcarDirty())); return { error: 'supabase-no-disponible' }; }
  setStatus('syncing', 'guardando cambios…');
  for (const s of (stores || [])) {
    await pushStore(s);
  }
  return { ok: true };
}

// Descarta el borrador local: vacía la cola de pendientes y deja el estado
// "sincronizado" (se llama tras restaurar desde Supabase).
export async function descartarLocal() {
  await guardarPendientes([]);
  await marcarSegunPendientes();
}

// Convierte un registro de personas (IndexedDB) a documento Supabase.
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
      phone: p.phone || '',
      email: p.email || '',
      prioridad: p.prioridad || 0,
      nacimiento: p.nacimiento || '',
      bautismo: p.bautismo || '',
      precursorRegular: p.precursorRegular === true,
      activo: p.activo !== false,
      createdAt: p.createdAt || Date.now(),
    },
  };
}

// Convierte un registro de grupo (departments) a documento Supabase.
function grupoADocumento(g) {
  return {
    collection: 'grupos',
    id: String(g.id),
    data: {
      nombre: g.name || '',
      orden: g.orden || 0,
      labores: g.labores || '',
      encargadoId: g.encargadoId || '',
      activo: g.activo !== false,
      createdAt: g.createdAt || Date.now(),
    },
  };
}

// Convierte una semana de entre semana (midweeks) a documento Supabase.
function reunionADocumento(mw) {
  return {
    collection: 'reuniones',
    id: String(mw.id),
    data: {
      fecha: String(mw.id),
      tipo: 'entre',
      evento: mw.type || 'no_event',
      lectura: mw.reading || '',
      canciones: { intro: mw.songIn || 0, salida: mw.songOut || 0 },
      introTitle: mw.introTitle || 'Palabras de introducción',
      introMins: mw.introMins || 1,
      closingTitle: mw.closingTitle || 'Palabras de conclusión',
      closingMins: mw.closingMins || 3,
      header: mw.header || '',
      estado: mw.estado || 'normal',
      presidente: mw.presidente || '',
      orador: mw.orador || '',
      oracionPan: mw.oracionPan || '',
      oracionVino: mw.oracionVino || '',
      discursoSupervisor1: mw.discursoSupervisor1 || '',
      discursoSupervisor2: mw.discursoSupervisor2 || '',
      nombreSupervisor: mw.nombreSupervisor || '',
      tituloDiscursoSupervisor: mw.tituloDiscursoSupervisor || '',
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
// documento Supabase programas/{mes}. Devuelve null si no hay ningún dato.
async function mesADocumento(mes, version = 0) {
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
      tipo: base.type || 'no_event',
      tituloDiscurso: (mes && mes.tituloDiscurso) || '',
      presidente: (mes && mes.presidente) || '',
      orador: (mes && mes.orador) || '',
      oracionPan: (mes && mes.oracionPan) || '',
      oracionVino: (mes && mes.oracionVino) || '',
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
      version: version || 0,
      updatedAt: Date.now(),
      createdAt: month ? month.createdAt : Date.now(),
    },
  };
}

// Sube los datos de un store local modificado a Supabase.
// Si no hay red o falla, el store queda PENDIENTE para reintentarse cuando haya
// conexión (cola de sincronización offline).
async function pushStore(store) {
  if (!_enabled) return;
  if (_syncing) { await encolarPendienteAsync(store); marcarDirty(); return; }
  if (!navigator.onLine) { await encolarPendienteAsync(store); marcarDirty(); return; }
  const ready = await isSupabaseReady();
  if (!ready) { await encolarPendienteAsync(store); marcarDirty(); return; }
  _syncing = true;
  let errorSync = false;
  try {
    if (store === 'people') {
      const people = await db.listPeopleAll();
      await batchWrite(people.map(personaADocumento));
      setStatus('ok', `participantes: ${people.length}`);
    } else if (store === 'departments') {
      const grupos = await db.listDepartmentsAll();
      await batchWrite(grupos.map(grupoADocumento));
      setStatus('ok', `grupos: ${grupos.length}`);
    } else if (store === 'midweeks') {
      const midweeks = await db.listMidweeks();
      await batchWrite(midweeks.map(reunionADocumento));
      setStatus('ok', `reuniones: ${midweeks.length}`);
    } else if (store === 'talks') {
      const talks = await db.listTalks();
      await batchWrite(talks.map(t => ({
        collection: 'discursos',
        id: String(t.num),
        data: { num: t.num, title: t.title || '', createdAt: Date.now() },
      })));
      setStatus('ok', `discursos: ${talks.length}`);
    } else if (store === 'months' || store === 'salidas' || store === 'atencion' || store === 'aseos') {
      // Reconstruir los programas de todos los meses afectados (el store cambió
      // completo, no sabemos qué mes; se sincronizan todos los meses existentes).
      const meses = new Set([
        ...(await db.listMonths()).map(m => String(m.id)),
        ...(await db.listSalidas()).map(s => String(s.id)),
        ...(await db.listAtencion()).map(a => String(a.id)),
        ...(await db.listAseos()).map(a => String(a.id)),
      ]);
      // Control de versiones (spec 24): si algún mes cambió en Supabase desde la
      // última sincronización conocida, NO sobrescribir en silencio.
      const f = await import('./supabase.js?v=219');
      const versiones = await leerVersiones();
      const conflictos = [];
      const docs = [];
      for (const mes of meses) {
        const local = versiones[mes] || 0;
        let rv = 0;
        try {
          const remoto = await f.obtenerPrograma(mes);
          rv = (remoto && Number(remoto.version)) || 0;
        } catch (e) { /* sin datos remotos: se considera 0 */ }
        if (rv > local) { conflictos.push(mes); continue; }
        const d = await mesADocumento(mes, local + 1);
        if (d) docs.push(d);
      }
      if (conflictos.length) {
        setStatus('error', `Los datos cambiaron en Supabase: ${conflictos.join(', ')}. Actualiza antes de guardar.`);
        return;
      }
      await batchWrite(docs);
      const nv = { ...versiones };
      for (const mes of meses) nv[mes] = (versiones[mes] || 0) + 1;
      await guardarVersiones(nv);
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
    } else if (store === 'activity') {
      const docs = await db.listActivity();
      await batchWrite(docs.map(r => ({ collection: 'actividad', id: String(r.id), data: r })));
      setStatus('ok', `actividad: ${docs.length}`);
    } else if (store === 'actividad_revision') {
      const docs = await db.listActividadRevision();
      await batchWrite(docs.map(r => ({ collection: 'actividad_revision', id: String(r.id), data: r })));
      setStatus('ok', `actividad_revision: ${docs.length}`);
    } else if (store === 'attendance') {
      const docs = await db.listAttendance();
      await batchWrite(docs.map(r => ({ collection: 'asistencia', id: String(r.id), data: r })));
      setStatus('ok', `asistencia: ${docs.length}`);
    } else if (store === 'arrangements') {
      const docs = await db.listArrangements();
      await batchWrite(docs.map(r => ({ collection: 'arreglos', id: String(r.id), data: r })));
      setStatus('ok', `arreglos: ${docs.length}`);
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
    errorSync = true;
    // Cupo de Supabase superado: NO encolar para no martillar el backend con
    // reintentos (el SDK ya aplica backoff). Se informa y se deja como local.
    const msg = String((e && (e.code || e.message)) || e || '');
    if (e && (e.code === 'resource-exhausted' || /quota|resource-exhausted/i.test(msg))) {
      setStatus('error', 'Cupo de Supabase superado: los cambios quedan en este dispositivo y se subirán más tarde.');
      return;
    }
    // Queda pendiente para reintentar cuando haya conexión.
    encolarPendiente(store);
    setStatus('error', store + ': ' + (e.message || e) + ' (pendiente)');
  } finally {
    _syncing = false;
  }
  if (!errorSync) {
    await quitarPendiente(store);
    await marcarSegunPendientes();
    await registrarGuardado();
  }
}

// ---- Cola de pendientes (offline) ----
// Los stores modificados sin conexión (o con error) se guardan en IndexedDB
// (settings) y se reintentan al volver la red.
const SETTING_PENDIENTES = 'sync_pendientes';

async function leerPendientes() {
  const arr = await db.getSetting(SETTING_PENDIENTES, []);
  return Array.isArray(arr) ? arr : [];
}

async function guardarPendientes(arr) {
  await db.setSettingSilent(SETTING_PENDIENTES, Array.isArray(arr) ? arr : []);
}

// Versiones conocidas de cada mes (para detectar cambios remotos, spec 24).
const SETTING_VERSIONES = 'versiones_mes';

async function leerVersiones() {
  const v = await db.getSetting(SETTING_VERSIONES, {});
  return (v && typeof v === 'object') ? v : {};
}

async function guardarVersiones(v) {
  await db.setSettingSilent(SETTING_VERSIONES, v || {});
}

// Sincroniza las versiones locales desde los documentos descargados de Supabase.
async function adoptarVersiones(programas) {
  const v = await leerVersiones();
  let cambio = false;
  (programas || []).forEach(p => {
    const mes = String(p.id || p.mes || '');
    const rv = Number(p.version) || 0;
    if (mes && rv > (v[mes] || 0)) { v[mes] = rv; cambio = true; }
  });
  if (cambio) await guardarVersiones(v);
}

// Encola con persistencia en IndexedDB (cola de sincronización offline).
async function encolarPendienteAsync(store) {
  const pend = await leerPendientes();
  if (!pend.includes(store)) {
    pend.push(store);
    await guardarPendientes(pend);
  }
  setStatus('pending', `pendiente: ${pend.join(', ')}`);
}

function encolarPendiente(store) {
  encolarPendienteAsync(store);
}

// Quita un store de la cola de pendientes tras subirlo. Los stores de un mismo
// mes (months/salidas/atencion/aseos) se sincronizan juntos: se limpian en grupo.
async function quitarPendiente(store) {
  const pend = await leerPendientes();
  const familia = new Set(['months', 'salidas', 'atencion', 'aseos']);
  const rest = pend.filter(s => s !== store && !(familia.has(store) && familia.has(s)));
  await guardarPendientes(rest);
}

// Devuelve los stores pendientes de sincronizar.
export async function pendientesPendientes() {
  return leerPendientes();
}

// Reintenta subir todos los stores pendientes (al recuperar conexión).
export async function drenarPendientes() {
  if (!_enabled) return;
  if (!navigator.onLine) return;
  if (!(await isSupabaseReady())) return;
  const pend = await leerPendientes();
  if (!pend.length) return;
  setStatus('syncing', 'sincronizando pendientes…');
  const restantes = [];
  for (const store of pend) {
    try {
      await pushStore(store);
    } catch (e) {
      restantes.push(store);
    }
  }
  await guardarPendientes(restantes);
  await marcarSegunPendientes();
  if (restantes.length) setStatus('error', 'pendientes sin sincronizar: ' + restantes.join(', '));
  else { setStatus('ok', 'pendientes sincronizados'); await registrarGuardado(); }
}

// Subida forzada de todos los datos locales a Supabase. La usa el botón
// "Guardar cambios" del encabezado: garantiza que todo lo que hay en IndexedDB
// se refleje en la nube aunque la cola de pendientes esté vacía.
export async function sincronizarAhora() {
  if (!isSupabaseConfigured()) return { error: 'no-configurado' };
  if (!navigator.onLine) return { error: 'offline' };
  if (!(await isSupabaseReady())) return { error: 'supabase-no-disponible' };
  if (!isAuthenticated()) return { error: 'sin-sesion' };
  if (_syncing) return { error: 'ocupado' };
  if (!_enabled) await iniciarSync();
  setStatus('syncing', 'subiendo cambios…');
  const stores = ['people', 'departments', 'midweeks', 'talks', 'months', 'assignment_log', 'settings', 'activity', 'actividad_revision', 'attendance', 'arrangements'];
  for (const store of stores) await pushStore(store);
  // Si algún store falló por cupo de Supabase, informarlo (no dar éxito).
  if (_lastStatus && _lastStatus.state === 'error') {
    return { error: 'quota-exceeded' };
  }
  const pend = await leerPendientes();
  if (pend.length) {
    setStatus('error', 'hubo errores al subir: ' + pend.join(', '));
    return { error: 'parcial' };
  }
  await registrarGuardado();
  setStatus('ok', 'cambios subidos');
  return { ok: true };
}

// Descarga todos los datos de Supabase y los escribe en IndexedDB (pull).
// Sobrescribe local con lo de la nube. Solo se invoca si no hay datos locales
// (primer uso en otro dispositivo) o al pulsar "Descargar desde Supabase".
export async function pullAll() {
  if (!(await isSupabaseReady())) return { error: 'supabase-no-disponible' };
  // Desactivar sync durante la escritura local para evitar bucles.
  const estaba = _enabled;
  _enabled = false;
  try {
    const f = await import('./supabase.js?v=219');
    const [participantes, grupos, reuniones, programas, asignaciones, configuracion, discursos, actividad, asistencia, arreglos, revisiones] = await Promise.all([
      f.obtenerParticipantes(),
      f.obtenerGrupos(),
      f.obtenerReuniones(),
      f.obtenerProgramas(),
      f.obtenerAsignaciones(),
      f.obtenerConfiguracion(),
      f.obtenerTalks(),
      f.obtenerActividad(),
      f.obtenerAsistencia(),
      f.obtenerArreglos(),
      f.obtenerActividadRevision(),
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
      phone: p.phone || '',
      email: p.email || '',
      prioridad: p.prioridad || 0,
      nacimiento: p.nacimiento || '',
      bautismo: p.bautismo || '',
      precursorRegular: p.precursorRegular === true,
      grupoId: p.grupoId || '',
      activo: p.activo !== false,
      createdAt: p.createdAt || Date.now(),
    }));
    await db.replaceAllPeopleSilent(personasDesdeCloud);

    // grupos
    await db.replaceAllDepartmentsSilent(grupos.map(g => ({
      id: String(g.id), name: g.nombre || '', orden: g.orden || 0, labores: g.labores || '', encargadoId: g.encargadoId || '', activo: g.activo !== false, createdAt: g.createdAt || Date.now(),
    })));

    // reuniones
    for (const r of reuniones) {
      await db.putMidweekSilent({
        id: String(r.id),
        type: r.evento || 'no_event',
        header: r.header || '',
        reading: r.lectura || '',
        songIn: (r.canciones && r.canciones.intro) || 0,
        songOut: (r.canciones && r.canciones.salida) || 0,
        introTitle: r.introTitle,
        introMins: r.introMins,
        closingTitle: r.closingTitle,
        closingMins: r.closingMins,
        estado: r.estado || 'normal',
        presidente: r.presidente || '',
        orador: r.orador || '',
        oracionPan: r.oracionPan || '',
        oracionVino: r.oracionVino || '',
        discursoSupervisor1: r.discursoSupervisor1 || '',
        discursoSupervisor2: r.discursoSupervisor2 || '',
        nombreSupervisor: r.nombreSupervisor || '',
        tituloDiscursoSupervisor: r.tituloDiscursoSupervisor || '',
        sections: r.sections || [],
        createdAt: r.createdAt || Date.now(),
      });
    }

    // programas: des-fusionar en months/salidas/atencion/aseos
    for (const p of programas) await desplegarPrograma(p);
    await adoptarVersiones(programas);

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
    // discursos
    await db.replaceAllTalksSilent(discursos.map(d => ({ num: Number(d.num), title: d.title || '' })));
    for (const d of actividad || []) await db.putActivitySilent(d);
    for (const d of asistencia || []) await db.putAttendanceSilent(d);
    for (const d of arreglos || []) await db.putArrangementsSilent(d);
    for (const d of revisiones || []) await db.putActividadRevisionSilent(d);
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
    monday: addDays(s.fecha, -5),
    saturday: s.fecha,
    type: s.tipo || s.type || 'no_event',
    outings: (s.salidas || []).map(o => ({ oradorSalida: o.oradorSalida, tituloDiscurso: o.tituloDiscurso })),
    labores: s.atencion || {},
    group: (s.aseo && s.aseo.grupo) || '',
  }));
  if (prog.mes && prog.month && semanas.length) {
    const limpiar = (w) => {
      const { tipo, salidas, atencion, aseo, ...rest } = w;
      return { ...rest, outings: w.outings };
    };
    await db.putMonthSilent({ id: mes, year: prog.year, month: prog.month, weeks: semanas.map(limpiar), published: !!prog.published });
    await db.putSalidasSilent({ id: mes, weeks: semanas.map(w => ({ monday: addDays(w.fecha, -5), saturday: w.fecha, outings: w.outings })) });
    await db.putAtencionSilent({ id: mes, weeks: semanas.map(w => ({ monday: addDays(w.fecha, -5), saturday: w.fecha, labores: w.labores })) });
    await db.putAseoSilent({ id: mes, weeks: semanas.map(w => ({ monday: addDays(w.fecha, -5), saturday: w.fecha, group: w.group })) });
  }
}

// Activa la sincronización: registra el hook y arranca el pull inicial si el
// store local está vacío (primer uso en el dispositivo). Reintenta pendientes.
export async function iniciarSync() {
  if (_enabled) return;
  if (!isSupabaseConfigured()) { setStatus('inactivo', 'Supabase no configurado'); return; }
  const ready = await isSupabaseReady();
  if (!ready) { setStatus('inactivo', 'Supabase no disponible'); return; }
  _enabled = true;
  db.onSync(marcarLocal);
  const saved = await db.getSetting('lastSavedAt', null).catch(() => null);
  if (saved) _lastSavedAt = typeof saved === 'string' ? Date.parse(saved) : saved;
  // Reintentar pendientes al volver a estar en línea.
  window.addEventListener('online', () => drenarPendientes().catch(() => {}));
  setStatus('conectado', 'sincronización activa');
  await drenarPendientes().catch(() => {});
  await pullSiVacio();
  // Concilia ambos lados: sube lo local que falta en la nube y baja lo de la
  // nube que falta en local.
  await reconciliar().catch(() => {});
  await marcarSegunPendientes().catch(() => {});
}

// Conciliación bidireccional IndexedDB ↔ Supabase.
// Compara los ids de cada dominio:
//   - registros locales que NO existen en Supabase → se suben a la nube (push);
//   - registros remotos que NO existen en IndexedDB → se descargan a local (pull).
// No elimina nada en ninguna dirección: solo llena los huecos de ambos lados.
export async function reconciliar() {
  if (!_enabled || _syncing) return { error: 'inactivo' };
  if (!navigator.onLine) return { error: 'offline' };
  if (!isAuthenticated()) return { error: 'sin-sesion' };
  if (!(await isSupabaseReady())) return { error: 'supabase-no-disponible' };
  _syncing = true;
  const f = await import('./supabase.js?v=219');
  const puedeEscribir = isAdmin();
  let subidos = 0, bajados = 0;
  try {
    setStatus('syncing', 'sincronizando datos…');

    // ---- personas: people ↔ participantes ----
    const personas = await db.listPeople();
    const participantes = await f.obtenerParticipantes();
    const idsParticipantes = new Set(participantes.map(p => String(p.id)));
    const idsPersonas = new Set(personas.map(p => String(p.id)));
    const personasASubir = personas.filter(p => !idsParticipantes.has(String(p.id)));
    if (puedeEscribir && personasASubir.length) { await batchWrite(personasASubir.map(personaADocumento)); subidos += personasASubir.length; }
    for (const pr of participantes) {
      if (idsPersonas.has(String(pr.id))) continue;
      await db.putPersonSilent({
        id: Number(pr.id) || String(pr.id),
        name: pr.nombre || '',
        labores: pr.labores || [],
        cargos: pr.cargos || [],
        genero: pr.genero || '',
        calificacion: pr.calificacion || '',
        enlace: pr.enlace || '',
        grupoId: pr.grupoId || '',
        activo: pr.activo !== false,
        createdAt: pr.createdAt || Date.now(),
      });
      bajados++;
    }

    // ---- grupos: departments ↔ grupos ----
    const departments = await db.listDepartments();
    const grupos = await f.obtenerGrupos();
    const idsGrupos = new Set(grupos.map(g => String(g.id)));
    const idsDepts = new Set(departments.map(d => String(d.id)));
    const deptsASubir = departments.filter(d => !idsGrupos.has(String(d.id)));
    if (puedeEscribir && deptsASubir.length) { await batchWrite(deptsASubir.map(grupoADocumento)); subidos += deptsASubir.length; }
    for (const g of grupos) {
      if (idsDepts.has(String(g.id))) continue;
      await db.putDepartmentSilent({
        id: String(g.id),
        name: g.nombre || '',
        orden: g.orden || 0,
        labores: g.labores || '',
        activo: g.activo !== false,
        createdAt: g.createdAt || Date.now(),
      });
      bajados++;
    }

    // ---- entre semana: midweeks ↔ reuniones ----
    const midweeks = await db.listMidweeks();
    const reuniones = await f.obtenerReuniones();
    const idsReuniones = new Set(reuniones.map(r => String(r.id)));
    const idsMidweeks = new Set(midweeks.map(m => String(m.id)));
    const midweeksASubir = midweeks.filter(m => !idsReuniones.has(String(m.id)));
    if (puedeEscribir && midweeksASubir.length) { await batchWrite(midweeksASubir.map(reunionADocumento)); subidos += midweeksASubir.length; }
    for (const r of reuniones) {
      if (idsMidweeks.has(String(r.id))) continue;
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
      bajados++;
    }

    // ---- discursos: talks ↔ discursos ----
    const talks = await db.listTalks();
    const discursos = await f.obtenerDiscursos();
    const idsDiscursos = new Set(discursos.map(d => String(d.num)));
    const idsTalks = new Set(talks.map(t => String(t.num)));
    const talksASubir = talks.filter(t => !idsDiscursos.has(String(t.num)));
    if (puedeEscribir && talksASubir.length) {
      await batchWrite(talksASubir.map(t => ({
        collection: 'discursos',
        id: String(t.num),
        data: { num: t.num, title: t.title || '', createdAt: Date.now() },
      })));
      subidos += talksASubir.length;
    }
    for (const d of discursos) {
      if (String(d.num) === 'undefined' || idsTalks.has(String(d.num))) continue;
      await db.putTalkSilent({ num: Number(d.num), title: d.title || '', createdAt: d.createdAt || Date.now() });
      bajados++;
    }

    // ---- programas: months/salidas/atencion/aseos ↔ programas/{mes} ----
    const programas = await f.obtenerProgramas();
    const idsProgramas = new Set(programas.map(p => String(p.id)));
    const mesesLocales = new Set([
      ...(await db.listMonths()).map(m => String(m.id)),
      ...(await db.listSalidas()).map(s => String(s.id)),
      ...(await db.listAtencion()).map(a => String(a.id)),
      ...(await db.listAseos()).map(a => String(a.id)),
    ]);
    const mesesASubir = [...mesesLocales].filter(mes => !idsProgramas.has(mes));
    for (const mes of mesesASubir) {
      if (puedeEscribir) { const d = await mesADocumento(mes, (await leerVersiones())[mes] || 0); if (d) { await batchWrite([d]); subidos++; } }
    }
    for (const p of programas) {
      if (mesesLocales.has(String(p.id))) continue;
      await desplegarPrograma(p);
      bajados++;
    }
    await adoptarVersiones(programas);

    // ---- historial: assignment_log ↔ asignaciones ----
    const log = await db.listAssignmentLog();
    const asignaciones = await f.obtenerAsignaciones();
    const idsAsignaciones = new Set(asignaciones.map(a => String(a.id)));
    const idsLog = new Set(log.map(a => String(a.id)));
    const logASubir = log.filter(a => !idsAsignaciones.has(String(a.id)));
    if (puedeEscribir && logASubir.length) {
      await batchWrite(logASubir.map(a => ({
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
      })));
      subidos += logASubir.length;
    }
    for (const a of asignaciones) {
      if (idsLog.has(String(a.id))) continue;
      await db.putAssignmentLogSilent({
        id: String(a.id),
        personId: String(a.participanteId || ''),
        date: String(a.fecha || ''),
        program: String(a.program || ''),
        roleKey: String(a.actividadId || ''),
        roleLabel: String(a.rol || ''),
        updatedAt: a.createdAt || Date.now(),
      });
      bajados++;
    }

    // ---- actividad_revision ↔ actividad_revision (revisiones del user) ----
    const revsLocales = await db.listActividadRevision();
    const revsRemotas = await f.obtenerActividadRevision();
    const idsRevLocal = new Set(revsLocales.map(r => String(r.id)));
    const idsRevRemota = new Set(revsRemotas.map(r => String(r.id)));
    const revsASubir = revsLocales.filter(r => !idsRevRemota.has(String(r.id)));
    if (revsASubir.length) { await batchWrite(revsASubir.map(r => ({ collection: 'actividad_revision', id: String(r.id), data: r }))); subidos += revsASubir.length; }
    for (const r of revsRemotas) {
      if (idsRevLocal.has(String(r.id))) continue;
      await db.putActividadRevisionSilent(r);
      bajados++;
    }

    setStatus('ok', `datos sincronizados`);
    await registrarGuardado();
    return { ok: true, subidos, bajados };
  } catch (e) {
    console.warn('[Reunión+] Error en sync', e);
    const msg = String((e && (e.code || e.message)) || e || '');
    if (e && (e.code === 'resource-exhausted' || /quota|resource-exhausted/i.test(msg))) {
      setStatus('error', 'Cupo de Supabase superado: se reintentará más tarde.');
      return { error: 'quota-exceeded' };
    }
    setStatus('error', 'sync: ' + (e.message || e));
    return { error: e.message || String(e) };
  } finally {
    _syncing = false;
  }
}

// Si la base local está vacía, descarga los datos desde Supabase. Se usa al
// iniciar y después de iniciar sesión (en un segundo dispositivo con la cuenta
// ya creada, los datos llegan automáticamente). Además re-descarga cuando la
// versión de datos esperada cambia (p.ej. al introducir el campo
// `precursorRegular`), para que los dispositivos con datos antiguos se actualicen.
const SETTING_DATA_VERSION = 'dataVersion';
const DATA_VERSION = 2;
export async function pullSiVacio() {
  if (!_enabled) return;
  const [people, programas] = await Promise.all([db.listPeople(), db.listMonths()]);
  const dataVersion = await db.getSetting(SETTING_DATA_VERSION, null);
  const vacio = people.length === 0 && programas.length === 0;
  if (vacio || dataVersion !== DATA_VERSION) {
    const msj = vacio ? 'descargando datos de Supabase…' : 'actualizando datos de Supabase…';
    setStatus('syncing', msj);
    await pullAll();
    await db.setSetting(SETTING_DATA_VERSION, DATA_VERSION);
    setStatus('ok', vacio ? 'datos descargados de Supabase' : 'datos actualizados de Supabase');
  }
}
