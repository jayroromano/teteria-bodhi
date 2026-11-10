const db = require('../lib/db');
const { verifyAdminPassword, generateToken, verifyToken, checkRateLimit, hashRateLimitKey, isProduction, getSessionSecret } = require('../lib/auth');
const { setCors } = require('../lib/cors');

function getClientIp(req) {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) return xForwardedFor.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown_client';
}

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

  // Verificación de configuración segura en producción
  if (isProduction()) {
    const hasAdminPassword = Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim());
    const hasSessionSecret = Boolean(getSessionSecret());
    if (!hasAdminPassword || !hasSessionSecret) {
      // Diagnóstico seguro: solo indica qué falta, nunca el valor
      console.error('[Seguridad] Error crítico: configuración administrativa incompleta en producción.', {
        hasAdminPassword,
        hasAdminSessionSecret: hasSessionSecret
      });
      return res.status(500).json({
        error: 'El servidor no está configurado correctamente para permitir accesos administrativos.'
      });
    }
  }

  // GET: Verificar si el token actual en cabecera sigue siendo válido
  if (req.method === 'GET') {
    const auth = req.headers['authorization'] || '';
    const isValid = verifyToken(auth);
    return res.status(200).json({
      valid: isValid,
      isCloudDb: db.isCloudDb()
    });
  }

  // POST: Inicio de sesión con contraseña
  if (req.method === 'POST') {
    const clientIp = getClientIp(req);

    // Protección distribuida contra fuerza bruta: 5 intentos cada 5 minutos con IP anonimizada (RGPD)
    const rateKey = hashRateLimitKey('login', clientIp);
    const rateResult = await checkRateLimit(rateKey, 5, 5 * 60 * 1000);
    if (!rateResult.allowed) {
      if (rateResult.status === 503 || rateResult.unavailable) {
        return res.status(503).json({
          error: 'El servicio de seguridad no está disponible en este momento. Por favor inténtelo más tarde.'
        });
      }
      return res.status(429).json({
        error: 'Demasiados intentos fallidos. Por seguridad, espera 5 minutos antes de volver a intentar.'
      });
    }

    const body = await parseBody(req);
    const { password } = body;

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Por favor introduce la contraseña de administrador.' });
    }

    if (verifyAdminPassword(password)) {
      const token = generateToken();
      if (!token) {
        return res.status(500).json({
          error: 'Error interno generando la sesión criptográfica segura.'
        });
      }

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

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
