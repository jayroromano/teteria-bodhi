/**
 * TETERÍA BODHI · CLIENTE WEB PRINCIPAL
 * Jerez de la Frontera
 */

(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);
  const isFileProtocol = window.location.protocol === 'file:';

  // Datos completos de la carta precargados para visualización instantánea (incluso sin servidor)
  let cartaData = [
  {
    "id": "mojito-clasico-y-de-sabor",
    "category": "Cócteles",
    "name": "Mojito clásico y de sabor",
    "description": "Lima, hierbabuena, azúcar y ron. También con puré de fruta, por si te gusta pensar que tienes criterio.",
    "price": 6,
    "badge": "Clásico",
    "image": "https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=600&q=80",
    "available": true
  },
  {
    "id": "pina-colada",
    "category": "Cócteles",
    "name": "Piña Colada",
    "description": "Sabe a coco, piña, ron y decisiones cuestionables. Ideal para olvidarte de todo… incluido cómo llegaste a casa anoche.",
    "price": 6.5,
    "badge": "Tropical",
    "image": "https://images.unsplash.com/photo-1587223962716-6ddaaa2566b6?auto=format&fit=crop&w=600&q=80",
    "available": true
  },
  {
    "id": "rosa-acida",
    "category": "Cócteles",
    "name": "Rosa Ácida",
    "description": "Como si tu ex volviera… pero esta vez en forma de cóctel bonito y vengativo. Rosa, preciosa y tan peligrosa como un “tenemos que hablar” sin contexto.",
    "price": 6,
    "badge": "Especial Bodhi",
    "image": "https://images.unsplash.com/photo-1556881286-fc6915169721?auto=format&fit=crop&w=600&q=80",
    "available": true
  },
  {
    "id": "el-hdp",
    "category": "Cócteles",
    "name": "El “HDP”",
    "description": "Nuestra versión del vodka negro con lima, pero frozen. El mismo que ha provocado más locuras en La Avenida que el calor, el ego y la música mala juntos. Negro, ácido… y sin piedad.",
    "price": 6,
    "badge": "Frozen",
    "image": "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=600&q=80",
    "available": true
  },
  {
    "id": "san-francisco",
    "category": "Cócteles",
    "name": "San Francisco",
    "description": "Este cóctel es más viejo que una mesa camilla, pero aquí sigue, liándola con zumos de frutas, amaretto y granadina. Listo para recordarte que las modas van y vienen, pero el San Francisco nunca pasa de moda (aunque tú sí).",
    "price": 6,
    "badge": "Un Clásico",
    "image": "https://images.unsplash.com/photo-1536935338788-846bb9981813?auto=format&fit=crop&w=600&q=80",
    "available": true
  },
  {
    "id": "daiquiri-frozen-y-de-sabor",
    "category": "Cócteles",
    "name": "Daiquiri frozen y de sabor",
    "description": "Ron, azúcar, limón exprimido y puré de fruta si lo pides de sabor. Dulce, ácido y tan traicionero como un “A ver si quedamos”.",
    "price": 6.5,
    "badge": "Frozen",
    "image": "https://images.unsplash.com/photo-1560512823-829485b8bf24?auto=format&fit=crop&w=600&q=80",
    "available": true
  },
  {
    "id": "beso-negro",
    "category": "Cócteles",
    "name": "Beso Negro",
    "description": "Vodka negro, puré de melón, limón exprimido y un poco de lima. Este cóctel es tan guarro que decidimos ponerle este nombre.",
    "price": 6,
    "badge": "Gamberro",
    "image": "https://images.unsplash.com/photo-1572116469696-31de0f17cc34?auto=format&fit=crop&w=600&q=80",
    "available": true
  },
  {
    "id": "elena-passion",
    "category": "Cócteles",
    "name": "Elena Passion",
    "description": "Maracuyá, mango, vodka y un toque cítrico. Tan bonito que parece caro. Y aun así sigue siendo mejor inversión que la mitad de criptomonedas que compró la gente en 2021. 🌶️ Versión picante disponible: pica más lento que Hacienda… pero al final llega.",
    "price": 6.5,
    "badge": "👑 Top Ventas",
    "image": "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=600&q=80",
    "available": true
  },
  {
    "id": "alba-sunset",
    "category": "Cócteles",
    "name": "Alba Sunset",
    "description": "Mango, coco y ron. Dulce, refrescante y más traicionero que el “acepto términos y condiciones” que firmas sin leer nunca. 🌶️ Versión picante disponible: tan innecesariamente intenso como discutir de política en una cena familiar después de tres copas.",
    "price": 6.5,
    "badge": "🌴 Tropical",
    "image": "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=600&q=80",
    "available": true
  },
  {
    "id": "crisberry",
    "category": "Cócteles",
    "name": "Crisberry",
    "description": "Frutas del bosque, licor de mora, vodka y un toque cítrico. Oscuro, adictivo y con más capacidad de arruinar mañanas que dormir “solo 20 minutitos más”.",
    "price": 6.5,
    "badge": "🌙 De Autor",
    "image": "https://images.unsplash.com/photo-1546171753-97d7676e4602?auto=format&fit=crop&w=600&q=80",
    "available": true
  },
  {
    "id": "cachimba-afrutados",
    "category": "Cachimbas",
    "name": "Cachimba Sabores Afrutados y Fresquitos",
    "description": "Elige tu sabor o combinación: Melón con menta y arándanos, Coco, Sandía menta, Uva negra con menta, Frutas exóticas, Piña y hielo, Frutos rojos con frambuesa, Melón, Frambuesa y pomelo, Melocotón y albaricoque, Chuche de Coca Cola o Plátano.",
    "price": 10,
    "badge": "10€ Completa",
    "image": "https://images.unsplash.com/photo-1527661591475-527312dd65f5?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "cachimba-dulces",
    "category": "Cachimbas",
    "name": "Cachimba Sabores Dulces",
    "description": "Tarta de queso, Frutos rojos con chocolate blanco, Donut con chocolate o Galleta Lotus. Sabores cremosos y dulces para los más golosos.",
    "price": 10,
    "badge": "Dulce",
    "image": "https://images.unsplash.com/photo-1519869325930-281384150729?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "cachimba-citricos-frios",
    "category": "Cachimbas",
    "name": "Cachimba Cítricos y Fríos",
    "description": "Limón, Lima, Maracuyá, Naranja, Arándanos con lima y hielo, Menta pura, Vainilla menta, Chicle de canela o Dos Manzanas tradicional.",
    "price": 10,
    "badge": "Refrescante",
    "image": "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "suplemento-cachimba-pro",
    "category": "Cachimbas",
    "name": "Suplementos Shisha (Khaloud / Bazooka / Hielo)",
    "description": "Gestor de calor Khaloud (+2€), 3 carbones (+1€), base con agua helada (+1€) o manguera helada Bazooka (+1€). Tabaco rubio o negro.",
    "price": 2,
    "badge": "Opciones Pro",
    "image": "https://images.unsplash.com/photo-1527661591475-527312dd65f5?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "te-verde-moruno",
    "category": "Tés, Cafés & Meriendas",
    "name": "Té Verde Moruno con Hierbabuena",
    "description": "Té verde gunpowder, hierbabuena fresca andaluza y azúcar moreno servido en tetera tradicional.",
    "price": 1.5,
    "badge": "Especialidad",
    "image": "https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "te-chai-latte",
    "category": "Tés, Cafés & Meriendas",
    "name": "Té Chai Latte Especiado",
    "description": "Té negro especiado con canela, cardamomo, clavo y jengibre, emulsionado con leche vaporizada.",
    "price": 2.5,
    "badge": "Top Ventas",
    "image": "https://images.unsplash.com/photo-1561336313-0bd5e0b27ec8?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "te-matcha-japones",
    "category": "Tés, Cafés & Meriendas",
    "name": "Té Matcha Japonés / Vainilla",
    "description": "Té verde matcha en polvo ceremonial batido al estilo tradicional o con toque dulce de vainilla (2,50€).",
    "price": 2.5,
    "badge": "Saludable",
    "image": "https://images.unsplash.com/photo-1536256263959-770b48d82b0a?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "infusiones-clasicas",
    "category": "Tés, Cafés & Meriendas",
    "name": "Infusiones Clásicas (Manzanilla / Tila / Menta Poleo)",
    "description": "Selección de hierbas e infusiones naturales digestivas y relajantes.",
    "price": 1.5,
    "badge": "Sin Teína",
    "image": "https://images.unsplash.com/photo-1597481499750-3e6b22637e12?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "cafe-espresso-leche",
    "category": "Tés, Cafés & Meriendas",
    "name": "Café (Solo / Cortado / Con Leche / Doble)",
    "description": "Café arábica de tueste natural recién molido. Solo (1,50€), cortado o con leche (1,60€), doble (2,60€).",
    "price": 1.6,
    "badge": "Arábica",
    "image": "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "cafe-especialidad-latte",
    "category": "Tés, Cafés & Meriendas",
    "name": "Latte Macchiato de Sabores & Capuccino",
    "description": "Capuccino (2,80€), Café Irlandés con whisky (4,00€), Latte Macchiato Caramelo, Avellana, Vainilla o Chocolate Blanco (2,80€).",
    "price": 2.8,
    "badge": "Especialidad",
    "image": "https://images.unsplash.com/photo-1534778101976-62847782c213?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "batidos-nesquik",
    "category": "Tés, Cafés & Meriendas",
    "name": "Batidos (Chocolate / Fresa / Vainilla) & Nesquik",
    "description": "Batidos cremosos bien fríos (1,80€), Nesquik calentito o frío (1,60€) o carajillo flambeado (3,00€).",
    "price": 1.8,
    "badge": null,
    "image": "https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "gofre-artesano",
    "category": "Tés, Cafés & Meriendas",
    "name": "Gofre Belga Artesano",
    "description": "Gofre crujiente recién hecho. Incluye 1 sirope o topping a elegir (Nutella, Lotus, Kinder, Fresa, Caramelo, etc.). Extra nata +0,50€.",
    "price": 4.5,
    "badge": "Top Meriendas",
    "image": "https://images.unsplash.com/photo-1562376552-0d160a2f238d?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "crepe-dulce",
    "category": "Tés, Cafés & Meriendas",
    "name": "Crepe Dulce Recién Hecha",
    "description": "Fina masa de crepe dorada al momento con tu sirope favorito incluido (Dulce de leche, Chocolate blanco, Kinder, Pistacho...).",
    "price": 4.5,
    "badge": "Casero",
    "image": "https://images.unsplash.com/photo-1519676867240-f03562e64548?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "tortitas-americanas",
    "category": "Tés, Cafés & Meriendas",
    "name": "Torre de Tortitas (Pancakes)",
    "description": "Esponjosas tortitas americanas con 1 sirope o topping incluido. Prueba con Oreo, Filipinos o Kinder Bueno (+1€ extra topping).",
    "price": 4.5,
    "badge": "Favorito",
    "image": "https://images.unsplash.com/photo-1528207776546-365bb710ee93?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "cerveza-gran-via",
    "category": "Alcohol",
    "name": "Gran Vía (Caña / Maceta / Tercio / Tostada)",
    "description": "Rubia clásica de barril o tercio 1/3 (2,50€), Caña fría (1,50€), Maceta grande (3,00€) o Caña tostada (2,20€).",
    "price": 2.5,
    "badge": "De Barril",
    "image": "https://images.unsplash.com/photo-1608270191963-c7e6c1e5d315?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "cubo-botellines",
    "category": "Alcohol",
    "name": "Cubo de 5 Botellines Estrella Galicia (1/5)",
    "description": "Cubo metálico con hielo y 5 botellines de 1/5 de Estrella Galicia para compartir con amigos.",
    "price": 5,
    "badge": "Super Oferta",
    "image": "https://images.unsplash.com/photo-1584225064785-c62a8b43d148?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "estrella-1906-reserva",
    "category": "Alcohol",
    "name": "Estrella Galicia 1906 / Red Vintage",
    "description": "La colorada clásica 1906 Reserva Especial o Red Vintage (2,80€). También disponible Estrella sin gluten (2,80€).",
    "price": 2.8,
    "badge": "Especial",
    "image": "https://images.unsplash.com/photo-1535958636474-b021ee887b13?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "alhambra-1925",
    "category": "Alcohol",
    "name": "Alhambra Reserva 1925 / Roja",
    "description": "La mítica verde de Alhambra (2,50€) o la Alhambra Reserva Roja de trago lento (2,80€).",
    "price": 2.5,
    "badge": "Granada",
    "image": "https://images.unsplash.com/photo-1600565193348-f74bd3c7ccdf?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "cervezas-internacionales",
    "category": "Alcohol",
    "name": "Internacionales (Corona, Stella Artois, Budweiser, Heineken)",
    "description": "Corona mexicana con lima (3,00€), Stella Artois belga (3,00€), Budweiser (3,00€), Heineken o Mahou 5 Estrellas (2,50€).",
    "price": 3,
    "badge": "Mundo",
    "image": "https://images.unsplash.com/photo-1584225064785-c62a8b43d148?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "cervezas-trigo-belgas",
    "category": "Alcohol",
    "name": "Cervezas de Trigo & Abadía Belga (Paulaner, Franziskaner, Leffe, Guinness)",
    "description": "Franziskaner rubia o negra (4,00€), Paulaner (4,50€), Leffe Blonde o Brune (3,50€), Modelo Negra (3,50€) o Guinness (3,50€).",
    "price": 3.5,
    "badge": "Premium",
    "image": "https://images.unsplash.com/photo-1518176258769-f227c798150e?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "radler-desperados-00",
    "category": "Alcohol",
    "name": "Radler Limón, Desperados Tequila & Mahou 0,0",
    "description": "Radler con limón (2,50€), Desperados con tequila (3,00€) o Mahou 0,0 Tostada sin alcohol (2,50€).",
    "price": 2.5,
    "badge": "Refrescante",
    "image": "https://images.unsplash.com/photo-1584225064785-c62a8b43d148?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "copas-ginebra",
    "category": "Alcohol",
    "name": "Copas de Ginebra (Rives, Beefeater, Tanqueray, Seagrams, Nordés)",
    "description": "Servidas en copa balón con hielo macizo y tónica/refresco: Rives (5€), Rives 1880/Exótica/Pink (6€), Larios 12 (6€), Tanqueray (6€), Beefeater (6€), Seagrams o Bombay Sapphire (6,50€), Nordés o Martin Millers (7,50€).",
    "price": 6,
    "badge": "Copa Balón",
    "image": "https://images.unsplash.com/photo-1551538827-9c037cb4f32a?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "copas-ron",
    "category": "Alcohol",
    "name": "Copas de Ron (Barceló, Brugal, Legendario, Cacique, Arehucas, Imperial)",
    "description": "Cacique (5€), Bacardí (5,50€), Barceló, Brugal, Legendario, Arehucas, Bacardí Limón, Malibú o Pampero (6€), Barceló Imperial añejo (8€).",
    "price": 6,
    "badge": "Ron Caribeño",
    "image": "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "copas-whisky-vodka",
    "category": "Alcohol",
    "name": "Copas de Whisky & Vodka (Jack Daniels, Ballantines, Red Label, Absolut, Cîroc)",
    "description": "Dyc 8 (5€), Cutty Sark, White Label, Ballantines, JB, Johnnie Walker (6€), Jameson (6,50€), Jack Daniels Tennessee (7€). Vodka VH (5€), Absolut (6€), Cîroc (7,50€).",
    "price": 6,
    "badge": "Destilados",
    "image": "https://images.unsplash.com/photo-1527061011665-3652c757a4d4?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "licores-chupitos",
    "category": "Alcohol",
    "name": "Licores (Baileys, Licor 43, Amaretto, Jägermeister, Ponche)",
    "description": "Baileys (5€), Licor 43 (6€), Amaretto Disaronno (6€), Jägermeister (6€), Carlos III (6€), Ponche Caballero (4,50€), Ruavieja o Martini (4€).",
    "price": 5,
    "badge": "Sobremesa",
    "image": "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "refrescos-variados",
    "category": "Refrescos",
    "name": "Refrescos (Coca Cola, Zero, Fanta, Kas, 7up, Tónica Schweppes)",
    "description": "Botellín de cristal frío: Coca Cola normal o Zero, Fanta naranja o limón, Kas, 7up o Tónica Schweppes (clásica, berry o pomelo).",
    "price": 2,
    "badge": "Botellín Frío",
    "image": "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "monster-energy",
    "category": "Refrescos",
    "name": "Monster Energy (Original, Mango Loco, Zero) & Powerking",
    "description": "Lata de 500ml de Monster Energy (2,50€) o Powerking (2,00€). Si pides Monster para combinar con tu copa tiene recargo de +1€.",
    "price": 2.5,
    "badge": "Energético",
    "image": "https://images.unsplash.com/photo-1622543925917-763c34d1a86e?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "nestea-aquarade-zumos",
    "category": "Refrescos",
    "name": "Nestea, Aquarade, Zumos, Limonada & Agua",
    "description": "Nestea limón o maracuyá (2,20€), Aquarade (2,20€), Zumos variados o Limonada (1,80€), Agua mineral (1,50€).",
    "price": 2.2,
    "badge": null,
    "image": "https://images.unsplash.com/photo-1556881286-fc6915169721?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "tinto-verano",
    "category": "Alcohol",
    "name": "Tinto de Verano con Limón (o 0,0)",
    "description": "Vino tinto con refresco de limón y mucho hielo en copa grande.",
    "price": 2.5,
    "badge": "Verano",
    "image": "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=400&q=80",
    "available": true
  },
  {
    "id": "vinos-de-jerez",
    "category": "Alcohol",
    "name": "Vinos de Jerez (Tío Pepe, Oloroso, Solera, P.X, Amontillado, Tierra Blanca)",
    "description": "Copa de vino tradicional de la tierra: Tío Pepe fino (2,20€), Solera (2,20€), Oloroso (2,20€), Pedro Ximénez dulce (2,50€), Amontillado (2,80€), Tierra Blanca blanco (2,50€) o Croft Twist (2,50€).",
    "price": 2.2,
    "badge": "100% Jerez",
    "image": "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=400&q=80",
    "available": true
  }
];

  let currentCategory = 'Cócteles';

  // ==========================================
  // TEMA OSCURO / CLARO
  // ==========================================
  const themeToggle = $('#theme-toggle');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

  function initTheme() {
    const savedTheme = localStorage.getItem('bodhi_theme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
      updateThemeIcon(savedTheme);
    } else if (prefersDark.matches) {
      document.documentElement.setAttribute('data-theme', 'dark');
      updateThemeIcon('dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      updateThemeIcon('light');
    }
  }

  function updateThemeIcon(theme) {
    if (!themeToggle) return;
    if (theme === 'dark') {
      themeToggle.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
      themeToggle.setAttribute('aria-label', 'Cambiar a modo claro');
    } else {
      themeToggle.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
      themeToggle.setAttribute('aria-label', 'Cambiar a modo oscuro');
    }
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const target = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', target);
      localStorage.setItem('bodhi_theme', target);
      updateThemeIcon(target);
    });
  }

  initTheme();

  // ==========================================
  // MENÚ MÓVIL
  // ==========================================
  const burger = $('#burger');
  const menu = $('#menu');
  if (burger && menu) {
    burger.addEventListener('click', () => {
      const isOpen = menu.classList.toggle('open');
      burger.setAttribute('aria-expanded', isOpen);
    });

    menu.addEventListener('click', (e) => {
      if (e.target.tagName === 'A' || e.target.closest('a')) {
        menu.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
      }
    });
  }


  // ==========================================
  // ESTADO EN TIEMPO REAL: ABIERTO / CERRADO
  // ==========================================
  function updateBusinessStatus() {
    const statusDot = $('#status-dot');
    const statusText = $('#status-text');
    if (!statusDot || !statusText) return;

    const now = new Date();
    const day = now.getDay(); // 0: Dom, 1: Lun, 2: Mar, ...
    const hour = now.getHours();
    const min = now.getMinutes();
    const timeVal = hour + min / 60;

    let isOpen = false;
    let text = 'Cerrado ahora';

    if (day === 1) {
      text = 'Cerrado los lunes · Abrimos mañana 18:00';
    } else {
      const isWeekend = day === 5 || day === 6; // Vie o Sáb
      const maxLate = isWeekend ? 3 : 2;

      // Abierto tarde noche (18:00 a 23:59) o madrugada (00:00 a maxLate)
      if (timeVal >= 18 || timeVal < maxLate) {
        isOpen = true;
        text = `Abierto ahora · Cierra a las 0${maxLate}:00`;
      } else {
        text = 'Cerrado ahora · Abrimos hoy a las 18:00';
      }
    }

    if (isOpen) {
      statusDot.classList.remove('closed');
      statusText.textContent = text;
    } else {
      statusDot.classList.add('closed');
      statusText.textContent = text;
    }

    // Resaltar día actual en la tabla de contacto
    const rows = $$('.schedule-table tr');
    const dayMap = [3, 0, 1, 1, 1, 2, 2];
    const targetRowIndex = dayMap[day];
    if (rows && rows[targetRowIndex]) {
      rows[targetRowIndex].classList.add('today');
    }
  }

  updateBusinessStatus();

  // ==========================================
  // CARTA INTERACTIVA
  // ==========================================
  async function loadCarta() {
    if (!isFileProtocol) {
      try {
        const res = await fetch('/api/carta');
        if (res.ok) {
          const json = await res.json();
          if (json.items && json.items.length > 0) {
            cartaData = json.items;
          }
        }
      } catch (e) {
        // En caso de fallo de red, los datos precargados se mantienen intactos
      }
    }

    renderTabs();
    renderCartaItems();
  }

  const categoryIcons = {
    'Cócteles': '🍸',
    'Cachimbas': '💨',
    'Refrescos': '🥤',
    'Alcohol': '🍺',
    'Tés, Cafés & Meriendas': '🫖',
    'Todos': '✨',
    'Cortes': '✂️',
    'Barba': '🪒',
    'Tratamientos': '💆'
  };

  function getCategories() {
    const defaultOrder = [
      'Cócteles',
      'Cachimbas',
      'Refrescos',
      'Alcohol',
      'Tés, Cafés & Meriendas',
      'Cortes',
      'Barba',
      'Tratamientos'
    ];
    const set = new Set();
    cartaData.forEach(item => {
      let cat = (item.category || 'General').trim();
      set.add(cat);
    });
    const all = Array.from(set);
    all.sort((a, b) => {
      const idxA = defaultOrder.indexOf(a);
      const idxB = defaultOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
    return all.length ? all : ['General'];
  }

  window.updateCartaData = function (newItems) {
    if (Array.isArray(newItems) && newItems.length > 0) {
      cartaData = newItems;
      const cats = getCategories();
      currentCategory = cats[0] || '';
      renderTabs();
      renderCartaItems();
    }
  };

  function renderTabs() {
    const tabsBox = $('#tabs');
    if (!tabsBox) return;
    tabsBox.innerHTML = '';

    const categories = getCategories();
    const listToRender = [...categories];
    if (categories.length > 1) {
      listToRender.push('Todos');
    }

    if (!listToRender.includes(currentCategory) && listToRender.length > 0) {
      currentCategory = listToRender[0];
    }

    listToRender.forEach(cat => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab';
      const icon = categoryIcons[cat] ? categoryIcons[cat] + ' ' : '';
      btn.innerHTML = '<span>' + icon + escapeHtml(cat) + '</span>';
      btn.setAttribute('aria-pressed', cat === currentCategory);
      btn.addEventListener('click', () => {
        currentCategory = cat;
        renderTabs();
        renderCartaItems();
      });
      tabsBox.appendChild(btn);
    });
  }

  function renderCartaItems(filterQuery = '') {
    const container = $('#items');
    if (!container) return;
    container.innerHTML = '';

    const query = filterQuery.toLowerCase().trim();
    const items = cartaData.filter(i => {
      const matchCat = (currentCategory === 'Todos' || !currentCategory || query) ? true : i.category === currentCategory;
      const matchQuery = !query ||
        i.name.toLowerCase().includes(query) ||
        i.description.toLowerCase().includes(query) ||
        (i.badge && i.badge.toLowerCase().includes(query));
      return matchCat && matchQuery;
    });

    if (items.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 40px 20px; color: var(--mut);">
          <p style="font-size: 1.2rem; margin-bottom: 8px;">No encontramos productos con ese término.</p>
          <small>Prueba buscando "menta", "pistacho", "vegano" o selecciona otra categoría arriba.</small>
        </div>
      `;
      return;
    }

    items.forEach(item => {
      const card = document.createElement('article');
      card.className = `menu-card ${item.available ? '' : 'unavailable'}`;

      let badgeHtml = '';
      if (!item.available) {
        badgeHtml = `<span class="badge out">Agotado hoy</span>`;
      } else if (item.badge) {
        badgeHtml = `<span class="badge ${item.badge.includes('Top') ? 'top' : ''}">${escapeHtml(item.badge)}</span>`;
      }

      card.innerHTML = `
        <div class="thumb">
          <img src="${item.image || 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=400&q=80'}"
               alt="${escapeHtml(item.name)}" loading="lazy">
        </div>
        <div class="info">
          <div>
            <div class="title-row">
              <h3>${escapeHtml(item.name)}</h3>
              <span class="price">${Number(item.price).toFixed(2).replace('.', ',')} €</span>
            </div>
            <p>${escapeHtml(item.description)}</p>
          </div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:auto;flex-wrap:wrap;">
            ${(currentCategory === 'Todos' || query) ? `<span style="font-size:0.75rem;font-weight:700;background:var(--sand);color:var(--ink);padding:2px 8px;border-radius:6px;">${categoryIcons[item.category] || '🏷️'} ${escapeHtml(item.category)}</span>` : ''}
            ${badgeHtml}
          </div>
        </div>
      `;
      container.appendChild(card);
    });
  }

  const searchInput = $('#carta-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderCartaItems(e.target.value);
    });
  }

  // Ejecutar render de carta de inmediato
  loadCarta();

  // ==========================================
  // ASISTENTE DE RESERVAS
  // ==========================================
  const dateInput = $('#d');
  const timeSelect = $('#h');
  const guestsSelect = $('#p');
  const hintBox = $('#hint');
  const form = $('#form');
  const submitBtn = $('#submit-btn');

  function updateGuestsHint() {
    if (!hintBox || !guestsSelect) return;
    const n = Number(guestsSelect.value);
    if (n <= 4) {
      hintBox.textContent = '✨ Confirmación inmediata para mesas pequeñas.';
    } else if (n <= 12) {
      hintBox.textContent = '👥 Grupos medianos: os reservamos sofá o zona lounge preferente.';
    } else {
      hintBox.textContent = '🎉 Para grupos de más de 12 personas, coordinaremos detalles por WhatsApp.';
    }
  }

  if (guestsSelect) {
    guestsSelect.addEventListener('change', updateGuestsHint);
    updateGuestsHint();
  }

  if (dateInput) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    dateInput.min = `${yyyy}-${mm}-${dd}`;
    if (!dateInput.value) {
      dateInput.value = `${yyyy}-${mm}-${dd}`;
    }

    // Permitir abrir el calendario nativo al hacer clic en cualquier parte del campo
    dateInput.addEventListener('click', () => {
      if (typeof dateInput.showPicker === 'function') {
        try {
          dateInput.showPicker();
        } catch (e) {
          // Fallback silencioso si el navegador restringe showPicker
        }
      }
    });

    dateInput.addEventListener('change', () => {
      validateDateSelection();
      populateTimeSlots();
    });

    validateDateSelection();
    populateTimeSlots();
  }

  function validateDateSelection() {
    if (!dateInput) return true;
    const val = dateInput.value;
    if (!val) return false;
    const d = new Date(val + 'T12:00:00');
    if (d.getDay() === 1) { // Lunes cerrado
      showToast('Los lunes estamos cerrados por descanso. Por favor elige de martes a domingo.', 'error');
      dateInput.setCustomValidity('Los lunes la tetería permanece cerrada.');
      return false;
    } else {
      dateInput.setCustomValidity('');
      return true;
    }
  }

  function populateTimeSlots() {
    if (!timeSelect) return;
    const currentVal = timeSelect.value;
    timeSelect.innerHTML = '';

    // Si el negocio define franjas horarias personalizadas (ej. barberías, consultas, etc.)
    if (Array.isArray(window.customTimeSlots) && window.customTimeSlots.length > 0) {
      window.customTimeSlots.forEach(slot => {
        const opt = document.createElement('option');
        opt.value = slot;
        opt.textContent = `${slot} h`;
        if (slot === currentVal) opt.selected = true;
        timeSelect.appendChild(opt);
      });
      if (!timeSelect.value) timeSelect.value = window.customTimeSlots[0];
      return;
    }

    const val = dateInput ? dateInput.value : '';
    const day = val ? new Date(val + 'T12:00:00').getDay() : 2;
    const isWeekend = day === 5 || day === 6;

    // Franjas de 18:00 a 23:30
    for (let h = 18; h <= 23; h++) {
      ['00', '30'].forEach(m => {
        const slot = `${String(h).padStart(2, '0')}:${m}`;
        const opt = document.createElement('option');
        opt.value = slot;
        opt.textContent = `${slot} h`;
        timeSelect.appendChild(opt);
      });
    }

    // Franjas de madrugada (00:00 a 02:00 / 03:00)
    const maxHour = isWeekend ? 2 : 1;
    for (let h = 0; h <= maxHour; h++) {
      ['00', '30'].forEach(m => {
        const slot = `${String(h).padStart(2, '0')}:${m}`;
        const opt = document.createElement('option');
        opt.value = slot;
        opt.textContent = `${slot} h (noche)`;
        timeSelect.appendChild(opt);
      });
    }

    timeSelect.value = currentVal || '20:30';
  }

  window.populateTimeSlots = populateTimeSlots;

  // Envío del formulario
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      if (!validateDateSelection()) return;

      const name = $('#n').value.trim();
      const phone = $('#t').value.trim();
      const date = $('#d').value;
      const time = $('#h').value;
      const guests = $('#p').value;
      const zoneEl = document.querySelector('input[name="z"]:checked');
      const zone = zoneEl ? zoneEl.value : 'indiferente';
      const notes = $('#o') ? $('#o').value.trim() : '';

      if (!name || !phone || !date || !time) {
        showToast('Por favor completa todos los campos requeridos.', 'error');
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = 'Guardando reserva...';
      }

      // Si se abre directamente como archivo local (file://)
      if (isFileProtocol) {
        const dummyCode = `BDH-${Math.floor(1000 + Math.random() * 9000)}`;
        const localRes = {
          code: dummyCode,
          name, phone, date, time, guests, zone, notes,
          status: Number(guests) > 4 ? 'pending' : 'confirmed'
        };
        const waMsg = encodeURIComponent(
          `¡Hola Bodhi! He solicitado una reserva a nombre de *${localRes.name}* para el día *${localRes.date}* a las *${localRes.time}* (${localRes.guests} personas, zona ${localRes.zone}). Código: *${localRes.code}*. ¡Muchas gracias!`
        );
        const waUrl = `https://wa.me/34600000000?text=${waMsg}`;

        showConfirmationModal(localRes, waUrl);
        form.reset();
        populateTimeSlots();
        updateGuestsHint();
        showToast('¡Reserva registrada! (Modo vista local)', 'success');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = 'Solicitar reserva de mesa';
        }
        return;
      }

      // Conexión normal por HTTP/Vercel
      try {
        const res = await fetch('/api/reservas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone, date, time, guests, zone, notes })
        });

        const data = await res.json();

        if (res.ok && data.success) {
          showConfirmationModal(data.reservation, data.whatsappUrl);
          form.reset();
          populateTimeSlots();
          updateGuestsHint();
          showToast('¡Reserva registrada con éxito!', 'success');
        } else {
          showToast(data.error || 'No se pudo registrar la reserva.', 'error');
        }
      } catch (err) {
        console.error('Error enviando reserva:', err);
        showToast('Hubo un problema de conexión con el servidor.', 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = 'Solicitar reserva de mesa';
        }
      }
    });
  }

  // ==========================================
  // MODAL DE CONFIRMACIÓN
  // ==========================================
  function showConfirmationModal(reservation, whatsappUrl) {
    const modal = $('#confirm-modal');
    if (!modal) return;

    $('#modal-code').textContent = reservation.code || 'BDH-OK';
    $('#modal-name').textContent = reservation.name;
    $('#modal-datetime').textContent = `${formatDate(reservation.date)} a las ${reservation.time} h`;
    $('#modal-guests').textContent = `${reservation.guests} personas (Zona ${translateZone(reservation.zone)})`;

    const statusBadge = $('#modal-status');
    if (statusBadge) {
      if (reservation.status === 'confirmed') {
        statusBadge.textContent = 'Mesa confirmada';
        statusBadge.style.background = '#E8F5E9';
        statusBadge.style.color = '#2E7D32';
      } else {
        statusBadge.textContent = 'Pendiente de confirmación';
        statusBadge.style.background = '#FFF3E0';
        statusBadge.style.color = '#E65100';
      }
    }

    const waBtn = $('#modal-wa-btn');
    if (waBtn && whatsappUrl) {
      waBtn.href = whatsappUrl;
    }

    modal.classList.add('active');
  }

  const modalClose = $('#modal-close');
  const modalOverlay = $('#confirm-modal');
  if (modalClose && modalOverlay) {
    modalClose.addEventListener('click', () => modalOverlay.classList.remove('active'));
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) modalOverlay.classList.remove('active');
    });
  }

  // ==========================================
  // TOAST NOTIFICATIONS
  // ==========================================
  function showToast(message, type = 'info') {
    let toast = $('#toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }

    toast.className = `toast ${type}`;
    toast.textContent = message;
    toast.classList.add('show');

    setTimeout(() => {
      toast.classList.remove('show');
    }, 4500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
  }

  function formatDate(isoDate) {
    if (!isoDate) return '';
    const [y, m, d] = isoDate.split('-');
    return `${d}/${m}/${y}`;
  }

  function translateZone(z) {
    if (z === 'int' || z === 'interior') return 'Interior Lounge';
    if (z === 'ter' || z === 'terraza') return 'Terraza Exterior';
    return 'Indiferente';
  }

})();
