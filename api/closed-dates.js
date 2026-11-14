const db = require('../lib/db');
const { verifyToken } = require('../lib/auth');
const { setCors } = require('../lib/cors');

function isAdmin(req) {
  return verifyToken(req.headers?.authorization || '');
}

function getTodayInSpain() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
}

function validateDate(value, requireCurrentOrFuture = true) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  return !requireCurrentOrFuture || value >= getTodayInSpain();
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (!req.on) return {};
  return new Promise(resolve => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); }
    });
  });
}

module.exports = async function handler(req, res) {
  setCors(req, res, 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const closedDates = await db.getClosedDates(getTodayInSpain());
      return res.status(200).json({ success: true, closedDates, setupRequired: !db.areClosedDatesReady() });
    }

    if (req.method !== 'POST' && req.method !== 'DELETE') {
      return res.status(405).json({ error: 'Método no permitido.' });
    }
    if (!isAdmin(req)) return res.status(401).json({ error: 'No autorizado. Se requiere acceso de administrador.' });

    const body = req.method === 'POST' ? await readBody(req) : {};
    const date = String(req.method === 'DELETE' ? (req.query?.date || new URL(req.url, 'http://localhost').searchParams.get('date') || '') : (body.date || '')).trim();
    if (!validateDate(date, req.method === 'POST')) {
      return res.status(400).json({ error: 'Indica una fecha válida que no haya pasado.' });
    }

    if (req.method === 'POST') {
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 160) : '';
      if (reason.length < 2) return res.status(400).json({ error: 'Escribe un motivo de al menos 2 caracteres.' });
      const closedDate = await db.createClosedDate(date, reason);
      return res.status(201).json({ success: true, closedDate });
    }

    const deleted = await db.deleteClosedDate(date);
    if (!deleted) return res.status(404).json({ error: 'No se encontró ese día cerrado.' });
    return res.status(200).json({ success: true });
  } catch (error) {
    if (error.message === 'CLOSED_DATE_EXISTS') return res.status(409).json({ error: 'Ya existe un día cerrado para esa fecha.' });
    if (error.message === 'CLOSED_DATES_TABLE_MISSING') {
      return res.status(503).json({ error: 'Falta crear la tabla de días cerrados en Supabase. Ejecuta el SQL de configuración.' });
    }
    console.error('[API Closed-Dates Error]:', error.message);
    return res.status(500).json({ error: 'No se pudieron consultar o guardar los días cerrados.' });
  }
};

module.exports.validateDate = validateDate;
