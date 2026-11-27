-- Ejecutar una sola vez en Supabase > SQL Editor después de desplegar la función.
-- Las vísperas de festivo solo podrán consultarse o modificarse desde el servidor
-- con la credencial service_role; los clientes anon/authenticated no tendrán acceso.

CREATE TABLE IF NOT EXISTS public.holiday_eves (
  date DATE PRIMARY KEY,
  label VARCHAR(160) NOT NULL DEFAULT 'Víspera de festivo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.holiday_eves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holiday_eves FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.holiday_eves FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.holiday_eves TO service_role;

DROP POLICY IF EXISTS "service_role_holiday_eves_all" ON public.holiday_eves;
CREATE POLICY "service_role_holiday_eves_all"
  ON public.holiday_eves
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
