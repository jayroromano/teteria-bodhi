const fs = require('fs');
const path = require('path');
const { setCors } = require('../lib/cors');

function findBusinessesDir() {
  const candidates = [
    path.join(process.cwd(), 'businesses'),
    path.join(__dirname, '..', 'businesses'),
    path.join(process.cwd(), 'public', 'businesses'),
    path.join(__dirname, '..', 'public', 'businesses')
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

function getAvailableBusinesses() {
  const dir = findBusinessesDir();
  const list = [];
  try {
    if (fs.existsSync(dir)) {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        // Ignorar carpetas ocultas o de sistema
        if (item.startsWith('.')) continue;
        const confPath = path.join(dir, item, 'config.json');
        if (fs.existsSync(confPath)) {
          try {
            const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
            list.push({
              slug: conf.identity?.slug || item,
              name: conf.identity?.name || item,
              category: conf.identity?.categoryLabel || '',
              emoji: conf.identity?.logoEmoji || '🏢'
            });
          } catch (e) {}
        }
      }
    }
  } catch (e) {}
  return list;
}

module.exports = async function handler(req, res) {
  setCors(req, res, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido. Este endpoint solo acepta consultas GET.' });
  }

  try {
    const url = new URL(req.url, 'http://localhost');
    const requestedSlug = req.query?.b || url.searchParams.get('b') || process.env.ACTIVE_BUSINESS || 'bodhi';
    const cleanSlug = String(requestedSlug).toLowerCase().replace(/[^a-z0-9_-]/g, '');

    const dir = findBusinessesDir();
    const available = getAvailableBusinesses();

    let targetSlug = cleanSlug;
    let confPath = path.join(dir, targetSlug, 'config.json');
    let catPath = path.join(dir, targetSlug, 'catalog.json');

    if (!fs.existsSync(confPath)) {
      targetSlug = 'bodhi';
      confPath = path.join(dir, 'bodhi', 'config.json');
      catPath = path.join(dir, 'bodhi', 'catalog.json');
    }

    let config = null;
    let catalog = [];

    if (fs.existsSync(confPath)) {
      config = JSON.parse(fs.readFileSync(confPath, 'utf8'));
    }
    if (fs.existsSync(catPath)) {
      catalog = JSON.parse(fs.readFileSync(catPath, 'utf8'));
    }

    if (!config) {
      return res.status(404).json({ error: 'Configuración de negocio no encontrada.' });
    }

    // Respuesta pública estructurada para el frontend
    return res.status(200).json({
      success: true,
      activeSlug: targetSlug,
      config,
      catalog,
      availableBusinesses: available
    });
  } catch (error) {
    console.error('[API Business-Config Error]:', error.message);
    return res.status(500).json({ error: 'Error interno obteniendo la configuración del negocio.' });
  }
};
