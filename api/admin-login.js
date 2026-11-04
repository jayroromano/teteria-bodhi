const db = require('../lib/db');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

  const defaultPass = process.env.ADMIN_PASSWORD || 'bodhi2026';

  // GET: Verificar si el token actual sigue siendo válido
  if (req.method === 'GET') {
    const auth = req.headers['authorization'] || '';
    const token = auth.replace('Bearer ', '').trim();
    const isValid = token === defaultPass || token.startsWith('bodhi_token_');
    return res.status(200).json({
      valid: isValid,
      isCloudDb: db.isCloudDb()
    });
  }

  if (req.method === 'POST') {
    const body = await parseBody(req);
    const { password } = body;

    if (!password) {
      return res.status(400).json({ error: 'Por favor introduce la contraseña de administrador.' });
    }

    if (password === defaultPass) {
      const token = `bodhi_token_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 días

      return res.status(200).json({
        success: true,
        message: 'Acceso autorizado al panel de Tetería Bodhi',
        token,
        expiresAt,
        isCloudDb: db.isCloudDb()
      });
    } else {
      return res.status(401).json({
        error: 'Contraseña incorrecta. Por defecto es "bodhi2026" (configurable en variables de entorno).'
      });
    }
  }

  return res.status(405).json({ error: 'Método no permitido.' });
};
