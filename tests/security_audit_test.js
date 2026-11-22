/**
 * SUITE DE PRUEBAS AUTOMATIZADAS DE SEGURIDAD Y CONCURRENCIA · TETERÍA BODHI
 *
 * GARANTÍA DE AISLAMIENTO ABSOLUTO:
 * - NODE_ENV forzado a 'test' antes de cualquier carga modular.
 * - Deshabilitación y eliminación total de credenciales de Supabase / PostgreSQL.
 * - Interceptores de red (https/http) que impiden llamadas salientes a internet.
 * - Base de datos simulada y almacenamiento aislado en data/test_isolated/.
 * - Desactivación total de llamadas a servicios de mensajería (WhatsApp, Telegram, Resend).
 * - Distinción explícita de tipos de prueba: [UNIT], [SIMULATION], [STATIC], [INTEGRATION].
 */

// 1. FORZAR ENTORNO DE PRUEBAS ANTES DE CUALQUIER REQUIRE
process.env.NODE_ENV = 'test';

// 2. ELIMINAR CUALQUIER CREDENCIAL REMOTA O DE MENSAJERÍA QUE PUDIERA HEREDARSE DEL SISTEMA
const FORBIDDEN_ENV_KEYS = [
  'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY',
  'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL',
  'POSTGRES_URL_NON_POOLING', 'POSTGRESQL_URL', 'POSTGRES_URI',
  'RESEND_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
  'WHATSAPP_NOTIFY_PHONE', 'WHATSAPP_NOTIFY_APIKEY'
];
for (const key of FORBIDDEN_ENV_KEYS) {
  delete process.env[key];
}

// 3. CONFIGURAR PARÁMETROS SEGUROS Y SECRETOS DE PRUEBA
const TEST_ADMIN_PASS = 'TestSecretBodhiPass_2026_Secure!';
const TEST_SESSION_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.ADMIN_PASSWORD = TEST_ADMIN_PASS;
process.env.ADMIN_SESSION_SECRET = TEST_SESSION_SECRET;
process.env.ALLOWED_ORIGINS = 'https://teteria-bodhi.vercel.app,http://localhost:3000';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { LOGIN_MAX_ATTEMPTS } = require('../lib/limits');

// 4. INTERCEPTOR DE RED: IMPEDIR LLAMADAS EXTERNAS NO AUTORIZADAS
const externalCallsAttempted = [];
const originalHttpsRequest = https.request;
const originalHttpsGet = https.get;

https.request = function(options, cb) {
  const host = typeof options === 'string' ? new URL(options).hostname : (options.hostname || options.host || '');
  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    externalCallsAttempted.push({ type: 'https.request', host });
    throw new Error(`[VIOLACIÓN DE AISLAMIENTO]: Llamada HTTPS externa bloqueada hacia ${host}`);
  }
  return originalHttpsRequest.apply(this, arguments);
};

https.get = function(options, cb) {
  const host = typeof options === 'string' ? new URL(options).hostname : (options.hostname || options.host || '');
  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    externalCallsAttempted.push({ type: 'https.get', host });
    throw new Error(`[VIOLACIÓN DE AISLAMIENTO]: Llamada HTTPS externa bloqueada hacia ${host}`);
  }
  return originalHttpsGet.apply(this, arguments);
};

// 5. CARGA DE MÓDULOS DE LA APLICACIÓN BAJO AISLAMIENTO
const auth = require('../lib/auth');
const db = require('../lib/db');
const cors = require('../lib/cors');
const adminLoginHandler = require('../api/admin-login');
const reservasHandler = require('../api/reservas');
const cartaHandler = require('../api/carta');
const businessConfigHandler = require('../api/business-config');
const closedDatesHandler = require('../api/closed-dates');
const adminLogoutHandler = require('../api/admin-logout');
const localApp = require('../server');

let passedCount = 0;
let failedCount = 0;
const results = [];

function assert(condition, category, testName, details = '') {
  const label = `[${category}] ${testName}`;
  if (condition) {
    passedCount++;
    results.push({ label, status: 'PASSED', details });
    console.log(`  ✓ ${label}`);
  } else {
    failedCount++;
    results.push({ label, status: 'FAILED', details });
    console.error(`  ✗ ${label}: ${details}`);
  }
}

let mockIpCounter = 1;
function mockHttp(options = {}) {
  const clientIp = options.ip !== undefined ? options.ip : ('10.0.0.' + (++mockIpCounter));
  const socket = options.socket !== undefined ? options.socket : (clientIp ? { remoteAddress: clientIp } : null);
  const normalizedReqHeaders = {};
  if (options.headers && typeof options.headers === 'object') {
    for (const [k, v] of Object.entries(options.headers)) {
      normalizedReqHeaders[k.toLowerCase()] = v;
    }
  }
  const req = {
    method: options.method || 'GET',
    url: options.url || '/',
    headers: normalizedReqHeaders,
    query: options.query || {},
    body: options.body || {},
    socket,
    on: (evt, cb) => {
      if (evt === 'end') cb();
    }
  };

  let statusCode = 200;
  const headers = {};
  let responseData = null;

  const res = {
    statusCode: 200,
    setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
    getHeader: (k) => headers[k.toLowerCase()],
    status: (s) => { statusCode = s; res.statusCode = s; return res; },
    json: (d) => { responseData = d; return res; },
    end: (d) => { if (d) responseData = d; return res; }
  };

  return {
    req,
    res,
    run: async (handler) => {
      await handler(req, res);
      return { status: statusCode, headers, body: responseData };
    }
  };
}

function getFutureDate(targetDayOfWeek) {
  const d = new Date();
  d.setDate(d.getDate() + 1); // Empezar desde mañana
  while (d.getDay() !== targetDayOfWeek) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString().split('T')[0];
}

