/**
 * Límites de frecuencia de la aplicación (fuente única de verdad).
 * Se usan tanto en los handlers de la API como en la suite de pruebas.
 *
 * Nota: el límite se cuenta por IP. Todo el local (varios móviles/tablets)
 * comparte la misma IP pública, así que conviene dejar margen suficiente
 * para errores de tecleo sin bloquear a todo el equipo.
 */

// Acceso al panel: 5 intentos fallidos por cada 3 minutos (180 segundos).
// Al superarlo, el bloqueo se libera en 180 segundos como máximo.
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 180 * 1000;

// Reservas desde la web: 10 reservas cada 5 minutos por IP.
// Margen pensado para el wifi del local (varios clientes tras la misma IP).
const RESERVATION_MAX_ATTEMPTS = 10;
const RESERVATION_WINDOW_MS = 5 * 60 * 1000;

module.exports = {
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  RESERVATION_MAX_ATTEMPTS,
  RESERVATION_WINDOW_MS
};
