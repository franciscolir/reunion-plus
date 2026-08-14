// tests/e2e/app.spec.mjs - Tests end-to-end de Reunión+
// Corren contra la app servida localmente con Firebase mockeado (offline),
// de modo que IndexedDB es la única fuente de datos. Cada test usa un
// contexto de navegador nuevo (base de datos vacía).
import { test, expect } from '@playwright/test';
import { openApp, gotoLabores } from './helpers.mjs';

test.describe('Reunión+ PWA (modo offline)', () => {

  test('carga el tablero con navegación lateral', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#sideNavItems button')).toHaveCount(6);
    await expect(page.locator('#sideNavItems')).toContainText('Personas y Deptos.');
    await expect(page.locator('#app')).not.toBeEmpty();
  });

  test('navega a Personas y Grupos y muestra el estado vacío', async ({ page }) => {
    await openApp(page);
    await gotoLabores(page);
    await expect(page.locator('#listsTabs')).toContainText('Labores');
    await expect(page.locator('#listsTabs')).toContainText('Historial');
    await expect(page.locator('#pList')).toContainText('Sin personas');
    await expect(page.locator('.quick-chip').first()).toBeVisible();
  });

  test('añade un miembro y aparece como tarjeta con chips de labores', async ({ page }) => {
    await openApp(page);
    await gotoLabores(page);

    await page.click('#addMemberBtn');
    await page.fill('#mdName', 'Ana Pérez');
    await page.check('[data-mr="presidente"]');
    await page.click('#mdForm button[type="submit"]');

    const card = page.locator('.person-card', { hasText: 'Ana Pérez' });
    await expect(card).toBeVisible();
    await expect(card.locator('.labor-chip')).toHaveCount(14);
    await expect(card.locator('.labor-chip[data-plabore="presidente"]')).toHaveClass(/is-on/);
    await expect(page.locator('#toastRoot')).toContainText('Miembro agregado');
  });

  test('los chips de labor persisten al recargar', async ({ page }) => {
    await openApp(page);
    await gotoLabores(page);

    await page.click('#addMemberBtn');
    await page.fill('#mdName', 'Juan López');
    await page.click('#mdForm button[type="submit"]');

    const card = page.locator('.person-card', { hasText: 'Juan López' });
    await expect(card).toBeVisible();

    // Desbloquear edición y marcar "audio".
    await page.click('#toggleEditMode');
    await card.locator('.labor-chip[data-plabore="audio"]').click();
    await expect(card.locator('.labor-chip[data-plabore="audio"]')).toHaveClass(/is-on/);

    // Recargar: el estado persiste en IndexedDB.
    await page.reload();
    await gotoLabores(page);
    const card2 = page.locator('.person-card', { hasText: 'Juan López' });
    await expect(card2.locator('.labor-chip.is-on[data-plabore="audio"]')).toHaveCount(1);
  });

  test('perfil de persona: nombre, labores conmutables e historial', async ({ page }) => {
    await openApp(page);
    await gotoLabores(page);

    await page.click('#addMemberBtn');
    await page.fill('#mdName', 'María González');
    await page.check('[data-mr="asignacion1"]');
    await page.click('#mdForm button[type="submit"]');

    const card = page.locator('.person-card', { hasText: 'María González' });
    await expect(card).toBeVisible();
    const pid = await card.getAttribute('data-pid');

    await page.click(`[data-profile="${pid}"]`);
    await expect(page.locator('#pfName')).toHaveValue('María González');
    await expect(page.locator('#pfLabores .labor-chip')).toHaveCount(14);
    await expect(page.locator('#pfLabores .labor-chip.is-on[data-plabore="asignacion1"]')).toHaveCount(1);
    await expect(page.locator('#pfHistory')).toContainText('Sin asignaciones registradas');

    // Añadir una labor desde el perfil y guardar.
    await page.click('#pfLabores .labor-chip[data-plabore="audio"]');
    await page.click('#pfSave');
    await expect(page.locator('#toastRoot')).toContainText('Perfil actualizado');
    await expect(page.locator('.person-card .labor-chip.is-on[data-plabore="audio"]')).toHaveCount(1);
  });

  test('historial de asignaciones muestra la tabla con las personas', async ({ page }) => {
    await openApp(page);
    await gotoLabores(page);

    await page.click('#addMemberBtn');
    await page.fill('#mdName', 'Luis Díaz');
    await page.click('#mdForm button[type="submit"]');
    await expect(page.locator('.person-card', { hasText: 'Luis Díaz' })).toBeVisible();

    await page.click('[data-tab="historial"]');
    await expect(page.locator('#pList thead')).toContainText('Último mes');
    await expect(page.locator('#pList tbody')).toContainText('Luis Díaz');
  });

  test('historial sin personas muestra el mensaje de sin asignaciones', async ({ page }) => {
    await openApp(page);
    await gotoLabores(page);
    await page.click('[data-tab="historial"]');
    await expect(page.locator('#pList tbody')).toContainText('Sin asignaciones registradas');
  });

  test('marcar labor en todos los visibles (quick chip)', async ({ page }) => {
    await openApp(page);
    await gotoLabores(page);

    await page.click('#addMemberBtn');
    await page.fill('#mdName', 'Persona Uno');
    await page.click('#mdForm button[type="submit"]');
    await expect(page.locator('.person-card')).toHaveCount(1);

    await page.click('#toggleEditMode');
    await page.click('[data-quicklabore="presidente"]');
    await expect(page.locator('.person-card .labor-chip.is-on[data-plabore="presidente"]')).toHaveCount(1);
    await expect(page.locator('#toastRoot')).toContainText('"Presidente" marcado');
  });

  test('quitar persona la oculta y se puede restaurar (borrado lógico)', async ({ page }) => {
    await openApp(page);
    await gotoLabores(page);

    await page.click('#addMemberBtn');
    await page.fill('#mdName', 'Ana Torrado');
    await page.click('#mdForm button[type="submit"]');
    const card = page.locator('.person-card', { hasText: 'Ana Torrado' });
    await expect(card).toBeVisible();
    const pid = await card.getAttribute('data-pid');

    // Quitar → tarjeta desaparece (queda oculta).
    await page.click(`[data-pdel="${pid}"]`);
    await page.click('#mdOk');
    await expect(page.locator('.person-card', { hasText: 'Ana Torrado' })).toHaveCount(0, { timeout: 10000 });

    // Ver desactivados → aparece atenuada con botón restauración.
    await page.click('#toggleInactive');
    const inactive = page.locator('.person-card.is-inactive', { hasText: 'Ana Torrado' });
    await expect(inactive).toBeVisible();
    await expect(inactive.locator('.labor-chip').first()).toBeDisabled();
    await expect(inactive.locator('[data-prestore]')).toBeAttached();

    // Restaurar → vuelve a la lista activa.
    await page.click(`[data-prestore="${pid}"]`);
    await page.click('#mdOk');
    await expect(page.locator('.person-card', { hasText: 'Ana Torrado' })).toHaveCount(1, { timeout: 10000 });
  });

});
