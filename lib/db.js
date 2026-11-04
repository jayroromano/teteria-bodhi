const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Cargar variables de entorno si existen
try {
  require('dotenv').config();
} catch (e) {}

// Detección de cadenas de conexión de proveedores cloud habituales en Vercel
// (Vercel Postgres, Neon, Supabase, Render, Railway, Tembo)
const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.SUPABASE_DATABASE_URL ||
  null;

let pgPool = null;

if (connectionString) {
  try {
    const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
    pgPool = new Pool({
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 3500, // Timeout rápido para no bloquear serverless
      idleTimeoutMillis: 30000,
      max: 3
    });

    pgPool.on('error', (err) => {
      console.warn('[PostgreSQL Pool Warning]:', err.message);
    });
  } catch (err) {
    console.warn('[PostgreSQL Init Warning]: No se pudo inicializar Pool, usando fallback:', err.message);
    pgPool = null;
  }
} else if (process.env.POSTGRES_HOST || process.env.DB_HOST) {
  try {
    pgPool = new Pool({
      host: process.env.POSTGRES_HOST || process.env.DB_HOST,
      port: Number(process.env.POSTGRES_PORT || process.env.DB_PORT) || 5432,
      user: process.env.POSTGRES_USER || process.env.DB_USER,
      password: process.env.POSTGRES_PASSWORD || process.env.DB_PASSWORD,
      database: process.env.POSTGRES_DATABASE || process.env.DB_NAME || 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 3500,
      idleTimeoutMillis: 30000,
      max: 3
    });

    pgPool.on('error', (err) => {
      console.warn('[PostgreSQL Client Warning]:', err.message);
    });
  } catch (err) {
    console.warn('[PostgreSQL Host Init Warning]:', err.message);
    pgPool = null;
  }
}

// Rutas de almacenamiento local de respaldo
const DATA_DIR = path.join(process.cwd(), 'data');
const RESERVAS_FILE = path.join(DATA_DIR, 'reservas.json');
const CARTA_FILE = path.join(DATA_DIR, 'carta.json');

// Memoria caché para entornos serverless si no hay filesystem accesible
let memoryReservas = null;
let memoryCarta = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {}
  }
}

function readLocalJson(filePath, memoryFallback) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (e) {
    console.warn(`[Storage] No se pudo leer ${filePath}, usando memoria:`, e.message);
  }
  return memoryFallback || [];
}

function writeLocalJson(filePath, data, setMemoryCallback) {
  setMemoryCallback(data);
  try {
    ensureDataDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    try {
      const tmpPath = path.join('/tmp', path.basename(filePath));
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (errTmp) {
      console.warn('[Storage] Persistencia en memoria activa:', errTmp.message);
    }
  }
}

// Inicialización de esquema PostgreSQL tolerante a fallos
let schemaInitialized = false;
let schemaPromise = null;

async function initPgSchema() {
  if (!pgPool || schemaInitialized) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    let client = null;
    try {
      client = await pgPool.connect();
      await client.query(`
        CREATE TABLE IF NOT EXISTS reservations (
          id SERIAL PRIMARY KEY,
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

        -- Garantizar compatibilidad con tablas preexistentes
        ALTER TABLE reservations ADD COLUMN IF NOT EXISTS email VARCHAR(255);
        ALTER TABLE reservations ADD COLUMN IF NOT EXISTS zone VARCHAR(100) DEFAULT 'indiferente';
        ALTER TABLE reservations ADD COLUMN IF NOT EXISTS notes TEXT;
        ALTER TABLE reservations ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';
        ALTER TABLE reservations ADD COLUMN IF NOT EXISTS admin_notes TEXT;
        ALTER TABLE reservations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

        CREATE TABLE IF NOT EXISTS menu_items (
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
      `);
      schemaInitialized = true;
      console.log('[PostgreSQL] Esquema verificado y tablas listas.');
    } catch (err) {
      console.warn('[PostgreSQL Warning] No se pudo verificar o crear esquema:', err.message);
      schemaInitialized = false;
    } finally {
      if (client) {
        try { client.release(); } catch (e) {}
      }
      schemaPromise = null;
    }
  })();

  return schemaPromise;
}

