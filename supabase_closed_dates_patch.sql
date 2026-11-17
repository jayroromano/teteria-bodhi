-- ==============================================================================
-- TETERÍA BODHI · DÍAS CERRADOS (PARTIDOS, EVENTOS Y DESCANSO)
-- ==============================================================================
-- Instrucciones:
-- Ejecutar este script MANUALMENTE en el SQL Editor de Supabase
-- (https://supabase.com/dashboard/project/_/sql/new) DESPUÉS de desplegar el
-- código nuevo en Vercel. No contiene contraseñas ni claves privadas.
-- Es seguro ejecutarlo una sola vez; si se repite, no borra datos.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABLA DE DÍAS CERRADOS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.closed_dates (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 2. SEGURIDAD: RLS ACTIVADO Y SIN ACCESO PÚBLICO
-- ------------------------------------------------------------------------------
ALTER TABLE public.closed_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.closed_dates FORCE ROW LEVEL SECURITY;

-- El público (anon) y los usuarios autenticados NO pueden leer ni escribir
-- directamente esta tabla. Solo el backend con service_role puede hacerlo.
REVOKE ALL ON public.closed_dates FROM PUBLIC, anon, authenticated;

-- Política explícita para el backend (service_role), igual que en rate_limits.
DROP POLICY IF EXISTS "service_role_closed_dates_policy" ON public.closed_dates;
CREATE POLICY "service_role_closed_dates_policy"
    ON public.closed_dates
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Permisos mínimos para que el backend pueda insertar y borrar filas.
GRANT SELECT, INSERT, DELETE ON public.closed_dates TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.closed_dates_id_seq TO service_role;

-- ------------------------------------------------------------------------------
-- 3. COMPROBACIÓN RÁPIDA (opcional)
-- ------------------------------------------------------------------------------
-- SELECT * FROM public.closed_dates ORDER BY date;
