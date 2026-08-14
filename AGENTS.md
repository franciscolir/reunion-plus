# AGENTS.md

Contexto del proyecto para agentes de IA (incluido OpenSpec).

## Qué es Reunión+

PWA ("reunión-plus") para confeccionar el **programa mensual de reuniones** de congregación (testigos de Jehová). Interfaz 100% en español. Sin build: HTML/JS/CSS vanilla servidos como estáticos; funciona offline (Service Worker + IndexedDB) y se sincroniza opcionalmente con **Cloud Firestore** (Firebase).

Proyecto: `reunion-b6f14` · Repo: `https://github.com/franciscolir/reunion-plus` · Rama única: `main`.

## Arquitectura

- **Sin framework ni bundler.** Todo son scripts globales cargados en `index.html`. Las funciones se llaman entre módulos de forma global (`window`).
- **Persistencia primaria: IndexedDB** (`reunion-plus`, versión 7). Firestore es la fuente de verdad remota; `sync.js` hace pull/push con cola de cambios offline.
- **Router por hash**: `location.hash` → `#/vista` (ver Router abajo).
- **UI con Tailwind CDN** + `styles.css` custom + Material Symbols (íconos). Selectores de personas con `<input list>`/datalist.
- **PDF**: parseo con `vendor/pdfjs/` (PDF.js v12.17.1) local. `logic.js` extrae títulos/participantes de los PDFs.

## Archivos principales

```
index.html          Shell SPA + nav (botones con data-route / data-go)
app.js              Router, vistas (render*), modales, validación, exportación (5.4k líneas)
logic.js            Funciones puras puras (asignación automática, parseadores PDF, historial, testeadas)
db.js               Capa IndexedDB (stores + CRUD + reset)
firestore.js        Capa de acceso a Firestore (snapshots, batch, CRUD)
auth.js             Autenticación Firebase (login/logout/sesión/rol)
sync.js             Sync IndexedDB ↔ Firestore (cola offline, pull/push, conciliación)
migracion.js        Migración datos local → Firestore
firestore.rules     Reglas de seguridad (desplegadas en producción)
sw.js               Service Worker (cache offline, versión `rp-v123`)
servidor.ps1        Servidor local opcional (http://localhost:5556/) — NO versionado
tests.mjs           Tests unitarios de logic.js (node)
GUIA-DESPLIEGUE.md  Documentación de despliegue Firebase
```

## Stores de IndexedDB (db.js)

| Store | keyPath | Contenido |
|---|---|---|
| `months` | `id` ("YYYY-MM") | Programas mensuales completos |
| `people` | `id` (auto) | Participantes |
| `departments` | `id` (auto) | Departamentos/grupos |
| `settings` | string | Configuración |
| `talks` | `num` | Discursos (n° y título) |
| `midweeks` | `id` ("YYYY-MM-DD") | Reuniones de entre semana |
| `aseos` | `id` ("YYYY-MM") | Programa de aseo por mes |
| `salidas` | `id` ("YYYY-MM") | Programa de salidas por mes |
| `atencion` | `id` ("YYYY-MM") | Programa de atención/acomodación por mes |
| `assignment_log` | `id` (compuesto) | Historial de asignaciones |

Migraciones de esquema se manejan en `openDB()` (DB_VERSION 7). El store `labores` se renombró a `atencion`.

## Colecciones de Firestore (firestore.rules)

`usuarios/{uid}` (rol admin/reader) · `participantes/{id}` · `grupos/{id}` · `reuniones/{id}` (entre semana, id "YYYY-MM-DD") · `programas/{mes}` (mensual agregado) · `asignaciones/{id}` · `discursos/{num}` · `configuracion/{id}`.

- Lectura: cualquier usuario autenticado. Escritura: solo `admin` (`esAdmin()` verifica `usuarios/{uid}.rol == 'admin'`).
- La seguridad vive en las reglas, no en ocultar botones en la UI.

## Router (app.js → router())

