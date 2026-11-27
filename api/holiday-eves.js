const db = require('../lib/db');
const { verifyToken, extractSessionToken, isTokenRevoked, validateAdminOrigin, validateCsrfProtection } = require('../lib/auth');
const { setCors } = require('../lib/cors');

async function isAdmin(req) {
  const { token, source } = extractSessionToken(req);
  if (!token) return false;
  if (!verifyToken(token)) return false;
  if (!validateAdminOrigin(req)) return false;
  if (source === 'cookie' && !validateCsrfProtection(req)) return false;
  try {
    const isRevoked = await isTokenRevoked(token);
    if (isRevoked) return false;
  } catch (err) {
    // FAIL-CLOSED: Si el servicio centralizado de revocación falla, se deniega el acceso administrativo
    return false;
  }
  return true;
}

function getTodayInSpain() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
}

function shiftIsoDate(isoDate, deltaDays) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function getYesterdayInSpain() {
  return shiftIsoDate(getTodayInSpain(), -1);
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
  setCors(req, res, 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      // Incluye desde ayer en Europe/Madrid para cubrir madrugadas activas hasta las 03:00.
      const holidayEves = await db.getHolidayEves(getYesterdayInSpain());
      return res.status(200).json({ success: true, holidayEves, setupRequired: !db.areHolidayEvesReady() });
    }

    if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) {
      return res.status(405).json({ error: 'Método no permitido.' });
    }
    if (!(await isAdmin(req))) {
      return res.status(401).json({ error: 'No autorizado. Se requiere acceso de administrador.' });
    }

    const body = (req.method === 'POST' || req.method === 'PATCH') ? await readBody(req) : {};

    if (req.method === 'POST') {
      const date = String(body.date || '').trim();
      if (!validateDate(date, true)) {
        return res.status(400).json({ error: 'Indica una fecha válida que no haya pasado.' });
      }
      const label = typeof body.label === 'string' && body.label.trim()
        ? body.label.trim().slice(0, 160)
        : 'Víspera de festivo';
      const holidayEve = await db.createHolidayEve(date, label);
      return res.status(201).json({ success: true, holidayEve });
    }

    if (req.method === 'PATCH') {
      const oldDate = String(body.oldDate || body.date || '').trim();
      const newDate = String(body.newDate || oldDate).trim();
      if (!validateDate(oldDate, false)) {
        return res.status(400).json({ error: 'Indica la fecha original válida a corregir.' });
      }
      const allowSameDate = newDate === oldDate;
      if (!validateDate(newDate, !allowSameDate)) {
        return res.status(400).json({ error: 'La nueva fecha debe ser válida y no haber pasado.' });
      }
      const label = typeof body.label === 'string' && body.label.trim()
        ? body.label.trim().slice(0, 160)
        : 'Víspera de festivo';
      const holidayEve = await db.updateHolidayEve(oldDate, newDate, label);
      if (!holidayEve) return res.status(404).json({ error: 'No se encontró esa víspera de festivo.' });
      return res.status(200).json({ success: true, holidayEve });
    }

    const date = String(
      req.query?.date || new URL(req.url, 'http://localhost').searchParams.get('date') || ''
    ).trim();
    if (!validateDate(date, false)) {
      return res.status(400).json({ error: 'Indica una fecha válida.' });
    }
    const deleted = await db.deleteHolidayEve(date);
    if (!deleted) return res.status(404).json({ error: 'No se encontró esa víspera de festivo.' });
    return res.status(200).json({ success: true });
  } catch (error) {
    if (error.message === 'HOLIDAY_EVE_EXISTS') {
      return res.status(409).json({ error: 'Ya existe una víspera de festivo marcada para esa fecha.' });
    }
    if (error.message === 'HOLIDAY_EVES_TABLE_MISSING') {
      return res.status(503).json({ error: 'Falta crear la tabla de vísperas de festivo en Supabase. Ejecuta holiday_eves.sql.' });
    }
    console.error('[API Holiday-Eves Error]:', error.message);
    return res.status(500).json({ error: 'No se pudieron consultar o guardar las vísperas de festivo.' });
  }
};

module.exports.validateDate = validateDate;
module.exports.getTodayInSpain = getTodayInSpain;
module.exports.getYesterdayInSpain = getYesterdayInSpain;
