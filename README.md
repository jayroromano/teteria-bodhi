# 🫖 Tetería Bodhi · Jerez de la Frontera

Sitio web oficial, sistema de reservas online interactivo y panel de control de administración para **Tetería Bodhi**, un oasis de tés del mundo, cachimbas premium y cócteles de autor en Jerez de la Frontera, Cádiz.

Diseñado y optimizado para desplegarse con **cero configuración en Vercel** con funciones serverless y persistencia en base de datos.

---

## 🌟 Características Principales

### 🌐 Web Pública para Clientes
- **Diseño Artesanal & Profesional**: Inspirado en la arquitectura andalusí y marroquí, con paleta cálida de tonos terracota, arena y dorado, y tipografía elegante (`Abril Fatface` + `Figtree`).
- **Horario Dinámico en Vivo**: Indicador en tiempo real de apertura ("Abierto ahora · Cierra a las 02:00" o "Cerrado ahora · Abrimos a las 18:00").
- **Carta Digital Interactiva**: Filtros por categoría (Tés, Cachimbas, Cócteles, Repostería, Tapas) y buscador en tiempo real por ingrediente.
- **Asistente de Reservas Online**:
  - Restricción automática de días cerrados (lunes).
  - Selector dinámico de horas según horario (18:00 a 02:00 / 03:00 en fines de semana).
  - Recomendación personalizada según número de comensales.
  - Selección de zona: *Salón Lounge Interior*, *Terraza Andalusí* o *Indiferente*.
  - Generación de código único de reserva (ej: `BDH-8392`).
  - Modal con enlace directo para enviar confirmación a WhatsApp con 1 clic.
- **Galería de Momentos**: Fotografía de alta definición de cachimbas, teteras tradicionales, cócteles y dulces árabes.
- **Ubicación & Contacto**: Mapa interactivo integrado de Jerez de la Frontera (Calle Tornería), enlaces directos de llamada y WhatsApp flotante.
- **Modo Oscuro / Claro**: Interruptor de tema con memoria persistente en el navegador.

### 🛡️ Panel de Administración (`/admin`)
- **Acceso Protegido**: Autenticación criptográfica con HMAC-SHA256 y contraseña configurada mediante `ADMIN_PASSWORD` y `ADMIN_SESSION_SECRET`.
- **Dashboard con KPIs en Tiempo Real**:
  - Reservas esperadas para HOY.
  - Número total de comensales de la noche.
  - Reservas pendientes de confirmación.
  - Total histórico almacenado.
- **Gestión Completa de Reservas**:
  - Filtro rápido: Hoy, Mañana, Todas.
  - Filtro por estado: Pendientes, Confirmadas, Canceladas, Completadas.
  - Búsqueda en vivo por nombre del cliente, teléfono o código.
  - Acción de confirmación con 1 clic.
  - **Botón de WhatsApp directo al cliente** con mensaje personalizado ya redactado.
  - Creación manual de reservas telefónicas o presenciales.
  - Edición de notas internas del personal (ej: "Mesa 4 asignada", "Cumpleaños").
  - **Exportación a CSV / Excel** e impresión de lista de servicio.
- **Control de la Carta**:
  - Botón para marcar productos como "Disponible" o "Agotado hoy" en tiempo real sin reiniciar el servidor.

---

## 🚀 Despliegue en Vercel (Paso a Paso)

Este repositorio está 100% preparado para conectarse directamente a Vercel con integración continua desde GitHub:

### 1. Subir a GitHub
El código ya se encuentra en tu repositorio de GitHub.

### 2. Importar en Vercel
1. Ve a [vercel.com](https://vercel.com) e inicia sesión con tu cuenta de GitHub.
2. Haz clic en **"Add New..." → "Project"**.
3. Selecciona el repositorio `teteria-bodhi` y haz clic en **"Import"**.
4. En **Framework Preset**, déjalo en **Other** (Vercel detecta automáticamente los archivos estáticos y las funciones en `/api`).
5. Haz clic en **"Deploy"**. En 30 segundos tu web estará publicada en tu dominio `.vercel.app`.

### 3. Conectar Base de Datos Permanente (Recomendado)
El proyecto funciona por defecto con respaldo local / en memoria, pero para producción permanente puedes vincular una base de datos PostgreSQL gratuita en 2 minutos:

1. Crea una base de datos gratis en **[Neon.tech](https://neon.tech)** o **[Supabase.com](https://supabase.com)** (o añade la integración *Vercel Postgres* desde el marketplace de Vercel).
2. Copia la cadena de conexión URI (ejemplo: `postgres://usuario:contraseña@ep-sample.neon.tech/neondb?sslmode=require`).
3. En Vercel, entra en tu proyecto y ve a **Settings → Environment Variables**.
4. Añade:
   - **Name**: `DATABASE_URL`
   - **Value**: `postgres://...` (tu cadena de conexión)
5. Haz un **Redeploy** (o sube un nuevo commit).
6. ¡Listo! El sistema creará automáticamente las tablas SQL (`reservations` y `menu_items`) en el primer inicio sin que tengas que ejecutar comandos.

---

## 💻 Desarrollo Local

Para probar o modificar el proyecto en tu ordenador:

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar el servidor local
npm run dev
```

Abre en tu navegador:
- **Web principal:** [http://localhost:3000](http://localhost:3000)
- **Panel de control:** [http://localhost:3000/admin](http://localhost:3000/admin) (Contraseña configurada en `ADMIN_PASSWORD`)

---

## 📁 Estructura del Proyecto

```
teteria-bodhi/
├── api/
│   ├── db.js                 # Conector híbrido (PostgreSQL con fallback JSON)
│   ├── reservas.js           # Endpoint REST para reservas (GET, POST, PATCH, DELETE)
│   ├── admin-login.js        # Autenticación segura del panel
│   └── carta.js              # Endpoint de la carta y disponibilidad
├── css/
│   ├── style.css             # Estilos de la web pública (responsive, dark mode)
│   └── admin.css             # Estilos del panel de administración
├── js/
│   ├── main.js               # Lógica del cliente, formulario y reservas
│   └── admin.js              # Lógica del dashboard, filtros, exportación y KPIs
├── data/
│   ├── reservas.json         # Datos de reservas de ejemplo / almacenamiento local
│   └── carta.json            # Carta completa precargada
├── index.html                # Web pública principal
├── admin.html                # Panel de administración
├── server.js                 # Servidor local Node.js / Express
├── schema.sql                # Esquema de tablas para PostgreSQL
├── vercel.json               # Configuración de rutas y serverless para Vercel
├── .env.example              # Plantilla de variables de entorno
└── package.json
```

---

## 🔑 Configuración de Seguridad en Vercel

Configura las siguientes variables de entorno en el panel de Vercel:

- `ADMIN_PASSWORD`: Contraseña secreta para acceder al panel de administración.
- `ADMIN_SESSION_SECRET`: Secreto aleatorio de al menos 32 caracteres para firmar los tokens de sesión.
- `SUPABASE_URL`: URL del proyecto de Supabase.
- `SUPABASE_ANON_KEY`: Clave pública anónima de Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: Clave de servicio para operaciones seguras de servidor.
- `ALLOWED_ORIGINS`: Dominios autorizados para peticiones (ej: `https://teteria-bodhi.vercel.app`).

---

Desarrollado con pasión para **Tetería Bodhi** · Jerez de la Frontera, 2026.
