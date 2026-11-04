const db = require('./db');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
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

function isAdmin(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  const validPass = process.env.ADMIN_PASSWORD || 'bodhi2026';
  return token === validPass || token.startsWith('bodhi_token_');
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const items = await db.getMenuItems();
      return res.status(200).json({ success: true, items });
    }

    if (req.method === 'PATCH') {
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'No autorizado para modificar la carta.' });
      }

      const body = await parseBody(req);
      const { id, available, price, name, description } = body;

      if (!id) {
        return res.status(400).json({ error: 'Se requiere id del producto.' });
      }

      const updated = await db.updateMenuItem(id, { available, price, name, description });
      if (!updated) {
        return res.status(404).json({ error: 'Producto no encontrado.' });
      }

      return res.status(200).json({ success: true, item: updated });
    }

    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (error) {
    console.error('Error en /api/carta:', error);
    return res.status(500).json({ error: 'Error interno obteniendo la carta.', details: error.message });
  }
};
