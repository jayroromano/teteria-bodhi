const crypto = require('crypto');
const net = require('net');
const https = require('https');

/**
 * Módulo de autenticación y seguridad para Tetería Bodhi
 * Genera y valida tokens criptográficos firmados con HMAC-SHA256
 */

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 horas (jornada laboral / turno de servicio)

let devEphemeralSecret = null;

function isProduction() {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
}

function getSessionSecret() {
  let baseSecret = null;
  if (process.env.ADMIN_SESSION_SECRET && process.env.ADMIN_SESSION_SECRET.trim().length >= 16) {
    baseSecret = process.env.ADMIN_SESSION_SECRET.trim();
  } else if (!isProduction()) {
    // Solo en desarrollo local: secreto aleatorio seguro de 32 bytes no predecible
    if (!devEphemeralSecret) {
      devEphemeralSecret = crypto.randomBytes(32).toString('hex');
    }
    baseSecret = devEphemeralSecret;
  }

  if (!baseSecret) {
    // En producción es obligatorio configurar ADMIN_SESSION_SECRET
    return null;
  }

  const adminPass = (process.env.ADMIN_PASSWORD || '').trim();
  if (!adminPass) {
    return baseSecret;
  }

  // Derivación de clave (KDF): Vincula criptográficamente el secreto de sesión a ADMIN_PASSWORD.
  // Cambiar ADMIN_PASSWORD invalida automáticamente todas las sesiones previas (VULN-03).
  const passHash = crypto.createHash('sha256').update(adminPass).digest('hex');
  return crypto.createHmac('sha256', baseSecret).update(passHash).digest('hex');
}

/**
 * Valida si la contraseña introducida coincide de forma segura con ADMIN_PASSWORD
 * Utiliza comparación de longitud constante para mitigar ataques de temporización
 */
