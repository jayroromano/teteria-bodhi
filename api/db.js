const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Cargar variables de entorno si existen
try {
  require('dotenv').config();
} catch (e) {
  // dotenv opcional en serverless si las variables ya vienen inyectadas
}

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
let pgPool = null;

if (connectionString) {
  try {
    pgPool = new Pool({
      connectionString,
      ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
    });
  } catch (err) {
    console.error('Error inicializando Pool PostgreSQL:', err);
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
    } catch (e) {
      // Entorno read-only
    }
  }
}

function readLocalJson(filePath, memoryFallback) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (e) {
    console.warn(`No se pudo leer ${filePath}, usando memoria:`, e.message);
  }
  return memoryFallback || [];
}

function writeLocalJson(filePath, data, setMemoryCallback) {
  setMemoryCallback(data);
  try {
    ensureDataDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    // Si estamos en Vercel sin persistencia en disco, intentamos guardar en /tmp
    try {
      const tmpPath = path.join('/tmp', path.basename(filePath));
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (errTmp) {
      console.warn('Persistencia en memoria activa (read-only filesystem):', errTmp.message);
    }
  }
}

// Inicialización de esquema PostgreSQL
let schemaInitialized = false;
async function initPgSchema() {
  if (!pgPool || schemaInitialized) return;
  const client = await pgPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS reservations (
        id SERIAL PRIMARY KEY,
        code VARCHAR(30) UNIQUE NOT NULL,
        name VARCHAR(150) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        email VARCHAR(150),
        date VARCHAR(20) NOT NULL,
        time VARCHAR(20) NOT NULL,
        guests INT NOT NULL,
        zone VARCHAR(50) DEFAULT 'indiferente',
        notes TEXT,
        status VARCHAR(30) DEFAULT 'pending',
        admin_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS menu_items (
        id VARCHAR(100) PRIMARY KEY,
        category VARCHAR(100) NOT NULL,
        name VARCHAR(150) NOT NULL,
        description TEXT,
        price NUMERIC(6, 2) NOT NULL,
        badge VARCHAR(50),
        image TEXT,
        available BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    schemaInitialized = true;
  } catch (err) {
    console.error('Error creando esquema en PostgreSQL:', err);
  } finally {
    client.release();
  }
}

// API de Base de Datos unificada
const db = {
  isCloudDb() {
    return Boolean(pgPool);
  },

  async getReservations(filters = {}) {
    if (pgPool) {
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
      return res.rows;
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

    // Ordenar por fecha y hora descendente
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
      await initPgSchema();
      const res = await pgPool.query(
        `INSERT INTO reservations (code, name, phone, email, date, time, guests, zone, notes, status, admin_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [record.code, record.name, record.phone, record.email, record.date, record.time, record.guests, record.zone, record.notes, record.status, record.admin_notes]
      );
      return res.rows[0];
    }

    // Local
    const all = await this.getReservations({});
    const newId = `res_${Date.now()}`;
    const newRes = { id: newId, ...record };
    all.unshift(newRes);
    writeLocalJson(RESERVAS_FILE, all, (v) => { memoryReservas = v; });
    return newRes;
  },

  async updateReservation(id, updates) {
    if (pgPool) {
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
      if (fields.length === 0) return null;

      values.push(id);
      const query = `UPDATE reservations SET ${fields.join(', ')} WHERE id = $${idx} OR code = $${idx} RETURNING *`;
      const res = await pgPool.query(query, values);
      return res.rows[0] || null;
    }

    // Local
    const all = await this.getReservations({});
    const index = all.findIndex(r => String(r.id) === String(id) || r.code === String(id));
    if (index === -1) return null;

    all[index] = { ...all[index], ...updates };
    writeLocalJson(RESERVAS_FILE, all, (v) => { memoryReservas = v; });
    return all[index];
  },

  async deleteReservation(id) {
    if (pgPool) {
      await initPgSchema();
      const res = await pgPool.query('DELETE FROM reservations WHERE id = $1 OR code = $1 RETURNING *', [id]);
      return res.rowCount > 0;
    }

    const all = await this.getReservations({});
    const filtered = all.filter(r => String(r.id) !== String(id) && r.code !== String(id));
    if (filtered.length === all.length) return false;
    writeLocalJson(RESERVAS_FILE, filtered, (v) => { memoryReservas = v; });
    return true;
  },

  async getStats() {
    const all = await this.getReservations({});
    const todayStr = new Date().toISOString().split('T')[0];

    let pending = 0;
    let confirmed = 0;
    let cancelled = 0;
    let todayCount = 0;
    let todayGuests = 0;

    all.forEach(r => {
      if (r.status === 'pending') pending++;
      else if (r.status === 'confirmed') confirmed++;
      else if (r.status === 'cancelled') cancelled++;

      if (r.date === todayStr && r.status !== 'cancelled') {
        todayCount++;
        todayGuests += Number(r.guests) || 0;
      }
    });

    return {
      total: all.length,
      pending,
      confirmed,
      cancelled,
      todayCount,
      todayGuests,
      isCloudDb: this.isCloudDb()
    };
  },

  async getMenuItems() {
    if (pgPool) {
      await initPgSchema();
      const res = await pgPool.query('SELECT * FROM menu_items ORDER BY category, id');
      if (res.rows.length > 0) return res.rows;
    }

    // Local
    let items = readLocalJson(CARTA_FILE, memoryCarta);
    if (!memoryCarta) memoryCarta = items;
    return items;
  },

  async updateMenuItem(id, updates) {
    if (pgPool) {
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
      if (fields.length === 0) return null;
      values.push(id);
      const res = await pgPool.query(`UPDATE menu_items SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
      return res.rows[0] || null;
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
