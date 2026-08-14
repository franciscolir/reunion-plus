// tests/e2e/helpers.mjs - Utilidades compartidas por los tests E2E.

// Sustituye firebase-config.js por una versión vacía para que la app corra
// 100% offline (IndexedDB como fuente de verdad, sin login ni red).
export const MOCK_FIREBASE = `
export const FIREBASE_CONFIG = {};
export const FIREBASE_SDK_BASE = '';
export function isFirebaseConfigured() { return false; }
export const getFirebaseApp = async () => null;
`;

// Aplica el mock de Firebase y abre la app esperando a que la navegación
// lateral esté disponible (app desbloqueada).
export async function openApp(page) {
  await page.route('**/firebase-config.js', route =>
    route.fulfill({ contentType: 'application/javascript', body: MOCK_FIREBASE }));
  await page.goto('/');
  await page.waitForSelector('#sideNavItems button[data-go="lists"]', { state: 'visible' });
}

// Navega a la vista Personas y Grupos y espera a que cargue.
export async function gotoLabores(page) {
  await page.click('#sideNavItems button[data-go="lists"]');
  await page.waitForSelector('h1:has-text("Personas y Grupos")', { state: 'visible' });
}