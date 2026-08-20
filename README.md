# Reunión+

Aplicación web progresiva (PWA) para crear el **programa mensual de reuniones** de forma rápida, sencilla e intuitiva. Funciona en el navegador, **sin conexión a Internet** (IndexedDB) y opcionalmente se **sincroniza con Supabase** (Postgres + Auth + RLS) entre dispositivos, con autenticación y roles.

> **Despliegue y configuración (Supabase + GitHub Pages)**: ver [GUIA-DESPLIEGUE.md](GUIA-DESPLIEGUE.md).

## Características

- Selección del mes y año; genera automáticamente todas las semanas (sábados).
- Editor por semana con 4 tipos de evento:
  - **Normal**
  - **Visita del Supervisor** (con nombre del supervisor, dos discursos y estudio sin lectura)
  - **Asamblea** (sin reunión local)
  - **Conmemoración**
- Validación automática de conflictos (misma persona en dos roles de la misma reunión) y campos obligatorios.
- **Buscador de discursos** por número o palabra clave (lista sincronizada desde Supabase).
- Selectores de personas filtrados por **labor/rol** (presidente, conductor/orador-estudio, lector, orador) sincronizados desde Supabase.
- **Grupos** (departamentos de atención) sincronizados desde Supabase.
- **Salidas a congregaciones**:
  - Cuadro general con nombre de congregación, día y hora (múltiples congregaciones por mes).
  - Por semana normal, lista de oradores + discurso, con botón para añadir más.
  - Validación: ningún orador se repite en salidas de la misma semana.
  - Vista final de salidas separada con exportación a PDF/imagen/WhatsApp.
- Vista previa en dos formatos: **lista** y **tabla**.
- Exportación: Imprimir / PDF / Compartir (Web Share + portapapeles) / WhatsApp / Guardar como imagen.
- Reutilización del mes anterior como base.
- **Algoritmo de asignación automática explicable** (motivos por asignación, historial y regla 7 de flexibilización informada).
- **Carga de Archivos** (menú “Carga”):
  - **Conferencias**: subida de PDF → extracción de títulos numerados → reescritura de la tabla `discursos`.
  - **Personas**: plantilla descargable **Excel (.xlsx) con listas desplegables** (Nombre / Sexo / Calificación / Cargo / Grupo); se llena y se sube directamente → extracción → reescritura de la tabla `participantes`.
  - **Guía de Actividades**: subida de PDF o **EPUB** → extracción de semanas → **carga acumulativa por fecha** (cada semana se guarda por su `id` YYYY-MM-DD; si la fecha ya existe se pregunta si reescribir).
- **Resumen de base de datos interactivo** (en vista “Carga”): tarjetas clicables con listas y CRUD — **Personas**, **Conferencias**, **Departamentos (grupos)**, **Semanas de entre semana**.
- **Offline**: Service Worker + IndexedDB. La información se almacena localmente.
- **Sincronización con Supabase**: login con email/contraseña (o Google), roles `admin`/`reader`, y seguridad por políticas RLS en Postgres.

## Estructura

```
index.html          Shell SPA
app.js              Lógica completa (router, vistas, validación, exportación, carga)
logic.js            Funciones puras (automatización, PDF/EPUB, historial, parseadores)
db.js               Capa IndexedDB (months, people, departments, settings, talks, midweeks, aseos)
supabase-config.js  Credenciales de Supabase (Project URL + anon key; NO versionado)
supabase.js         Capa de acceso a Supabase (Postgres + RLS)
supabase/schema.sql Esquema de tablas y políticas RLS (para el SQL Editor)
auth.js             Autenticación (login/logout/sesión/rol) con Supabase Auth
sync.js             Sincronización IndexedDB ↔ Supabase (cola offline, pull/push)
migracion.js        Migración de datos local → Supabase
epub.js             Extracción de texto de EPUB (Guía de Actividades)
xlsx.js             Plantilla .xlsx de participantes (generación y lectura)
sw.js               Service Worker (cache offline)
styles.css          Estilos personalizados + reglas de impresión
manifest.json       Manifest PWA
icons/              Íconos PWA
favicon.png
vendor/pdfjs/       PDF.js v12.17.1 (parseo de PDF offline)
vendor/jszip/       JSZip (EPUB y XLSX offline)
```

## Desarrollo

Servidor local:

```powershell
# Opcional: servidor estático en http://localhost:5556/
powershell -File servidor.ps1
```

O cualquier servidor estático servirá (la PWA no requiere build).

## Notas

- `S-99_S.pdf` (lista oficial de discursos) **no se incluye** en el repositorio por restricciones de copyright. La lista de discursos se mantiene en Supabase (tabla `discursos`).
- `servidor.ps1` es un helper local opcional y queda excluido del control de versiones.
- Los archivos PDF de la Guía de Actividades (`mwb_S_*.pdf`) y de materiales con copyright no se versionan.
