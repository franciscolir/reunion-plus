-- =============================================================
-- Reunión+ → Supabase: esquema y políticas RLS
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase.
-- Orden: primero las tablas, luego las funciones y las políticas.
-- =============================================================

-- Esquema auxiliar no expuesto por la API (PostgREST solo expone public/
-- graphql_public). Aquí vive def_policies, que solo se usa en la instalación.
create schema if not exists internal;

-- Modelo de documento: cada tabla tiene id (text PK) + data (jsonb).
-- El documento completo de la app vive en `data`; updated_at para ordenar.

-- ===== Tablas de datos =====
create table if not exists public.participantes (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.grupos (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.reuniones (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.programas (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.asignaciones (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.discursos (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.configuracion (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.actividad (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.asistencia (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.arreglos (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Nuevas tablas para el modelo de datos v2
create table if not exists public.cargos (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.capacidades (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.speaker_talks (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.audit_log (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.actividad_revision (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Tabla de usuarios (rol admin/reader/user/ia). El usuario crea SU fila con rol reader
-- en el primer login; solo un admin puede cambiar/borrar roles.
create table if not exists public.usuarios (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ===== Índices útiles para el historial =====
create index if not exists idx_asignaciones_participante on public.asignaciones ((data->>'participanteId'));
create index if not exists idx_asignaciones_programa on public.asignaciones ((data->>'programaId'));
create index if not exists idx_programas_mes on public.programas ((data->>'mes'));
create index if not exists idx_cargos_nombre on public.cargos ((data->>'name'));
create index if not exists idx_capacidades_cargo on public.capacidades ((data->>'cargoId'));

create index if not exists idx_speaker_talks_persona on public.speaker_talks ((data->>'personId'));
create index if not exists idx_speaker_talks_talk on public.speaker_talks ((data->>'talkNum'));
create index if not exists idx_audit_log_entity on public.audit_log ((data->>'entity'));
create index if not exists idx_audit_log_entityId on public.audit_log ((data->>'entityId'));

-- ===== Funciones auxiliares =====

-- Rol: es admin quien tiene un registro en usuarios con data->>'rol' = 'admin'.
-- SECURITY DEFINER para evitar recursión de RLS al consultar usuarios.
create or replace function internal.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.usuarios u
    where u.id = (auth.uid())::text
      and (u.data->>'rol') = 'admin'
  );
$$;

-- Rol arbitrario (admin, user, reader, ia).
-- Uso: escritura de actividad permitida para user; pendientes futuros desarrollo.
create or replace function internal.has_role(rol text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.usuarios u
    where u.id = (auth.uid())::text
      and (u.data->>'rol') = rol
  );
$$;

-- Whitelist: ¿el correo del usuario está autorizado a leer los datos?
-- Lee la whitelist de la app (configuracion/general → config.emailsPermitidos).
-- SECURITY DEFINER para leer configuracion aunque su RLS esté restringida.
create or replace function internal.email_autorizado()
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_email text := lower(coalesce((auth.jwt() ->> 'email'), ''));
  v_cfg jsonb;
begin
  if v_email = '' then
    return false;
  end if;
  if internal.is_admin() then
    return true;
  end if;
  if exists (
    select 1 from public.usuarios u
    where u.id = (auth.uid())::text
      and (u.data->>'rol') in ('user', 'ia')
  ) then
    return true;
  end if;
  select data into v_cfg from public.configuracion where id = 'general';
  return exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_cfg -> 'config' -> 'emailsPermitidos', '[]'::jsonb)) e
    where lower(trim(e)) = v_email
  );
end;
$$;

-- Helper: políticas genéricas
--   Lectura: solo usuarios autenticados Y con correo en la whitelist.
--   Escritura: solo admin.
create or replace function internal.def_policies(tabla text) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  execute format('alter table public.%I enable row level security;', tabla);
  execute format('drop policy if exists "lectura_autorizados" on public.%I;', tabla);
  execute format('create policy "lectura_autorizados" on public.%I for select to authenticated using (internal.email_autorizado());', tabla);
  execute format('drop policy if exists "escritura_admin" on public.%I;', tabla);
  execute format('create policy "escritura_admin" on public.%I for all to authenticated using (internal.is_admin()) with check (internal.is_admin());', tabla);
end;
$$;

-- def_policies vive en el esquema internal (no expuesto por la API), así que
-- no aparece en /rest/v1/rpc/. Por seguridad, se revoca EXECUTE a
-- anon/authenticated (postgres, dueño, conserva EXECUTE para la instalación).
revoke execute on function internal.def_policies(text) from public, anon, authenticated;

-- ===== Políticas de datos =====
select internal.def_policies('participantes');
select internal.def_policies('grupos');
select internal.def_policies('reuniones');
select internal.def_policies('programas');
select internal.def_policies('asignaciones');
select internal.def_policies('discursos');
select internal.def_policies('configuracion');
select internal.def_policies('actividad');
-- Actividad: lectura para autorizados, escritura para admin + user.
-- (def_policies YA creó las políticas genéricas; aquí las refinamos para que
-- el rol user también pueda escribir en actividad, p. ej. ingresar el informe
-- de su grupo.) Al ser la misma tabla, recreamos las políticas con el nuevo
-- criterio — las anteriores son solo placeholders que PostgreSQL sustituye.
drop policy if exists "escritura_admin" on public.actividad;
drop policy if exists "lectura_autorizados" on public.actividad;
create policy "lectura_autorizados" on public.actividad
  for select to authenticated using (internal.email_autorizado());
create policy "escritura_admin" on public.actividad
  for all to authenticated
  using (internal.is_admin())
  with check (internal.is_admin());
drop policy if exists "escritura_user_actividad" on public.actividad;
create policy "escritura_user_actividad" on public.actividad
  for all to authenticated
  using (internal.has_role('user')) with check (internal.has_role('user'));

-- actividad_revision: el user puede escribir (guardar su informe pendiente).
-- El admin confirma moviendo esa fila a actividad. La lectura es para todos
-- (RLS ya la garantiza).
select internal.def_policies('actividad_revision');
-- Políticas de usuario para el escribir/copiar actividad pendiente (del user).
-- Queda la lectura genérica y escritura solo para user de actividad_revision.
drop policy if exists "escritura_user_revision" on public.actividad_revision;
create policy "escritura_user_revision" on public.actividad_revision
  for all to authenticated
  using (internal.has_role('user')) with check (internal.has_role('user'));
select internal.def_policies('asistencia');
select internal.def_policies('arreglos');
select internal.def_policies('cargos');
select internal.def_policies('capacidades');

select internal.def_policies('speaker_talks');
select internal.def_policies('audit_log');

-- ===== Hardening de funciones =====
-- is_admin / email_autorizado se movieron al esquema internal (no expuesto por
-- la API de PostgREST), así que no aparecen en /rest/v1/rpc/ y el linter no las
-- señala. Se mantiene EXECUTE para anon/authenticated porque la evaluación de
-- RLS (que las invoca) corre con el rol que consulta y necesita EXECUTE.
-- Concedemos USAGE sobre internal para que la RLS pueda resolver el esquema.
grant usage on schema internal to anon, authenticated;

-- rls_auto_enable está amarrada a un event trigger (ensure_rls) que auto-habilita
-- RLS, por lo que NO se borra. Solo se revoca EXECUTE para que no sea invocable
-- vía /rest/v1/rpc/. El event trigger corre como superusuario y conserva el
-- privilegio, así que sigue funcionando.
do $$
declare r record;
begin
  for r in
    select format('revoke execute on function %I.%I(%s) from public, anon, authenticated', n.nspname, p.proname, pg_get_function_arguments(p.oid)) as ddl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  loop execute r.ddl; end loop;
end $$;

-- ===== Políticas de usuarios =====
alter table public.usuarios enable row level security;

drop policy if exists "usuarios_lectura" on public.usuarios;
create policy "usuarios_lectura" on public.usuarios
  for select to authenticated
  using (auth.uid()::text = id or internal.is_admin());

drop policy if exists "usuarios_crear_propio" on public.usuarios;
create policy "usuarios_crear_propio" on public.usuarios
  for insert to authenticated
  with check (auth.uid()::text = id and coalesce((data->>'rol'), 'reader') in ('reader', 'user', 'ia'));

drop policy if exists "usuarios_escritura_admin" on public.usuarios;
create policy "usuarios_escritura_admin" on public.usuarios
  for update to authenticated
  using (internal.is_admin()) with check (internal.is_admin());

drop policy if exists "usuarios_borrado_admin" on public.usuarios;
create policy "usuarios_borrado_admin" on public.usuarios
  for delete to authenticated
  using (internal.is_admin());

-- ===== Grants (los roles anon/authenticated pueden usar las tablas; RLS decide) =====
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.participantes, public.grupos, public.reuniones,
  public.programas, public.asignaciones, public.discursos, public.configuracion, public.actividad,
  public.asistencia, public.arreglos, public.cargos, public.capacidades, public.speaker_talks,
  public.actividad_revision, public.audit_log, public.usuarios
  to authenticated;
grant select, insert, update, delete on public.usuarios to authenticated;

-- service_role (usado por Edge Functions) necesita grants explícitos para
-- bypass RLS y acceder a las tablas.
grant select, insert, update, delete on public.participantes, public.grupos, public.reuniones,
  public.programas, public.asignaciones, public.discursos, public.configuracion, public.actividad,
  public.asistencia, public.arreglos, public.cargos, public.capacidades, public.speaker_talks,
  public.actividad_revision, public.audit_log, public.usuarios
  to service_role;

-- Elimina las versiones públicas obsoletas de is_admin / email_autorizado (de
-- cuando vivían en public). Las políticas ahora usan internal.*, así que estas
-- ya no se referencian y solo quedaban expuestas en /rest/v1/rpc/.
drop function if exists public.email_autorizado() cascade;
drop function if exists public.is_admin() cascade;

-- =============================================================
-- BOOTSTRAP DEL PRIMER ADMIN
-- Después de crear el usuario en Auth (Authentication → Users → Add user):
--   1. Copia su UUID (columna ID de la lista de usuarios).
--   2. Sustituye <UID> y <EMAIL> en el bloque siguiente y ejecútalo.
-- Esto lo promueve a admin y añade su correo a la whitelist (sin esto RLS
-- no deja leer nada a nadie).
-- =============================================================
-- insert into public.usuarios (id, data)
-- values ('<UID>', jsonb_build_object('email', '<EMAIL>', 'rol', 'admin'))
-- on conflict (id) do update
--   set data = jsonb_build_object('email', '<EMAIL>', 'rol', 'admin');
-- Para crear un usuario de consulta restringida, el admin puede usar:
-- update public.usuarios
-- set data = jsonb_set(data, '{rol}', '"user"'::jsonb)
-- where id = '<UID>';
-- Para crear un usuario de imagen semanal, usa rol "ia".
--
-- insert into public.configuracion (id, data)
-- values ('general', jsonb_build_object('config', jsonb_build_object('emailsPermitidos', jsonb_build_array('<EMAIL>'))))
-- on conflict (id) do update
--   set data = jsonb_build_object('config', jsonb_build_object('emailsPermitidos', jsonb_build_array('<EMAIL>')));