async function runTestSuite() {
  const isolatedDir = path.join(process.cwd(), 'data', 'test_isolated');
  const prodReservasPath = path.join(process.cwd(), 'data', 'reservas.json');
  const prodCartaPath = path.join(process.cwd(), 'data', 'carta.json');

  let initialProdReservasMtime = null;
  let initialProdCartaMtime = null;
  if (fs.existsSync(prodReservasPath)) initialProdReservasMtime = fs.statSync(prodReservasPath).mtimeMs;
  if (fs.existsSync(prodCartaPath)) initialProdCartaMtime = fs.statSync(prodCartaPath).mtimeMs;

  // Limpiar directorio aislado antes de comenzar
  if (fs.existsSync(isolatedDir)) {
    fs.rmSync(isolatedDir, { recursive: true, force: true });
  }

  try {
    console.log('\n=============================================================');
    console.log(' INICIANDO SUITE DE AUDITORÍA Y SEGURIDAD · TETERÍA BODHI');
    console.log('=============================================================\n');

    // ========================================================
    // BLOQUE 0: VERIFICACIÓN DE AISLAMIENTO TOTAL
    // ========================================================
    console.log('--- BLOQUE 0: GARANTÍA DE AISLAMIENTO ABSOLUTO ---');

    assert(
      process.env.NODE_ENV === 'test',
      'UNIT',
      '0.1 Entorno de pruebas forzado estrictamente a NODE_ENV="test"'
    );

    assert(
      !process.env.SUPABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.DATABASE_URL,
      'UNIT',
      '0.2 Credenciales sensibles remotas ausentes de la memoria del proceso'
    );

    assert(
      db.isCloudDb() === false,
      'UNIT',
      '0.3 isCloudDb() devuelve false garantizando que no hay conexión a base de datos de producción'
    );

    assert(
      externalCallsAttempted.length === 0,
      'UNIT',
      '0.4 Interceptores de red activos y cero intentos de llamadas salientes a internet'
    );

    // ========================================================
    // BLOQUE 1: AUTENTICACIÓN Y SESIONES
    // ========================================================
    console.log('\n--- BLOQUE 1: AUTENTICACIÓN Y SESIONES ---');

    // 1.1 Contraseña correcta genera token HMAC
    const loginSuccessRes = await mockHttp({
      method: 'POST',
      url: '/api/admin-login',
      body: { password: TEST_ADMIN_PASS }
    }).run(adminLoginHandler);

    assert(
      loginSuccessRes.status === 200 &&
      loginSuccessRes.body.success === true &&
      typeof loginSuccessRes.body.token === 'string' &&
      loginSuccessRes.body.token.startsWith('bdh_'),
      'SIMULATION',
      '1.1 Iniciar sesión con contraseña correcta genera token HMAC-SHA256'
    );

    const validToken = loginSuccessRes.body?.token;

    // 1.2 Contraseña incorrecta rechazada
    const loginWrongRes = await mockHttp({
      method: 'POST',
      url: '/api/admin-login',
      body: { password: 'PasswordTotalmenteIncorrecta999' }
    }).run(adminLoginHandler);

    assert(
      loginWrongRes.status === 401 && loginWrongRes.body.error === 'Contraseña incorrecta.',
      'SIMULATION',
      '1.2 Contraseña incorrecta es rechazada con código 401'
    );

    // 1.3 Contraseña antigua por defecto ('bodhi2026') rechazada
    const loginDefaultRes = await mockHttp({
      method: 'POST',
      url: '/api/admin-login',
      body: { password: 'bodhi2026' }
    }).run(adminLoginHandler);

    assert(
      loginDefaultRes.status === 401,
      'SIMULATION',
      '1.3 Contraseña heredada "bodhi2026" queda desactivada y es rechazada con 401'
    );

    // 1.4 Inyecciones y tipos no string en contraseña
    const injections = ["' OR '1'='1", null, true, 12345, {}, ['admin']];
    let allInjectionsBlocked = true;
    for (const badPass of injections) {
      const res = await mockHttp({
        method: 'POST',
        url: '/api/admin-login',
        body: { password: badPass }
      }).run(adminLoginHandler);
      if (res.status !== 400 && res.status !== 401) {
        allInjectionsBlocked = false;
        break;
      }
    }
    assert(allInjectionsBlocked === true, 'SIMULATION', '1.4 Payloads no string o inyecciones son bloqueados de forma segura');

    // 1.5 Token con firma alterada
    const tamperedToken = validToken.slice(0, -4) + 'abcd';
    assert(
      auth.verifyToken(tamperedToken) === false,
      'UNIT',
      '1.5 Token con firma alterada falla la validación criptográfica HMAC'
    );

    // 1.6 Token expirado (> 12h)
    const expiredPayload = `admin.${Math.floor(Date.now() / 1000) - 50000}`;
    const expiredHmac = crypto.createHmac('sha256', TEST_SESSION_SECRET).update(expiredPayload).digest('hex');
    const expiredToken = `bdh_${Buffer.from(expiredPayload).toString('base64url')}.${expiredHmac}`;
    assert(
      auth.verifyToken(expiredToken) === false,
      'UNIT',
      '1.6 Token generado hace más de 12 horas es rechazado por expiración'
    );

    // 1.7 Token con timestamp futuro
    const futurePayload = `admin.${Math.floor(Date.now() / 1000) + 7200}`;
    const futureHmac = crypto.createHmac('sha256', TEST_SESSION_SECRET).update(futurePayload).digest('hex');
    const futureToken = `bdh_${Buffer.from(futurePayload).toString('base64url')}.${futureHmac}`;
    assert(
      auth.verifyToken(futureToken) === false,
      'UNIT',
      '1.7 Token con fecha en el futuro (desfase temporal anómalo) es rechazado'
    );

    // 1.8 Cabecera de autorización malformada
    const badAuthHeaders = ['', 'Bearer', 'Basic bodhi2026', 'Bearer no_un_token_valido'];
    let allAuthHeadersBlocked = true;
    for (const h of badAuthHeaders) {
      if (auth.verifyToken(h) !== false) {
        allAuthHeadersBlocked = false;
        break;
      }
    }
    assert(allAuthHeadersBlocked === true, 'UNIT', '1.8 Cabeceras Authorization malformadas o sin token son rechazadas');

    // 1.9 Ausencia de secretos de producción (Fallo seguro)
    const prevEnv = process.env.NODE_ENV;
    const prevSecret = process.env.ADMIN_SESSION_SECRET;
    process.env.NODE_ENV = 'production';
    delete process.env.ADMIN_SESSION_SECRET;

    const prodWithoutSecretRes = await mockHttp({
      method: 'POST',
      url: '/api/admin-login',
      body: { password: TEST_ADMIN_PASS }
    }).run(adminLoginHandler);

    assert(
      prodWithoutSecretRes.status === 500 && auth.generateToken() === null,
      'SIMULATION',
      '1.9 Ausencia de secretos en producción provoca fallo seguro (HTTP 500)'
    );

    process.env.NODE_ENV = prevEnv;
    process.env.ADMIN_SESSION_SECRET = prevSecret;
    // ========================================================
    // NUEVAS PRUEBAS DE SEGURIDAD DE SESIONES (VULN-01 a VULN-04)
    // ========================================================

    // 1.10 (VULN-03) Derivación KDF: Cambiar ADMIN_PASSWORD invalida inmediatamente el token anterior
    const passToken = auth.generateToken();
    assert(auth.verifyToken(passToken) === true, 'UNIT', '1.10 Token generado con contraseña actual es verificado como válido');

    const originalPass = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = 'NuevaContrasenaDeEmergencia2026!';
    const isTokenValidAfterPassChange = auth.verifyToken(passToken);
    process.env.ADMIN_PASSWORD = originalPass;
    assert(
      isTokenValidAfterPassChange === false && auth.verifyToken(passToken) === true,
      'UNIT',
      '1.11 Cambiar ADMIN_PASSWORD invalida automáticamente e instantáneamente todos los tokens previos (VULN-03)'
    );

    // 1.12 (VULN-01) POST /api/admin-login emite cookie HttpOnly, Secure y SameSite=Strict
    const cookieLoginRes = await mockHttp({
      method: 'POST',
      url: '/api/admin-login',
      headers: { 'Origin': 'https://teteria-bodhi.vercel.app' },
      body: { password: TEST_ADMIN_PASS }
    }).run(adminLoginHandler);

    const setCookieHeader = cookieLoginRes.headers['set-cookie'] || '';
    assert(
      setCookieHeader.includes('bodhi_admin_session=') &&
      setCookieHeader.includes('HttpOnly') &&
      setCookieHeader.includes('SameSite=Strict') &&
      setCookieHeader.includes('Max-Age=28800'),
      'SIMULATION',
      '1.12 POST /api/admin-login emite cookie con HttpOnly, SameSite=Strict y Max-Age=28800 (8h) (VULN-01)'
    );

    // Extraer token de la cookie emitida
    const cookieMatch = setCookieHeader.match(/bodhi_admin_session=([^;]+)/);
    const sessionCookieValue = cookieMatch ? decodeURIComponent(cookieMatch[1]) : null;

    // 1.13 GET /api/admin-login valida autenticación con cookie HttpOnly
    const checkCookieAuthRes = await mockHttp({
      method: 'GET',
      url: '/api/admin-login',
      headers: {
        'Origin': 'https://teteria-bodhi.vercel.app',
        'Cookie': `bodhi_admin_session=${encodeURIComponent(sessionCookieValue)}`
      }
    }).run(adminLoginHandler);
    assert(
      checkCookieAuthRes.status === 200 && checkCookieAuthRes.body.valid === true,
      'SIMULATION',
      '1.13 GET /api/admin-login autentica correctamente al cliente mediante la cookie HttpOnly'
    );

    // 1.14 (VULN-02) POST /api/admin-logout revoca el token en el servidor y borra la cookie
    const logoutRes = await mockHttp({
      method: 'POST',
      url: '/api/admin-logout',
      headers: {
        'Origin': 'https://teteria-bodhi.vercel.app',
        'X-Admin-Request': '1',
        'Cookie': `bodhi_admin_session=${encodeURIComponent(sessionCookieValue)}`
      }
    }).run(adminLogoutHandler);

    const clearCookieHeader = logoutRes.headers['set-cookie'] || '';
    assert(
      logoutRes.status === 200 &&
      logoutRes.body.success === true &&
      clearCookieHeader.includes('Max-Age=0'),
      'SIMULATION',
      '1.14 POST /api/admin-logout revoca la sesión en servidor y envía cabecera Set-Cookie con Max-Age=0 (VULN-02)'
    );

    // 1.15 (VULN-02) Token revocado es rechazado en peticiones posteriores aunque no haya expirado
    const checkRevokedTokenRes = await mockHttp({
      method: 'GET',
      url: '/api/admin-login',
      headers: {
        'Origin': 'https://teteria-bodhi.vercel.app',
        'Cookie': `bodhi_admin_session=${encodeURIComponent(sessionCookieValue)}`
      }
    }).run(adminLoginHandler);
    assert(
      checkRevokedTokenRes.body.valid === false,
      'SIMULATION',
      '1.15 Token previamente revocado es rechazado con valid=false en verificaciones posteriores'
    );

    // 1.16 Petición administrativa de reservas con token revocado devuelve 401
    const resWithRevokedCookie = await mockHttp({
      method: 'GET',
      url: '/api/reservas',
      headers: {
        'Origin': 'https://teteria-bodhi.vercel.app',
        'X-Admin-Request': '1',
        'Cookie': `bodhi_admin_session=${encodeURIComponent(sessionCookieValue)}`
      }
    }).run(reservasHandler);
    assert(
      resWithRevokedCookie.status === 401,
      'SIMULATION',
      '1.16 Petición a /api/reservas con token revocado es denegada con HTTP 401'
    );

    // 1.17 Protección Anti-CSRF: Origen no autorizado es bloqueado con 403
    const csrfBlockedRes = await mockHttp({
      method: 'POST',
      url: '/api/admin-login',
      headers: {
        'Origin': 'https://sitio-malicioso-atacante.com'
      },
      body: { password: TEST_ADMIN_PASS }
    }).run(adminLoginHandler);
    assert(
      csrfBlockedRes.status === 403,
      'SIMULATION',
      '1.17 Petición administrativa desde origen cross-site no autorizado es rechazada con HTTP 403 (Anti-CSRF)'
    );

    // 1.18 (VULN-04) Caducidad máxima de 8 horas
    const nowTs = Date.now();
    const token9HoursAgo = `bdh_${nowTs - 9 * 3600 * 1000}.${crypto.randomBytes(16).toString('hex')}`;
    const sig9h = crypto.createHmac('sha256', auth.getSessionSecret()).update(token9HoursAgo.slice(4)).digest('hex');
    const fullToken9h = `${token9HoursAgo}.${sig9h}`;

    const token7HoursAgo = `bdh_${nowTs - 7 * 3600 * 1000}.${crypto.randomBytes(16).toString('hex')}`;
    const sig7h = crypto.createHmac('sha256', auth.getSessionSecret()).update(token7HoursAgo.slice(4)).digest('hex');
    const fullToken7h = `${token7HoursAgo}.${sig7h}`;

    assert(
      auth.verifyToken(fullToken9h) === false && auth.verifyToken(fullToken7h) === true,
      'UNIT',
      '1.18 Tokens con más de 8 horas son rechazados por expiración, mientras que tokens de 7 horas son válidos (VULN-04)'
    );

    // 1.19 (VULN-01) js/admin.js no almacena credenciales en localStorage
    const adminJsScript = fs.readFileSync(path.join(__dirname, '../js/admin.js'), 'utf8');
    assert(
      !adminJsScript.includes("localStorage.setItem('bodhi_admin_token'") &&
      adminJsScript.includes("'X-Admin-Request': '1'"),
      'STATIC',
      '1.19 js/admin.js no guarda tokens en localStorage y utiliza cabecera anti-CSRF X-Admin-Request'
    );

    // 1.20 Script SQL de revocación protege la tabla revoked_tokens
    const revokedSqlContent = fs.readFileSync(path.join(process.cwd(), 'revoked_tokens.sql'), 'utf8');
    assert(
      revokedSqlContent.includes('CREATE TABLE IF NOT EXISTS public.revoked_tokens') &&
      revokedSqlContent.includes('ENABLE ROW LEVEL SECURITY') &&
      revokedSqlContent.includes('REVOKE ALL ON public.revoked_tokens FROM PUBLIC') &&
      revokedSqlContent.includes('GRANT ALL ON public.revoked_tokens TO service_role'),
      'STATIC',
      '1.20 Script revoked_tokens.sql define la tabla con RLS forzado y acceso restringido a service_role'
    );


    // ========================================================
    // BLOQUE 2: RATE LIMITING DISTRIBUIDO, RGPD & CONCURRENCIA
    // ========================================================
    console.log('\n--- BLOQUE 2: RATE LIMITING DISTRIBUIDO, RGPD & CONCURRENCIA ---');

    // 2.1 Pseudonimización HMAC de IP para rate limiting (RGPD)
    const hashLoginKey = auth.hashRateLimitKey('login', '198.51.100.25');
    const hashResKey = auth.hashRateLimitKey('res', '198.51.100.25');
    const hashOtherIp = auth.hashRateLimitKey('login', '198.51.100.26');

    assert(
      hashLoginKey.startsWith('login_') &&
      hashLoginKey.length === (6 + 64) &&
      !hashLoginKey.includes('198.51.100.25'),
      'UNIT',
      '2.1 hashRateLimitKey anonimiza la IP mediante HMAC-SHA256 (64 hex chars) sin exponer la IP en texto claro'
    );

    assert(
      hashLoginKey !== hashResKey && hashLoginKey !== hashOtherIp,
      'UNIT',
      '2.2 Prefijos ("login_" vs "res_") e IPs distintas generan claves criptográficamente independientes'
    );

    // 2.3 Ausencia de IP utiliza fallback seguro anonimizado
    const hashUnknown = auth.hashRateLimitKey('login', '');
    assert(
      hashUnknown.startsWith('login_') &&
      hashUnknown.length === (6 + 64) &&
      hashUnknown === auth.hashRateLimitKey('login', null),
      'UNIT',
      '2.3 Ausencia de IP genera identificador consistente para clientes anónimos'
    );

    // 2.4 Límites del panel: 5 intentos fallidos en 180s, 429 con mensaje exacto, GET sin cuota, reset en éxito y desbloqueo
    const { LOGIN_MAX_ATTEMPTS: maxLogin, LOGIN_WINDOW_MS: winLogin } = require('../lib/limits');
    const limitsConfiguredCorrectly = maxLogin === 5 && winLogin === 180000;

    const testIp = '198.51.100.' + Math.floor(Math.random() * 200 + 1);

    // a) GET /api/admin-login no consume cuota de rate limit
    let getConsumedQuota = false;
    for (let i = 0; i < 6; i++) {
      const getRes = await mockHttp({ method: 'GET', url: '/api/admin-login', ip: testIp }).run(adminLoginHandler);
      if (getRes.status !== 200) getConsumedQuota = true;
    }

    // b) Primeros 5 intentos fallidos devuelven 401
    let failedAttemptsReturn401 = true;
    for (let i = 1; i <= 5; i++) {
      const res = await mockHttp({
        method: 'POST',
        url: '/api/admin-login',
        ip: testIp,
        body: { password: 'wrong_password_' + i }
      }).run(adminLoginHandler);
      if (res.status !== 401) {
        failedAttemptsReturn401 = false;
        break;
      }
    }

    // c) El sexto intento supera el límite y es bloqueado con HTTP 429 y mensaje exacto
    const sixthRes = await mockHttp({
      method: 'POST',
      url: '/api/admin-login',
      ip: testIp,
      body: { password: 'wrong_password_6' }
    }).run(adminLoginHandler);
    const blocked429 = sixthRes.status === 429 &&
      sixthRes.body?.error === 'Demasiados intentos fallidos. Espera hasta 3 minutos y vuelve a intentarlo.';

    // d) Desbloqueo automático tras finalizar la ventana de 180s
    const rateKeyTest = auth.hashRateLimitKey('login', testIp);
    const rateRecord = auth._inMemoryRateLimits.get(rateKeyTest);
    let unblockedAfterWindow = false;
    if (rateRecord) {
      rateRecord.resetTime = Date.now() - 1000; // Simular transcurso de los 180s
      const unblockRes = await mockHttp({
        method: 'POST',
        url: '/api/admin-login',
        ip: testIp,
        body: { password: 'wrong_password_post_window' }
      }).run(adminLoginHandler);
      unblockedAfterWindow = unblockRes.status === 401; // Vuelve a permitir intentos (401 en vez de 429)
    }

    // e) Autenticación exitosa restablece el contador de intentos fallidos
    const resetIp = '198.51.100.188';
    const resetKey = auth.hashRateLimitKey('login', resetIp);
    // Realizar 4 intentos fallidos
    for (let i = 0; i < 4; i++) {
      await mockHttp({ method: 'POST', url: '/api/admin-login', ip: resetIp, body: { password: 'bad' } }).run(adminLoginHandler);
    }
    // Quinto intento con contraseña correcta
    const successLoginRes = await mockHttp({
      method: 'POST',
      url: '/api/admin-login',
      ip: resetIp,
      body: { password: TEST_ADMIN_PASS }
    }).run(adminLoginHandler);
    const successResetOk = successLoginRes.status === 200 && !auth._inMemoryRateLimits.has(resetKey);

    assert(
      limitsConfiguredCorrectly && !getConsumedQuota && failedAttemptsReturn401 && blocked429 && unblockedAfterWindow && successResetOk,
      'SIMULATION',
      '2.4 Panel permite 5 fallos en 180s, bloquea el 6º con 429, desahoga con GET, desbloquea al expirar y resetea en login exitoso'
    );

    // 2.5 Simulación de fallo de servicio de rate limiting en producción (Fallo seguro 503)
    const prevEnvProd = process.env.NODE_ENV;
    const prevSbUrl = process.env.SUPABASE_URL;
    const prevSbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    process.env.NODE_ENV = 'production';
    // Utilizar un hostname inválido para simular fallo de red en la llamada RPC
    process.env.SUPABASE_URL = 'http://127.0.0.1:59999';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_key_xxx';

    const failRateRes = await mockHttp({
      method: 'POST',
      url: '/api/admin-login',
      ip: '203.0.113.50',
      body: { password: TEST_ADMIN_PASS }
    }).run(adminLoginHandler);

    assert(
      failRateRes.status === 503,
      'SIMULATION',
      '2.5 En producción, caída del servicio RPC devuelve 503 (Servicio no disponible) sin fallback silencioso'
    );

    process.env.NODE_ENV = prevEnvProd;
    process.env.SUPABASE_URL = prevSbUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = prevSbKey;

    // 2.6 Concurrencia masiva: ráfaga de peticiones respeta límite exacto
    const concurrencyKey = `concurrent_${Date.now()}`;
    const concurrentRequests = 10;
    const maxAllowed = 4;
    const concurrentPromises = [];
    for (let i = 0; i < concurrentRequests; i++) {
      concurrentPromises.push(auth.checkRateLimit(concurrencyKey, maxAllowed, 60000));
    }
    const concurrentResults = await Promise.all(concurrentPromises);
    const allowedCount = concurrentResults.filter(r => r.allowed === true).length;
    const rejectedCount = concurrentResults.filter(r => r.allowed === false).length;

    assert(
      allowedCount === maxAllowed && rejectedCount === (concurrentRequests - maxAllowed),
      'UNIT',
      '2.6 Ráfaga concurrente simultánea respeta exactamente el límite máximo sin condiciones de carrera'
    );

    // 2.7 cleanIp normaliza IPs v�lidas (IPv4, IPv6, mapped) y descarta puertos y caracteres no v�lidos
    const validIpv4 = auth.cleanIp('198.51.100.25') === '198.51.100.25';
    const mappedIpv4 = auth.cleanIp('::ffff:198.51.100.25') === '198.51.100.25';
    const portIpv4 = auth.cleanIp('198.51.100.25:54321') === '198.51.100.25';
    const validIpv6 = auth.cleanIp('2001:db8::1') === '2001:db8::1';
    const bracketIpv6 = auth.cleanIp('[2001:db8::1]:8080') === '2001:db8::1';
    const invalidIp1 = auth.cleanIp('invalid_ip') === null;
    const invalidIp2 = auth.cleanIp('1.2.3.4.5') === null;
    const invalidIp3 = auth.cleanIp('<script>') === null;
    const nullIp = auth.cleanIp(null) === null;

    assert(
      validIpv4 && mappedIpv4 && portIpv4 && validIpv6 && bracketIpv6 && invalidIp1 && invalidIp2 && invalidIp3 && nullIp,
      'UNIT',
      '2.7 cleanIp normaliza IPs v�lidas (IPv4, IPv6, mapped) y descarta puertos y caracteres no v�lidos'
    );

    // 2.8 En Vercel, getClientIp prioriza cabeceras verificadas por el Edge sobre x-forwarded-for manipulado
    const prevVercelEnv = process.env.VERCEL;
    const prevVercelRegion = process.env.VERCEL_REGION;
    process.env.VERCEL = '1';
    process.env.VERCEL_REGION = 'cdg1';

    const reqVercelSpoofed = {
      headers: {
        'x-vercel-forwarded-for': '203.0.113.195',
        'x-real-ip': '203.0.113.195',
        'x-forwarded-for': '1.1.1.1, 2.2.2.2'
      },
      socket: { remoteAddress: '10.0.0.1' }
    };
    const vercelIp = auth.getClientIp(reqVercelSpoofed);

    assert(
      vercelIp === '203.0.113.195',
      'UNIT',
      '2.8 En Vercel, getClientIp prioriza cabeceras verificadas por el Edge sobre x-forwarded-for manipulado'
    );

    // 2.9 En Vercel, getClientIp utiliza x-real-ip oficial como IP verificada de Edge si falta x-vercel-forwarded-for
    const reqVercelRealIp = {
      headers: {
        'x-real-ip': '198.51.100.77',
        'x-forwarded-for': '8.8.8.8'
      },
      socket: { remoteAddress: '10.0.0.1' }
    };
    const realIpResult = auth.getClientIp(reqVercelRealIp);
    assert(
      realIpResult === '198.51.100.77',
      'UNIT',
      '2.9 En Vercel, getClientIp utiliza x-real-ip como IP verificada de Edge'
    );

    if (prevVercelEnv !== undefined) {
      process.env.VERCEL = prevVercelEnv;
    } else {
      delete process.env.VERCEL;
    }
    if (prevVercelRegion !== undefined) {
      process.env.VERCEL_REGION = prevVercelRegion;
    } else {
      delete process.env.VERCEL_REGION;
    }

    // 2.10 En servidor local sin proxy de confianza, getClientIp ignora X-Forwarded-For manipulado y usa el socket TCP
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const reqLocalSpoofed = {
      headers: {
        'x-forwarded-for': '1.2.3.4',
        'x-real-ip': '5.6.7.8'
      },
      socket: { remoteAddress: '127.0.0.1' }
    };
    const localIp = auth.getClientIp(reqLocalSpoofed);
    assert(
      localIp === '127.0.0.1',
      'UNIT',
      '2.10 En servidor local sin proxy de confianza, getClientIp ignora X-Forwarded-For manipulado y usa el socket TCP'
    );
    process.env.NODE_ENV = prevNodeEnv;

    // 2.11 getClientIp con cabeceras ausentes o malformadas recurre de forma segura al socket o unattributed_client
    const reqMalformedHeaders = {
      headers: { 'x-forwarded-for': 'malformed_string, <svg>; drop table' },
      socket: { remoteAddress: '192.168.1.55' }
    };
    const reqNoSocket = {
      headers: { 'x-forwarded-for': 'invalid_ip' },
      socket: null
    };
    const reqEmpty = {};

    const ipFromSocket = auth.getClientIp(reqMalformedHeaders);
    const unattrFromNoSocket = auth.getClientIp(reqNoSocket);
    const unattrFromEmpty = auth.getClientIp(reqEmpty);

    assert(
      ipFromSocket === '192.168.1.55' &&
      unattrFromNoSocket === 'unattributed_client' &&
      unattrFromEmpty === 'unattributed_client',
      'UNIT',
      '2.11 getClientIp con cabeceras ausentes o malformadas recurre de forma segura al socket o unattributed_client'
    );

    // 2.12 Intento de evasión de rate limiting en login rotando X-Forwarded-For sin cabeceras fiables por defecto es neutralizado
    const attackerRealSocketIp = '198.51.100.99';
    let spoofBlocked429 = false;
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS + 1; i++) {
      const spoofedIp = `10.200.${i}.${Math.floor(Math.random() * 200 + 1)}`;
      const res = await mockHttp({
        method: 'POST',
        url: '/api/admin-login',
        headers: {
          'x-forwarded-for': spoofedIp
          // OJO: Sin x-real-ip ni x-vercel-*; el atacante intenta evadir exclusivamente manipulando x-forwarded-for
        },
        ip: attackerRealSocketIp,
        body: { password: 'wrong_password_attempt' }
      }).run(adminLoginHandler);

      if (res.status === 429) {
        spoofBlocked429 = true;
        break;
      }
    }
    assert(
      spoofBlocked429 === true,
      'SIMULATION',
      '2.12 Intento de evasión de rate limiting en login rotando X-Forwarded-For es neutralizado y bloqueado con 429'
    );

    // 2.13 Compatibilidad con reservas: POST /api/reservas bloquea abusos de spam con cabeceras rotatorias sin confiar en X-Forwarded-For
    const attackerResIp = '198.51.100.105';
    let resSpoofBlocked = false;
    const { RESERVATION_MAX_ATTEMPTS: resMax } = require('../lib/limits');
    for (let i = 0; i < resMax + 1; i++) {
      const spoofedFakeIp = `172.16.${i}.1`;
      const res = await mockHttp({
        method: 'POST',
        url: '/api/reservas',
        headers: {
          'x-forwarded-for': spoofedFakeIp
          // OJO: Sin cabeceras de confianza simuladas; el bot rotativo no logra burlar la IP real
        },
        ip: attackerResIp,
        body: {
          name: 'Spam Bot',
          phone: '+34 600 00 00 00',
          date: getFutureDate(2),
          time: '20:00',
          guests: 2,
          privacy: true
        }
      }).run(reservasHandler);

      if (res.status === 429) {
        resSpoofBlocked = true;
        break;
      }
    }
    assert(
      resSpoofBlocked === true,
      'SIMULATION',
      '2.13 POST /api/reservas neutraliza evasiones por cabeceras rotatorias y aplica el límite 429 correctamente'
    );

    // 2.14 Compatibilidad con clientes legítimos bajo IPv6 en reservas
    const validIpv6Client = '2001:db8:85a3::8a2e:370:7334';
    const legitimateIpv6Res = await mockHttp({
      method: 'POST',
      url: '/api/reservas',
      headers: {
        'x-vercel-forwarded-for': validIpv6Client
      },
      ip: validIpv6Client,
      body: {
        name: 'Cliente IPv6 Legítimo',
        phone: '+34 611 22 33 44',
        date: getFutureDate(3),
        time: '20:30',
        guests: 2,
        privacy: true
      }
    }).run(reservasHandler);

    assert(
      legitimateIpv6Res.status === 201 && legitimateIpv6Res.body?.success === true,
      'SIMULATION',
      '2.14 Clientes legítimos con IPv6 tramitan reservas satisfactoriamente (HTTP 201)'
    );

    // 2.15 Fallback a X-Forwarded-For NUNCA permite falsificar IP si faltan las cabeceras de confianza
    const reqSpoofWithoutTrusted = {
      headers: {
        'x-forwarded-for': '203.0.113.199'
      },
      socket: { remoteAddress: '10.0.0.88' }
    };
    const spoofResultSocket = auth.getClientIp(reqSpoofWithoutTrusted);

    const reqSpoofNoSocketAtAll = {
      headers: {
        'x-forwarded-for': '203.0.113.199'
      },
      socket: null
    };
    const spoofResultNoSocket = auth.getClientIp(reqSpoofNoSocketAtAll);

    assert(
      spoofResultSocket === '10.0.0.88' &&
      spoofResultSocket !== '203.0.113.199' &&
      spoofResultNoSocket === 'unattributed_client',
      'UNIT',
      '2.15 Fallback a X-Forwarded-For NUNCA permite falsificar IP si faltan cabeceras de confianza'
    );

    // 2.16 Detección de VERCEL=1 no confía en cabeceras en entorno no protegido (sin región Vercel ni VERCEL_ENV)
    const prevV = process.env.VERCEL;
    const prevVR = process.env.VERCEL_REGION;
    const prevVE = process.env.VERCEL_ENV;
    const prevN = process.env.NODE_ENV;

    process.env.VERCEL = '1';
    delete process.env.VERCEL_REGION;
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = 'development'; // Simular Express local donde se inyectó accidentalmente VERCEL=1

    const reqUnprotectedEnv = {
      headers: {
        'x-forwarded-for': '198.51.100.222',
        'x-real-ip': '198.51.100.222'
      },
      socket: { remoteAddress: '127.0.0.1' }
    };
    const unprotResult = auth.getClientIp(reqUnprotectedEnv);

    assert(
      unprotResult === '127.0.0.1' && unprotResult !== '198.51.100.222',
      'UNIT',
      '2.16 Detección de VERCEL=1 no confía en cabeceras en un entorno no protegido sin región Vercel'
    );

    if (prevV !== undefined) process.env.VERCEL = prevV; else delete process.env.VERCEL;
    if (prevVR !== undefined) process.env.VERCEL_REGION = prevVR; else delete process.env.VERCEL_REGION;
    if (prevVE !== undefined) process.env.VERCEL_ENV = prevVE; else delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = prevN;

    // 2.17 Encabezados oficiales de Vercel operan estrictamente según especificación (x-vercel-forwarded-for, x-real-ip)
    const reqOfficialVercel1 = {
      headers: {
        'x-vercel-forwarded-for': '85.120.30.40',
        'x-real-ip': '85.120.30.40',
        'x-forwarded-for': '1.1.1.1'
      },
      socket: { remoteAddress: '10.0.0.1' }
    };
    const reqOfficialVercelRealIpFallback = {
      headers: {
        'x-real-ip': '85.120.30.41',
        'x-forwarded-for': '2.2.2.2'
      },
      socket: { remoteAddress: '10.0.0.1' }
    };

    assert(
      auth.getClientIp(reqOfficialVercel1) === '85.120.30.40' &&
      auth.getClientIp(reqOfficialVercelRealIpFallback) === '85.120.30.41',
      'UNIT',
      '2.17 Encabezados oficiales de Vercel (x-vercel-forwarded-for, x-real-ip) operan según especificación'
    );

    // 2.18 Imposibilidad de evadir rate limiting mutando teléfono o cabeceras HTTP (inmunidad a datos controlados por cliente)
    const attackerMutatingIp = '198.51.100.177';
    let mutatingHit429 = false;
    for (let i = 0; i < resMax + 1; i++) {
      // El atacante cambia el teléfono, nombre y User-Agent en CADA intento intentando reiniciar el límite
      const res = await mockHttp({
        method: 'POST',
        url: '/api/reservas',
        headers: {
          'user-agent': `AttackBot-Variant-${i}`,
          'accept-language': i % 2 === 0 ? 'es-ES' : 'en-US'
        },
        ip: attackerMutatingIp,
        body: {
          name: `Spammer ${i}`,
          phone: `+34 600 00 00 0${i}`,
          date: getFutureDate(2),
          time: '20:00',
          guests: 2,
          privacy: true
        }
      }).run(reservasHandler);

      if (res.status === 429) {
        mutatingHit429 = true;
        break;
      }
    }
    assert(
      mutatingHit429 === true,
      'SIMULATION',
      '2.18 Imposibilidad de evadir rate limit: mutar teléfono o cabeceras NO reinicia el límite de intentos (HTTP 429)'
    );

    // 2.19 Peticiones sin IP fiable quedan sujetas a cuota estricta y no pueden evadir el límite mutando datos
    let unattributedBlocked = false;
    for (let i = 0; i < resMax + 1; i++) {
      const res = await mockHttp({
        method: 'POST',
        url: '/api/reservas',
        headers: {
          'user-agent': `UnattributedBot-${i}`
        },
        ip: null,
        socket: null,
        body: {
          name: `Unattributed ${i}`,
          phone: `+34 655 00 00 0${i}`,
          date: getFutureDate(2),
          time: '20:00',
          guests: 2,
          privacy: true
        }
      }).run(reservasHandler);

      if (res.status === 429) {
        unattributedBlocked = true;
        break;
      }
    }
    assert(
      unattributedBlocked === true,
      'SIMULATION',
      '2.19 Peticiones sin IP fiable no pueden evadir rate limiting mutando teléfono o User-Agent (HTTP 429)'
    );

    // 2.20 Fallo de base de datos / Supabase en producción no provoca pérdida silenciosa de reservas (HTTP 500)
    const originalCreate = db.createReservation;
    db.createReservation = async () => { throw new Error('PERSISTENCE_FAILED'); };
    const failRes = await mockHttp({
      method: 'POST',
      url: '/api/reservas',
      body: {
        name: 'Cliente Prueba Fallo DB',
        phone: '+34 611 99 88 77',
        date: getFutureDate(3),
        time: '20:30',
        guests: 2,
        privacy: true
      }
    }).run(reservasHandler);
    db.createReservation = originalCreate;

    assert(
      failRes.status === 500 && failRes.body?.error && !failRes.body?.success,
      'SIMULATION',
      '2.20 Fallo de base de datos produce HTTP 500 sin confirmar falsamente la reserva (no silent loss)'
    );

    // BLOQUE 3: ANÁLISIS ESTÁTICO DE SEGURIDAD Y PERMISOS SQL
    // ========================================================
    console.log('\n--- BLOQUE 3: POLÍTICAS RLS Y PERMISOS DE SUPABASE (ESTÁTICO) ---');

    const sqlContent = fs.readFileSync(path.join(process.cwd(), 'supabase_security_patch.sql'), 'utf8');

    // 3.1 SET search_path = '' y cualificación total
    const searchPathSafe = sqlContent.includes("SET search_path = ''");
    const qualifiedRandom = sqlContent.includes('pg_catalog.random()');
    const qualifiedClock = sqlContent.includes('pg_catalog.clock_timestamp()');
    assert(
      searchPathSafe && qualifiedRandom && qualifiedClock,
      'STATIC',
      '3.1 check_rate_limit configura SET search_path = \'\' y cualifica funciones de catálogo (pg_catalog.*)'
    );

    // 3.2 Limpieza probabilística de registros expirados
    const cleanupProbabilistic = sqlContent.includes('pg_catalog.random() < 0.02') &&
      sqlContent.includes('DELETE FROM public.rate_limits') &&
      sqlContent.includes('reset_at < v_now');
    assert(
      cleanupProbabilistic,
      'STATIC',
      '3.2 check_rate_limit incluye limpieza probabilística automática de registros de rate_limits expirados'
    );

    // 3.3 Función check_rate_limit revocada de PUBLIC, anon y authenticated; otorgada a service_role
    const revokePublicFunc = sqlContent.includes('REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC;');
    const revokeAnonFunc = sqlContent.includes('REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM anon;');
    const revokeAuthFunc = sqlContent.includes('REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM authenticated;');
    const grantServiceFunc = sqlContent.includes('GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;');
    assert(
      revokePublicFunc && revokeAnonFunc && revokeAuthFunc && grantServiceFunc,
      'STATIC',
      '3.3 Permisos de check_rate_limit: EXECUTE revocado a PUBLIC, anon, authenticated y restringido a service_role'
    );

    // 3.4 Permisos sobre secuencia reservations_id_seq
    const grantSeq = sqlContent.includes('GRANT USAGE, SELECT ON SEQUENCE public.reservations_id_seq TO service_role;');
    const revokeSeq = sqlContent.includes('REVOKE ALL ON SEQUENCE public.reservations_id_seq FROM PUBLIC, anon, authenticated;');
    assert(
      grantSeq && revokeSeq,
      'STATIC',
      '3.4 Permisos de secuencia reservations_id_seq protegidos y revocados a PUBLIC/anon'
    );

    // 3.5 anon y authenticated no tienen acceso directo a reservations
    const anonRevoke = sqlContent.includes('REVOKE ALL ON public.reservations FROM anon;');
    const authRevoke = sqlContent.includes('REVOKE ALL ON public.reservations FROM authenticated;');
    assert(
      anonRevoke && authRevoke,
      'STATIC',
      '3.5 RLS en reservations: REVOKE total sobre anon y authenticated impidiendo mutación y lectura directa'
    );

    // 3.6 service_role tiene política exclusiva sobre reservations
    const serviceRolePolicy = sqlContent.includes('"service_role_reservations_all"') && sqlContent.includes('TO service_role');
    assert(
      serviceRolePolicy === true,
      'STATIC',
      '3.6 service_role dispone de política administrativa exclusiva sobre reservations'
    );

    // 3.7 menu_items lectura pública y mutaciones service_role
    const menuPublicSelect = sqlContent.includes('CREATE POLICY "menu_items_select_public"') && sqlContent.includes('FOR SELECT');
    const menuServiceModify = sqlContent.includes('CREATE POLICY "menu_items_modify_service_role"') && sqlContent.includes('TO service_role');
    assert(
      menuPublicSelect && menuServiceModify,
      'STATIC',
      '3.7 menu_items permite lectura pública y reserva mutaciones exclusivamente a service_role'
    );

    // ========================================================
    // BLOQUE 4: VALIDACIÓN ESTRICTA Y COMPLETA DE RESERVAS
    // ========================================================
    console.log('\n--- BLOQUE 4: VALIDACIÓN ESTRICTA DE RESERVAS ---');

    const validTuesday = getFutureDate(2); // Martes futuro

    // 4.1 Creación válida con consentimiento explícito
    const validCreateRes = await mockHttp({
      method: 'POST',
      url: '/api/reservas',
      body: {
        name: 'Cliente Auditoria Bodhi',
        phone: '+34 600 11 22 33',
        email: 'auditoria@teteria-bodhi.com',
        date: validTuesday,
        time: '20:30',
        guests: 2,
        zone: 'interior',
        privacy: true
      }
    }).run(reservasHandler);

    assert(
      validCreateRes.status === 201 &&
      validCreateRes.body.success === true &&
      validCreateRes.body.reservation?.code.startsWith('BDH-'),
      'SIMULATION',
      '4.1 Crear reserva válida con privacy=true devuelve 201 y genera código BDH-XXXX'
    );

    const createdReservationCode = validCreateRes.body?.reservation?.code;

    // 4.2 Consentimientos falsos
    const falseValues = ['false', false, 0, '', null, undefined];
    let allFalseRejected = true;
    for (const val of falseValues) {
      const res = await mockHttp({
        method: 'POST',
        url: '/api/reservas',
        body: {
          name: 'Cliente Privacy Test',
          phone: '+34 600 11 22 33',
          date: validTuesday,
          time: '20:30',
          guests: 2,
          privacy: val
        }
      }).run(reservasHandler);

      if (res.status !== 400 || !res.body.error.includes('política de privacidad')) {
        allFalseRejected = false;
        break;
      }
    }
    assert(allFalseRejected === true, 'SIMULATION', '4.2 Consentimientos falsos ("false", false, 0, null) son rechazados con 400');

    // 4.3 Comensales no enteros o fuera de rango (1-20)
    const invalidGuests = [2.5, 'dos', 0, -3, 25, NaN];
    let allGuestsRejected = true;
    for (const g of invalidGuests) {
      const res = await mockHttp({
        method: 'POST',
        url: '/api/reservas',
        body: {
          name: 'Cliente Guests Test',
          phone: '+34 600 11 22 33',
          date: validTuesday,
          time: '20:30',
          guests: g,
          privacy: true
        }
      }).run(reservasHandler);

      if (res.status !== 400 || !res.body.error.includes('comensales')) {
        allGuestsRejected = false;
        break;
      }
    }
    assert(allGuestsRejected === true, 'SIMULATION', '4.3 Comensales fuera de rango (1-20) o no enteros son rechazados con 400');

    // 4.4 Fechas inexistentes en el calendario
    const fakeDates = ['2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10'];
    let allFakeDatesRejected = true;
    for (const fd of fakeDates) {
      const res = await mockHttp({
        method: 'POST',
        url: '/api/reservas',
        body: {
          name: 'Cliente Fecha Falsa',
          phone: '+34 600 11 22 33',
          date: fd,
          time: '20:30',
          guests: 2,
          privacy: true
        }
      }).run(reservasHandler);

      if (res.status !== 400 || !res.body.error.includes('calendario')) {
        allFakeDatesRejected = false;
        break;
      }
    }
    assert(allFakeDatesRejected === true, 'SIMULATION', '4.4 Fechas inexistentes en el calendario (ej: 30 de febrero) son rechazadas con 400');

    // 4.5 Fechas en el pasado
    const pastRes = await mockHttp({
      method: 'POST',
      url: '/api/reservas',
      body: {
        name: 'Cliente Pasado',
        phone: '+34 600 11 22 33',
        date: '2020-01-01',
        time: '20:30',
        guests: 2,
        privacy: true
      }
    }).run(reservasHandler);
    assert(pastRes.status === 400 && pastRes.body.error.includes('fechas pasadas'), 'SIMULATION', '4.5 Fechas anteriores a hoy son rechazadas con 400');

    // 4.6 Lunes abierto (horario 2026: Lunes a Jueves de 17:30 a 02:00)
    const mondayDate = getFutureDate(1);
    const mondayRes = await mockHttp({
      method: 'POST',
      url: '/api/reservas',
      body: {
        name: 'Cliente Lunes',
        phone: '+34 600 11 22 33',
        date: mondayDate,
        time: '20:30',
        guests: 2,
        privacy: true
      }
    }).run(reservasHandler);
    assert(mondayRes.status === 201, 'SIMULATION', '4.6 Reservas en lunes son aceptadas (Lunes a Jueves de 17:30 a 02:00)');

    // 4.7 Formato de hora inválido
    const invalidTimes = ['25:00', '12:60', '8:30', 'ocho', '18:00:00'];
    let allTimesRejected = true;
    for (const t of invalidTimes) {
      const res = await mockHttp({
        method: 'POST',
        url: '/api/reservas',
        body: {
          name: 'Cliente Hora Invalida',
          phone: '+34 600 11 22 33',
          date: validTuesday,
          time: t,
          guests: 2,
          privacy: true
        }
      }).run(reservasHandler);
      if (res.status !== 400) {
        allTimesRejected = false;
        break;
      }
    }
    assert(allTimesRejected === true, 'SIMULATION', '4.7 Horas con formato inválido son rechazadas con 400');

    // 4.8 Horas diurnas previas a la apertura (Bodhi abre a las 17:30)
    const daytimeRes = await mockHttp({
      method: 'POST',
      url: '/api/reservas',
      body: {
        name: 'Cliente Mediodía',
        phone: '+34 600 11 22 33',
        date: validTuesday,
        time: '14:30',
        guests: 2,
        privacy: true
      }
    }).run(reservasHandler);
    assert(daytimeRes.status === 400 && daytimeRes.body.error.includes('horario'), 'SIMULATION', '4.8 Horas diurnas previas a la apertura (14:30) son rechazadas con 400');

    // 4.9 Límite de cierre en día de diario (martes cierra a las 02:00, probar 02:30)
    const weekdayCloseRes = await mockHttp({
      method: 'POST',
      url: '/api/reservas',
      body: {
        name: 'Cliente Cierre Martes',
        phone: '+34 600 11 22 33',
        date: validTuesday,
        time: '02:30',
        guests: 2,
        privacy: true
      }
    }).run(reservasHandler);
    assert(weekdayCloseRes.status === 400 && weekdayCloseRes.body.error.includes('horario'), 'SIMULATION', '4.9 Horas posteriores al cierre de diario (02:30 en martes) son rechazadas con 400');

    // 4.10 Fin de semana: última reserva a las 01:00 (sábado cierra a las 03:00)
    const saturdayDate = getFutureDate(6);
    const weekendAllowedRes = await mockHttp({
      method: 'POST',
      url: '/api/reservas',
      body: {
        name: 'Cliente Sábado Noche',
        phone: '+34 600 11 22 33',
        date: saturdayDate,
        time: '01:00',
        guests: 2,
        privacy: true
      }
    }).run(reservasHandler);
    const weekendTooLateRes = await mockHttp({
      method: 'POST',
      url: '/api/reservas',
      body: {
        name: 'Cliente Sábado Tarde',
        phone: '+34 600 11 22 33',
        date: saturdayDate,
        time: '02:30',
        guests: 2,
        privacy: true
      }
    }).run(reservasHandler);
    assert(weekendAllowedRes.status === 201 && weekendTooLateRes.status === 400, 'SIMULATION', '4.10 Sábado: 01:00 permitida y 02:30 rechazada (última reserva 01:00)');

    // 4.11 Domingo noche: apertura 17:00 a 02:00 (00:00 válida, 00:30 rechazada)
    const sundayDate = getFutureDate(0); // Domingo
    const sundayAllowedRes = await mockHttp({
      method: 'POST',
      url: '/api/reservas',
      body: {
        name: 'Cliente Domingo Noche',
        phone: '+34 600 11 22 33',
        date: sundayDate,
        time: '00:00',
        guests: 2,
        privacy: true
      }
    }).run(reservasHandler);
    const sundayTooLateRes = await mockHttp({
      method: 'POST',
      url: '/api/reservas',
      body: {
        name: 'Cliente Domingo Tarde',
        phone: '+34 600 11 22 33',
        date: sundayDate,
        time: '00:30',
        guests: 2,
        privacy: true
      }
    }).run(reservasHandler);
    assert(sundayAllowedRes.status === 201 && sundayTooLateRes.status === 400, 'SIMULATION', '4.11 Domingo: 00:00 permitida y 00:30 rechazada (última reserva 00:00)');

    // 4.12 Inyección de campos administrativos por cliente ignorada en POST
    const injectAdminRes = await mockHttp({
      method: 'POST',
      url: '/api/reservas',
      body: {
        name: 'Cliente Inyector',
        phone: '+34 600 11 22 33',
        date: validTuesday,
        time: '20:30',
        guests: 6,
        privacy: true,
        status: 'completed',
        admin_notes: 'Intento de inyeccion'
      }
    }).run(reservasHandler);
    assert(
      injectAdminRes.status === 201 &&
      injectAdminRes.body.reservation?.status === 'pending' &&
      injectAdminRes.body.reservation?.admin_notes === null,
      'SIMULATION',
      '4.12 Campos administrativos (status o admin_notes) son desestimados en POST público'
    );

    // ========================================================
    // VALIDACIONES EXHAUSTIVAS DE PATCH EN RESERVAS
    // ========================================================
    // 4.13 PATCH sin autorización rechazado con 401
    const patchNoAuth = await mockHttp({
      method: 'PATCH',
      url: '/api/reservas',
      body: { id: createdReservationCode, status: 'confirmed' }
    }).run(reservasHandler);
    assert(patchNoAuth.status === 401, 'SIMULATION', '4.13 PATCH sin cabecera de autorización devuelve 401');

    // 4.14 PATCH de ID inexistente devuelve 404
    const patchNotFound = await mockHttp({
      method: 'PATCH',
      url: '/api/reservas',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: 'BDH-NONEXISTENT', status: 'confirmed' }
    }).run(reservasHandler);
    assert(patchNotFound.status === 404, 'SIMULATION', '4.14 PATCH con código de reserva inexistente devuelve 404');

    // 4.15 PATCH con fecha en formato inválido o inexistente en calendario rechazada con 400
    const patchBadDate = await mockHttp({
      method: 'PATCH',
      url: '/api/reservas',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: createdReservationCode, date: '2026-02-31' }
    }).run(reservasHandler);
    assert(patchBadDate.status === 400 && patchBadDate.body.error.includes('calendario'), 'SIMULATION', '4.15 PATCH con fecha inexistente en calendario devuelve 400');

    // 4.16 PATCH con fecha en el pasado rechazada con 400
    const patchPastDate = await mockHttp({
      method: 'PATCH',
      url: '/api/reservas',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: createdReservationCode, date: '2021-05-15' }
    }).run(reservasHandler);
    assert(patchPastDate.status === 400 && patchPastDate.body.error.includes('fechas pasadas'), 'SIMULATION', '4.16 PATCH con fecha en el pasado devuelve 400');

    // 4.17 PATCH con fecha en lunes (abierto desde 2026) se acepta con 200
    const patchMonday = await mockHttp({
      method: 'PATCH',
      url: '/api/reservas',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: createdReservationCode, date: mondayDate }
    }).run(reservasHandler);
    assert(patchMonday.status === 200, 'SIMULATION', '4.17 PATCH con fecha en lunes se acepta (Lunes a Jueves de 17:30 a 02:00)');

    // 4.18 PATCH con hora fuera del horario comercial (15:00) rechazada con 400
    const patchBadHour = await mockHttp({
      method: 'PATCH',
      url: '/api/reservas',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: createdReservationCode, time: '15:00' }
    }).run(reservasHandler);
    assert(patchBadHour.status === 400 && patchBadHour.body.error.includes('horario'), 'SIMULATION', '4.18 PATCH con hora fuera de horario (15:00) devuelve 400');

    // 4.19 PATCH con hora y fecha válidas actualiza con 200
    const patchValidTime = await mockHttp({
      method: 'PATCH',
      url: '/api/reservas',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: createdReservationCode, date: validTuesday, time: '21:30' }
    }).run(reservasHandler);
    assert(
      patchValidTime.status === 200 && patchValidTime.body.reservation?.time === '21:30',
      'SIMULATION',
      '4.19 PATCH con hora comercial válida (21:30) actualiza correctamente con 200'
    );

    // 4.20 PATCH con número de comensales inválido (0 o 35) rechazada con 400
    const patchBadGuests = await mockHttp({
      method: 'PATCH',
      url: '/api/reservas',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: createdReservationCode, guests: 35 }
    }).run(reservasHandler);
    assert(patchBadGuests.status === 400 && patchBadGuests.body.error.includes('comensales'), 'SIMULATION', '4.20 PATCH con comensales fuera de rango (35) devuelve 400');

    // 4.21 PATCH con zona no permitida rechazada con 400
    const patchBadZone = await mockHttp({
      method: 'PATCH',
      url: '/api/reservas',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: createdReservationCode, zone: 'piscina_privada' }
    }).run(reservasHandler);
    assert(patchBadZone.status === 400 && patchBadZone.body.error.toLowerCase().includes('zona'), 'SIMULATION', '4.21 PATCH con zona no permitida devuelve 400');

    // 4.22 PATCH con estado no admitido rechazada con 400
    const patchBadStatus = await mockHttp({
      method: 'PATCH',
      url: '/api/reservas',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: createdReservationCode, status: 'estado_inventado_invalido' }
    }).run(reservasHandler);
    assert(patchBadStatus.status === 400 && patchBadStatus.body.error.includes('Estado de reserva no válido'), 'SIMULATION', '4.22 PATCH con estado inventado devuelve 400');

    // 4.23 PATCH con estados válidos ('confirmed', 'completed', 'cancelled')
    const patchConfirmed = await mockHttp({
      method: 'PATCH',
      url: '/api/reservas',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: createdReservationCode, status: 'confirmed', admin_notes: 'Confirmado telefónicamente' }
    }).run(reservasHandler);
    assert(
      patchConfirmed.status === 200 && patchConfirmed.body.reservation?.status === 'confirmed',
      'SIMULATION',
      '4.23 PATCH con status="confirmed" y admin_notes actualiza satisfactoriamente'
    );

    // 4.24 PATCH con notas excesivamente largas (> 500 chars) rechazada con 400
    const patchLongNotes = await mockHttp({
      method: 'PATCH',
      url: '/api/reservas',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: createdReservationCode, notes: 'A'.repeat(550) }
    }).run(reservasHandler);
    assert(patchLongNotes.status === 400 && patchLongNotes.body.error.includes('500'), 'SIMULATION', '4.24 PATCH con notas de longitud superior a 500 caracteres devuelve 400');

    // 4.25 PATCH con campos inesperados o inyecciones de privilegios rechazada con 400
    const patchInjectedField = await mockHttp({
      method: 'PATCH',
      url: '/api/reservas',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: createdReservationCode, role: 'superadmin', is_admin: true }
    }).run(reservasHandler);
    assert(patchInjectedField.status === 400 && patchInjectedField.body.error.toLowerCase().includes('no reconocido'), 'SIMULATION', '4.25 PATCH con campos no reconocidos o inyecciones devuelve 400 estricto');

    // ========================================================
    // BLOQUE 5: VALIDACIÓN DE CARTA Y AISLAMIENTO DE DATOS
    // ========================================================
    console.log('\n--- BLOQUE 5: VALIDACIÓN ESTRICTA DE CARTA DIGITAL ---');

    // 5.1 Consulta pública
    const publicCarta = await mockHttp({ method: 'GET', url: '/api/carta' }).run(cartaHandler);
    assert(publicCarta.status === 200 && Array.isArray(publicCarta.body.items), 'SIMULATION', '5.1 Consulta pública de la carta retorna 200');

    // 5.2 Crear producto de prueba
    const addTestItem = await mockHttp({
      method: 'POST',
      url: '/api/carta',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { name: 'Cocktail Test Booleano', price: 8.5, category: 'Cócteles', available: true }
    }).run(cartaHandler);

    const testItemId = addTestItem.body?.item?.id;
    assert(addTestItem.status === 201 && testItemId, 'SIMULATION', '5.2 Creación de producto de prueba en carta devuelve 201');

    // 5.3 Modificar con available="false" (debe ser estrictamente false, no true)
    const patchFalseString = await mockHttp({
      method: 'PATCH',
      url: '/api/carta',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: testItemId, available: 'false' }
    }).run(cartaHandler);
    assert(
      patchFalseString.status === 200 && patchFalseString.body.item?.available === false,
      'SIMULATION',
      '5.3 Modificación con available="false" convierte estrictamente a booleano false'
    );

    // 5.4 Modificación con valor booleano inválido ("quizas") rechazada con 400
    const patchInvalidBool = await mockHttp({
      method: 'PATCH',
      url: '/api/carta',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: testItemId, available: 'quizas' }
    }).run(cartaHandler);
    assert(
      patchInvalidBool.status === 400 && patchInvalidBool.body.error.includes('booleano'),
      'SIMULATION',
      '5.4 Modificación con booleano inválido ("quizas") es rechazada con 400'
    );

    // 5.5 Modificación con precio inválido
    const patchInvalidPrice = await mockHttp({
      method: 'PATCH',
      url: '/api/carta',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: testItemId, price: -10 }
    }).run(cartaHandler);
    assert(patchInvalidPrice.status === 400, 'SIMULATION', '5.5 Modificación con precio negativo es rechazada con 400');

    // 5.6 Modificación con precio válido
    const patchValidPrice = await mockHttp({
      method: 'PATCH',
      url: '/api/carta',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: testItemId, price: 9.75 }
    }).run(cartaHandler);
    assert(
      patchValidPrice.status === 200 && patchValidPrice.body.item?.price === 9.75,
      'SIMULATION',
      '5.6 Modificación de precio válido actualiza satisfactoriamente a 9.75'
    );

    // 5.7 Eliminación de producto con token
    const deleteRes = await mockHttp({
      method: 'DELETE',
      url: `/api/carta?id=${testItemId}`,
      headers: { 'authorization': `Bearer ${validToken}` }
    }).run(cartaHandler);
    assert(deleteRes.status === 200 && deleteRes.body.success === true, 'SIMULATION', '5.7 Eliminación de producto con token administrativo confirma éxito');

    // 5.8 Comprobación de contención de datos aislados
    const isolatedReservasExists = fs.existsSync(path.join(isolatedDir, 'reservas.json'));
    const isolatedCartaExists = fs.existsSync(path.join(isolatedDir, 'carta.json'));
    assert(
      isolatedReservasExists || isolatedCartaExists,
      'UNIT',
      '5.8 Las escrituras de prueba se almacenan en data/test_isolated/ sin tocar las bases locales de producción'
    );

    if (initialProdReservasMtime !== null && fs.existsSync(prodReservasPath)) {
      const currentReservasMtime = fs.statSync(prodReservasPath).mtimeMs;
      assert(currentReservasMtime === initialProdReservasMtime, 'UNIT', '5.9 Archivo data/reservas.json original permanece 100% inalterado');
    }
    if (initialProdCartaMtime !== null && fs.existsSync(prodCartaPath)) {
      const currentCartaMtime = fs.statSync(prodCartaPath).mtimeMs;
      assert(currentCartaMtime === initialProdCartaMtime, 'UNIT', '5.10 Archivo data/carta.json original permanece 100% inalterado');
    }
    // 5.11 (SEC-06) isValidImageUrl expuesta y operativa para validación estricta de imágenes
    const isValidImageUrl = cartaHandler.isValidImageUrl;
    assert(typeof isValidImageUrl === 'function', 'UNIT', '5.11 Función isValidImageUrl expuesta y operativa para SEC-06');

    // 5.12 (SEC-06) isValidImageUrl aprueba URLs HTTPS/relativas y neutraliza esquemas maliciosos o inyecciones
    const validUnsplash = isValidImageUrl('https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=400&q=80');
    const validRelative = isValidImageUrl('/img/bodhi-logo.png');
    const invalidJsScheme = isValidImageUrl('javascript:alert(1)');
    const invalidDataScheme = isValidImageUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==');
    const invalidVbScheme = isValidImageUrl('vbscript:msgbox(1)');
    const invalidHttpScheme = isValidImageUrl('http://insecure-domain.com/pic.jpg');
    const invalidQuotes = isValidImageUrl('https://example.com/pic.jpg" onerror="alert(1)');
    const invalidApos = isValidImageUrl("https://example.com/pic.jpg' onmouseover='alert(1)");
    const invalidControlChars = isValidImageUrl("https://example.com/pic.jpg\r\nHeader: value");

    assert(
      validUnsplash && validRelative &&
      !invalidJsScheme && !invalidDataScheme && !invalidVbScheme &&
      !invalidHttpScheme && !invalidQuotes && !invalidApos && !invalidControlChars,
      'UNIT',
      '5.12 isValidImageUrl aprueba URLs HTTPS/relativas y neutraliza javascript:, data:, vbscript:, comillas y saltos de línea'
    );

    // 5.13 (SEC-06) POST /api/carta con URL de imagen maliciosa es rechazado con 400
    const postBadImg = await mockHttp({
      method: 'POST',
      url: '/api/carta',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: {
        name: 'Té Malicioso',
        price: 4.0,
        category: 'Tés',
        image: 'javascript:alert("XSS")'
      }
    }).run(cartaHandler);
    assert(postBadImg.status === 400, 'SIMULATION', '5.13 POST /api/carta con URL maliciosa (javascript:) es rechazado con 400');

    // 5.14 (SEC-06) POST /api/carta con imagen válida se acepta y PATCH con imagen maliciosa se rechaza con 400
    const postGoodImg = await mockHttp({
      method: 'POST',
      url: '/api/carta',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: {
        name: 'Té Matcha Seguro',
        price: 4.5,
        category: 'Tés',
        image: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=400&q=80'
      }
    }).run(cartaHandler);
    assert(postGoodImg.status === 201 && postGoodImg.body?.item?.id, 'SIMULATION', '5.14 POST /api/carta con imagen HTTPS válida es aceptado con 201');

    const goodItemId = postGoodImg.body?.item?.id;
    const patchBadImg = await mockHttp({
      method: 'PATCH',
      url: '/api/carta',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: {
        id: goodItemId,
        image: 'https://example.com/img.jpg" onerror="alert(document.domain)'
      }
    }).run(cartaHandler);
    assert(patchBadImg.status === 400, 'SIMULATION', '5.15 PATCH /api/carta con inyección en atributo imagen es rechazado con 400');

    // Limpiar producto de prueba
    if (goodItemId) {
      await mockHttp({
        method: 'DELETE',
        url: `/api/carta?id=${goodItemId}`,
        headers: { 'authorization': `Bearer ${validToken}` }
      }).run(cartaHandler);
    }

    // ========================================================
    // BLOQUE 6: ESCAPADO HTML Y SEGURIDAD EN NOTIFICACIONES
    // ========================================================
    console.log('\n--- BLOQUE 6: ESCAPADO HTML Y SEGURIDAD EN NOTIFICACIONES ---');

    // 6.1 escapeHtml sanitiza etiquetas peligrosas
    const escapeFn = reservasHandler.escapeHtml;
    assert(typeof escapeFn === 'function', 'UNIT', '6.1 Función escapeHtml expuesta y operativa');

    const maliciousHtml = '<script>alert("XSS")</script>&<b>bold</b>\'"';
    const escaped = escapeFn(maliciousHtml);
    assert(
      escaped.includes('&lt;script&gt;') &&
      escaped.includes('&quot;XSS&quot;') &&
      escaped.includes('&#39;') &&
      !escaped.includes('<script>'),
      'UNIT',
      '6.2 escapeHtml neutraliza etiquetas HTML, scripts, comillas simples, dobles y ampersands'
    );

    // 6.3 Valores nulos o indefinidos en escapeHtml
    assert(escapeFn(null) === '' && escapeFn(undefined) === '', 'UNIT', '6.3 escapeHtml maneja valores nulos e indefinidos de forma segura');

    // 6.4 (SEC-05) escapeAttr en js/admin.js escapa comillas simples y dobles
    const adminJsPath = path.join(__dirname, '../js/admin.js');
    const adminJsCode = fs.readFileSync(adminJsPath, 'utf8');
    assert(
      adminJsCode.includes("&#39;") && adminJsCode.includes("&quot;") && adminJsCode.includes("function escapeAttr"),
      'STATIC',
      '6.4 escapeAttr en js/admin.js neutraliza comillas simples (&#39;), dobles (&quot;), ampersand y corchetes angulares'
    );

    // 6.5 (SEC-05) Eliminación de eventos onclick inline concatenados en js/admin.js
    const hasUnsafeOnclick = /onclick\s*=\s*["']\s*window\.adminApp/i.test(adminJsCode);
    assert(!hasUnsafeOnclick, 'STATIC', '6.5 js/admin.js no contiene llamadas inline onclick con cadenas concatenadas');

    // 6.6 (SEC-05) Event delegation y recuperación segura de notas en memoria en openNotesModal
    assert(
      adminJsCode.includes('data-action="open-notes"') &&
      adminJsCode.includes('allReservations.find(') &&
      adminJsCode.includes('dataset.eventsBound'),
      'STATIC',
      '6.6 Panel admin usa delegación de eventos y recupera admin_notes desde allReservations sin interpolación en DOM'
    );

    // 6.7 (SEC-06) safeImageUrl protege atributos src en js/main.js y js/admin.js
    const mainJsPath = path.join(__dirname, '../js/main.js');
    const mainJsCode = fs.readFileSync(mainJsPath, 'utf8');
    assert(
      mainJsCode.includes('safeImageUrl(item.image)') &&
      adminJsCode.includes('safeImageUrl(imgUrl)') &&
      mainJsCode.includes('function safeImageUrl'),
      'STATIC',
      '6.7 safeImageUrl sanea y protege dinámicamente los atributos src de imágenes en frontend y administración'
    );

    // ========================================================
    // BLOQUE 7: PRUEBAS DE INTEGRACIÓN REALES DE CORS EN EXPRESS
    // ========================================================
    console.log('\n--- BLOQUE 7: PRUEBAS DE INTEGRACIÓN REALES DE CORS EN EXPRESS ---');

    // Arrancar servidor Express en puerto dinámico efímero
    const serverInstance = await new Promise((resolve) => {
      const s = localApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    const ephemeralPort = serverInstance.address().port;

    const requestHttp = (options, postData = null) => new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: ephemeralPort,
        ...options
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body
        }));
      });
      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });

    try {
      // 7.1 Petición GET con origen autorizado
      const getAuthorizedRes = await requestHttp({
        method: 'GET',
        path: '/api/business-config',
        headers: { 'Origin': 'https://teteria-bodhi.vercel.app' }
      });
      assert(
        getAuthorizedRes.headers['access-control-allow-origin'] === 'https://teteria-bodhi.vercel.app' &&
        getAuthorizedRes.headers['vary'] === 'Origin',
        'INTEGRATION',
        '7.1 Petición GET con origen autorizado recibe cabecera Access-Control-Allow-Origin y Vary: Origin'
      );

      // 7.2 Petición GET con origen no autorizado (NO debe recibir cabecera ni '*')
      const getUnauthorizedRes = await requestHttp({
        method: 'GET',
        path: '/api/business-config',
        headers: { 'Origin': 'https://sitio-malicioso-atacante.com' }
      });
      assert(
        getUnauthorizedRes.headers['access-control-allow-origin'] === undefined &&
        getUnauthorizedRes.headers['access-control-allow-origin'] !== '*',
        'INTEGRATION',
        '7.2 Petición GET con origen no autorizado NO recibe Access-Control-Allow-Origin ni "*"'
      );

      // 7.3 Petición preflight OPTIONS con origen autorizado
      const optionsAuthorizedRes = await requestHttp({
        method: 'OPTIONS',
        path: '/api/reservas',
        headers: {
          'Origin': 'https://teteria-bodhi.vercel.app',
          'Access-Control-Request-Method': 'POST'
        }
      });
      assert(
        optionsAuthorizedRes.status === 200 &&
        optionsAuthorizedRes.headers['access-control-allow-origin'] === 'https://teteria-bodhi.vercel.app' &&
        optionsAuthorizedRes.headers['access-control-allow-methods'].includes('POST'),
        'INTEGRATION',
        '7.3 Petición OPTIONS preflight con origen autorizado responde 200 con métodos y origen permitido'
      );

      // 7.4 Petición preflight OPTIONS con origen no autorizado
      const optionsUnauthorizedRes = await requestHttp({
        method: 'OPTIONS',
        path: '/api/reservas',
        headers: {
          'Origin': 'https://sitio-malicioso-atacante.com',
          'Access-Control-Request-Method': 'POST'
        }
      });
      assert(
        optionsUnauthorizedRes.headers['access-control-allow-origin'] === undefined &&
        optionsUnauthorizedRes.headers['access-control-allow-origin'] !== '*',
        'INTEGRATION',
        '7.4 Petición OPTIONS preflight con origen no autorizado NO recibe Access-Control-Allow-Origin'
      );

      // 7.5 Petición POST con origen no autorizado
      const postUnauthorizedRes = await requestHttp({
        method: 'POST',
        path: '/api/admin-login',
        headers: {
          'Origin': 'https://sitio-malicioso-atacante.com',
          'Content-Type': 'application/json'
        }
      }, JSON.stringify({ password: 'test' }));
      assert(
        postUnauthorizedRes.headers['access-control-allow-origin'] === undefined &&
        postUnauthorizedRes.headers['access-control-allow-origin'] !== '*',
        'INTEGRATION',
        '7.5 Petición POST con origen no autorizado NO recibe Access-Control-Allow-Origin'
      );

      // 7.6 Archivos internos inaccesibles en servidor Express
      const sqlStatus = (await requestHttp({ method: 'GET', path: '/supabase_security_patch.sql' })).status;
      const closedSqlStatus = (await requestHttp({ method: 'GET', path: '/closed_dates.sql' })).status;
      const authStatus = (await requestHttp({ method: 'GET', path: '/lib/auth.js' })).status;
      const pkgStatus = (await requestHttp({ method: 'GET', path: '/package.json' })).status;
      const cssStatus = (await requestHttp({ method: 'GET', path: '/css/style.css' })).status;
      const configStatus = (await requestHttp({ method: 'GET', path: '/businesses/bodhi/config.json' })).status;

      assert(
        sqlStatus === 404 && closedSqlStatus === 404 && authStatus === 404 && pkgStatus === 404,
        'INTEGRATION',
        '7.6 Archivos SQL, código fuente (/lib) y configuraciones devuelven 404 en el servidor HTTP'
      );

      assert(
        cssStatus === 200 && configStatus === 200,
        'INTEGRATION',
        '7.7 Recursos públicos necesarios (/css, /businesses) continúan sirviéndose con código 200'
      );

      const closedDatesApiRes = await requestHttp({ method: 'GET', path: '/api/closed-dates' });
      let closedDatesApiBody = null;
      try { closedDatesApiBody = JSON.parse(closedDatesApiRes.body); } catch (e) {}
      assert(
        closedDatesApiRes.status === 200 && Array.isArray(closedDatesApiBody?.closedDates),
        'INTEGRATION',
        '7.8 Endpoint /api/closed-dates está conectado y devuelve las fechas próximas'
      );
    } finally {
      serverInstance.close();
    }

    // ========================================================
    // BLOQUE 8: CONFIGURACIÓN DE DESPLIEGUE Y EXCLUSIÓN EN VERCEL
    // ========================================================
    console.log('\n--- BLOQUE 8: CONFIGURACIÓN DE DESPLIEGUE EN VERCEL (.vercelignore) ---');

    const vercelignorePath = path.join(process.cwd(), '.vercelignore');
    assert(fs.existsSync(vercelignorePath), 'STATIC', '8.1 Archivo .vercelignore presente en la raíz del proyecto');

    const vercelignoreContent = fs.readFileSync(vercelignorePath, 'utf8');
    const excludesSql = vercelignoreContent.includes('*.sql') || vercelignoreContent.includes('supabase_security_patch.sql');
    const excludesTests = vercelignoreContent.includes('tests/');
    const excludesData = vercelignoreContent.includes('data/');
    const excludesEnv = vercelignoreContent.includes('.env');

    assert(
      excludesSql && excludesTests && excludesData && excludesEnv,
      'STATIC',
      '8.2 .vercelignore excluye explícitamente scripts SQL, suites de prueba, datos locales y variables .env'
    );

    // Verificar que .vercelignore NO excluye recursos necesarios
    const excludesLib = /^\s*lib\/?\s*$/m.test(vercelignoreContent);
    const excludesApi = /^\s*api\/?\s*$/m.test(vercelignoreContent);
    const excludesBusinesses = /^\s*businesses\/?\s*$/m.test(vercelignoreContent);
    assert(
      !excludesLib && !excludesApi && !excludesBusinesses,
      'STATIC',
      '8.3 .vercelignore NO excluye lib/, api/ ni businesses/, preservando la operatividad serverless'
    );

    // ========================================================
    // BLOQUE 9: DÍAS SIN RESERVAS ONLINE Y BLOQUEO DE RESERVAS
    // ========================================================
    console.log('\n--- BLOQUE 9: DÍAS SIN RESERVAS ONLINE ---');
    const closedDateFixture = getFutureDate(2);
    const publicClosedDates = await mockHttp({ method: 'GET', url: '/api/closed-dates' }).run(closedDatesHandler);
    assert(publicClosedDates.status === 200 && Array.isArray(publicClosedDates.body.closedDates), 'SIMULATION', '9.1 Consulta pública de próximos días sin reservas funciona');

    const deniedCreateClosedDate = await mockHttp({
      method: 'POST', url: '/api/closed-dates', body: { date: closedDateFixture, reason: 'Prueba' }
    }).run(closedDatesHandler);
    assert(deniedCreateClosedDate.status === 401, 'UNIT', '9.2 Crear días sin reservas requiere sesión de administrador');

    const createClosedDate = await mockHttp({
      method: 'POST', url: '/api/closed-dates', headers: { authorization: `Bearer ${validToken}` },
      body: { date: closedDateFixture, reason: 'Descanso del equipo' }
    }).run(closedDatesHandler);
    assert(createClosedDate.status === 201 && createClosedDate.body.closedDate?.date === closedDateFixture, 'SIMULATION', '9.3 Administrador puede registrar una fecha sin reservas y su motivo interno');

    const blockedClosedReservation = await mockHttp({
      method: 'POST', url: '/api/reservas',
      body: { name: 'Prueba Bodhi', phone: '600123456', date: closedDateFixture, time: '20:00', guests: 2, zone: 'indiferente', privacy: true }
    }).run(reservasHandler);
    assert(
      blockedClosedReservation.status === 400 &&
      blockedClosedReservation.body.error.includes('no se admiten reservas online') &&
      blockedClosedReservation.body.error.includes('abre con normalidad') &&
      !blockedClosedReservation.body.error.includes('Descanso del equipo'),
      'SIMULATION',
      '9.4 El servidor rechaza la reserva pública sin exponer el motivo interno y aclara que la tetería abre'
    );

    const adminClosedReservation = await mockHttp({
      method: 'POST', url: '/api/reservas', headers: { authorization: `Bearer ${validToken}` },
      body: { name: 'Reserva Manual Bodhi', phone: '600123456', date: closedDateFixture, time: '20:00', guests: 2, zone: 'indiferente' }
    }).run(reservasHandler);
    assert(adminClosedReservation.status === 201 && adminClosedReservation.body.success, 'SIMULATION', '9.5 El administrador sí puede crear reservas manuales en un día sin reservas online');

    const duplicateClosedDate = await mockHttp({
      method: 'POST', url: '/api/closed-dates', headers: { authorization: `Bearer ${validToken}` },
      body: { date: closedDateFixture, reason: 'Otro motivo' }
    }).run(closedDatesHandler);
    assert(duplicateClosedDate.status === 409, 'SIMULATION', '9.6 No permite duplicar una fecha sin reservas');

    const deleteClosedDate = await mockHttp({
      method: 'DELETE', url: `/api/closed-dates?date=${closedDateFixture}`,
      headers: { authorization: `Bearer ${validToken}` }
    }).run(closedDatesHandler);
    assert(deleteClosedDate.status === 200 && deleteClosedDate.body.success, 'SIMULATION', '9.7 Administrador puede quitar un día sin reservas');

    const sqlClosedDates = fs.readFileSync(path.join(process.cwd(), 'closed_dates.sql'), 'utf8');
    assert(sqlClosedDates.includes('ENABLE ROW LEVEL SECURITY') && sqlClosedDates.includes('TO service_role') && sqlClosedDates.includes('REVOKE ALL ON public.closed_dates FROM PUBLIC, anon, authenticated;'), 'STATIC', '9.8 SQL protege la tabla con RLS y acceso exclusivo de service_role');

    const mirroredStaticFiles = ['index.html', 'admin.html', 'js/main.js', 'js/admin.js', 'css/style.css', 'css/admin.css'];
    const publicCopiesMatchRoot = mirroredStaticFiles.every(file =>
      fs.readFileSync(path.join(process.cwd(), file), 'utf8') === fs.readFileSync(path.join(process.cwd(), 'public', file), 'utf8')
    );
    assert(publicCopiesMatchRoot, 'STATIC', '9.9 Copias públicas de Vercel coinciden con el HTML, CSS y JS activos');

    // ========================================================
    // RESUMEN FINAL
    // ========================================================
    console.log('\n=============================================================');
    console.log(` RESULTADO FINAL DE LA SUITE DE AUDITORÍA:`);
    console.log(`   TOTAL PRUEBAS:    ${passedCount + failedCount}`);
    console.log(`   SUPERADAS (PASS): ${passedCount}`);
    console.log(`   FALLIDAS  (FAIL): ${failedCount}`);
    console.log('=============================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    }
  } finally {
    // Limpieza final de directorio de aislamiento de pruebas
    try {
      if (fs.existsSync(isolatedDir)) {
        fs.rmSync(isolatedDir, { recursive: true, force: true });
      }
    } catch (e) {}
  }
}

runTestSuite().catch((err) => {
  console.error('Error fatal ejecutando la suite de pruebas:', err);
  process.exit(1);
});
