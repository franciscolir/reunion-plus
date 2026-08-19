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

// Seed directo en IndexedDB (mismo esquema v7 de db.js) con un equipo y una guía
// de actividades de agosto para que el motor genere propuestas sin pasar por la UI.
// Todas las personas son hombres con todas las labores: el algoritmo rellena todo.
export async function seedProposalData(page) {
  const people = [
    { name: 'Álvaro P.', genero: 'masculino', calificacion: 'A', labores: ['presidente', 'asignacion1', 'asignacion2', 'asignacion3', 'asignacion4', 'conductor1', 'conductor2', 'lector1', 'lector2', 'orador', 'estudioSinLectura'] },
    { name: 'Benjamín R.', genero: 'masculino', calificacion: 'B', labores: ['presidente', 'asignacion1', 'asignacion2', 'asignacion3', 'asignacion4', 'conductor1', 'conductor2', 'lector1', 'lector2', 'orador', 'estudioSinLectura'] },
    { name: 'Carlos M.', genero: 'masculino', calificacion: 'B', labores: ['presidente', 'asignacion1', 'asignacion2', 'asignacion3', 'asignacion4', 'conductor1', 'conductor2', 'lector1', 'lector2', 'orador', 'estudioSinLectura'] },
    { name: 'Daniel S.', genero: 'masculino', calificacion: 'C', labores: ['presidente', 'asignacion1', 'asignacion2', 'asignacion3', 'asignacion4', 'conductor1', 'conductor2', 'lector1', 'lector2', 'orador', 'estudioSinLectura'] },
    { name: 'Ernesto T.', genero: 'masculino', calificacion: 'C', labores: ['presidente', 'asignacion1', 'asignacion2', 'asignacion3', 'asignacion4', 'conductor1', 'conductor2', 'lector1', 'lector2', 'orador', 'estudioSinLectura'] },
    { name: 'Fabián U.', genero: 'masculino', calificacion: 'D', labores: ['presidente', 'asignacion1', 'asignacion2', 'asignacion3', 'asignacion4', 'conductor1', 'conductor2', 'lector1', 'lector2', 'orador', 'estudioSinLectura'] },
    { name: 'Gonzalo V.', genero: 'masculino', calificacion: 'D', labores: ['presidente', 'asignacion1', 'asignacion2', 'asignacion3', 'asignacion4', 'conductor1', 'conductor2', 'lector1', 'lector2', 'orador', 'estudioSinLectura'] },
  ];
  const section = (id, title, parts) => ({ id, title, parts: parts.map(n => ({ num: n, title: `Parte ${n}`, mins: 5, assignments: {} })) });
  const midweeks = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24'].map((id, i) => ({
    id,
    presidente: '',
    header: `3-10 de AGOSTO DE 2026`,
    reading: `Lectura ${i + 1}`,
    introSong: '1',
    introTitle: 'Canción de entrada',
    introMins: 2,
    closingTitle: 'Palabras de conclusión',
    closingMins: 3,
    songOut: '2',
    sections: [
      section('tesoros', 'Tesoros de la Biblia', [1, 2]),
      section('maestros', 'Seamos Mejores Maestros', [3, 4]),
      section('vida', 'Nuestra Vida Cristiana', [5, 6, 7]),
    ],
  }));
  const fsDates = ['2026-08-01', '2026-08-08', '2026-08-15', '2026-08-22'];
  const month = {
    id: '2026-08', year: 2026, month: 8, published: false,
    weeks: fsDates.map(date => ({ date, type: 'normal', presidente: '', conductor: '', lector: '', orador: '', tituloDiscurso: '', estudioSinLectura: '' })),
  };
  const salidas = [{ id: '2026-08', congregations: [{ nombre: 'Test' }], weeks: fsDates.map(saturday => ({ saturday, outings: [{ oradorSalida: '', tituloDiscurso: '' }] })) }];
  const atencion = [{ id: '2026-08', weeks: fsDates.map(saturday => ({ saturday, labores: {} })) }];
  const departments = [{ id: 1, name: 'Grupo 1', activo: true }];
  const aseos = [{ id: '2026-08', weeks: fsDates.map(saturday => ({ saturday, group: 1 })) }];

  await page.addInitScript(({ people, midweeks, month, salidas, atencion, departments, aseos }) => {
    (async () => {
      const DB = 'reunion-plus';
      await new Promise((res) => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = res; r.onerror = res; r.onblocked = res; });
      const db = await new Promise((res, rej) => {
        const req = indexedDB.open(DB, 8);
        req.onupgradeneeded = (e) => {
          const d = e.target.result;
          const mk = (n, kp, auto) => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, kp ? { keyPath: kp, ...(auto ? { autoIncrement: true } : {}) } : undefined); };
          mk('months', 'id'); mk('people', 'id', true); mk('departments', 'id', true);
          mk('settings'); mk('talks', 'num'); mk('midweeks', 'id'); mk('aseos', 'id');
          mk('salidas', 'id'); mk('atencion', 'id'); mk('assignment_log', 'id');
        };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const tx = db.transaction(['people', 'midweeks', 'months', 'salidas', 'atencion', 'settings', 'departments', 'aseos'], 'readwrite');
      people.forEach(p => tx.objectStore('people').add(p));
      midweeks.forEach(w => tx.objectStore('midweeks').put(w));
      tx.objectStore('months').put(month);
      salidas.forEach(s => tx.objectStore('salidas').put(s));
      atencion.forEach(a => tx.objectStore('atencion').put(a));
      departments.forEach(d => tx.objectStore('departments').put(d));
      aseos.forEach(a => tx.objectStore('aseos').put(a));
      tx.objectStore('settings').put({ congregation: 'Congregación Test', lastMonthId: '2026-08' }, 'congregation');
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      db.close();
    })();
  }, { people, midweeks, month, salidas, atencion, departments, aseos });
}

