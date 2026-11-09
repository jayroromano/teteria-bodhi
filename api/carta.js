const db = require('../lib/db');
const { verifyToken } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const fs = require('fs');
const path = require('path');

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

module.exports = async function handler(req, res) {
  setCors(req, res, 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: Consulta pública de la carta
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const b = req.query?.b || url.searchParams.get('b');
      if (b && b !== 'bodhi') {
        const cleanB = String(b).toLowerCase().replace(/[^a-z0-9_-]/g, '');
        const candidates = [
          path.join(process.cwd(), 'businesses', cleanB, 'catalog.json'),
          path.join(__dirname, '..', 'businesses', cleanB, 'catalog.json'),
          path.join(process.cwd(), 'public', 'businesses', cleanB, 'catalog.json')
        ];
        for (const catPath of candidates) {
          if (fs.existsSync(catPath)) {
            try {
              const customItems = JSON.parse(fs.readFileSync(catPath, 'utf8'));
              return res.status(200).json({ success: true, items: customItems, business: cleanB });
            } catch (e) {}
          }
        }
      }

      const items = await db.getMenuItems();
      return res.status(200).json({ success: true, items });
    }

    // POST: Añadir nuevo producto (Requiere autenticación admin)
    if (req.method === 'POST') {
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'No autorizado para añadir productos a la carta.' });
      }

      const body = await parseBody(req);
      const { name, price, category, image, description, badge, available } = body;

      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        return res.status(400).json({ error: 'El nombre del producto es obligatorio (mínimo 2 caracteres).' });
      }

      const numPrice = Number(price);
      if (price === undefined || isNaN(numPrice) || numPrice < 0 || numPrice > 1000) {
        return res.status(400).json({ error: 'El precio debe ser un número válido entre 0 y 1000 €.' });
      }

      const cleanCategory = category && typeof category === 'string' ? category.trim().slice(0, 60) : 'Cócteles';
      const cleanDescription = description && typeof description === 'string' ? description.trim().slice(0, 500) : '';
      const cleanImage = image && typeof image === 'string' ? image.trim().slice(0, 500) : '';
      const cleanBadge = badge && typeof badge === 'string' ? badge.trim().slice(0, 50) : null;
      const isAvailable = available !== undefined ? Boolean(available) : true;

      const created = await db.createMenuItem({
        name: name.trim().slice(0, 120),
        price: numPrice,
        category: cleanCategory,
        image: cleanImage,
        description: cleanDescription,
        badge: cleanBadge,
        available: isAvailable
      });

      return res.status(201).json({ success: true, item: created });
    }

    // PATCH: Modificar disponibilidad, precio u otros datos del producto (Admin)
    if (req.method === 'PATCH') {
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'No autorizado para modificar la carta.' });
      }

      const body = await parseBody(req);
      const { id, available, price, name, description, category, image, badge } = body;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Se requiere id del producto.' });
      }

      const updates = {};
      if (available !== undefined) updates.available = Boolean(available);
      if (price !== undefined && !isNaN(Number(price)) && Number(price) >= 0) updates.price = Number(price);
      if (name && typeof name === 'string') updates.name = name.trim().slice(0, 120);
      if (description !== undefined && typeof description === 'string') updates.description = description.trim().slice(0, 500);
      if (category && typeof category === 'string') updates.category = category.trim().slice(0, 60);
      if (image !== undefined && typeof image === 'string') updates.image = image.trim().slice(0, 500);
      if (badge !== undefined) updates.badge = badge ? String(badge).trim().slice(0, 50) : null;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No se enviaron campos válidos para actualizar.' });
      }

      const updated = await db.updateMenuItem(id, updates);
      if (!updated) {
        return res.status(404).json({ error: 'Producto no encontrado.' });
      }

      return res.status(200).json({ success: true, item: updated });
    }

    // DELETE: Eliminar producto de la carta (Admin)
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
      if (!success) {
        return res.status(404).json({ error: 'Producto no encontrado o no se pudo eliminar.' });
      }

      return res.status(200).json({ success: true, deletedId: id });
    }

    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (error) {
    console.error('[API Carta Error]:', error.message);
    return res.status(500).json({ error: 'Error procesando la solicitud de la carta.' });
  }
};
