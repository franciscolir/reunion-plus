# Reunión+

Aplicación web progresiva (PWA) para crear el **programa mensual de reuniones** de forma rápida, sencilla e intuitiva. Funciona completamente en el navegador, **sin conexión a Internet** y sin inicio de sesión.

## Características

- Selección del mes y año; genera automáticamente todas las semanas (sábados).
- Editor por semana con 4 tipos de evento:
  - **Normal**
  - **Visita del Supervisor** (con nombre del supervisor, dos discursos y estudio sin lectura)
  - **Asamblea** (sin reunión local)
  - **Conmemoración**
- Validación automática de conflictos (misma persona en dos roles de la misma reunión) y campos obligatorios.
- **Buscador de discursos** por número o palabra clave (lista cargada desde `discursos.json`).
- Selectores de personas filtrados por **rol** (presidente, conductor/orador-estudio, lector, orador) cargados desde `participantes.json`.
- **Grupos** (departamentos de atención) cargados desde `grupos.json`.
- **Salidas a congregaciones**:
  - Cuadro general con nombre de congregación, día y hora (múltiples congregaciones por mes).
  - Por semana normal, lista de oradores + discurso, con botón para añadir más.
  - Validación: ningún orador se repite en salidas de la misma semana.
  - Vista final de salidas separada con exportación a PDF/imagen/WhatsApp.
- Vista previa en dos formatos: **lista** y **tabla**.
- Exportación: Imprimir / PDF / Compartir (Web Share + portapapeles) / WhatsApp / Guardar como imagen.
- Reutilización del mes anterior como base.
- **Offline**: Service Worker + IndexedDB. Toda la información se almacena localmente.

## Estructura

```
index.html          Shell SPA
app.js              Lógica completa (router, vistas, validación, exportación)
db.js              Capa IndexedDB (months, people, departments, settings, talks)
sw.js              Service Worker (cache offline)
styles.css          Estilos personalizados + reglas de impresión
manifest.json       Manifest PWA
discursos.json      Lista de discursos (nº + título)
participantes.json  Roles de personas (presidente, lector, conductor, orador)
grupos.json         Grupos de atención
icons/              Íconos PWA
favicon.png
```

## Desarrollo

Servidor local:

```powershell
# Opcional: servidor estático en http://localhost:5555/
powershell -File servidor.ps1
```

O cualquier servidor estático servirá (la PWA no requiere build).

## Notas

- `S-99_S.pdf` (lista oficial de discursos) **no se incluye** en el repositorio por restricciones de copyright. `discursos.json` es la lista derivada de números y títulos de uso interno.
- `servidor.ps1` es un helper local opcional y queda excluido del control de versiones.