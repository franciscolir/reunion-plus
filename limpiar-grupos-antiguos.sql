-- 1. Corregir participantes con grupoId antiguo → nuevo id correcto
UPDATE participantes SET data = jsonb_set(data, '{grupoId}', to_jsonb('2'::text)), updated_at = now() WHERE data->>'grupoId' = '8';
UPDATE participantes SET data = jsonb_set(data, '{grupoId}', to_jsonb('3'::text)), updated_at = now() WHERE data->>'grupoId' = '9';
UPDATE participantes SET data = jsonb_set(data, '{grupoId}', to_jsonb('4'::text)), updated_at = now() WHERE data->>'grupoId' = '10';
UPDATE participantes SET data = jsonb_set(data, '{grupoId}', to_jsonb('5'::text)), updated_at = now() WHERE data->>'grupoId' = '11';
UPDATE participantes SET data = jsonb_set(data, '{grupoId}', to_jsonb('6'::text)), updated_at = now() WHERE data->>'grupoId' = '12';
UPDATE participantes SET data = jsonb_set(data, '{grupoId}', to_jsonb('7'::text)), updated_at = now() WHERE data->>'grupoId' = '13';

-- 2. Eliminar grupos duplicados con ids antiguos
DELETE FROM grupos WHERE id::text IN ('8','9','10','11','12','13');

-- 3. Eliminar tablas de actividad_g8..g13 (vacías o huérfanas)
DELETE FROM actividad_g8;
DELETE FROM actividad_g9;
DELETE FROM actividad_g10;
DELETE FROM actividad_g11;
DELETE FROM actividad_g12;
DELETE FROM actividad_g13;

-- 4. Verificar limpieza: participantes deben tener solo grupoId 1..7
SELECT data->>'grupoId' AS grupoId, COUNT(*) AS total
FROM participantes
GROUP BY data->>'grupoId'
ORDER BY data->>'grupoId';

-- 5. Verificar que no queden grupos duplicados
SELECT id, data->>'nombre' AS nombre FROM grupos ORDER BY id::int;
