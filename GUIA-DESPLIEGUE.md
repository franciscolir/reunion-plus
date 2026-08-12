# Reunión+ — Guía de despliegue y sincronización con Firebase

Esta guía explica cómo desplegar la app y configurar **Cloud Firestore** para que los datos se sincronicen entre dispositivos (autenticación + roles + reglas de seguridad).

> Proyecto Firebase activo: **`reunion-b6f14`**
> La app funciona 100% offline con IndexedDB; Firebase es el espejo en la nube.

---

## 1. Resumen de la arquitectura

```
PWA (navegador)
   │
   ├── IndexedDB  (db.js)  → fuente local, offline
   │        │
   │        └── sync.js  →  sube/baja cambios
   │
   └── Firebase
          ├── Authentication  (email + contraseña)
          └── Cloud Firestore
                 ├── participantes
                 ├── grupos
                 ├── reuniones
                 ├── programas
                 ├── asignaciones
                 ├── configuracion
                 └── usuarios        ← la única que ya existe (con el admin)
```

---

## 2. Cómo se crean las colecciones en Firebase

**En Cloud Firestore las colecciones NO se crean a mano**: se crean automáticamente en el momento en que se escribe el primer documento en ellas.

**Firebase es la fuente primaria de datos**; IndexedDB actúa como caché local (para que la app funcione sin conexión y no haga consultas recurrentes). Cada vez que guardas algo en la app (una persona, un programa, una asignación…), `sync.js` lo sube a su colección automáticamente. Si no hay conexión, el cambio queda **pendiente** y se sube al recuperar la red.

Al iniciar sesión en un dispositivo sin datos locales, la app **descarga automáticamente** todo desde Firebase.

Por eso ahora solo ves la colección **`usuarios`** (con tu registro de admin): es la única que ya se ha escrito. Las demás **se crearán solas** con el uso normal:
- `participantes/`  (una doc por persona)
- `grupos/`  (una doc por grupo)
- `reuniones/`  (una doc por semana de entre semana)
- `programas/`  (una doc por mes, con fin de semana + salidas + acomodación + aseo)
- `asignaciones/`  (historial de asignaciones)
- `configuracion/general`  (un solo documento)
- `usuarios/`  (ya existía)

> **Resumen**: no tienes que crear nada en la consola ni pulsar ningún botón de migración. Con iniciar sesión como admin, los datos se sincronizan solos.

---

## 3. Configuración necesaria en la consola (una sola vez)

### 3.1 Authentication
- Consola → **Authentication → Sign-in method** → habilitar **Email/Password**.
- **Users** → crear los usuarios (el primero debe ser el admin).

### 3.2 Firestore
- **Firestore Database → Crear base de datos** (modo producción).
- En **Rules**, pegar el contenido de `firestore.rules` y publicar.

---

## 4. Roles de usuario

| Rol | Lectura | Escritura | Se define en |
|---|---|---|---|
| `admin` | Sí | Sí (crear/editar/eliminar) | `usuarios/{uid}.rol == 'admin'` |
| `reader` | Sí | No | `usuarios/{uid}.rol == 'reader'` |
| Sin sesión | No | No | — |

- El primer login de un usuario crea automáticamente su documento en `usuarios/{uid}` con rol **`reader`**.
- Para **promover al admin**: edita en consola el documento `usuarios/{uid}` del usuario y cambia `rol` a `admin`.
- La seguridad real está en `firestore.rules` (la interfaz solo oculta botones como mejora de UX).

---

## 5. Reglas de seguridad (firestore.rules)

Ya incluidas en el repo. Comportamiento:

- **No autenticado** → sin lectura ni escritura en ninguna colección.
- **reader** → solo lectura en participantes, grupos, reuniones, programas, asignaciones, configuracion.
- **admin** → lectura + creación + actualización + eliminación.
- **usuarios/{uid}** → cada usuario lee su propio doc; un usuario puede crearse su doc solo con rol `reader` (nunca admin); solo un admin modifica roles.

