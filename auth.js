// auth.js - Capa de autenticación con Firebase Authentication (Fase 2)
// =====================================================================
// Maneja login/logout, sesión persistente, usuario actual y rol (admin/reader).
// La seguridad real se aplicará en Firestore Security Rules (Fase 7); aquí solo
// se expone el estado de autenticación para la interfaz.
//
// Mientras Firebase no esté configurado, auth.js queda inactivo: isAuthenticated()
// devuelve false y las funciones de sesión no hacen nada (la app sigue offline).

import { FIREBASE_SDK_BASE, isFirebaseConfigured, getFirebaseApp } from './firebase-config.js';
import { obtenerUsuario, guardarUsuario, obtenerConfiguracion } from './firestore.js';

let _auth = null;
let _currentUser = null;      // { uid, email, rol }
let _listeners = new Set();

// Inicializa Firebase Auth de forma perezosa (comparte la app con firestore.js).
async function initAuth() {
  if (_auth) return _auth;
  if (!isFirebaseConfigured()) return null;
  try {
    const app = await getFirebaseApp();
    if (!app) return null;
    const { getAuth } = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-auth.js');
    _auth = getAuth(app);
    return _auth;
  } catch (e) {
    console.warn('[Reunión+] Firebase Auth no disponible', e);
    return null;
  }
}

// Traduce el código de error de Firebase Auth a un mensaje legible.
function errorLogin(msg) {
  const m = String(msg || '');
  if (/EMAIL_NOT_ENABLED|operation-not-allowed/.test(m)) return 'El acceso con correo/contraseña no está habilitado en la consola de Firebase (Authentication → Sign-in method).';
  if (/INVALID_LOGIN_CREDENTIALS|invalid-credential|user-not-found|wrong-password/.test(m)) return 'Correo o contraseña incorrectos.';
  if (/INVALID_EMAIL/.test(m)) return 'El correo no tiene un formato válido.';
  if (/TOO_MANY_ATTEMPTS|too-many-requests/.test(m)) return 'Demasiados intentos. Espere un momento y vuelva a intentar.';
  if (/NETWORK_ERROR|network-request-failed/.test(m)) return 'Sin conexión. Verifique su red e intente de nuevo.';
  if (/user-disabled/.test(m)) return 'La cuenta está deshabilitada.';
  if (/popup-blocked|popup-closed|cancelled-popup|account-exists-with-different-credential|unauthorized-domain/.test(m)) return 'No se pudo completar el acceso con Google. La cuenta de la congregación y la de Google deben coincidir; verifique los dominios autorizados en la consola de Firebase.';
  return String(msg || 'No se pudo iniciar sesión.');
}

// ¿El correo del usuario está autorizado para acceder a los datos? Regla compartida
// con firestore.rules (lecturaApp): admin siempre permitido, resto por whitelist.
async function emailAutorizado(p) {
  const email = String((p && p.email) || '').trim().toLowerCase();
  if (!email) return { ok: false, reason: 'denied' };
  try {
    const propio = await obtenerUsuario(p.uid);
    if (propio && propio.rol === 'admin') return { ok: true };
  } catch (e) { /* sin permiso para leer su doc propio: sigue */ }
  try {
    const cfg = await obtenerConfiguracion();
    const list = (cfg && cfg.config && Array.isArray(cfg.config.emailsPermitidos))
      ? cfg.config.emailsPermitidos.map((e) => String(e).trim().toLowerCase())
      : [];
    if (list.includes(email)) return { ok: true };
    return { ok: false, reason: 'denied' };
  } catch (e) {
    const m = String((e && (e.code || e.message)) || e);
    if (/permission-denied|PERMISSION_DENIED|insufficient/.test(m)) return { ok: false, reason: 'denied' };
    return { ok: false, reason: 'error', msg: errorLogin(e.message || e.code || e) };
  }
}

