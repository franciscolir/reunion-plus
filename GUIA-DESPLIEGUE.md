# Reunión+ — Guía de despliegue y configuración (Supabase + GitHub Pages)

Esta guía explica cómo desplegar la app en **GitHub Pages** y configurar **Supabase** (Postgres + Auth + RLS) para que los datos se sincronicen entre dispositivos (autenticación + roles + seguridad).

> La app funciona 100% offline con IndexedDB; Supabase es el espejo en la nube.
> Repo: `franciscolir/reunion-plus` (público, rama `main`). Sitio: https://franciscolir.github.io/reunion-plus/

## 1. Arquitectura

- **IndexedDB** es la fuente local (offline). `db.js` escribe en los stores y `sync.js` hace pull/push con una cola de cambios offline.
- **Supabase** es la nube: tablas Postgres con un documento JSON (`data`) por registro, autenticación (email/contraseña o Google) y seguridad por **RLS** (políticas por fila).
- **GitHub Pages** publica el sitio con un workflow de GitHub Actions; en cada build se genera `supabase-config.js` desde los secretos del repo.

## 2. Crear el proyecto Supabase

1. Entra en https://supabase.com y **Sign in with GitHub**.
2. **New project**: nombre (p. ej. `reunion-plus`), contraseña de la base de datos (guardarla), región cercana, plan **Free**.
3. Opciones de seguridad del proyecto:
   - **Enable Data API**: activado (la app usa `supabase-js`).
   - **Automatically expose new tables**: desactivado (los permisos se conceden manualmente en el schema).
   - **Enable automatic RLS**: activado (red de seguridad para tablas futuras).

## 3. Esquema y políticas (RLS)

En **SQL Editor → New query**, ejecuta el contenido de `supabase/schema.sql` (tablas primero, luego funciones y políticas):

- Tablas: `participantes`, `grupos`, `reuniones`, `programas`, `asignaciones`, `discursos`, `configuracion`, `usuarios`.
- RLS:
  - Lectura: solo usuarios autenticados **y** cuyo correo esté en la whitelist (`configuracion` → `config.emailsPermitidos`) o sean admin (`usuarios` → `rol = 'admin'`).
  - Escritura: solo `admin`.
  - `usuarios`: cada usuario solo puede crear su propia fila como `reader`.

## 4. Autenticación

1. **Authentication → Sign In / Providers → Email**: desactivar **Allow new users to sign up** (los usuarios los creas tú).
2. **Authentication → Users → Add user**: crea el usuario admin con su correo y contraseña; copia su **UUID** (columna *ID*).
3. **Bootstrap del admin** (SQL Editor), sustituyendo `<UID>` y `<EMAIL>`:

```sql
insert into public.usuarios (id, data)
values ('<UID>', jsonb_build_object('email', '<EMAIL>', 'rol', 'admin'))
on conflict (id) do update
  set data = jsonb_build_object('email', '<EMAIL>', 'rol', 'admin');

insert into public.configuracion (id, data)
values ('general', jsonb_build_object('config', jsonb_build_object('emailsPermitidos', jsonb_build_array('<EMAIL>'))))
on conflict (id) do update
  set data = jsonb_build_object('config', jsonb_build_object('emailsPermitidos', jsonb_build_array('<EMAIL>')));
```

Esto promueve al admin y añade su correo a la whitelist (sin esto RLS no deja leer nada). Los correos de más usuarios se añaden desde la app (Ajustes → Acceso de usuarios).

## 5. Credenciales

En **Settings → API** copia la **Project URL** y la **Publishable key** (antes *anon public*). Añádelas como **secretos** del repo en GitHub (**Settings → Secrets and variables → Actions**):

- `SUPABASE_URL` = Project URL
- `SUPABASE_ANON_KEY` = Publishable key

> La publishable/anon key es pública por diseño; la seguridad real la da RLS. La clave `service_role` (bypasea RLS) no se usa en el cliente ni debe publicarse.

## 6. GitHub Pages

1. El repo debe ser **público** (Pages del plan Free).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. En cada push a `main`, el workflow `.github/workflows/pages.yml`:
   - Genera `supabase-config.js` desde los secretos.
   - Publica el sitio en https://franciscolir.github.io/reunion-plus/

Para desplegar una versión nueva:

```bash
git add . && git commit -m "feat(...): descripción" && git push origin main
```

## 7. Pruebas y verificación

- Unitarias: `node tests.mjs`
- Integración: `node tests-integration.mjs`
- E2E (Playwright, offline con Supabase mockeado): `npm run test:e2e`
- Todas: `npm run test:all`

Checklist de humo en el sitio desplegado:

- [ ] Abrir la app sin sesión muestra la pantalla de bienvenida (bloqueada).
- [ ] Entrar con el correo admin → se carga la app.
- [ ] Crear/guardar algo → aparece en la tabla correspondiente de Supabase (Table Editor).
- [ ] Un `reader` puede ver pero no escribir.

## Solución de problemas

| Problema | Causa | Solución |
|---|---|---|
| "Tu correo no está autorizado" | Falta el bootstrap (admin/whitelist) o el correo no está en `emailsPermitidos` | Ejecutar el bloque de bootstrap; añadir el correo en Ajustes |
| "Cannot read properties... signInWithPassword" / `sb.from` | Caché vieja del Service Worker o versión antigua del SDK | Recargar (Ctrl+F5) / desregistrar el SW; el workflow fija `supabase-js@2.45.6` |
| 401 en las peticiones a `/rest/v1/` | Sesión no iniciada o RLS deniega | Iniciar sesión; revisar whitelist y políticas |
| El sitio no se actualiza tras un push | Workflow falló o Pages no en Actions | Revisar Actions → Deploy a GitHub Pages; Source = GitHub Actions |
