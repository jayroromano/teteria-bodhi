-- ========================================================
-- TETERÍA BODHI · PARCHE DE SEGURIDAD RLS (SUPABASE)
-- Objetivo: Proteger datos de clientes (RGPD) e impedir accesos no autorizados.
-- Ejecutar en: https://supabase.com/dashboard/project/vgvijpknawgrjctywywq/sql/new
-- ========================================================

-- 1. ASEGURAR QUE RLS ESTÁ HABILITADO
ALTER TABLE IF EXISTS public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.menu_items ENABLE ROW LEVEL SECURITY;

-- 2. TABLA DE RESERVAS: BLINDAJE DE PRIVACIDAD
-- Eliminar políticas antiguas excesivamente permisivas
DROP POLICY IF EXISTS "Permitir crear reservas" ON public.reservations;
DROP POLICY IF EXISTS "Permitir leer reservas" ON public.reservations;
DROP POLICY IF EXISTS "Permitir actualizar reservas" ON public.reservations;
DROP POLICY IF EXISTS "Permitir eliminar reservas" ON public.reservations;

-- POLÍTICA 1: Permitir que clientes anónimos creen reservas legítimas
CREATE POLICY "Permitir crear reservas"
  ON public.reservations
  FOR INSERT
  TO anon, authenticated, service_role
  WITH CHECK (
    -- Validar que los campos esenciales no estén vacíos
    length(trim(name)) > 0 AND
    length(trim(phone)) > 0 AND
    length(trim(date)) > 0 AND
    length(trim(time)) > 0
  );

-- POLÍTICA 2: Lectura protegida
-- Los clientes anónimos NO pueden consultar el listado de reservas de otros clientes.
-- Solo el rol de servicio del servidor (service_role) o usuarios autenticados de Supabase pueden consultar.
CREATE POLICY "Solo administradores leen reservas"
  ON public.reservations
  FOR SELECT
  TO authenticated, service_role
  USING (true);

-- POLÍTICA 3: Modificación protegida
-- Solo administradores pueden modificar estados, notas o mesas de las reservas.
CREATE POLICY "Solo administradores actualizan reservas"
  ON public.reservations
  FOR UPDATE
  TO authenticated, service_role
  USING (true)
  WITH CHECK (true);

-- POLÍTICA 4: Eliminación protegida
-- Solo administradores pueden cancelar o borrar registros.
CREATE POLICY "Solo administradores eliminan reservas"
  ON public.reservations
  FOR DELETE
  TO authenticated, service_role
  USING (true);

-- 3. TABLA DE CARTA DIGITAL: PROTECCIÓN DE INTEGRIDAD
DROP POLICY IF EXISTS "Lectura publica carta" ON public.menu_items;
DROP POLICY IF EXISTS "Modificar carta" ON public.menu_items;

-- La carta puede ser leída públicamente por cualquier cliente
CREATE POLICY "Lectura publica carta"
  ON public.menu_items
  FOR SELECT
  TO anon, authenticated, service_role
  USING (true);

-- Las modificaciones (añadir platos, cambiar precios, ocultar) solo pueden hacerse por administradores
CREATE POLICY "Solo administradores modifican carta"
  ON public.menu_items
  FOR ALL
  TO authenticated, service_role
  USING (true)
  WITH CHECK (true);
