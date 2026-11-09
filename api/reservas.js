const db = require('../lib/db');
const { verifyToken, checkRateLimit, hashRateLimitKey } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const https = require('https');

function getClientIp(req) {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) return xForwardedFor.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown_client';
}

/**
 * Escapado seguro de cadenas para evitar inyecciones HTML en correos electrónicos
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Notificaciones automáticas al administrador cuando entra una reserva
 */
async function sendAdminNotifications(reservation) {
  // En entorno de pruebas se desactivan completamente las llamadas a servicios externos
  if (process.env.NODE_ENV === 'test') {
    return;
  }
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
      const safeTelUri = encodeURIComponent(String(reservation.phone || '').replace(/[^0-9+]/g, ''));
      const safeHtml = `
        <h2>Nueva reserva recibida en Tetería Bodhi</h2>
        <p><strong>Cliente:</strong> ${escapeHtml(reservation.name)}</p>
        <p><strong>Teléfono:</strong> <a href="tel:${safeTelUri}">${escapeHtml(reservation.phone)}</a></p>
        <p><strong>Fecha y Hora:</strong> ${escapeHtml(reservation.date)} a las ${escapeHtml(reservation.time)} h</p>
        <p><strong>Comensales:</strong> ${escapeHtml(reservation.guests)} personas (Zona ${escapeHtml(reservation.zone)})</p>
        <p><strong>Observaciones:</strong> ${escapeHtml(reservation.notes || 'Sin observaciones')}</p>
        <p><strong>Código:</strong> ${escapeHtml(reservation.code)}</p>
      `;

      const payload = JSON.stringify({
        from: 'Tetería Bodhi <onboarding@resend.dev>',
        to: [adminEmail],
        subject: `🛎️ Nueva Reserva: ${escapeHtml(reservation.name)} (${escapeHtml(reservation.guests)} pers.)`,
        html: safeHtml
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

// ========================================================
// REGLAS Y VALIDACIONES COMPARTIDAS DE RESERVAS
// ========================================================
const ALLOWED_ZONES = ['interior', 'terraza', 'indiferente', 'Interior Lounge', 'Terraza Exterior'];
const ALLOWED_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed'];

function validateReservationDate(dateStr) {
  if (typeof dateStr !== 'string') {
    return { valid: false, error: 'La fecha debe ser una cadena de texto en formato YYYY-MM-DD.' };
  }
  const cleanDate = dateStr.trim();
  const dateMatch = cleanDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) {
    return { valid: false, error: 'Formato de fecha inválido. Utilice el formato YYYY-MM-DD.' };
  }

  const y = parseInt(dateMatch[1], 10);
  const m = parseInt(dateMatch[2], 10);
  const d = parseInt(dateMatch[3], 10);
  const calendarDate = new Date(Date.UTC(y, m - 1, d));

  if (calendarDate.getUTCFullYear() !== y || calendarDate.getUTCMonth() !== m - 1 || calendarDate.getUTCDate() !== d) {
    return { valid: false, error: 'La fecha indicada no existe en el calendario.' };
  }

  const nowSpain = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
  if (cleanDate < nowSpain) {
    return { valid: false, error: 'No se pueden realizar reservas para fechas pasadas.' };
  }

  // Lunes (1) cerrado por descanso
  if (calendarDate.getUTCDay() === 1) {
    return {
      valid: false,
      error: 'Los lunes la tetería permanece cerrada por descanso del personal. Por favor selecciona una fecha de martes a domingo.'
    };
  }

  return { valid: true, cleanDate, calendarDate };
}

function validateReservationTime(timeStr, calendarDate) {
  if (typeof timeStr !== 'string') {
    return { valid: false, error: 'La hora debe ser una cadena de texto en formato HH:mm.' };
  }
  const cleanTime = timeStr.trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(cleanTime)) {
    return { valid: false, error: 'Formato de hora inválido. Debe ser HH:mm en formato 24 horas.' };
  }

  const [h, min] = cleanTime.split(':').map(Number);
  const minutesSinceMidnight = h * 60 + min;

  // Horario según configuración oficial de Bodhi (businesses/bodhi/config.json):
  // - Apertura: 18:00 (1080 min)
  // - Cierre: Domingo a Jueves a las 02:00 (120 min); Viernes y Sábado a las 03:00 (180 min)
  const dayOfWeek = calendarDate.getUTCDay(); // 0 = Domingo, 2 = Martes, ..., 6 = Sábado
  const isWeekend = (dayOfWeek === 5 || dayOfWeek === 6);
  const closeMinutes = isWeekend ? 3 * 60 : 2 * 60;

  const isOpen = (minutesSinceMidnight >= 18 * 60) || (minutesSinceMidnight <= closeMinutes);
  if (!isOpen) {
    const cierreStr = isWeekend ? '03:00 h' : '02:00 h';
    return {
      valid: false,
      error: `Nuestro horario para este día es de 18:00 a ${cierreStr}. Por favor elija una hora dentro del horario de apertura.`
    };
  }

  return { valid: true, cleanTime };
}

function validateGuestsCount(guestsVal) {
  const gNum = Number(guestsVal);
  if (isNaN(gNum) || !Number.isInteger(gNum) || gNum < 1 || gNum > 20) {
    return { valid: false, error: 'El número de comensales debe ser un número entero entre 1 y 20 personas.' };
  }
  return { valid: true, guests: gNum };
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

      if (query.stats === 'true') {
        if (!isAdmin(req)) {
          return res.status(401).json({ error: 'No autorizado. Se requiere acceso de administrador.' });
        }
        const stats = await db.getStats();
        return res.status(200).json({ success: true, stats });
      }

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

      // 1. Protección Anti-Spam: Rate Limiting distribuido con IP anonimizada (RGPD)
      if (!isReqAdmin) {
        const rateKey = hashRateLimitKey('res', clientIp);
        const rateResult = await checkRateLimit(rateKey, 6, 10 * 60 * 1000);
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
      const isPrivacyAccepted = privacy === true || privacy === 'true';
      if (!isReqAdmin && !isPrivacyAccepted) {
        return res.status(400).json({
          error: 'Es necesario aceptar la política de privacidad para tramitar la reserva conforme a la normativa de protección de datos.'
        });
      }

      // 4. Validación de comensales
      const guestsCheck = validateGuestsCount(guests);
      if (!guestsCheck.valid) {
        return res.status(400).json({ error: guestsCheck.error });
      }

      // 5. Sanitización de textos y teléfono
      const cleanName = String(name).trim().slice(0, 100);
      const cleanPhone = String(phone).trim().slice(0, 30);
      const cleanEmail = email ? String(email).trim().slice(0, 150) : '';
      const cleanNotes = notes ? String(notes).trim().slice(0, 500) : '';

      if (cleanName.length < 2) {
        return res.status(400).json({ error: 'El nombre debe tener al menos 2 caracteres.' });
      }

      if (cleanPhone.length < 6 || !/^[0-9+\s()-]+$/.test(cleanPhone)) {
        return res.status(400).json({ error: 'Por favor introduce un número de teléfono válido.' });
      }

      // 6. Validación de fecha y calendario
      const dateCheck = validateReservationDate(date);
      if (!dateCheck.valid) {
        return res.status(400).json({ error: dateCheck.error });
      }

      // 7. Validación de horario según día de apertura de Bodhi
      const timeCheck = validateReservationTime(time, dateCheck.calendarDate);
      if (!timeCheck.valid) {
        return res.status(400).json({ error: timeCheck.error });
      }

      // 8. Validación de zona
      const rawZone = String(zone || 'indiferente').trim();
      const cleanZone = ALLOWED_ZONES.includes(rawZone) ? rawZone : 'indiferente';

      // 9. Los clientes públicos no pueden forzar estados arbitrarios ni notas internas
      const reservationData = {
        name: cleanName,
        phone: cleanPhone,
        email: cleanEmail,
        date: dateCheck.cleanDate,
        time: timeCheck.cleanTime,
        guests: guestsCheck.guests,
        zone: cleanZone,
        notes: cleanNotes,
        status: isReqAdmin && body.status && ALLOWED_STATUSES.includes(body.status)
          ? body.status
          : (guestsCheck.guests > 4 ? 'pending' : 'confirmed'),
        admin_notes: isReqAdmin && body.admin_notes ? String(body.admin_notes).slice(0, 500) : null
      };

      const newReservation = await db.createReservation(reservationData);

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

      // Validar que no se pasen claves inesperadas
      const recognizedFields = ['status', 'admin_notes', 'zone', 'guests', 'date', 'time', 'notes'];
      for (const k of Object.keys(updates)) {
        if (!recognizedFields.includes(k)) {
          return res.status(400).json({ error: `Campo no reconocido o no modificable: '${k}'.` });
        }
      }

      const validatedUpdates = {};
      let calendarDateForTime = null;

      // Validación estricta de fecha si se actualiza
      if (updates.date !== undefined) {
        const dateCheck = validateReservationDate(updates.date);
        if (!dateCheck.valid) {
          return res.status(400).json({ error: dateCheck.error });
        }
        validatedUpdates.date = dateCheck.cleanDate;
        calendarDateForTime = dateCheck.calendarDate;
      }

      // Validación estricta de hora si se actualiza
      if (updates.time !== undefined) {
        // Si no se actualiza la fecha conjuntamente, usar la fecha de referencia para comprobar día de la semana
        const refCalendarDate = calendarDateForTime || new Date();
        const timeCheck = validateReservationTime(updates.time, refCalendarDate);
        if (!timeCheck.valid) {
          return res.status(400).json({ error: timeCheck.error });
        }
        validatedUpdates.time = timeCheck.cleanTime;
      }

      // Validación de comensales si se actualiza
      if (updates.guests !== undefined) {
        const guestsCheck = validateGuestsCount(updates.guests);
        if (!guestsCheck.valid) {
          return res.status(400).json({ error: guestsCheck.error });
        }
        validatedUpdates.guests = guestsCheck.guests;
      }

      // Validación de estado si se actualiza
      if (updates.status !== undefined) {
        if (typeof updates.status !== 'string' || !ALLOWED_STATUSES.includes(updates.status)) {
          return res.status(400).json({
            error: `Estado de reserva no válido. Valores admitidos: ${ALLOWED_STATUSES.join(', ')}.`
          });
        }
        validatedUpdates.status = updates.status;
      }

      // Validación de zona si se actualiza
      if (updates.zone !== undefined) {
        if (typeof updates.zone !== 'string' || !ALLOWED_ZONES.includes(updates.zone.trim())) {
          return res.status(400).json({
            error: `Zona no válida. Zonas admitidas: ${ALLOWED_ZONES.join(', ')}.`
          });
        }
        validatedUpdates.zone = updates.zone.trim();
      }

      // Validación de notas y notas de admin si se actualizan
      if (updates.notes !== undefined) {
        if (typeof updates.notes !== 'string' || updates.notes.length > 500) {
          return res.status(400).json({ error: 'Las notas no pueden exceder 500 caracteres.' });
        }
        validatedUpdates.notes = updates.notes.trim();
      }

      if (updates.admin_notes !== undefined) {
        if (typeof updates.admin_notes !== 'string' || updates.admin_notes.length > 500) {
          return res.status(400).json({ error: 'Las notas de administración no pueden exceder 500 caracteres.' });
        }
        validatedUpdates.admin_notes = updates.admin_notes.trim();
      }

      if (Object.keys(validatedUpdates).length === 0) {
        return res.status(400).json({ error: 'No se enviaron campos válidos para actualizar.' });
      }

      const updated = await db.updateReservation(targetId, validatedUpdates);
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

module.exports.escapeHtml = escapeHtml;
module.exports.validateReservationDate = validateReservationDate;
module.exports.validateReservationTime = validateReservationTime;
module.exports.validateGuestsCount = validateGuestsCount;

