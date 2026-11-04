-- =========================================================
-- Esquema SQL para Tetería Bodhi (PostgreSQL / Supabase / Neon)
-- =========================================================

-- Tabla de Reservas
CREATE TABLE IF NOT EXISTS reservations (
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

-- Índices para búsqueda rápida en el panel de administración
CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(date);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_code ON reservations(code);

-- Tabla de Carta / Menú
CREATE TABLE IF NOT EXISTS menu_items (
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

-- Inserción de datos iniciales de la carta (opcional si no se usa sincronización automática)
INSERT INTO menu_items (id, category, name, description, price, badge, image, available)
VALUES
  ('te-moruno', 'Tés e Infusiones', 'Té Verde Moruno Tradicional', 'Té verde gunpowder, hierbabuena fresca y azúcar moreno en tetera artesanal.', 3.80, 'Especialidad', 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=400&q=80', true),
  ('chai-pakistani', 'Tés e Infusiones', 'Té Pakistaní Especiado', 'Té negro, canela, cardamomo, clavo y leche cremosa emulsionada.', 4.20, 'Top Ventas', 'https://images.unsplash.com/photo-1561336313-0bd5e0b27ec8?auto=format&fit=crop&w=400&q=80', true),
  ('cachimba-bodhi', 'Cachimbas', 'Bodhi Signature Velvet', 'Frutos del bosque, menta glacial suave y base de agua perfumada.', 14.00, 'Top Ventas', 'https://images.unsplash.com/photo-1527661591475-527312dd65f5?auto=format&fit=crop&w=400&q=80', true),
  ('coctel-bodhi-spritz', 'Cócteles', 'Bodhi Tea Spritz', 'Reducción de té Earl Grey, flor de saúco, cava brut andaluz y twist de pomelo.', 7.50, 'Autor', 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=400&q=80', true),
  ('surtido-baklava', 'Dulces & Repostería', 'Surtido Artesano de Baklavas', 'Masa filo crujiente, pistachos iraníes, nueces y miel con azahar.', 5.00, 'Casero', 'https://images.unsplash.com/photo-1519869325930-281384150729?auto=format&fit=crop&w=400&q=80', true)
ON CONFLICT (id) DO NOTHING;
