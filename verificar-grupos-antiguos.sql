-- Buscar participantes que aún apuntan a ids antiguos de grupo (8-13)
SELECT id, data->>'nombre' AS nombre, data->>'grupoId' AS grupoId
FROM participantes
WHERE data->>'grupoId' IN ('8','9','10','11','12','13');

-- Contar por grupoId para ver distribution completa
SELECT data->>'grupoId' AS grupoId, COUNT(*) AS total
FROM participantes
GROUP BY data->>'grupoId'
ORDER BY data->>'grupoId';

-- Verificar si existen tablas de actividad_g8..g13 con datos
SELECT 'actividad_g8' AS tabla, COUNT(*) AS registros FROM actividad_g8
UNION ALL SELECT 'actividad_g9', COUNT(*) FROM actividad_g9
UNION ALL SELECT 'actividad_g10', COUNT(*) FROM actividad_g10
UNION ALL SELECT 'actividad_g11', COUNT(*) FROM actividad_g11
UNION ALL SELECT 'actividad_g12', COUNT(*) FROM actividad_g12
UNION ALL SELECT 'actividad_g13', COUNT(*) FROM actividad_g13;

-- Buscar en asignaciones si alguna apunta a participant con grupoId antiguo
SELECT a.id, a.data->>'participanteId' AS participanteId, a.data->>'fecha' AS fecha
FROM asignaciones a
WHERE a.data->>'participanteId' IN (
  SELECT id FROM participantes WHERE data->>'grupoId' IN ('8','9','10','11','12','13')
);

-- Buscar en configuración si hay referencia a grupoId antiguo
SELECT * FROM configuracion WHERE data::text LIKE '%grupoId%8%'
   OR data::text LIKE '%grupoId%9%'
   OR data::text LIKE '%grupoId%10%'
   OR data::text LIKE '%grupoId%11%'
   OR data::text LIKE '%grupoId%12%'
   OR data::text LIKE '%grupoId%13%';
