const db = require('../lib/db');
const { verifyToken, checkRateLimit } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const https = require('https');

function getClientIp(req) {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) return xForwardedFor.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown_client';
}

/**
 * Notificaciones automáticas al administrador cuando entra una reserva
 */
async function sendAdminNotifications(reservation) {
  const textMsg = `🛎️ ¡NUEVA RESERVA EN TETERÍA BODHI!
👤 Cliente: ${reservation.name}
📞 Teléfono: ${reservation.phone}
📅 Fecha: ${reservation.date} a las ${reservation.time} h
👥 Personas: ${reservation.guests} (Zona ${reservation.zone})
📝 Notas: ${reservation.notes || 'Ninguna'}
🏷️ Código: ${reservation.code}`;

  // 1. WhatsApp al móvil del dueño (vía CallMeBot gratuito)
  const waPhone = process.env.WHATSAPP_NOTIFY_PHONE;
  const waKey = process.env.WHATSAPP_NOTIFY_APIKEY;
  if (waPhone && waKey) {
    try {
      const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(waPhone)}&text=${encodeURIComponent(textMsg)}&apikey=${encodeURIComponent(waKey)}`;
      https.get(url, () => {}).on('error', (e) => console.warn('Error WhatsApp notification:', e.message));
    } catch (e) {}
  }

  // 2. Telegram Bot al móvil del dueño (Gratuito)
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChatId = process.env.TELEGRAM_CHAT_ID;
  if (tgToken && tgChatId) {
    try {
      const payload = JSON.stringify({ chat_id: tgChatId, text: textMsg });
      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${tgToken}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      });
      req.on('error', (e) => console.warn('Error Telegram notification:', e.message));
      req.write(payload);
      req.end();
    } catch (e) {}
  }

  // 3. Email con Resend (Gratis 3.000 emails/mes)
  const resendKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (resendKey && adminEmail) {
    try {
      const payload = JSON.stringify({
        from: 'Tetería Bodhi <onboarding@resend.dev>',
        to: [adminEmail],
        subject: `🛎️ Nueva Reserva: ${reservation.name} (${reservation.guests} pers.)`,
        html: `
          <h2>Nueva reserva recibida en Tetería Bodhi</h2>
          <p><strong>Cliente:</strong> ${reservation.name}</p>
          <p><strong>Teléfono:</strong> <a href="tel:${reservation.phone}">${reservation.phone}</a></p>
          <p><strong>Fecha y Hora:</strong> ${reservation.date} a las ${reservation.time} h</p>
          <p><strong>Comensales:</strong> ${reservation.guests} personas (Zona ${reservation.zone})</p>
          <p><strong>Observaciones:</strong> ${reservation.notes || 'Sin observaciones'}</p>
          <p><strong>Código:</strong> ${reservation.code}</p>
        `
      });
      const req = https.request({
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendKey}`,
          'Content-Length': Buffer.byteLength(payload)
        }
      });
      req.on('error', (e) => console.warn('Error Resend email notification:', e.message));
      req.write(payload);
      req.end();
    } catch (e) {}
  }
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

function isAdmin(req) {
  const auth = req.headers['authorization'] || '';
  return verifyToken(auth);
}

