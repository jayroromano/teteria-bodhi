/**
 * TETERÍA BODHI · LOGICA DEL PANEL DE ADMINISTRACIÓN
 */

(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  let authToken = localStorage.getItem('bodhi_admin_token') || '';
  let allReservations = [];
  let currentFilter = {
    dateQuick: 'all', // 'today', 'tomorrow', 'all'
    status: 'all',
    search: ''
  };

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
        showLogin();
      }
    } catch (e) {
      console.warn('Error verificando sesión admin:', e);
      // Permitir continuar si no hay conexión temporal pero hay token
      hideLogin();
      loadDashboard();
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

  function updateCloudDbPill(isCloud) {
    const pill = $('#db-status-pill');
    if (!pill) return;
    if (isCloud) {
      pill.className = 'db-pill cloud';
      pill.innerHTML = `🟢 PostgreSQL Cloud`;
      pill.title = 'Base de datos conectada en la nube (Neon / Supabase / Vercel Postgres)';
    } else {
      pill.className = 'db-pill';
      pill.innerHTML = `🟡 Modo Local / JSON`;
      pill.title = 'Persistencia en archivo JSON local / memoria. Conecta DATABASE_URL para producción permanente.';
    }
  }

  // ==========================================
  // CARGA DE RESERVAS Y KPIs
  // ==========================================
  async function loadDashboard() {
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
        allReservations = data.reservations || [];
        updateKpis(data.stats);
        renderTable();
      }
    } catch (e) {
      console.error('Error cargando reservas:', e);
      showAdminToast('Error cargando los datos del servidor.', 'danger');
    }
  }

  function updateKpis(stats) {
    if (!stats) return;
    $('#kpi-total').textContent = stats.total || 0;
    $('#kpi-today').textContent = stats.todayCount || 0;
    $('#kpi-guests-today').textContent = stats.todayGuests || 0;
    $('#kpi-pending').textContent = stats.pending || 0;
  }

  // ==========================================
  // FILTRADO Y RENDERIZADO DE TABLA
  // ==========================================
  function getFilteredReservations() {
    const today = new Date().toISOString().split('T')[0];
    const tomDate = new Date();
    tomDate.setDate(tomDate.getDate() + 1);
    const tomorrow = tomDate.toISOString().split('T')[0];

    return allReservations.filter(r => {
      // Filtro de fecha rápida
      if (currentFilter.dateQuick === 'today' && r.date !== today) return false;
      if (currentFilter.dateQuick === 'tomorrow' && r.date !== tomorrow) return false;

      // Filtro de estado
      if (currentFilter.status !== 'all' && r.status !== currentFilter.status) return false;

      // Filtro de búsqueda
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
          <a href="tel:${escapeHtml(r.phone)}" style="font-size: 0.85rem; color: var(--mut); text-decoration: underline;">
            ${escapeHtml(r.phone)}
          </a>
          ${r.email ? `<div style="font-size: 0.78rem; color: var(--mut);">${escapeHtml(r.email)}</div>` : ''}
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
    }
  };

  // Guardar notas internas
  const notesForm = $('#notes-form');
  if (notesForm) {
    notesForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = $('#modal-res-id').value;
      const admin_notes = $('#modal-res-notes').value.trim();

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

  // Exportar a CSV
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

  // Imprimir lista de servicio
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
        email: $('#m-e').value.trim(),
        date: $('#m-d').value,
        time: $('#m-h').value,
        guests: Number($('#m-p').value),
        zone: $('#m-z').value,
        notes: $('#m-o').value.trim(),
        status: 'confirmed'
      };

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
  // GESTIÓN DE CARTA
  // ==========================================
  async function loadCartaManager() {
    const box = $('#carta-manager-tbody');
    if (!box) return;

    try {
      const res = await fetch('/api/carta');
      const data = await res.json();
      if (!res.ok || !data.items) return;

      box.innerHTML = '';
      data.items.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <div style="font-weight: 700;">${escapeHtml(item.name)}</div>
            <div style="font-size: 0.78rem; color: var(--mut);">${escapeHtml(item.category)}</div>
          </td>
          <td><strong>${Number(item.price).toFixed(2)} €</strong></td>
          <td>
            <button class="filter-pill ${item.available ? 'active' : ''}" 
                    style="font-size: 0.8rem; padding: 4px 10px;"
                    onclick="window.adminApp.toggleMenuAvailable('${item.id}', ${item.available})">
              ${item.available ? '✓ Disponible' : '✗ Agotado'}
            </button>
          </td>
        `;
        box.appendChild(tr);
      });
    } catch (e) {
      console.warn('Error cargando gestión de carta:', e);
    }
  }

  // Pestañas del sidebar
  $$('.nav-item button').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');
      $$('.nav-item').forEach(li => li.classList.remove('active'));
      btn.parentElement.classList.add('active');

      $$('.tab-section').forEach(sec => sec.style.display = 'none');
      const targetSec = $(`#tab-${target}`);
      if (targetSec) targetSec.style.display = 'block';

      if (target === 'carta') loadCartaManager();
    });
  });

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

  // Helpers
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
    if (z === 'int') return '🛋️ Interior';
    if (z === 'ter') return '🌿 Terraza';
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

  // Inicializar
  checkAuth();

})();
