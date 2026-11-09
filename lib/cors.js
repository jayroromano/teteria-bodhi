/**
 * Módulo de configuración CORS para Tetería Bodhi
 * Restringe el acceso cross-origin a dominios autorizados
 */

function getAllowedOrigins() {
  const envOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const defaultOrigins = [
    'https://teteria-bodhi.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
  ];

  return new Set([...defaultOrigins, ...envOrigins]);
}

function setCors(req, res, methods = 'GET, POST, OPTIONS') {
  const origin = req.headers?.origin;
  const allowed = getAllowedOrigins();

  if (origin) {
    const originLower = origin.toLowerCase();
    const isVercelPreview = originLower.endsWith('.vercel.app');
    const isLocalhost = originLower.startsWith('http://localhost:') || originLower.startsWith('http://127.0.0.1:');
    const isAllowed = allowed.has(originLower) || isVercelPreview || isLocalhost;

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  }

  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

module.exports = {
  setCors,
  getAllowedOrigins
};
