// firebase-config.js - Puente de compatibilidad
// ==============================================
// Este archivo conserva el nombre y las exportaciones que usaban auth.js,
// firestore.js y sync.js, pero ahora apunta a SUPABASE. La configuración real
// vive en supabase-config.js (no versionada).
//
// Mientras Supabase no esté configurado, isFirebaseConfigured() devuelve false
// y la app funciona 100% offline con IndexedDB.

import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured, getSupabase } from './supabase-config.js?v=215';

export const FIREBASE_CONFIG = { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
export const FIREBASE_SDK_BASE = ''; // Supabase se carga desde supabase-config.js

// true si el usuario completó las credenciales de Supabase.
export function isFirebaseConfigured() {
  return isSupabaseConfigured();
}

// Devuelve el cliente de Supabase (compatibilidad con getFirebaseApp()).
export async function getFirebaseApp() {
  return getSupabase();
}
