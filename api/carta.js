const db = require('../lib/db');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

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

    if (req.method === 'POST') {
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'No autorizado para añadir productos a la carta.' });
      }

      const body = await parseBody(req);
      const { name, price, category, image, description, badge } = body;

      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'El nombre del producto es obligatorio.' });
      }

      if (price === undefined || isNaN(Number(price)) || Number(price) < 0) {
        return res.status(400).json({ error: 'El precio debe ser un número válido mayor o igual a 0.' });
      }

      const created = await db.createMenuItem({
        name: String(name).trim(),
        price: Number(price),
        category: category || 'Otro',
        image: image || '',
        description: description || '',
        badge: badge || ''
      });

      return res.status(201).json({ success: true, item: created });
    }

    if (req.method === 'PATCH') {
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'No autorizado para modificar la carta.' });
      }

      const body = await parseBody(req);
      const { id, available, price, name, description, category, image, badge } = body;

      if (!id) {
        return res.status(400).json({ error: 'Se requiere id del producto.' });
      }

      const updated = await db.updateMenuItem(id, { available, price, name, description, category, image, badge });
      if (!updated) {
        return res.status(404).json({ error: 'Producto no encontrado.' });
      }

      return res.status(200).json({ success: true, item: updated });
    }

    if (req.method === 'DELETE') {
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'No autorizado para eliminar productos de la carta.' });
      }

      const body = await parseBody(req);
      const url = new URL(req.url, 'http://localhost');
      const id = req.query?.id || url.searchParams.get('id') || body?.id;

      if (!id) {
        return res.status(400).json({ error: 'Se requiere el id del producto a eliminar.' });
      }

      const success = await db.deleteMenuItem(id);
      return res.status(200).json({ success, deletedId: id });
    }

    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (error) {
    console.error('Error en /api/carta:', error);
    return res.status(500).json({ error: 'Error interno obteniendo la carta.', details: error.message });
  }
};
