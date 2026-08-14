// tests/e2e/app.spec.mjs - Tests end-to-end de Reunión+
// Corren contra la app servida localmente con Firebase mockeado (offline),
// de modo que IndexedDB es la única fuente de datos. Cada test usa un
// contexto de navegador nuevo (base de datos vacía).
import { test, expect } from '@playwright/test';
import { openApp, gotoLabores, seedProposalData } from './helpers.mjs';

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
    await expect(card.locator('.labor-chip')).toHaveCount(15);
    await expect(card.locator('.labor-chip[data-plabore="presidente"]').first()).toHaveClass(/is-on/);
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
    await expect(page.locator('#pfLabores .labor-chip')).toHaveCount(15);
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

  test('propuesta: vista previa con vista general, conflictos y aceptar deja en edición', async ({ page }) => {
    await seedProposalData(page);
    await openApp(page);

    await page.evaluate(() => { location.hash = '#/algoritmo'; });
    await expect(page.locator('#algoGenerate')).toBeVisible();

    await page.click('#algoGenerate');
    // El programa de salidas del seed está incompleto → pregunta antes de generar.
    await expect(page.locator('h3:has-text("Programa de salidas incompleto")')).toBeVisible();
    await page.click('#algoSalidasGo');
    await expect(page.locator('[data-previa]').first()).toBeVisible({ timeout: 20000 });

    // Vista previa: vista mensual general renderizada con la propuesta.
    await page.locator('[data-previa]').first().click();
    await expect(page.locator('#pvGeneral')).toContainText('Semana 1');
    await expect(page.locator('#pvGeneral')).toContainText('Entre Semana');
    await expect(page.locator('#pvGeneral')).toContainText('Fin de Semana');
    await expect(page.locator('#pvConflictos')).toBeVisible();
    await expect(page.locator('#pvSinAsignar')).toBeVisible();

    // Aceptar: persiste programas y navega a Programas (edición).
    await page.click('#pvAccept');
    await page.waitForFunction(() => location.hash === '#/new');
    await expect(page.locator('#toastRoot')).toContainText('Propuesta aplicada');
    await expect(page.locator('h1:has-text("Programas")')).toBeVisible();

    // El programa de entre semana quedó asignado en la BD.
    const [presidente, primerSlot] = await page.evaluate(() => new Promise((res, rej) => {
      const req = indexedDB.open('reunion-plus', 7);
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('midweeks', 'readonly');
        const g = tx.objectStore('midweeks').get('2026-08-03');
        g.onsuccess = () => {
          const w = g.result;
          db.close();
          res([w && w.presidente || '', (w.sections || [])[0].parts[0].assignments.conductor || '']);
        };
        g.onerror = () => rej(g.error);
      };
      req.onerror = () => rej(req.error);
    }));
    expect(presidente).not.toBe('');
    expect(primerSlot).not.toBe('');
  });

  test('ajustes: motor con veces numéricas, tooltips por campo y nivel lector CD', async ({ page }) => {
    await seedProposalData(page);
    await openApp(page);
    await page.evaluate(() => { location.hash = '#/settings'; });
    await expect(page.locator('h1:has-text("Ajustes")')).toBeVisible();

    // Repetición mensual ahora es una cantidad de veces (0-4).
    await expect(page.locator('#algoRepVeces option')).toHaveCount(5);
    await expect(page.locator('#algoRepVeces option:checked')).toHaveCount(1);

    // Iconos info con tooltip en los campos del motor y la ponderación.
    await expect(page.locator('label:has(.material-symbols-outlined[title])')).toHaveCount(14);

    // El nivel del lector contempla C y D (opción CD).
    await expect(page.locator('#algoLectorNivel option[value="CD"]')).toBeAttached();
    await expect(page.locator('#algoLectorNivel')).toContainText('C y D (CD)');
    await page.selectOption('#algoLectorNivel', 'CD');

    // Ponderación del ranking con barras deslizantes y valor reflejado.
    await expect(page.locator('#scWorkload')).toHaveAttribute('type', 'range');
    await page.locator('#scWorkload').fill('70');
    await expect(page.locator('[data-val="scWorkload"]')).toHaveText('70');

    await page.click('#algoSave');
    await expect(page.locator('#toastRoot')).toContainText('Motor de asignación guardado');
  });

});
