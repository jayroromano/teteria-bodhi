/**
 * Módulo de configuración CORS para Tetería Bodhi
 * Restringe el acceso cross-origin exclusivamente a dominios explícitamente autorizados
 */

function isProductionEnv() {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

function getAllowedOrigins() {
  const envOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const isProd = isProductionEnv();

  // Dominios de producción oficiales autorizados
  const productionOrigins = [
    'https://www.teteriabodhi.es',
    'https://teteriabodhi.es',
    'https://teteria-bodhi.vercel.app'
  ];

  // Dominios de desarrollo local: únicamente permitidos fuera de producción
  const devOrigins = isProd ? [] : [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
  ];

  const defaultOrigins = [...productionOrigins, ...devOrigins];

  // En Vercel Previews, autorizar únicamente el dominio exacto asignado por Vercel a esta instancia
  if (process.env.VERCEL_URL) {
    const exactPreviewDomain = `https://${process.env.VERCEL_URL.toLowerCase().trim()}`;
    defaultOrigins.push(exactPreviewDomain);
  }

  return new Set([...defaultOrigins, ...envOrigins]);
}

function setCors(req, res, methods = 'GET, POST, OPTIONS') {
  const origin = req.headers?.origin;
  const allowed = getAllowedOrigins();

  if (origin) {
    const originLower = origin.toLowerCase().trim();
    // Verificación estricta: únicamente orígenes presentes en la lista autorizada
    if (allowed.has(originLower)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  }

  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Request');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

module.exports = {
  setCors,
  getAllowedOrigins
};