// Inicia sesión con email + contraseña.
export async function login(email, password) {
  const auth = await initAuth();
  if (!auth) throw new Error('Firebase no configurado');
  const { signInWithEmailAndPassword } = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-auth.js');
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const aut = await emailAutorizado(cred.user);
    if (!aut.ok) {
      await logout();
      throw new Error(aut.reason === 'denied' ? 'Tu correo no está autorizado para acceder a esta aplicación.' : aut.msg);
    }
    await refreshUser(cred.user);
    return _currentUser;
  } catch (err) {
    throw new Error(errorLogin(err.message || err.code || err));
  }
}

// Inicia sesión con Google (coexiste con email/contraseña; exige whitelist).
export async function loginWithGoogle() {
  const auth = await initAuth();
  if (!auth) throw new Error('Firebase no configurado');
  const { GoogleAuthProvider, signInWithPopup } = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-auth.js');
  try {
    // select_account fuerza a Google a mostrar el selector de cuentas para que
    // el usuario pueda elegir otra cuenta si la actual no es la registrada.
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await signInWithPopup(auth, provider);
    const aut = await emailAutorizado(cred.user);
    if (!aut.ok) {
      await logout();
      throw new Error(aut.reason === 'denied' ? 'Tu correo no está autorizado para acceder a esta aplicación.' : aut.msg);
    }
    await refreshUser(cred.user);
    return _currentUser;
  } catch (err) {
    const m = String((err && (err.code || err.message)) || err);
    if (/operation-not-allowed|admin-only-operation|EMAIL_NOT_ENABLED/.test(m)) {
      throw new Error('El acceso con Google no está habilitado en la consola de Firebase (Authentication → Sign-in method).');
    }
    throw new Error(errorLogin(err.message || err.code || err));
  }
}

// Reautentica al usuario actual con su contraseña (p. ej. antes de una acción
// sensible como borrar datos). Requiere sesión activa. Lanza error si falla.
export async function reauthenticate(password) {
  const auth = await initAuth();
  if (!auth || !auth.currentUser) throw new Error('No hay sesión activa.');
  const { reauthenticateWithCredential, EmailAuthProvider } = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-auth.js');
  const cred = EmailAuthProvider.credential(auth.currentUser.email, password);
  try {
    await reauthenticateWithCredential(auth.currentUser, cred);
    return true;
  } catch (err) {
    throw new Error(errorLogin(err.message || err.code || err));
  }
}

// Cierra sesión.
export async function logout() {
  const auth = await initAuth();
  if (!auth) return;
  const { signOut } = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-auth.js');
  await signOut(auth);
  _currentUser = null;
  notifyListeners();
}

// Carga el usuario actual y su documento (rol) desde Firestore.
async function refreshUser(fbUser) {
  if (!fbUser) { _currentUser = null; notifyListeners(); return null; }
  let doc = await obtenerUsuario(fbUser.uid);
  // Si el usuario no tiene documento (primer login), se crea con rol 'reader'.
  // El administrador debe promocionarse a 'admin' desde la consola o la UI.
  if (!doc) {
    await guardarUsuario(fbUser.uid, { email: fbUser.email, rol: 'reader', createdAt: Date.now() });
    doc = { rol: 'reader' };
  }
  const rol = (doc && doc.rol === 'admin') ? 'admin' : 'reader';
  _currentUser = { uid: fbUser.uid, email: fbUser.email, rol };
  notifyListeners();
  return _currentUser;
}

// Restaura la sesión persistente al cargar (llamar una vez al iniciar).
export async function restoreSession() {
  const auth = await initAuth();
  if (!auth) return null;
  const { onAuthStateChanged } = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-auth.js');
  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (user) refreshUser(user).then(resolve);
      else resolve(null);
    });
  });
}

// ¿Hay un usuario autenticado?
export function isAuthenticated() {
  return !!_currentUser;
}

// Usuario actual { uid, email, rol } o null.
export function currentUser() {
  return _currentUser;
}

// ¿El usuario actual es admin?
export function isAdmin() {
  return !!_currentUser && _currentUser.rol === 'admin';
}

// Registra un listener que se invoca cuando cambia la sesión. Devuelve una
// función para desregistrarlo.
export function onAuthChange(listener) {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

function notifyListeners() {
  for (const l of _listeners) {
    try { l(_currentUser); } catch (e) { console.warn('[Reunión+] Listener de auth falló', e); }
  }
}
