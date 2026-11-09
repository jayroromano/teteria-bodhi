const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========================================================
// 1. FILTRADO DE SEGURIDAD PARA ARCHIVOS INTERNOS
// ========================================================
// Impide el acceso HTTP a archivos de código, tests, scripts SQL y configuraciones
app.use((req, res, next) => {
  const cleanPath = req.path.toLowerCase();

  // Bloquear rutas a directorios internos del repositorio
  const blockedPrefixes = ['/lib', '/tests', '/data', '/node_modules', '/.git'];
  if (blockedPrefixes.some(dir => cleanPath === dir || cleanPath.startsWith(dir + '/'))) {
    return res.status(404).send('Not Found');
  }

  // Si intentan acceder al código fuente de api/ (*.js), bloquear
  if (cleanPath.startsWith('/api/') && cleanPath.endsWith('.js')) {
    return res.status(404).send('Not Found');
  }

  // Bloquear archivos con extensiones sensibles
  const sensitiveExtensions = ['.sql', '.env', '.md', '.lock'];
  if (sensitiveExtensions.some(ext => cleanPath.endsWith(ext))) {
    return res.status(404).send('Not Found');
  }

  // Bloquear package.json o ficheros JSON de la raíz
  if (cleanPath.endsWith('.json') && !cleanPath.startsWith('/businesses/')) {
    return res.status(404).send('Not Found');
  }

  // Bloquear archivos o carpetas ocultas (.env, .gitignore, etc.)
  if (/(^|\/)\.[^\/]+/.test(cleanPath)) {
    return res.status(404).send('Not Found');
  }

  next();
});

// ========================================================
// 2. SERVIR EXCLUSIVAMENTE RECURSOS PÚBLICOS NECESARIOS
// ========================================================
app.use('/css', express.static(path.join(__dirname, 'css'), { dotfiles: 'ignore' }));
app.use('/js', express.static(path.join(__dirname, 'js'), { dotfiles: 'ignore' }));
app.use('/img', express.static(path.join(__dirname, 'img'), { dotfiles: 'ignore' }));
app.use('/businesses', express.static(path.join(__dirname, 'businesses'), { dotfiles: 'ignore' }));

// Archivos estáticos de raíz autorizados
app.get('/robots.txt', (req, res) => res.sendFile(path.join(__dirname, 'robots.txt')));
app.get('/sitemap.xml', (req, res) => res.sendFile(path.join(__dirname, 'sitemap.xml')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ========================================================
// 3. RUTAS DE API SERVERLESS MAPEADAS PARA DESARROLLO
// ========================================================
const reservasHandler = require('./api/reservas');
const adminLoginHandler = require('./api/admin-login');
const cartaHandler = require('./api/carta');
const businessConfigHandler = require('./api/business-config');

const adaptVercelHandler = (handler) => (req, res) => {
  req.query = req.query || {};
  return handler(req, res);
};

app.all('/api/reservas', adaptVercelHandler(reservasHandler));
app.all('/api/admin-login', adaptVercelHandler(adminLoginHandler));
app.all('/api/admin/login', adaptVercelHandler(adminLoginHandler));
app.all('/api/carta', adaptVercelHandler(cartaHandler));
app.all('/api/business-config', adaptVercelHandler(businessConfigHandler));

// 4. Manejador 404 final
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint no encontrado' });
  }
  res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    const isCloud = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    const passStatus = process.env.ADMIN_PASSWORD ? 'Configurada en .env' : 'Configura ADMIN_PASSWORD en .env';
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║              🫖 TETERÍA BODHI · SERVIDOR LOCAL               ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  🌐 Web Principal:     http://localhost:${PORT}                 ║
║  🛡️  Panel de Admin:    http://localhost:${PORT}/admin           ║
║  🔑 Contraseña Admin:  ${passStatus.padEnd(38)}║
║  📦 Base de datos:     ${isCloud ? '🟢 PostgreSQL Cloud' : '🟡 JSON Local (data/)'}          ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `);
  });
}

module.exports = app;
