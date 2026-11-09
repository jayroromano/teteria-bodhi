/**
 * SUITE DE PRUEBAS AUTOMATIZADAS DE SEGURIDAD Y CONCURRENCIA · TETERÍA BODHI
 * Ejecuta validaciones completas sobre autenticación, reservas, carta, configuración y CORS.
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Cargar librerías y módulos del proyecto
const auth = require('../lib/auth');
const db = require('../lib/db');
const { setCors, getAllowedOrigins } = require('../lib/cors');
const adminLoginHandler = require('../api/admin-login');
const reservasHandler = require('../api/reservas');
const cartaHandler = require('../api/carta');
const businessConfigHandler = require('../api/business-config');

// Configuración de entorno de prueba controlado
const TEST_ADMIN_PASS = 'TestSecretBodhiPass_2026_Secure!';
const TEST_SESSION_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

process.env.ADMIN_PASSWORD = TEST_ADMIN_PASS;
process.env.ADMIN_SESSION_SECRET = TEST_SESSION_SECRET;

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

function mockHttp(options = {}) {
  const req = {
    method: options.method || 'GET',
    url: options.url || '/',
    headers: options.headers || {},
    query: options.query || {},
    body: options.body || {},
    socket: { remoteAddress: options.ip || '127.0.0.1' },
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
  const pastTimestamp = Date.now() - (25 * 60 * 60 * 1000); // 25 horas atrás
  const expiredPayload = `${pastTimestamp}.0123456789abcdef0123456789abcdef`;
  const expiredSig = crypto.createHmac('sha256', TEST_SESSION_SECRET).update(expiredPayload).digest('hex');
  const expiredToken = `bdh_${expiredPayload}.${expiredSig}`;

  assert(
    auth.verifyToken(expiredToken) === false,
    '1.7 Token caducado (> 24 horas) es rechazado automáticamente'
  );

  // 1.8 Token con firma incorrecta (secreto diferente)
  const otherSecretSig = crypto.createHmac('sha256', 'otro_secreto_completamente_distinto_xxx').update(`${Date.now()}.0123456789abcdef0123456789abcdef`).digest('hex');
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

  // Restaurar entorno
  process.env.NODE_ENV = prevEnv;
  process.env.ADMIN_SESSION_SECRET = prevSecret;

  // ========================================================
  // BLOQUE 2: RATE LIMITING DISTRIBUIDO SERVERLESS
  // ========================================================
  console.log('\n--- BLOQUE 2: RATE LIMITING DISTRIBUIDO ---');

  // Rate limit por IP desconocida
  const unknownLimit1 = await auth.checkRateLimit('', 2, 60000);
  const unknownLimit2 = await auth.checkRateLimit('', 2, 60000);
  const unknownLimit3 = await auth.checkRateLimit('', 2, 60000);

  assert(
    unknownLimit1 === true && unknownLimit2 === true && unknownLimit3 === false,
    '2.1 Ausencia de IP no desactiva el límite (aplica bucket colectivo unknown_client)'
  );

  // Rate limit específico de login (5 intentos)
  const testIp = '198.51.100.' + Math.floor(Math.random() * 200 + 1);
  let blocked = false;
  for (let i = 0; i < 6; i++) {
    const res = await mockHttp({
      method: 'POST',
      url: '/api/admin-login',
      ip: testIp,
      body: { password: 'wrong' }
    }).run(adminLoginHandler);
    if (res.status === 429) {
      blocked = true;
      break;
    }
  }
  assert(blocked === true, '2.2 Protección contra fuerza bruta bloquea intentos tras límite');

  // ========================================================
  // BLOQUE 3: API DE RESERVAS
  // ========================================================
  console.log('\n--- BLOQUE 3: API DE RESERVAS ---');

  // 3.1 Crear reserva pública válida
  // Fecha futura válida que no sea lunes (ej: martes)
  const targetDate = new Date(Date.now() + 3 * 86400000);
  if (targetDate.getDay() === 1) targetDate.setDate(targetDate.getDate() + 1); // Evitar lunes
  const dateStr = targetDate.toISOString().split('T')[0];

  const createRes = await mockHttp({
    method: 'POST',
    url: '/api/reservas',
    body: {
      name: 'Cliente Auditoria',
      phone: '+34 600 11 22 33',
      email: 'auditoria@teteria-bodhi.com',
      date: dateStr,
      time: '20:30',
      guests: 2,
      zone: 'interior',
      notes: 'Mesa de prueba automatizada',
      privacy: true
    }
  }).run(reservasHandler);

  assert(
    createRes.status === 201 &&
    createRes.body.success === true &&
    createRes.body.reservation &&
    createRes.body.reservation.code.startsWith('BDH-'),
    '3.1 Crear reserva pública válida devuelve 201 y código BDH'
  );

  const createdReservationId = createRes.body?.reservation?.id || createRes.body?.reservation?.code;

  // 3.2 Rechazar reserva inválida (sin RGPD)
  const noPrivacyRes = await mockHttp({
    method: 'POST',
    url: '/api/reservas',
    body: {
      name: 'Cliente Sin RGPD',
      phone: '+34 600 11 22 33',
      date: dateStr,
      time: '20:30',
      guests: 2,
      privacy: false
    }
  }).run(reservasHandler);

  assert(
    noPrivacyRes.status === 400 && noPrivacyRes.body.error.includes('política de privacidad'),
    '3.2 Rechazar reserva sin aceptación explícita de política de privacidad RGPD'
  );

  // 3.3 Rechazar reserva en lunes para Bodhi
  const testMonday = new Date();
  while (testMonday.getDay() !== 1) {
    testMonday.setDate(testMonday.getDate() + 1);
  }
  const mondayStr = testMonday.toISOString().split('T')[0];

  const mondayRes = await mockHttp({
    method: 'POST',
    url: '/api/reservas',
    body: {
      name: 'Cliente Lunes',
      phone: '+34 600 11 22 33',
      date: mondayStr,
      time: '20:30',
      guests: 2,
      privacy: true,
      business: 'bodhi'
    }
  }).run(reservasHandler);

  assert(
    mondayRes.status === 400 && mondayRes.body.error.includes('lunes la tetería permanece cerrada'),
    '3.3 Rechazar reserva en lunes por descanso semanal de Bodhi'
  );

  // 3.4 Consultar listado de reservas sin token
  const getNoTokenRes = await mockHttp({
    method: 'GET',
    url: '/api/reservas'
  }).run(reservasHandler);

  assert(
    getNoTokenRes.status === 401,
    '3.4 Consultar listado de reservas sin token devuelve 401 No Autorizado'
  );

  // 3.5 Consultar estadísticas sin token
  const getStatsNoToken = await mockHttp({
    method: 'GET',
    url: '/api/reservas?stats=true'
  }).run(reservasHandler);

  assert(
    getStatsNoToken.status === 401,
    '3.5 Consultar ?stats=true sin token devuelve 401 No Autorizado'
  );

  // 3.6 Consultar diagnóstico ?health=true sin token
  const getHealthNoToken = await mockHttp({
    method: 'GET',
    url: '/api/reservas?health=true'
  }).run(reservasHandler);

  assert(
    getHealthNoToken.status === 401,
    '3.6 Consultar ?health=true sin token devuelve 401 No Autorizado'
  );

  // 3.7 Consultar reservas con token válido
  const getWithTokenRes = await mockHttp({
    method: 'GET',
    url: '/api/reservas',
    headers: { 'authorization': `Bearer ${validToken}` }
  }).run(reservasHandler);

  assert(
    getWithTokenRes.status === 200 &&
    getWithTokenRes.body.success === true &&
    Array.isArray(getWithTokenRes.body.reservations),
    '3.7 Consultar reservas con token válido devuelve 200 y array de reservas'
  );

  // 3.8 Modificar reserva sin token
  const patchNoToken = await mockHttp({
    method: 'PATCH',
    url: '/api/reservas',
    body: { id: createdReservationId, status: 'confirmed' }
  }).run(reservasHandler);

  assert(
    patchNoToken.status === 401,
    '3.8 Modificar reserva sin token devuelve 401 No Autorizado'
  );

  // 3.9 Modificar reserva con token válido
  const patchWithToken = await mockHttp({
    method: 'PATCH',
    url: '/api/reservas',
    headers: { 'authorization': `Bearer ${validToken}` },
    body: { id: createdReservationId, status: 'confirmed', admin_notes: 'Confirmada en test' }
  }).run(reservasHandler);

  assert(
    patchWithToken.status === 200 &&
    patchWithToken.body.success === true &&
    patchWithToken.body.reservation?.status === 'confirmed',
    '3.9 Modificar reserva con token válido devuelve 200 y actualiza datos'
  );

  // 3.10 Eliminar reserva sin token
  const deleteNoToken = await mockHttp({
    method: 'DELETE',
    url: `/api/reservas?id=${createdReservationId}`
  }).run(reservasHandler);

  assert(
    deleteNoToken.status === 401,
    '3.10 Eliminar reserva sin token devuelve 401 No Autorizado'
  );

  // 3.11 Eliminar reserva con token válido
  const deleteWithToken = await mockHttp({
    method: 'DELETE',
    url: `/api/reservas?id=${createdReservationId}`,
    headers: { 'authorization': `Bearer ${validToken}` }
  }).run(reservasHandler);

  assert(
    deleteWithToken.status === 200 && deleteWithToken.body.success === true,
    '3.11 Eliminar reserva con token válido devuelve 200 y confirma eliminación'
  );

  // 3.12 Simular fallo de base de datos en producción (sin falso éxito)
  const prevProdEnv = process.env.NODE_ENV;
  const prevSupabaseUrl = process.env.SUPABASE_URL;
  const prevSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.NODE_ENV = 'production';
  process.env.SUPABASE_URL = 'https://invalid-non-existent-supabase-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'invalid_service_role_key_xxx';

  const simFailRes = await mockHttp({
    method: 'POST',
    url: '/api/reservas',
    body: {
      name: 'Prueba Fallo DB',
      phone: '+34 611 00 00 00',
      date: dateStr,
      time: '20:30',
      guests: 2,
      privacy: true
    }
  }).run(reservasHandler);

  assert(
    simFailRes.status === 500 && simFailRes.body.success !== true,
    '3.12 En producción, fallo de base de datos devuelve HTTP 500 y NUNCA falso éxito'
  );

  // Restaurar entorno
  process.env.NODE_ENV = prevProdEnv;
  process.env.SUPABASE_URL = prevSupabaseUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = prevSupabaseKey;

  // ========================================================
  // BLOQUE 4: API DE CARTA
  // ========================================================
  console.log('\n--- BLOQUE 4: API DE CARTA ---');

  // 4.1 Consulta pública de la carta
  const getCartaRes = await mockHttp({
    method: 'GET',
    url: '/api/carta'
  }).run(cartaHandler);

  assert(
    getCartaRes.status === 200 &&
    getCartaRes.body.success === true &&
    Array.isArray(getCartaRes.body.items) &&
    getCartaRes.body.items.length > 0,
    '4.1 Consulta pública de la carta permite listar productos sin autenticación'
  );

  // 4.2 Añadir producto sin token
  const addNoToken = await mockHttp({
    method: 'POST',
    url: '/api/carta',
    body: { name: 'Té Nuevo Test', price: 4.5, category: 'Tés' }
  }).run(cartaHandler);

  assert(
    addNoToken.status === 401,
    '4.2 Añadir producto sin token devuelve 401 No Autorizado'
  );

  // 4.3 Añadir producto con token válido
  const addWithToken = await mockHttp({
    method: 'POST',
    url: '/api/carta',
    headers: { 'authorization': `Bearer ${validToken}` },
    body: { name: 'Té Nuevo Test', price: 4.5, category: 'Tés', description: 'Té de prueba' }
  }).run(cartaHandler);

  assert(
    addWithToken.status === 201 &&
    addWithToken.body.success === true &&
    addWithToken.body.item?.name === 'Té Nuevo Test',
    '4.3 Añadir producto con token válido devuelve 201 y crea el producto'
  );

  const createdItemId = addWithToken.body?.item?.id;

  // 4.4 Modificar producto sin token
  const patchCartaNoToken = await mockHttp({
    method: 'PATCH',
    url: '/api/carta',
    body: { id: createdItemId, price: 5.0 }
  }).run(cartaHandler);

  assert(
    patchCartaNoToken.status === 401,
    '4.4 Modificar producto sin token devuelve 401 No Autorizado'
  );

  // 4.5 Modificar producto con token válido
  const patchCartaWithToken = await mockHttp({
    method: 'PATCH',
    url: '/api/carta',
    headers: { 'authorization': `Bearer ${validToken}` },
    body: { id: createdItemId, price: 5.5, available: false }
  }).run(cartaHandler);

  assert(
    patchCartaWithToken.status === 200 &&
    patchCartaWithToken.body.success === true &&
    patchCartaWithToken.body.item?.price === 5.5,
    '4.5 Modificar producto con token válido devuelve 200 y actualiza precio'
  );

  // 4.6 Eliminar producto sin token
  const deleteCartaNoToken = await mockHttp({
    method: 'DELETE',
    url: `/api/carta?id=${createdItemId}`
  }).run(cartaHandler);

  assert(
    deleteCartaNoToken.status === 401,
    '4.6 Eliminar producto sin token devuelve 401 No Autorizado'
  );

  // 4.7 Eliminar producto con token válido
  const deleteCartaWithToken = await mockHttp({
    method: 'DELETE',
    url: `/api/carta?id=${createdItemId}`,
    headers: { 'authorization': `Bearer ${validToken}` }
  }).run(cartaHandler);

  assert(
    deleteCartaWithToken.status === 200 && deleteCartaWithToken.body.success === true,
    '4.7 Eliminar producto con token válido devuelve 200 y confirma eliminación'
  );

  // ========================================================
  // BLOQUE 5: CONFIGURACIÓN DE NEGOCIOS
  // ========================================================
  console.log('\n--- BLOQUE 5: CONFIGURACIÓN DE NEGOCIOS ---');

  // 5.1 Consultar configuración pública de Bodhi
  const getBodhiConfig = await mockHttp({
    method: 'GET',
    url: '/api/business-config'
  }).run(businessConfigHandler);

  assert(
    getBodhiConfig.status === 200 &&
    getBodhiConfig.body.success === true &&
    getBodhiConfig.body.config?.identity?.name === 'Tetería Bodhi',
    '5.1 Consultar configuración pública de Bodhi devuelve identidad correcta'
  );

  // 5.2 Consultar catálogo
  assert(
    Array.isArray(getBodhiConfig.body.catalog) && getBodhiConfig.body.catalog.length > 0,
    '5.2 Consultar configuración devuelve el catálogo público del negocio'
  );

  // 5.3 Comportamiento del parámetro b
  const getOtherConfig = await mockHttp({
    method: 'GET',
    url: '/api/business-config?b=barberia-elite'
  }).run(businessConfigHandler);

  const getInvalidB = await mockHttp({
    method: 'GET',
    url: '/api/business-config?b=inexistente_total_123'
  }).run(businessConfigHandler);

  assert(
    getOtherConfig.status === 200 &&
    getOtherConfig.body.activeSlug === 'barberia-elite' &&
    getInvalidB.status === 200 &&
    getInvalidB.body.activeSlug === 'bodhi',
    '5.3 Parámetro b carga negocio solicitado o recurre a Bodhi por defecto si no existe'
  );

  // 5.4 Comprobar que no se devuelven secretos ni datos sensibles
  const configStr = JSON.stringify(getBodhiConfig.body);
  assert(
    !configStr.includes(TEST_ADMIN_PASS) &&
    !configStr.includes(TEST_SESSION_SECRET) &&
    !configStr.includes('postgres://') &&
    !configStr.includes('service_role'),
    '5.4 Configuración pública no expone credenciales, contraseñas ni secretos'
  );

  // 5.5 Método no permitido (POST/DELETE a business-config)
  const methodNotAllowed = await mockHttp({
    method: 'POST',
    url: '/api/business-config'
  }).run(businessConfigHandler);

  assert(
    methodNotAllowed.status === 405,
    '5.5 Petición POST a /api/business-config rechazada con 405 Método No Permitido'
  );

  // ========================================================
  // BLOQUE 6: CABECERAS CORS Y SEGURIDAD
  // ========================================================
  console.log('\n--- BLOQUE 6: CABECERAS CORS Y SEGURIDAD ---');

  // 6.1 Origen autorizado recibe su propio dominio (no asterisco *)
  const corsAllowed = await mockHttp({
    method: 'GET',
    url: '/api/business-config',
    headers: { 'origin': 'https://teteria-bodhi.vercel.app' }
  }).run(businessConfigHandler);

  assert(
    corsAllowed.headers['access-control-allow-origin'] === 'https://teteria-bodhi.vercel.app' &&
    corsAllowed.headers['vary'] === 'Origin',
    '6.1 Origen autorizado recibe encabezado específico y Vary: Origin'
  );

  // 6.2 Origen no autorizado no recibe Allow-Origin
  const corsBlocked = await mockHttp({
    method: 'GET',
    url: '/api/business-config',
    headers: { 'origin': 'https://sitio-malicioso-no-autorizado.com' }
  }).run(businessConfigHandler);

  assert(
    corsBlocked.headers['access-control-allow-origin'] === undefined,
    '6.2 Origen externo no autorizado no recibe Access-Control-Allow-Origin'
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
    // Restaurar archivos de datos locales a su estado original para evitar datos residuales
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
