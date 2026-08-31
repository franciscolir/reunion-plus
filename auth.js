// auth.js - Capa de autenticación con Supabase Auth
// ==================================================
// Maneja login/logout, sesión persistente, usuario actual y rol (admin/reader/user/ia).
// La seguridad real la aplican las políticas RLS de Postgres; aquí solo se
// expone el estado de autenticación para la interfaz.
//
// Mientras Supabase no esté configurado, auth.js queda inactivo: isAuthenticated()
// devuelve false y las funciones de sesión no hacen nada (la app sigue offline).

import { isSupabaseConfigured, getSupabase } from './supabase-config.js?v=218';
import { obtenerUsuario, guardarUsuario, obtenerConfiguracion } from './supabase.js?v=218';

let _sb = null;
let _currentUser = null;      // { uid, email, rol }
let _listeners = new Set();

// Inicializa el cliente de Supabase de forma perezosa.
async function initAuth() {
  if (_sb) return _sb;
  if (!isSupabaseConfigured()) return null;
  try {
    _sb = await getSupabase();
    return _sb;
  } catch (e) {
    console.warn('[Reunión+] Supabase Auth no disponible', e);
    return null;
  }
}

// Traduce el código de error de Supabase Auth a un mensaje legible.
function errorLogin(msg) {
  const m = String(msg || '');
  if (/invalid_credentials|invalid-credentials|user-not-found|wrong-password/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/email_not_confirmed|email-not-confirmed/i.test(m)) return 'El correo no está confirmado. Revise su bandeja de entrada.';
  if (/invalid_email/i.test(m)) return 'El correo no tiene un formato válido.';
  if (/too_many_requests|rate_limit/i.test(m)) return 'Demasiados intentos. Espere un momento y vuelva a intentar.';
  if (/network|fetch/i.test(m)) return 'Sin conexión. Verifique su red e intente de nuevo.';
  if (/user-disabled/i.test(m)) return 'La cuenta está deshabilitada.';
  if (/provider|google|OAuth|oauth/i.test(m)) return 'No se pudo completar el acceso con Google. Verifique la configuración de Supabase (Authentication → Providers → Google).';
  return String(msg || 'No se pudo iniciar sesión.');
}

// ¿El correo del usuario está autorizado para acceder a los datos? Regla compartida
// con las políticas RLS: admin siempre permitido, resto por whitelist.
async function emailAutorizado(p) {
  const email = String((p && p.email) || '').trim().toLowerCase();
  if (!email) return { ok: false, reason: 'denied' };
  try {
    const propio = await obtenerUsuario(p.id);
    if (propio && ['admin', 'user', 'ia'].includes(propio.rol)) return { ok: true };
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
    if (/permission-denied|PERMISSION_DENIED|insufficient|rls/i.test(m)) return { ok: false, reason: 'denied' };
    return { ok: false, reason: 'error', msg: errorLogin(e.message || e.code || e) };
  }
}

// Inicia sesión con email + contraseña.
export async function login(email, password) {
  const sb = await initAuth();
  if (!sb) throw new Error('Supabase no configurado');
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(errorLogin(error.message || error.code));
  const user = data.user;
  const aut = await emailAutorizado(user);
  if (!aut.ok) {
    await logout();
    throw new Error(aut.reason === 'denied' ? 'Tu correo no está autorizado para acceder a esta aplicación.' : aut.msg);
  }
  await refreshUser(user);
  return _currentUser;
}

// Reautentica al usuario actual con su contraseña (p. ej. antes de una acción
// sensible como borrar datos). Requiere sesión activa. Lanza error si falla.
export async function reauthenticate(password) {
  const sb = await initAuth();
  if (!sb || !_currentUser) throw new Error('No hay sesión activa.');
  const { error } = await sb.auth.signInWithPassword({ email: _currentUser.email, password });
  if (error) throw new Error(errorLogin(error.message || error.code));
  return true;
}

// Cierra sesión.
export async function logout() {
  const sb = await initAuth();
  if (!sb) return;
  await sb.auth.signOut();
  _currentUser = null;
  notifyListeners();
}

// Carga el usuario actual y su documento (rol) desde la tabla usuarios.
async function refreshUser(sbUser) {
  if (!sbUser) { _currentUser = null; notifyListeners(); return null; }
  let doc = await obtenerUsuario(sbUser.id);
  // Si el usuario no tiene documento (primer login), se crea con rol 'reader'.
  if (!doc) {
    await guardarUsuario(sbUser.id, { email: sbUser.email, rol: 'reader', createdAt: Date.now() });
    doc = { rol: 'reader' };
  }
  const rol = doc && ['admin', 'reader', 'user', 'ia'].includes(doc.rol) ? doc.rol : 'reader';
  const grupos = Array.isArray(doc.grupos) ? doc.grupos.map(String) : [];
  const personaId = doc && doc.personaId ? String(doc.personaId) : '';
  _currentUser = { uid: sbUser.id, email: sbUser.email, rol, grupos, personaId };
  notifyListeners();
  return _currentUser;
}

// Restaura la sesión persistente al cargar (llamar una vez al iniciar).
export async function restoreSession() {
  const sb = await initAuth();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  if (data && data.session && data.session.user) {
    await refreshUser(data.session.user);
    return _currentUser;
  }
  sb.auth.onAuthStateChange((event, session) => {
    if (session && session.user) refreshUser(session.user);
    else if (event === 'SIGNED_OUT') { _currentUser = null; notifyListeners(); }
  });
  return null;
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

// Vincula (o desvincula, con id vacío) la cuenta actual con una ficha de
// participante (Persona). Solo actualiza el estado en cliente; la persistencia
// en Supabase la hace quien llame (p. ej. guardarUsuario).
export function setCurrentPersonaId(id) {
  if (!_currentUser) return;
  _currentUser = { ..._currentUser, personaId: id ? String(id) : '' };
  notifyListeners();
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
