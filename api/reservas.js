const db = require('../lib/db');
const https = require('https');

// Notificaciones automáticas al administrador cuando entra una reserva
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

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
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
  const token = auth.replace('Bearer ', '').trim();
  const validPass = process.env.ADMIN_PASSWORD || 'bodhi2026';
  // Acepta la contraseña directa o un token prefijado
  return token === validPass || token.startsWith('bodhi_token_');
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { method, query } = req;

  try {
    // GET: Listado de reservas, estadísticas o test de conexión
    if (method === 'GET') {
      if (query.health === 'true') {
        let pgTest = false;
        let pgDetail = null;
        if (db.isCloudDb()) {
          const testRes = await db.testPgConnection();
          pgTest = testRes.ok;
          pgDetail = testRes.ok ? { database: testRes.database, serverTime: testRes.now } : { error: testRes.error };
        }
        return res.status(200).json({
          status: 'ok',
          cloudDbConfigured: db.isCloudDb(),
          pgConnected: pgTest,
          pgDetail,
          timestamp: new Date().toISOString()
        });
      }

      if (query.stats === 'true') {
        const stats = await db.getStats();
        return res.status(200).json({ success: true, stats });
      }

      // El listado completo requiere ser admin para proteger datos personales de clientes
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
        reservations
      });
    }

    // POST: Nueva reserva de cliente o manual desde admin
    if (method === 'POST') {
      const body = await parseBody(req);
      const { name, phone, email, date, time, guests, zone, notes } = body;

      if (!name || !phone || !date || !time) {
        return res.status(400).json({
          error: 'Faltan campos obligatorios: por favor indica nombre, teléfono, fecha y hora.'
        });
      }

      const cleanDate = String(date).trim();
      const cleanTime = String(time).trim();

      // Validar día de la semana de forma segura frente a zonas horarias (Lunes cerrado)
      const dateParts = cleanDate.split('-');
      if (dateParts.length === 3) {
        const testDate = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]), 12, 0, 0);
        if (testDate.getDay() === 1) {
          return res.status(400).json({
            error: 'Los lunes la tetería permanece cerrada por descanso del personal. Por favor selecciona una fecha de martes a domingo.'
          });
        }
      }

      // Validar franja horaria (desde 16:00 tarde hasta las 03:00 madrugada)
      const [h, m] = cleanTime.split(':').map(Number);
      if (!isNaN(h) && (h >= 4 && h < 16)) {
        return res.status(400).json({
          error: 'Nuestro horario de apertura es de 18:00 a 02:00 h (hasta las 03:00 h los fines de semana).'
        });
      }

      const newReservation = await db.createReservation({
        name: String(name).trim(),
        phone: String(phone).trim(),
        email: email ? String(email).trim() : '',
        date: cleanDate,
        time: cleanTime,
        guests: Math.max(1, parseInt(guests, 10) || 2),
        zone: zone || 'indiferente',
        notes: notes ? String(notes).trim() : ''
      });

      // Disparar notificaciones configuradas de forma asíncrona
      sendAdminNotifications(newReservation).catch(() => {});

      // Construir enlace de WhatsApp directo para confirmación del cliente
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

    // PATCH: Actualizar estado o notas de la reserva (Admin)
    if (method === 'PATCH') {
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'No autorizado.' });
      }

      const body = await parseBody(req);
      const { id, ...updates } = body;
      const targetId = id || query.id;

      if (!targetId) {
        return res.status(400).json({ error: 'Se requiere id de reserva.' });
      }

      const updated = await db.updateReservation(targetId, updates);
      if (!updated) {
        return res.status(404).json({ error: 'Reserva no encontrada.' });
      }

      return res.status(200).json({ success: true, reservation: updated });
    }

    // DELETE: Cancelar / Eliminar reserva (Admin)
    if (method === 'DELETE') {
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'No autorizado.' });
      }

      const targetId = query.id;
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
    console.error('Error en /api/reservas:', error);
    return res.status(500).json({
      error: 'Error interno del servidor procesando la reserva.',
      details: error.message
    });
  }
};
