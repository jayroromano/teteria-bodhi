/**
 * TETERÍA BODHI · LOGICA DEL PANEL DE ADMINISTRACIÓN
 */

(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const isFileProtocol = window.location.protocol === 'file:';

  let authToken = localStorage.getItem('bodhi_admin_token') || '';
  let knownCodes = new Set();
  let isInitialLoad = true;
  let cachedClosedDates = [];

  let allReservations = [
    {
      id: "res_1730730001",
      code: "BDH-1042",
      name: "Alejandro Morales",
      phone: "+34 612 34 56 78",
      email: "alejandro.morales@example.com",
      date: new Date().toISOString().split('T')[0],
      time: "19:30",
      guests: 2,
      zone: "interior",
      notes: "Mesa tranquila junto a los cojines para probar té pakistaní.",
      status: "confirmed",
      admin_notes: "Asignada mesa 4 rincón marroquí.",
      created_at: new Date().toISOString()
    },
    {
      id: "res_1730730002",
      code: "BDH-1043",
      name: "Lucía Fernández",
      phone: "+34 654 98 76 54",
      email: "lucia.f@example.com",
      date: new Date().toISOString().split('T')[0],
      time: "21:00",
      guests: 6,
      zone: "terraza",
      notes: "Celebración de cumpleaños de una amiga. Queremos cachimba de frutos del bosque.",
      status: "pending",
      admin_notes: "Pendiente de confirmar si prefieren mesa alta o sofás en terraza.",
      created_at: new Date().toISOString()
    },
    {
      id: "res_1730730003",
      code: "BDH-1044",
      name: "Carlos Ruiz Gómez",
      phone: "+34 678 11 22 33",
      email: "carlos.ruiz@example.com",
      date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
      time: "20:00",
      guests: 4,
      zone: "indiferente",
      notes: "Una persona intolerante al gluten para la repostería.",
      status: "confirmed",
      admin_notes: "Avisado al personal de repostería para el baklava sin gluten.",
      created_at: new Date().toISOString()
    },
    {
      id: "res_1730730004",
      code: "BDH-1045",
      name: "Marta Benítez",
      phone: "+34 699 44 55 66",
      email: "marta.b@example.com",
      date: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0],
      time: "22:30",
      guests: 3,
      zone: "interior",
      notes: "Cócteles y cachimba después de cenar.",
      status: "confirmed",
      admin_notes: "",
      created_at: new Date().toISOString()
    },
    {
      id: "res_1730730005",
      code: "BDH-1046",
      name: "Javier Delgado",
      phone: "+34 633 77 88 99",
      email: "javi.delgado@example.com",
      date: new Date().toISOString().split('T')[0],
      time: "18:30",
      guests: 2,
      zone: "interior",
      notes: "Primera visita recomendada por amigos de Jerez.",
      status: "completed",
      admin_notes: "Mesa atendida correctamente.",
      created_at: new Date().toISOString()
    }
  ];

  let currentFilter = {
    dateQuick: 'all',
    status: 'all',
    search: ''
  };

  // ==========================================
  // SONIDO & NOTIFICACIONES DE ESCRITORIO
  // ==========================================
  function playBellSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      // Sonido de campana de recepción 🛎️
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now); // Nota A5
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08); // E6
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 1.2);
    } catch (e) {
      console.warn('Audio no permitido todavía:', e);
    }
  }

  function showBrowserNotification(r) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('🛎️ ¡Nueva Reserva en Tetería Bodhi!', {
          body: `${r.name} · ${r.guests} personas para el ${r.date} a las ${r.time} h`,
          icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="%233D2214"/><path fill="%23FFF" d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></svg>'
        });
      } catch (e) {}
    }
  }

  const notifBtn = $('#enable-notif-btn');
  function updateNotifBtn() {
    if (!notifBtn) return;
    if ('Notification' in window && Notification.permission === 'granted') {
      notifBtn.innerHTML = `
        <span class="btn-icon">🔔</span>
        <span class="btn-label-full">Avisos & Sonido Activos</span>
        <span class="btn-label-mob">Avisos ON</span>
      `;
      notifBtn.style.color = '#2E7D32';
      notifBtn.style.borderColor = '#2E7D32';
    } else {
      notifBtn.innerHTML = `
        <span class="btn-icon">🔕</span>
        <span class="btn-label-full">Activar Avisos Sonoros</span>
        <span class="btn-label-mob">Avisos</span>
      `;
      notifBtn.style.color = '';
      notifBtn.style.borderColor = '';
    }
  }

  if (notifBtn) {
    notifBtn.addEventListener('click', async () => {
      playBellSound();
      if ('Notification' in window) {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          showAdminToast('¡Notificaciones de escritorio y sonido activados!', 'success');
          new Notification('Tetería Bodhi', { body: 'Las notificaciones de reservas están activadas correctamente.' });
        } else {
          showAdminToast('Permiso de notificaciones denegado en el navegador.', 'danger');
        }
      }
      updateNotifBtn();
    });
  }

  updateNotifBtn();

  // ==========================================
  // AUTENTICACIÓN
  // ==========================================
  const loginScreen = $('#login-screen');
  const loginForm = $('#login-form');
  const loginPass = $('#login-password');
  const loginError = $('#login-error');
  const logoutBtn = $('#logout-btn');

  async function checkAuth() {
    if (!authToken) {
      showLogin();
      return;
    }

    if (isFileProtocol) {
      hideLogin();
      updateCloudDbPill(false);
      loadDashboard();
      return;
    }

    try {
      const res = await fetch('/api/admin-login', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        hideLogin();
        updateCloudDbPill(data.isCloudDb);
        loadDashboard();
      } else {
        authToken = '';
        localStorage.removeItem('bodhi_admin_token');
        showLogin();
      }
    } catch (e) {
      showLogin();
      if (loginError) loginError.textContent = 'Error de conexión verificando credenciales.';
    }
  }

  function showLogin() {
    if (loginScreen) loginScreen.style.display = 'flex';
  }

  function hideLogin() {
    if (loginScreen) loginScreen.style.display = 'none';
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      loginError.textContent = '';
      const password = loginPass.value.trim();

      if (isFileProtocol) {
        if (password) {
          authToken = 'bdh_mock_local_dev';
          localStorage.setItem('bodhi_admin_token', authToken);
          hideLogin();
          updateCloudDbPill(false);
          loadDashboard();
        } else {
          loginError.textContent = 'Por favor introduce la contraseña de administrador.';
        }
        return;
      }

      try {
        const res = await fetch('/api/admin-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const data = await res.json();

        if (res.ok && data.success) {
          authToken = data.token;
          localStorage.setItem('bodhi_admin_token', authToken);
          hideLogin();
          updateCloudDbPill(data.isCloudDb);
          loadDashboard();
        } else {
          loginError.textContent = data.error || 'Contraseña incorrecta';
        }
      } catch (err) {
        loginError.textContent = 'Error de conexión con el servidor.';
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('bodhi_admin_token');
      authToken = '';
      showLogin();
    });
  }

  async function checkDbHealth() {
    if (isFileProtocol) {
      updateCloudDbPill(false);
      return;
    }
    try {
      const res = await fetch('/api/reservas?health=true', {
        headers: { 'Authorization': 'Bearer ' + authToken }
      });
      const data = await res.json();

      const pill = $('#db-status-pill');
      const banner = $('#db-alert-banner');
      const bannerTitle = $('#db-alert-title');
      const bannerMsg = $('#db-alert-message');
      const bannerIcon = $('#db-alert-icon');

      if (data.pgConnected && data.tableReady) {
        if (pill) {
          pill.className = 'db-pill cloud';
          pill.innerHTML = `
            <span class="pill-dot">🟢</span>
            <span class="pill-text-full">Supabase Cloud Conectado</span>
            <span class="pill-text-mob">Conectado</span>
          `;
          pill.title = `Conectado a Supabase. ${data.pgDetail?.reservationsCount || 0} reservas en la base de datos.`;
        }
        if (banner) banner.style.display = 'none';
        const setupCard = $('#supabase-setup-card');
        if (setupCard) setupCard.style.display = 'none';
      } else if (data.cloudDbConfigured && !data.tableReady) {
        if (pill) {
          pill.className = 'db-pill';
          pill.style.background = '#FFF3CD';
          pill.style.color = '#856404';
          pill.innerHTML = `
            <span class="pill-dot">🟡</span>
            <span class="pill-text-full">Supabase: Falta crear tabla</span>
            <span class="pill-text-mob">Sin tabla</span>
          `;
          pill.title = 'Proyecto Supabase conectado, pero falta ejecutar el script SQL para crear la tabla.';
        }
        if (banner) {
          banner.style.display = 'flex';
          banner.style.background = '#FFF3CD';
          banner.style.border = '1.5px solid #FFEBAA';
          banner.style.color = '#856404';
          if (bannerIcon) bannerIcon.textContent = '⚡';
          if (bannerTitle) bannerTitle.textContent = 'Tu proyecto Supabase está conectado, pero falta crear la tabla "reservations"';
          if (bannerMsg) {
            bannerMsg.innerHTML = `Para que las reservas se guarden de forma permanente en Supabase, pulsa el botón <strong>"⚙️ Diagnóstico & Configurar"</strong>, copia el código SQL y ejecútalo en Supabase en 1 clic.`;
          }
        }
        const setupCard = $('#supabase-setup-card');
        if (setupCard) setupCard.style.display = 'block';
      } else {
        if (pill) {
          pill.className = 'db-pill';
          pill.innerHTML = `
            <span class="pill-dot">🔴</span>
            <span class="pill-text-full">BD No Conectada</span>
            <span class="pill-text-mob">Offline</span>
          `;
          pill.title = data.pgDetail?.error || data.lastDbError || 'Base de datos no disponible';
        }
        if (banner) {
          banner.style.display = 'flex';
          banner.style.background = '#FFF3CD';
          banner.style.border = '1.5px solid #FFEBAA';
          banner.style.color = '#856404';
          if (bannerIcon) bannerIcon.textContent = '⚠️';
          if (bannerTitle) bannerTitle.textContent = 'Atención: La Base de Datos PostgreSQL no está conectada';
          const errMsg = data.pgDetail?.error || data.lastDbError || 'No se detectó la variable DATABASE_URL en Vercel';
          if (bannerMsg) {
            bannerMsg.innerHTML = `Las reservas hechas por clientes <strong>no se guardarán de forma permanente</strong> hasta conectar la base de datos.<br><span style="font-family:monospace; font-size:0.82rem; background:rgba(0,0,0,0.06); padding:2px 6px; border-radius:4px; display:inline-block; margin-top:4px;">Motivo: ${errMsg}</span>`;
          }
        }
      }

      // Actualizar consola de diagnóstico de la pestaña BD
      const dbDiagStatus = $('#db-diag-status');
      const dbDiagVar = $('#db-diag-var');
      const dbDiagError = $('#db-diag-error');
      const dbDiagRows = $('#db-diag-rows');
      if (dbDiagStatus) {
        dbDiagStatus.innerHTML = (data.pgConnected && data.tableReady)
          ? '<span style="color:#2E7D32; font-weight:700;">🟢 Conectado con éxito a Supabase Cloud</span>'
          : (data.cloudDbConfigured && !data.tableReady)
            ? '<span style="color:#E65100; font-weight:700;">🟡 Supabase Conectado (Falta crear tabla)</span>'
            : '<span style="color:#C62828; font-weight:700;">🔴 Desconectado o con error de credenciales</span>';
      }
      if (dbDiagVar) {
        dbDiagVar.textContent = 'SUPABASE_URL (Configurado en el servidor)';
      }
      if (dbDiagError) {
        dbDiagError.textContent = (data.pgConnected && data.tableReady)
          ? 'Conexión verificada sin errores. Las tablas están sincronizadas y listas.'
          : (data.cloudDbConfigured && !data.tableReady)
            ? 'La API de Supabase respondió correctamente, pero falta crear la tabla public.reservations. Ejecuta el script SQL en Supabase.'
            : (data.pgDetail?.error || data.lastDbError || 'Error de conexión.');
      }
      if (dbDiagRows) {
        dbDiagRows.textContent = (data.pgConnected && data.tableReady)
          ? `${data.pgDetail?.reservationsCount || 0} reservas guardadas en la nube`
          : '0 (usando memoria temporal hasta crear la tabla)';
      }
    } catch (e) {
      console.warn('Error verificando salud de la DB:', e);
    }
  }

  function updateCloudDbPill(isCloud) {
    const pill = $('#db-status-pill');
    if (!pill) return;
    if (isCloud) {
      pill.className = 'db-pill cloud';
      pill.innerHTML = `
        <span class="pill-dot">🟢</span>
        <span class="pill-text-full">PostgreSQL Cloud</span>
        <span class="pill-text-mob">Cloud</span>
      `;
      pill.title = 'Base de datos conectada en la nube (Neon / Supabase / Vercel Postgres)';
    } else {
      pill.className = 'db-pill';
      pill.innerHTML = `
        <span class="pill-dot">🟡</span>
        <span class="pill-text-full">Modo Local / Respaldo</span>
        <span class="pill-text-mob">Local</span>
      `;
      pill.title = 'Persistencia en memoria / archivo local. Conecta DATABASE_URL para producción permanente.';
    }
  }

  // ==========================================
  // CARGA DE RESERVAS Y KPIs
  // ==========================================
  async function loadDashboard(isBackgroundSync = false) {
    if (!isBackgroundSync) {
      checkDbHealth();
    }
    if (isFileProtocol) {
      renderTable();
      updateKpis({
        total: allReservations.length,
        todayCount: allReservations.filter(r => r.date === new Date().toISOString().split('T')[0]).length,
        todayGuests: allReservations.filter(r => r.date === new Date().toISOString().split('T')[0]).reduce((a, b) => a + (Number(b.guests) || 0), 0),
        pending: allReservations.filter(r => r.status === 'pending').length
      });
      return;
    }

    try {
      const res = await fetch('/api/reservas', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });

      if (res.status === 401) {
        showLogin();
        return;
      }

      const data = await res.json();
      if (res.ok && data.success) {
        const freshList = data.reservations || [];

        // Detectar si han entrado reservas nuevas desde la última consulta
        if (!isInitialLoad) {
          const incoming = freshList.filter(r => !knownCodes.has(r.code));
          if (incoming.length > 0) {
            playBellSound();
            incoming.forEach(r => {
              showBrowserNotification(r);
              showAdminToast(`🛎️ ¡Nueva reserva! ${r.name} (${r.guests} pers. - ${r.time}h)`, 'success');
            });
          }
        }

        freshList.forEach(r => knownCodes.add(r.code));
        isInitialLoad = false;

        allReservations = freshList;
        updateKpis(data.stats);
        renderTable();
      }
    } catch (e) {
      if (!isBackgroundSync) {
        console.error('Error cargando reservas:', e);
        showAdminToast('Error sincronizando reservas.', 'danger');
      }
    }
  }

  function updateKpis(stats) {
    if (!stats) return;
    $('#kpi-total').textContent = stats.total || 0;
    $('#kpi-today').textContent = stats.todayCount || 0;
    $('#kpi-guests-today').textContent = stats.todayGuests || 0;
    $('#kpi-pending').textContent = stats.pending || 0;
  }

  // Sondeo automático cada 18 segundos para detectar reservas nuevas sin recargar la página
  setInterval(() => {
    if (authToken) {
      loadDashboard(true);
    }
  }, 18000);

  // ==========================================
  // FILTRADO Y RENDERIZADO DE TABLA
  // ==========================================
  function getFilteredReservations() {
    const today = new Date().toISOString().split('T')[0];
    const tomDate = new Date();
    tomDate.setDate(tomDate.getDate() + 1);
    const tomorrow = tomDate.toISOString().split('T')[0];

    return allReservations.filter(r => {
      if (currentFilter.dateQuick === 'today' && r.date !== today) return false;
      if (currentFilter.dateQuick === 'tomorrow' && r.date !== tomorrow) return false;

      if (currentFilter.status !== 'all' && r.status !== currentFilter.status) return false;

      if (currentFilter.search) {
        const q = currentFilter.search.toLowerCase();
        const matchName = (r.name || '').toLowerCase().includes(q);
        const matchPhone = (r.phone || '').includes(q);
        const matchCode = (r.code || '').toLowerCase().includes(q);
        if (!matchName && !matchPhone && !matchCode) return false;
      }

      return true;
    });
  }

  function renderTable() {
    const tbody = $('#reservas-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const list = getFilteredReservations();
    $('#showing-count').textContent = `Mostrando ${list.length} de ${allReservations.length} reservas`;

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 40px; color: var(--mut);">
            No se han encontrado reservas con los filtros seleccionados.
          </td>
        </tr>
      `;
      return;
    }

    list.forEach(r => {
      const tr = document.createElement('tr');
      const waMsg = encodeURIComponent(
        `¡Hola ${r.name}! Te confirmamos tu mesa en Tetería Bodhi para el ${formatDate(r.date)} a las ${r.time} h (${r.guests} personas). Código: ${r.code}. ¡Te esperamos!`
      );
      const cleanPhone = (r.phone || '').replace(/[^0-9]/g, '');
      const waUrl = `https://wa.me/${cleanPhone.startsWith('34') ? cleanPhone : '34' + cleanPhone}?text=${waMsg}`;

      tr.innerHTML = `
        <td>
          <span class="code-badge">${escapeHtml(r.code)}</span>
          <div style="font-size: 0.75rem; color: var(--mut); margin-top: 4px;">
            ${formatTimeAgo(r.created_at)}
          </div>
        </td>
        <td>
          <strong>${formatDate(r.date)}</strong>
          <div style="color: var(--tost); font-weight: 700; font-size: 0.95rem;">${escapeHtml(r.time)} h</div>
        </td>
        <td>
          <div style="font-weight: 700;">${escapeHtml(r.name)}</div>
          <a href="tel:${escapeHtml(r.phone)}" style="font-size: 0.85rem; color: var(--tost); text-decoration: none; font-weight: 600;">
            📞 ${escapeHtml(r.phone)}
          </a>
        </td>
        <td>
          <strong>${r.guests} pers.</strong>
          <div style="font-size: 0.82rem; color: var(--mut);">${translateZone(r.zone)}</div>
        </td>
        <td style="max-width: 220px;">
          <div style="font-size: 0.86rem; color: var(--ink);">${escapeHtml(r.notes || '—')}</div>
          ${r.admin_notes ? `<div style="font-size: 0.78rem; color: var(--tost); margin-top: 4px; font-style: italic;">Nota: ${escapeHtml(r.admin_notes)}</div>` : ''}
        </td>
        <td>
          <span class="status-badge ${r.status}">
            ${translateStatus(r.status)}
          </span>
        </td>
        <td>
          <div class="action-btns">
            ${r.status !== 'confirmed' ? `
              <button class="action-btn confirm" title="Confirmar reserva" onclick="window.adminApp.updateStatus('${r.id}', 'confirmed')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
            ` : ''}
            <a href="${waUrl}" target="_blank" rel="noopener" class="action-btn wa" title="Enviar WhatsApp al cliente">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.711 2.598 2.664-.699c.971.53 1.77.781 2.795.782 3.182 0 5.768-2.587 5.769-5.766.001-3.182-2.585-5.768-5.769-5.768zm0-2.172c4.378 0 7.938 3.56 7.939 7.939 0 4.379-3.561 7.939-7.939 7.939-1.398 0-2.456-.372-3.56-1l-5.471 1.434 1.46-5.334c-.71-1.19-1.09-2.072-1.09-3.039 0-4.379 3.56-7.939 7.939-7.939z"/></svg>
            </a>
            <button class="action-btn" title="Editar notas internas" onclick="window.adminApp.openNotesModal('${r.id}', '${escapeAttr(r.admin_notes || '')}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            ${r.status !== 'cancelled' ? `
              <button class="action-btn cancel" title="Cancelar reserva" onclick="window.adminApp.updateStatus('${r.id}', 'cancelled')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            ` : ''}
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ==========================================
  // ACCIONES SOBRE RESERVAS
  // ==========================================
  window.adminApp = {
    async updateStatus(id, newStatus) {
      if (isFileProtocol) {
        const item = allReservations.find(r => r.id === id);
        if (item) item.status = newStatus;
        showAdminToast(`Reserva actualizada a "${translateStatus(newStatus)}"`, 'success');
        loadDashboard();
        return;
      }

      try {
        const res = await fetch('/api/reservas', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ id, status: newStatus })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          showAdminToast(`Reserva actualizada a "${translateStatus(newStatus)}"`, 'success');
          loadDashboard();
        } else {
          showAdminToast(data.error || 'No se pudo actualizar.', 'danger');
        }
      } catch (e) {
        showAdminToast('Error de conexión.', 'danger');
      }
    },

    openNotesModal(id, currentNotes) {
      $('#modal-res-id').value = id;
      $('#modal-res-notes').value = currentNotes || '';
      $('#notes-modal').classList.add('active');
    },

    async toggleMenuAvailable(id, currentAvailable) {
      if (isFileProtocol) {
        showAdminToast('Disponibilidad actualizada (modo local).', 'success');
        return;
      }
      try {
        const res = await fetch('/api/carta', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ id, available: !currentAvailable })
        });
        if (res.ok) {
          showAdminToast('Disponibilidad actualizada en la carta.', 'success');
          loadCartaManager();
        }
      } catch (e) {
        showAdminToast('Error actualizando carta.', 'danger');
      }
    },

    async deleteMenuItem(id, name) {
      if (!confirm(`¿Seguro que deseas eliminar "${name}" de la carta?`)) return;
      if (isFileProtocol) {
        showAdminToast('Producto eliminado (modo local).', 'success');
        return;
      }
      try {
        const res = await fetch(`/api/carta?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        });
        const data = await res.json();
        if (res.ok && data.success) {
          showAdminToast(`✓ "${name}" eliminado de la carta.`, 'success');
          loadCartaManager();
        } else {
          showAdminToast(data.error || 'No se pudo eliminar el producto.', 'danger');
        }
      } catch (e) {
        showAdminToast('Error al conectar con el servidor.', 'danger');
      }
    },

    async deleteClosedDate(date) {
      if (!confirm(`¿Quitar el cierre del ${formatDate(date)}?`)) return;
      try {
        const res = await fetch(`/api/closed-dates?date=${encodeURIComponent(date)}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo quitar el cierre.');
        showAdminToast('Día cerrado eliminado.', 'success');
        await loadClosedDates();
      } catch (error) {
        showAdminToast(error.message || 'Error eliminando el día cerrado.', 'danger');
      }
    }
  };

  const notesForm = $('#notes-form');
  if (notesForm) {
    notesForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = $('#modal-res-id').value;
      const admin_notes = $('#modal-res-notes').value.trim();

      if (isFileProtocol) {
        const item = allReservations.find(r => r.id === id);
        if (item) item.admin_notes = admin_notes;
        $('#notes-modal').classList.remove('active');
        showAdminToast('Nota guardada.', 'success');
        loadDashboard();
        return;
      }

      try {
        const res = await fetch('/api/reservas', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ id, admin_notes })
        });
        if (res.ok) {
          $('#notes-modal').classList.remove('active');
          showAdminToast('Nota guardada.', 'success');
          loadDashboard();
        }
      } catch (e) {
        showAdminToast('Error guardando nota.', 'danger');
      }
    });
  }

  // ==========================================
  // EVENTOS DE FILTROS
  // ==========================================
  $$('.filter-pill[data-date]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.filter-pill[data-date]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter.dateQuick = btn.getAttribute('data-date');
      renderTable();
    });
  });

  const statusSelect = $('#filter-status');
  if (statusSelect) {
    statusSelect.addEventListener('change', (e) => {
      currentFilter.status = e.target.value;
      renderTable();
    });
  }

  const searchInput = $('#admin-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentFilter.search = e.target.value;
      renderTable();
    });
  }

  const refreshBtn = $('#refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadDashboard();
      showAdminToast('Datos sincronizados.', 'success');
    });
  }

  const exportBtn = $('#export-csv-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const list = getFilteredReservations();
      if (list.length === 0) {
        showAdminToast('No hay reservas para exportar.', 'danger');
        return;
      }

      let csv = 'Codigo,Fecha,Hora,Cliente,Telefono,Email,Personas,Zona,Estado,Notas,Notas_Admin\n';
      list.forEach(r => {
        csv += `"${r.code}","${r.date}","${r.time}","${r.name}","${r.phone}","${r.email || ''}","${r.guests}","${r.zone}","${r.status}","${(r.notes || '').replace(/"/g, '""')}","${(r.admin_notes || '').replace(/"/g, '""')}"\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reservas-bodhi-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showAdminToast('Archivo CSV descargado.', 'success');
    });
  }

  const printBtn = $('#print-btn');
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      window.print();
    });
  }

  // ==========================================
  // CREACIÓN MANUAL DE RESERVA
  // ==========================================
  const newResBtn = $('#new-res-btn');
  const newResModal = $('#new-res-modal');
  const newResForm = $('#new-res-form');

  if (newResBtn && newResModal) {
    newResBtn.addEventListener('click', () => {
      newResForm.reset();
      const today = new Date().toISOString().split('T')[0];
      $('#m-d').value = today;
      $('#m-h').value = '20:30';
      newResModal.classList.add('active');
    });
  }

  if (newResForm) {
    newResForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        name: $('#m-n').value.trim(),
        phone: $('#m-t').value.trim(),
        date: $('#m-d').value,
        time: $('#m-h').value,
        guests: Number($('#m-p').value),
        zone: $('#m-z').value,
        notes: $('#m-o').value.trim(),
        status: 'confirmed'
      };

      if (isFileProtocol) {
        const newCode = `BDH-${Math.floor(1000 + Math.random() * 9000)}`;
        allReservations.unshift({ id: `res_${Date.now()}`, code: newCode, ...payload, created_at: new Date().toISOString() });
        newResModal.classList.remove('active');
        showAdminToast(`Reserva ${newCode} creada con éxito.`, 'success');
        loadDashboard();
        return;
      }

      try {
        const res = await fetch('/api/reservas', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok && data.success) {
          newResModal.classList.remove('active');
          showAdminToast(`Reserva ${data.reservation.code} creada con éxito.`, 'success');
          loadDashboard();
        } else {
          showAdminToast(data.error || 'No se pudo crear.', 'danger');
        }
      } catch (err) {
        showAdminToast('Error creando reserva.', 'danger');
      }
    });
  }

  // ==========================================
  // GESTIÓN DE CARTA & PRODUCTOS
  // ==========================================
  let cachedCartaItems = [];
  let currentCartaFilter = 'all';

  async function loadCartaManager() {
    const box = $('#carta-manager-tbody');
    const countInfo = $('#carta-count-info');
    if (!box) return;

    try {
      const res = await fetch('/api/carta');
      const data = await res.json();
      if (!res.ok || !data.items) return;

      cachedCartaItems = data.items;
      renderCartaTable();
    } catch (e) {
      console.warn('Error cargando gestión de carta:', e);
      if (countInfo) countInfo.textContent = 'Error cargando carta';
    }
  }

  async function loadClosedDates() {
    const list = $('#closed-dates-list');
    if (!list) return;
    list.textContent = 'Cargando días cerrados…';
    try {
      const res = await fetch('/api/closed-dates', { headers: { 'Authorization': `Bearer ${authToken}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudieron cargar los días cerrados.');
      cachedClosedDates = Array.isArray(data.closedDates) ? data.closedDates : [];
      const setupNotice = $('#closed-dates-setup-notice');
      if (setupNotice) setupNotice.hidden = !data.setupRequired;
      renderClosedDates();
    } catch (error) {
      list.textContent = error.message || 'Error cargando días cerrados.';
    }
  }

  function renderClosedDates() {
    const list = $('#closed-dates-list');
    if (!list) return;
    if (!cachedClosedDates.length) {
      list.textContent = 'No hay días cerrados próximos.';
      return;
    }
    list.innerHTML = cachedClosedDates.map(item => `
      <article class="closed-date-row">
        <div><strong>${escapeHtml(formatDate(item.date))}</strong><span>${escapeHtml(item.reason)}</span></div>
        <button type="button" class="btn-secondary" onclick="window.adminApp.deleteClosedDate('${escapeAttr(item.date)}')">Quitar</button>
      </article>
    `).join('');
  }

  const closedDateForm = $('#closed-date-form');
  if (closedDateForm) {
    const dateField = $('#closed-date-input');
    if (dateField) dateField.min = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
    closedDateForm.addEventListener('submit', async event => {
      event.preventDefault();
      const date = dateField?.value || '';
      const reason = $('#closed-date-reason')?.value.trim() || '';
      const submit = closedDateForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        const res = await fetch('/api/closed-dates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
          body: JSON.stringify({ date, reason })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo añadir el día cerrado.');
        closedDateForm.reset();
        if (dateField) dateField.min = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
        showAdminToast('Día cerrado añadido.', 'success');
        await loadClosedDates();
      } catch (error) {
        showAdminToast(error.message || 'Error guardando el día cerrado.', 'danger');
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  function renderCartaTable() {
    const box = $('#carta-manager-tbody');
    const countInfo = $('#carta-count-info');
    if (!box) return;

    let items = cachedCartaItems;
    if (currentCartaFilter !== 'all') {
      items = items.filter(i => (i.category || '').toLowerCase() === currentCartaFilter.toLowerCase());
    }

    if (countInfo) {
      countInfo.textContent = `${items.length} producto${items.length === 1 ? '' : 's'} ${currentCartaFilter !== 'all' ? `en "${currentCartaFilter}"` : 'en total'}`;
    }

    box.innerHTML = '';
    if (items.length === 0) {
      box.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 32px 16px; color: var(--mut);">
            No hay productos registrados en esta categoría. Pulsa en <strong>"➕ Añadir Nuevo Producto"</strong> para agregar el primero.
          </td>
        </tr>
      `;
      return;
    }

    items.forEach(item => {
      const tr = document.createElement('tr');
      const safeName = escapeHtml(item.name || 'Sin nombre');
      const jsSafeName = safeName.replace(/'/g, "\\'");
      const cat = escapeHtml(item.category || 'Otro');
      const badgeHtml = item.badge ? `<span style="font-size:0.7rem;padding:2px 6px;border-radius:4px;background:var(--sand);color:var(--tost);font-weight:700;margin-left:5px;">${escapeHtml(item.badge)}</span>` : '';
      const descHtml = item.description ? `<div style="font-size:0.78rem;color:var(--mut);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;">${escapeHtml(item.description)}</div>` : '';

      const imgUrl = item.image || (cat === 'Cócteles' ? 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=400&q=80' : cat === 'Tés' ? 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=400&q=80' : 'https://images.unsplash.com/photo-1519869325930-281384150729?auto=format&fit=crop&w=400&q=80');

      let catBg = '#FFF3E0';
      let catColor = '#E65100';
      if (cat === 'Cócteles') {
        catBg = '#E1F5FE';
        catColor = '#0277BD';
      } else if (cat.includes('Cachimba')) {
        catBg = '#F3E5F5';
        catColor = '#7B1FA2';
      } else if (cat.includes('Té') || cat.includes('Café')) {
        catBg = '#E8F5E9';
        catColor = '#2E7D32';
      } else if (cat.includes('Merienda') || cat.includes('Dulce')) {
        catBg = '#FFF8E1';
        catColor = '#F57F17';
      } else if (cat.includes('Cerveza')) {
        catBg = '#FFF3E0';
        catColor = '#E65100';
      } else if (cat.includes('Copa')) {
        catBg = '#EFEBE9';
        catColor = '#4E342E';
      } else if (cat.includes('Vino') || cat.includes('Refresco')) {
        catBg = '#FCE4EC';
        catColor = '#C2185B';
      }

      tr.innerHTML = `
        <td>
          <img src="${imgUrl}" alt="${safeName}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;border:1px solid var(--line);background:var(--sand);display:block;" onerror="this.src='https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=400&q=80'">
        </td>
        <td>
          <div style="font-weight:700;display:flex;align-items:center;flex-wrap:wrap;">${safeName} ${badgeHtml}</div>
          ${descHtml}
        </td>
        <td>
          <span class="status-badge" style="background:${catBg};color:${catColor};font-size:0.75rem;padding:3px 9px;">${cat}</span>
        </td>
        <td><strong>${Number(item.price || 0).toFixed(2)} €</strong></td>
        <td>
          <button type="button" class="filter-pill ${item.available ? 'active' : ''}" 
                  style="font-size: 0.8rem; padding: 4px 10px; cursor: pointer;"
                  onclick="window.adminApp.toggleMenuAvailable('${item.id}', ${item.available})">
            ${item.available ? '✓ Disponible' : '✗ Agotado'}
          </button>
        </td>
        <td>
          <button type="button" class="btn-icon" title="Eliminar producto de la carta" 
                  style="color: var(--danger); border: 1px solid var(--line); padding: 6px; border-radius: 6px; cursor: pointer; background: var(--bg);"
                  onclick="window.adminApp.deleteMenuItem('${item.id}', '${jsSafeName}')">
            🗑️
          </button>
        </td>
      `;
      box.appendChild(tr);
    });
  }

  // Filtrar pills de carta
  $$('.carta-filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      $$('.carta-filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentCartaFilter = pill.getAttribute('data-carta-cat') || 'all';
      renderCartaTable();
    });
  });

  // Modal Añadir Producto
  const btnOpenAddProduct = $('#btn-open-add-product');
  if (btnOpenAddProduct) {
    btnOpenAddProduct.addEventListener('click', () => {
      const form = $('#new-product-form');
      if (form) form.reset();
      $('#product-modal').classList.add('active');
      const nameInput = $('#prod-name');
      if (nameInput) nameInput.focus();
    });
  }

  const newProductForm = $('#new-product-form');
  if (newProductForm) {
    newProductForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = $('#btn-save-product');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Guardando...';
      }

      const name = ($('#prod-name')?.value || '').trim();
      const category = $('#prod-category')?.value || 'Otro';
      const price = parseFloat($('#prod-price')?.value || '0');
      const image = ($('#prod-image')?.value || '').trim();
      const description = ($('#prod-desc')?.value || '').trim();
      const badge = ($('#prod-badge')?.value || '').trim();

      if (!name) {
        showAdminToast('El nombre del producto es obligatorio.', 'warning');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '💾 Guardar Producto'; }
        return;
      }

      if (isNaN(price) || price < 0) {
        showAdminToast('Por favor introduce un precio válido.', 'warning');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '💾 Guardar Producto'; }
        return;
      }

      try {
        const res = await fetch('/api/carta', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ name, category, price, image, description, badge })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          $('#product-modal').classList.remove('active');
          newProductForm.reset();
          showAdminToast(`✓ "${name}" añadido a la carta con éxito (${category})`, 'success');
          loadCartaManager();
        } else {
          showAdminToast(data.error || 'Error al guardar el producto.', 'danger');
        }
      } catch (err) {
        showAdminToast('Error de conexión al guardar el producto.', 'danger');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '💾 Guardar Producto';
        }
      }
    });
  }

  // Control del menú lateral en móviles
  const burgerBtn = $('#admin-burger');
  const sidebar = $('aside.admin-sidebar');
  const sidebarBackdrop = $('#sidebar-backdrop');
  const sidebarCloseBtn = $('#sidebar-close-btn');

  function openSidebar() {
    if (sidebar) sidebar.classList.add('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.add('active');
  }

  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.remove('active');
  }

  if (burgerBtn) burgerBtn.addEventListener('click', openSidebar);
  if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebar);
  if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);

  function switchAdminTab(target) {
    $$('.nav-item').forEach(li => li.classList.remove('active'));
    const matchingNavBtn = $(`aside.admin-sidebar button[data-tab="${target}"]`);
    if (matchingNavBtn && matchingNavBtn.parentElement) {
      matchingNavBtn.parentElement.classList.add('active');
    }

    $$('.mob-nav-btn[data-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === target);
    });

    $$('.tab-section').forEach(sec => sec.style.display = 'none');
    const targetSec = $(`#tab-${target}`);
    if (targetSec) targetSec.style.display = 'block';

    const titleMap = {
      'reservas': 'Reservas',
      'carta': 'Gestión de Carta',
      'closed-dates': 'Días cerrados',
      'db': 'Base de Datos & Vercel'
    };
    const titleEl = $('#page-title');
    if (titleEl && titleMap[target]) {
      titleEl.textContent = titleMap[target];
    }

    if (target === 'carta') loadCartaManager();
    if (target === 'closed-dates') loadClosedDates();
    if (target === 'db') checkDbHealth();

    closeSidebar();
  }

  $$('.nav-item button[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchAdminTab(btn.getAttribute('data-tab'));
    });
  });

  $$('.mob-nav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchAdminTab(btn.getAttribute('data-tab'));
    });
  });

  const mobLogoutBtn = $('#mob-logout-btn');
  if (mobLogoutBtn) {
    mobLogoutBtn.addEventListener('click', () => {
      const logoutBtn = $('#logout-btn');
      if (logoutBtn) logoutBtn.click();
    });
  }

  // Botones de diagnóstico de base de datos
  const btnRecheck = $('#btn-recheck-db');
  if (btnRecheck) {
    btnRecheck.addEventListener('click', () => {
      showAdminToast('Comprobando conexión con PostgreSQL...', 'info');
      checkDbHealth();
      loadDashboard();
    });
  }

  const btnOpenDbTab = $('#btn-open-db-tab');
  if (btnOpenDbTab) {
    btnOpenDbTab.addEventListener('click', () => {
      const dbNavBtn = $('button[data-tab="db"]');
      if (dbNavBtn) dbNavBtn.click();
    });
  }

  const btnDiagTestDb = $('#btn-diag-test-db');
  if (btnDiagTestDb) {
    btnDiagTestDb.addEventListener('click', async () => {
      btnDiagTestDb.disabled = true;
      btnDiagTestDb.textContent = 'Comprobando...';
      await checkDbHealth();
      showAdminToast('Diagnóstico de base de datos actualizado.', 'info');
      btnDiagTestDb.disabled = false;
      btnDiagTestDb.textContent = '🔄 Probar Conexión Ahora';
    });
  }

  const btnDiagTestRes = $('#btn-diag-test-reservation');
  if (btnDiagTestRes) {
    btnDiagTestRes.addEventListener('click', async () => {
      btnDiagTestRes.disabled = true;
      btnDiagTestRes.textContent = 'Insertando...';
      try {
        const dummyDate = new Date();
        dummyDate.setDate(dummyDate.getDate() + 1);
        const dateStr = dummyDate.toISOString().split('T')[0];

        const payload = {
          name: 'Prueba Verificación Admin',
          phone: '+34 600 12 34 56',
          email: 'admin-test@teteriabodhi.es',
          date: dateStr,
          time: '21:00',
          guests: 2,
          zone: 'interior',
          notes: 'Reserva automática de verificación generada desde el panel admin.'
        };

        const res = await fetch('/api/reservas', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (res.ok && data.success) {
          const storage = data.storage || (data.reservation?.isCloudDb ? 'PostgreSQL Cloud' : 'Local Fallback');
          alert(`✅ ¡Reserva de prueba creada con éxito!\n\nCódigo: ${data.reservation.code}\nAlmacenamiento: ${storage}\n${data.dbError ? 'Aviso DB: ' + data.dbError : 'Estado DB: Conectada a la nube'}`);
          await checkDbHealth();
          await loadDashboard();
        } else {
          alert(`❌ Error al crear reserva de prueba:\n${data.error || 'Fallo desconocido'}`);
        }
      } catch (err) {
        alert(`❌ Error de conexión: ${err.message}`);
      } finally {
        btnDiagTestRes.disabled = false;
        btnDiagTestRes.textContent = '🧪 Insertar Reserva de Prueba';
      }
    });
  }

  // ==========================================
  // TOAST NOTIFICATIONS ADMIN
  // ==========================================
  function showAdminToast(msg, type = 'info') {
    let t = $('#admin-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'admin-toast';
      t.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:10px;color:#fff;font-weight:600;font-size:0.9rem;z-index:9999;transition:all 0.3s;opacity:0;transform:translateY(30px);';
      document.body.appendChild(t);
    }
    t.style.background = type === 'success' ? '#2E7D32' : type === 'danger' ? '#C62828' : '#3D2214';
    t.textContent = msg;
    t.style.opacity = '1';
    t.style.transform = 'translateY(0)';
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateY(30px)';
    }, 3800);
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] || c));
  }

  function escapeAttr(s) {
    if (!s) return '';
    return String(s).replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  function translateZone(z) {
    if (z === 'int' || z === 'interior') return '🛋️ Interior';
    if (z === 'ter' || z === 'terraza') return '🌿 Terraza';
    return '✨ Indiferente';
  }

  function translateStatus(s) {
    if (s === 'confirmed') return 'Confirmada';
    if (s === 'pending') return 'Pendiente';
    if (s === 'cancelled') return 'Cancelada';
    if (s === 'completed') return 'Completada';
    return s || 'Pendiente';
  }

  function formatTimeAgo(iso) {
    if (!iso) return '';
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (diff < 1) return 'Ahora mismo';
    if (diff < 60) return `Hace ${diff} min`;
    const h = Math.floor(diff / 60);
    if (h < 24) return `Hace ${h} h`;
    return `Hace ${Math.floor(h / 24)} d`;
  }

  checkAuth();

})();
