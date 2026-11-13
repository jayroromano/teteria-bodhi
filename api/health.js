/**
 * Endpoint de diagnóstico mínimo para operaciones.
 * NUNCA devuelve valores de secretos: solo true/false.
 */
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const sessionSecret = (process.env.ADMIN_SESSION_SECRET || '').trim();

  return res.status(200).json({
    ok: true,
    deploy: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
      environment: process.env.VERCEL_ENV || null
    },
    config: {
      adminPassword: Boolean((process.env.ADMIN_PASSWORD || '').trim()),
      adminSessionSecret: sessionSecret.length >= 16,
      supabaseUrl: Boolean((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()),
      supabaseServiceKey: Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim())
    }
  });
};
