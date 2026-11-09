-- ==============================================================================
-- TETERÍA BODHI · PARCHE INTEGRAL DE SEGURIDAD Y PRIVACIDAD (SUPABASE POSTGRESQL)
-- ==============================================================================
-- Instrucciones:
-- Este script debe ser revisado y ejecutado manualmente por el propietario en el
-- SQL Editor de Supabase (https://supabase.com/dashboard/project/_/sql/new).
-- No contiene contraseñas ni claves privadas.
-- NO ejecutar automáticamente.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. LIMPIEZA EXHAUSTIVA DE TODAS LAS POLÍTICAS ANTERIORES
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname, tablename
        FROM pg_policies
        WHERE schemaname = 'public' 
          AND tablename IN ('reservations', 'menu_items', 'rate_limits')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 2. TABLA DE RATE LIMITING DISTRIBUIDO SERVERLESS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 1,
    reset_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits FORCE ROW LEVEL SECURITY;

CREATE POLICY "service_role_rate_limits_policy"
    ON public.rate_limits
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Revocación expresa de permisos directos sobre la tabla
REVOKE ALL ON public.rate_limits FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. FUNCIÓN ATÓMICA DE RATE LIMITING (SEARCH_PATH PROTEGIDO & LIMPIEZA PERIÓDICA)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_rate_limit(
    p_key TEXT,
    p_max_requests INTEGER,
    p_window_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_count INTEGER;
BEGIN
    -- 1. Validación estricta de parámetros de entrada
    IF p_key IS NULL OR pg_catalog.length(pg_catalog.btrim(p_key)) = 0 OR pg_catalog.length(p_key) > 255 THEN
        RAISE EXCEPTION 'Parámetro p_key inválido: debe ser una cadena no vacía de máx. 255 caracteres';
    END IF;

    IF p_max_requests IS NULL OR p_max_requests <= 0 OR p_max_requests > 10000 THEN
        RAISE EXCEPTION 'Parámetro p_max_requests inválido: debe estar entre 1 y 10000';
    END IF;

    IF p_window_seconds IS NULL OR p_window_seconds <= 0 OR p_window_seconds > 86400 THEN
        RAISE EXCEPTION 'Parámetro p_window_seconds inválido: debe estar entre 1 y 86400 segundos';
    END IF;

    -- 2. Mantenimiento y limpieza periódica probabilística de registros caducados
    -- Se ejecuta aproximadamente en un 2% de las llamadas (1 de cada 50)
    -- Evita limpiezas globales continuas que degraden la concurrencia
    IF (pg_catalog.random() < 0.02) THEN
        DELETE FROM public.rate_limits
        WHERE reset_at < v_now - INTERVAL '1 hour';
    END IF;

    -- 3. Incremento o reinicio atómico con serialización de fila en conflicto
    INSERT INTO public.rate_limits (key, count, reset_at)
    VALUES (p_key, 1, v_now + (p_window_seconds || ' seconds')::INTERVAL)
    ON CONFLICT (key) DO UPDATE
    SET count = CASE
            WHEN public.rate_limits.reset_at < v_now THEN 1
            ELSE public.rate_limits.count + 1
        END,
        reset_at = CASE
            WHEN public.rate_limits.reset_at < v_now THEN v_now + (p_window_seconds || ' seconds')::INTERVAL
            ELSE public.rate_limits.reset_at
        END
    RETURNING count INTO v_count;

    RETURN (v_count <= p_max_requests);
END;
$$;

-- Restricción estricta de ejecución: solo service_role
REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

-- ------------------------------------------------------------------------------
-- 4. TABLA DE RESERVAS (PROTECCIÓN TOTAL RGPD)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reservations (
    id SERIAL PRIMARY KEY,
    code VARCHAR(30) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(150),
    date VARCHAR(20) NOT NULL,
    time VARCHAR(20) NOT NULL,
    guests INT NOT NULL DEFAULT 2,
    zone VARCHAR(50) DEFAULT 'indiferente',
    notes TEXT,
    status VARCHAR(30) DEFAULT 'pending',
    admin_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reservations_date ON public.reservations(date);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON public.reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_code ON public.reservations(code);

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations FORCE ROW LEVEL SECURITY;

-- Flujo de seguridad estricto: Todo acceso a reservations se canaliza a través de
-- las funciones serverless de Vercel con la credencial privilegiada service_role.
-- Ningún usuario público/anon ni authenticated puede insertar ni leer directamente.
CREATE POLICY "service_role_reservations_all"
    ON public.reservations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

REVOKE ALL ON public.reservations FROM anon;
REVOKE ALL ON public.reservations FROM authenticated;

-- Permisos sobre la secuencia autoincremental de la clave primaria
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'reservations_id_seq') THEN
        GRANT USAGE, SELECT ON SEQUENCE public.reservations_id_seq TO service_role;
        REVOKE ALL ON SEQUENCE public.reservations_id_seq FROM PUBLIC, anon, authenticated;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 5. TABLA DE CARTA DIGITAL (MENU_ITEMS)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.menu_items (
    id VARCHAR(100) PRIMARY KEY,
    category VARCHAR(100) NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    price NUMERIC(6, 2) NOT NULL,
    badge VARCHAR(50),
    image TEXT,
    available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items FORCE ROW LEVEL SECURITY;

CREATE POLICY "menu_items_select_public"
    ON public.menu_items
    FOR SELECT
    TO anon, authenticated, service_role
    USING (true);

CREATE POLICY "menu_items_modify_service_role"
    ON public.menu_items
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ------------------------------------------------------------------------------
-- 6. CONSULTA DE VERIFICACIÓN DE PERMISOS RESULTANTES
-- ------------------------------------------------------------------------------
/*
-- Para verificar que RLS está activo y solo service_role tiene acceso a reservas:
SELECT 
    schemaname, 
    tablename, 
    policyname, 
    roles, 
    cmd 
FROM pg_policies 
WHERE schemaname = 'public' 
  AND tablename IN ('reservations', 'menu_items', 'rate_limits')
ORDER BY tablename, policyname;

-- Para verificar los permisos de ejecución de la función de rate limiting:
SELECT 
    routine_name, 
    grantee, 
    privilege_type 
FROM information_schema.routine_privileges 
WHERE routine_schema = 'public' 
  AND routine_name = 'check_rate_limit';
*/