---

## 6. Despliegue de la PWA (opcional, cuando quieras publicarla)

Hay un `firebase.json` listo para publicar con Firebase Hosting:

```bash
# 1. Instalar Firebase CLI (una vez)
npm install -g firebase-tools

# 2. Iniciar sesión en Firebase (una vez)
firebase login

# 3. Conectar con el proyecto
firebase use reunion-b6f14

# 4. Publicar reglas + hosting
firebase deploy
```

También puedes publicar solo las reglas:
```bash
firebase deploy --only firestore:rules
```

El `firebase.json` ya ignora los PDFs y `servidor.ps1` del hosting.

> La app no requiere build: `index.html` + módulos JS se sirven tal cual.

---

## 7. Primer arranque tras el despliegue

1. Abre la app (servidor local `http://localhost:5556/` o la URL de hosting).
2. **Entrar** (botón en la barra superior) con el usuario admin.
3. Los datos se sincronizan solos: guarda algo (p. ej. crea un programa) y verás la colección en Firestore.
4. En otro dispositivo con la misma cuenta y base vacía: al iniciar sesión descargará automáticamente los datos.

> **Mantenimiento**: en **Ajustes → Mantenimiento de datos** puedes **"Restaurar valores de fábrica"** (borra todos los registros en Firebase y en el dispositivo, dejando las colecciones vacías y conservando tu cuenta de admin) o **"Borrar usuarios, reuniones y programas"** (conserva participantes, grupos y configuración). Ambas acciones requieren tu contraseña de admin.

---

## 8. Checklist de pruebas

### Datos (con admin)
- [ ] Crear persona (se sincroniza a Firestore)
- [ ] Editar persona / labores
- [ ] Desactivar persona
- [ ] Crear/editar grupo
- [ ] Cargar guía (PDF) de entre semana
- [ ] Crear programa del mes
- [ ] Modificar asignación a mano
- [ ] Asignación automática (asistente)
- [ ] Consultar historial de asignaciones

### Usuarios y permisos
- [ ] Login admin
- [ ] Login reader
- [ ] Acceso sin login (debe estar bloqueado en Firestore)
- [ ] Como reader: no ver botones administrativos
- [ ] Como reader: intento de escritura rechazado por las reglas

### Sincronización
- [ ] Guardar algo en un dispositivo → aparece en Firestore (colecciones se crean solas)
- [ ] Sin conexión: guardar algo → aparece "pendiente" en Ajustes
- [ ] Recuperar conexión → los pendientes se sincronizan automáticamente
- [ ] Segundo dispositivo con base vacía → descarga automática al loguearse

### Mantenimiento (requiere contraseña de admin)
- [ ] "Borrar usuarios, reuniones y programas" conserva participantes/grupos/config
- [ ] "Restaurar valores de fábrica" deja colecciones vacías y conserva el admin

### Algoritmo de asignación (Fase 9)
- [ ] Pocos participantes
- [ ] Muchos participantes
- [ ] Participante con varios roles
- [ ] Falta de candidatos (regla 7: avisa qué se flexibilizó)
- [ ] Repeticiones recientes (usa historial)

---

## 9. Solución de problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `400` al iniciar sesión | Email/Password no habilitado o credenciales incorrectas | Habilitar en Authentication; verificar el usuario |
| `ERR_BLOCKED_BY_CLIENT` en Firestore | Extensión/bloqueador corta el streaming | Desactivar el bloqueador para el sitio, o usar la app offline (IndexedDB) |
| La app no muestra "Entrar" | Firebase no configurado en `firebase-config.js` | Completar credenciales reales |
| Reader puede ver pero no escribir (UI) | Comportamiento esperado | La seguridad real la impone `firestore.rules` |
| `firebase` no es un comando | CLI no instalada | `npm install -g firebase-tools` |
