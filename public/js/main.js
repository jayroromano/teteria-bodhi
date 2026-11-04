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
      id: "te-moruno",
      category: "Tés e Infusiones",
      name: "Té Verde Moruno Tradicional",
      description: "Té verde gunpowder seleccionado, hierbabuena fresca de la huerta andaluza y azúcar moreno en tetera de plata.",
      price: 3.80,
      badge: "Especialidad",
      image: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=400&q=80",
      available: true
    },
    {
      id: "chai-pakistani",
      category: "Tés e Infusiones",
      name: "Té Pakistaní Especiado",
      description: "Mezcla secreta de té negro, canela en rama, cardamomo verde, clavo y leche cremosa emulsionada.",
      price: 4.20,
      badge: "Top Ventas",
      image: "https://images.unsplash.com/photo-1561336313-0bd5e0b27ec8?auto=format&fit=crop&w=400&q=80",
      available: true
    },
    {
      id: "rooibos-azahar",
      category: "Tés e Infusiones",
      name: "Rooibos Flor de Azahar & Naranja",
      description: "Infusión sudafricana sin teína, corteza de naranja amarga, pétalos de azahar y toque de vainilla Bourbon.",
      price: 3.90,
      badge: "Sin Teína",
      image: "https://images.unsplash.com/photo-1597481499750-3e6b22637e12?auto=format&fit=crop&w=400&q=80",
      available: true
    },
    {
      id: "te-blanco-jazmin",
      category: "Tés e Infusiones",
      name: "Té Blanco Agujas de Plata & Jazmín",
      description: "Primer brote de té blanco con aroma natural de flores nocturnas de jazmín. Suave, floral y antioxidante.",
      price: 4.50,
      badge: "Premium",
      image: "https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=400&q=80",
      available: true
    },
    {
      id: "cachimba-bodhi",
      category: "Cachimbas",
      name: "Bodhi Signature Velvet",
      description: "Nuestra mezcla de la casa: frutos del bosque silvestres, toque glacial de menta suave y base de agua perfumada.",
      price: 14.00,
      badge: "Top Ventas",
      image: "https://images.unsplash.com/photo-1527661591475-527312dd65f5?auto=format&fit=crop&w=400&q=80",
      available: true
    },
    {
      id: "cachimba-love66",
      category: "Cachimbas",
      name: "Love 66 Passion",
      description: "Sensación exótica de melón cantalupo, fruta de la pasión, sandía jugosa y menta helada.",
      price: 13.50,
      badge: "Favorito",
      image: "https://images.unsplash.com/photo-1527661591475-527312dd65f5?auto=format&fit=crop&w=400&q=80",
      available: true
    },
    {
      id: "cachimba-doble-manzana",
      category: "Cachimbas",
      name: "Doble Manzana Tradicional",
      description: "El sabor clásico oriental por excelencia: manzana roja y verde con notas anisadas profundas.",
      price: 13.00,
      badge: "Clásico",
      image: "https://images.unsplash.com/photo-1527661591475-527312dd65f5?auto=format&fit=crop&w=400&q=80",
      available: true
    },
    {
      id: "coctel-bodhi-spritz",
      category: "Cócteles",
      name: "Bodhi Tea Spritz",
      description: "Reducción artesanal de té Earl Grey, flor de saúco St. Germain, cava andaluz brut y twist de pomelo.",
      price: 7.50,
      badge: "Autor",
      image: "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=400&q=80",
      available: true
    },
    {
      id: "mojito-andalusi",
      category: "Cócteles",
      name: "Mojito Andalusí de Hierbabuena",
      description: "Ron blanco caribeño macerado en tetería, hierbabuena fresca, azúcar de caña tostado y ginger ale.",
      price: 7.00,
      badge: "Recomendado",
      image: "https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=400&q=80",
      available: true
    },
    {
      id: "mocktail-oasis",
      category: "Cócteles",
      name: "Mocktail Oasis (Sin Alcohol)",
      description: "Zumo de maracuyá fresco, puré de mango, infusión fría de hibisco y espuma de jengibre.",
      price: 5.50,
      badge: "Sin Alcohol",
      image: "https://images.unsplash.com/photo-1621263764928-df1444c5e859?auto=format&fit=crop&w=400&q=80",
      available: true
    },
    {
      id: "surtido-baklava",
      category: "Dulces & Repostería",
      name: "Surtido Artesano de Baklavas",
      description: "Finas capas de masa filo crujiente rellenas de pistacho iraní, nueces y bañadas en almíbar de azahar y miel.",
      price: 5.00,
      badge: "Casero",
      image: "https://images.unsplash.com/photo-1519869325930-281384150729?auto=format&fit=crop&w=400&q=80",
      available: true
    },
    {
      id: "pastas-arabes",
      category: "Dulces & Repostería",
      name: "Cuernos de Gacela & Pastas Árabes",
      description: "Repostería tradicional de almendra marcona, canela y agua de rosas. El maridaje perfecto para tu té.",
      price: 4.50,
      badge: "Artesano",
      image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=400&q=80",
      available: true
    },
    {
      id: "tarta-zanahoria",
      category: "Dulces & Repostería",
      name: "Tarta Especiada de Zanahoria & Nueces",
      description: "Bizcocho húmedo con canela de Ceilán, nueces de Ronda y suave frosting de mascarpone al limón.",
      price: 4.80,
      badge: "Favorito",
      image: "https://images.unsplash.com/photo-1535141192574-5d4897c13136?auto=format&fit=crop&w=400&q=80",
      available: true
    },
    {
      id: "hummus-pita",
      category: "Comida & Picoteo",
      name: "Hummus Bodhi con Pan de Pita Caliente",
      description: "Crema suave de garbanzos con tahini tostado, aceite de oliva virgen extra de Jaén, pimentón de la Vera y pan recién horneado.",
      price: 6.50,
      badge: "Vegano",
      image: "https://images.unsplash.com/photo-1541518763669-27fef04b14ea?auto=format&fit=crop&w=400&q=80",
      available: true
    },
    {
      id: "tabla-quesos-sierra",
      category: "Comida & Picoteo",
      name: "Tabla de Quesos Payoyo de la Sierra",
      description: "Selección de quesos gaditanos de cabra payoya y oveja curada, acompañados de nueces, mermelada de higos y tostas.",
      price: 9.50,
      badge: "Local Cádiz",
      image: "https://images.unsplash.com/photo-1631379578550-7038263db699?auto=format&fit=crop&w=400&q=80",
      available: true
    }
  ];

  let currentCategory = 'Tés e Infusiones';

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
      themeToggle.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
      themeToggle.setAttribute('aria-label', 'Cambiar a modo claro');
    } else {
      themeToggle.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
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

  function getCategories() {
    const defaultOrder = ['Tés', 'Cócteles', 'Otro', 'Cortes', 'Barba', 'Tratamientos'];
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
    if (!categories.includes(currentCategory) && categories.length > 0) {
      currentCategory = categories[0];
    }

    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab';
      btn.textContent = cat;
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
      const matchCat = query ? true : i.category === currentCategory;
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
          ${badgeHtml}
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
    if (z === 'ter' || z === 'terraza') return 'Terraza Andalusí';
    return 'Indiferente';
  }

})();
