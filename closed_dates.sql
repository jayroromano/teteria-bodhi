-- Ejecutar una sola vez en Supabase > SQL Editor después de desplegar la función.
-- Las reservas solo podrán consultar o modificar esta tabla desde el servidor
-- con la credencial service_role; los clientes anon/authenticated no tendrán acceso.

CREATE TABLE IF NOT EXISTS public.closed_dates (
  date DATE PRIMARY KEY,
  reason VARCHAR(160) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.closed_dates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.closed_dates FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.closed_dates TO service_role;

DROP POLICY IF EXISTS "service_role_closed_dates_all" ON public.closed_dates;
CREATE POLICY "service_role_closed_dates_all"
  ON public.closed_dates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
