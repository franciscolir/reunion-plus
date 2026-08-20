// supabase.js - Capa de acceso a Supabase (Postgres + RLS)
// =========================================================
// Cada dominio (participantes, grupos, reuniones, programas, asignaciones,
// configuración, usuarios) es una tabla Postgres con columnas:
//   id text PK · data jsonb · updated_at timestamptz
// El documento (los campos de la app) vive entero en `data` (jsonb). Las reglas
// de seguridad son políticas RLS (ver supabase/schema.sql).
//
// Si Supabase no está configurado, todas las funciones devuelven null/[] y no
// hacen ninguna llamada de red (la app sigue funcionando offline con IndexedDB).

import { isSupabaseConfigured, getSupabase } from './supabase-config.js?v=217';

let _sb = null;
let _ready = false;

// Inicializa el cliente de Supabase de forma perezosa.
async function initSupabase() {
  if (_ready) return _sb;
  _ready = true;
  if (!isSupabaseConfigured()) return null;
  try {
    _sb = await getSupabase();
    return _sb;
  } catch (e) {
    console.warn('[Reunión+] Supabase no disponible (¿sin conexión o SDK no cargado?)', e);
    return null;
  }
}

// Convierte una fila (id + data jsonb) al formato documento { id, ...campos }.
const filaADoc = (r) => ({ id: r.id, ...(r.data || {}) });

// Lee todos los documentos de una tabla (los más recientes primero).
async function readAll(table) {
  const sb = await initSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from(table).select('*').order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(filaADoc);
}

async function readDoc(table, id) {
  const sb = await initSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from(table).select('*').eq('id', String(id)).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? filaADoc(data) : null;
}

async function writeDoc(table, id, data) {
  const sb = await initSupabase();
  if (!sb) return null;
  const payload = { ...data, updatedAt: Date.now() };
  if (!payload.createdAt) payload.createdAt = payload.updatedAt;
  const { error } = await sb.from(table).upsert(
    { id: String(id), data: payload, updated_at: new Date().toISOString() },
    { onConflict: 'id' }
  );
  if (error) throw new Error(error.message);
  return id;
}

async function deleteDoc(table, id) {
  const sb = await initSupabase();
  if (!sb) return null;
  const { error } = await sb.from(table).delete().eq('id', String(id));
  if (error) throw new Error(error.message);
  return id;
}

// Escribe muchos documentos en lote. `docs` = [{ collection, id, data }].
// Agrupa por tabla y hace upsert por id (idempotente). Devuelve nº escrito.
export async function batchWrite(docs) {
  const sb = await initSupabase();
  if (!sb || !docs.length) return 0;
  const now = new Date().toISOString();
  const nowNum = Date.now();
  const porTabla = {};
  for (const d of docs) {
    const payload = { ...d.data, updatedAt: nowNum };
    if (!payload.createdAt) payload.createdAt = nowNum;
    (porTabla[d.collection] ||= []).push({ id: String(d.id), data: payload, updated_at: now });
  }
  let written = 0;
  for (const [table, rows] of Object.entries(porTabla)) {
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await sb.from(table).upsert(rows.slice(i, i + 100), { onConflict: 'id' });
      if (error) throw new Error(error.message);
      written += Math.min(100, rows.length - i);
    }
  }
  return written;
}

// Estado de conexión: true si Supabase está disponible y listo.
export async function isSupabaseReady() {
  return !!(await initSupabase());
}

// ===== Participantes =====
export const obtenerParticipantes = () => readAll('participantes');
export const obtenerParticipante = (id) => readDoc('participantes', id);
export const guardarParticipante = (id, data) => writeDoc('participantes', id, data);
export const eliminarParticipante = (id) => deleteDoc('participantes', id);

// ===== Grupos =====
export const obtenerGrupos = () => readAll('grupos');
export const obtenerGrupo = (id) => readDoc('grupos', id);
export const guardarGrupo = (id, data) => writeDoc('grupos', id, data);
export const eliminarGrupo = (id) => deleteDoc('grupos', id);

