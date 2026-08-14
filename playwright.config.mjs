// playwright.config.mjs - Configuración de tests E2E (Playwright)
// Sirve la app localmente con Firebase desactivado (firebase-config vacío),
// de modo que la app corre 100% offline sobre IndexedDB.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    // Holgura y bloqueo del Service Worker: cada test usa un contexto nuevo
    // (IndexedDB vacía) y evita que la caché offline sirva ficheros viejos.
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/e2e/server.mjs',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});