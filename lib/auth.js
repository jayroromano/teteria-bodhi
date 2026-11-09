const crypto = require('crypto');
const https = require('https');

/**
 * Módulo de autenticación y seguridad para Tetería Bodhi
 * Genera y valida tokens criptográficos firmados con HMAC-SHA256
 */

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 horas

// En entorno de desarrollo (no producción ni Vercel), generamos un secreto aleatorio efímero
// seguro si no se especifica ADMIN_SESSION_SECRET, evitando cualquier secreto predecible o hardcodeado.
let devEphemeralSecret = null;

function isProduction() {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
}

function getSessionSecret() {
  if (process.env.ADMIN_SESSION_SECRET && process.env.ADMIN_SESSION_SECRET.trim().length >= 16) {
    return process.env.ADMIN_SESSION_SECRET.trim();
  }

  if (isProduction()) {
    // En producción es obligatorio configurar ADMIN_SESSION_SECRET
    return null;
  }

  // Solo en desarrollo local: secreto aleatorio seguro de 32 bytes no predecible
  if (!devEphemeralSecret) {
    devEphemeralSecret = crypto.randomBytes(32).toString('hex');
  }
  return devEphemeralSecret;
}

/**
 * Valida si la contraseña introducida coincide de forma segura con ADMIN_PASSWORD
 * Utiliza comparación de longitud constante para mitigar ataques de temporización
 */
function verifyAdminPassword(password) {
  const configuredPassword = process.env.ADMIN_PASSWORD;
  if (!configuredPassword || typeof password !== 'string' || !password) {
    return false;
  }

  const inputBuf = Buffer.from(password);
  const targetBuf = Buffer.from(configuredPassword);

  if (inputBuf.length !== targetBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(inputBuf, targetBuf);
}

/**
 * Genera un token HMAC-SHA256 firmado con timestamp y componente aleatorio
 * Retorna null si faltan secretos requeridos
 */
function generateToken() {
  const secret = getSessionSecret();
  if (!secret) {
    return null;
  }

  const timestamp = Date.now();
  const random = crypto.randomBytes(16).toString('hex');
  const payload = `${timestamp}.${random}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `bdh_${payload}.${signature}`;
}

/**
 * Valida un token comprobando estrictamente firma HMAC, expiración y formato
 * NUNCA acepta contraseñas como token
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const clean = token.replace('Bearer ', '').trim();

  // Comprobar prefijo obligatorio de token firmado
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

  // Validación estricta de formato hexadecimal (16 bytes = 32 hex, sha256 = 64 hex)
  if (!/^[0-9a-f]{32}$/.test(random) || !/^[0-9a-f]{64}$/.test(signature)) {
    return false;
  }

  const now = Date.now();
  // Rechazar tokens expirados o con fecha en el futuro (margen de reloj 60s)
  if (now - timestamp > SESSION_DURATION_MS || timestamp > now + 60000) {
    return false;
  }

  const secret = getSessionSecret();
  if (!secret) {
    return false;
  }

  const expectedPayload = `${timestampStr}.${random}`;
  const expectedSignature = crypto.createHmac('sha256', secret).update(expectedPayload).digest('hex');

  try {
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expectedSignature, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

// ========================================================
// RATE LIMITING DISTRIBUIDO Y EN MEMORIA
// ========================================================
const inMemoryRateLimits = new Map();

function checkInMemoryRateLimit(safeKey, maxRequests, windowMs) {
  const now = Date.now();
  const record = inMemoryRateLimits.get(safeKey) || { count: 0, resetTime: now + windowMs };

  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + windowMs;
    inMemoryRateLimits.set(safeKey, record);
    return true;
  }

  record.count += 1;
  inMemoryRateLimits.set(safeKey, record);

  // Limpieza periódica de memoria
  if (inMemoryRateLimits.size > 2000) {
    for (const [k, v] of inMemoryRateLimits.entries()) {
      if (now > v.resetTime) inMemoryRateLimits.delete(k);
    }
  }

  return record.count <= maxRequests;
}

/**
 * Consulta la función RPC de Supabase para rate limiting atómico entre instancias serverless
 */
function checkSupabaseRateLimit(key, maxRequests, windowSeconds) {
  const sbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!sbUrl || !sbKey) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const fullUrl = new URL('/rest/v1/rpc/check_rate_limit', sbUrl);
      const postData = JSON.stringify({
        p_key: key,
        p_max_requests: maxRequests,
        p_window_seconds: windowSeconds
      });

      const req = https.request(
        fullUrl,
        {
          method: 'POST',
          headers: {
            'apikey': sbKey,
            'Authorization': `Bearer ${sbKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          },
          timeout: 2000
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const parsed = JSON.parse(data);
                if (typeof parsed === 'boolean') {
                  return resolve(parsed);
                }
              } catch (e) {}
            }
            resolve(null);
          });
        }
      );

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.write(postData);
      req.end();
    } catch (e) {
      resolve(null);
    }
  });
}

/**
 * Rate Limiter resiliente para Serverless:
 * 1. Si Supabase tiene la función check_rate_limit, sincroniza el límite entre todas las instancias.
 * 2. Si no o durante desarrollo/fallback, aplica la ventana en memoria por instancia.
 * 3. Si no hay IP o es inválida, se aplica una clave colectiva 'unknown_client' para evitar evasiones.
 */
async function checkRateLimit(key, maxRequests = 10, windowMs = 60000) {
  // Evitar que ausencia de IP desactive el rate limit
  const safeKey = key && String(key).trim() ? String(key).trim() : 'unknown_client';
  const windowSeconds = Math.ceil(windowMs / 1000);

  try {
    const sbResult = await checkSupabaseRateLimit(safeKey, maxRequests, windowSeconds);
    if (typeof sbResult === 'boolean') {
      return sbResult;
    }
  } catch (e) {
    // Continuar al fallback local
  }

  return checkInMemoryRateLimit(safeKey, maxRequests, windowMs);
}

module.exports = {
  isProduction,
  getSessionSecret,
  verifyAdminPassword,
  generateToken,
  verifyToken,
  checkRateLimit
};