// Seed mínimo para probar el filtro por labor en los selectores de atención:
// cada persona tiene solo UNA labor, para verificar que cada puesto solo ofrece
// a quienes tienen esa labor habilitada (y no a quien no tiene labores).
export async function seedAtencionSelects(page) {
  const people = [
    { name: 'Persona Audio', genero: 'masculino', calificacion: 'B', labores: ['audio'] },
    { name: 'Persona Microfono', genero: 'masculino', calificacion: 'B', labores: ['microf'] },
    { name: 'Persona Acomodador', genero: 'masculino', calificacion: 'B', labores: ['acomodador'] },
    { name: 'Persona Sin Labor', genero: 'masculino', calificacion: 'B', labores: [] },
  ];
  const saturday = '2026-08-01';
  const month = { id: '2026-08', year: 2026, month: 8, published: false, weeks: [{ date: saturday, type: 'normal', presidente: '', conductor: '', lector: '', orador: '', tituloDiscurso: '', estudioSinLectura: '' }] };
  const midweeks = [{ id: '2026-08-03', presidente: '', header: '3-10 de AGOSTO DE 2026', sections: [] }];
  const atencion = [{ id: '2026-08', weeks: [{ saturday, labores: {} }] }];

  await page.addInitScript(({ people, month, midweeks, atencion }) => {
    (async () => {
      const DB = 'reunion-plus';
      await new Promise((res) => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = res; r.onerror = res; r.onblocked = res; });
      const db = await new Promise((res, rej) => {
        const req = indexedDB.open(DB, 8);
        req.onupgradeneeded = (e) => {
          const d = e.target.result;
          const mk = (n, kp, auto) => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, kp ? { keyPath: kp, ...(auto ? { autoIncrement: true } : {}) } : undefined); };
          mk('months', 'id'); mk('people', 'id', true); mk('departments', 'id', true);
          mk('settings'); mk('talks', 'num'); mk('midweeks', 'id'); mk('aseos', 'id');
          mk('salidas', 'id'); mk('atencion', 'id'); mk('assignment_log', 'id');
        };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const tx = db.transaction(['people', 'midweeks', 'months', 'atencion', 'settings'], 'readwrite');
      people.forEach(p => tx.objectStore('people').add(p));
      tx.objectStore('months').put(month);
      midweeks.forEach(w => tx.objectStore('midweeks').put(w));
      atencion.forEach(a => tx.objectStore('atencion').put(a));
      tx.objectStore('settings').put({ congregation: 'Congregación Test', lastMonthId: '2026-08' }, 'congregation');
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      db.close();
    })();
  }, { people, month, midweeks, atencion });
}
