const db = require('../lib/db');
const { verifyToken } = require('../lib/auth');
const { setCors } = require('../lib/cors');

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (!req.on || typeof req.on !== 'function') return Promise.resolve({});
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

function isAdmin(req) {
  const auth = req.headers['authorization'] || '';
  return verifyToken(auth);
}

function todayInSpain() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
}

/**
 * Valida una fecha de cierre: formato YYYY-MM-DD, fecha real y no pasada.
 */
function validateClosedDate(dateStr) {
  if (typeof dateStr !== 'string') {
    return { valid: false, error: 'La fecha es obligatoria.' };
  }
  const cleanDate = dateStr.trim();
  const match = cleanDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return { valid: false, error: 'Formato de fecha inválido. Utilice YYYY-MM-DD.' };
  }

  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);
  const calendarDate = new Date(Date.UTC(y, m - 1, d));
  if (calendarDate.getUTCFullYear() !== y || calendarDate.getUTCMonth() !== m - 1 || calendarDate.getUTCDate() !== d) {
    return { valid: false, error: 'La fecha indicada no existe en el calendario.' };
  }

  if (cleanDate < todayInSpain()) {
    return { valid: false, error: 'No se puede bloquear una fecha pasada.' };
  }

  return { valid: true, cleanDate };
}

function validateReason(reason) {
  if (typeof reason !== 'string') {
    return { valid: false, error: 'El motivo es obligatorio.' };
  }
  const cleanReason = reason.trim().replace(/\s+/g, ' ');
  if (cleanReason.length < 3 || cleanReason.length > 120) {
    return { valid: false, error: 'El motivo debe tener entre 3 y 120 caracteres.' };
  }
  return { valid: true, cleanReason };
}

module.exports = async function handler(req, res) {
  setCors(req, res, 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { method, query } = req;

  try {
    // GET: consulta pública de los próximos días sin reservas online
    if (method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      const all = await db.getClosedDates();
      const today = todayInSpain();
      const closedDates = all
        .filter(d => d && typeof d.date === 'string' && d.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date));

      return res.status(200).json({ success: true, closedDates });
    }

    // POST: bloquear las reservas online de un día (solo administradores)
    if (method === 'POST') {
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'No autorizado para bloquear reservas.' });
      }

      const body = await parseBody(req);
      const dateCheck = validateClosedDate(body.date);
      if (!dateCheck.valid) {
        return res.status(400).json({ error: dateCheck.error });
      }

      const reasonCheck = validateReason(body.reason);
      if (!reasonCheck.valid) {
        return res.status(400).json({ error: reasonCheck.error });
      }

      const existing = await db.getClosedDate(dateCheck.cleanDate);
      if (existing) {
        return res.status(409).json({ error: 'Ese día ya está bloqueado para reservas online.' });
      }

      const created = await db.addClosedDate(dateCheck.cleanDate, reasonCheck.cleanReason);
      if (!created) {
        return res.status(409).json({ error: 'Ese día ya está bloqueado para reservas online.' });
      }

      return res.status(201).json({ success: true, closedDate: created });
    }

    // DELETE: volver a permitir reservas online ese día (solo administradores)
    if (method === 'DELETE') {
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'No autorizado para volver a permitir reservas.' });
      }

      const body = await parseBody(req);
      const url = new URL(req.url, 'http://localhost');
      const id = body.id || query?.id || url.searchParams.get('id');

      if (!id) {
        return res.status(400).json({ error: 'Se requiere el id del día bloqueado.' });
      }

      const deleted = await db.deleteClosedDate(id);
      if (!deleted) {
        return res.status(404).json({ error: 'No se encontró ese día bloqueado.' });
      }

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (err) {
    console.error('[closed-dates] Error:', err.message);
    return res.status(503).json({
      error: 'No se pudieron gestionar los días sin reservas online. Comprueba que la tabla "closed_dates" existe en Supabase.'
    });
  }
};
