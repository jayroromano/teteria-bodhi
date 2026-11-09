-- ==============================================================================
-- TETERÍA BODHI · PARCHE INTEGRAL DE SEGURIDAD Y PRIVACIDAD (SUPABASE POSTGRESQL)
-- ==============================================================================
-- Instrucciones:
-- Este script debe ser revisado y ejecutado manualmente por el propietario en el
-- SQL Editor de Supabase (https://supabase.com/dashboard/project/_/sql/new).
-- No contiene contraseñas ni claves privadas.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABLA DE CONTROL DE PETICIONES (RATE LIMITING DISTRIBUIDO SERVERLESS)
-- ------------------------------------------------------------------------------
-- Permite proteger inicios de sesión y reservas entre diferentes instancias de Vercel.
CREATE TABLE IF NOT EXISTS public.rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 1,
    reset_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Habilitar RLS estricto: ningún cliente anónimo ni usuario regular puede acceder directamente
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_gestiona_rate_limits" ON public.rate_limits;
CREATE POLICY "service_role_gestiona_rate_limits"
    ON public.rate_limits
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Función atómica para control de límites de peticiones en Supabase
CREATE OR REPLACE FUNCTION public.check_rate_limit(
    p_key TEXT,
    p_max_requests INTEGER,
    p_window_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_reset_at TIMESTAMPTZ;
    v_count INTEGER;
BEGIN
    -- Limpieza periódica de ventanas expiradas
    DELETE FROM public.rate_limits WHERE reset_at < v_now;

    SELECT count, reset_at INTO v_count, v_reset_at
    FROM public.rate_limits
    WHERE key = p_key
    FOR UPDATE;

    IF NOT FOUND OR v_reset_at < v_now THEN
        INSERT INTO public.rate_limits (key, count, reset_at)
        VALUES (p_key, 1, v_now + (p_window_seconds || ' seconds')::INTERVAL)
        ON CONFLICT (key) DO UPDATE
        SET count = 1, reset_at = v_now + (p_window_seconds || ' seconds')::INTERVAL;
        RETURN TRUE;
    END IF;

    IF v_count >= p_max_requests THEN
        RETURN FALSE;
    END IF;

    UPDATE public.rate_limits
    SET count = count + 1
    WHERE key = p_key;

    RETURN TRUE;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. TABLA DE RESERVAS (PROTECCIÓN DE DATOS PERSONALES RGPD / LOPDGDD)
-- ------------------------------------------------------------------------------
-- Garantiza que las tablas existan con los campos requeridos
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

-- Habilitar RLS obligatorio
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

-- Limpieza de políticas antiguas para evitar accesos indebidos heredados
DROP POLICY IF EXISTS "Permitir crear reservas" ON public.reservations;
DROP POLICY IF EXISTS "Permitir leer reservas" ON public.reservations;
DROP POLICY IF EXISTS "Permitir actualizar reservas" ON public.reservations;
DROP POLICY IF EXISTS "Permitir eliminar reservas" ON public.reservations;
DROP POLICY IF EXISTS "Solo administradores leen reservas" ON public.reservations;
DROP POLICY IF EXISTS "Solo administradores actualizan reservas" ON public.reservations;
DROP POLICY IF EXISTS "Solo administradores eliminan reservas" ON public.reservations;
DROP POLICY IF EXISTS "public_reservations_insert" ON public.reservations;
DROP POLICY IF EXISTS "service_role_reservations_select" ON public.reservations;
DROP POLICY IF EXISTS "service_role_reservations_update" ON public.reservations;
DROP POLICY IF EXISTS "service_role_reservations_delete" ON public.reservations;

-- A) INSERCIÓN PÚBLICA CONTROLADA (Clientes en la web)
-- Los clientes anónimos SOLO pueden insertar reservas con campos mínimos validados
CREATE POLICY "public_reservations_insert"
    ON public.reservations
    FOR INSERT
    TO anon, authenticated, service_role
    WITH CHECK (
        length(trim(name)) >= 2 AND
        length(trim(phone)) >= 6 AND
        length(trim(date)) = 10 AND
        length(trim(time)) >= 4
    );

-- B) CONSULTA PRIVILEGIADA (Solo backend de administración mediante service_role)
-- Se excluye intencionadamente el rol 'authenticated' genérico para evitar que cualquier
-- usuario registrado en Supabase Auth obtenga acceso a los datos personales de clientes.
CREATE POLICY "service_role_reservations_select"
    ON public.reservations
    FOR SELECT
    TO service_role
    USING (true);

-- C) MODIFICACIÓN PRIVILEGIADA (Solo backend de administración mediante service_role)
CREATE POLICY "service_role_reservations_update"
    ON public.reservations
    FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

-- D) ELIMINACIÓN PRIVILEGIADA (Solo backend de administración mediante service_role)
CREATE POLICY "service_role_reservations_delete"
    ON public.reservations
    FOR DELETE
    TO service_role
    USING (true);

-- ------------------------------------------------------------------------------
-- 3. TABLA DE CARTA DIGITAL (MENU_ITEMS)
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

-- Limpieza de políticas anteriores
DROP POLICY IF EXISTS "Lectura publica carta" ON public.menu_items;
DROP POLICY IF EXISTS "Modificar carta" ON public.menu_items;
DROP POLICY IF EXISTS "Solo administradores modifican carta" ON public.menu_items;
DROP POLICY IF EXISTS "public_menu_select" ON public.menu_items;
DROP POLICY IF EXISTS "service_role_menu_insert" ON public.menu_items;
DROP POLICY IF EXISTS "service_role_menu_update" ON public.menu_items;
DROP POLICY IF EXISTS "service_role_menu_delete" ON public.menu_items;

-- A) LECTURA PÚBLICA (Todos los usuarios pueden ver la carta digital)
CREATE POLICY "public_menu_select"
    ON public.menu_items
    FOR SELECT
    TO anon, authenticated, service_role
    USING (true);

-- B) OPERACIONES DE GESTIÓN (Añadir, modificar y eliminar productos)
-- Estrictamente restringidas al backend privilegiado (service_role)
CREATE POLICY "service_role_menu_insert"
    ON public.menu_items
    FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "service_role_menu_update"
    ON public.menu_items
    FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "service_role_menu_delete"
    ON public.menu_items
    FOR DELETE
    TO service_role
    USING (true);

-- ==============================================================================
-- RESUMEN DE PERMISOS RESULTANTES TRAS APLICAR EL SCRIPT:
-- 1. Usuarios anónimos (navegador del cliente):
--    - Inserción de reservas: PERMITIDA con validaciones mínimas.
--    - Lectura de reservas ajenas: BLOQUEADA (Error 401/403 o array vacío por RLS).
--    - Modificación o borrado de reservas: BLOQUEADO.
--    - Lectura de carta digital: PERMITIDA.
--    - Modificación de carta digital: BLOQUEADA.
-- 2. Usuarios con rol 'authenticated' (usuarios generales sin claims específicos):
--    - Bloqueados para consultar o manipular reservas.
-- 3. Backend de Vercel (operando con SUPABASE_SERVICE_ROLE_KEY):
--    - Acceso controlado a operaciones administrativas, validado previamente en
--      las funciones serverless (/api/admin-login, /api/reservas, /api/carta).
-- ==============================================================================
