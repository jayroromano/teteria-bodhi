/**
 * Módulo de configuración CORS para Tetería Bodhi
 * Restringe el acceso cross-origin exclusivamente a dominios explícitamente autorizados
 */

function isProductionEnv() {
  if (process.env.VERCEL_ENV) {
    return process.env.VERCEL_ENV.toLowerCase().trim() === 'production';
  }
  return process.env.NODE_ENV === 'production';
}

function isPreviewEnv() {
  const vercelEnv = (process.env.VERCEL_ENV || '').toLowerCase().trim();
  if (vercelEnv === 'preview') {
    return true;
  }
  if (vercelEnv === 'production') {
    return false;
  }
  // En Vercel, si no está definido VERCEL_ENV pero estamos en runtime de Vercel con URL de preview
  const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
  if (isVercel && (process.env.VERCEL_BRANCH_URL || (process.env.VERCEL_URL && !process.env.VERCEL_URL.includes('teteria-bodhi.vercel.app')))) {
    return true;
  }
  return false;
}

function sanitizeDomain(domain) {
  if (!domain || typeof domain !== 'string') return null;
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return clean || null;
}

function getAllowedOrigins(req = null) {
  const isProd = isProductionEnv();
  const isPreview = isPreviewEnv();

  const envOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .filter(origin => {
      if (isProd || isPreview) {
        // En producción y preview, prohibir orígenes inseguros (http) y localhost
        if (origin.startsWith('http://') || origin.includes('localhost') || origin.includes('127.0.0.1')) {
          return false;
        }
      }
      return true;
    });

  // Dominios de producción oficiales autorizados
  const productionOrigins = [
    'https://www.teteriabodhi.es',
    'https://teteriabodhi.es',
    'https://teteria-bodhi.vercel.app'
  ];

  // Dominios de desarrollo local: únicamente permitidos fuera de producción y fuera de preview
  const devOrigins = (!isProd && !isPreview) ? [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
  ] : [];

  const defaultOrigins = [...productionOrigins, ...devOrigins];

  // En Vercel Preview, autorizar únicamente los orígenes legítimos asignados a este despliegue
  if (isPreview) {
    // 1. Dominio específico de la rama Git asignado por Vercel (ej. teteria-bodhi-git-security-audit-sessions-jayro4.vercel.app)
    const branchDomain = sanitizeDomain(process.env.VERCEL_BRANCH_URL);
    if (branchDomain) {
      defaultOrigins.push(`https://${branchDomain}`);
    }

    // 2. Dominio específico de la instancia/despliegue asignado por Vercel (ej. teteria-bodhi-xxxx-jayro4.vercel.app)
    const previewDomain = sanitizeDomain(process.env.VERCEL_URL);
    if (previewDomain) {
      defaultOrigins.push(`https://${previewDomain}`);
    }
  } else if (!isProd) {
    // En entornos locales/test no productivos, si VERCEL_URL está definido, incluirlo
    const extraDomain = sanitizeDomain(process.env.VERCEL_URL);
    if (extraDomain) {
      defaultOrigins.push(`https://${extraDomain}`);
    }
  }

  return new Set([...defaultOrigins, ...envOrigins]);
}

function setCors(req, res, methods = 'GET, POST, OPTIONS') {
  const origin = req?.headers?.origin;
  const allowed = getAllowedOrigins(req);

  if (origin) {
    const originLower = String(origin).toLowerCase().trim();
    // Verificación estricta: únicamente orígenes presentes en la lista autorizada
    if (allowed.has(originLower)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  }

  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Request, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

module.exports = {
  setCors,
  getAllowedOrigins,
  isProductionEnv,
  isPreviewEnv
};
