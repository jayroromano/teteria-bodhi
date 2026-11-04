# 📖 Guía de la Plantilla Web Maestra Multinegocio

¡Bienvenido a tu base de desarrollo web profesional! Esta arquitectura modular te permite crear y desplegar páginas web de alta gama para **cualquier tipo de cliente o negocio** (bares, teterías, restaurantes, barberías, peluquerías, clínicas, talleres mecánicos, tiendas físicas, servicios) en cuestión de minutos, **sin tener que reconstruir la web desde cero ni duplicar código**.

---

## 🏗️ 1. Arquitectura del Proyecto

El proyecto está separado en dos mundos independientes:

```text
/
├── businesses/                   # 🏢 DIRECTORIO DE CLIENTES (Datos & Estilo)
│   ├── bodhi/                    # Cliente 1: Tetería Bodhi (Web actual)
│   │   ├── config.json           # Identidad, colores, textos, horarios, reservas
│   │   └── catalog.json          # Carta / productos de Bodhi
│   │
│   └── barberia-elite/           # Cliente 2: Barbería & Spa Élite (Demostración)
│       ├── config.json           # Estilo oscuro/dorado, servicios, citas previas
│       └── catalog.json          # Tarifas de barbería y tratamientos
│
├── template-core/                # ⚙️ MOTOR MODULAR REUTILIZABLE
│   └── js/
│       └── business-engine.js    # Inyecta colores, fuentes, textos y catálogo
│
├── api/                          # 🚀 BACKEND SERVERLESS (Vercel & Local)
│   ├── business-config.js        # Carga la configuración del negocio activo
│   ├── carta.js                  # Catálogo dinámico por negocio
│   └── reservas.js               # Motor de reservas / citas
│
├── index.html                    # 🌐 Plantilla pública adaptativa
├── admin.html                    # 🛡️ Panel de administración
└── server.js                     # 💻 Servidor de desarrollo local
```

---

## 🚀 2. Cómo Crear una Web para un Nuevo Cliente (Paso a Paso)

Para crear la página de un nuevo cliente (por ejemplo, un restaurante italiano llamado *"Trattoria Bella"*):

### Paso 1: Duplicar la carpeta de negocio
Copia la carpeta `/businesses/bodhi/` y renómbrala a `/businesses/trattoria-bella/`.

### Paso 2: Editar `config.json`
Abre `businesses/trattoria-bella/config.json` y personaliza:

1. **`identity`**:
   - `name`: "Trattoria Bella"
   - `slug`: "trattoria-bella"
   - `tagline`: "Auténtica cocina tradicional italiana a la leña"
   - `logoEmoji`: "🍕"
   - `city`: "Málaga"

2. **`theme` (Colores y Tipografías)**:
   - Puedes definir la paleta que mejor encaje con su identidad:
   ```json
   "theme": {
     "fontTitle": "'Playfair Display', serif",
     "fontBody": "'Inter', sans-serif",
     "googleFontsUrl": "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400;600&display=swap",
     "borderRadius": "12px",
     "light": {
       "bg": "#FFFDF9",
       "paper": "#FFFFFF",
       "ink": "#1E1A17",
       "tost": "#C2410C",
       "btn": "#C2410C",
       "btnInk": "#FFFFFF"
     }
   }
   ```

3. **`sections` (Activar o desactivar bloques)**:
   - Si el cliente no necesita galería o no quiere reservas online, simplemente pon `false`:
   ```json
   "sections": {
     "hero": true,
     "about": true,
     "catalog": true,
     "gallery": false,
     "booking": true,
     "contact": true,
     "map": true
   }
   ```

4. **`booking` (Tipo de reserva)**:
   - Para hostelería usa `"type": "table"` (pide número de comensales y zonas).
   - Para servicios/peluquerías/talleres usa `"type": "appointment"` (pide especialista o servicio).

### Paso 3: Editar `catalog.json`
Define sus platos, bebidas o servicios con nombre, precio, foto y categoría:
```json
[
  {
    "id": "pizza-margherita",
    "category": "Pizzas",
    "name": "Pizza Margherita D.O.P.",
    "description": "Tomate San Marzano, mozzarella fior di latte y albahaca fresca.",
    "price": 11.50,
    "badge": "Clásica",
    "image": "https://images.unsplash.com/photo-1604382354936-07c5d9983bd3",
    "available": true
  }
]
```

¡Listo! Ya tienes una web completamente nueva funcionando sobre la misma estructura.

---

## 🎯 3. Cómo Probar y Mostrar Diferentes Negocios a Clientes

### Enlace directo por URL:
Puedes abrir la web con el parámetro `?b=nombre-del-negocio`:
- 🍵 **Tetería Bodhi:** `http://localhost:3000/?b=bodhi`
- 💈 **Barbería & Spa Élite:** `http://localhost:3000/?b=barberia-elite`

### Selector interactivo en pantalla:
En la esquina inferior derecha de la pantalla encontrarás una pastilla flotante (`[ 🏢 Negocio: ... ▾ ]`) que te permite **cambiar de negocio en un solo clic** para enseñar las posibilidades a tus clientes en vivo.

---

## 🌐 4. Cómo Fijar un Negocio en Producción en Vercel

Cuando crees un proyecto en Vercel exclusivo para un cliente (por ejemplo, para el dominio `teteriabodhi.es` o `barberiaelite.com`):

1. En el panel de **Vercel** > **Settings** > **Environment Variables**.
2. Añade la variable:
   ```env
   ACTIVE_BUSINESS=bodhi
   ```
   *(o el slug del cliente que corresponda: `barberia-elite`, `trattoria-bella`, etc.)*
3. ¡La web se servirá automáticamente con ese negocio fijado por defecto!
