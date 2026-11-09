const crypto = require('crypto');

/**
 * Módulo de autenticación y seguridad para Tetería Bodhi
 * Genera y valida tokens criptográficos firmados con HMAC-SHA256
 */

function getSecret() {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    (process.env.ADMIN_PASSWORD ? `${process.env.ADMIN_PASSWORD}_bodhi_salt_2026` : 'bodhi_secret_salt_jerez_2026_x89')
  );
}

function signPayload(payload) {
  const secret = getSecret();
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Genera un token firmado con timestamp de expiración (7 días)
 */
function generateToken() {
  const timestamp = Date.now();
  const random = crypto.randomBytes(16).toString('hex');
  const payload = `${timestamp}.${random}`;
  const signature = signPayload(payload);
  return `bdh_${payload}.${signature}`;
}

/**
 * Valida un token comprobando firma criptográfica HMAC y fecha de caducidad
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const clean = token.replace('Bearer ', '').trim();

  // Contraseña directa de administrador en cabecera
  const validPass = process.env.ADMIN_PASSWORD || 'bodhi2026';
  if (clean === validPass) {
    return true;
  }

  // Comprobar formato del token firmado: bdh_<timestamp>.<random>.<signature>
  if (!clean.startsWith('bdh_')) {
    return false;
  }

  const parts = clean.slice(4).split('.');
  if (parts.length !== 3) {
    return false;
  }

  const [timestampStr, random, signature] = parts;
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    return false;
  }

  // Validación estricta de estructura y longitud hexadecimal (SHA-256 = 64 hex chars)
  if (!/^[0-9a-f]{32}$/.test(random) || !/^[0-9a-f]{64}$/.test(signature)) {
    return false;
  }

  // Comprobar caducidad (7 días)
  const maxAge = 7 * 24 * 60 * 60 * 1000;
  if (Date.now() - timestamp > maxAge || timestamp > Date.now() + 60000) {
    return false;
  }

  // Verificar firma HMAC mediante comparación en tiempo constante (previene ataques de temporización)
  const expectedPayload = `${timestampStr}.${random}`;
  const expectedSignature = signPayload(expectedPayload);

  try {
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expectedSignature, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

/**
 * Rate Limiter en memoria para Serverless (Ventana deslizante por IP)
 */
const rateLimitMap = new Map();

function checkRateLimit(ip, maxRequests = 10, windowMs = 60000) {
  if (!ip) return true;
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, resetTime: now + windowMs };

  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + windowMs;
    rateLimitMap.set(ip, record);
    return true;
  }

  record.count += 1;
  rateLimitMap.set(ip, record);

  // Limpieza periódica de memoria
  if (rateLimitMap.size > 2000) {
    for (const [k, v] of rateLimitMap.entries()) {
      if (now > v.resetTime) rateLimitMap.delete(k);
    }
  }

  return record.count <= maxRequests;
}

module.exports = {
  generateToken,
  verifyToken,
  checkRateLimit
};
