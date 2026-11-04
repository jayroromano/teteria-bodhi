const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const parse = require('pg-connection-string').parse;

// Cargar variables de entorno si existen (.env en local)
try {
  require('dotenv').config();
} catch (e) {}

// Detección exhaustiva de cadenas de conexión de PostgreSQL
// (Vercel Postgres, Neon, Supabase, Render, Railway, Tembo, etc.)
const rawConnectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRESQL_URL ||
  process.env.POSTGRES_URI ||
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.DB_CONNECTION_STRING ||
  process.env.DATABASE_URI ||
  null;

let pgPool = null;
let lastDbError = null;

if (rawConnectionString) {
  try {
    const trimmed = rawConnectionString.trim().replace(/^['"]|['"]$/g, '');
    const cleanUri = trimmed.replace(/[?&]sslmode=[^&]+/g, '');
    const parsed = parse(cleanUri);
    delete parsed.sslmode;

    const isLocal = (parsed.host || '').includes('localhost') || (parsed.host || '').includes('127.0.0.1');

    pgPool = new Pool({
      ...parsed,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000, // 10 segundos para soportar el encendido en frío (cold start) de Neon/Supabase
      idleTimeoutMillis: 30000,
      max: 3
    });

    pgPool.on('error', (err) => {
      console.warn('[PostgreSQL Pool Warning]:', err.message);
      lastDbError = err.message;
    });

    console.log('[PostgreSQL Config] Pool configurado hacia host:', parsed.host, 'base de datos:', parsed.database);
  } catch (err) {
    console.warn('[PostgreSQL Init Warning]: No se pudo parsear connection string:', err.message);
    lastDbError = err.message;
    pgPool = null;
  }
} else if (process.env.POSTGRES_HOST || process.env.DB_HOST) {
  try {
    const isLocal = (process.env.POSTGRES_HOST || process.env.DB_HOST).includes('localhost');
    pgPool = new Pool({
      host: process.env.POSTGRES_HOST || process.env.DB_HOST,
      port: Number(process.env.POSTGRES_PORT || process.env.DB_PORT) || 5432,
      user: process.env.POSTGRES_USER || process.env.DB_USER,
      password: process.env.POSTGRES_PASSWORD || process.env.DB_PASSWORD,
      database: process.env.POSTGRES_DATABASE || process.env.DB_NAME || 'postgres',
      ssl: isLocal ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 3
    });

    pgPool.on('error', (err) => {
      console.warn('[PostgreSQL Client Warning]:', err.message);
      lastDbError = err.message;
    });
  } catch (err) {
    console.warn('[PostgreSQL Host Init Warning]:', err.message);
    lastDbError = err.message;
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

// Si la base de datos PostgreSQL está vacía, sembrar las reservas de muestra
async function seedDefaultReservations(client) {
  try {
    const countRes = await client.query('SELECT count(*) as count FROM reservations');
    if (parseInt(countRes.rows[0].count, 10) === 0) {
      const initial = [
        { code: 'BDH-1042', name: 'Alejandro Morales', phone: '+34 612 34 56 78', email: 'alejandro.morales@example.com', date: new Date().toISOString().split('T')[0], time: '19:30', guests: 2, zone: 'interior', notes: 'Mesa tranquila junto a los cojines para probar té pakistaní.', status: 'confirmed', admin_notes: 'Asignada mesa 4 rincón marroquí.' },
        { code: 'BDH-1043', name: 'Lucía Fernández', phone: '+34 654 98 76 54', email: 'lucia.f@example.com', date: new Date().toISOString().split('T')[0], time: '21:00', guests: 6, zone: 'terraza', notes: 'Celebración de cumpleaños de una amiga.', status: 'pending', admin_notes: 'Pendiente de confirmar zona en terraza.' },
        { code: 'BDH-1044', name: 'Carlos Ruiz Gómez', phone: '+34 678 11 22 33', email: 'carlos.ruiz@example.com', date: new Date(Date.now() + 86400000).toISOString().split('T')[0], time: '20:00', guests: 4, zone: 'indiferente', notes: 'Una persona intolerante al gluten para la repostería.', status: 'confirmed', admin_notes: 'Avisado repostería.' }
      ];
      for (const r of initial) {
        await client.query(
          `INSERT INTO reservations (code, name, phone, email, date, time, guests, zone, notes, status, admin_notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (code) DO NOTHING`,
          [r.code, r.name, r.phone, r.email, r.date, r.time, r.guests, r.zone, r.notes, r.status, r.admin_notes]
        );
      }
      console.log('[PostgreSQL] Datos iniciales sembrados con éxito.');
    }
  } catch (e) {
    console.warn('[PostgreSQL Warning] No se pudieron sembrar datos iniciales:', e.message);
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
      `);

      // Asegurar columnas opcionales sin riesgo de error si ya existen
      const alterQueries = [
        "ALTER TABLE reservations ADD COLUMN IF NOT EXISTS email VARCHAR(255)",
        "ALTER TABLE reservations ADD COLUMN IF NOT EXISTS zone VARCHAR(100) DEFAULT 'indiferente'",
        "ALTER TABLE reservations ADD COLUMN IF NOT EXISTS notes TEXT",
        "ALTER TABLE reservations ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending'",
        "ALTER TABLE reservations ADD COLUMN IF NOT EXISTS admin_notes TEXT",
        "ALTER TABLE reservations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"
      ];
      for (const q of alterQueries) {
        try { await client.query(q); } catch (e) {}
      }

      await client.query(`
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

      await seedDefaultReservations(client);

      schemaInitialized = true;
      lastDbError = null;
      console.log('[PostgreSQL] Esquema verificado y tablas listas.');
    } catch (err) {
      lastDbError = err.message;
      console.warn('[PostgreSQL Warning] No se pudo verificar o crear esquema:', err.message);
      schemaInitialized = false;
      throw err;
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

  getLastError() {
    return lastDbError;
  },

  getDetectedEnvVar() {
    const names = [
      'DATABASE_URL',
      'POSTGRES_URL',
      'POSTGRES_PRISMA_URL',
      'POSTGRES_URL_NON_POOLING',
      'POSTGRESQL_URL',
      'POSTGRES_URI',
      'SUPABASE_DATABASE_URL',
      'SUPABASE_DB_URL',
      'DB_CONNECTION_STRING',
      'DATABASE_URI'
    ];
    for (const name of names) {
      if (process.env[name]) return name;
    }
    if (process.env.POSTGRES_HOST || process.env.DB_HOST) return 'POSTGRES_HOST (parámetros separados)';
    return null;
  },

  async testPgConnection() {
    if (!pgPool) {
      const varsFound = this.getDetectedEnvVar();
      return {
        ok: false,
        error: varsFound
          ? `Variable ${varsFound} detectada en Vercel, pero el pool de PostgreSQL no pudo iniciarse.`
          : 'No se ha detectado ninguna variable DATABASE_URL o POSTGRES_URL en el entorno de Vercel.'
      };
    }
    try {
      const client = await pgPool.connect();
      try {
        await initPgSchema();
        const res = await client.query('SELECT NOW() as now, current_database() as db, count(*) as count FROM reservations');
        lastDbError = null;
        return {
          ok: true,
          now: res.rows[0].now,
          database: res.rows[0].db,
          reservationsCount: parseInt(res.rows[0].count, 10)
        };
      } finally {
        client.release();
      }
    } catch (err) {
      lastDbError = err.message;
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
        lastDbError = err.message;
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
          const saved = res.rows[0];
          saved.isCloudDb = true;
          return saved;
        }
      } catch (err) {
        lastDbError = err.message;
        console.warn('[PostgreSQL Fallback] Error guardando reserva en Postgres:', err.message);
      }
    }

    // Modo local / JSON (garantiza que NUNCA se pierda ni falle)
    const all = await this.getReservations({});
    const newId = `res_${Date.now()}`;
    const newRes = { id: newId, ...record, isCloudDb: false };
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
        lastDbError = err.message;
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
        lastDbError = err.message;
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
      todayGuests: all.filter(r => r.date === todayStr && r.status !== 'cancelled').reduce((acc, cur) => acc + (Number(cur.guests) || 0), 0),
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
        lastDbError = err.message;
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
        lastDbError = err.message;
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
