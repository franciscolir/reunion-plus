// firestore.js - Capa de acceso a Cloud Firestore (Fase 2)
// =========================================================
// Esta capa abstrae el acceso a Firestore por dominio (participantes, grupos,
// reuniones, programas, asignaciones, configuración, usuarios). En esta fase
// solo se prepara la API; la lógica de negocio sigue leyendo de IndexedDB
// (db.js). Cuando se configure Firebase y se migren los módulos, estas
// funciones reemplazarán progresivamente a db.js.
//
// Si Firebase no está configurado, todas las funciones devuelven null/[] y no
// hacen ninguna llamada de red (la app sigue funcionando offline con IndexedDB).

import { FIREBASE_SDK_BASE, isFirebaseConfigured, getFirebaseApp } from './firebase-config.js';

let _db = null;
let _ready = false;

// Inicializa Firestore de forma perezosa. Devuelve { db } o null si no hay
// configuración / no se pudo cargar el SDK (sin red).
async function initFirebase() {
  if (_ready) return _db ? { db: _db } : null;
  _ready = true;
  if (!isFirebaseConfigured()) return null;
  try {
    const app = await getFirebaseApp();
    if (!app) return null;
    const { getFirestore } = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-firestore.js');
    _db = getFirestore(app);
    return { db: _db };
  } catch (e) {
    console.warn('[Reunión+] Firebase no disponible (¿sin conexión o SDK no cargado?)', e);
    return null;
  }
}

// Acceso de solo lectura (con manejo de desconexión). Devuelve array de docs.
async function readAll(collection) {
  const f = await initFirebase();
  if (!f) return [];
  const { getDocs, collection: coll, query, orderBy } = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-firestore.js');
  const snap = await getDocs(query(coll(f.db, collection), orderBy('updatedAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function readDoc(collection, id) {
  const f = await initFirebase();
  if (!f) return null;
  const { getDoc, doc } = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-firestore.js');
  const d = await getDoc(doc(f.db, collection, String(id)));
  return d.exists() ? { id: d.id, ...d.data() } : null;
}

async function writeDoc(collection, id, data) {
  const f = await initFirebase();
  if (!f) return null;
  const { setDoc, doc } = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-firestore.js');
  const payload = { ...data, updatedAt: Date.now() };
  if (!payload.createdAt) payload.createdAt = payload.updatedAt;
  await setDoc(doc(f.db, collection, String(id)), payload);
  return id;
}

async function deleteDoc(collection, id) {
  const f = await initFirebase();
  if (!f) return null;
  const { deleteDoc, doc } = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-firestore.js');
  await deleteDoc(doc(f.db, collection, String(id)));
  return id;
}

// Escribe muchos documentos en lotes (máx. 500 ops por batch en Firestore).
// `docs` = [{ collection, id, data }]. Devuelve la cantidad de documentos escritos.
// Idempotente: usa setDoc con id explícito (sobrescribe sin duplicar).
export async function batchWrite(docs) {
  const f = await initFirebase();
  if (!f || !docs.length) return 0;
  const { writeBatch, doc } = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-firestore.js');
  const now = Date.now();
  let written = 0;
  for (let i = 0; i < docs.length; i += 400) {
    const chunk = docs.slice(i, i + 400);
    const batch = writeBatch(f.db);
    for (const d of chunk) {
      const payload = { ...d.data, updatedAt: now };
      if (!payload.createdAt) payload.createdAt = now;
      batch.set(doc(f.db, d.collection, String(d.id)), payload);
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

// Estado de conexión: true si Firebase está disponible y listo.
export async function isFirebaseReady() {
  return !!(await initFirebase());
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
  const f = await initFirebase();
  if (!f) return [];
  const { getDocs, collection: coll, query, where } = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-firestore.js');
  const snap = await getDocs(query(coll(f.db, 'asignaciones'), where('programaId', '==', String(mesId))));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};
export const obtenerAsignacionesPorParticipante = async (personaId) => {
  const f = await initFirebase();
  if (!f) return [];
  const { getDocs, collection: coll, query, where, orderBy, limit } = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-firestore.js');
  const snap = await getDocs(query(
    coll(f.db, 'asignaciones'),
    where('participanteId', '==', String(personaId)),
    orderBy('fecha', 'desc'),
    limit(500)
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};
export const guardarAsignacion = (id, data) => writeDoc('asignaciones', id, data);

// ===== Configuración (documento único "general") =====
export const obtenerConfiguracion = () => readDoc('configuracion', 'general');
export const guardarConfiguracion = (data) => writeDoc('configuracion', 'general', data);

// ===== Usuarios (rol admin/reader; verifica en auth.js) =====
export const obtenerUsuario = (uid) => readDoc('usuarios', uid);
export const guardarUsuario = (uid, data) => writeDoc('usuarios', uid, data);
