const crypto = require('crypto');
const net = require('net');
const https = require('https');

/**
 * Módulo de autenticación y seguridad para Tetería Bodhi
 * Genera y valida tokens criptográficos firmados con HMAC-SHA256
 */

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 horas

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
 * Determina si la ejecución actual corresponde a un entorno serverless protegido de Vercel.
 * Requiere que las variables de entorno de Vercel estén configuradas (VERCEL=1 y VERCEL_REGION o VERCEL_ENV)
 * lo que distingue un despliegue real en el Edge de Vercel frente a un servidor local desprotegido.
 */
function isVercelRuntime() {
  const isVercelFlag = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
  const hasVercelEnv = process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview';
  const hasVercelRegion = Boolean(process.env.VERCEL_REGION && process.env.VERCEL_REGION.trim());
  return (isVercelFlag && (hasVercelRegion || hasVercelEnv));
}

/**
 * Comprueba si la petición porta los encabezados de firma del Edge Network de Vercel.
 * Vercel inyecta 'x-vercel-id' y 'x-vercel-forwarded-for' en cada petición entrante a sus Functions.
 */
function hasVercelEdgeSignature(req) {
  if (!req || !req.headers || typeof req.headers !== 'object') return false;
  const vercelId = getHeader(req.headers, 'x-vercel-id');
  const vercelForwarded = getHeader(req.headers, 'x-vercel-forwarded-for');
  return Boolean(vercelId || vercelForwarded);
}

/**
 * Genera un identificador seguro particionado para clientes cuya IP no puede determinarse de forma fiable.
 * Mitiga la vulnerabilidad de denegación de servicio por bucket compartido (Shared Bucket DoS):
 * En lugar de agrupar a todos los clientes anónimos bajo una única clave ('unknown_client') —lo que permitiría
 * a un atacante agotar la cuota y bloquear a todos los usuarios legítimos sin IP fiable—, particiona las
 * peticiones mediante un HMAC criptográfico combinando la huella de la petición (User-Agent, Accept-Language)
 * y un discriminador contextual opcional (hint, ej. teléfono de reserva).
 */
function getFallbackClientKey(req, hint = '') {
  const headers = req?.headers || {};
  const ua = getHeader(headers, 'user-agent') || 'no_ua';
  const lang = getHeader(headers, 'accept-language') || 'no_lang';
  const cleanHint = hint && typeof hint === 'string' ? hint.trim().toLowerCase() : '';

  const secret = getSessionSecret() || 'bodhi_partition_fallback_salt_2026';
  const rawEntropy = `${ua}|${lang}|${cleanHint}`;
  const hash = crypto.createHmac('sha256', secret).update(rawEntropy).digest('hex').slice(0, 24);
  return `anon_${hash}`;
}

/**
 * Determina la dirección IP del cliente o su clave de partición segura de forma context-aware:
 *
 * 1. EN INFRAESTRUCTURA VERCEL (producción / preview):
 *    - Requiere entorno Vercel verificado (isVercelRuntime) y presencia de firma Edge (hasVercelEdgeSignature).
 *    - Prioridad 1: 'x-vercel-forwarded-for' (cabecera oficial inyectada por el Edge de Vercel, inmune a spoofing).
 *    - Prioridad 2: 'x-real-ip' (cabecera oficial inyectada por el Edge de Vercel con la IP del socket que conectó a su Edge).
 *    - NUNCA se utiliza 'x-forwarded-for' como fallback si faltan las cabeceras de confianza del Edge,
 *      impidiendo cualquier intento de inyección o evasión mediante cabeceras manipuladas.
 *
 * 2. EN ENTORNO LOCAL / SERVIDOR DIRECTO (Express server.js sin proxy):
 *    - NUNCA se confía en cabeceras X-Forwarded-For ni X-Real-IP enviadas en peticiones directas,
 *      ya que cualquier cliente HTTP puede manipularlas arbitrariamente. Se utiliza exclusivamente
 *      la dirección IP real del socket de conexión TCP ('req.socket.remoteAddress').
 *    - Solo si process.env.TRUST_PROXY === 'true' se evalúan cabeceras verificadas.
 *
 * 3. ENTORNO DE PRUEBAS (NODE_ENV === 'test'):
 *    - Permite evaluar escenarios de Edge de Vercel y sockets TCP locales de forma determinista.
 *
 * 4. ESTRATEGIA DE PARTICIÓN SEGURA (NO COMPARTIDA):
 *    - Si ninguna fuente produce una IP fiable, se aplica partición determinista seudonimizada
 *      (getFallbackClientKey) en lugar de una clave global única, evitando denegaciones de servicio
 *      a usuarios legítimos sin IP detectable.
 */
function getClientIp(req, hint = '') {
  if (!req || typeof req !== 'object') {
    return getFallbackClientKey(null, hint);
  }

  const headers = req.headers || {};
  const isVercel = isVercelRuntime();
  const isTest = process.env.NODE_ENV === 'test';
  const isExplicitTrustProxy = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';

  // Solo se evalúan cabeceras de proxy si provienen de infraestructura verificada de Edge
  // o si se configuró explícitamente TRUST_PROXY=true
  const isTrustedEdge = (isVercel && hasVercelEdgeSignature(req)) ||
                        (isTest && hasVercelEdgeSignature(req)) ||
                        isExplicitTrustProxy;

  if (isTrustedEdge) {
    // 1. Cabecera protegida del Edge de Vercel (documentación oficial Vercel)
    const xVercel = getHeader(headers, 'x-vercel-forwarded-for');
    if (xVercel) {
      const ip = parseFirstValidIp(xVercel);
      if (ip) return ip;
    }

    // 2. Cabecera oficial x-real-ip inyectada por el Edge de Vercel
    const xReal = getHeader(headers, 'x-real-ip');
    if (xReal) {
      const ip = cleanIp(xReal);
      if (ip) return ip;
    }

    // NUNCA recurrimos a x-forwarded-for arbitrario sin verificar:
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

  // 4. Estrategia segura para clientes sin IP fiable: particionado seguro sin DoS compartido
  return getFallbackClientKey(req, hint);
}

module.exports = {
  isProduction,
  getSessionSecret,
  verifyAdminPassword,
  generateToken,
  verifyToken,
  checkRateLimit,
  hashRateLimitKey,
  cleanIp,
  getClientIp,
  isVercelRuntime,
  hasVercelEdgeSignature,
  getFallbackClientKey
};
