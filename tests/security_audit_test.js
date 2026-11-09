/**
 * SUITE DE PRUEBAS AUTOMATIZADAS DE SEGURIDAD Y CONCURRENCIA · TETERÍA BODHI
 * Ejecuta validaciones completas sobre:
 * - Autenticación HMAC y verificación de contraseñas
 * - Rate limiting distribuido, condición de carrera y fallo seguro (503)
 * - Análisis de políticas RLS de Supabase (sin escritura remota)
 * - Validación estricta de reservas (horarios de Bodhi, calendario, comensales, booleanos)
 * - Validación estricta de carta (booleanos estrictos, precios)
 * - CORS restringido y protección de archivos internos en servidor HTTP
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Configuración de entorno de prueba aislado
const TEST_ADMIN_PASS = 'TestSecretBodhiPass_2026_Secure!';
const TEST_SESSION_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

process.env.ADMIN_PASSWORD = TEST_ADMIN_PASS;
process.env.ADMIN_SESSION_SECRET = TEST_SESSION_SECRET;
process.env.ALLOWED_ORIGINS = 'https://teteria-bodhi.vercel.app,http://localhost:3000';

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

function assert(condition, testName, details = '') {
  if (condition) {
    passedCount++;
    results.push({ name: testName, status: 'PASSED', details });
    console.log(`  ✓ [PASSED] ${testName}`);
  } else {
    failedCount++;
    results.push({ name: testName, status: 'FAILED', details });
    console.error(`  ✗ [FAILED] ${testName}: ${details}`);
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

// Helper para calcular fechas válidas futuras según día de la semana
function getFutureDate(targetDayOfWeek) {
  const d = new Date();
  d.setDate(d.getDate() + 1); // Empezar desde mañana
  while (d.getDay() !== targetDayOfWeek) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString().split('T')[0];
}

async function runTestSuite() {
  const reservasFilePath = path.join(process.cwd(), 'data', 'reservas.json');
  const cartaFilePath = path.join(process.cwd(), 'data', 'carta.json');
  let originalReservas = null;
  let originalCarta = null;

  try {
    if (fs.existsSync(reservasFilePath)) originalReservas = fs.readFileSync(reservasFilePath, 'utf8');
    if (fs.existsSync(cartaFilePath)) originalCarta = fs.readFileSync(cartaFilePath, 'utf8');
  } catch (e) {}

  try {
    console.log('\n=============================================================');
    console.log(' INICIANDO SUITE DE AUDITORÍA Y SEGURIDAD · TETERÍA BODHI');
    console.log('=============================================================\n');

    // ========================================================
    // BLOQUE 1: AUTENTICACIÓN Y SESIONES
    // ========================================================
    console.log('--- BLOQUE 1: AUTENTICACIÓN Y SESIONES ---');

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
      '1.3 Contraseña predeterminada "bodhi2026" deshabilitada y rechazada'
    );

    // 1.4 Contraseña no aceptada directamente como token
    assert(
      auth.verifyToken(TEST_ADMIN_PASS) === false &&
      auth.verifyToken('bodhi2026') === false &&
      auth.verifyToken('Bearer ' + TEST_ADMIN_PASS) === false,
      '1.4 Contraseña no es aceptada como token de autorización'
    );

    // 1.5 Token válido verificado correctamente
    assert(
      auth.verifyToken(validToken) === true,
      '1.5 Token firmado legítimo es verificado con éxito'
    );

    // 1.6 Token manipulado (tampered) en firma o payload
    const tamperedToken = validToken.slice(0, -6) + 'abcdef';
    assert(
      auth.verifyToken(tamperedToken) === false,
      '1.6 Token manipulado en la firma es detectado y rechazado'
    );

    // 1.7 Token caducado (> 24h)
    const pastTimestamp = Date.now() - (25 * 60 * 60 * 1000);
    const expiredPayload = `${pastTimestamp}.0123456789abcdef0123456789abcdef`;
    const expiredSig = crypto.createHmac('sha256', TEST_SESSION_SECRET).update(expiredPayload).digest('hex');
    const expiredToken = `bdh_${expiredPayload}.${expiredSig}`;

    assert(
      auth.verifyToken(expiredToken) === false,
      '1.7 Token caducado (> 24 horas) es rechazado automáticamente'
    );

    // 1.8 Token con firma incorrecta (secreto diferente)
    const otherSecretSig = crypto.createHmac('sha256', 'otro_secreto_ajeno_1234567890123456').update(`${Date.now()}.0123456789abcdef0123456789abcdef`).digest('hex');
    const wrongSigToken = `bdh_${Date.now()}.0123456789abcdef0123456789abcdef.${otherSecretSig}`;

    assert(
      auth.verifyToken(wrongSigToken) === false,
      '1.8 Token firmado con secreto ajeno es rechazado'
    );

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
      prodWithoutSecretRes.status === 500 &&
      auth.generateToken() === null,
      '1.9 Ausencia de secretos en producción provoca fallo seguro (HTTP 500)'
    );

    process.env.NODE_ENV = prevEnv;
    process.env.ADMIN_SESSION_SECRET = prevSecret;

    // ========================================================
    // BLOQUE 2: RATE LIMITING DISTRIBUIDO & CONCURRENCIA
    // ========================================================
    console.log('\n--- BLOQUE 2: RATE LIMITING DISTRIBUIDO & CONCURRENCIA ---');

    // 2.1 Ausencia de IP
    const unknownLimit1 = await auth.checkRateLimit('', 2, 60000);
    const unknownLimit2 = await auth.checkRateLimit('', 2, 60000);
    const unknownLimit3 = await auth.checkRateLimit('', 2, 60000);

    assert(
      unknownLimit1.allowed === true && unknownLimit2.allowed === true && unknownLimit3.allowed === false,
      '2.1 Ausencia de IP no desactiva el límite (aplica bucket colectivo unknown_client)'
    );

    // 2.2 Bloqueo 429 por límite superado
    const testIp = '198.51.100.' + Math.floor(Math.random() * 200 + 1);
    let blocked429 = false;
    for (let i = 0; i < 6; i++) {
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
    assert(blocked429 === true, '2.2 Intentos reiterados devuelven código 429 (Límite superado)');

    // 2.3 Simulación de fallo de servicio de rate limiting en producción (Fallo seguro 503)
    const prevEnvProd = process.env.NODE_ENV;
    const prevSbUrl = process.env.SUPABASE_URL;
    const prevSbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    process.env.NODE_ENV = 'production';
    // URL no resoluble para simular caída del servicio RPC en producción
    process.env.SUPABASE_URL = 'https://unreachable-rate-limit-host.internal';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_key_xxx';

    const failRateRes = await mockHttp({
      method: 'POST',
      url: '/api/admin-login',
      ip: '203.0.113.50',
      body: { password: TEST_ADMIN_PASS }
    }).run(adminLoginHandler);

    assert(
      failRateRes.status === 503,
      '2.3 En producción, caída del servicio RPC devuelve 503 (Servicio no disponible) sin caer a memoria silenciosamente'
    );

    process.env.NODE_ENV = prevEnvProd;
    process.env.SUPABASE_URL = prevSbUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = prevSbKey;

    // 2.4 Peticiones simultáneas concurrentes al contador
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
      '2.4 Ráfaga de peticiones simultáneas concurrentes respeta exactamente el límite máximo sin condiciones de carrera'
    );

    // ========================================================
    // BLOQUE 3: ANÁLISIS DE POLÍTICAS RLS SUPABASE
    // ========================================================
    console.log('\n--- BLOQUE 3: POLÍTICAS RLS Y PERMISOS DE SUPABASE (ESTÁTICO) ---');

    const sqlContent = fs.readFileSync(path.join(process.cwd(), 'supabase_security_patch.sql'), 'utf8');

    // 3.1 anon no tiene INSERT directo en reservations
    const anonInsertPolicy = /CREATE\s+POLICY[^\n]+ON\s+public\.reservations\s+FOR\s+INSERT\s+TO\s+[^;]*anon/i.test(sqlContent);
    assert(
      !anonInsertPolicy && sqlContent.includes('REVOKE ALL ON public.reservations FROM anon;'),
      '3.1 El script revoca explícitamente y no concede permiso de INSERT directo a anon sobre reservations'
    );

    // 3.2 anon y authenticated no tienen SELECT sobre reservations
    const anonSelectPolicy = /CREATE\s+POLICY[^\n]+ON\s+public\.reservations\s+FOR\s+SELECT\s+TO\s+[^;]*anon/i.test(sqlContent);
    assert(
      !anonSelectPolicy && sqlContent.includes('REVOKE ALL ON public.reservations FROM authenticated;'),
      '3.2 El script impide lectura de reservas a usuarios anónimos y authenticated'
    );

    // 3.3 service_role tiene acceso garantizado en reservations
    const serviceRolePolicy = sqlContent.includes('"service_role_reservations_all"') && sqlContent.includes('TO service_role');
    assert(
      serviceRolePolicy === true,
      '3.3 service_role dispone de política administrativa exclusiva sobre reservations'
    );

    // 3.4 menu_items permite lectura pública pero mutaciones solo service_role
    const menuPublicSelect = sqlContent.includes('CREATE POLICY "menu_items_select_public"') && sqlContent.includes('FOR SELECT');
    const menuServiceModify = sqlContent.includes('CREATE POLICY "menu_items_modify_service_role"') && sqlContent.includes('TO service_role');
    assert(
      menuPublicSelect && menuServiceModify,
      '3.4 menu_items permite lectura pública y reserva mutaciones exclusivamente a service_role'
    );

    // 3.5 Función check_rate_limit revocada de PUBLIC/anon y concedida a service_role
    const revokePublic = sqlContent.includes('REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC;');
    const revokeAnon = sqlContent.includes('REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM anon;');
    const grantService = sqlContent.includes('GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;');
    assert(
      revokePublic && revokeAnon && grantService,
      '3.5 Función check_rate_limit revocada de PUBLIC y anon, restringida a service_role con SECURITY DEFINER seguro'
    );

    // ========================================================
    // BLOQUE 4: VALIDACIÓN ESTRICTA DE RESERVAS
    // ========================================================
    console.log('\n--- BLOQUE 4: VALIDACIÓN ESTRICTA DE RESERVAS ---');

    // 4.1 Creación válida con consentimiento explícito
    const validTuesday = getFutureDate(2); // Martes
    const validCreateRes = await mockHttp({
      method: 'POST',
      url: '/api/reservas',
      body: {
        name: 'Cliente Auditoria',
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
      '4.1 Crear reserva válida con privacy=true devuelve 201'
    );

    // 4.2 Comprobación de consentimientos falsos: "false", false, 0, null
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
    assert(allFalseRejected === true, '4.2 Consentimientos falsos ("false", false, 0, null) son estrictamente rechazados con 400');

    // 4.3 Comensales no enteros o inválidos
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
    assert(allGuestsRejected === true, '4.3 Comensales no enteros, decimales o fuera de rango (1-20) son rechazados con 400');

    // 4.4 Fechas inexistentes en el calendario (ej: 2026-02-30, 2026-04-31)
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
    assert(allFakeDatesRejected === true, '4.4 Fechas inexistentes en el calendario (ej: 30 de febrero) son rechazadas con 400');

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

    assert(
      pastRes.status === 400 && pastRes.body.error.includes('fechas pasadas'),
      '4.5 Fechas anteriores a hoy son rechazadas con 400'
    );

    // 4.6 Lunes cerrado por descanso
    const mondayDate = getFutureDate(1); // Lunes
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

    assert(
      mondayRes.status === 400 && mondayRes.body.error.includes('lunes la tetería permanece cerrada'),
      '4.6 Reservas en lunes son rechazadas por descanso semanal de Bodhi'
    );

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
    assert(allTimesRejected === true, '4.7 Horas con formato inválido o fuera del formato 24h son rechazadas con 400');

    // 4.8 Horas fuera de apertura diurna (Bodhi abre a las 18:00)
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

    assert(
      daytimeRes.status === 400 && daytimeRes.body.error.includes('horario'),
      '4.8 Horas diurnas previas a la apertura (14:30) son rechazadas con 400'
    );

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

    assert(
      weekdayCloseRes.status === 400 && weekdayCloseRes.body.error.includes('horario'),
      '4.9 Horas posteriores al cierre de diario (02:30 en martes) son rechazadas con 400'
    );

    // 4.10 Horario ampliado en fin de semana (sábado cierra a las 03:00, 02:30 es válida)
    const saturdayDate = getFutureDate(6); // Sábado
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

    assert(
      weekendAllowedRes.status === 201,
      '4.10 Madrugada de fin de semana (02:30 en sábado) permitida por cierre a las 03:00 h'
    );

    // 4.11 No permitir eludir reglas pasando business arbitrario
    const bypassBusinessRes = await mockHttp({
      method: 'POST',
      url: '/api/reservas',
      body: {
        name: 'Cliente Bypass',
        phone: '+34 600 11 22 33',
        date: mondayDate, // Lunes
        time: '20:30',
        guests: 2,
        privacy: true,
        business: 'otro_negocio_inventado'
      }
    }).run(reservasHandler);

    assert(
      bypassBusinessRes.status === 400 && bypassBusinessRes.body.error.includes('lunes'),
      '4.11 Parámetro business arbitrario del cliente no permite saltarse las reglas de descanso de Bodhi'
    );

    // 4.12 Inyección de campos administrativos por cliente ignorada
    const injectAdminRes = await mockHttp({
      method: 'POST',
      url: '/api/reservas',
      body: {
        name: 'Cliente Inyector',
        phone: '+34 600 11 22 33',
        date: validTuesday,
        time: '20:30',
        guests: 6, // > 4 normalmente es pending
        privacy: true,
        status: 'completed', // Intento de forzar completed
        admin_notes: 'Intento de inyeccion'
      }
    }).run(reservasHandler);

    assert(
      injectAdminRes.status === 201 &&
      injectAdminRes.body.reservation?.status === 'pending' &&
      injectAdminRes.body.reservation?.admin_notes === null,
      '4.12 Campos administrativos (status forzado o admin_notes) son desestimados en envíos públicos'
    );

    // 4.13 Modificación con estado no permitido en PATCH
    const invalidPatchRes = await mockHttp({
      method: 'PATCH',
      url: '/api/reservas',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: validCreateRes.body.reservation.code, status: 'estado_inventado_invalido' }
    }).run(reservasHandler);

    assert(
      invalidPatchRes.status === 400 && invalidPatchRes.body.error.includes('Estado de reserva no válido'),
      '4.13 Modificación de estado no admitido en PATCH es rechazada con 400'
    );

    // ========================================================
    // BLOQUE 5: VALIDACIÓN ESTRICTA DE CARTA DIGITAL
    // ========================================================
    console.log('\n--- BLOQUE 5: VALIDACIÓN ESTRICTA DE CARTA DIGITAL ---');

    // 5.1 Consulta pública
    const publicCarta = await mockHttp({ method: 'GET', url: '/api/carta' }).run(cartaHandler);
    assert(publicCarta.status === 200 && Array.isArray(publicCarta.body.items), '5.1 Consulta pública de la carta retorna 200');

    // 5.2 Crear producto de prueba
    const addTestItem = await mockHttp({
      method: 'POST',
      url: '/api/carta',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { name: 'Cocktail Test Booleano', price: 8.5, category: 'Cócteles', available: true }
    }).run(cartaHandler);

    const testItemId = addTestItem.body?.item?.id;

    // 5.3 Modificar con disponible="false" (debe ser estrictamente false, no true)
    const patchFalseString = await mockHttp({
      method: 'PATCH',
      url: '/api/carta',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: testItemId, available: 'false' }
    }).run(cartaHandler);

    assert(
      patchFalseString.status === 200 &&
      patchFalseString.body.item?.available === false,
      '5.2 Modificación con available="false" convierte estrictamente a booleano false (no a true)'
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
      '5.3 Modificación con booleano inválido ("quizas") es rechazada con 400 sin ignorarse silenciosamente'
    );

    // 5.5 Modificación con precio inválido (negativo o no numérico) rechazada con 400
    const patchInvalidPrice = await mockHttp({
      method: 'PATCH',
      url: '/api/carta',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: testItemId, price: -10 }
    }).run(cartaHandler);

    const patchNanPrice = await mockHttp({
      method: 'PATCH',
      url: '/api/carta',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: testItemId, price: 'diez' }
    }).run(cartaHandler);

    assert(
      patchInvalidPrice.status === 400 && patchNanPrice.status === 400,
      '5.4 Modificación con precio negativo o no numérico es rechazada con 400'
    );

    // 5.6 Modificación con precio válido
    const patchValidPrice = await mockHttp({
      method: 'PATCH',
      url: '/api/carta',
      headers: { 'authorization': `Bearer ${validToken}` },
      body: { id: testItemId, price: 9.75 }
    }).run(cartaHandler);

    assert(
      patchValidPrice.status === 200 && patchValidPrice.body.item?.price === 9.75,
      '5.5 Modificación de precio válido actualiza satisfactoriamente a 9.75'
    );

    // 5.7 Eliminación de producto con token
    const deleteRes = await mockHttp({
      method: 'DELETE',
      url: `/api/carta?id=${testItemId}`,
      headers: { 'authorization': `Bearer ${validToken}` }
    }).run(cartaHandler);

    assert(
      deleteRes.status === 200 && deleteRes.body.success === true,
      '5.6 Eliminación de producto con token administrativo confirma éxito'
    );

    // ========================================================
    // BLOQUE 6: CABECERAS CORS & SERVIDOR LOCAL
    // ========================================================
    console.log('\n--- BLOQUE 6: CABECERAS CORS & SERVIDOR LOCAL ---');

    // 6.1 Origen autorizado explícito
    const corsGood = await mockHttp({
      method: 'GET',
      url: '/api/business-config',
      headers: { origin: 'https://teteria-bodhi.vercel.app' }
    }).run(businessConfigHandler);

    assert(
      corsGood.headers['access-control-allow-origin'] === 'https://teteria-bodhi.vercel.app' &&
      corsGood.headers['vary'] === 'Origin',
      '6.1 Origen explícitamente autorizado recibe cabecera y Vary: Origin'
    );

    // 6.2 Dominios .vercel.app arbitrarios rechazados
    const corsBadVercel = await mockHttp({
      method: 'GET',
      url: '/api/business-config',
      headers: { origin: 'https://otro-proyecto-aleatorio.vercel.app' }
    }).run(businessConfigHandler);

    assert(
      corsBadVercel.headers['access-control-allow-origin'] === undefined,
      '6.2 Dominios .vercel.app arbitrarios no autorizados son rechazados'
    );

    // 6.3 Archivos internos y scripts SQL inaccesibles en servidor HTTP
    const serverInstance = await new Promise((resolve) => {
      const s = localApp.listen(3098, () => resolve(s));
    });

    const httpGetStatus = (urlPath) => new Promise((resolve) => {
      http.get('http://127.0.0.1:3098' + urlPath, (res) => {
        resolve(res.statusCode);
      }).on('error', () => resolve(500));
    });

    const sqlStatus = await httpGetStatus('/supabase_security_patch.sql');
    const authStatus = await httpGetStatus('/lib/auth.js');
    const pkgStatus = await httpGetStatus('/package.json');
    const cssStatus = await httpGetStatus('/css/style.css');
    const configStatus = await httpGetStatus('/businesses/bodhi/config.json');

    serverInstance.close();

    assert(
      sqlStatus === 404 && authStatus === 404 && pkgStatus === 404,
      '6.3 Archivos SQL, código fuente (/lib) y configuraciones internas devuelven 404 en el servidor HTTP'
    );

    assert(
      cssStatus === 200 && configStatus === 200,
      '6.4 Recursos públicos necesarios (/css, /businesses) continúan sirviéndose con código 200'
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
    // Restaurar archivos locales a su estado prístino
    try {
      if (originalReservas !== null && fs.existsSync(reservasFilePath)) {
        fs.writeFileSync(reservasFilePath, originalReservas, 'utf8');
      }
      if (originalCarta !== null && fs.existsSync(cartaFilePath)) {
        fs.writeFileSync(cartaFilePath, originalCarta, 'utf8');
      }
    } catch (e) {}
  }
}

runTestSuite().catch((err) => {
  console.error('Error fatal ejecutando la suite de pruebas:', err);
  process.exit(1);
});
