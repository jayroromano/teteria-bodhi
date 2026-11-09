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
        const rateResult = await checkRateLimit(`res_${clientIp}`, 6, 10 * 60 * 1000);
        if (!rateResult.allowed) {
          if (rateResult.status === 503 || rateResult.unavailable) {
            return res.status(503).json({
              error: 'El servicio de reservas no está disponible en este momento. Por favor inténtalo de nuevo más tarde o contáctanos por WhatsApp.'
            });
          }
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
      // No convertir cadenas indiscriminadamente: "false" debe ser false
      const isPrivacyAccepted = privacy === true || privacy === 'true';
      if (!isReqAdmin && !isPrivacyAccepted) {
        return res.status(400).json({
          error: 'Es necesario aceptar la política de privacidad para tramitar la reserva conforme a la normativa de protección de datos.'
        });
      }

      // 4. Validación de comensales: debe ser un número entero válido entre 1 y 20
      const guestsNum = Number(guests);
      if (!Number.isInteger(guestsNum) || guestsNum < 1 || guestsNum > 20) {
        return res.status(400).json({
          error: 'El número de comensales debe ser un número entero entre 1 y 20 personas.'
        });
      }

      // 5. Sanitización estricta y límites de longitud
      const cleanName = String(name).trim().slice(0, 100);
      const cleanPhone = String(phone).trim().slice(0, 30);
      const cleanEmail = email ? String(email).trim().slice(0, 150) : '';
      const cleanDate = String(date).trim();
      const cleanTime = String(time).trim();
      const cleanNotes = notes ? String(notes).trim().slice(0, 500) : '';

      if (cleanName.length < 2) {
        return res.status(400).json({ error: 'El nombre debe tener al menos 2 caracteres.' });
      }

      if (cleanPhone.length < 6 || !/^[0-9+\s()-]+$/.test(cleanPhone)) {
        return res.status(400).json({ error: 'Por favor introduce un número de teléfono válido.' });
      }

      // 6. Validación exacta de fecha YYYY-MM-DD y existencia real en el calendario
      const dateMatch = cleanDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!dateMatch) {
        return res.status(400).json({ error: 'Formato de fecha inválido. Utilice el formato YYYY-MM-DD.' });
      }

      const y = parseInt(dateMatch[1], 10);
      const m = parseInt(dateMatch[2], 10);
      const d = parseInt(dateMatch[3], 10);
      const calendarDate = new Date(Date.UTC(y, m - 1, d));
      if (calendarDate.getUTCFullYear() !== y || calendarDate.getUTCMonth() !== m - 1 || calendarDate.getUTCDate() !== d) {
        return res.status(400).json({ error: 'La fecha indicada no existe en el calendario.' });
      }

      // Comprobar que la fecha no está en el pasado (zona horaria peninsular española)
      const nowSpain = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
      if (cleanDate < nowSpain) {
        return res.status(400).json({ error: 'No se pueden realizar reservas para fechas pasadas.' });
      }

      // 7. Validación de formato de hora HH:mm en 24 horas
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(cleanTime)) {
        return res.status(400).json({ error: 'Formato de hora inválido. Debe ser HH:mm en formato 24 horas.' });
      }

      // 8. Reglas de horario comercial y días de apertura de Tetería Bodhi
      // El servidor utiliza el negocio activo configurado (no se permite falsear por el cliente)
      const dayOfWeek = calendarDate.getUTCDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado

      // Lunes: Cerrado por descanso del personal
      if (dayOfWeek === 1) {
        return res.status(400).json({
          error: 'Los lunes la tetería permanece cerrada por descanso del personal. Por favor selecciona una fecha de martes a domingo.'
        });
      }

      // Horario de apertura según configuración oficial:
      // - Martes a Jueves y Domingo: 18:00 a 02:00
      // - Viernes y Sábado: 18:00 a 03:00
      const [h, min] = cleanTime.split(':').map(Number);
      const minutesSinceMidnight = h * 60 + min;
      const isWeekend = (dayOfWeek === 5 || dayOfWeek === 6);
      const closeMinutes = isWeekend ? 3 * 60 : 2 * 60; // 03:00 o 02:00

      // El local abre a las 18:00 (1080 min) y cierra de madrugada
      const isOpen = (minutesSinceMidnight >= 18 * 60) || (minutesSinceMidnight <= closeMinutes);
      if (!isOpen) {
        const cierreStr = isWeekend ? '03:00 h' : '02:00 h';
        return res.status(400).json({
          error: `Nuestro horario para este día es de 18:00 a ${cierreStr}. Por favor elija una hora dentro del horario de apertura.`
        });
      }

      // Validar zona en lista blanca
      const allowedZones = ['interior', 'terraza', 'indiferente', 'Interior Lounge', 'Terraza Exterior'];
      const rawZone = String(zone || 'indiferente').trim();
      const cleanZone = allowedZones.includes(rawZone) ? rawZone : 'indiferente';

      // 9. Los clientes públicos no pueden forzar estados arbitrarios ni notas internas
      const reservationData = {
        name: cleanName,
        phone: cleanPhone,
        email: cleanEmail,
        date: cleanDate,
        time: cleanTime,
        guests: guestsNum,
        zone: cleanZone,
        notes: cleanNotes,
        status: isReqAdmin && body.status ? body.status : (guestsNum > 4 ? 'pending' : 'confirmed'),
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

      // Validar campos en lista blanca
      const allowedPatch = ['status', 'admin_notes', 'zone', 'guests', 'date', 'time', 'notes'];
      const filtered = {};

      if (updates.status !== undefined) {
        const allowedStatuses = ['pending', 'confirmed', 'cancelled', 'completed'];
        if (!allowedStatuses.includes(updates.status)) {
          return res.status(400).json({ error: 'Estado de reserva no válido.' });
        }
        filtered.status = updates.status;
      }

      if (updates.guests !== undefined) {
        const gNum = Number(updates.guests);
        if (!Number.isInteger(gNum) || gNum < 1 || gNum > 20) {
          return res.status(400).json({ error: 'Comensales debe ser un número entero entre 1 y 20.' });
        }
        filtered.guests = gNum;
      }

      if (updates.date !== undefined) {
        const dStr = String(updates.date).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dStr)) {
          return res.status(400).json({ error: 'Formato de fecha inválido. Utilice YYYY-MM-DD.' });
        }
        filtered.date = dStr;
      }

      if (updates.time !== undefined) {
        const tStr = String(updates.time).trim();
        if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(tStr)) {
          return res.status(400).json({ error: 'Formato de hora inválido. Utilice HH:mm.' });
        }
        filtered.time = tStr;
      }

      for (const k of ['admin_notes', 'zone', 'notes']) {
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
