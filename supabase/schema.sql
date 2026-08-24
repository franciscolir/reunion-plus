-- =============================================================
-- Reunión+ → Supabase: esquema y políticas RLS
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase.
-- Orden: primero las tablas, luego las funciones y las políticas.
-- =============================================================

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

-- ===== Funciones auxiliares =====

-- Rol: es admin quien tiene un registro en usuarios con data->>'rol' = 'admin'.
-- SECURITY DEFINER para evitar recursión de RLS al consultar usuarios.
create or replace function public.is_admin()
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

-- Whitelist: ¿el correo del usuario está autorizado a leer los datos?
-- Lee la whitelist de la app (configuracion/general → config.emailsPermitidos).
-- SECURITY DEFINER para leer configuracion aunque su RLS esté restringida.
create or replace function public.email_autorizado()
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
  if public.is_admin() then
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
create or replace function public.def_policies(tabla text) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  execute format('alter table public.%I enable row level security;', tabla);
  execute format('drop policy if exists "lectura_autorizados" on public.%I;', tabla);
  execute format('create policy "lectura_autorizados" on public.%I for select to authenticated using (public.email_autorizado());', tabla);
  execute format('drop policy if exists "escritura_admin" on public.%I;', tabla);
  execute format('create policy "escritura_admin" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin());', tabla);
end;
$$;

-- def_policies solo se usa durante la instalación del esquema (lo ejecuta el
-- rol postgres en el SQL Editor). No debe ser invocable vía RPC por anon/authenticated.
-- Postgres otorga EXECUTE a PUBLIC por defecto; anon hereda de PUBLIC, así que
-- hay que revocar de PUBLIC explícitamente (postgres, dueño, conserva EXECUTE).
revoke execute on function public.def_policies(text) from public, anon, authenticated;

-- ===== Políticas de datos =====
select public.def_policies('participantes');
select public.def_policies('grupos');
select public.def_policies('reuniones');
select public.def_policies('programas');
select public.def_policies('asignaciones');
select public.def_policies('discursos');
select public.def_policies('configuracion');
select public.def_policies('actividad');
select public.def_policies('asistencia');
select public.def_policies('arreglos');

-- ===== Políticas de usuarios =====
alter table public.usuarios enable row level security;

drop policy if exists "usuarios_lectura" on public.usuarios;
create policy "usuarios_lectura" on public.usuarios
  for select to authenticated
  using (auth.uid()::text = id or public.is_admin());

drop policy if exists "usuarios_crear_propio" on public.usuarios;
create policy "usuarios_crear_propio" on public.usuarios
  for insert to authenticated
  with check (auth.uid()::text = id and coalesce((data->>'rol'), 'reader') in ('reader', 'user', 'ia'));

drop policy if exists "usuarios_escritura_admin" on public.usuarios;
create policy "usuarios_escritura_admin" on public.usuarios
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "usuarios_borrado_admin" on public.usuarios;
create policy "usuarios_borrado_admin" on public.usuarios
  for delete to authenticated
  using (public.is_admin());

-- ===== Grants (los roles anon/authenticated pueden usar las tablas; RLS decide) =====
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.participantes, public.grupos, public.reuniones,
  public.programas, public.asignaciones, public.discursos, public.configuracion, public.actividad,
  public.asistencia, public.arreglos, public.usuarios
  to authenticated;
grant select, insert, update, delete on public.usuarios to authenticated;

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
