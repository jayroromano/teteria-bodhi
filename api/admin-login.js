const db = require('../lib/db');
const { generateToken, verifyToken, checkRateLimit } = require('../lib/auth');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function getClientIp(req) {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) return xForwardedFor.split(',')[0].trim();
  return req.socket?.remoteAddress || '127.0.0.1';
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
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

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const clientIp = getClientIp(req);
  const defaultPass = process.env.ADMIN_PASSWORD || 'bodhi2026';

  // GET: Verificar si el token actual sigue siendo válido criptográficamente
  if (req.method === 'GET') {
    const auth = req.headers['authorization'] || '';
    const isValid = verifyToken(auth);
    return res.status(200).json({
      valid: isValid,
      isCloudDb: db.isCloudDb()
    });
  }

  if (req.method === 'POST') {
    // Protección contra fuerza bruta: máx 5 intentos cada 5 minutos por IP
    if (!checkRateLimit(`login_${clientIp}`, 5, 5 * 60 * 1000)) {
      return res.status(429).json({
        error: 'Demasiados intentos fallidos. Por seguridad, espera 5 minutos antes de volver a intentar.'
      });
    }

    const body = await parseBody(req);
    const { password } = body;

    if (!password) {
      return res.status(400).json({ error: 'Por favor introduce la contraseña de administrador.' });
    }

    if (password === defaultPass) {
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      return res.status(200).json({
        success: true,
        message: 'Acceso autorizado al panel de Tetería Bodhi',
        token,
        expiresAt,
        isCloudDb: db.isCloudDb()
      });
    } else {
      return res.status(401).json({
        error: 'Contraseña incorrecta.'
      });
    }
  }

  return res.status(405).json({ error: 'Método no permitido.' });
};
