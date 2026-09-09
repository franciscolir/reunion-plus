-- Repara relación participantes ↔ grupos
-- Mapeo: antiguo id de grupo → nuevo id de grupo
-- 8→2, 9→3, 10→4, 11→5, 12→6, 13→7
-- Ajusta la ruta JSON según tu esquema: data->>'grupoId' y data.grupoId

UPDATE participantes
SET data = jsonb_set(data, '{grupoId}', to_jsonb('2'::text)),
    updated_at = now()
WHERE data->>'grupoId' = '8';

UPDATE participantes
SET data = jsonb_set(data, '{grupoId}', to_jsonb('3'::text)),
    updated_at = now()
WHERE data->>'grupoId' = '9';

UPDATE participantes
SET data = jsonb_set(data, '{grupoId}', to_jsonb('4'::text)),
    updated_at = now()
WHERE data->>'grupoId' = '10';

UPDATE participantes
SET data = jsonb_set(data, '{grupoId}', to_jsonb('5'::text)),
    updated_at = now()
WHERE data->>'grupoId' = '11';

UPDATE participantes
SET data = jsonb_set(data, '{grupoId}', to_jsonb('6'::text)),
    updated_at = now()
WHERE data->>'grupoId' = '12';

UPDATE participantes
SET data = jsonb_set(data, '{grupoId}', to_jsonb('7'::text)),
    updated_at = now()
WHERE data->>'grupoId' = '13';

-- Verificación
SELECT id, data->>'grupoId' AS grupoId, data->>'nombre' AS nombre
FROM participantes
WHERE data->>'grupoId' IN ('2','3','4','5','6','7');