function verifyAdminPassword(password) {
  // Se recorta el valor configurado para tolerar espacios accidentales al pegarlo en Vercel
  const configuredPassword = (process.env.ADMIN_PASSWORD || '').trim();
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
 * Invoca la función RPC check_rate_limit de Supabase con service_role
 * Devuelve boolean o null si hubo error de comunicación
 */
function checkSupabaseRateLimit(key, maxRequests, windowSeconds) {
  const sbUrl = (process.env.SUPABASE_URL || '').trim();
  const sbKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();

  if (!sbUrl || !sbKey) {
    return Promise.resolve({ ok: false, error: 'NO_CREDENTIALS' });
  }

  return new Promise((resolve) => {
    try {
      const fullUrl = new URL('/rest/v1/rpc/check_rate_limit', sbUrl);
      const postData = JSON.stringify({
        p_key: key,
        p_max_requests: maxRequests,
        p_window_seconds: windowSeconds
      });

      const rpcHeaders = {
        'apikey': sbKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      };
      // Compatibilidad: las claves nuevas (sb_secret_) no son JWT y no van como Bearer.
      if (sbKey.startsWith('eyJ')) {
        rpcHeaders['Authorization'] = `Bearer ${sbKey}`;
      }

      const req = https.request(
        fullUrl,
        {
          method: 'POST',
          headers: rpcHeaders,
          timeout: 3000
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const parsed = JSON.parse(data);
                if (typeof parsed === 'boolean') {
                  return resolve({ ok: true, allowed: parsed });
                }
              } catch (e) {}
            }
            console.error(`[RateLimit Supabase RPC Error]: Status ${res.statusCode} - ${data}`);
            resolve({ ok: false, error: `HTTP_${res.statusCode}` });
          });
        }
      );

      req.on('error', (err) => {
        console.error('[RateLimit Network Error]:', err.message);
        resolve({ ok: false, error: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        console.error('[RateLimit Timeout]: Tiempo de espera agotado (3s)');
        resolve({ ok: false, error: 'TIMEOUT' });
      });

      req.write(postData);
      req.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

/**
 * Control de frecuencia (Rate Limiter):
 * Retorna un objeto:
 * - { allowed: true } -> Petición dentro de límites
 * - { allowed: false, status: 429, reason: 'RATE_LIMIT_EXCEEDED' } -> Límite superado
 * - { allowed: false, status: 503, reason: 'SERVICE_UNAVAILABLE', unavailable: true } -> Servicio caído en producción
 *
 * En producción:
 * NUNCA se desactiva ni cae a memoria local silenciosamente; si Supabase falla,
 * se deniega el acceso con 503 para proteger la infraestructura contra abusos.
 *
 * En desarrollo local:
 * Permite fallback en memoria si no hay conexión a Supabase.
 */
async function checkRateLimit(key, maxRequests = 10, windowMs = 60000) {
  // Evitar que la ausencia de IP desactive el rate limit (asigna clave común)
  const safeKey = key && String(key).trim() ? String(key).trim().slice(0, 255) : 'unknown_client';
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));

  const hasCloudCreds = Boolean(
    process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY)
  );

  if (isProduction()) {
    // En producción es obligatorio el rate limiting distribuido vía Supabase
    if (!hasCloudCreds) {
      console.error('[Seguridad Producción] Rate limiting distribuido no configurado (faltan credenciales).');
      return {
        allowed: false,
        status: 503,
        reason: 'SERVICE_UNAVAILABLE',
        unavailable: true,
        message: 'Servicio de seguridad no configurado en producción.'
      };
    }

    const rpcResult = await checkSupabaseRateLimit(safeKey, maxRequests, windowSeconds);

    if (rpcResult.ok) {
      if (rpcResult.allowed) {
        return { allowed: true, status: 200 };
      } else {
        return {
          allowed: false,
          status: 429,
          reason: 'RATE_LIMIT_EXCEEDED',
          message: 'Demasiadas solicitudes. Límite excedido temporalmente.'
        };
      }
    }

    // Fallo de infraestructura de rate limiting en producción: Denegar con 503
    console.error('[Seguridad Producción] Fallo en el servicio de rate limiting distribuido:', rpcResult.error);
    return {
      allowed: false,
      status: 503,
      reason: 'SERVICE_UNAVAILABLE',
      unavailable: true,
      message: 'Servicio de protección temporalmente no disponible.'
    };
  }

  // En entorno de desarrollo (local)
  if (hasCloudCreds) {
    try {
      const rpcResult = await checkSupabaseRateLimit(safeKey, maxRequests, windowSeconds);
      if (rpcResult.ok) {
        return rpcResult.allowed
          ? { allowed: true, status: 200 }
          : { allowed: false, status: 429, reason: 'RATE_LIMIT_EXCEEDED' };
      }
    } catch (e) {}
  }

  // Fallback local exclusivamente para desarrollo offline
  const localOk = checkInMemoryRateLimit(safeKey, maxRequests, windowMs);
  return localOk
    ? { allowed: true, status: 200 }
    : { allowed: false, status: 429, reason: 'RATE_LIMIT_EXCEEDED' };
}

/**
 * Genera una clave seudonimizada mediante HMAC para rate limiting, evitando almacenar IPs en texto plano (RGPD)
 */

/**
 * Restablece el contador de rate limiting para una clave dada.
 * Se invoca tras un login exitoso para no penalizar accesos legítimos del personal.
 */
async function resetRateLimit(key) {
  if (!key) return;
  const safeKey = String(key).trim().slice(0, 255);

  // 1. Limpieza en memoria (desarrollo y suite de tests)
  inMemoryRateLimits.delete(safeKey);

  // 2. Limpieza en Supabase (si hay credenciales configuradas y no estamos en test)
  const sbUrl = (process.env.SUPABASE_URL || '').trim();
  const sbKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();

  if (sbUrl && sbKey && process.env.NODE_ENV !== 'test') {
    try {
      const fullUrl = new URL(`/rest/v1/rate_limits?key=eq.${encodeURIComponent(safeKey)}`, sbUrl);
      const rpcHeaders = {
        'apikey': sbKey,
        'Content-Type': 'application/json'
      };
      if (sbKey.startsWith('eyJ')) {
        rpcHeaders['Authorization'] = `Bearer ${sbKey}`;
      }

      await new Promise((resolve) => {
        const req = https.request(fullUrl, { method: 'DELETE', headers: rpcHeaders, timeout: 3000 }, (res) => {
          res.on('data', () => {});
          res.on('end', resolve);
        });
        req.on('error', () => resolve());
        req.on('timeout', () => { req.destroy(); resolve(); });
        req.end();
      });
    } catch (e) {
      // Si la limpieza remota falla, no interrumpe el flujo del login exitoso
    }
  }
}

