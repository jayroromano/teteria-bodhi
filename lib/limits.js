/**
 * Límites de frecuencia de la aplicación (fuente única de verdad).
 * Se usan tanto en los handlers de la API como en la suite de pruebas.
 *
 * Nota: el límite se cuenta por IP. Todo el local (varios móviles/tablets)
 * comparte la misma IP pública, así que conviene dejar margen suficiente
 * para errores de tecleo sin bloquear a todo el equipo.
 */

// Acceso al panel: 10 intentos por minuto. Al superarlo, el bloqueo
// se libera en 60 segundos como máximo.
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 60 * 1000;

module.exports = {
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS
};
