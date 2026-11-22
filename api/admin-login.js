const db = require('../lib/db');
const {
  verifyAdminPassword,
  generateToken,
  verifyToken,
  checkRateLimit,
  resetRateLimit,
  hashRateLimitKey,
  isProduction,
  getSessionSecret,
  getClientIp,
  extractSessionToken,
  serializeSessionCookie,
  isTokenRevoked,
  validateAdminOrigin,
  SESSION_DURATION_MS
} = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS } = require('../lib/limits');

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

module.exports = async function handler(req, res) {
  setCors(req, res, 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Comprobación de seguridad contra orígenes no autorizados
  if (!validateAdminOrigin(req)) {
    return res.status(403).json({ error: 'Origen no autorizado.' });
  }

  // Verificación de configuración segura en producción
  if (isProduction()) {
    const hasAdminPassword = Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim());
    const hasSessionSecret = Boolean(getSessionSecret());
    if (!hasAdminPassword || !hasSessionSecret) {
      console.error('[Seguridad] Error crítico: configuración administrativa incompleta en producción.', {
        hasAdminPassword,
        hasAdminSessionSecret: hasSessionSecret
      });
      return res.status(500).json({
        error: 'El servidor no está configurado correctamente para permitir accesos administrativos.'
      });
    }
  }

  // GET: Verificar si la sesión actual (vía cookie o cabecera) sigue siendo válida
  if (req.method === 'GET') {
    const { token } = extractSessionToken(req);
    const isValid = token ? verifyToken(token) : false;
    if (!isValid || !token) {
      return res.status(200).json({ valid: false, isCloudDb: db.isCloudDb() });
    }
    try {
      const isRevoked = await isTokenRevoked(token);
      return res.status(200).json({
        valid: !isRevoked,
        isCloudDb: db.isCloudDb()
      });
    } catch (err) {
      // FAIL-CLOSED: si no se puede verificar en base de datos centralizada, responder 503
      return res.status(503).json({
        valid: false,
        error: 'No se puede verificar el estado de la sesión en el servicio de seguridad.',
        isCloudDb: db.isCloudDb()
      });
    }
  }

  // POST: Inicio de sesión con contraseña
  if (req.method === 'POST') {
    const clientIp = getClientIp(req);

    // Protección distribuida contra fuerza bruta con IP anonimizada (RGPD)
    const rateKey = hashRateLimitKey('login', clientIp);
    const rateResult = await checkRateLimit(rateKey, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
    if (!rateResult.allowed) {
      if (rateResult.status === 503 || rateResult.unavailable) {
        return res.status(503).json({
          error: 'El servicio de seguridad no está disponible en este momento. Por favor inténtelo más tarde.'
        });
      }
      return res.status(429).json({
        error: 'Demasiados intentos fallidos. Espera hasta 3 minutos y vuelve a intentarlo.'
      });
    }

    const body = await parseBody(req);
    const { password } = body;

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Por favor introduce la contraseña de administrador.' });
    }

    if (verifyAdminPassword(password)) {
      await resetRateLimit(rateKey);
      const token = generateToken();
      if (!token) {
        return res.status(500).json({
          error: 'Error interno generando la sesión criptográfica segura.'
        });
      }

      const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

      // Emitir cookie HttpOnly, Secure y SameSite=Strict (VULN-01)
      res.setHeader('Set-Cookie', serializeSessionCookie(token, Math.floor(SESSION_DURATION_MS / 1000)));

      return res.status(200).json({
        success: true,
        message: 'Acceso autorizado al panel de Tetería Bodhi',
        token,
        expiresAt,
        isCloudDb: db.isCloudDb()
      });
    } else {
      return res.status(401).json({
        error: 'Contraseña incorrecta.'
      });
    }
  }

  return res.status(405).json({ error: 'Método no permitido.' });
};

module.exports.getClientIp = getClientIp;