function hashRateLimitKey(prefix, rawIdentifier) {
  const cleanPrefix = (prefix || 'rl').trim();
  const cleanId = rawIdentifier && String(rawIdentifier).trim() ? String(rawIdentifier).trim() : 'unknown_client';
  const secret = getSessionSecret() || 'bodhi_privacy_salt_2026';
  const hash = crypto.createHmac('sha256', secret).update(cleanId).digest('hex');
  return `${cleanPrefix}_${hash}`;
}

/**
 * Normaliza y valida una cadena de IP (IPv4 o IPv6).
 * Devuelve la IP limpia o null si es inválida, malformada o contiene caracteres no permitidos.
 */
function cleanIp(candidate) {
  if (!candidate || typeof candidate !== 'string') return null;
  let str = candidate.trim().replace(/^['"]|['"]$/g, '').trim();
  if (!str) return null;

  // Normalizar formato IPv4-mapped IPv6 (ej. ::ffff:192.168.1.1 -> 192.168.1.1)
  if (str.startsWith('::ffff:')) {
    const unmapped = str.slice(7);
    if (net.isIPv4(unmapped)) {
      return unmapped;
    }
  }

  // Despojar puerto IPv4 si viene en formato host:port (ej. 198.51.100.25:44321)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(str)) {
    const withoutPort = str.split(':')[0];
    if (net.isIPv4(withoutPort)) {
      return withoutPort;
    }
  }

  // Despojar corchetes y puerto en IPv6 (ej. [2001:db8::1]:8080)
  if (/^\[([0-9a-fA-F:]+)\](:\d+)?$/.test(str)) {
    const match = str.match(/^\[([0-9a-fA-F:]+)\]/);
    if (match && net.isIPv6(match[1])) {
      return match[1];
    }
  }

  return net.isIP(str) !== 0 ? str : null;
}

/**
 * Obtiene el valor de una cabecera de forma insensible a mayúsculas/minúsculas.
 */
function getHeader(headers, headerName) {
  if (!headers || typeof headers !== 'object') return undefined;
  const target = headerName.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) {
      const val = headers[key];
      return Array.isArray(val) ? val.join(', ') : val;
    }
  }
  return undefined;
}

/**
 * Extrae la primera IP válida de una cadena con posibles comas (formato de cadena proxy).
 */
function parseFirstValidIp(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const parts = headerValue.split(',');
  for (const part of parts) {
    const cleaned = cleanIp(part);
    if (cleaned) return cleaned;
  }
  return null;
}

/**
 * Determina si la ejecución actual se realiza dentro del entorno de Serverless Functions de Vercel.
 * Comprueba las variables del sistema inyectadas por la plataforma Vercel:
 * - VERCEL === '1' (o 'true')
 * - VERCEL_REGION (identificador de región del runtime serverless asignado por Vercel, ej: 'cdg1', 'fra1')
 *   o VERCEL_ENV in ('production', 'preview').
 * Un servidor local Express desprotegido no cuenta con estas variables del orquestador.
 */
function isVercelRuntime() {
  const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
  const hasRegion = Boolean(process.env.VERCEL_REGION && process.env.VERCEL_REGION.trim());
  const hasEnv = process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview';
  return isVercel && (hasRegion || hasEnv);
}

