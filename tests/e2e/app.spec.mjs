// tests/e2e/app.spec.mjs - Tests end-to-end de Reunión+
// Corren contra la app servida localmente con Supabase mockeado (offline),
// de modo que IndexedDB es la única fuente de datos. Cada test usa un
// contexto de navegador nuevo (base de datos vacía).
import { test, expect } from '@playwright/test';
import { openApp, gotoLabores, seedProposalData, seedAtencionSelects } from './helpers.mjs';

test.describe('Reunión+ PWA (modo offline)', () => {

  test('carga el tablero con navegación lateral', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#sideNavItems button')).toHaveCount(6);
    await expect(page.locator('#sideNavItems')).toContainText('Congregación');
    await expect(page.locator('#app')).not.toBeEmpty();
  });

  test('navega a Congregación y muestra el estado vacío', async ({ page }) => {
    await openApp(page);
    await gotoLabores(page);
    await expect(page.locator('#listsTabs')).toContainText('Personas');
    await expect(page.locator('#listsTabs')).toContainText('Grupos');
    await expect(page.locator('#listsTabs')).toContainText('Labores');
    await expect(page.locator('#listsTabs')).toContainText('Asignaciones');
    await expect(page.locator('#listsTabs')).toContainText('Historial');
    await expect(page.locator('#pList')).toContainText('Sin personas');
    await expect(page.locator('#addMemberBtn')).toBeVisible();
  });

  test('añade un miembro y aparece como fila con botón Ver perfil', async ({ page }) => {
    await openApp(page);
    await gotoLabores(page);

    await page.click('#addMemberBtn');
    await page.fill('#mdName', 'Ana Pérez');
    await page.check('[data-mr="presidente"]');
    await page.click('#mdForm button[type="submit"]');

    const row = page.locator('.person-card', { hasText: 'Ana Pérez' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Ver perfil');
    await expect(page.locator('#toastRoot')).toContainText('Miembro agregado');
  });

  test('añadir mujer solo ofrece presentación (asignacion2)', async ({ page }) => {
    await openApp(page);
    await gotoLabores(page);

    await page.click('#addMemberBtn');
    await page.fill('#mdName', 'Lucía García');
    await page.selectOption('[data-attr="genero"]', 'femenino');
    await expect(page.locator('[data-mr="asignacion2"]')).toHaveCount(1);
    await expect(page.locator('[data-mr="presidente"]')).toHaveCount(0);
    await expect(page.locator('[data-mr="asignacion1"]')).toHaveCount(0);
    await page.check('[data-mr="asignacion2"]');
    await page.click('#mdForm button[type="submit"]');
    await expect(page.locator('#toastRoot')).toContainText('Miembro agregado');

    const card = page.locator('.person-card', { hasText: 'Lucía García' });
    await expect(card).toBeVisible();
    const pid = await card.getAttribute('data-pid');
    await page.click(`[data-profile="${pid}"]`);
    await expect(page.locator('#pfLabores .labor-chip.is-on[data-plabore="asignacion2"]')).toHaveCount(1);
    await expect(page.locator('#pfLabores .labor-chip.is-on')).toHaveCount(1);
  });

  test('las labores asignadas persisten al recargar (vía perfil)', async ({ page }) => {
    await openApp(page);
    await gotoLabores(page);

    await page.click('#addMemberBtn');
    await page.fill('#mdName', 'Juan López');
    await page.check('[data-mr="audio"]');
    await page.click('#mdForm button[type="submit"]');

    const row = page.locator('.person-card', { hasText: 'Juan López' });
    await expect(row).toBeVisible();

    // Recargar: el estado persiste en IndexedDB.
    await page.reload();
    await gotoLabores(page);
    const row2 = page.locator('.person-card', { hasText: 'Juan López' });
    await expect(row2).toBeVisible();
    const pid = await row2.getAttribute('data-pid');
    await page.click(`[data-profile="${pid}"]`);
    await expect(page.locator('#pfLabores .labor-chip.is-on[data-plabore="audio"]')).toHaveCount(1);
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
    await expect(page.locator('#pfLabores .labor-chip')).toHaveCount(18);
    await expect(page.locator('#pfLabores .labor-chip.is-on[data-plabore="asignacion1"]')).toHaveCount(1);
    await expect(page.locator('#pfHistory')).toContainText('Sin asignaciones registradas');

    // Añadir una labor desde el perfil y guardar.
    await page.click('#pfLabores .labor-chip[data-plabore="audio"]');
    await page.click('#pfSave');
    await expect(page.locator('#toastRoot')).toContainText('Perfil actualizado');
  });

  test('gestionar labores desde la pestaña Labores: abre el modal y permite borrar una labor', async ({ page }) => {
    await openApp(page);
    await gotoLabores(page);
    await page.click('[data-tab="departamentos"]');
    await page.click('#manageLaboresBtn');
    await expect(page.locator('#modalCard')).toContainText('Labores del equipo');
    await page.locator('[data-rdel]').first().click();
    await page.waitForSelector('#mdOk', { state: 'visible' });
    await page.click('#mdOk');
    await expect(page.locator('#toastRoot')).toContainText('Labor eliminada');
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

  test('buscar persona filtra la lista (búsqueda)', async ({ page }) => {
    await openApp(page);
    await gotoLabores(page);

    await page.click('#addMemberBtn');
    await page.fill('#mdName', 'Persona Uno');
    await page.click('#mdForm button[type="submit"]');
    await expect(page.locator('.person-card')).toHaveCount(1);

    await page.click('#addMemberBtn');
    await page.fill('#mdName', 'Persona Dos');
    await page.click('#mdForm button[type="submit"]');
    await expect(page.locator('.person-card')).toHaveCount(2);

    await page.fill('#pSearch', 'Persona Uno');
    await expect(page.locator('.person-card:not(.is-hidden)')).toHaveCount(1);
    await expect(page.locator('.person-card:not(.is-hidden)', { hasText: 'Persona Uno' })).toHaveCount(1);
    await expect(page.locator('.person-card.is-hidden', { hasText: 'Persona Dos' })).toHaveCount(1);

    await page.fill('#pSearch', 'zzz-inexistente');
    await expect(page.locator('#pEmpty')).toBeVisible();

    await page.fill('#pSearch', '');
    await expect(page.locator('.person-card:not(.is-hidden)')).toHaveCount(2);
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

    // Quitar → la fila desaparece (queda oculta).
    await page.click(`[data-pdel="${pid}"]`);
    await page.click('#mdOk');
    await expect(page.locator('.person-card', { hasText: 'Ana Torrado' })).toHaveCount(0, { timeout: 10000 });

    // Ver desactivados → aparece atenuada con botón restauración.
    await page.click('#toggleInactive');
    const inactive = page.locator('.person-card.is-inactive', { hasText: 'Ana Torrado' });
    await expect(inactive).toBeVisible();
    await expect(inactive).toContainText('Desactivada');
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

    // La cobertura del mes refleja lo aceptado (no 0%): los campos automáticos
    // (presidente, conductor, lector) quedaron asignados en las 4 semanas.
    await expect(page.locator('#newMonthsList')).toContainText('4 reuniones · 100% completo');

    // El programa de entre semana quedó asignado en la BD.
    const [presidente, primerSlot] = await page.evaluate(() => new Promise((res, rej) => {
      const req = indexedDB.open('reunion-plus', 8);
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

  test('generar: cancelar el aviso de salidas deja el botón habilitado', async ({ page }) => {
    await seedProposalData(page);
    await openApp(page);

    await page.evaluate(() => { location.hash = '#/algoritmo'; });
    await expect(page.locator('#algoGenerate')).toBeVisible();

    await page.click('#algoGenerate');
    await expect(page.locator('h3:has-text("Programa de salidas incompleto")')).toBeVisible();

    // Cancelar: el botón debe volver a estar habilitado y listo para generar.
    await page.click('#algoSalidasCancel');
    await expect(page.locator('#algoGenerate')).toBeEnabled();
    await expect(page.locator('#algoGenerate')).not.toContainText('Generando');

    // Se puede volver a generar.
    await page.click('#algoGenerate');
    await expect(page.locator('h3:has-text("Programa de salidas incompleto")')).toBeVisible();
  });

  test('salidas: marcar semanas sin salida evita el aviso de faltantes', async ({ page }) => {
    await seedProposalData(page);
    await openApp(page);

    await page.evaluate(() => { location.hash = '#/new'; });
    await expect(page.locator('[data-tab="salidas"]')).toBeVisible();
    await page.click('[data-tab="salidas"]');
    await expect(page.locator('[data-sinsalida="0"]')).toBeVisible();

    for (let i = 0; i < 4; i++) {
      await page.check(`[data-sinsalida="${i}"]`);
    }
    await page.click('#salidasSave');
    await expect(page.locator('#toastRoot')).toContainText('Salidas guardadas');

    // Al generar, ya no aparece el aviso de salidas incompletas.
    await page.evaluate(() => { location.hash = '#/algoritmo'; });
    await expect(page.locator('#algoGenerate')).toBeVisible();
    await page.click('#algoGenerate');
    await expect(page.locator('[data-previa]').first()).toBeVisible({ timeout: 20000 });
  });

  test('salidas: no muestra el cuadro de conflictos (salidas tiene prioridad)', async ({ page }) => {
    await seedProposalData(page);
    await openApp(page);

    // Duplicado provocado de propósito: el MISMO orador dos veces en la semana 1
    // (antes mostraba el badge "Repite en la semana" y el cuadro de avisos).
    await page.evaluate(() => new Promise((res, rej) => {
      const req = indexedDB.open('reunion-plus', 8);
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('salidas', 'readwrite');
        const st = tx.objectStore('salidas');
        const g = st.get('2026-08');
        g.onsuccess = () => {
          const p = g.result;
          p.weeks[0].outings = [
            { oradorSalida: 1, tituloDiscurso: '' },
            { oradorSalida: 1, tituloDiscurso: '' },
          ];
          st.put(p);
          tx.oncomplete = () => { db.close(); res(); };
          tx.onerror = () => rej(tx.error);
        };
        g.onerror = () => rej(g.error);
      };
      req.onerror = () => rej(req.error);
    }));

    await page.evaluate(() => { location.hash = '#/new'; });
    await expect(page.locator('[data-tab="salidas"]')).toBeVisible();
    await page.click('[data-tab="salidas"]');
    await expect(page.locator('[data-outing="0.0"]')).toBeVisible();
    await expect(page.locator('[data-outing="0.1"]')).toBeVisible();

    // El cuadro de conflictos de salidas ya no existe ni aparecen badges.
    await expect(page.locator('#salidasCross')).toHaveCount(0);
    await expect(page.locator('.conflict-dot')).toHaveCount(0);
    await expect(page.locator('#salidasList')).not.toContainText('Repite');
  });

  test('salidas: agregar congregación permite escribir su nombre y persiste', async ({ page }) => {
    await seedProposalData(page);
    await openApp(page);

    await page.evaluate(() => { location.hash = '#/new'; });
    await expect(page.locator('[data-tab="salidas"]')).toBeVisible();
    await page.click('[data-tab="salidas"]');
    await expect(page.locator('#addCongBtn')).toBeVisible();

    // Añadir una congregación y escribir su nombre.
    await page.click('#addCongBtn');
    const nombre = page.locator('input[data-cong-field="nombre"]').last();
    await nombre.fill('Congregación Nueva');
    await page.click('#salidasSave');
    await expect(page.locator('#toastRoot')).toContainText('Salidas guardadas');

    // Recargar la pestaña: el nombre persiste guardado.
    await page.click('[data-tab="general"]');
    await page.click('[data-tab="salidas"]');
    await expect(page.locator('input[data-cong-field="nombre"]').last()).toHaveValue('Congregación Nueva');
  });

  test('salidas: vista final ordena orador y discurso en sus columnas con fecha destacada', async ({ page }) => {
    await seedProposalData(page);
    await openApp(page);

    // Asignar orador + discurso en la primera salida directamente en la BD.
    await page.evaluate(() => new Promise((res, rej) => {
      const req = indexedDB.open('reunion-plus', 8);
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('salidas', 'readwrite');
        const st = tx.objectStore('salidas');
        const g = st.get('2026-08');
        g.onsuccess = () => {
          const p = g.result;
          p.weeks[0].outings[0].oradorSalida = 1;
          p.weeks[0].outings[0].tituloDiscurso = 'Discurso Test';
          st.put(p);
          tx.oncomplete = () => { db.close(); res(); };
          tx.onerror = () => rej(tx.error);
        };
        g.onerror = () => rej(g.error);
      };
      req.onerror = () => rej(req.error);
    }));

    await page.evaluate(() => { location.hash = '#/outings/2026-08'; });
    await expect(page.locator('#outingsContent')).toBeVisible();

    // Encabezado: "SALIDAS | AGOSTO 2026" y "Congregación Test — Sábados".
    await expect(page.locator('#outingsContent')).toContainText('SALIDAS');
    await expect(page.locator('#outingsContent')).toContainText('AGOSTO 2026');
    await expect(page.locator('#outingsContent')).toContainText('Congregación Test');

    // Cabecera con las tres columnas.
    const headers = page.locator('#outingsContent thead th');
    await expect(headers).toHaveText(['Semana / Fecha', 'Orador', 'Discurso']);

    // El orador y el discurso quedan en celdas separadas.
    const fila = page.locator('#outingsContent tbody tr').first();
    const celdas = fila.locator('td');
    await expect(celdas.nth(1)).toContainText('Álvaro P.');
    await expect(celdas.nth(2)).toContainText('Discurso Test');
    // La columna 1 tiene la etiqueta pequeña "Semana" y el número de día.
    await expect(celdas.nth(0)).toContainText('Semana 1');
    await expect(celdas.nth(0).locator('.outing-fecha')).toHaveText('1');

    // Dos formatos de salida: A4 vertical y Móvil 16:9.
    await expect(page.locator('#outModeSel')).toBeVisible();
    await expect(page.locator('#outingsContent')).toHaveClass(/outings-mode-a4/);
    await page.click('[data-outmode="movil"]');
    await expect(page.locator('#outingsContent')).toHaveClass(/outings-mode-movil/);
    // En móvil: tarjetas con semana/fecha arriba y discurso a lo ancho.
    await expect(page.locator('.outings-movil')).toBeVisible();
    await expect(page.locator('.outings-movil-row').first()).toContainText('Discurso Test');

    // Exportar imagen no debe fallar por canvas contaminado (fuentes externas).
    await page.click('#outImg');
    await expect(page.locator('#toastRoot')).toContainText('Imagen descargada', { timeout: 15000 });
  });

  test('fin de semana tabla: columnas con anchos, grupo desde aseo y WhatsApp comparte imagen', async ({ page }) => {
    await seedProposalData(page);
    await openApp(page);

    await page.evaluate(() => { location.hash = '#/preview/2026-08?mode=tabla'; });
    await expect(page.locator('#previewContent thead th')).toHaveText(['Fecha', 'Presidente', 'Discurso', 'Orador', 'Estudio', 'Lector', 'Grupo']);

    // Anchos de columna: Fecha 7%, Discurso 30%, Grupo 7%.
    const cols = page.locator('#previewContent col');
    await expect(cols.nth(0)).toHaveClass(/w-\[7%\]/);
    await expect(cols.nth(2)).toHaveClass(/w-\[30%\]/);
    await expect(cols.nth(6)).toHaveClass(/w-\[7%\]/);

    // Grupo desde el programa de aseo.
    await expect(page.locator('#previewContent tbody tr').first()).toContainText('Grupo 1');

    // WhatsApp comparte como imagen.
    await page.click('#waProgram');
    await expect(page.locator('#toastRoot')).toContainText('Imagen descargada', { timeout: 15000 });
  });

  test('fin de semana lista: incluye labores de servicio y grupo semanal; labores exporta imagen', async ({ page }) => {
    await seedProposalData(page);
    await openApp(page);

    // Asignar un puesto de sonido en el programa de atención (semana 1).
    await page.evaluate(() => new Promise((res, rej) => {
      const req = indexedDB.open('reunion-plus', 8);
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('atencion', 'readwrite');
        const st = tx.objectStore('atencion');
        const g = st.get('2026-08');
        g.onsuccess = () => {
          const p = g.result;
          p.weeks[0].labores = { sonido: [1] };
          st.put(p);
          tx.oncomplete = () => { db.close(); res(); };
          tx.onerror = () => rej(tx.error);
        };
        g.onerror = () => rej(g.error);
      };
      req.onerror = () => rej(req.error);
    }));

    // Vista Lista de fin de semana: labores de servicio + grupo semanal.
    await page.evaluate(() => { location.hash = '#/preview/2026-08'; });
    await expect(page.locator('#previewContent')).toContainText('ATENCIÓN');
    await expect(page.locator('#previewContent')).toContainText('Álvaro P.');
    await expect(page.locator('#previewContent')).toContainText('Grupo semanal');
    await expect(page.locator('#previewContent')).toContainText('Grupo 1');

    // Programa de labores: botones de exportación y guardar imagen.
    await page.evaluate(() => { location.hash = '#/atencion/2026-08'; });
    await expect(page.locator('#labImg')).toBeVisible();
    await expect(page.locator('#labPrint')).toBeVisible();
    await page.click('#labImg');
    await expect(page.locator('#toastRoot')).toContainText('Imagen descargada', { timeout: 15000 });
  });

  test('general: semana con presidente, oración final, salida sin discurso e imagen por semana', async ({ page }) => {
    await seedProposalData(page);
    await openApp(page);

    // Salida con orador y discurso (se escribe directo en la BD).
    await page.evaluate(() => new Promise((res, rej) => {
      const req = indexedDB.open('reunion-plus', 8);
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('salidas', 'readwrite');
        const st = tx.objectStore('salidas');
        const g = st.get('2026-08');
        g.onsuccess = () => {
          g.result.weeks[0].outings[0].oradorSalida = 1;
          g.result.weeks[0].outings[0].tituloDiscurso = 'Discurso Test';
          st.put(g.result);
          tx.oncomplete = () => { db.close(); res(); };
          tx.onerror = () => rej(tx.error);
        };
        g.onerror = () => rej(g.error);
      };
      req.onerror = () => rej(req.error);
    }));

    // Presidente de entre semana vía el editor (actualiza el catálogo en memoria).
    await page.evaluate(() => { location.hash = '#/midweek/2026-08-03'; });
    await page.selectOption('select[data-mw-presidente]', '1');
    await page.click('#mwSave');
    await expect(page.locator('#toastRoot')).toContainText('Asignaciones guardadas');

    await page.evaluate(() => { location.hash = '#/general/2026-08'; });
    await expect(page.locator('#generalMonth')).toBeVisible();
    await expect(page.locator('#app')).toContainText('Presidente: Álvaro P.');
    await expect(page.locator('#app')).toContainText('Oración final');
    // Salida solo muestra el nombre del orador (no el discurso).
    await expect(page.locator('#app')).toContainText('Álvaro P.');
    await expect(page.locator('#app')).not.toContainText('Discurso Test');

    // Imagen por semana.
    await page.click('[data-week-img="0"]');
    await expect(page.locator('#toastRoot')).toContainText('Imagen descargada', { timeout: 15000 });
  });

  test('general: conflictos mensuales con autorizar excepción y cambiar persona', async ({ page }) => {
    await seedProposalData(page);
    await openApp(page);

    // El botón aparece en la pestaña General embebida (Programas).
    await page.evaluate(() => { location.hash = '#/new'; });
    await page.click('[data-tab="general"]');
    await expect(page.locator('#genConflictsBtn')).toBeVisible();

    // Presidente de entre semana vía editor (actualiza catálogo en memoria).
    await page.evaluate(() => { location.hash = '#/midweek/2026-08-03'; });
    await page.selectOption('select[data-mw-presidente]', '1');
    await page.click('#mwSave');
    await expect(page.locator('#toastRoot')).toContainText('Asignaciones guardadas');

    // Acomodación de la MISMA semana (atencion sábado 08-08 → domingo 08-09).
    await page.evaluate(() => new Promise((res, rej) => {
      const req = indexedDB.open('reunion-plus', 8);
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('atencion', 'readwrite');
        const st = tx.objectStore('atencion');
        const g = st.get('2026-08');
        g.onsuccess = () => {
          g.result.weeks[1].labores = { acomodacion: [1] };
          st.put(g.result);
          tx.oncomplete = () => { db.close(); res(); };
          tx.onerror = () => rej(tx.error);
        };
        g.onerror = () => rej(g.error);
      };
      req.onerror = () => rej(req.error);
    }));

    await page.evaluate(() => { location.hash = '#/general/2026-08'; });
    await expect(page.locator('#genConflictsBtn')).toBeVisible();
    await page.click('#genConflictsBtn');
    await expect(page.locator('h1:has-text("Conflictos mensuales")')).toBeVisible();
    await expect(page.locator('#app')).toContainText('E1');
    await expect(page.locator('#app')).toContainText('Álvaro P.');
    await expect(page.locator('#app [data-cambiar]').first()).toBeVisible();

    // Autorizar excepción (puntual).
    await page.click('[data-autorizar]');
    await page.click('#mdOk');
    await expect(page.locator('#app')).toContainText('Quitar autorización');

    // Volver y reabrir: el conflicto sigue autorizado (no pendiente).
    await page.click('[data-cvolver]');
    await expect(page.locator('#generalMonth')).toBeVisible();
    await page.click('#genConflictsBtn');
    await expect(page.locator('#app')).toContainText('Quitar autorización');
  });

  test('guardar con conflicto ya no bloquea el programa (avisa y guarda)', async ({ page }) => {
    await seedProposalData(page);
    await openApp(page);

    // Crear un conflicto en fin de semana: la misma persona presidente y conductor.
    await page.evaluate(() => new Promise((res, rej) => {
      const req = indexedDB.open('reunion-plus', 8);
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('months', 'readwrite');
        const st = tx.objectStore('months');
        const g = st.get('2026-08');
        g.onsuccess = () => {
          g.result.weeks[0].presidente = 1;
          g.result.weeks[0].conductor = 1;
          st.put(g.result);
          tx.oncomplete = () => { db.close(); res(); };
          tx.onerror = () => rej(tx.error);
        };
        g.onerror = () => rej(g.error);
      };
      req.onerror = () => rej(req.error);
    }));

    await page.evaluate(() => { location.hash = '#/edit/2026-08'; });
    // El conflicto se marca en el editor (borde rojo parpadeante en el conductor).
    await expect(page.locator('select[data-field="conductor"][data-idx="0"]')).toHaveClass(/border-error/);

    // Guardar: ya no bloquea; guarda igualmente con el aviso.
    await page.click('#btnSave');
    await expect(page.locator('#toastRoot')).toContainText('Cambios guardados');
  });

  test('personas: asignación de grupos en lote y avatar con número de grupo', async ({ page }) => {
    await seedProposalData(page);
    await openApp(page);
    await page.click('#sideNavItems button[data-go="lists"]');
    await page.waitForSelector('h1:has-text("Congregación")', { state: 'visible' });

    await page.click('[data-tab="grupos"]');
    await page.click('#assignGroupBtn');
    await expect(page.locator('#modalCard')).toContainText('Asignar grupos');
    await page.selectOption('#gaGrupo', '1');
    await page.click('#gaAll');
    await page.click('#gaAsign');
    await expect(page.locator('#toastRoot')).toContainText('asignado(s) al grupo');
    await expect(page.locator('#modalCard')).toContainText('7 de 7 asignados');
    await expect(page.locator('#modalCard')).toContainText('Volver a asignar');

    // Cerrar: en Personas, el avatar de la primera persona muestra el número de grupo.
    await page.click('#gaClose');
    await page.click('[data-tab="personas"]');
    const card = page.locator('.person-card').first();
    await expect(card.locator('.rounded-full').first()).toContainText('1');
  });

  test('personas: carpetas de grupos y departamentos (interior y métricas)', async ({ page }) => {
    await seedProposalData(page);
    await openApp(page);
    await page.click('#sideNavItems button[data-go="lists"]');
    await page.waitForSelector('h1:has-text("Congregación")', { state: 'visible' });

    // Grupos: card del grupo y su interior (vista completa).
    await page.click('[data-tab="grupos"]');
    await expect(page.locator('[data-grupo="1"]')).toBeVisible();
    await page.click('[data-grupo="1"]');
    await expect(page.locator('#pList')).toContainText('Grupo 1');
    await expect(page.locator('#pList')).toContainText('miembro(s)');
    await expect(page.locator('#assignGroupBtn')).toBeVisible();
    await page.click('[data-gvolver]');

    // Departamentos: mini-cards de labor y su interior con opción de agregar.
    await page.click('[data-tab="departamentos"]');
    await expect(page.locator('#manageLaboresBtn')).toBeVisible();
    await expect(page.locator('[data-departamento]').first()).toBeVisible();
    await page.locator('[data-departamento]').first().click();
    await expect(page.locator('#pList')).toContainText('persona(s) con esta labor');
    await page.click('[data-dvolver]');
  });

  test('nube: el botón guardar avisa cuando Supabase no está configurado', async ({ page }) => {
    await seedProposalData(page);
    await openApp(page);

    await expect(page.locator('#onlineBtn')).toBeVisible();
    // Sin Supabase no hay nada que subir: la etiqueta "Guardar cambios" está oculta.
    await expect(page.locator('#syncSaveLabel')).toBeHidden();
    // Pulsar la nube explica que Supabase no está configurado.
    await page.click('#onlineBtn');
    await expect(page.locator('#toastRoot')).toContainText('Supabase no está configurado');
  });

  test('programas: generar automáticamente por pestaña rellena el programa', async ({ page }) => {
    await seedProposalData(page);
    await openApp(page);

    await page.evaluate(() => { location.hash = '#/new'; });
    await expect(page.locator('[data-tab="entre"]')).toBeVisible();
    await page.click('[data-tab="entre"]');
    await expect(page.locator('#newGenBtn')).toBeVisible();

    // Sin asignaciones previas genera sin pedir confirmación.
    await page.click('#newGenBtn');
    await expect(page.locator('#toastRoot')).toContainText('Generado');

    // El presidente quedó asignado en las semanas (sin vacíos).
    await expect(page.locator('#newTabBody')).not.toContainText('Presidente: —');
  });

  test('programas: generar mensual completo avisa, cancela y regenera', async ({ page }) => {
    await seedProposalData(page);
    await openApp(page);

    await page.evaluate(() => { location.hash = '#/new'; });
    await expect(page.locator('#genAllBtn')).toBeVisible();

    // Primera vez: sin asignaciones → genera sin confirmar.
    await page.click('#genAllBtn');
    await expect(page.locator('#toastRoot')).toContainText('Programa mensual generado');

    // Segunda vez: ya hay asignaciones → pide confirmación (spec 16).
    await page.click('#genAllBtn');
    await expect(page.locator('h3:has-text("Generar programa mensual completo")')).toBeVisible();
    await page.click('#genCancel');
    await expect(page.locator('#genAllBtn')).toBeEnabled();

    // Reintentar y continuar regenera.
    await page.click('#genAllBtn');
    await expect(page.locator('h3:has-text("Generar programa mensual completo")')).toBeVisible();
    await page.click('#genGo');
    await expect(page.locator('#toastRoot')).toContainText('Programa mensual generado');
  });

  test('entre semana: oración final como extensión del conductor del estudio y presidente en negrita', async ({ page }) => {
    await seedProposalData(page);
    await openApp(page);

    await page.evaluate(() => { location.hash = '#/midweek/2026-08-03'; });
    await expect(page.locator('h1:has-text("3-10 de AGOSTO DE 2026")')).toBeVisible();

    // Presidente: más a la derecha y en negrita.
    const pres = page.locator('#mwEditor select[data-mw-presidente]');
    await expect(pres).toBeVisible();
    await expect(pres).toHaveClass(/font-bold/);

    // Oración final derivada del conductor del Estudio Bíblico: sin asignar
    // muestra el texto por defecto y NO crea un select nuevo.
    await expect(page.locator('#mwEditor')).toContainText('Oración final');
    await expect(page.locator('[data-oracion-final]')).toContainText('Quien conduce el estudio');

    // Al asignar el conductor del Estudio Bíblico (vida, última parte), la
    // oración final muestra su nombre en vivo.
    await page.selectOption('select[data-sec="2"][data-part="7"][data-slot="conductor"]', '1');
    await expect(page.locator('[data-oracion-final]')).toContainText('Álvaro P.');

    // Guardar para que la vista final lea la asignación persistida.
    await page.click('#mwSave');
    await expect(page.locator('#toastRoot')).toContainText('Asignaciones guardadas');

    // Vista Final: la oración final aparece antes de las palabras de conclusión.
    await page.click('#mwPreviewBtn');
    await expect(page.locator('#mwDoc')).toContainText('Oración final:');
    await expect(page.locator('#mwDoc')).toContainText('Álvaro P.');
  });

  test('atención: el select de cada labor solo muestra a quienes la tienen habilitada', async ({ page }) => {
    await seedAtencionSelects(page);
    await openApp(page);

    await page.evaluate(() => { location.hash = '#/new'; });
    await expect(page.locator('[data-tab="atencion"]')).toBeVisible();
    await page.click('[data-tab="atencion"]');
    await expect(page.locator('select[data-atencion-key="sonido"]').first()).toBeVisible();

    // Sonido (FS): solo la persona con la labor 'audio'/'sonido'.
    await expect(page.locator('select[data-atencion-key="sonido"]').first().locator('option')).toHaveText(['— Sin asignar —', 'Persona Audio']);
    // La persona sin labores y las de otras labores no aparecen.
    await expect(page.locator('select[data-atencion-key="sonido"]').first()).not.toContainText('Persona Microfono');
    await expect(page.locator('select[data-atencion-key="sonido"]').first()).not.toContainText('Persona Acomodador');
    await expect(page.locator('select[data-atencion-key="sonido"]').first()).not.toContainText('Persona Sin Labor');

    // Acomodación: solo quien tiene 'acomodador'.
    await expect(page.locator('select[data-atencion-key="acomodacion"]').first().locator('option')).toHaveText(['— Sin asignar —', 'Persona Acomodador']);
    // Micrófono: solo quien tiene 'microf'.
    await expect(page.locator('select[data-atencion-key="microfono"]').first().locator('option')).toHaveText(['— Sin asignar —', 'Persona Microfono']);

    // El select entre semana aplica el mismo filtro.
    await expect(page.locator('select[data-mwatencion-key="sonido"]').first().locator('option')).toHaveText(['— Sin asignar —', 'Persona Audio']);
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
