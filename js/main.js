/**
 * TETERÍA BODHI · CLIENTE WEB PRINCIPAL
 * Jerez de la Frontera
 */

(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);

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
      if (e.target.tagName === 'A') {
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
    const dayMap = [6, 0, 1, 1, 1, 2, 2]; // mapeo al index de la tabla
    const targetRowIndex = dayMap[day];
    if (rows[targetRowIndex]) {
      rows[targetRowIndex].classList.add('today');
    }
  }

  updateBusinessStatus();

  // ==========================================
  // CARTA INTERACTIVA DESDE API
  // ==========================================
  let cartaData = [];
  let currentCategory = 'Tés e Infusiones';

  async function loadCarta() {
    try {
      const res = await fetch('/api/carta');
      if (res.ok) {
        const json = await res.json();
        cartaData = json.items || [];
      } else {
        throw new Error('Fallback local');
      }
    } catch (e) {
      console.warn('Cargando carta de reserva local:', e.message);
      // Fallback mínimo
      cartaData = [
        { id: '1', category: 'Tés e Infusiones', name: 'Té Verde Moruno Tradicional', description: 'Té verde gunpowder, hierbabuena fresca y azúcar moreno.', price: 3.80, available: true, badge: 'Especialidad', image: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=400&q=80' },
        { id: '2', category: 'Cachimbas', name: 'Bodhi Signature Velvet', description: 'Frutos del bosque, menta glacial suave y base perfumada.', price: 14.00, available: true, badge: 'Top Ventas', image: 'https://images.unsplash.com/photo-1527661591475-527312dd65f5?auto=format&fit=crop&w=400&q=80' },
        { id: '3', category: 'Cócteles', name: 'Bodhi Tea Spritz', description: 'Reducción de Earl Grey, flor de saúco y cava andaluz brut.', price: 7.50, available: true, badge: 'Autor', image: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=400&q=80' }
      ];
    }

    renderTabs();
    renderCartaItems();
  }

  function getCategories() {
    const set = new Set();
    cartaData.forEach(item => set.add(item.category));
    return Array.from(set);
  }

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
          <small>Prueba buscando "menta", "pistacho", "vegano" o selecciona otra categoría.</small>
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

  loadCarta();

  // ==========================================
  // ASISTENTE DE RESERVAS INTELIGENTE
  // ==========================================
  const dateInput = $('#d');
  const timeSelect = $('#h');
  const guestsSelect = $('#p');
  const hintBox = $('#hint');
  const form = $('#form');
  const submitBtn = $('#submit-btn');

  // Inicializar selector de comensales
  if (guestsSelect) {
    guestsSelect.innerHTML = '';
    for (let i = 1; i <= 12; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${i} ${i === 1 ? 'persona' : 'personas'}`;
      guestsSelect.appendChild(opt);
    }
    const optMore = document.createElement('option');
    optMore.value = '13';
    optMore.textContent = 'Más de 12 personas (Grupo especial)';
    guestsSelect.appendChild(optMore);
    guestsSelect.value = '2';

    guestsSelect.addEventListener('change', updateGuestsHint);
    updateGuestsHint();
  }

  function updateGuestsHint() {
    if (!hintBox || !guestsSelect) return;
    const n = Number(guestsSelect.value);
    if (n <= 4) {
      hintBox.textContent = '✨ Confirmación inmediata para mesas pequeñas.';
    } else if (n <= 12) {
      hintBox.textContent = '👥 Grupos medianos: os reservamos sofá o zona lounge preferente.';
    } else {
      hintBox.textContent = '🎉 Para eventos o más de 12 personas, coordinaremos detalles por WhatsApp.';
    }
  }

  // Configurar fecha mínima (hoy) y selector dinámico de horas
  if (dateInput) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    dateInput.min = `${yyyy}-${mm}-${dd}`;
    dateInput.value = `${yyyy}-${mm}-${dd}`;

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
    if (d.getDay() === 1) { // Lunes
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
    const val = dateInput ? dateInput.value : '';
    const day = val ? new Date(val + 'T12:00:00').getDay() : 2;
    const isWeekend = day === 5 || day === 6; // Vie / Sáb hasta las 03:00

    timeSelect.innerHTML = '<option value="">Selecciona hora...</option>';

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

    // Franjas de madrugada (00:00 a 02:00 o 03:00)
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

    timeSelect.value = '20:30';
  }

  // Enviar formulario al API con base de datos
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      if (!validateDateSelection()) return;

      const name = $('#n').value.trim();
      const phone = $('#t').value.trim();
      const email = $('#e').value.trim();
      const date = $('#d').value;
      const time = $('#h').value;
      const guests = $('#p').value;
      const zoneEl = document.querySelector('input[name="z"]:checked');
      const zone = zoneEl ? zoneEl.value : 'indiferente';
      const notes = $('#o').value.trim();

      if (!name || !phone || !date || !time) {
        showToast('Por favor completa todos los campos requeridos.', 'error');
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `
          <svg style="animation:spin 1s linear infinite;width:18px;height:18px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          Guardando reserva...
        `;
      }

      try {
        const res = await fetch('/api/reservas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone, email, date, time, guests, zone, notes })
        });

        const data = await res.json();

        if (res.ok && data.success) {
          showConfirmationModal(data.reservation, data.whatsappUrl);
          form.reset();
          if (guestsSelect) guestsSelect.value = '2';
          populateTimeSlots();
          updateGuestsHint();
          showToast('¡Reserva registrada con éxito!', 'success');
        } else {
          showToast(data.error || 'No se pudo registrar la reserva.', 'error');
        }
      } catch (err) {
        console.error('Error enviando reserva:', err);
        showToast('Hubo un problema de conexión. Inténtalo de nuevo.', 'error');
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

  // Helpers
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
    if (z === 'int') return 'Interior Lounge';
    if (z === 'ter') return 'Terraza Andalusí';
    return 'Indiferente';
  }

})();
