-- Seed del usuario con rol "ia" para el webhook de Zapia/IA.
--
-- PASO 1 (recomendado): crea el usuario en el Dashboard de Supabase
--   (Authentication > Add user) con el correo y contraseña que usarás como
--   ZAPIA_EMAIL / ZAPIA_PASSWORD.
-- PASO 2: edita <ZAPIA_EMAIL> abajo y ejecuta este script en el SQL Editor.
--   Asigna (o crea) el documento de usuarios con rol "ia".
--
-- El webhook (webhook-zapia) inicia sesion con ZAPIA_EMAIL/ZAPIA_PASSWORD y
-- exige que el doc de usuarios tenga rol = 'ia'.

insert into usuarios (id, data)
select
  id,
  jsonb_build_object(
    'email', email,
    'rol', 'ia',
    'createdAt', extract(epoch from now())::bigint
  )
from auth.users
where email = '<ZAPIA_EMAIL>'
on conflict (id) do update
  set data = jsonb_set(usuarios.data, '{rol}', '"ia"', true);

-- Verifica:
-- select id, data->>'rol' as rol, data->>'email' as email
-- from usuarios where data->>'rol' = 'ia';