module.exports = async function handler(req, res) {
  setCors(req, res, 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { method, query } = req;

  try {
    // GET: Listado de reservas, estadísticas o test de conexión
    if (method === 'GET') {
      // Diagnóstico de base de datos restringido a administradores
      if (query.health === 'true') {
        if (!isAdmin(req)) {
          return res.status(401).json({ error: 'No autorizado. Se requiere acceso de administrador.' });
        }
        const testRes = await db.testCloudConnection();
        return res.status(200).json({
          status: testRes.ok ? 'connected' : 'error',
          provider: testRes.provider || db.getProviderName(),
          cloudDbConfigured: db.isCloudDb(),
          tableReady: Boolean(testRes.tableReady),
          pgConnected: Boolean(testRes.ok),
          timestamp: new Date().toISOString()
        });
      }

      // Estadísticas protegidas: contienen métricas de aforo e ingresos
      if (query.stats === 'true') {
        if (!isAdmin(req)) {
          return res.status(401).json({ error: 'No autorizado. Se requiere acceso de administrador.' });
        }
        const stats = await db.getStats();
        return res.status(200).json({ success: true, stats });
      }

      // Consulta de listado completo restringida para proteger datos personales de clientes
      if (!isAdmin(req)) {
        return res.status(401).json({
          error: 'No autorizado. Se requiere acceso de administrador.'
        });
      }

      const filters = {
        status: query.status,
        date: query.date,
        search: query.search
      };

      const reservations = await db.getReservations(filters);
      const stats = await db.getStats();
      return res.status(200).json({
        success: true,
        count: reservations.length,
        stats,
        reservations,
        cloudDb: db.isCloudDb()
      });
    }

    // POST: Nueva reserva de cliente o creación desde panel admin
    if (method === 'POST') {
      const clientIp = getClientIp(req);
      const isReqAdmin = isAdmin(req);

      // 1. Protección Anti-Spam: Rate Limiting distribuido (máximo 6 reservas cada 10 min por IP, excepto admin)
      if (!isReqAdmin) {
        const allowed = await checkRateLimit(`res_${clientIp}`, 6, 10 * 60 * 1000);
        if (!allowed) {
          return res.status(429).json({
            error: 'Has enviado varias solicitudes recientemente. Por favor espera unos minutos o contáctanos por WhatsApp.'
          });
        }
      }

      const body = await parseBody(req);

      // 2. Campo trampa Honeypot para detectar bots automatizados
      if (body.b_hp || body.website_url) {
        return res.status(201).json({
          success: true,
          message: 'Reserva registrada con éxito.'
        });
      }

      const { name, phone, email, date, time, guests, zone, notes, privacy } = body;

      if (!name || !phone || !date || !time) {
        return res.status(400).json({
          error: 'Faltan campos obligatorios: por favor indica nombre, teléfono, fecha y hora.'
        });
      }

      // 3. Verificación de RGPD: consentimiento explícito requerido en envíos públicos
      if (!isReqAdmin && !privacy) {
        return res.status(400).json({
          error: 'Es necesario aceptar la política de privacidad para tramitar la reserva conforme a la normativa de protección de datos.'
        });
      }

      // Sanitización estricta y límites de longitud
      const cleanName = String(name).trim().slice(0, 100);
      const cleanPhone = String(phone).trim().slice(0, 30);
      const cleanEmail = email ? String(email).trim().slice(0, 150) : '';
      const cleanDate = String(date).trim().slice(0, 10);
      const cleanTime = String(time).trim().slice(0, 8);
      const cleanNotes = notes ? String(notes).trim().slice(0, 500) : '';

      if (cleanName.length < 2) {
        return res.status(400).json({ error: 'El nombre debe tener al menos 2 caracteres.' });
      }

      if (cleanPhone.length < 6 || !/^[0-9+\s()-]+$/.test(cleanPhone)) {
        return res.status(400).json({ error: 'Por favor introduce un número de teléfono válido.' });
      }

      // Validar formato de fecha YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
        return res.status(400).json({ error: 'Formato de fecha inválido. Utilice el selector de fecha.' });
      }

      // Validar zona en lista blanca
      const allowedZones = ['interior', 'terraza', 'indiferente', 'Interior Lounge', 'Terraza Exterior'];
      const rawZone = String(zone || 'indiferente').trim();
      const cleanZone = allowedZones.includes(rawZone) ? rawZone : 'indiferente';

      // Validar comensales (1 a 20)
      const numGuests = parseInt(guests, 10);
      if (isNaN(numGuests) || numGuests < 1 || numGuests > 20) {
        return res.status(400).json({ error: 'El número de comensales debe estar entre 1 y 20 personas.' });
      }

      const businessSlug = body.business || 'bodhi';

      // Reglas comerciales específicas de Tetería Bodhi
      if (businessSlug === 'bodhi') {
        const dateParts = cleanDate.split('-');
        const testDate = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]), 12, 0, 0);

        // Lunes cerrado por descanso
        if (testDate.getDay() === 1) {
          return res.status(400).json({
            error: 'Los lunes la tetería permanece cerrada por descanso del personal. Por favor selecciona una fecha de martes a domingo.'
          });
        }

        const [h] = cleanTime.split(':').map(Number);
        if (!isNaN(h) && (h >= 4 && h < 16)) {
          return res.status(400).json({
            error: 'Nuestro horario de apertura es de 18:00 a 02:00 h (hasta las 03:00 h los fines de semana).'
          });
        }
      }

      // Los clientes no pueden forzar estados arbitrarios ni notas internas
      const reservationData = {
        name: cleanName,
        phone: cleanPhone,
        email: cleanEmail,
        date: cleanDate,
        time: cleanTime,
        guests: numGuests,
        zone: cleanZone,
        notes: cleanNotes,
        status: isReqAdmin && body.status ? body.status : (numGuests > 4 ? 'pending' : 'confirmed'),
        admin_notes: isReqAdmin && body.admin_notes ? String(body.admin_notes).slice(0, 500) : null
      };

      const newReservation = await db.createReservation(reservationData);

      // Disparar notificaciones asíncronas
      sendAdminNotifications(newReservation).catch(() => {});

      const teteriaWhatsapp = '34600000000';
      const waMsg = encodeURIComponent(
        `¡Hola Bodhi! He solicitado una reserva a nombre de *${newReservation.name}* para el día *${newReservation.date}* a las *${newReservation.time}* (${newReservation.guests} personas, zona ${newReservation.zone}). Código: *${newReservation.code}*. ¡Muchas gracias!`
      );
      const whatsappUrl = `https://wa.me/${teteriaWhatsapp}?text=${waMsg}`;

      return res.status(201).json({
        success: true,
        message: 'Reserva registrada con éxito.',
        reservation: newReservation,
        whatsappUrl,
        cloudDb: db.isCloudDb()
      });
    }

    // PATCH: Modificación de reserva restringida a administradores
    if (method === 'PATCH') {
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'No autorizado.' });
      }

      const body = await parseBody(req);
      const url = new URL(req.url, 'http://localhost');
      const { id, ...updates } = body;
      const targetId = id || query?.id || url.searchParams.get('id');

      if (!targetId) {
        return res.status(400).json({ error: 'Se requiere id de reserva.' });
      }

      // Lista blanca de campos actualizables
      const allowedPatch = ['status', 'admin_notes', 'zone', 'guests', 'date', 'time', 'notes'];
      const filtered = {};
      for (const k of allowedPatch) {
        if (updates[k] !== undefined) {
          filtered[k] = updates[k];
        }
      }

      if (Object.keys(filtered).length === 0) {
        return res.status(400).json({ error: 'No se enviaron campos válidos para actualizar.' });
      }

      const updated = await db.updateReservation(targetId, filtered);
      if (!updated) {
        return res.status(404).json({ error: 'Reserva no encontrada.' });
      }

      return res.status(200).json({ success: true, reservation: updated });
    }

    // DELETE: Cancelación de reserva restringida a administradores
    if (method === 'DELETE') {
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'No autorizado.' });
      }

      const body = await parseBody(req);
      const url = new URL(req.url, 'http://localhost');
      const targetId = query?.id || url.searchParams.get('id') || body?.id;
      if (!targetId) {
        return res.status(400).json({ error: 'Se requiere id de reserva.' });
      }

      const deleted = await db.deleteReservation(targetId);
      if (!deleted) {
        return res.status(404).json({ error: 'Reserva no encontrada.' });
      }

      return res.status(200).json({ success: true, message: 'Reserva eliminada con éxito.' });
    }

    return res.status(405).json({ error: `Método ${method} no permitido.` });
  } catch (error) {
    console.error('[API Reservas Error]:', error.message);
    return res.status(500).json({
      error: 'Error procesando la solicitud en el servidor. Por favor inténtalo de nuevo.'
    });
  }
};
