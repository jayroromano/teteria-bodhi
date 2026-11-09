const fs = require('fs');
const path = require('path');
const https = require('https');
const { Pool } = require('pg');
const parse = require('pg-connection-string').parse;

try {
  require('dotenv').config();
} catch (e) {}

function isProduction() {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
}

// ========================================================
// 1. CONFIGURACIÓN SUPABASE (REST API)
// ========================================================
const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();

// Separación estricta de credenciales:
// service_role: exclusivamente en backend para operaciones privilegiadas
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
// anon key: solo para lecturas públicas cuando corresponda
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();

function supabaseRequest(pathname, method = 'GET', body = null, extraHeaders = {}, privileged = true) {
  const key = privileged ? supabaseServiceKey : (supabaseAnonKey || supabaseServiceKey);

  if (!supabaseUrl || !key) {
    if (isProduction()) {
      return Promise.reject(new Error(`Faltan credenciales de Supabase en producción (${privileged ? 'SUPABASE_SERVICE_ROLE_KEY' : 'SUPABASE_ANON_KEY'})`));
    }
    return Promise.resolve({ status: 0, error: 'No Supabase credentials configured' });
  }

  return new Promise((resolve, reject) => {
    try {
      const fullUrl = new URL(pathname, supabaseUrl);
      const headers = {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...extraHeaders
      };

      const req = https.request(fullUrl, { method, headers, timeout: 8000 }, (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null, raw: data });
          } catch (e) {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error('Timeout de conexión con Supabase (8s)'));
      });

      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ========================================================
// 2. CONFIGURACIÓN POSTGRESQL TCP (OPCIONAL)
// ========================================================
const rawConnectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRESQL_URL ||
  process.env.POSTGRES_URI ||
  null;

let pgPool = null;
let lastDbError = null;

if (rawConnectionString && !rawConnectionString.startsWith('http')) {
  try {
    const trimmed = rawConnectionString.trim().replace(/^['"]|['"]$/g, '');
    const cleanUri = trimmed.replace(/[?&]sslmode=[^&]+/g, '');
    const parsed = parse(cleanUri);
    delete parsed.sslmode;

    const isLocal = (parsed.host || '').includes('localhost') || (parsed.host || '').includes('127.0.0.1');

    // Validación estricta de certificados TLS por defecto
    const sslConfig = isLocal
      ? false
      : {
          rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === 'false' ? false : true
        };

    pgPool = new Pool({
      ...parsed,
      ssl: sslConfig,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 3
    });

    pgPool.on('error', (err) => {
      console.error('[PostgreSQL Pool Warning]:', err.message);
      lastDbError = 'Error de conexión con PostgreSQL';
    });
  } catch (err) {
    lastDbError = 'Error de inicialización de PostgreSQL';
    pgPool = null;
  }
}

// ========================================================
// 3. ALMACENAMIENTO LOCAL EXCLUSIVO PARA DESARROLLO OFFLINE
// ========================================================
const DATA_DIR = path.join(process.cwd(), 'data');
const RESERVAS_FILE = path.join(DATA_DIR, 'reservas.json');
const CARTA_FILE = path.join(DATA_DIR, 'carta.json');

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
    console.warn(`[Storage Local] Lectura:`, e.message);
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
    } catch (errTmp) {}
  }
}