/**
 * Determina la dirección IP del cliente de forma segura:
 *
 * 1. EN ENTORNO SERVERLESS DE VERCEL (producción / preview):
 *    El tráfico entrante es canalizado obligatoriamente a través del Edge Network de Vercel.
 *    El Edge de Vercel sobreescribe e inyecta las cabeceras verificadas desde la conexión TCP:
 *    - 'x-vercel-forwarded-for': Cabecera documentada por Vercel como referencia fiable de la IP pública del cliente.
 *    - 'x-real-ip': Cabecera oficial inyectada por el Edge con la IP pública del visitante.
 *    - NUNCA se confía en 'x-forwarded-for' si faltan las anteriores, impidiendo inyecciones de IPs falsas.
 *
 * 2. EN ENTORNO LOCAL O SERVIDOR DIRECTO (Express server.js sin proxy):
 *    Cualquier cabecera HTTP puede ser enviada o manipulada arbitrariamente por el cliente.
 *    Por tanto, se ignoran todas las cabeceras y se utiliza EXCLUSIVAMENTE la dirección IP real
 *    del socket de conexión TCP del sistema operativo ('req.socket.remoteAddress').
 *    Solo si se define explícitamente TRUST_PROXY=true (ej. tras un proxy Nginx certificado local) se leen cabeceras.
 *
 * 3. FALLO SEGURO (FAIL-CLOSED):
 *    Si ninguna fuente produce una IP válida (petición anómala o mock sin socket), se retorna 'unattributed_client'.
 *    NUNCA se utilizan datos controlados por el cliente (User-Agent, teléfono, cabeceras) para generar identificadores
 *    alternativos, evitando que un atacante pueda eludir los límites mutando campos del formulario o cabeceras.
 */
function getClientIp(req) {
  if (!req || typeof req !== 'object') {
    return 'unattributed_client';
  }

  const headers = req.headers || {};
  const isVercel = isVercelRuntime();
  const isExplicitTrustProxy = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';
  const isTest = process.env.NODE_ENV === 'test';

  const canTrustEdgeHeaders = isVercel || isExplicitTrustProxy || (isTest && (Boolean(getHeader(headers, 'x-vercel-forwarded-for')) || Boolean(getHeader(headers, 'x-real-ip'))));

  if (canTrustEdgeHeaders) {
    // 1. Cabecera oficial documentada por Vercel
    const xVercel = getHeader(headers, 'x-vercel-forwarded-for');
    if (xVercel) {
      const ip = parseFirstValidIp(xVercel);
      if (ip) return ip;
    }

    // 2. Cabecera oficial x-real-ip inyectada por Vercel Edge
    const xReal = getHeader(headers, 'x-real-ip');
    if (xReal) {
      const ip = cleanIp(xReal);
      if (ip) return ip;
    }

    // NUNCA hacer fallback a x-forwarded-for sin verificar:
    // Si faltan x-vercel-forwarded-for y x-real-ip, x-forwarded-for no es de confianza.
  }

  // 3. Dirección IP del socket TCP (conexión local directa Express o fallback de red)
  const socketIp = cleanIp(
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    req.info?.remoteAddress
  );
  if (socketIp) {
    return socketIp;
  }

  // 4. Fallback seguro: cliente no atribuido (cuota estricta para peticiones sin IP)
  return 'unattributed_client';
}


