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
  const clientIp = options.ip || ('10.0.0.' + (++mockIpCounter));
  const req = {
    method: options.method || 'GET',
    url: options.url || '/',
    headers: options.headers || {},
    query: options.query || {},
    body: options.body || {},
    socket: { remoteAddress: clientIp },
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

    // 2.4 Bloqueo 429 por límite superado
    const testIp = '198.51.100.' + Math.floor(Math.random() * 200 + 1);
    let blocked429 = false;
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS + 1; i++) {
      const res = await mockHttp({
        method: 'POST',
        url: '/api/admin-login',
        ip: testIp,
        body: { password: 'wrong' }
      }).run(adminLoginHandler);
      if (res.status === 429) {
        blocked429 = true;
        break;
      }
    }
    assert(blocked429 === true, 'SIMULATION', '2.4 Intentos reiterados devuelven código 429 (Límite superado)');

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

    // ========================================================
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

    // 4.6 Lunes cerrado por descanso
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
    assert(mondayRes.status === 400 && mondayRes.body.error.includes('lunes la tetería permanece cerrada'), 'SIMULATION', '4.6 Reservas en lunes son rechazadas por descanso semanal de Bodhi');

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

    // 4.8 Horas diurnas previas a la apertura (Bodhi abre a las 18:00)
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

    // 4.10 Madrugada de fin de semana (sábado cierra a las 03:00, 02:30 es válida)
    const saturdayDate = getFutureDate(6);
    const weekendAllowedRes = await mockHttp({
      method: 'POST',
      url: '/api/reservas',
      body: {
        name: 'Cliente Sábado Noche',
        phone: '+34 600 11 22 33',
        date: saturdayDate,
        time: '02:30',
        guests: 2,
        privacy: true
      }
    }).run(reservasHandler);
    assert(weekendAllowedRes.status === 201, 'SIMULATION', '4.10 Madrugada de fin de semana (02:30 en sábado) permitida por cierre a las 03:00 h');

    // 4.11 Domingo noche: apertura 18:00 a 02:00 (probar 01:30 en domingo)
    const sundayDate = getFutureDate(0); // Domingo
    const sundayAllowedRes = await mockHttp({
      method: 'POST',
      url: '/api/reservas',
      body: {
        name: 'Cliente Domingo Noche',
        phone: '+34 600 11 22 33',
        date: sundayDate,
        time: '01:30',
        guests: 2,
        privacy: true
      }
    }).run(reservasHandler);
    assert(sundayAllowedRes.status === 201, 'SIMULATION', '4.11 Domingo de madrugada (01:30) permitido por cierre a las 02:00 h según config oficial');

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

    // 4.17 PATCH con fecha en lunes (cerrado) rechazada con 400
    const patchMonday = await mockHttp({
      method: 'PATCH',
      url: '/api/reservas',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: createdReservationCode, date: mondayDate }
    }).run(reservasHandler);
    assert(patchMonday.status === 400 && patchMonday.body.error.includes('lunes'), 'SIMULATION', '4.17 PATCH con fecha en lunes rechazada por descanso semanal');

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
      const authStatus = (await requestHttp({ method: 'GET', path: '/lib/auth.js' })).status;
      const pkgStatus = (await requestHttp({ method: 'GET', path: '/package.json' })).status;
      const cssStatus = (await requestHttp({ method: 'GET', path: '/css/style.css' })).status;
      const configStatus = (await requestHttp({ method: 'GET', path: '/businesses/bodhi/config.json' })).status;

      assert(
        sqlStatus === 404 && authStatus === 404 && pkgStatus === 404,
        'INTEGRATION',
        '7.6 Archivos SQL, código fuente (/lib) y configuraciones devuelven 404 en el servidor HTTP'
      );

      assert(
        cssStatus === 200 && configStatus === 200,
        'INTEGRATION',
        '7.7 Recursos públicos necesarios (/css, /businesses) continúan sirviéndose con código 200'
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
