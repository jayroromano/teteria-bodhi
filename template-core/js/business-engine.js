/**
 * TEMPLATE CORE · MOTOR DE PERSONALIZACIÓN Y NEGOCIOS
 * Permite transformar la web al instante según el negocio seleccionado.
 */

window.BusinessEngine = (function () {
  'use strict';

  let currentConfig = null;
  let currentCatalog = [];
  let availableBusinesses = [];

  // 1. Obtener negocio activo (URL param ?b=slug -> localStorage -> default 'bodhi')
  function getActiveSlug() {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get('b') || params.get('business');
      if (fromUrl) {
        localStorage.setItem('bodhi_active_business', fromUrl);
        return fromUrl;
      }
    } catch (e) {}

    return localStorage.getItem('bodhi_active_business') || 'bodhi';
  }

  // 2. Aplicar estilos y variables CSS dinámicas según el tema del negocio
  function applyTheme(theme) {
    if (!theme) return;

    // Fuentes de Google Fonts
    if (theme.googleFontsUrl) {
      let fontLink = document.getElementById('dynamic-business-fonts');
      if (!fontLink) {
        fontLink = document.createElement('link');
        fontLink.id = 'dynamic-business-fonts';
        fontLink.rel = 'stylesheet';
        document.head.appendChild(fontLink);
      }
      fontLink.href = theme.googleFontsUrl;
    }

    // Inyectar variables CSS en el elemento raíz
    let styleTag = document.getElementById('dynamic-business-theme-styles');
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = 'dynamic-business-theme-styles';
      document.head.appendChild(styleTag);
    }

    function toKebab(str) {
      return str.replace(/([A-Z])/g, '-$1').toLowerCase();
    }

    function formatVars(obj) {
      if (!obj) return '';
      const lines = [];
      for (const [k, v] of Object.entries(obj)) {
        const kebab = toKebab(k);
        lines.push(`  --${kebab}: ${v};`);
        if (kebab === 'btn-ink') lines.push(`  --btnink: ${v};`);
        if (kebab === 'card-bg') lines.push(`  --cardbg: ${v};`);
      }
      return lines.join('\n');
    }

    const lightVars = formatVars(theme.light);
    const darkVars = formatVars(theme.dark);

    styleTag.textContent = `
      :root, html[data-theme="light"], body.light-mode {
        --font-title: ${theme.fontTitle || "'Abril Fatface', Georgia, serif"};
        --font-body: ${theme.fontBody || "'Figtree', sans-serif"};
        --radius: ${theme.borderRadius || '16px'};
        --radius-sm: ${theme.borderRadiusSmall || '10px'};
        ${lightVars}
      }
      html[data-theme="dark"], [data-theme="dark"], body.dark-mode {
        ${darkVars}
      }
      h1, h2, h3, .logo, .ticket-header .title {
        font-family: var(--font-title) !important;
      }
      body, button, input, select, textarea {
        font-family: var(--font-body);
      }
    `;
  }

  // 3. Renderizar contenido textual y estructurado del negocio
  function applyContent(config, catalog) {
    if (!config) return;

    // Título y SEO
    if (config.identity?.seoTitle) {
      document.title = config.identity.seoTitle;
    }
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc && config.identity?.seoDescription) {
      metaDesc.setAttribute('content', config.identity.seoDescription);
    }

    // Logo & Nombre (solo personalizar dinámicamente si no es Bodhi nativo o si se especifica logoImage)
    if (config.identity?.id !== 'bodhi' || config.identity?.logoImage) {
      const logoEls = document.querySelectorAll('.logo');
      logoEls.forEach(el => {
        const text = config.identity?.name || '';
        if (config.identity?.logoImage) {
          el.innerHTML = `<img src="${config.identity.logoImage}" alt="${text}" class="logo-img"><span>${text}</span>`;
        } else {
          const emoji = config.identity?.logoEmoji || '';
          el.innerHTML = `<span style="margin-right:6px;">${emoji}</span><span>${text}</span>`;
        }
      });
    }

    // Tagline / Ciudad en barra superior
    const cityBadge = document.querySelector('.city-tag, .tag-city');
    if (cityBadge && config.identity?.city) {
      cityBadge.textContent = config.identity.city;
    }

    // HERO
    if (config.hero) {
      const heroTag = document.querySelector('#hero .tag, #hero .section-tag');
      if (heroTag) heroTag.textContent = config.hero.tag || '';

      const heroTitle = document.querySelector('#hero h1');
      if (heroTitle) heroTitle.textContent = config.hero.title || config.identity?.name || '';

      const heroSub = document.querySelector('#hero .lead, #hero p.sub, #hero .hero-desc');
      if (heroSub) heroSub.textContent = config.hero.subtitle || '';

      // Badges
      const badgesContainer = document.querySelector('#hero .chips, #hero .hero-badges');
      if (badgesContainer && Array.isArray(config.hero.badges)) {
        badgesContainer.innerHTML = '';
        config.hero.badges.forEach(b => {
          const span = document.createElement('span');
          span.className = 'chip';
          span.textContent = b;
          badgesContainer.appendChild(span);
        });
      }

      // CTAs
      const primaryBtn = document.querySelector('#hero .hero-actions .btn-primary, #hero .hero-actions a[href="#reservas"]');
      if (primaryBtn && config.identity?.primaryCta) {
        primaryBtn.textContent = config.identity.primaryCta.text;
      }
      const secondaryBtn = document.querySelector('#hero .hero-actions .btn-secondary, #hero .hero-actions a[href="#carta"]');
      if (secondaryBtn && config.identity?.secondaryCta) {
        secondaryBtn.textContent = config.identity.secondaryCta.text;
      }

      // Imagen Hero
      const heroImg = document.querySelector('#hero .hero-photo img, #hero .hero-img');
      if (heroImg && config.hero.mainImage) {
        heroImg.src = config.hero.mainImage;
        heroImg.alt = config.identity?.name || 'Foto Principal';
      }
    }

    // SOBRE NOSOTROS (ABOUT)
    if (config.about) {
      const aboutSec = document.querySelector('#teteria, #about');
      if (aboutSec) {
        const tag = aboutSec.querySelector('.section-tag');
        if (tag) tag.textContent = config.about.tag || '';

        const title = aboutSec.querySelector('h2');
        if (title) title.textContent = config.about.title || '';

        const desc = aboutSec.querySelector('p.lead, p.sub');
        if (desc) desc.textContent = config.about.description || '';

        // Features 4 pilares
        const featGrid = aboutSec.querySelector('.pillars, .features-grid');
        if (featGrid && Array.isArray(config.about.features)) {
          featGrid.innerHTML = '';
          config.about.features.forEach(f => {
            const card = document.createElement('div');
            card.className = 'pillar';
            card.innerHTML = `
              <div class="pillar-icon">${f.icon}</div>
              <h3>${f.title}</h3>
              <p>${f.description}</p>
            `;
            featGrid.appendChild(card);
          });
        }
      }
    }

    // CARTA / CATÁLOGO
    if (config.catalog) {
      const cartaHeader = document.querySelector('#carta .carta-header');
      if (cartaHeader) {
        const tag = cartaHeader.querySelector('.section-tag');
        if (tag) tag.textContent = config.catalog.sectionTag || '';

        const title = cartaHeader.querySelector('h2');
        if (title) title.textContent = config.catalog.title || '';

        const sub = cartaHeader.querySelector('.sub');
        if (sub) sub.textContent = config.catalog.subtitle || '';

        const search = document.querySelector('#carta-search-input');
        if (search && config.catalog.searchPlaceholder) {
          search.placeholder = config.catalog.searchPlaceholder;
        }
      }
    }

    // GALERÍA (conservar diseño nativo para Bodhi y formatear correctamente para nuevos negocios)
    if (config.gallery && Array.isArray(config.gallery.items)) {
      const galSec = document.querySelector('#galeria');
      if (galSec) {
        const tag = galSec.querySelector('.section-tag');
        if (tag && config.gallery.sectionTag && config.identity?.id !== 'bodhi') tag.textContent = config.gallery.sectionTag;
        const title = galSec.querySelector('h2');
        if (title && config.gallery.title && config.identity?.id !== 'bodhi') title.textContent = config.gallery.title;
        const sub = galSec.querySelector('.sub');
        if (sub && config.gallery.subtitle && config.identity?.id !== 'bodhi') sub.textContent = config.gallery.subtitle;

        const mosaic = galSec.querySelector('.mosaic, .gallery-grid');
        if (mosaic && config.identity?.id !== 'bodhi') {
          mosaic.innerHTML = '';
          config.gallery.items.forEach((item, idx) => {
            const itemDiv = document.createElement('div');
            const spanClass = (idx === 0 || idx === 3) ? 't' : (idx === 4 ? 'w' : '');
            itemDiv.className = `mosaic-item ${spanClass} m-item m${idx + 1}`.trim();
            itemDiv.innerHTML = `
              <img src="${item.url}" alt="${item.caption || item.tag || 'Foto de galería'}" loading="lazy">
              <div class="caption">${item.caption || item.tag || ''}</div>
            `;
            mosaic.appendChild(itemDiv);
          });
        }
      }
    }

    // FORMULARIO DE RESERVAS / CITAS
    if (config.booking) {
      const bookSec = document.querySelector('#reservas');
      if (bookSec) {
        const ticketTitle = bookSec.querySelector('.ticket-header .title');
        if (ticketTitle) ticketTitle.textContent = config.booking.title || 'Reserva';

        const stepBadge = bookSec.querySelector('.ticket-header .step-badge');
        if (stepBadge) stepBadge.textContent = config.booking.stepBadge || 'Online';

        // Personas / Especialista Select
        const guestsLabel = bookSec.querySelector('label[for="p"]');
        if (guestsLabel && config.booking.personLabel) {
          guestsLabel.textContent = `${config.booking.personLabel} *`;
        }

        const guestsSelect = document.querySelector('#p');
        if (guestsSelect && Array.isArray(config.booking.guestsOptions)) {
          guestsSelect.innerHTML = '';
          config.booking.guestsOptions.forEach(opt => {
            const option = document.createElement('option');
            if (typeof opt === 'object') {
              option.value = opt.value;
              option.textContent = opt.label;
            } else {
              option.value = opt;
              option.textContent = `${opt} ${opt === 1 ? 'persona' : 'personas'}`;
            }
            if (String(opt.value || opt) === String(config.booking.defaultGuests)) {
              option.selected = true;
            }
            guestsSelect.appendChild(option);
          });
        }

        // Zona / Servicio Radios o Select
        const zoneField = bookSec.querySelector('.zone-group, .radio-pills');
        if (zoneField && Array.isArray(config.booking.zones)) {
          zoneField.innerHTML = '';
          config.booking.zones.forEach((z, idx) => {
            const label = document.createElement('label');
            label.className = 'pill-radio';
            label.innerHTML = `
              <input type="radio" name="z" value="${z.value}" ${idx === 0 ? 'checked' : ''}>
              <span>${z.label}</span>
            `;
            zoneField.appendChild(label);
          });
        }

        // Franjas horarias si están configuradas
        if (Array.isArray(config.booking.timeSlots) && typeof window.populateTimeSlots === 'function') {
          window.customTimeSlots = config.booking.timeSlots;
          window.populateTimeSlots();
        }
      }
    }

    // CONTACTO & HORARIOS
    if (config.contact) {
      const contactSec = document.querySelector('#contacto');
      if (contactSec) {
        const addrLink = contactSec.querySelector('.contact-dl dd a[href*="maps"]');
        if (addrLink) {
          addrLink.href = config.contact.mapsUrl || '#';
          addrLink.querySelector('span') ? addrLink.querySelector('span').textContent = config.contact.address : addrLink.textContent = config.contact.address;
        }

        const phoneLink = contactSec.querySelector('.contact-dl dd a[href^="tel:"]');
        if (phoneLink && config.contact.phone) {
          phoneLink.href = `tel:${config.contact.phone.replace(/\s+/g, '')}`;
          phoneLink.textContent = config.contact.phoneDisplay || config.contact.phone;
        }

        const waLink = contactSec.querySelector('.contact-dl dd a[href*="wa.me"]');
        if (waLink && config.contact.whatsapp) {
          waLink.href = `https://wa.me/${config.contact.whatsapp}`;
          waLink.textContent = config.contact.whatsappDisplay || config.contact.whatsapp;
        }

        // Horarios
        const scheduleTable = contactSec.querySelector('.schedule-table');
        if (scheduleTable && config.schedule && Array.isArray(config.schedule.days)) {
          scheduleTable.innerHTML = '';
          const todayIdx = new Date().getDay();
          config.schedule.days.forEach(d => {
            const tr = document.createElement('tr');
            if (Array.isArray(d.dayIndices) && d.dayIndices.includes(todayIdx)) {
              tr.className = 'today';
            }
            tr.innerHTML = `<td>${d.day}</td><td>${d.hours}</td>`;
            scheduleTable.appendChild(tr);
          });
        }

        // Mapa Google Maps
        const mapIframe = contactSec.querySelector('.map-container iframe');
        if (mapIframe && config.contact.mapsEmbedUrl) {
          mapIframe.src = config.contact.mapsEmbedUrl;
        }
        const mapOverlay = contactSec.querySelector('.map-overlay-link');
        if (mapOverlay && config.contact.mapsUrl) {
          mapOverlay.href = config.contact.mapsUrl;
        }
      }

      // Footer
      const footAddr = document.querySelector('footer .foot-bottom a[href*="maps"]');
      if (footAddr && config.contact.address) {
        footAddr.href = config.contact.mapsUrl || '#';
        footAddr.innerHTML = `<span>${config.contact.address} 📍</span>`;
      }
      const footSmall = document.querySelector('footer .foot-brand small');
      if (footSmall && config.identity?.categoryLabel && config.identity?.city) {
        footSmall.textContent = `${config.identity.categoryLabel} · ${config.identity.city}`;
      }
    }

    // Alternar visibilidad de secciones
    if (config.sections) {
      for (const [secName, isVisible] of Object.entries(config.sections)) {
        const el = document.getElementById(secName === 'catalog' ? 'carta' : secName === 'booking' ? 'reservas' : secName === 'about' ? 'teteria' : secName === 'reviews' ? 'opiniones' : secName);
        if (el) {
          el.style.display = isVisible ? '' : 'none';
        }
      }
    }

    // Actualizar datos de carta en memoria y renderizar
    if (Array.isArray(catalog) && catalog.length > 0 && typeof window.updateCartaData === 'function') {
      window.updateCartaData(catalog);
    }
  }

  // 4. Widget Flotante Selector de Negocios (Desactivado para una experiencia limpia)
  function renderDemoSwitcher() {
    const existing = document.getElementById('template-demo-switcher');
    if (existing) existing.remove();
  }

  // 5. Inicializar carga del negocio activo
  async function init() {
    renderDemoSwitcher();
    const slug = getActiveSlug();

    try {
      const res = await fetch(`/api/business-config?b=${encodeURIComponent(slug)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.config) {
          currentConfig = data.config;
          currentCatalog = data.catalog || [];
          availableBusinesses = data.availableBusinesses || [];

          applyTheme(currentConfig.theme);
          applyContent(currentConfig, currentCatalog);
          renderDemoSwitcher();
          return;
        }
      }
    } catch (err) {
      console.warn('[BusinessEngine] No se pudo conectar al endpoint, usando valores por defecto:', err);
    }
  }

  return {
    init,
    getActiveSlug,
    getConfig: () => currentConfig,
    getCatalog: () => currentCatalog,
    applyTheme,
    applyContent
  };
})();

// Autoejecutar al cargar la página
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.BusinessEngine.init());
} else {
  window.BusinessEngine.init();
}