// ========================================================
// GESTIÓN DE SESIONES EN COOKIES, CSRF Y REVOCACIÓN (VULN-01, VULN-02)
// ========================================================
const { getAllowedOrigins } = require('./cors');

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return cookies;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      try {
        cookies[key] = decodeURIComponent(val);
      } catch (e) {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

function serializeSessionCookie(token, maxAgeSeconds = 28800) {
  const isProd = isProduction();
  const secure = isProd ? '; Secure' : '';
  return `bodhi_admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=${maxAgeSeconds}`;
}

function serializeClearCookie() {
  const isProd = isProduction();
  const secure = isProd ? '; Secure' : '';
  return `bodhi_admin_session=; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function extractSessionToken(req) {
  if (!req) return { token: null, source: null };
  // 1. Extraer preferentemente de la cookie HttpOnly
  const cookieHeader = getHeader(req.headers, 'cookie') || '';
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    if (cookies.bodhi_admin_session) {
      return { token: cookies.bodhi_admin_session, source: 'cookie' };
    }
  }
  // 2. Extraer de cabecera Authorization (para clientes API, tests y compatibilidad)
  const authHeader = getHeader(req.headers, 'authorization') || '';
  if (authHeader && typeof authHeader === 'string') {
    const clean = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (clean) {
      return { token: clean, source: 'header' };
    }
  }
  return { token: null, source: null };
}

function validateAdminOrigin(req) {
  if (!req || typeof req !== 'object') return false;

  const origin = getHeader(req.headers, 'origin');
  const referer = getHeader(req.headers, 'referer');
  const allowed = getAllowedOrigins();

  // 1. Si viene cabecera Origin, debe coincidir estrictamente con un origen autorizado
  if (origin) {
    const originLower = String(origin).toLowerCase().trim();
    if (!allowed.has(originLower)) {
      return false;
    }
  }

  // 2. Si viene cabecera Referer, su origen debe coincidir estrictamente con un origen autorizado
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin.toLowerCase().trim();
      if (!allowed.has(refOrigin)) {
        return false;
      }
    } catch (e) {
      return false;
    }
  }

  // 3. Comprobación para mutaciones administrativas en Vercel (producción / preview)
  // o cuando la petición utiliza autenticación por cookies en el navegador
  const method = (req.method || 'GET').toUpperCase();
  const isMutation = ['POST', 'PATCH', 'DELETE', 'PUT'].includes(method);
  const isVercel = isVercelRuntime();
  const hasCookie = Boolean(getHeader(req.headers, 'cookie'));

  if (isMutation && (isVercel || hasCookie)) {
    if (!origin && !referer) {
      return false;
    }
  }

  return true;
}

function validateCsrfProtection(req) {
  if (!validateAdminOrigin(req)) {
    return false;
  }

  const method = (req.method || 'GET').toUpperCase();
  const isMutation = ['POST', 'PATCH', 'DELETE', 'PUT'].includes(method);
  if (isMutation) {
    // Para mutaciones, la cabecera anti-CSRF (X-Admin-Request o X-Requested-With) es obligatoria
    const adminHeader = getHeader(req.headers, 'x-admin-request') || getHeader(req.headers, 'x-requested-with');
    if (!adminHeader) {
      return false;
    }
  }

  return true;
}

function hashToken(token) {
  if (!token || typeof token !== 'string') return '';
  const clean = token.replace(/^Bearer\s+/i, '').trim();
  return crypto.createHash('sha256').update(clean).digest('hex');
}

// No se utiliza memoria local como sustituto de persistencia compartida en entornos cloud/serverless
async function isTokenRevoked(token) {
  if (!token || typeof token !== 'string') return true;
  const tokenHash = hashToken(token);
  if (!tokenHash) return true;

  const db = require('./db');
  return await db.isTokenRevoked(tokenHash);
}

async function revokeToken(token, expiresAtIso = null) {
  if (!token || typeof token !== 'string') return false;
  const tokenHash = hashToken(token);
  if (!tokenHash) return false;

  const db = require('./db');
  return await db.revokeToken(tokenHash, expiresAtIso);
}


module.exports = {
  isProduction,
  getSessionSecret,
  verifyAdminPassword,
  generateToken,
  verifyToken,
  checkRateLimit,
  resetRateLimit,
  hashRateLimitKey,
  cleanIp,
  getClientIp,
  isVercelRuntime,
  SESSION_DURATION_MS,
  parseCookies,
  serializeSessionCookie,
  serializeClearCookie,
  extractSessionToken,
  validateAdminOrigin,
  validateCsrfProtection,
  hashToken,
  isTokenRevoked,
  revokeToken,
  _inMemoryRateLimits: inMemoryRateLimits
};