// ===== Reuniones (entre semana) =====
export const obtenerReuniones = () => readAll('reuniones');
export const obtenerReunion = (id) => readDoc('reuniones', id);
export const guardarReunion = (id, data) => writeDoc('reuniones', id, data);
export const eliminarReunion = (id) => deleteDoc('reuniones', id);

// ===== Programas (mes: fin de semana + salidas + atencion + aseo) =====
export const obtenerProgramas = () => readAll('programas');
export const obtenerPrograma = (id) => readDoc('programas', id);
export const guardarPrograma = (id, data) => writeDoc('programas', id, data);
export const eliminarPrograma = (id) => deleteDoc('programas', id);

// ===== Asignaciones (historial) =====
export const obtenerAsignaciones = () => readAll('asignaciones');
export const obtenerAsignacionesPorMes = async (mesId) => {
  const sb = await initSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from('asignaciones').select('*').eq('data->>programaId', String(mesId));
  if (error) throw new Error(error.message);
  return (data || []).map(filaADoc);
};
export const obtenerAsignacionesPorParticipante = async (personaId) => {
  const sb = await initSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from('asignaciones')
    .select('*').eq('data->>participanteId', String(personaId))
    .order('data->>fecha', { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return (data || []).map(filaADoc);
};
export const guardarAsignacion = (id, data) => writeDoc('asignaciones', id, data);

// ===== Configuración (documento único "general") =====
export const obtenerConfiguracion = () => readDoc('configuracion', 'general');
export const guardarConfiguracion = (data) => writeDoc('configuracion', 'general', data);

// ===== Discursos (lista pública) =====
export const obtenerDiscursos = () => readAll('discursos');
export const obtenerDiscurso = (num) => readDoc('discursos', String(num));
export const guardarDiscurso = (num, data) => writeDoc('discursos', String(num), data);

// ===== Usuarios (rol admin/reader; verifica en auth.js) =====
export const obtenerUsuario = (uid) => readDoc('usuarios', uid);
export const guardarUsuario = (uid, data) => writeDoc('usuarios', uid, data);

// ===== Mantenimiento (borrado de datos) =====
export async function borrarColeccionExcepto(table, exceptIds = []) {
  const sb = await initSupabase();
  if (!sb) return 0;
  let q = sb.from(table).delete();
  if (exceptIds.length) q = q.not('id', 'in', exceptIds.map(String));
  const { error } = await q;
  if (error) throw new Error(error.message);
  return 0;
}

export async function limpiarTodasLasColecciones(exceptUid = '') {
  const sb = await initSupabase();
  if (!sb) return 0;
  const tablas = ['participantes', 'grupos', 'reuniones', 'programas', 'asignaciones', 'configuracion'];
  let total = 0;
  for (const t of tablas) total += await borrarColeccionExcepto(t);
  total += await borrarColeccionExcepto('usuarios', exceptUid ? [String(exceptUid)] : []);
  return total;
}

export async function borrarParticipantesReunionesProgramas() {
  const sb = await initSupabase();
  if (!sb) return 0;
  let total = 0;
  for (const t of ['participantes', 'reuniones', 'programas', 'asignaciones']) total += await borrarColeccionExcepto(t);
  return total;
}

export async function borrarSoloParticipantes() {
  const sb = await initSupabase();
  if (!sb) return 0;
  let total = 0;
  for (const t of ['participantes']) total += await borrarColeccionExcepto(t);
  return total;
}

export async function borrarSoloReuniones() {
  const sb = await initSupabase();
  if (!sb) return 0;
  let total = 0;
  for (const t of ['reuniones']) total += await borrarColeccionExcepto(t);
  return total;
}

export async function borrarSoloProgramas() {
  const sb = await initSupabase();
  if (!sb) return 0;
  let total = 0;
  for (const t of ['programas', 'asignaciones']) total += await borrarColeccionExcepto(t);
  return total;
}
