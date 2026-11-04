-- ========================================================
-- TETERÍA BODHI · ESQUEMA DE BASE DE DATOS EN SUPABASE
-- Copia y pega todo este código en el SQL Editor de tu panel de Supabase:
-- https://supabase.com/dashboard/project/vgvijpknawgrjctywywq/sql/new
-- Y pulsa el botón verde "RUN"
-- ========================================================

-- 1. CREACIÓN DE LA TABLA DE RESERVAS
CREATE TABLE IF NOT EXISTS public.reservations (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  date VARCHAR(50) NOT NULL,
  time VARCHAR(50) NOT NULL,
  guests INT NOT NULL DEFAULT 2,
  zone VARCHAR(100) DEFAULT 'indiferente',
  notes TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  admin_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Índices para optimizar las consultas del panel de administración
CREATE INDEX IF NOT EXISTS idx_reservations_date ON public.reservations(date);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON public.reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_code ON public.reservations(code);

-- 2. POLÍTICAS DE SEGURIDAD (ROW LEVEL SECURITY)
-- Permite que la web y el panel de administración gestionen las reservas
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir crear reservas" ON public.reservations;
CREATE POLICY "Permitir crear reservas"
  ON public.reservations FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir leer reservas" ON public.reservations;
CREATE POLICY "Permitir leer reservas"
  ON public.reservations FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Permitir actualizar reservas" ON public.reservations;
CREATE POLICY "Permitir actualizar reservas"
  ON public.reservations FOR UPDATE
  USING (true);

DROP POLICY IF EXISTS "Permitir eliminar reservas" ON public.reservations;
CREATE POLICY "Permitir eliminar reservas"
  ON public.reservations FOR DELETE
  USING (true);

-- 3. TABLA DE LA CARTA DIGITAL (MENÚ)
CREATE TABLE IF NOT EXISTS public.menu_items (
  id VARCHAR(150) PRIMARY KEY,
  category VARCHAR(150) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price NUMERIC(8, 2) NOT NULL,
  badge VARCHAR(100),
  image TEXT,
  available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura publica carta" ON public.menu_items;
CREATE POLICY "Lectura publica carta" ON public.menu_items FOR SELECT USING (true);

DROP POLICY IF EXISTS "Modificar carta" ON public.menu_items;
CREATE POLICY "Modificar carta" ON public.menu_items FOR ALL USING (true);

-- 4. INSERTAR PRODUCTOS INICIALES DE LA CARTA
INSERT INTO public.menu_items (id, category, name, description, price, badge, image, available)
VALUES
  ('te-moruno', 'Tés e Infusiones', 'Té Verde Moruno Tradicional', 'Té verde gunpowder, hierbabuena fresca de la huerta andaluza y azúcar moreno en tetera artesana plateada.', 3.80, 'Especialidad', 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=400&q=80', true),
  ('chai-pakistani', 'Tés e Infusiones', 'Té Pakistaní Especiado', 'Té negro Broken Orange Pekoe macerado con canela, cardamomo, clavo, jengibre y leche cremosa emulsionada.', 4.20, 'Top Ventas', 'https://images.unsplash.com/photo-1561336313-0bd5e0b27ec8?auto=format&fit=crop&w=400&q=80', true),
  ('cachimba-bodhi', 'Cachimbas', 'Bodhi Signature Velvet', 'Mezcla secreta de frutos del bosque maduros, uva dulce, menta glacial suave y base de agua perfumada con azahar.', 14.00, 'Top Ventas', 'https://images.unsplash.com/photo-1527661591475-527312dd65f5?auto=format&fit=crop&w=400&q=80', true),
  ('coctel-bodhi-spritz', 'Cócteles', 'Bodhi Tea Spritz', 'Reducción artesanal de té Earl Grey, flor de saúco St. Germain, cava andaluz brut y twist de pomelo.', 7.50, 'Autor', 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=400&q=80', true),
  ('surtido-baklava', 'Dulces & Repostería', 'Surtido Artesano de Baklavas', 'Finas capas de masa filo crujiente rellenas de pistacho iraní, nueces y bañadas en almíbar de azahar y miel.', 5.00, 'Casero', 'https://images.unsplash.com/photo-1519869325930-281384150729?auto=format&fit=crop&w=400&q=80', true)
ON CONFLICT (id) DO NOTHING;

-- 5. INSERTAR RESERVAS DE EJEMPLO INICIALES
INSERT INTO public.reservations (code, name, phone, email, date, time, guests, zone, notes, status, admin_notes)
VALUES
  ('BDH-1042', 'Alejandro Morales', '+34 612 34 56 78', 'alejandro@example.com', CURRENT_DATE::text, '19:30', 2, 'interior', 'Mesa tranquila junto a los cojines para probar té pakistaní.', 'confirmed', 'Asignada mesa 4'),
  ('BDH-1043', 'Lucía Fernández', '+34 654 98 76 54', 'lucia@example.com', CURRENT_DATE::text, '21:00', 6, 'terraza', 'Celebración de cumpleaños de una amiga.', 'pending', 'Zona terraza')
ON CONFLICT (code) DO NOTHING;
