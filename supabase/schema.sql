-- =============================================================
-- Reunión+ → Supabase: esquema y políticas RLS
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase.
-- =============================================================

-- Modelo de documento: cada tabla tiene id (text PK) + data (jsonb).
-- El documento completo de la app vive en `data`; updated_at para ordenar.

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

-- Helper: políticas genéricas
create or replace function public.def_policies(tabla text) returns void
language plpgsql security definer as $$
begin
  execute format('alter table public.%I enable row level security;', tabla);
  execute format('drop policy if exists "lectura_autenticados" on public.%I;', tabla);
  execute format('create policy "lectura_autenticados" on public.%I for select to authenticated using (true);', tabla);
  execute format('drop policy if exists "escritura_admin" on public.%I;', tabla);
  execute format('create policy "escritura_admin" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin());', tabla);
end;
$$;

-- Tablas de datos
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

-- Tabla de usuarios (rol admin/reader). El usuario crea SU fila con rol reader
-- en el primer login; solo un admin puede cambiar/borrar roles.
create table if not exists public.usuarios (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Índices útiles para el historial
create index if not exists idx_asignaciones_participante on public.asignaciones ((data->>'participanteId'));
create index if not exists idx_asignaciones_programa on public.asignaciones ((data->>'programaId'));
create index if not exists idx_programas_mes on public.programas ((data->>'mes'));

-- Políticas de datos: cualquier autenticado lee; solo admin escribe.
select public.def_policies('participantes');
select public.def_policies('grupos');
select public.def_policies('reuniones');
select public.def_policies('programas');
select public.def_policies('asignaciones');
select public.def_policies('discursos');
select public.def_policies('configuracion');

-- Políticas de usuarios
alter table public.usuarios enable row level security;

drop policy if exists "usuarios_lectura" on public.usuarios;
create policy "usuarios_lectura" on public.usuarios
  for select to authenticated
  using (auth.uid()::text = id or public.is_admin());

drop policy if exists "usuarios_crear_propio" on public.usuarios;
create policy "usuarios_crear_propio" on public.usuarios
  for insert to authenticated
  with check (auth.uid()::text = id and coalesce((data->>'rol'), 'reader') = 'reader');

drop policy if exists "usuarios_escritura_admin" on public.usuarios;
create policy "usuarios_escritura_admin" on public.usuarios
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "usuarios_borrado_admin" on public.usuarios;
create policy "usuarios_borrado_admin" on public.usuarios
  for delete to authenticated
  using (public.is_admin());

-- Grants (los roles anon/authenticated pueden usar las tablas; RLS decide)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.participantes, public.grupos, public.reuniones,
  public.programas, public.asignaciones, public.discursos, public.configuracion, public.usuarios
  to authenticated;
grant select, insert, update, delete on public.usuarios to authenticated;
