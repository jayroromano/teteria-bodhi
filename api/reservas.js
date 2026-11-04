const db = require('../lib/db');

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
    // GET: Listado de reservas o estadísticas
    if (method === 'GET') {
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
          error: 'Faltan campos obligatorios: nombre, teléfono, fecha y hora.'
        });
      }

      // Validar día de la semana (Lunes cerrado)
      const dateObj = new Date(date + 'T12:00:00');
      const dayOfWeek = dateObj.getDay(); // 0: Domingo, 1: Lunes, ...
      if (dayOfWeek === 1) {
        return res.status(400).json({
          error: 'Los lunes la tetería permanece cerrada por descanso del personal.'
        });
      }

      // Validar hora dentro del horario (18:00 a 02:00 / 03:00)
      const [h, m] = time.split(':').map(Number);
      const isWeekend = dayOfWeek === 5 || dayOfWeek === 6; // Viernes o Sábado
      const validLateHour = h >= 0 && h < (isWeekend ? 3 : 2);
      const validEveningHour = h >= 18 && h <= 23;

      if (!validEveningHour && !validLateHour) {
        return res.status(400).json({
          error: `Nuestro horario es de 18:00 a ${isWeekend ? '03:00' : '02:00'}. Por favor selecciona una hora dentro de este intervalo.`
        });
      }

      const newReservation = await db.createReservation({
        name: name.trim(),
        phone: phone.trim(),
        email: (email || '').trim(),
        date,
        time,
        guests: Number(guests) || 2,
        zone: zone || 'indiferente',
        notes: (notes || '').trim()
      });

      // Construir enlace de WhatsApp directo para confirmación del cliente
      const teteriaWhatsapp = '34600000000'; // Número de la tetería
      const waMsg = encodeURIComponent(
        `¡Hola Bodhi! He solicitado una reserva a nombre de *${newReservation.name}* para el día *${newReservation.date}* a las *${newReservation.time}* (${newReservation.guests} personas, zona ${newReservation.zone}). Código: *${newReservation.code}*. ¡Muchas gracias!`
      );
      const whatsappUrl = `https://wa.me/${teteriaWhatsapp}?text=${waMsg}`;

      return res.status(201).json({
        success: true,
        message: 'Reserva registrada con éxito.',
        reservation: newReservation,
        whatsappUrl
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