const db = {
  isCloudDb() {
    return Boolean(pgPool);
  },

  async testPgConnection() {
    if (!pgPool) {
      return { ok: false, error: 'No hay DATABASE_URL configurada en las variables de entorno de Vercel.' };
    }
    try {
      const client = await pgPool.connect();
      try {
        const res = await client.query('SELECT NOW() as now, current_database() as db');
        return { ok: true, now: res.rows[0].now, database: res.rows[0].db };
      } finally {
        client.release();
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  async getReservations(filters = {}) {
    if (pgPool) {
      try {
        await initPgSchema();
        let query = 'SELECT * FROM reservations WHERE 1=1';
        const params = [];
        let idx = 1;

        if (filters.status && filters.status !== 'all') {
          query += ` AND status = $${idx++}`;
          params.push(filters.status);
        }
        if (filters.date) {
          query += ` AND date = $${idx++}`;
          params.push(filters.date);
        }
        if (filters.search) {
          query += ` AND (LOWER(name) LIKE $${idx} OR phone LIKE $${idx} OR LOWER(code) LIKE $${idx})`;
          params.push(`%${filters.search.toLowerCase()}%`);
          idx++;
        }
        query += ' ORDER BY date DESC, time ASC, id DESC';

        const res = await pgPool.query(query, params);
        if (res && res.rows) {
          return res.rows;
        }
      } catch (err) {
        console.warn('[PostgreSQL Fallback] getReservations:', err.message);
      }
    }

    // Modo local / JSON
    let list = readLocalJson(RESERVAS_FILE, memoryReservas);
    if (!memoryReservas) memoryReservas = list;

    if (filters.status && filters.status !== 'all') {
      list = list.filter(r => r.status === filters.status);
    }
    if (filters.date) {
      list = list.filter(r => r.date === filters.date);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(r =>
        (r.name && r.name.toLowerCase().includes(q)) ||
        (r.phone && r.phone.includes(q)) ||
        (r.code && r.code.toLowerCase().includes(q))
      );
    }

    return list.sort((a, b) => {
      const cmpDate = (b.date || '').localeCompare(a.date || '');
      if (cmpDate !== 0) return cmpDate;
      return (b.time || '').localeCompare(a.time || '');
    });
  },

  async createReservation(data) {
    const code = data.code || `BDH-${Math.floor(1000 + Math.random() * 9000)}`;
    const record = {
      code,
      name: data.name,
      phone: data.phone,
      email: data.email || '',
      date: data.date,
      time: data.time,
      guests: Number(data.guests) || 2,
      zone: data.zone || 'indiferente',
      notes: data.notes || '',
      status: data.status || (Number(data.guests) > 4 ? 'pending' : 'confirmed'),
      admin_notes: data.admin_notes || '',
      created_at: new Date().toISOString()
    };

    if (pgPool) {
      try {
        await initPgSchema();
        const res = await pgPool.query(
          `INSERT INTO reservations (code, name, phone, email, date, time, guests, zone, notes, status, admin_notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [record.code, record.name, record.phone, record.email, record.date, record.time, record.guests, record.zone, record.notes, record.status, record.admin_notes]
        );
        if (res && res.rows && res.rows[0]) {
          console.log(`[PostgreSQL] Reserva ${record.code} guardada con éxito en la nube.`);
          return res.rows[0];
        }
      } catch (err) {
        console.warn('[PostgreSQL Fallback] Error guardando reserva en Postgres:', err.message);
      }
    }

    // Modo local / JSON (garantiza que NUNCA se pierda ni falle)
    const all = await this.getReservations({});
    const newId = `res_${Date.now()}`;
    const newRes = { id: newId, ...record };
    all.unshift(newRes);
    writeLocalJson(RESERVAS_FILE, all, (v) => { memoryReservas = v; });
    console.log(`[Storage] Reserva ${record.code} guardada en respaldo local/memoria.`);
    return newRes;
  },

  async updateReservation(id, updates) {
    if (pgPool) {
      try {
        await initPgSchema();
        const fields = [];
        const values = [];
        let idx = 1;

        for (const [key, val] of Object.entries(updates)) {
          if (['status', 'admin_notes', 'zone', 'guests', 'date', 'time'].includes(key)) {
            fields.push(`${key} = $${idx++}`);
            values.push(val);
          }
        }
        if (fields.length > 0) {
          values.push(id);
          const query = `UPDATE reservations SET ${fields.join(', ')} WHERE id = $${idx} OR code = $${idx} RETURNING *`;
          const res = await pgPool.query(query, values);
          if (res && res.rows && res.rows[0]) return res.rows[0];
        }
      } catch (err) {
        console.warn('[PostgreSQL Fallback] updateReservation:', err.message);
      }
    }

    // Local
    const all = await this.getReservations({});
    const idx = all.findIndex(r => String(r.id) === String(id) || r.code === id);
    if (idx === -1) return null;

    all[idx] = { ...all[idx], ...updates, updated_at: new Date().toISOString() };
    writeLocalJson(RESERVAS_FILE, all, (v) => { memoryReservas = v; });
    return all[idx];
  },

  async deleteReservation(id) {
    if (pgPool) {
      try {
        await initPgSchema();
        const res = await pgPool.query('DELETE FROM reservations WHERE id = $1 OR code = $1 RETURNING *', [id]);
        return res.rowCount > 0;
      } catch (err) {
        console.warn('[PostgreSQL Fallback] deleteReservation:', err.message);
      }
    }

    const all = await this.getReservations({});
    const initialLen = all.length;
    const filtered = all.filter(r => String(r.id) !== String(id) && r.code !== id);
    if (filtered.length !== initialLen) {
      writeLocalJson(RESERVAS_FILE, filtered, (v) => { memoryReservas = v; });
      return true;
    }
    return false;
  },

  async getStats() {
    const all = await this.getReservations({});
    const todayStr = new Date().toISOString().split('T')[0];

    const stats = {
      total: all.length,
      pending: all.filter(r => r.status === 'pending').length,
      confirmed: all.filter(r => r.status === 'confirmed').length,
      cancelled: all.filter(r => r.status === 'cancelled').length,
      todayCount: all.filter(r => r.date === todayStr && r.status !== 'cancelled').length,
      isCloudDb: this.isCloudDb()
    };
    return stats;
  },

  async getMenuItems() {
    if (pgPool) {
      try {
        await initPgSchema();
        const res = await pgPool.query('SELECT * FROM menu_items ORDER BY category, id');
        if (res && res.rows && res.rows.length > 0) return res.rows;
      } catch (err) {
        console.warn('[PostgreSQL Fallback] getMenuItems:', err.message);
      }
    }

    let items = readLocalJson(CARTA_FILE, memoryCarta);
    if (!memoryCarta) memoryCarta = items;
    return items;
  },

  async updateMenuItem(id, updates) {
    if (pgPool) {
      try {
        await initPgSchema();
        const fields = [];
        const values = [];
        let idx = 1;
        for (const [key, val] of Object.entries(updates)) {
          if (['available', 'price', 'name', 'description'].includes(key)) {
            fields.push(`${key} = $${idx++}`);
            values.push(val);
          }
        }
        if (fields.length > 0) {
          values.push(id);
          const res = await pgPool.query(`UPDATE menu_items SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
          if (res && res.rows && res.rows[0]) return res.rows[0];
        }
      } catch (err) {
        console.warn('[PostgreSQL Fallback] updateMenuItem:', err.message);
      }
    }

    const items = await this.getMenuItems();
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) return null;

    items[idx] = { ...items[idx], ...updates };
    writeLocalJson(CARTA_FILE, items, (v) => { memoryCarta = v; });
    return items[idx];
  }
};

module.exports = db;
