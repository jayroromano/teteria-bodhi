const { setCors } = require('../lib/cors');
const {
  extractSessionToken,
  revokeToken,
  serializeClearCookie,
  validateCsrfProtection,
  SESSION_DURATION_MS
} = require('../lib/auth');

module.exports = async function handler(req, res) {
  setCors(req, res, 'POST, GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Comprobación de seguridad contra peticiones cross-origin no autorizadas (CSRF)
  if (!validateCsrfProtection(req)) {
    return res.status(403).json({
      error: 'Origen no autorizado o petición rechazada por política anti-CSRF.'
    });
  }

  const { token } = extractSessionToken(req);

  if (token && typeof token === 'string' && token.startsWith('bdh_')) {
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
    await revokeToken(token, expiresAt);
  }

  // Enviar Set-Cookie con Max-Age=0 para eliminar la cookie en el navegador
  res.setHeader('Set-Cookie', serializeClearCookie());

  return res.status(200).json({
    success: true,
    message: 'Sesión cerrada y revocada correctamente en el servidor.'
  });
};
