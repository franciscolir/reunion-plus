# Reunión+

Aplicación web progresiva (PWA) para crear el **programa mensual de reuniones** de forma rápida, sencilla e intuitiva. Funciona en el navegador, **sin conexión a Internet** (IndexedDB) y opcionalmente se **sincroniza con Cloud Firestore** (Firebase) entre dispositivos, con autenticación y roles.

> **Despliegue y configuración de Firebase**: ver [GUIA-DESPLIEGUE.md](GUIA-DESPLIEGUE.md).

## Características

- Selección del mes y año; genera automáticamente todas las semanas (sábados).
- Editor por semana con 4 tipos de evento:
  - **Normal**
  - **Visita del Supervisor** (con nombre del supervisor, dos discursos y estudio sin lectura)
  - **Asamblea** (sin reunión local)
  - **Conmemoración**
- Validación automática de conflictos (misma persona en dos roles de la misma reunión) y campos obligatorios.
- **Buscador de discursos** por número o palabra clave (lista sincronizada desde Firestore).
- Selectores de personas filtrados por **labor/rol** (presidente, conductor/orador-estudio, lector, orador) sincronizados desde Firestore.
- **Grupos** (departamentos de atención) sincronizados desde Firestore.
- **Salidas a congregaciones**:
  - Cuadro general con nombre de congregación, día y hora (múltiples congregaciones por mes).
  - Por semana normal, lista de oradores + discurso, con botón para añadir más.
  - Validación: ningún orador se repite en salidas de la misma semana.
  - Vista final de salidas separada con exportación a PDF/imagen/WhatsApp.
- Vista previa en dos formatos: **lista** y **tabla**.
- Exportación: Imprimir / PDF / Compartir (Web Share + portapapeles) / WhatsApp / Guardar como imagen.
- Reutilización del mes anterior como base.
- **Algoritmo de asignación automática explicable** (motivos por asignación, historial y regla 7 de flexibilización informada).
- **Offline**: Service Worker + IndexedDB. La información se almacena localmente.
- **Sincronización con Firebase** (Cloud Firestore): login con email/contraseña, roles `admin`/`reader`, y reglas de seguridad en el servidor.

## Estructura

```
index.html          Shell SPA
app.js              Lógica completa (router, vistas, validación, exportación)
logic.js            Funciones puras (automatización, PDF, historial)
db.js               Capa IndexedDB (months, people, departments, settings, talks)
firebase-config.js  Credenciales de Firebase (proyecto reunion-b6f14)
firestore.js        Capa de acceso a Cloud Firestore
auth.js             Autenticación (login/logout/sesión/rol)
sync.js             Sincronización IndexedDB ↔ Firestore
migracion.js        Migración de datos local → Firestore
firestore.rules     Reglas de seguridad de Firestore
firebase.json       Configuración de deploy (rules + hosting)
sw.js               Service Worker (cache offline)
styles.css          Estilos personalizados + reglas de impresión
manifest.json       Manifest PWA
icons/              Íconos PWA
favicon.png
```

## Desarrollo

Servidor local:

```powershell
# Opcional: servidor estático en http://localhost:5556/
powershell -File servidor.ps1
```

O cualquier servidor estático servirá (la PWA no requiere build).

## Notas

- `S-99_S.pdf` (lista oficial de discursos) **no se incluye** en el repositorio por restricciones de copyright. La lista de discursos se mantiene en Firestore (colección `discursos`).
- `servidor.ps1` es un helper local opcional y queda excluido del control de versiones.