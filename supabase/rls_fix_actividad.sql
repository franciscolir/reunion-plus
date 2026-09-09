-- Fix RLS para actividad_g1..g7
-- Asegura lectura con email_autorizado y escritura para user o admin
DO $$
DECLARE g int;
BEGIN
  FOR g IN 1..7 LOOP
    EXECUTE format('DROP POLICY IF EXISTS "lectura_autorizados" ON public.actividad_g%s;', g);
    EXECUTE format('CREATE POLICY "lectura_autorizados" ON public.actividad_g%s FOR SELECT TO authenticated USING (internal.email_autorizado());', g);
    EXECUTE format('DROP POLICY IF EXISTS "escritura_admin" ON public.actividad_g%s;', g);
    EXECUTE format('CREATE POLICY "escritura_admin" ON public.actividad_g%s FOR ALL TO authenticated USING (internal.is_admin()) WITH CHECK (internal.is_admin());', g);
    EXECUTE format('DROP POLICY IF EXISTS "escritura_user_actividad" ON public.actividad_g%s;', g);
    EXECUTE format('CREATE POLICY "escritura_user_actividad" ON public.actividad_g%s FOR INSERT TO authenticated WITH CHECK (internal.has_role(''user'') OR internal.is_admin());', g);
    EXECUTE format('CREATE POLICY "actualizar_user_actividad" ON public.actividad_g%s FOR UPDATE TO authenticated USING (internal.has_role(''user'') OR internal.is_admin()) WITH CHECK (internal.has_role(''user'') OR internal.is_admin());', g);
  END LOOP;
END $$;
