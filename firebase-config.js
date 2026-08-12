// firebase-config.js - Configuración de Firebase (placeholders)
// =============================================================
// FASE 2 — Integración de Firebase (migración JSON → Cloud Firestore).
//
// Esta aplicación usa IndexedDB como almacenamiento local (db.js). Firebase se
// añade como capa de sincronización/seguridad en la nube. Mientras no se
// completen las credenciales, la app funciona 100% offline con IndexedDB.
//
// PARA ACTIVAR FIREBASE:
//   1. Crea un proyecto en https://console.firebase.google.com
//   2. Añade una app "Web" y copia aquí la configuración (apiKey, authDomain,
//      projectId, storageBucket, messagingSenderId, appId).
//   3. Activa Authentication (email/password) y Firestore (modo de prueba
//      inicialmente).
//   4. Aplica las reglas de seguridad de Firestore (Fase 7). Puedes desplegarlas
//      desde la consola (Firestore → Reglas → pegar firestore.rules) o con la
//      CLI:  firebase deploy --only firestore:rules
//   5. Promueve a 'admin' el documento de tu usuario en la colección 'usuarios'
//      (los nuevos usuarios se crean con rol 'reader').
//
// Los valores de abajo son PLACEHOLDERS. La app detecta que Firebase NO está
// configurado y continúa usando solo IndexedDB hasta que los completes.

export const FIREBASE_CONFIG = {
  apiKey: 'TU_API_KEY_AQUI',
  authDomain: 'TU_PROYECTO.firebaseapp.com',
  projectId: 'TU_PROYECTO',
  storageBucket: 'TU_PROYECTO.appspot.com',
  messagingSenderId: 'TU_MESSAGING_SENDER_ID',
  appId: 'TU_APP_ID',
};

// URL base del SDK de Firebase (módulos ES, v10.x).
export const FIREBASE_SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.2/';

// true si el usuario completó las credenciales reales (no placeholders).
export function isFirebaseConfigured() {
  return Boolean(
    FIREBASE_CONFIG.apiKey &&
    FIREBASE_CONFIG.apiKey !== 'TU_API_KEY_AQUI' &&
    FIREBASE_CONFIG.projectId &&
    FIREBASE_CONFIG.projectId !== 'TU_PROYECTO'
  );
}
