const fs = require('fs');
const path = require('path');
const https = require('https');
const { Pool } = require('pg');
const parse = require('pg-connection-string').parse;

// Cargar variables de entorno si existen (.env en local)
try {
  require('dotenv').config();
} catch (e) {}

// ========================================================
// 1. CONFIGURACIÓN SUPABASE (REST API)
// ========================================================
const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://vgvijpknawgrjctywywq.supabase.co';

const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_publishable_xYooorkCMJ_DeC5beMPfmA_r1KUBIJO';

function supabaseRequest(pathname, method = 'GET', body = null, extraHeaders = {}) {
  if (!supabaseUrl || !supabaseKey) return Promise.resolve({ status: 0, error: 'No Supabase credentials' });
  return new Promise((resolve, reject) => {
    try {
      const fullUrl = new URL(pathname, supabaseUrl);
      const headers = {
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey,
        'Content-Type': 'application/json',
        ...extraHeaders
      };
      const req = https.request(fullUrl, { method, headers, timeout: 8000 }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
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
// 2. CONFIGURACIÓN POSTGRESQL TCP (FALLBACK ADICIONAL)
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

    pgPool = new Pool({
      ...parsed,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 3
    });

    pgPool.on('error', (err) => {
      console.warn('[PostgreSQL Pool Warning]:', err.message);
      lastDbError = err.message;
    });
  } catch (err) {
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

const db = {
  isCloudDb() {
    return Boolean(supabaseUrl && supabaseKey) || Boolean(pgPool);
  },

  getProviderName() {
    if (supabaseUrl && supabaseKey) return 'Supabase Cloud (REST API)';
    if (pgPool) return 'PostgreSQL TCP Pool';
    return 'Local JSON / Memoria';
  },

  getLastError() {
    return lastDbError;
  },

  getSupabaseConfig() {
    return {
      url: supabaseUrl,
      keyMasked: supabaseKey ? `${supabaseKey.substring(0, 14)}...` : null,
      projectRef: 'vgvijpknawgrjctywywq',
      sqlEditorUrl: 'https://supabase.com/dashboard/project/vgvijpknawgrjctywywq/sql/new'
    };
  },

  async testCloudConnection() {
    // 1. Probar Supabase REST API
    if (supabaseUrl && supabaseKey) {
      try {
        const sbRes = await supabaseRequest('/rest/v1/reservations?select=count', 'GET', null, {
          'Prefer': 'count=exact',
          'Range-Unit': 'items'
        });

        if (sbRes.status === 200 || sbRes.status === 206) {
          lastDbError = null;
          return {
            ok: true,
            provider: 'Supabase Cloud (REST)',
            projectUrl: supabaseUrl,
            reservationsCount: Array.isArray(sbRes.data) ? sbRes.data.length : 0,
            tableReady: true
          };
        } else if (sbRes.status === 404 && sbRes.data?.code === 'PGRST205') {
          lastDbError = "Falta crear la tabla 'reservations' en tu panel de Supabase.";
          return {
            ok: false,
            provider: 'Supabase Cloud (REST)',
            projectUrl: supabaseUrl,
            tableReady: false,
            error: "Falta crear la tabla 'reservations' en Supabase. Abre el SQL Editor y ejecuta el script.",
            code: 'TABLE_NOT_FOUND',
            sqlEditorUrl: 'https://supabase.com/dashboard/project/vgvijpknawgrjctywywq/sql/new'
          };
        } else {
          const err = sbRes.data?.message || sbRes.raw || `HTTP ${sbRes.status}`;
          lastDbError = err;
          return {
            ok: false,
            provider: 'Supabase Cloud',
            error: err
          };
        }
      } catch (e) {
        lastDbError = e.message;
        return { ok: false, provider: 'Supabase Cloud', error: e.message };
      }
    }

    // 2. Probar PostgreSQL TCP si existe
    if (pgPool) {
      try {
        const client = await pgPool.connect();
        try {
          const res = await client.query('SELECT NOW() as now, current_database() as db, count(*) as count FROM reservations');
          lastDbError = null;
          return {
            ok: true,
            provider: 'PostgreSQL TCP',
            now: res.rows[0].now,
            database: res.rows[0].db,
            reservationsCount: parseInt(res.rows[0].count, 10),
            tableReady: true
          };
        } finally {
          client.release();
        }
      } catch (err) {
        lastDbError = err.message;
        return { ok: false, provider: 'PostgreSQL TCP', error: err.message };
      }
    }

    return {
      ok: false,
      error: 'No se han detectado credenciales de base de datos.'
    };
  },

  async getReservations(filters = {}) {
    // 1. Supabase REST API
    if (supabaseUrl && supabaseKey) {
      try {
        let queryParams = ['select=*', 'order=date.desc,time.asc,id.desc'];
        if (filters.status && filters.status !== 'all') {
          queryParams.push(`status=eq.${encodeURIComponent(filters.status)}`);
        }
        if (filters.date) {
          queryParams.push(`date=eq.${encodeURIComponent(filters.date)}`);
        }
        if (filters.search) {
          const q = encodeURIComponent(filters.search);
          queryParams.push(`or=(name.ilike.*${q}*,phone.like.*${q}*,code.ilike.*${q}*)`);
        }

        const sbRes = await supabaseRequest(`/rest/v1/reservations?${queryParams.join('&')}`, 'GET');
        if (sbRes.status === 200 && Array.isArray(sbRes.data)) {
          lastDbError = null;
          return sbRes.data;
        } else {
          lastDbError = sbRes.data?.message || `HTTP ${sbRes.status}`;
          console.warn('[Supabase Fallback] getReservations:', lastDbError);
        }
      } catch (err) {
        lastDbError = err.message;
        console.warn('[Supabase Fallback] getReservations:', err.message);
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
        lastDbError = err.message;
      }
    }

    // 3. Fallback Local
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

    // 1. Intentar guardar en Supabase REST API
    if (supabaseUrl && supabaseKey) {
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
        });
        if (sbRes.status === 201 && Array.isArray(sbRes.data) && sbRes.data[0]) {
          console.log(`[Supabase] Reserva ${record.code} guardada con éxito en la nube.`);
          const saved = sbRes.data[0];
          saved.isCloudDb = true;
          saved.provider = 'Supabase Cloud';
          return saved;
        } else {
          const errMsg = sbRes.data?.message || sbRes.raw || `HTTP ${sbRes.status}`;
          lastDbError = `Supabase: ${errMsg}`;
          console.warn('[Supabase Fallback] Error guardando reserva:', lastDbError);
        }
      } catch (err) {
        lastDbError = `Supabase: ${err.message}`;
        console.warn('[Supabase Fallback] Error guardando reserva:', err.message);
      }
    }

    // 2. Intentar guardar en PostgreSQL TCP si está configurado
    if (pgPool) {
      try {
        const res = await pgPool.query(
          `INSERT INTO reservations (code, name, phone, email, date, time, guests, zone, notes, status, admin_notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [record.code, record.name, record.phone, record.email, record.date, record.time, record.guests, record.zone, record.notes, record.status, record.admin_notes]
        );
        if (res && res.rows && res.rows[0]) {
          console.log(`[PostgreSQL] Reserva ${record.code} guardada en Postgres.`);
          const saved = res.rows[0];
          saved.isCloudDb = true;
          saved.provider = 'PostgreSQL TCP';
          return saved;
        }
      } catch (err) {
        lastDbError = err.message;
      }
    }

    // 3. Fallback Local seguro (en caso de que la tabla aún no esté creada en Supabase)
    const all = await this.getReservations({});
    const newId = `res_${Date.now()}`;
    const newRes = { id: newId, ...record, isCloudDb: false, provider: 'Local Fallback' };
    all.unshift(newRes);
    writeLocalJson(RESERVAS_FILE, all, (v) => { memoryReservas = v; });
    console.log(`[Storage] Reserva ${record.code} guardada en respaldo local/memoria temporal.`);
    return newRes;
  },

  async updateReservation(id, updates) {
    if (supabaseUrl && supabaseKey) {
      try {
        const isNumeric = !isNaN(Number(id));
        const filterParam = isNumeric ? `id=eq.${id}` : `code=eq.${encodeURIComponent(id)}`;
        const sbRes = await supabaseRequest(`/rest/v1/reservations?${filterParam}`, 'PATCH', updates, {
          'Prefer': 'return=representation'
        });
        if ((sbRes.status === 200 || sbRes.status === 204) && Array.isArray(sbRes.data) && sbRes.data[0]) {
          return sbRes.data[0];
        }
      } catch (err) {
        console.warn('[Supabase Fallback] updateReservation:', err.message);
      }
    }

    if (pgPool) {
      try {
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
      } catch (err) {}
    }

    const all = await this.getReservations({});
    const idx = all.findIndex(r => String(r.id) === String(id) || r.code === id);
    if (idx === -1) return null;

    all[idx] = { ...all[idx], ...updates, updated_at: new Date().toISOString() };
    writeLocalJson(RESERVAS_FILE, all, (v) => { memoryReservas = v; });
    return all[idx];
  },

  async deleteReservation(id) {
    if (supabaseUrl && supabaseKey) {
      try {
        const isNumeric = !isNaN(Number(id));
        const filterParam = isNumeric ? `id=eq.${id}` : `code=eq.${encodeURIComponent(id)}`;
        const sbRes = await supabaseRequest(`/rest/v1/reservations?${filterParam}`, 'DELETE');
        if (sbRes.status === 200 || sbRes.status === 204) {
          return true;
        }
      } catch (err) {}
    }

    if (pgPool) {
      try {
        const res = await pgPool.query('DELETE FROM reservations WHERE id = $1 OR code = $1 RETURNING *', [id]);
        return res.rowCount > 0;
      } catch (err) {}
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
      isCloudDb: this.isCloudDb(),
      provider: this.getProviderName()
    };
    return stats;
  },

  async getMenuItems() {
    if (supabaseUrl && supabaseKey) {
      try {
        const sbRes = await supabaseRequest('/rest/v1/menu_items?select=*&order=category,id', 'GET');
        if (sbRes.status === 200 && Array.isArray(sbRes.data) && sbRes.data.length > 0) {
          return sbRes.data;
        }
      } catch (err) {}
    }

    let items = readLocalJson(CARTA_FILE, memoryCarta);
    if (!memoryCarta) memoryCarta = items;
    return items;
  },

  async updateMenuItem(id, updates) {
    if (supabaseUrl && supabaseKey) {
      try {
        const sbRes = await supabaseRequest(`/rest/v1/menu_items?id=eq.${encodeURIComponent(id)}`, 'PATCH', updates, {
          'Prefer': 'return=representation'
        });
        if ((sbRes.status === 200 || sbRes.status === 204) && Array.isArray(sbRes.data) && sbRes.data[0]) {
          return sbRes.data[0];
        }
      } catch (err) {}
    }

    const items = await this.getMenuItems();
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) return null;

    items[idx] = { ...items[idx], ...updates };
    writeLocalJson(CARTA_FILE, items, (v) => { memoryCarta = v; });
    return items[idx];
  },

  async createMenuItem(data) {
    // Generar ID único limpio tipo slug
    const baseSlug = (data.name || 'item')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const id = data.id || `${baseSlug || 'producto'}-${Date.now().toString().slice(-5)}`;

    // Categoría del producto
    let category = (data.category && typeof data.category === 'string') ? data.category.trim() : 'Cócteles';

    // Foto por defecto de alta calidad si no se indica una URL
    let image = (data.image && typeof data.image === 'string') ? data.image.trim() : '';
    if (!image) {
      if (category === 'Cócteles') {
        image = 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=400&q=80';
      } else if (category === 'Tés') {
        image = 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=400&q=80';
      } else {
        image = 'https://images.unsplash.com/photo-1519869325930-281384150729?auto=format&fit=crop&w=400&q=80';
      }
    }

    const price = Number(data.price) || 0;
    const badge = data.badge ? String(data.badge).trim() : null;
    const description = data.description ? String(data.description).trim() : '';
    const available = data.available !== undefined ? Boolean(data.available) : true;

    const record = {
      id,
      category,
      name: String(data.name).trim(),
      description,
      price,
      badge,
      image,
      available,
      created_at: new Date().toISOString()
    };

    // 1. Supabase REST API
    if (supabaseUrl && supabaseKey) {
      try {
        const payload = {
          id: record.id,
          category: record.category,
          name: record.name,
          description: record.description,
          price: record.price,
          badge: record.badge,
          image: record.image,
          available: record.available
        };
        const sbRes = await supabaseRequest('/rest/v1/menu_items', 'POST', payload, {
          'Prefer': 'return=representation'
        });
        if (sbRes.status === 201 && Array.isArray(sbRes.data) && sbRes.data[0]) {
          console.log(`[Supabase] Producto '${record.name}' guardado con éxito.`);
          const localItems = readLocalJson(CARTA_FILE, memoryCarta);
          localItems.push(sbRes.data[0]);
          writeLocalJson(CARTA_FILE, localItems, (v) => { memoryCarta = v; });
          return sbRes.data[0];
        } else {
          console.warn('[Supabase Fallback] Error createMenuItem:', sbRes.data?.message || sbRes.status);
        }
      } catch (err) {
        console.warn('[Supabase Fallback] Error createMenuItem:', err.message);
      }
    }

    // 2. PostgreSQL TCP
    if (pgPool) {
      try {
        const res = await pgPool.query(
          `INSERT INTO menu_items (id, category, name, description, price, badge, image, available)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [record.id, record.category, record.name, record.description, record.price, record.badge, record.image, record.available]
        );
        if (res && res.rows && res.rows[0]) {
          const localItems = readLocalJson(CARTA_FILE, memoryCarta);
          localItems.push(res.rows[0]);
          writeLocalJson(CARTA_FILE, localItems, (v) => { memoryCarta = v; });
          return res.rows[0];
        }
      } catch (err) {
        console.warn('[PostgreSQL Fallback] Error createMenuItem:', err.message);
      }
    }

    // 3. Fallback Local JSON & Memoria
    const items = await this.getMenuItems();
    items.push(record);
    writeLocalJson(CARTA_FILE, items, (v) => { memoryCarta = v; });
    return record;
  },

  async deleteMenuItem(id) {
    let deleted = false;
    // 1. Supabase
    if (supabaseUrl && supabaseKey) {
      try {
        const sbRes = await supabaseRequest(`/rest/v1/menu_items?id=eq.${encodeURIComponent(id)}`, 'DELETE');
        if (sbRes.status === 200 || sbRes.status === 204) {
          deleted = true;
        }
      } catch (err) {
        console.warn('[Supabase Fallback] deleteMenuItem:', err.message);
      }
    }

    // 2. PostgreSQL TCP
    if (pgPool) {
      try {
        const res = await pgPool.query('DELETE FROM menu_items WHERE id = $1', [id]);
        if (res && res.rowCount > 0) deleted = true;
      } catch (err) {}
    }

    // 3. Local JSON & Memoria
    const items = await this.getMenuItems();
    const filtered = items.filter(i => String(i.id) !== String(id));
    if (filtered.length !== items.length) {
      writeLocalJson(CARTA_FILE, filtered, (v) => { memoryCarta = v; });
      deleted = true;
    }

    return deleted;
  }
};

module.exports = db;