const db = {
  isCloudDb() {
    return Boolean((supabaseUrl && supabaseServiceKey) || pgPool);
  },

  getProviderName() {
    if (supabaseUrl && supabaseServiceKey) return 'Supabase Cloud (REST API)';
    if (pgPool) return 'PostgreSQL TCP Pool';
    return isProduction() ? 'Sin base de datos configurada' : 'Local JSON / Memoria (Desarrollo)';
  },

  getLastError() {
    return lastDbError;
  },

  /**
   * Diagnóstico seguro sin exponer claves enmascaradas ni URLs sensibles
   */
  async testCloudConnection() {
    if (supabaseUrl && supabaseServiceKey) {
      try {
        const sbRes = await supabaseRequest(
          '/rest/v1/reservations?select=count',
          'GET',
          null,
          { 'Prefer': 'count=exact', 'Range-Unit': 'items' },
          true
        );

        if (sbRes.status === 200 || sbRes.status === 206) {
          lastDbError = null;
          return {
            ok: true,
            provider: 'Supabase Cloud (REST)',
            tableReady: true
          };
        } else if (sbRes.status === 404 && sbRes.data?.code === 'PGRST205') {
          lastDbError = "Falta crear la tabla 'reservations' en Supabase.";
          return {
            ok: false,
            provider: 'Supabase Cloud (REST)',
            tableReady: false,
            error: "Falta crear la tabla 'reservations' en Supabase. Ejecute el script SQL correspondiente."
          };
        } else {
          lastDbError = 'Error de conexión con la base de datos Supabase';
          return {
            ok: false,
            provider: 'Supabase Cloud',
            error: 'No se pudo comunicar con el servicio de base de datos.'
          };
        }
      } catch (e) {
        lastDbError = 'Fallo en la conexión segura con Supabase';
        return { ok: false, provider: 'Supabase Cloud', error: 'Error de red o conexión.' };
      }
    }

    if (pgPool) {
      try {
        const client = await pgPool.connect();
        try {
          await client.query('SELECT count(*) as count FROM reservations');
          lastDbError = null;
          return {
            ok: true,
            provider: 'PostgreSQL TCP',
            tableReady: true
          };
        } finally {
          client.release();
        }
      } catch (err) {
        lastDbError = 'Error de consulta en PostgreSQL TCP';
        return { ok: false, provider: 'PostgreSQL TCP', error: 'Fallo al verificar tabla en PostgreSQL' };
      }
    }

    return {
      ok: false,
      error: 'No se han configurado credenciales de base de datos en el servidor.'
    };
  },

  async getReservations(filters = {}) {
    // 1. Supabase REST API (Privilegiado: service_role)
    if (supabaseUrl && supabaseServiceKey) {
      try {
        let queryParams = ['select=*', 'order=date.desc,time.asc,id.desc'];
        if (filters.status && filters.status !== 'all') {
          queryParams.push(`status=eq.${encodeURIComponent(filters.status)}`);
        }
        if (filters.date) {
          queryParams.push(`date=eq.${encodeURIComponent(filters.date)}`);
        }
        if (filters.search) {
          const q = encodeURIComponent(filters.search.replace(/[^a-zA-Z0-9@. _-]/g, ''));
          queryParams.push(`or=(name.ilike.*${q}*,phone.like.*${q}*,code.ilike.*${q}*)`);
        }

        const sbRes = await supabaseRequest(`/rest/v1/reservations?${queryParams.join('&')}`, 'GET', null, {}, true);
        if (sbRes.status === 200 && Array.isArray(sbRes.data)) {
          lastDbError = null;
          return sbRes.data;
        } else {
          lastDbError = 'Error consultando reservas en Supabase';
          console.error('[DB Error] getReservations Supabase:', sbRes.data || sbRes.status);
          if (isProduction()) {
            throw new Error('DATABASE_QUERY_FAILED');
          }
        }
      } catch (err) {
        lastDbError = 'Fallo de consulta en base de datos';
        console.error('[DB Error] getReservations:', err.message);
        if (isProduction()) {
          throw err;
        }
      }
    }

    // 2. PostgreSQL TCP
    if (pgPool) {
      try {
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
        lastDbError = 'Error consultando reservas en Postgres';
        if (isProduction()) throw err;
      }
    }

    // 3. En producción, NUNCA leer de JSON local/memoria como si fuera la BD real
    if (isProduction()) {
      throw new Error('No hay base de datos disponible para consultar reservas en producción.');
    }

    // Fallback local exclusivamente en desarrollo offline
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
      email: data.email || null,
      date: data.date,
      time: data.time,
      guests: Number(data.guests) || 2,
      zone: data.zone || 'indiferente',
      notes: data.notes || null,
      status: data.status || (Number(data.guests) > 4 ? 'pending' : 'confirmed'),
      admin_notes: data.admin_notes || null,
      created_at: new Date().toISOString()
    };

    // 1. Guardar en Supabase REST API (con service_role para garantizar persistencia)
    if (supabaseUrl && supabaseServiceKey) {
      try {
        const payload = {
          code: record.code,
          name: record.name,
          phone: record.phone,
          email: record.email,
          date: record.date,
          time: record.time,
          guests: record.guests,
          zone: record.zone,
          notes: record.notes,
          status: record.status,
          admin_notes: record.admin_notes
        };

        const sbRes = await supabaseRequest('/rest/v1/reservations', 'POST', payload, {
          'Prefer': 'return=representation'
        }, true);

        if (sbRes.status === 201 && Array.isArray(sbRes.data) && sbRes.data[0]) {
          const saved = sbRes.data[0];
          saved.isCloudDb = true;
          saved.provider = 'Supabase Cloud';
          return saved;
        } else {
          const errMsg = sbRes.data?.message || sbRes.raw || `HTTP ${sbRes.status}`;
          lastDbError = 'Error guardando reserva en Supabase';
          console.error('[DB Error] createReservation Supabase:', errMsg);
          if (isProduction()) {
            throw new Error('PERSISTENCE_FAILED');
          }
        }
      } catch (err) {
        lastDbError = 'Fallo de conexión persistiendo reserva';
        console.error('[DB Error] createReservation exception:', err.message);
        if (isProduction()) {
          throw err;
        }
      }
    }

    // 2. Guardar en PostgreSQL TCP si está configurado
    if (pgPool) {
      try {
        const res = await pgPool.query(
          `INSERT INTO reservations (code, name, phone, email, date, time, guests, zone, notes, status, admin_notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [record.code, record.name, record.phone, record.email, record.date, record.time, record.guests, record.zone, record.notes, record.status, record.admin_notes]
        );
        if (res && res.rows && res.rows[0]) {
          const saved = res.rows[0];
          saved.isCloudDb = true;
          saved.provider = 'PostgreSQL TCP';
          return saved;
        }
      } catch (err) {
        lastDbError = 'Error de inserción en PostgreSQL';
        console.error('[DB Error] pgPool createReservation:', err.message);
        if (isProduction()) {
          throw err;
        }
      }
    }

    // 3. En producción, JAMÁS simular éxito con memoria/JSON efímero
    if (isProduction()) {
      throw new Error('No se pudo persistir la reserva en la base de datos.');
    }

    // Fallback local exclusivamente en desarrollo offline
    const all = await this.getReservations({});
    const newId = `res_${Date.now()}`;
    const newRes = { id: newId, ...record, isCloudDb: false, provider: 'Local Fallback' };
    all.unshift(newRes);
    writeLocalJson(RESERVAS_FILE, all, (v) => { memoryReservas = v; });
    return newRes;
  },

  async updateReservation(id, updates) {
    // Lista blanca estricta de campos modificables
    const allowedFields = ['status', 'admin_notes', 'zone', 'guests', 'date', 'time', 'notes'];
    const sanitizedUpdates = {};
    for (const key of Object.keys(updates)) {
      if (allowedFields.includes(key) && updates[key] !== undefined) {
        sanitizedUpdates[key] = updates[key];
      }
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return null;
    }

    if (supabaseUrl && supabaseServiceKey) {
      try {
        const isNumeric = !isNaN(Number(id));
        const filterParam = isNumeric ? `id=eq.${id}` : `code=eq.${encodeURIComponent(id)}`;
        const sbRes = await supabaseRequest(
          `/rest/v1/reservations?${filterParam}`,
          'PATCH',
          sanitizedUpdates,
          { 'Prefer': 'return=representation' },
          true
        );

        if ((sbRes.status === 200 || sbRes.status === 204) && Array.isArray(sbRes.data) && sbRes.data.length > 0) {
          return sbRes.data[0];
        }
        if (sbRes.status === 200 && Array.isArray(sbRes.data) && sbRes.data.length === 0) {
          return null; // Registro no encontrado
        }
      } catch (err) {
        console.error('[DB Error] updateReservation Supabase:', err.message);
        if (isProduction()) throw err;
      }
    }

    if (pgPool) {
      try {
        const fields = [];
        const values = [];
        let idx = 1;
        for (const [key, val] of Object.entries(sanitizedUpdates)) {
          fields.push(`${key} = $${idx++}`);
          values.push(val);
        }
        if (fields.length > 0) {
          values.push(id);
          const query = `UPDATE reservations SET ${fields.join(', ')} WHERE id = $${idx} OR code = $${idx} RETURNING *`;
          const res = await pgPool.query(query, values);
          if (res && res.rows && res.rows[0]) return res.rows[0];
        }
      } catch (err) {
        if (isProduction()) throw err;
      }
    }

    if (isProduction()) {
      return null;
    }

    const all = await this.getReservations({});
    const idx = all.findIndex(r => String(r.id) === String(id) || r.code === id);
    if (idx === -1) return null;

    all[idx] = { ...all[idx], ...sanitizedUpdates, updated_at: new Date().toISOString() };
    writeLocalJson(RESERVAS_FILE, all, (v) => { memoryReservas = v; });
    return all[idx];
  },

  async deleteReservation(id) {
    if (supabaseUrl && supabaseServiceKey) {
      try {
        const isNumeric = !isNaN(Number(id));
        const filterParam = isNumeric ? `id=eq.${id}` : `code=eq.${encodeURIComponent(id)}`;
        const sbRes = await supabaseRequest(
          `/rest/v1/reservations?${filterParam}`,
          'DELETE',
          null,
          { 'Prefer': 'return=representation' },
          true
        );

        if ((sbRes.status === 200 || sbRes.status === 204) && Array.isArray(sbRes.data) && sbRes.data.length > 0) {
          return true;
        }
        if (sbRes.status === 200 && Array.isArray(sbRes.data) && sbRes.data.length === 0) {
          return false; // Registro no existía
        }
      } catch (err) {
        console.error('[DB Error] deleteReservation Supabase:', err.message);
        if (isProduction()) throw err;
      }
    }

    if (pgPool) {
      try {
        const res = await pgPool.query('DELETE FROM reservations WHERE id = $1 OR code = $1 RETURNING *', [id]);
        return res && res.rowCount > 0;
      } catch (err) {
        if (isProduction()) throw err;
      }
    }

    if (isProduction()) {
      return false;
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

    return {
      total: all.length,
      pending: all.filter(r => r.status === 'pending').length,
      confirmed: all.filter(r => r.status === 'confirmed').length,
      cancelled: all.filter(r => r.status === 'cancelled').length,
      todayCount: all.filter(r => r.date === todayStr && r.status !== 'cancelled').length,
      todayGuests: all.filter(r => r.date === todayStr && r.status !== 'cancelled').reduce((acc, cur) => acc + (Number(cur.guests) || 0), 0),
      isCloudDb: this.isCloudDb(),
      provider: this.getProviderName()
    };
  },

  async getMenuItems() {
    if (supabaseUrl) {
      try {
        const sbRes = await supabaseRequest(
          '/rest/v1/menu_items?select=*&order=category,id',
          'GET',
          null,
          {},
          false // Consulta pública
        );
        if (sbRes.status === 200 && Array.isArray(sbRes.data) && sbRes.data.length > 0) {
          return sbRes.data;
        }
      } catch (err) {
        console.warn('[DB Info] getMenuItems Supabase fallback to local:', err.message);
      }
    }

    let items = readLocalJson(CARTA_FILE, memoryCarta);
    if (!memoryCarta) memoryCarta = items;
    return items;
  },

  async updateMenuItem(id, updates) {
    const allowed = ['name', 'price', 'category', 'description', 'image', 'badge', 'available'];
    const sanitized = {};
    for (const k of Object.keys(updates)) {
      if (allowed.includes(k) && updates[k] !== undefined) {
        sanitized[k] = updates[k];
      }
    }

    if (Object.keys(sanitized).length === 0) return null;

    if (supabaseUrl && supabaseServiceKey) {
      try {
        const sbRes = await supabaseRequest(
          `/rest/v1/menu_items?id=eq.${encodeURIComponent(id)}`,
          'PATCH',
          sanitized,
          { 'Prefer': 'return=representation' },
          true
        );
        if ((sbRes.status === 200 || sbRes.status === 204) && Array.isArray(sbRes.data) && sbRes.data[0]) {
          return sbRes.data[0];
        }
      } catch (err) {
        console.error('[DB Error] updateMenuItem Supabase:', err.message);
        if (isProduction()) throw err;
      }
    }

    if (isProduction()) {
      return null;
    }

    const items = await this.getMenuItems();
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) return null;

    items[idx] = { ...items[idx], ...sanitized };
    writeLocalJson(CARTA_FILE, items, (v) => { memoryCarta = v; });
    return items[idx];
  },

  async createMenuItem(data) {
    const baseSlug = (data.name || 'item')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const id = data.id || `${baseSlug || 'producto'}-${Date.now().toString().slice(-5)}`;

    const category = (data.category && typeof data.category === 'string') ? data.category.trim() : 'Cócteles';
    const price = Number(data.price) || 0;
    const badge = data.badge ? String(data.badge).trim().slice(0, 50) : null;
    const description = data.description ? String(data.description).trim().slice(0, 500) : '';
    const available = data.available !== undefined ? Boolean(data.available) : true;
    const image = data.image ? String(data.image).trim().slice(0, 500) : '';

    const record = {
      id,
      category,
      name: String(data.name).trim().slice(0, 120),
      description,
      price,
      badge,
      image,
      available,
      created_at: new Date().toISOString()
    };

    if (supabaseUrl && supabaseServiceKey) {
      try {
        const sbRes = await supabaseRequest(
          '/rest/v1/menu_items',
          'POST',
          record,
          { 'Prefer': 'return=representation' },
          true
        );
        if (sbRes.status === 201 && Array.isArray(sbRes.data) && sbRes.data[0]) {
          return sbRes.data[0];
        } else {
          console.error('[DB Error] createMenuItem Supabase:', sbRes.data || sbRes.status);
          if (isProduction()) throw new Error('MENU_ITEM_CREATION_FAILED');
        }
      } catch (err) {
        console.error('[DB Error] createMenuItem exception:', err.message);
        if (isProduction()) throw err;
      }
    }

    if (isProduction()) {
      throw new Error('No se pudo crear el producto en la base de datos.');
    }

    const items = await this.getMenuItems();
    items.push(record);
    writeLocalJson(CARTA_FILE, items, (v) => { memoryCarta = v; });
    return record;
  },

  async deleteMenuItem(id) {
    if (supabaseUrl && supabaseServiceKey) {
      try {
        const sbRes = await supabaseRequest(
          `/rest/v1/menu_items?id=eq.${encodeURIComponent(id)}`,
          'DELETE',
          null,
          { 'Prefer': 'return=representation' },
          true
        );
        if ((sbRes.status === 200 || sbRes.status === 204) && Array.isArray(sbRes.data) && sbRes.data.length > 0) {
          return true;
        }
        if (sbRes.status === 200 && Array.isArray(sbRes.data) && sbRes.data.length === 0) {
          return false;
        }
      } catch (err) {
        console.error('[DB Error] deleteMenuItem Supabase:', err.message);
        if (isProduction()) throw err;
      }
    }

    if (isProduction()) {
      return false;
    }

    const items = await this.getMenuItems();
    const filtered = items.filter(i => String(i.id) !== String(id));
    if (filtered.length !== items.length) {
      writeLocalJson(CARTA_FILE, filtered, (v) => { memoryCarta = v; });
      return true;
    }

    return false;
  }
};

module.exports = db;
