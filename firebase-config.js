// firebase-config.js - Configuración de Firebase
// ==============================================
// Esta aplicación usa IndexedDB como almacenamiento local (db.js). Firebase se
// añade como capa de sincronización/seguridad en la nube. La app sigue
// funcionando 100% offline con IndexedDB aunque Firebase esté configurado.
//
// PROYECTO ACTIVO: reunion-b6f14
// Credenciales de la app Web (Fase 2 completada).
// Ver también: firestore.rules (seguridad) y firebase.json (deploy).

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAQXhgPx_EyI-pjwba-jLaIZ0lA04YxNDc',
  authDomain: 'reunion-b6f14.firebaseapp.com',
  projectId: 'reunion-b6f14',
  storageBucket: 'reunion-b6f14.firebasestorage.app',
  messagingSenderId: '772112574179',
  appId: '1:772112574179:web:3f937bde562369a937c7d6',
};

// URL base del SDK de Firebase (módulos ES). Se usa el mismo que el script de
// la consola (v12.17.1).
export const FIREBASE_SDK_BASE = 'https://www.gstatic.com/firebasejs/12.17.1/';

// true si el usuario completó las credenciales reales (no placeholders).
export function isFirebaseConfigured() {
  return Boolean(
    FIREBASE_CONFIG.apiKey &&
    FIREBASE_CONFIG.apiKey !== 'TU_API_KEY_AQUI' &&
    FIREBASE_CONFIG.projectId &&
    FIREBASE_CONFIG.projectId !== 'TU_PROYECTO'
  );
}
