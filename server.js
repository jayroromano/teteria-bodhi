const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Archivos estáticos
app.use(express.static(path.join(__dirname)));

// Rutas de API serverless mapeadas para desarrollo local
const reservasHandler = require('./api/reservas');
const adminLoginHandler = require('./api/admin-login');
const cartaHandler = require('./api/carta');

// Adaptador para handlers de Vercel (req, res)
const adaptVercelHandler = (handler) => (req, res) => {
  // Asegurar que req.query está poblado
  req.query = req.query || {};
  return handler(req, res);
};

app.all('/api/reservas', adaptVercelHandler(reservasHandler));
app.all('/api/admin-login', adaptVercelHandler(adminLoginHandler));
app.all('/api/admin/login', adaptVercelHandler(adminLoginHandler));
app.all('/api/carta', adaptVercelHandler(cartaHandler));

// Rutas amigables
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint no encontrado' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  const isCloud = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║              🫖 TETERÍA BODHI · SERVIDOR LOCAL               ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  🌐 Web Principal:     http://localhost:${PORT}                 ║
║  🛡️  Panel de Admin:    http://localhost:${PORT}/admin           ║
║  🔑 Contraseña Admin:  bodhi2026                             ║
║  📦 Base de datos:     ${isCloud ? '🟢 PostgreSQL Cloud' : '🟡 JSON Local (data/)'}          ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
});