Vistas por hash: `new` (nuevo mes), `auto` (asignación automática), `edit`, `preview` (vista previa lista/tabla), `outings` (salidas), `lists`, `uploads` (carga de archivos), `eventos`, `midweeks` / `midweek` / `midweekPreview` / `midweekMonthPreview` / `midweekList` (entre semana), `atencion` / `atencionGrupo`, `salidas`, `general`, `settings`, `about`, `home` (default).

Los botones de la navegación usan `data-go` (desktop) / `data-route` (sidebar). Elementos `[data-admin]` se ocultan para el rol reader (solo UX).

## Carga de Archivos (vista `uploads`)

- **Conferencias**: PDF → extraer títulos numerados → reescribir colección `discursos`.
- **Personas**: descargar plantilla `.xls` (HTML table, `application/vnd.ms-excel`) con columnas *Nombre / Género / Calificación / Grupo / Labores* → llenarla → convertir a PDF → subir → extraer datos → reescribir colección `participantes`.
- **Guía de Actividades**: PDF → extraer semanas → **carga acumulativa por fecha** (cada semana va a `midweeks` por id "YYYY-MM-DD"; si la fecha ya existe pregunta si reescribir).
- **Resumen de base de datos interactivo**: tarjetas clicables con CRUD — Personas, Conferencias, Departamentos, Semanas de entre semana (modales `openPeopleListModal`, `openTalksListModal`, `openDepartmentsListModal`, `openMidweeksListModal`, `promptText`).

## Funciones clave de logic.js

- `convertPdfToData(type, text, opts)` — orquesta los parseadores según tipo (`conferencias` | `personas` | `midweeks`).
- `convertPdfPeople(text, opts)` — soporta **formato tabla** (encabezado + filas, barrido izquierda-derecha, `parsePersonRow` con detección de nombre hasta primer campo conocido) y formato roles clásico.
- Asignación automática: algoritmo explicable con motivos por asignación, historial y regla 7 de flexibilización informada.

## Conventions / reglas de desarrollo

- **NUNCA añadir comentarios al código** salvo que se pida explícitamente.
- UI y textos de la app en **español**. Código (variables, funciones) en inglés mayormente.
- **No versionar**: `servidor.ps1`, `WhatsApp Video*.mp4`, `mwb_S_*.pdf`, `plantilla-participantes.xls`, `node_modules/`, `openspec/` (decidir). `S-99_S.pdf` tampoco (copyright) — la lista de discursos vive en Firestore.
- `npm install` instala las dependencias de desarrollo para tests (`@playwright/test`, `fake-indexeddb`). Los tests se corren con npm scripts o Node directo:
  - **Unitarios**: `node tests.mjs` (320 PASS, `assert` de Node sobre funciones puras de `logic.js`).
  - **Integración**: `node tests-integration.mjs` (capa de datos real: `db.js` sobre IndexedDB con `fake-indexeddb` + flujos cruzados PDF→lógica→persistencia).
  - **E2E**: `npm run test:e2e` (Playwright, Chromium; sirve la app local con `firebase-config.js` mockeado para correr offline — requiere `npx playwright install chromium` la primera vez).
  - **Todo**: `npm run test:all`.
  - Después de tocar `logic.js`, `app.js`, `db.js` o la UI correr al menos unitarios + integración; para cambios de UI, además E2E.
- El Service Worker cachea con versión; al cambiar archivos subir el número `rp-v***` (sw.js) y `?v=***` (cargas en index.html).
- Commit en español, estilo conventional: `feat(firestore): ...`, `fix(...): ...`, `docs: ...`.
- Rama actual: `main` (única). PRs a `main` desde feature branches.

## Comandos útiles

```powershell
powershell -File servidor.ps1        # servidor local http://localhost:5556/
node tests.mjs                       # tests unitarios de logic.js
node tests-integration.mjs           # tests de integración (db.js + fake-indexeddb)
npm run test:e2e                     # tests end-to-end (Playwright, Chromium)
npm run test:all                     # unitarios + integración + E2E
openspec.cmd propose "descripción"   # proponer cambio (OpenSpec)
openspec.cmd plan / implement / deliver
```
