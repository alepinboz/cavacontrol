/**
 * CavaControl - App Logic & Business Engine
 * Version 4.4 - Membresías con Precio Fijo, Desplegables de Vinos Ordenados por Bodega y Etiqueta
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'cavacontrol_db_v1';
  const SESSION_USER_KEY = 'cavacontrol_current_user';
  const API_URL = 'http://localhost:3001/api';

  let state = {
    usuarios: [],
    proveedores: [],
    articulos: [],
    membresias: [],
    clientes: [],
    entradas: [],
    salidas: [],
    auditoriaLogs: []
  };

  let currentUser = null;
  let isSqlServerConnected = false;
  let activeTabId = 'dashboard';
  let idCounter = 0;
  let syncTimeout = null;

  // Tipos de Membresía por defecto
  const DEFAULT_TIPOS_MEMBRESIA = ['Selección', 'Élite'];

  function normalizeMembresias(list) {
    if (!Array.isArray(list)) return [];
    list.forEach(m => {
      if (!m.tipo || m.tipo === 'undefined' || m.tipo === 'null' || !m.tipo.trim()) {
        if (m.codigo && m.codigo.toUpperCase().includes('ELI')) m.tipo = 'Élite';
        else if (m.descripcion && m.descripcion.toUpperCase().includes('ELITE')) m.tipo = 'Élite';
        else m.tipo = 'Selección';
      }
      if (m.precio === undefined || m.precio === null || isNaN(m.precio)) {
        m.precio = 0;
      }
    });
    return list;
  }

  function getAvailableTiposMembresia() {
    normalizeMembresias(state.membresias);
    const customTipos = (state.membresias || []).map(m => m.tipo).filter(Boolean);
    const combined = Array.from(new Set([...DEFAULT_TIPOS_MEMBRESIA, ...customTipos]));
    return combined;
  }

  // Devuelve rango por defecto del mes en curso (del 1er día al último día del mes)
  function getCurrentMonthDateRange() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const pad = n => String(n).padStart(2, '0');
    const desde = `${firstDay.getFullYear()}-${pad(firstDay.getMonth() + 1)}-${pad(firstDay.getDate())}`;
    const hasta = `${lastDay.getFullYear()}-${pad(lastDay.getMonth() + 1)}-${pad(lastDay.getDate())}`;
    return { desde, hasta };
  }

  // Devuelve el catálogo de artículos ORDENADO ALFABÉTICAMENTE POR BODEGA, ETIQUETA Y CEPA
  function getSortedArticulos() {
    return [...(state.articulos || [])].sort((a, b) => {
      const bodegaCmp = a.bodega.localeCompare(b.bodega, 'es', { sensitivity: 'base' });
      if (bodegaCmp !== 0) return bodegaCmp;
      const etiquetaCmp = a.etiqueta.localeCompare(b.etiqueta, 'es', { sensitivity: 'base' });
      if (etiquetaCmp !== 0) return etiquetaCmp;
      return (a.cepa || '').localeCompare(b.cepa || '', 'es', { sensitivity: 'base' });
    });
  }

  function generateUniqueId(prefix = 'id') {
    idCounter++;
    return `${prefix}-${Date.now()}-${idCounter}-${Math.random().toString(36).substring(2, 7)}`;
  }

  function getFormattedTimestamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // --- LOG DE AUDITORÍA Y MONITOR DE MOVIMIENTOS ---
  function logAuditoria(modulo, accion, detalle) {
    if (!Array.isArray(state.auditoriaLogs)) {
      state.auditoriaLogs = [];
    }
    const userEmail = currentUser ? (currentUser.email || currentUser.nombre) : 'Sistema/Anonimo';
    const logEntry = {
      id: generateUniqueId('log'),
      fechaHora: getFormattedTimestamp(),
      usuario: userEmail,
      modulo: modulo,
      accion: accion,
      detalle: detalle
    };

    state.auditoriaLogs.unshift(logEntry);
    if (state.auditoriaLogs.length > 500) {
      state.auditoriaLogs = state.auditoriaLogs.slice(0, 500);
    }
  }

  // --- AUTHENTICATION & LOGIN ---

  function checkSession() {
    try {
      const storedUser = sessionStorage.getItem(SESSION_USER_KEY) || localStorage.getItem(SESSION_USER_KEY);
      if (storedUser) {
        currentUser = JSON.parse(storedUser);
        hideLoginOverlay();
        updateUserBadge();
      } else {
        showLoginOverlay();
      }
    } catch (e) {
      showLoginOverlay();
    }
  }

  function showLoginOverlay() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
      overlay.style.pointerEvents = 'all';
      overlay.classList.add('active');
    }
  }

  function hideLoginOverlay() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.style.display = 'none';
      overlay.style.pointerEvents = 'none';
    }
  }

  function updateUserBadge() {
    const badgeText = document.getElementById('user-name-text');
    if (badgeText && currentUser) {
      badgeText.textContent = `${currentUser.nombre} (${currentUser.email})`;
    }
  }

  function loginUser(userObj) {
    try {
      currentUser = userObj;
      sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(currentUser));
      hideLoginOverlay();
      updateUserBadge();
      logAuditoria('Auth', 'Inicio de Sesión', `El usuario ${currentUser.email} ha iniciado sesión en el sistema.`);
      saveState();
      showToast(`Bienvenido a CavaControl, ${currentUser.nombre}!`, 'success');
    } catch (e) {
      console.error('Error en loginUser:', e);
      hideLoginOverlay();
    }
  }

  function logoutUser() {
    if (currentUser) {
      logAuditoria('Auth', 'Cierre de Sesión', `El usuario ${currentUser.email} cerró su sesión.`);
      saveState();
    }
    currentUser = null;
    sessionStorage.removeItem(SESSION_USER_KEY);
    localStorage.removeItem(SESSION_USER_KEY);
    showLoginOverlay();
    showToast('Sesión cerrada correctamente', 'info');
  }

  async function performLogin() {
    const emailEl = document.getElementById('login-email');
    const passwordEl = document.getElementById('login-password');

    if (!emailEl || !passwordEl) return;

    const email = emailEl.value.trim();
    const password = passwordEl.value.trim();

    if (!email || !password) {
      showToast('Por favor ingrese correo electrónico y contraseña.', 'error');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.user) {
          loginUser(data.user);
          return;
        }
      }
    } catch (err) {
      console.warn('Login API offline, usando credenciales locales:', err);
    }

    // Local fallback check
    const localUser = (state.usuarios || []).find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
    if (localUser) {
      loginUser({ id: localUser.id, nombre: localUser.nombre, email: localUser.email, rol: localUser.rol });
    } else if (email === 'admin@cavacontrol.com' && password === 'admin123') {
      loginUser({ id: 'usr-admin', nombre: 'Administrador', email: 'admin@cavacontrol.com', rol: 'Admin' });
    } else {
      showToast('Credenciales inválidas. Verifique email y contraseña.', 'error');
    }
  }

  async function performRegister() {
    const nombreEl = document.getElementById('reg-nombre');
    const emailEl = document.getElementById('reg-email');
    const passwordEl = document.getElementById('reg-password');

    if (!nombreEl || !emailEl || !passwordEl) return;

    const nombre = nombreEl.value.trim();
    const email = emailEl.value.trim().toLowerCase();
    const password = passwordEl.value.trim();

    if (!nombre || !email || !password) {
      showToast('Por favor complete todos los campos de registro.', 'error');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, email, password })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.user) {
          loginUser(data.user);
          return;
        }
      }
    } catch (err) {
      console.warn('Register API offline, registrando en local:', err);
    }

    const newUser = {
      id: generateUniqueId('usr'),
      nombre,
      email,
      password,
      rol: 'Usuario',
      fechaCreacion: getFormattedTimestamp()
    };

    if (!Array.isArray(state.usuarios)) state.usuarios = [];
    state.usuarios.push(newUser);
    loginUser({ id: newUser.id, nombre: newUser.nombre, email: newUser.email, rol: newUser.rol });
  }

  // --- SQL SERVER 2019 & LOCALSTORAGE PERSISTENCE ---

  async function loadState() {
    try {
      const res = await fetch(`${API_URL}/db?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.articulos && data.proveedores) {
          state = data;
          if (!Array.isArray(state.usuarios)) state.usuarios = [];
          if (!Array.isArray(state.auditoriaLogs)) state.auditoriaLogs = [];
          normalizeMembresias(state.membresias);
          isSqlServerConnected = true;
          updateSqlBadge(true);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          renderAllViews();
          checkSession();
          return;
        }
      }
    } catch (e) {
      console.warn('SQL Server API backend no disponible, usando localStorage nativo:', e);
    }

    isSqlServerConnected = false;
    updateSqlBadge(false);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        state = JSON.parse(stored);
        if (!Array.isArray(state.usuarios)) state.usuarios = [];
        if (!Array.isArray(state.auditoriaLogs)) state.auditoriaLogs = [];
        normalizeMembresias(state.membresias);
      }
    } catch (e) {
      console.error('Error cargando state local:', e);
    }
    renderAllViews();
    checkSession();
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Error guardando en localStorage:', e);
    }

    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
      triggerBackgroundSqlServerSync();
    }, 200);
  }

  async function triggerBackgroundSqlServerSync() {
    try {
      const res = await fetch(`${API_URL}/db/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
      });
      if (res.ok) {
        isSqlServerConnected = true;
        updateSqlBadge(true);
      } else {
        isSqlServerConnected = false;
        updateSqlBadge(false);
      }
    } catch (e) {
      isSqlServerConnected = false;
      updateSqlBadge(false);
    }
  }

  function updateSqlBadge(connected) {
    const badge = document.getElementById('sql-status-badge');
    const text = document.getElementById('sql-status-text');
    if (!badge || !text) return;

    if (connected) {
      badge.style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
      badge.style.color = '#10b981';
      badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      text.textContent = 'SQL Server 2019: Conectado';
    } else {
      badge.style.backgroundColor = 'rgba(245, 158, 11, 0.15)';
      badge.style.color = '#f59e0b';
      badge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
      text.textContent = 'SQL Server 2019: Offline (Modo Cache Local)';
    }
  }

  // --- CLEAR ALL DATA ---
  async function clearAllData() {
    if (!confirm('¿ESTÁS SEGURO de eliminar TODOS los datos (proveedores, artículos, clientes, entradas, salidas y membresías)? Esta acción no se puede deshacer.')) {
      return;
    }

    logAuditoria('Sistema', 'Borrado de Base de Datos', 'El usuario eliminó por completo los datos de negocio.');

    state.proveedores = [];
    state.articulos = [];
    state.membresias = [];
    state.clientes = [];
    state.entradas = [];
    state.salidas = [];

    saveState();
    renderAllViews();
    showToast('Base de datos limpiada por completo.', 'success');
  }

  // --- COMPUTED DATA HELPERS ---

  function getProveedorComprasCount(proveedorId) {
    return (state.entradas || []).filter(e => String(e.proveedorId) === String(proveedorId)).length;
  }

  function getArticuloMetrics(articuloId) {
    const articulo = (state.articulos || []).find(a => String(a.id) === String(articuloId));
    if (!articulo) return { stock: 0, ultimoPrecioCaja: 0, ultimoCostoAdicCaja: 0, ultimoCostoUnitario: 0 };

    const totalEntradasUnits = (state.entradas || [])
      .filter(e => String(e.articuloId) === String(articuloId))
      .reduce((sum, e) => sum + (Number(e.unidadesSumadas) || 0), 0);

    const totalSalidasUnits = (state.salidas || [])
      .filter(s => String(s.articuloId) === String(articuloId))
      .reduce((sum, s) => sum + (Number(s.cantidadBotellas) || 0), 0);

    const stock = Math.max(0, totalEntradasUnits - totalSalidasUnits);

    const lastEntrada = [...(state.entradas || [])]
      .filter(e => String(e.articuloId) === String(articuloId))
      .sort((a, b) => (Number(b.numeroCompra) || 0) - (Number(a.numeroCompra) || 0))[0];

    const ultimoPrecioCaja = lastEntrada ? Number(lastEntrada.precioCaja) || 0 : 0;
    const ultimoCostoAdicCaja = lastEntrada ? Number(lastEntrada.costoAdicionalCaja) || 0 : 0;
    const uxb = Number(articulo.uxb) || 1;

    const ultimoCostoUnitario = (ultimoPrecioCaja + ultimoCostoAdicCaja) / uxb;

    return { stock, ultimoPrecioCaja, ultimoCostoAdicCaja, ultimoCostoUnitario };
  }

  function getMembresiaCalculations(membresia) {
    const items = membresia.items && membresia.items.length > 0
      ? membresia.items
      : (membresia.articuloId ? [{ articuloId: membresia.articuloId, cantidad: Number(membresia.cantidad) || 1 }] : []);

    const totalBotellas = items.reduce((s, i) => s + (Number(i.cantidad) || 0), 0);
    const precio = Number(membresia.precio) || 0;

    return { precio, totalBotellas, items };
  }

  function getClienteEntregasCount(clienteId) {
    return (state.salidas || [])
      .filter(s => String(s.clienteId) === String(clienteId))
      .reduce((sum, s) => sum + (Number(s.cantidadBotellas) || 0), 0);
  }

  function isMembresiaVigente(membresia, targetDateStr = null) {
    const today = targetDateStr ? new Date(targetDateStr) : new Date();
    today.setHours(0, 0, 0, 0);

    if (!membresia.fechaDesde || !membresia.fechaHasta) return true;

    const desde = new Date(membresia.fechaDesde + 'T00:00:00');
    const hasta = new Date(membresia.fechaHasta + 'T23:59:59');

    return today >= desde && today <= hasta;
  }

  // --- UI CONTROLLERS & TABS ---
  const tabButtons = document.querySelectorAll('.nav-btn');
  const viewSections = document.querySelectorAll('.view-section');
  const pageTitle = document.getElementById('page-title');
  const pageSubtitle = document.getElementById('page-subtitle');

  const TAB_TITLES = {
    dashboard: { title: 'Dashboard', subtitle: 'Resumen general del emprendimiento de vinos' },
    membresias: { title: 'Membresías', subtitle: 'Configuración de paquetes multivino por Tipo y Precio Fijo' },
    proveedores: { title: 'Proveedores', subtitle: 'Gestión de distribuidores e historial de compras' },
    clientes: { title: 'Clientes', subtitle: 'Base de clientes, membresías asignadas y entregas históricas' },
    articulos: { title: 'Maestro de Artículos', subtitle: 'Catálogo de vinos por Bodega, Etiqueta, Cepa y Proveedores' },
    entradas: { title: 'Entradas de Stock', subtitle: 'Ingreso de compras por caja (Precio + Costo Adicional) e inventario' },
    stock: { title: 'Control de Stock', subtitle: 'Monitoreo de cava en unidades y costo total valorizado' },
    salidas: { title: 'Salidas y Ventas', subtitle: 'Registro de entregas por botella o por membresía' },
    auditoria: { title: 'Monitor de Auditoría', subtitle: 'Histórico de movimientos registrado por usuario, fecha y hora' }
  };

  function switchTab(tabId) {
    activeTabId = tabId;
    tabButtons.forEach(btn => {
      if (btn.dataset.tab === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    viewSections.forEach(sec => {
      if (sec.id === `view-${tabId}`) {
        sec.classList.add('active');
      } else {
        sec.classList.remove('active');
      }
    });

    if (TAB_TITLES[tabId]) {
      pageTitle.textContent = TAB_TITLES[tabId].title;
      pageSubtitle.textContent = TAB_TITLES[tabId].subtitle;
    }

    renderView(tabId);
  }

  // --- FAST TARGETED RENDER ENGINE ---

  function renderView(tabId) {
    switch (tabId) {
      case 'dashboard': renderDashboard(); break;
      case 'membresias': renderMembresias(); break;
      case 'proveedores': renderProveedores(); break;
      case 'clientes': renderClientes(); break;
      case 'articulos': renderArticulos(); break;
      case 'entradas': renderEntradas(); break;
      case 'stock': renderStock(); break;
      case 'salidas': renderSalidas(); break;
      case 'auditoria': renderAuditoria(); break;
      default: renderDashboard(); break;
    }
    requestAnimationFrame(() => {
      const activeViewEl = document.getElementById(`view-${tabId}`);
      if (window.lucide && activeViewEl) {
        window.lucide.createIcons({ scope: activeViewEl });
      }
    });
  }

  function renderAllViews() {
    renderView(activeTabId);
  }

  // 1. DASHBOARD
  function renderDashboard() {
    let totalStockVal = 0;
    let totalBotellas = 0;
    (state.articulos || []).forEach(art => {
      const m = getArticuloMetrics(art.id);
      totalStockVal += m.stock * m.ultimoCostoUnitario;
      totalBotellas += m.stock;
    });

    document.getElementById('dash-val-stock').textContent = formatCurrency(totalStockVal);
    document.getElementById('dash-sub-stock').textContent = `${totalBotellas} botellas en cava`;

    const membVigentes = (state.membresias || []).filter(m => isMembresiaVigente(m)).length;
    document.getElementById('dash-memb-vigentes').textContent = membVigentes;
    document.getElementById('dash-sub-memb').textContent = `${(state.clientes || []).length} clientes registrados`;

    const totalInvertido = (state.entradas || []).reduce((s, e) => s + (Number(e.cantidadCajas) * (Number(e.precioCaja) + (Number(e.costoAdicionalCaja) || 0))), 0);
    document.getElementById('dash-total-entradas').textContent = (state.entradas || []).length;
    document.getElementById('dash-sub-entradas').textContent = `${formatCurrency(totalInvertido)} invertidos`;

    const totalEntregasBotellas = (state.salidas || []).reduce((s, sal) => s + (Number(sal.cantidadBotellas) || 0), 0);
    document.getElementById('dash-total-salidas').textContent = (state.salidas || []).length;
    document.getElementById('dash-sub-salidas').textContent = `${totalEntregasBotellas} botellas entregadas`;

    const movementsTbody = document.getElementById('tbody-dash-movements');
    movementsTbody.innerHTML = '';

    const allMovements = [
      ...(state.entradas || []).map(e => {
        const art = state.articulos.find(a => String(a.id) === String(e.articuloId));
        return {
          tipo: 'ENTRADA',
          detalle: art ? `${art.bodega} - ${art.etiqueta}` : 'Vino N/A',
          cantidad: `+${e.unidadesSumadas} bot. (${e.cantidadCajas} cj.)`,
          fecha: e.fecha || '--'
        };
      }),
      ...(state.salidas || []).map(s => {
        const art = state.articulos.find(a => String(a.id) === String(s.articuloId));
        return {
          tipo: 'SALIDA',
          detalle: art ? `${art.bodega} - ${art.etiqueta}` : 'Vino N/A',
          cantidad: `-${s.cantidadBotellas} bot.`,
          fecha: s.fecha || '--'
        };
      })
    ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 5);

    if (allMovements.length === 0) {
      movementsTbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Sin movimientos registrados</td></tr>`;
    } else {
      let html = '';
      allMovements.forEach(m => {
        const isEntrada = m.tipo === 'ENTRADA';
        const badgeClass = isEntrada ? 'badge-success' : 'badge-danger';
        html += `
          <tr>
            <td><span class="badge ${badgeClass}">${m.tipo}</span></td>
            <td><strong>${m.detalle}</strong></td>
            <td>${m.cantidad}</td>
            <td class="text-muted">${m.fecha}</td>
          </tr>
        `;
      });
      movementsTbody.innerHTML = html;
    }

    const alertsTbody = document.getElementById('tbody-dash-alerts');
    alertsTbody.innerHTML = '';
    const lowStockArts = (state.articulos || []).map(a => ({
      ...a,
      stock: getArticuloMetrics(a.id).stock
    })).filter(a => a.stock <= 6);

    if (lowStockArts.length === 0) {
      alertsTbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No hay productos con stock crítico</td></tr>`;
    } else {
      let html = '';
      lowStockArts.forEach(a => {
        const badgeClass = a.stock === 0 ? 'badge-danger' : 'badge-warning';
        const estadoText = a.stock === 0 ? 'Sin Stock' : 'Stock Bajo';
        html += `
          <tr>
            <td><strong>${a.bodega}</strong> ${a.etiqueta}</td>
            <td>${a.cepa}</td>
            <td><strong>${a.stock}</strong> bot.</td>
            <td><span class="badge ${badgeClass}">${estadoText}</span></td>
          </tr>
        `;
      });
      alertsTbody.innerHTML = html;
    }
  }

  // 2. MEMBRESÍAS (PRECIO FIJO)
  function renderMembresias() {
    const tbody = document.getElementById('tbody-membresias');
    const searchVal = (document.getElementById('search-membresias').value || '').toLowerCase();

    const list = (state.membresias || []).filter(m => 
      (m.tipo && m.tipo.toLowerCase().includes(searchVal)) ||
      m.codigo.toLowerCase().includes(searchVal) ||
      m.descripcion.toLowerCase().includes(searchVal)
    );

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No hay membresías registradas</td></tr>`;
      return;
    }

    let html = '';
    list.forEach(m => {
      const calc = getMembresiaCalculations(m);
      const isVigente = isMembresiaVigente(m);

      const itemsDisplay = calc.items.map(item => {
        const art = state.articulos.find(a => String(a.id) === String(item.articuloId));
        const artName = art ? `${art.bodega} - ${art.etiqueta}` : 'Vino N/A';
        return `<span class="badge badge-info" style="margin:2px 2px 2px 0; display:inline-block">${item.cantidad}x ${artName}</span>`;
      }).join(' ');

      const tipoBadgeClass = m.tipo === 'Élite' ? 'badge-warning' : 'badge-info';

      html += `
        <tr>
          <td><span class="badge ${tipoBadgeClass}">${m.tipo || 'Selección'}</span></td>
          <td><span class="badge badge-secondary">${m.codigo}</span></td>
          <td><strong>${m.descripcion}</strong></td>
          <td>${itemsDisplay}</td>
          <td><strong>${calc.totalBotellas}</strong> bot.</td>
          <td>
            <small class="text-muted">${m.fechaDesde} a ${m.fechaHasta}</small>
            <br>
            <span class="badge ${isVigente ? 'badge-success' : 'badge-danger'}">${isVigente ? 'Vigente' : 'Vencida'}</span>
          </td>
          <td><strong class="text-gold" style="font-size:1.05rem">${formatCurrency(m.precio || 0)}</strong></td>
          <td>
            <button class="btn btn-ghost btn-sm btn-icon" onclick="window.editMembresia('${m.id}')" title="Editar"><i data-lucide="edit-2"></i></button>
            <button class="btn btn-ghost btn-sm btn-icon" onclick="window.deleteMembresia('${m.id}')" title="Eliminar"><i data-lucide="trash-2"></i></button>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }

  // 3. PROVEEDORES
  function renderProveedores() {
    const tbody = document.getElementById('tbody-proveedores');
    const searchVal = (document.getElementById('search-proveedores').value || '').toLowerCase();

    const list = (state.proveedores || []).filter(p =>
      p.nombre.toLowerCase().includes(searchVal) ||
      (p.email && p.email.toLowerCase().includes(searchVal))
    );

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No hay proveedores registrados</td></tr>`;
      return;
    }

    let html = '';
    list.forEach(p => {
      const comprasCount = getProveedorComprasCount(p.id);
      html += `
        <tr>
          <td><strong>${p.nombre}</strong></td>
          <td>${p.telefono || '-'}</td>
          <td>${p.email || '-'}</td>
          <td>
            <span class="badge badge-info" style="font-size:0.9rem">${comprasCount} compras</span>
          </td>
          <td>
            <button class="btn btn-ghost btn-sm btn-icon" onclick="window.editProveedor('${p.id}')" title="Editar"><i data-lucide="edit-2"></i></button>
            <button class="btn btn-ghost btn-sm btn-icon" onclick="window.deleteProveedor('${p.id}')" title="Eliminar"><i data-lucide="trash-2"></i></button>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }

  // 4. CLIENTES
  function renderClientes() {
    const tbody = document.getElementById('tbody-clientes');
    const searchVal = (document.getElementById('search-clientes').value || '').toLowerCase();

    const list = (state.clientes || []).filter(c =>
      `${c.nombre} ${c.apellido}`.toLowerCase().includes(searchVal) ||
      (c.telefono && c.telefono.includes(searchVal))
    );

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No hay clientes registrados</td></tr>`;
      return;
    }

    let html = '';
    list.forEach(c => {
      const memb = state.membresias.find(m => String(m.id) === String(c.membresiaId));
      let membName = '<span class="text-muted">Sin membresía</span>';
      if (memb) {
        const badgeClass = memb.tipo === 'Élite' ? 'badge-warning' : 'badge-info';
        membName = `<span class="badge ${badgeClass}" style="margin-right:0.3rem">${memb.tipo || 'Selección'}</span> ${memb.descripcion} (${memb.codigo})`;
      }
      const entregasCount = getClienteEntregasCount(c.id);

      html += `
        <tr>
          <td><strong>${c.nombre} ${c.apellido}</strong></td>
          <td>${c.telefono || '-'}</td>
          <td>${c.localidad || '-'}, ${c.provincia || '-'}</td>
          <td>${c.direccion || '-'}</td>
          <td>${membName}</td>
          <td><span class="badge badge-info" style="font-size:0.9rem">${entregasCount} botellas</span></td>
          <td>
            <button class="btn btn-ghost btn-sm btn-icon" onclick="window.editCliente('${c.id}')" title="Editar"><i data-lucide="edit-2"></i></button>
            <button class="btn btn-ghost btn-sm btn-icon" onclick="window.deleteCliente('${c.id}')" title="Eliminar"><i data-lucide="trash-2"></i></button>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }

  // 5. ARTÍCULOS
  function renderArticulos() {
    const tbody = document.getElementById('tbody-articulos');
    const searchVal = (document.getElementById('search-articulos').value || '').toLowerCase();

    const list = getSortedArticulos().filter(a =>
      a.bodega.toLowerCase().includes(searchVal) ||
      a.etiqueta.toLowerCase().includes(searchVal) ||
      a.cepa.toLowerCase().includes(searchVal)
    );

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No hay artículos registrados</td></tr>`;
      return;
    }

    let html = '';
    list.forEach(a => {
      const metrics = getArticuloMetrics(a.id);
      
      const provs = (a.proveedoresIds || []).map(pid => {
        const p = state.proveedores.find(pr => String(pr.id) === String(pid));
        return p ? p.nombre : null;
      }).filter(Boolean);

      const provsDisplay = provs.length > 0 
        ? provs.map(name => `<span class="badge badge-info">${name}</span>`).join(' ')
        : '<span class="text-muted">Ninguno asignado</span>';

      html += `
        <tr>
          <td><strong>${a.bodega}</strong></td>
          <td>${a.etiqueta}</td>
          <td>${a.cepa}</td>
          <td>${a.uxb} un.</td>
          <td>${provsDisplay}</td>
          <td><strong class="text-gold">${formatCurrency(metrics.ultimoCostoUnitario)}</strong></td>
          <td><strong>${metrics.stock}</strong> bot.</td>
          <td>
            <button class="btn btn-ghost btn-sm btn-icon" onclick="window.editArticulo('${a.id}')" title="Editar"><i data-lucide="edit-2"></i></button>
            <button class="btn btn-ghost btn-sm btn-icon" onclick="window.deleteArticulo('${a.id}')" title="Eliminar"><i data-lucide="trash-2"></i></button>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }

  // 6. ENTRADAS
  function renderEntradas() {
    const tbody = document.getElementById('tbody-entradas');
    const searchVal = (document.getElementById('search-entradas').value || '').toLowerCase();

    const list = (state.entradas || []).filter(e => {
      const art = state.articulos.find(a => String(a.id) === String(e.articuloId));
      const prov = state.proveedores.find(p => String(p.id) === String(e.proveedorId));
      const artName = art ? `${art.bodega} ${art.etiqueta}`.toLowerCase() : '';
      const provName = prov ? prov.nombre.toLowerCase() : '';
      const numStr = String(e.numeroCompra);

      return numStr.includes(searchVal) || artName.includes(searchVal) || provName.includes(searchVal);
    });

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted">No hay compras (entradas) registradas</td></tr>`;
      return;
    }

    let html = '';
    list.sort((a, b) => Number(b.numeroCompra) - Number(a.numeroCompra)).forEach(e => {
      const art = state.articulos.find(a => String(a.id) === String(e.articuloId));
      const prov = state.proveedores.find(p => String(p.id) === String(e.proveedorId));
      
      const precioCaja = Number(e.precioCaja) || 0;
      const costoAdicCaja = Number(e.costoAdicionalCaja) || 0;
      const uxb = art ? (Number(art.uxb) || 1) : 1;
      const costoUnitarioBotella = (precioCaja + costoAdicCaja) / uxb;
      const totalCompra = Number(e.cantidadCajas) * (precioCaja + costoAdicCaja);

      html += `
        <tr>
          <td><span class="badge badge-info">#${e.numeroCompra}</span></td>
          <td><strong>${art ? art.bodega + ' - ' + art.etiqueta : 'N/A'}</strong></td>
          <td>${e.cepa || (art ? art.cepa : '-')}</td>
          <td>${prov ? prov.nombre : 'N/A'}</td>
          <td>${e.cantidadCajas} cj.</td>
          <td><strong>+${e.unidadesSumadas}</strong> bot.</td>
          <td>${formatCurrency(precioCaja)}</td>
          <td class="text-gold">+${formatCurrency(costoAdicCaja)}</td>
          <td><strong class="text-gold">${formatCurrency(costoUnitarioBotella)}</strong></td>
          <td><strong class="text-gold">${formatCurrency(totalCompra)}</strong></td>
          <td class="text-muted">${e.fecha}</td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }

  // 7. STOCK
  function renderStock() {
    const tbody = document.getElementById('tbody-stock');
    const searchVal = (document.getElementById('search-stock').value || '').toLowerCase();

    let totalValuation = 0;

    const list = getSortedArticulos().filter(a =>
      a.bodega.toLowerCase().includes(searchVal) ||
      a.etiqueta.toLowerCase().includes(searchVal) ||
      a.cepa.toLowerCase().includes(searchVal)
    );

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted">No hay productos en inventario</td></tr>`;
      document.getElementById('stock-total-val').textContent = formatCurrency(0);
      return;
    }

    let html = '';
    list.forEach(a => {
      const metrics = getArticuloMetrics(a.id);
      const uxb = Number(a.uxb) || 1;
      const cajasEquiv = Math.floor(metrics.stock / uxb);
      const botellasSueltas = metrics.stock % uxb;

      const totalVal = metrics.stock * metrics.ultimoCostoUnitario;
      totalValuation += totalVal;

      let badgeClass = 'badge-success';
      let estadoText = 'En Stock';

      if (metrics.stock === 0) {
        badgeClass = 'badge-danger';
        estadoText = 'Sin Stock';
      } else if (metrics.stock <= 6) {
        badgeClass = 'badge-warning';
        estadoText = 'Stock Bajo';
      }

      html += `
        <tr>
          <td><strong>${a.bodega}</strong></td>
          <td>${a.etiqueta}</td>
          <td>${a.cepa}</td>
          <td>${uxb} un.</td>
          <td><strong style="font-size:1.05rem">${metrics.stock}</strong> bot.</td>
          <td>${cajasEquiv} cj. ${botellasSueltas > 0 ? `+ ${botellasSueltas} bot.` : ''}</td>
          <td>${formatCurrency(metrics.ultimoPrecioCaja)}</td>
          <td class="text-gold">+${formatCurrency(metrics.ultimoCostoAdicCaja)}</td>
          <td><strong class="text-gold">${formatCurrency(metrics.ultimoCostoUnitario)}</strong></td>
          <td><strong class="text-gold">${formatCurrency(totalVal)}</strong></td>
          <td><span class="badge ${badgeClass}">${estadoText}</span></td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
    document.getElementById('stock-total-val').textContent = formatCurrency(totalValuation);
  }

  // 8. SALIDAS
  function renderSalidas() {
    const tbody = document.getElementById('tbody-salidas');
    const searchVal = (document.getElementById('search-salidas').value || '').toLowerCase();

    const list = (state.salidas || []).filter(s => {
      const cli = state.clientes.find(c => String(c.id) === String(s.clienteId));
      const cliName = cli ? `${cli.nombre} ${cli.apellido}`.toLowerCase() : '';
      return cliName.includes(searchVal) || (s.tipoVenta && s.tipoVenta.toLowerCase().includes(searchVal));
    });

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No hay salidas/ventas registradas</td></tr>`;
      return;
    }

    let html = '';
    list.sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).forEach(s => {
      const cli = state.clientes.find(c => String(c.id) === String(s.clienteId));
      const art = state.articulos.find(a => String(a.id) === String(s.articuloId));
      const isMembresia = s.tipoVenta === 'MEMBRESIA';
      const badgeClass = isMembresia ? 'badge-info' : 'badge-success';

      let detalleDisplay = art ? `${art.bodega} - ${art.etiqueta}` : (s.detalle || 'Vino N/A');
      if (isMembresia && s.membresiaId) {
        const memb = state.membresias.find(m => String(m.id) === String(s.membresiaId));
        if (memb) detalleDisplay = `[${memb.tipo || 'Selección'} - ${memb.codigo}] ${memb.descripcion} (${detalleDisplay})`;
      }

      html += `
        <tr>
          <td class="text-muted">${s.fecha}</td>
          <td><strong>${cli ? `${cli.nombre} ${cli.apellido}` : 'Cliente N/A'}</strong></td>
          <td><span class="badge ${badgeClass}">${isMembresia ? 'Membresía' : 'Botella'}</span></td>
          <td>${detalleDisplay}</td>
          <td><strong>${s.cantidadBotellas}</strong> bot.</td>
          <td>
            <button class="btn btn-ghost btn-sm btn-icon" onclick="window.deleteSalida('${s.id}')" title="Eliminar Venta"><i data-lucide="trash-2"></i></button>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }

  // 9. MONITOR DE AUDITORÍA (LOGS DE MOVIMIENTOS)
  function renderAuditoria() {
    const tbody = document.getElementById('tbody-auditoria');
    if (!tbody) return;

    const searchVal = (document.getElementById('search-auditoria').value || '').toLowerCase();
    const moduloFilter = (document.getElementById('filter-auditoria-modulo').value || '').toLowerCase();

    const list = (state.auditoriaLogs || []).filter(log => {
      const matchSearch = log.usuario.toLowerCase().includes(searchVal) ||
                          log.accion.toLowerCase().includes(searchVal) ||
                          log.detalle.toLowerCase().includes(searchVal);
      const matchModulo = !moduloFilter || log.modulo.toLowerCase() === moduloFilter;
      return matchSearch && matchModulo;
    });

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No hay registros de auditoría</td></tr>`;
      return;
    }

    let html = '';
    list.forEach(log => {
      let badgeClass = 'badge-info';
      if (log.accion.toLowerCase().includes('alta') || log.accion.toLowerCase().includes('crear') || log.accion.toLowerCase().includes('compra')) {
        badgeClass = 'badge-success';
      } else if (log.accion.toLowerCase().includes('eliminar') || log.accion.toLowerCase().includes('borrad')) {
        badgeClass = 'badge-danger';
      } else if (log.accion.toLowerCase().includes('edici') || log.accion.toLowerCase().includes('actualiz')) {
        badgeClass = 'badge-warning';
      }

      html += `
        <tr>
          <td class="text-muted"><small>${log.fechaHora}</small></td>
          <td><strong>${log.usuario}</strong></td>
          <td><span class="badge badge-info">${log.modulo}</span></td>
          <td><span class="badge ${badgeClass}">${log.accion}</span></td>
          <td>${log.detalle}</td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }

  // --- MODAL CONTROLLER ---
  const modalOverlay = document.getElementById('modal-overlay');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const btnModalClose = document.getElementById('btn-modal-close');

  function openModal(title, contentHtml) {
    modalTitle.textContent = title;
    modalBody.innerHTML = contentHtml;
    modalOverlay.classList.add('active');
    requestAnimationFrame(() => {
      if (window.lucide) window.lucide.createIcons({ scope: modalBody });
    });
  }

  function closeModal() {
    modalOverlay.classList.remove('active');
  }

  btnModalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // --- FORM HANDLERS & MODAL FORMS ---

  // 1. PROVEEDORES FORM
  window.openProveedorForm = function (proveedorId = null) {
    const prov = proveedorId ? state.proveedores.find(p => String(p.id) === String(proveedorId)) : null;
    const isEdit = !!prov;
    const comprasCount = isEdit ? getProveedorComprasCount(prov.id) : 0;

    const html = `
      <form id="form-proveedor">
        <div class="form-group">
          <label>Nombre del Proveedor *</label>
          <input type="text" id="prov-nombre" class="form-control" value="${isEdit ? prov.nombre : ''}" required placeholder="Ej: Distribuidora Cavas del Sur">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Teléfono</label>
            <input type="text" id="prov-telefono" class="form-control" value="${isEdit ? prov.telefono || '' : ''}" placeholder="+54 9 11 ...">
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="prov-email" class="form-control" value="${isEdit ? prov.email || '' : ''}" placeholder="ventas@proveedor.com">
          </div>
        </div>
        <div class="form-group">
          <label>Cantidad de veces comprado <span class="badge-info">NO EDITABLE</span></label>
          <input type="text" class="form-control" value="${comprasCount} compras realizadas" readonly>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar Cambios' : 'Crear Proveedor'}</button>
        </div>
      </form>
    `;

    openModal(isEdit ? 'Editar Proveedor' : 'Nuevo Proveedor', html);

    document.getElementById('form-proveedor').addEventListener('submit', (e) => {
      e.preventDefault();
      const nombre = document.getElementById('prov-nombre').value.trim();
      const telefono = document.getElementById('prov-telefono').value.trim();
      const email = document.getElementById('prov-email').value.trim();

      if (isEdit) {
        prov.nombre = nombre;
        prov.telefono = telefono;
        prov.email = email;
        logAuditoria('Proveedores', 'Edición de Proveedor', `Se actualizó el proveedor ${nombre}`);
        showToast('Proveedor actualizado exitosamente', 'success');
      } else {
        state.proveedores.push({
          id: generateUniqueId('prov'),
          nombre,
          telefono,
          email
        });
        logAuditoria('Proveedores', 'Alta de Proveedor', `Se creó el proveedor ${nombre}`);
        showToast('Proveedor creado exitosamente', 'success');
      }

      saveState();
      closeModal();
      renderAllViews();
    });
  };

  window.editProveedor = function (id) { window.openProveedorForm(id); };
  window.deleteProveedor = function (id) {
    const prov = state.proveedores.find(p => String(p.id) === String(id));
    if (confirm('¿Desea eliminar este proveedor?')) {
      state.proveedores = state.proveedores.filter(p => String(p.id) !== String(id));
      logAuditoria('Proveedores', 'Eliminación de Proveedor', `Se eliminó el proveedor ${prov ? prov.nombre : id}`);
      saveState();
      renderAllViews();
      showToast('Proveedor eliminado', 'success');
    }
  };

  // 2. ARTÍCULOS FORM
  window.openArticuloForm = function (articuloId = null) {
    const art = articuloId ? state.articulos.find(a => String(a.id) === String(articuloId)) : null;
    const isEdit = !!art;

    if (state.proveedores.length === 0) {
      showToast('Primero debe dar de alta al menos un proveedor en PROVEEDORES', 'error');
      return;
    }

    const selectedProvs = isEdit ? (art.proveedoresIds || []) : [];

    const provsCheckboxes = state.proveedores.map(p => {
      const isChecked = selectedProvs.includes(String(p.id)) ? 'checked' : '';
      return `
        <label class="checkbox-label">
          <input type="checkbox" name="articulo-provs" value="${p.id}" ${isChecked}>
          <span>${p.nombre}</span>
        </label>
      `;
    }).join('');

    const html = `
      <form id="form-articulo">
        <div class="form-row">
          <div class="form-group">
            <label>Bodega *</label>
            <input type="text" id="art-bodega" class="form-control" value="${isEdit ? art.bodega : ''}" required placeholder="Ej: Catena Zapata">
          </div>
          <div class="form-group">
            <label>Etiqueta / Marca *</label>
            <input type="text" id="art-etiqueta" class="form-control" value="${isEdit ? art.etiqueta : ''}" required placeholder="Ej: D.V. Catena">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Cepa *</label>
            <input type="text" id="art-cepa" class="form-control" value="${isEdit ? art.cepa : ''}" required placeholder="Ej: Malbec - Cabernet Sauvignon">
          </div>
          <div class="form-group">
            <label>UxB (Unidades por Bulto/Caja) *</label>
            <input type="number" id="art-uxb" class="form-control" min="1" value="${isEdit ? art.uxb : 6}" required>
          </div>
        </div>

        <div class="form-group">
          <label>Proveedores Autorizados que lo venden *</label>
          <div class="suppliers-checkbox-grid">
            ${provsCheckboxes}
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar Cambios' : 'Crear Artículo'}</button>
        </div>
      </form>
    `;

    openModal(isEdit ? 'Editar Artículo' : 'Nuevo Artículo', html);

    document.getElementById('form-articulo').addEventListener('submit', (e) => {
      e.preventDefault();
      const bodega = document.getElementById('art-bodega').value.trim();
      const etiqueta = document.getElementById('art-etiqueta').value.trim();
      const cepa = document.getElementById('art-cepa').value.trim();
      const uxb = parseInt(document.getElementById('art-uxb').value, 10) || 6;
      const checkedProvs = Array.from(document.querySelectorAll('input[name="articulo-provs"]:checked')).map(cb => cb.value);

      if (checkedProvs.length === 0) {
        showToast('Debe seleccionar al menos un proveedor autorizado', 'error');
        return;
      }

      if (isEdit) {
        art.bodega = bodega;
        art.etiqueta = etiqueta;
        art.cepa = cepa;
        art.uxb = uxb;
        art.proveedoresIds = checkedProvs;
        logAuditoria('Artículos', 'Edición de Artículo', `Se actualizó el artículo ${bodega} - ${etiqueta}`);
        showToast('Artículo actualizado', 'success');
      } else {
        state.articulos.push({
          id: generateUniqueId('art'),
          bodega,
          etiqueta,
          cepa,
          uxb,
          proveedoresIds: checkedProvs
        });
        logAuditoria('Artículos', 'Alta de Artículo', `Se creó el vino ${bodega} - ${etiqueta} (${cepa})`);
        showToast('Artículo creado exitosamente', 'success');
      }

      saveState();
      closeModal();
      renderAllViews();
    });
  };

  window.editArticulo = function (id) { window.openArticuloForm(id); };
  window.deleteArticulo = function (id) {
    const art = state.articulos.find(a => String(a.id) === String(id));
    if (confirm('¿Desea eliminar este artículo?')) {
      state.articulos = state.articulos.filter(a => String(a.id) !== String(id));
      logAuditoria('Artículos', 'Eliminación de Artículo', `Se eliminó el vino ${art ? art.bodega + ' - ' + art.etiqueta : id}`);
      saveState();
      renderAllViews();
      showToast('Artículo eliminado', 'success');
    }
  };

  // 3. MEMBRESÍAS FORM (PRECIO FIJO + VINOS ORDENADOS POR BODEGA Y ETIQUETA)
  window.openMembresiaForm = function (membresiaId = null) {
    const memb = membresiaId ? state.membresias.find(m => String(m.id) === String(membresiaId)) : null;
    const isEdit = !!memb;

    if (state.articulos.length === 0) {
      showToast('Primero debe cargar al menos un artículo en ARTÍCULOS', 'error');
      return;
    }

    const availableTipos = getAvailableTiposMembresia();
    const currentTipo = isEdit ? (memb.tipo || 'Selección') : 'Selección';

    const tipoOptionsHtml = availableTipos.map(t => `
      <option value="${t}" ${t === currentTipo ? 'selected' : ''}>${t}</option>
    `).join('') + `<option value="__NEW__">+ Crear nuevo tipo de membresía...</option>`;

    const monthRange = getCurrentMonthDateRange();
    const defaultDesde = isEdit ? memb.fechaDesde : monthRange.desde;
    const defaultHasta = isEdit ? memb.fechaHasta : monthRange.hasta;

    const sortedArts = getSortedArticulos();

    let initialItems = [];
    if (isEdit && memb.items && memb.items.length > 0) {
      initialItems = memb.items;
    } else if (isEdit && memb.articuloId) {
      initialItems = [{ articuloId: memb.articuloId, cantidad: memb.cantidad || 1 }];
    } else {
      initialItems = [{ articuloId: sortedArts[0].id, cantidad: 1 }];
    }

    const html = `
      <form id="form-membresia">
        <div class="form-row">
          <div class="form-group">
            <label>Tipo de Membresía *</label>
            <select id="memb-tipo" class="form-control" required>
              ${tipoOptionsHtml}
            </select>
          </div>
          <div class="form-group" id="group-nuevo-tipo" style="display:none">
            <label>Nombre del Nuevo Tipo *</label>
            <input type="text" id="memb-nuevo-tipo-input" class="form-control" placeholder="Ej: Platinum / Reserva">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Código de Membresía *</label>
            <input type="text" id="memb-codigo" class="form-control" value="${isEdit ? memb.codigo : 'MEM-' + Math.floor(100 + Math.random()*900)}" required placeholder="Ej: MEM-001">
          </div>
          <div class="form-group">
            <label>Descripción *</label>
            <input type="text" id="memb-descripcion" class="form-control" value="${isEdit ? memb.descripcion : ''}" required placeholder="Ej: Selección 4 Vinos Premium">
          </div>
        </div>

        <div class="form-group">
          <div class="memb-items-header">
            <label><strong>Vinos Incluidos en la Membresía *</strong> <small class="text-muted">(Ordenados por Bodega y Etiqueta)</small></label>
            <button type="button" class="btn btn-outline btn-sm" id="btn-add-wine-row">
              <i data-lucide="plus"></i> Agregar Vino
            </button>
          </div>
          <div id="memb-items-container"></div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Fecha Desde *</label>
            <input type="date" id="memb-desde" class="form-control" value="${defaultDesde}" required>
          </div>
          <div class="form-group">
            <label>Fecha Hasta *</label>
            <input type="date" id="memb-hasta" class="form-control" value="${defaultHasta}" required>
          </div>
        </div>

        <div class="form-group">
          <label>Precio Fijo de la Membresía ($) *</label>
          <input type="number" id="memb-precio" class="form-control" min="0" step="100" value="${isEdit ? (memb.precio || 0) : 25000}" required placeholder="Ej: 25000" style="font-weight:bold; font-size:1.1rem; color:var(--gold-accent);">
        </div>

        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar Cambios' : 'Crear Membresía'}</button>
        </div>
      </form>
    `;

    openModal(isEdit ? 'Editar Membresía' : 'Nueva Membresía', html);

    const tipoSelect = document.getElementById('memb-tipo');
    const groupNuevoTipo = document.getElementById('group-nuevo-tipo');
    const inputNuevoTipo = document.getElementById('memb-nuevo-tipo-input');

    tipoSelect.addEventListener('change', () => {
      if (tipoSelect.value === '__NEW__') {
        groupNuevoTipo.style.display = 'block';
        inputNuevoTipo.focus();
      } else {
        groupNuevoTipo.style.display = 'none';
      }
    });

    const itemsContainer = document.getElementById('memb-items-container');

    function renderWineRow(itemData = { articuloId: sortedArts[0].id, cantidad: 1 }) {
      const rowId = 'item-row-' + Math.random().toString(36).substring(2, 9);
      const artOptions = sortedArts.map(a => `
        <option value="${a.id}" ${String(itemData.articuloId) === String(a.id) ? 'selected' : ''}>
          ${a.bodega} - ${a.etiqueta} (${a.cepa})
        </option>
      `).join('');

      const rowDiv = document.createElement('div');
      rowDiv.className = 'memb-item-row';
      rowDiv.id = rowId;
      rowDiv.innerHTML = `
        <select class="form-control item-articulo-select" required>
          ${artOptions}
        </select>
        <input type="number" class="form-control item-cantidad-input" min="1" value="${itemData.cantidad || 1}" required placeholder="Cant.">
        <button type="button" class="btn btn-ghost btn-sm btn-icon text-rose btn-remove-item" title="Quitar vino">
          <i data-lucide="trash-2"></i>
        </button>
      `;

      itemsContainer.appendChild(rowDiv);
      requestAnimationFrame(() => { if (window.lucide) window.lucide.createIcons({ scope: rowDiv }); });

      rowDiv.querySelector('.btn-remove-item').addEventListener('click', () => {
        if (itemsContainer.children.length > 1) {
          rowDiv.remove();
        } else {
          showToast('La membresía debe incluir al menos un vino', 'error');
        }
      });
    }

    initialItems.forEach(item => renderWineRow(item));

    document.getElementById('btn-add-wine-row').addEventListener('click', () => {
      renderWineRow();
    });

    function getFormItems() {
      const rows = Array.from(itemsContainer.querySelectorAll('.memb-item-row'));
      return rows.map(r => ({
        articuloId: r.querySelector('.item-articulo-select').value,
        cantidad: parseInt(r.querySelector('.item-cantidad-input').value, 10) || 1
      }));
    }

    document.getElementById('form-membresia').addEventListener('submit', (e) => {
      e.preventDefault();
      let tipo = tipoSelect.value;
      if (tipo === '__NEW__') {
        tipo = inputNuevoTipo.value.trim();
        if (!tipo) {
          showToast('Por favor ingrese el nombre del nuevo tipo de membresía', 'error');
          return;
        }
      }

      const codigo = document.getElementById('memb-codigo').value.trim();
      const descripcion = document.getElementById('memb-descripcion').value.trim();
      const fechaDesde = document.getElementById('memb-desde').value;
      const fechaHasta = document.getElementById('memb-hasta').value;
      const precio = parseFloat(document.getElementById('memb-precio').value) || 0;
      const items = getFormItems();

      if (items.length === 0) {
        showToast('Debe incluir al menos un vino en la membresía', 'error');
        return;
      }

      if (isEdit) {
        memb.tipo = tipo;
        memb.codigo = codigo;
        memb.descripcion = descripcion;
        memb.items = items;
        memb.fechaDesde = fechaDesde;
        memb.fechaHasta = fechaHasta;
        memb.precio = precio;
        delete memb.articuloId;
        delete memb.cantidad;
        logAuditoria('Membresías', 'Edición de Membresía', `Se actualizó la membresía [${tipo}] ${codigo} - ${descripcion} (Precio: $${precio})`);
        showToast('Membresía actualizada', 'success');
      } else {
        state.membresias.push({
          id: generateUniqueId('memb'),
          tipo,
          codigo,
          descripcion,
          items,
          fechaDesde,
          fechaHasta,
          precio
        });
        logAuditoria('Membresías', 'Alta de Membresía', `Se creó la membresía [${tipo}] ${codigo} - ${descripcion} (Precio: $${precio})`);
        showToast('Membresía creada exitosamente', 'success');
      }

      saveState();
      closeModal();
      renderAllViews();
    });
  };

  window.editMembresia = function (id) { window.openMembresiaForm(id); };
  window.deleteMembresia = function (id) {
    const memb = state.membresias.find(m => String(m.id) === String(id));
    if (confirm('¿Desea eliminar esta membresía?')) {
      state.membresias = state.membresias.filter(m => String(m.id) !== String(id));
      logAuditoria('Membresías', 'Eliminación de Membresía', `Se eliminó la membresía ${memb ? memb.codigo : id}`);
      saveState();
      renderAllViews();
      showToast('Membresía eliminada', 'success');
    }
  };

  // 4. CLIENTES FORM (CON SELECCIÓN POR TIPO / CÓDIGO DE MEMBRESÍA)
  window.openClienteForm = function (clienteId = null) {
    const cli = clienteId ? state.clientes.find(c => String(c.id) === String(clienteId)) : null;
    const isEdit = !!cli;

    const membOptions = state.membresias.map(m => `
      <option value="${m.id}" data-tipo="${m.tipo || 'Selección'}" ${isEdit && String(cli.membresiaId) === String(m.id) ? 'selected' : ''}>
        [${m.tipo || 'Selección'}] ${m.codigo} - ${m.descripcion} (${formatCurrency(m.precio || 0)})
      </option>
    `).join('');

    const entregasCount = isEdit ? getClienteEntregasCount(cli.id) : 0;

    const html = `
      <form id="form-cliente">
        <div class="form-row">
          <div class="form-group">
            <label>Nombre *</label>
            <input type="text" id="cli-nombre" class="form-control" value="${isEdit ? cli.nombre : ''}" required placeholder="Ej: Sebastián">
          </div>
          <div class="form-group">
            <label>Apellido *</label>
            <input type="text" id="cli-apellido" class="form-control" value="${isEdit ? cli.apellido : ''}" required placeholder="Ej: Gómez">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Número de Teléfono *</label>
            <input type="text" id="cli-telefono" class="form-control" value="${isEdit ? cli.telefono || '' : ''}" required placeholder="+54 9 261 ...">
          </div>
          <div class="form-group">
            <label>Provincia *</label>
            <input type="text" id="cli-provincia" class="form-control" value="${isEdit ? cli.provincia || '' : 'Mendoza'}" required placeholder="Ej: Mendoza">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Localidad *</label>
            <input type="text" id="cli-localidad" class="form-control" value="${isEdit ? cli.localidad || '' : ''}" required placeholder="Ej: Luján de Cuyo">
          </div>
          <div class="form-group">
            <label>Dirección *</label>
            <input type="text" id="cli-direccion" class="form-control" value="${isEdit ? cli.direccion || '' : ''}" required placeholder="Ej: Av. San Martín 1420">
          </div>
        </div>

        <div class="form-group">
          <label>Membresía Asignada (Selección / Élite / Personalizadas) *</label>
          <select id="cli-membresia" class="form-control" required>
            <option value="">-- Seleccionar Membresía --</option>
            ${membOptions}
          </select>
        </div>

        <div class="form-group">
          <label>Cantidad de Entregas Históricas <span class="badge-info">NO EDITABLE</span></label>
          <input type="text" class="form-control" value="${entregasCount} botellas entregadas históricamente" readonly>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar Cambios' : 'Crear Cliente'}</button>
        </div>
      </form>
    `;

    openModal(isEdit ? 'Editar Cliente' : 'Nuevo Cliente', html);

    document.getElementById('form-cliente').addEventListener('submit', (e) => {
      e.preventDefault();
      const nombre = document.getElementById('cli-nombre').value.trim();
      const apellido = document.getElementById('cli-apellido').value.trim();
      const telefono = document.getElementById('cli-telefono').value.trim();
      const provincia = document.getElementById('cli-provincia').value.trim();
      const localidad = document.getElementById('cli-localidad').value.trim();
      const direccion = document.getElementById('cli-direccion').value.trim();
      const membresiaId = document.getElementById('cli-membresia').value;

      if (isEdit) {
        cli.nombre = nombre;
        cli.apellido = apellido;
        cli.telefono = telefono;
        cli.provincia = provincia;
        cli.localidad = localidad;
        cli.direccion = direccion;
        cli.membresiaId = membresiaId;
        logAuditoria('Clientes', 'Edición de Cliente', `Se actualizó el cliente ${nombre} ${apellido}`);
        showToast('Cliente actualizado', 'success');
      } else {
        state.clientes.push({
          id: generateUniqueId('cli'),
          nombre,
          apellido,
          telefono,
          provincia,
          localidad,
          direccion,
          membresiaId
        });
        logAuditoria('Clientes', 'Alta de Cliente', `Se registró al cliente ${nombre} ${apellido}`);
        showToast('Cliente registrado exitosamente', 'success');
      }

      saveState();
      closeModal();
      renderAllViews();
    });
  };

  window.editCliente = function (id) { window.openClienteForm(id); };
  window.deleteCliente = function (id) {
    const cli = state.clientes.find(c => String(c.id) === String(id));
    if (confirm('¿Desea eliminar este cliente?')) {
      state.clientes = state.clientes.filter(c => String(c.id) !== String(id));
      logAuditoria('Clientes', 'Eliminación de Cliente', `Se eliminó al cliente ${cli ? cli.nombre + ' ' + cli.apellido : id}`);
      saveState();
      renderAllViews();
      showToast('Cliente eliminado', 'success');
    }
  };

  // 5. ENTRADAS FORM (CON DESPLEGABLE ORDENADO ALFABÉTICAMENTE)
  window.openEntradaForm = function () {
    if (state.articulos.length === 0) {
      showToast('Primero debe crear al menos un artículo', 'error');
      return;
    }

    const lastNum = state.entradas.reduce((max, e) => Math.max(max, Number(e.numeroCompra) || 0), 0);
    const nextNumeroCompra = lastNum + 1;

    const sortedArts = getSortedArticulos();
    const artOptions = sortedArts.map(a => `
      <option value="${a.id}">${a.bodega} - ${a.etiqueta}</option>
    `).join('');

    const todayStr = new Date().toISOString().split('T')[0];

    const html = `
      <form id="form-entrada">
        <div class="form-row">
          <div class="form-group">
            <label>Número de Compra <span class="badge-info">AUTO</span></label>
            <input type="number" id="ent-num-compra" class="form-control" value="${nextNumeroCompra}" readonly>
          </div>
          <div class="form-group">
            <label>Fecha de Compra *</label>
            <input type="date" id="ent-fecha" class="form-control" value="${todayStr}" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Artículo (Vino) * <small class="text-muted">(Ordenados por Bodega y Etiqueta)</small></label>
            <select id="ent-articulo" class="form-control" required>
              <option value="">-- Seleccionar Vino --</option>
              ${artOptions}
            </select>
          </div>
          <div class="form-group">
            <label>Cepa</label>
            <input type="text" id="ent-cepa" class="form-control" readonly placeholder="Se autocompleta con el artículo">
          </div>
        </div>
        <div class="form-group">
          <label>Proveedor Autorizado * <small class="text-muted">(Se valida que venda el producto)</small></label>
          <select id="ent-proveedor" class="form-control" required disabled>
            <option value="">-- Seleccione primero un artículo --</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Cantidad de Cajas *</label>
            <input type="number" id="ent-cajas" class="form-control" min="1" value="1" required>
          </div>
          <div class="form-group">
            <label>Unidades Sumadas (Cajas x UxB)</label>
            <input type="text" id="ent-unidades-calc" class="form-control" readonly value="0 botellas">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Precio por Caja ($) *</label>
            <input type="number" id="ent-precio-caja" class="form-control" min="0" step="100" value="12000" required placeholder="Ej: 12000">
          </div>
          <div class="form-group">
            <label>Costo Adicional por Caja ($) <small class="text-muted">(Flete/Envío/Impuesto por caja)</small></label>
            <input type="number" id="ent-costo-adic" class="form-control" min="0" step="50" value="600" placeholder="Ej: 600">
          </div>
        </div>
        <div class="form-group">
          <label>Costo Resultante por Botella [(Precio Caja + Costo Adic.) / UxB]</label>
          <input type="text" id="ent-costo-botella-calc" class="form-control" readonly value="$0.00" style="font-weight:bold; font-size:1.05rem">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Registrar Compra e Incrementar Stock</button>
        </div>
      </form>
    `;

    openModal('Nueva Entrada / Compra de Vino', html);

    const artSelect = document.getElementById('ent-articulo');
    const cepaInput = document.getElementById('ent-cepa');
    const provSelect = document.getElementById('ent-proveedor');
    const cajasInput = document.getElementById('ent-cajas');
    const precioInput = document.getElementById('ent-precio-caja');
    const adicInput = document.getElementById('ent-costo-adic');
    const unCalcInput = document.getElementById('ent-unidades-calc');
    const unitCalcInput = document.getElementById('ent-costo-botella-calc');

    function updateArtInfo() {
      const artId = artSelect.value;
      const art = state.articulos.find(a => String(a.id) === String(artId));

      if (art) {
        cepaInput.value = art.cepa;
        const allowedProvs = state.proveedores.filter(p => (art.proveedoresIds || []).includes(String(p.id)));

        if (allowedProvs.length > 0) {
          provSelect.innerHTML = allowedProvs.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
          provSelect.disabled = false;
        } else {
          provSelect.innerHTML = `<option value="">Sin proveedores asignados a este artículo</option>`;
          provSelect.disabled = true;
        }

        const cajas = Number(cajasInput.value) || 0;
        const uxb = Number(art.uxb) || 1;
        unCalcInput.value = `${cajas * uxb} botellas (${uxb} uxb)`;

        const precioCaja = Number(precioInput.value) || 0;
        const adicCaja = Number(adicInput.value) || 0;
        const unitCost = (precioCaja + adicCaja) / uxb;
        unitCalcInput.value = `${formatCurrency(unitCost)} / botella`;

      } else {
        cepaInput.value = '';
        provSelect.innerHTML = `<option value="">-- Seleccione primero un artículo --</option>`;
        provSelect.disabled = true;
        unCalcInput.value = '0 botellas';
        unitCalcInput.value = '$0.00 / botella';
      }
    }

    artSelect.addEventListener('change', updateArtInfo);
    cajasInput.addEventListener('input', updateArtInfo);
    precioInput.addEventListener('input', updateArtInfo);
    adicInput.addEventListener('input', updateArtInfo);

    document.getElementById('form-entrada').addEventListener('submit', (e) => {
      e.preventDefault();
      const articuloId = artSelect.value;
      const proveedorId = provSelect.value;
      const cantidadCajas = parseInt(cajasInput.value, 10) || 0;
      const precioCaja = parseFloat(precioInput.value) || 0;
      const costoAdicionalCaja = parseFloat(adicInput.value) || 0;
      const fecha = document.getElementById('ent-fecha').value;

      const art = state.articulos.find(a => String(a.id) === String(articuloId));
      const prov = state.proveedores.find(p => String(p.id) === String(proveedorId));

      if (!art) {
        showToast('Seleccione un artículo válido', 'error');
        return;
      }

      if (!proveedorId || provSelect.disabled) {
        showToast('Debe seleccionar un proveedor autorizado para el artículo', 'error');
        return;
      }

      const uxb = Number(art.uxb) || 1;
      const unidadesSumadas = cantidadCajas * uxb;

      state.entradas.push({
        id: generateUniqueId('ent'),
        numeroCompra: nextNumeroCompra,
        articuloId,
        cepa: art.cepa,
        proveedorId,
        cantidadCajas,
        unidadesSumadas,
        precioCaja,
        costoAdicionalCaja,
        fecha
      });

      logAuditoria('Entradas', 'Registro de Compra', `Compra #${nextNumeroCompra}: ${cantidadCajas} cajas (${unidadesSumadas} botellas) de ${art.bodega} ${art.etiqueta} a ${prov ? prov.nombre : 'Proveedor'}`);

      saveState();
      closeModal();
      renderAllViews();
      showToast(`Entrada registrada (#${nextNumeroCompra}). +${unidadesSumadas} botellas agregadas al stock!`, 'success');
    });
  };

  // 6. SALIDAS FORM (CON DESPLEGABLE ORDENADO ALFABÉTICAMENTE POR BODEGA Y ETIQUETA)
  window.openSalidaForm = function () {
    if (state.clientes.length === 0) {
      showToast('Primero debe registrar al menos un cliente en CLIENTES', 'error');
      return;
    }

    if (state.articulos.length === 0) {
      showToast('No hay artículos disponibles para venta', 'error');
      return;
    }

    const cliOptions = state.clientes.map(c => `
      <option value="${c.id}">${c.nombre} ${c.apellido}</option>
    `).join('');

    const todayStr = new Date().toISOString().split('T')[0];

    const html = `
      <form id="form-salida">
        <div class="form-row">
          <div class="form-group">
            <label>Cliente *</label>
            <select id="sal-cliente" class="form-control" required>
              <option value="">-- Seleccionar Cliente --</option>
              ${cliOptions}
            </select>
          </div>
          <div class="form-group">
            <label>Fecha de Venta *</label>
            <input type="date" id="sal-fecha" class="form-control" value="${todayStr}" required>
          </div>
        </div>

        <div class="form-group">
          <label>Tipo de Venta *</label>
          <div style="display:flex; gap:1.5rem; margin-top:0.3rem">
            <label class="checkbox-label">
              <input type="radio" name="tipoVenta" value="BOTELLA" checked>
              <span>Venta por Botella</span>
            </label>
            <label class="checkbox-label">
              <input type="radio" name="tipoVenta" value="MEMBRESIA">
              <span>Venta por Membresía</span>
            </label>
          </div>
        </div>

        <div id="sec-salida-botella">
          <div class="form-row">
            <div class="form-group">
              <label>Artículo / Vino en Stock * <small class="text-muted">(Ordenados por Bodega y Etiqueta)</small></label>
              <select id="sal-articulo" class="form-control">
                <option value="">-- Seleccionar Vino --</option>
              </select>
            </div>
            <div class="form-group">
              <label>Cantidad (botellas) *</label>
              <input type="number" id="sal-cantidad" class="form-control" min="1" value="1">
            </div>
          </div>
        </div>

        <div id="sec-salida-membresia" style="display:none">
          <div class="form-group">
            <label>Membresía Vigente Seleccionada *</label>
            <select id="sal-membresia" class="form-control"></select>
          </div>
          <div class="form-group">
            <label>Detalle de Vinos y Botellas de la Membresía</label>
            <div id="sal-membresia-info" style="padding:0.75rem; background:rgba(0,0,0,0.3); border-radius:var(--radius-md); font-size:0.85rem; border:1px solid var(--border-color)">
              Seleccione una membresía
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Registrar Venta / Descontar Stock</button>
        </div>
      </form>
    `;

    openModal('Nueva Salida / Entrega de Vino', html);

    const cliSelect = document.getElementById('sal-cliente');
    const radiosTipo = document.getElementsByName('tipoVenta');
    const secBotella = document.getElementById('sec-salida-botella');
    const secMembresia = document.getElementById('sec-salida-membresia');

    const artSelect = document.getElementById('sal-articulo');
    const membSelect = document.getElementById('sal-membresia');
    const membInfoDiv = document.getElementById('sal-membresia-info');

    const sortedArts = getSortedArticulos();

    artSelect.innerHTML = sortedArts.map(a => {
      const stock = getArticuloMetrics(a.id).stock;
      return `<option value="${a.id}">${a.bodega} - ${a.etiqueta} (${a.cepa}) [Stock: ${stock} bot.]</option>`;
    }).join('');

    function updateMembresiaOptions() {
      const cliId = cliSelect.value;
      const cli = state.clientes.find(c => String(c.id) === String(cliId));
      const today = document.getElementById('sal-fecha').value;

      const vigentes = state.membresias.filter(m => isMembresiaVigente(m, today));

      if (vigentes.length === 0) {
        membSelect.innerHTML = `<option value="">No hay membresías vigentes a la fecha</option>`;
        membInfoDiv.innerHTML = '<span class="text-rose">Sin membresías activas en el rango de fechas</span>';
        return;
      }

      membSelect.innerHTML = vigentes.map(m => {
        const isClientDefault = cli && String(cli.membresiaId) === String(m.id);
        return `
          <option value="${m.id}" ${isClientDefault ? 'selected' : ''}>
            [${m.tipo || 'Selección'}] ${m.codigo} - ${m.descripcion} (${formatCurrency(m.precio || 0)}) ${isClientDefault ? '(Asignada al cliente)' : ''}
          </option>
        `;
      }).join('');

      onMembresiaChange();
    }

    function onMembresiaChange() {
      const membId = membSelect.value;
      const memb = state.membresias.find(m => String(m.id) === String(membId));
      if (memb) {
        const calc = getMembresiaCalculations(memb);
        const wineList = calc.items.map(i => {
          const art = state.articulos.find(a => String(a.id) === String(i.articuloId));
          const artStock = art ? getArticuloMetrics(art.id).stock : 0;
          const artName = art ? `${art.bodega} ${art.etiqueta}` : 'Vino';
          const stockColor = artStock >= i.cantidad ? 'var(--emerald)' : 'var(--rose)';
          return `<li><strong>${i.cantidad}x ${artName}</strong> (Stock disponible: <span style="color:${stockColor}">${artStock} bot.</span>)</li>`;
        }).join('');

        membInfoDiv.innerHTML = `
          <div style="margin-bottom:0.4rem"><strong>Tipo: ${memb.tipo || 'Selección'} | Precio: ${formatCurrency(memb.precio || 0)} | Total botellas: ${calc.totalBotellas}</strong></div>
          <ul style="padding-left:1.2rem; margin:0">${wineList}</ul>
        `;
      } else {
        membInfoDiv.innerHTML = 'Seleccione una membresía';
      }
    }

    cliSelect.addEventListener('change', updateMembresiaOptions);
    membSelect.addEventListener('change', onMembresiaChange);
    document.getElementById('sal-fecha').addEventListener('change', updateMembresiaOptions);

    Array.from(radiosTipo).forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.value === 'MEMBRESIA') {
          secBotella.style.display = 'none';
          secMembresia.style.display = 'block';
          updateMembresiaOptions();
        } else {
          secBotella.style.display = 'block';
          secMembresia.style.display = 'none';
        }
      });
    });

    document.getElementById('form-salida').addEventListener('submit', (e) => {
      e.preventDefault();
      const clienteId = cliSelect.value;
      const fecha = document.getElementById('sal-fecha').value;
      const tipoVenta = document.querySelector('input[name="tipoVenta"]:checked').value;
      const cli = state.clientes.find(c => String(c.id) === String(clienteId));

      if (!clienteId) {
        showToast('Seleccione un cliente', 'error');
        return;
      }

      if (tipoVenta === 'BOTELLA') {
        const articuloId = artSelect.value;
        const cantidadBotellas = parseInt(document.getElementById('sal-cantidad').value, 10) || 0;
        const art = state.articulos.find(a => String(a.id) === String(articuloId));

        if (!articuloId) {
          showToast('Seleccione un vino', 'error');
          return;
        }
        if (cantidadBotellas <= 0) {
          showToast('La cantidad debe ser mayor a 0', 'error');
          return;
        }

        const metrics = getArticuloMetrics(articuloId);
        if (metrics.stock < cantidadBotellas) {
          showToast(`Stock insuficiente. Disponible: ${metrics.stock} bot. Requerido: ${cantidadBotellas} bot.`, 'error');
          return;
        }

        state.salidas.push({
          id: generateUniqueId('sal'),
          fecha,
          clienteId,
          tipoVenta: 'BOTELLA',
          articuloId,
          cantidadBotellas
        });

        logAuditoria('Salidas', 'Venta por Botella', `Venta de ${cantidadBotellas} botellas de ${art ? art.bodega + ' ' + art.etiqueta : 'Vino'} a cliente ${cli ? cli.nombre + ' ' + cli.apellido : 'Cliente'}`);

        showToast(`Venta por botella registrada. ${cantidadBotellas} botellas descontadas del stock.`, 'success');

      } else {
        const membresiaId = membSelect.value;
        const memb = state.membresias.find(m => String(m.id) === String(membresiaId));

        if (!memb) {
          showToast('Seleccione una membresía vigente válida', 'error');
          return;
        }

        const calc = getMembresiaCalculations(memb);

        for (const item of calc.items) {
          const metrics = getArticuloMetrics(item.articuloId);
          if (metrics.stock < item.cantidad) {
            const art = state.articulos.find(a => String(a.id) === String(item.articuloId));
            const artName = art ? `${art.bodega} ${art.etiqueta}` : 'Vino';
            showToast(`Stock insuficiente para ${artName}. Requerido: ${item.cantidad} bot., Disponible: ${metrics.stock} bot.`, 'error');
            return;
          }
        }

        const transactionGroupId = Date.now().toString();
        calc.items.forEach((item, idx) => {
          state.salidas.push({
            id: generateUniqueId(`sal-${transactionGroupId}`),
            fecha,
            clienteId,
            tipoVenta: 'MEMBRESIA',
            articuloId: item.articuloId,
            membresiaId: memb.id,
            cantidadBotellas: item.cantidad,
            detalle: `[${memb.tipo || 'Selección'} - ${memb.codigo}] ${memb.descripcion}`
          });
        });

        logAuditoria('Salidas', 'Venta por Membresía', `Venta de Membresía ${memb.tipo} ${memb.codigo} (${calc.totalBotellas} botellas) a cliente ${cli ? cli.nombre + ' ' + cli.apellido : 'Cliente'}`);

        showToast(`Venta por Membresía registrada. ${calc.totalBotellas} botellas entregadas y descontadas!`, 'success');
      }

      saveState();
      closeModal();
      renderAllViews();
    });
  };

  window.deleteSalida = function (id) {
    const s = state.salidas.find(sal => String(sal.id) === String(id));
    if (confirm('¿Desea eliminar esta venta? El stock correspondiente se devolverá a la cava.')) {
      state.salidas = state.salidas.filter(sal => String(sal.id) !== String(id));
      logAuditoria('Salidas', 'Eliminación de Venta', `Se anuló la venta de ${s ? s.cantidadBotellas + ' botellas' : id} y se restauró el stock`);
      saveState();
      renderAllViews();
      showToast('Venta eliminada. Stock actualizado.', 'success');
    }
  };

  // --- SMART CSV PARSER ENGINE ---

  function smartParseCSV(text) {
    text = text.replace(/^\uFEFF/, '').trim();
    if (!text) return [];

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return [];

    const firstLine = lines[0];
    let delimiter = ',';
    const semiCount = (firstLine.match(/;/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    const tabCount = (firstLine.match(/\t/g) || []).length;

    if (semiCount > commaCount && semiCount >= tabCount) {
      delimiter = ';';
    } else if (tabCount > commaCount && tabCount > semiCount) {
      delimiter = '\t';
    }

    function splitLine(line) {
      const values = [];
      let currentVal = '';
      let insideQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          insideQuotes = !insideQuotes;
        } else if (char === delimiter && !insideQuotes) {
          values.push(currentVal.trim().replace(/^"|"$/g, ''));
          currentVal = '';
        } else {
          currentVal += char;
        }
      }
      values.push(currentVal.trim().replace(/^"|"$/g, ''));
      return values;
    }

    const rawHeaders = splitLine(lines[0]);
    const normalizedHeaders = rawHeaders.map(h => 
      h.toLowerCase()
       .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
       .replace(/[^a-z0-9]/g, '')
    );

    const knownKeys = ['nombre', 'proveedor', 'bodega', 'etiqueta', 'cepa', 'telefono', 'email', 'cliente', 'apellido', 'uxb', 'precio', 'cajas', 'tipo', 'membresia'];
    const hasHeader = normalizedHeaders.some(h => knownKeys.includes(h));

    const rows = [];
    const startIndex = hasHeader ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const vals = splitLine(lines[i]);
      if (vals.length === 0 || (vals.length === 1 && !vals[0])) continue;

      const rowObj = {};
      if (hasHeader) {
        normalizedHeaders.forEach((h, idx) => {
          rowObj[h] = vals[idx] || '';
        });
      }
      rowObj._raw = vals;
      rows.push(rowObj);
    }

    return rows;
  }

  function getOrCreateSupplierByName(provName) {
    if (!provName || !provName.trim()) return null;
    const cleanName = provName.trim();
    
    let match = state.proveedores.find(p => p.nombre.toLowerCase().trim() === cleanName.toLowerCase());
    if (!match) {
      match = state.proveedores.find(p => p.nombre.toLowerCase().includes(cleanName.toLowerCase()) || cleanName.toLowerCase().includes(p.nombre.toLowerCase()));
    }

    if (!match) {
      const newProv = {
        id: generateUniqueId('prov'),
        nombre: cleanName,
        telefono: '',
        email: ''
      };
      state.proveedores.push(newProv);
      logAuditoria('Proveedores', 'Alta Automática por CSV', `Se registró al proveedor ${cleanName} al procesar artículos`);
      return newProv;
    }

    return match;
  }

  // 1. CSV Import Proveedores
  document.getElementById('csv-proveedores-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (evt) {
      try {
        const rows = smartParseCSV(evt.target.result);
        let count = 0;

        rows.forEach(r => {
          const nombre = r.nombre || r.proveedor || r.razonsocial || r.empresa || (r._raw ? r._raw[0] : '');
          const telefono = r.telefono || r.tel || r.celular || (r._raw ? r._raw[1] : '');
          const email = r.email || r.mail || r.correo || (r._raw ? r._raw[2] : '');

          if (nombre && nombre.trim().length > 0) {
            getOrCreateSupplierByName(nombre.trim());
            const prov = state.proveedores.find(p => p.nombre.toLowerCase().trim() === nombre.trim().toLowerCase());
            if (prov) {
              if (telefono) prov.telefono = telefono.trim();
              if (email) prov.email = email.trim();
            }
            count++;
          }
        });

        if (count > 0) {
          logAuditoria('Proveedores', 'Importación Masiva CSV', `Se cargaron ${count} proveedores desde archivo CSV`);
          saveState();
          renderAllViews();
          showToast(`Importación exitosa: ${count} proveedores cargados/actualizados`, 'success');
        } else {
          showToast('No se pudieron encontrar filas válidas de proveedores', 'error');
        }
      } catch (err) {
        showToast('Error procesando el archivo CSV de proveedores', 'error');
      }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  });

  // 2. CSV Import Artículos (Multi-Supplier Association)
  document.getElementById('csv-articulos-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (evt) {
      try {
        const rows = smartParseCSV(evt.target.result);
        let rowsProcessedCount = 0;

        rows.forEach(r => {
          const bodega = r.bodega || (r._raw ? r._raw[0] : '');
          const etiqueta = r.etiqueta || r.marca || (r._raw ? r._raw[1] : '');
          const cepa = r.cepa || r.varietal || (r._raw ? r._raw[2] : 'Varietal');
          const uxb = parseInt(r.uxb || r.bulto || (r._raw ? r._raw[3] : 6), 10) || 6;
          const provsRaw = r.proveedores || r.proveedor || (r._raw ? r._raw[4] : '');

          if (bodega && etiqueta) {
            rowsProcessedCount++;

            const provNames = provsRaw ? provsRaw.split(/[|;]/).map(n => n.trim()).filter(Boolean) : [];
            const provIds = [];

            provNames.forEach(name => {
              const prov = getOrCreateSupplierByName(name);
              if (prov && !provIds.includes(prov.id)) {
                provIds.push(prov.id);
              }
            });

            let existingArt = state.articulos.find(a => 
              a.bodega.toLowerCase().trim() === bodega.toLowerCase().trim() &&
              a.etiqueta.toLowerCase().trim() === etiqueta.toLowerCase().trim() &&
              a.cepa.toLowerCase().trim() === cepa.toLowerCase().trim()
            );

            if (existingArt) {
              provIds.forEach(pid => {
                if (!(existingArt.proveedoresIds || []).includes(pid)) {
                  existingArt.proveedoresIds.push(pid);
                }
              });
              if (uxb) existingArt.uxb = uxb;
              if (cepa && cepa !== 'Varietal') existingArt.cepa = cepa;
            } else {
              const newArt = {
                id: generateUniqueId('art'),
                bodega: bodega.trim(),
                etiqueta: etiqueta.trim(),
                cepa: cepa.trim(),
                uxb: uxb,
                proveedoresIds: provIds
              };
              state.articulos.push(newArt);
            }
          }
        });

        if (rowsProcessedCount > 0) {
          logAuditoria('Artículos', 'Importación Masiva CSV', `Procesadas ${rowsProcessedCount} filas de artículos con asociación a ArticuloProveedores`);
          saveState();
          renderAllViews();
          showToast(`Importación exitosa: ${rowsProcessedCount} filas procesadas (${state.articulos.length} artículos en catálogo)`, 'success');
        } else {
          showToast('No se encontraron artículos válidos en el archivo', 'error');
        }
      } catch (err) {
        showToast('Error procesando el archivo CSV de artículos', 'error');
      }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  });

  // 3. CSV Import Clientes (Soporta matching por Tipo de Membresía: Selección / Élite)
  document.getElementById('csv-clientes-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (evt) {
      try {
        const rows = smartParseCSV(evt.target.result);
        let count = 0;

        rows.forEach(r => {
          const nombre = r.nombre || (r._raw ? r._raw[0] : '');
          const apellido = r.apellido || (r._raw ? r._raw[1] : '');
          const telefono = r.telefono || r.tel || (r._raw ? r._raw[2] : '');
          const provincia = r.provincia || (r._raw ? r._raw[3] : '');
          const localidad = r.localidad || (r._raw ? r._raw[4] : '');
          const direccion = r.direccion || (r._raw ? r._raw[5] : '');
          const membVal = (r.tipomembresia || r.membresia || r.tipo || (r._raw ? r._raw[6] : '')).trim();

          if (nombre && apellido) {
            let memb = null;

            if (membVal) {
              const cleanVal = membVal.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

              // 1. Coincidencia por Tipo de Membresía (Élite / Selección / etc.)
              memb = state.membresias.find(m => {
                const normTipo = (m.tipo || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                return normTipo === cleanVal;
              });

              // 2. Coincidencia por Código de membresía
              if (!memb) {
                memb = state.membresias.find(m => m.codigo.toLowerCase().trim() === membVal.toLowerCase());
              }

              // 3. Coincidencia por Descripción
              if (!memb) {
                memb = state.membresias.find(m => {
                  const normDesc = (m.descripcion || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                  return normDesc.includes(cleanVal);
                });
              }
            }

            state.clientes.push({
              id: generateUniqueId('cli'),
              nombre: nombre.trim(),
              apellido: apellido.trim(),
              telefono: telefono.trim(),
              provincia: provincia.trim(),
              localidad: localidad.trim(),
              direccion: direccion.trim(),
              membresiaId: memb ? memb.id : ''
            });
            count++;
          }
        });

        if (count > 0) {
          logAuditoria('Clientes', 'Importación Masiva CSV', `Se importaron ${count} clientes asignando tipo/código de membresía`);
          saveState();
          renderAllViews();
          showToast(`Importación exitosa: ${count} clientes cargados desde CSV`, 'success');
        } else {
          showToast('No se encontraron clientes válidos en el archivo', 'error');
        }
      } catch (err) {
        showToast('Error procesando el archivo CSV de clientes', 'error');
      }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  });

  // 4. CSV Import Entradas / Compras
  document.getElementById('csv-entradas-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (evt) {
      try {
        const rows = smartParseCSV(evt.target.result);
        let count = 0;

        rows.forEach(r => {
          const bodega = r.bodega || (r._raw ? r._raw[0] : '');
          const etiqueta = r.etiqueta || (r._raw ? r._raw[1] : '');
          const provNombre = r.nombreproveedor || r.proveedor || (r._raw ? r._raw[2] : '');
          const cajas = parseInt(r.cantidadcajas || r.cajas || (r._raw ? r._raw[3] : 1), 10) || 1;
          const precioCaja = parseFloat(r.preciocaja || r.precio || (r._raw ? r._raw[4] : 0)) || 0;
          const costoAdicCaja = parseFloat(r.costoadicionalcaja || r.costoadicional || (r._raw ? r._raw[5] : 0)) || 0;
          const fecha = r.fecha || (r._raw ? r._raw[6] : '') || new Date().toISOString().split('T')[0];

          const art = state.articulos.find(a => 
            a.bodega.toLowerCase().trim().includes(bodega.toLowerCase().trim()) &&
            a.etiqueta.toLowerCase().trim().includes(etiqueta.toLowerCase().trim())
          );

          let prov = state.proveedores.find(p => p.nombre.toLowerCase().includes(provNombre.toLowerCase()));
          if (!prov && provNombre) {
            prov = getOrCreateSupplierByName(provNombre);
          }

          if (art && prov) {
            const lastNum = state.entradas.reduce((max, ent) => Math.max(max, Number(ent.numeroCompra) || 0), 0);
            const uxb = Number(art.uxb) || 1;

            state.entradas.push({
              id: generateUniqueId('ent'),
              numeroCompra: lastNum + 1,
              articuloId: art.id,
              cepa: art.cepa,
              proveedorId: prov.id,
              cantidadCajas: cajas,
              unidadesSumadas: cajas * uxb,
              precioCaja: precioCaja,
              costoAdicionalCaja: costoAdicCaja,
              fecha: fecha
            });
            count++;
          }
        });

        if (count > 0) {
          logAuditoria('Entradas', 'Importación Masiva CSV', `Se cargaron ${count} compras de stock desde CSV`);
          saveState();
          renderAllViews();
          showToast(`Importación exitosa: ${count} compras registradas desde CSV`, 'success');
        } else {
          showToast('No se pudieron emparejar las compras con artículos y proveedores existentes', 'error');
        }
      } catch (err) {
        showToast('Error procesando el archivo CSV de compras', 'error');
      }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  });

  // --- LOGIN & REGISTER EVENT LISTENERS ---
  const tabLoginBtn = document.getElementById('tab-login-btn');
  const tabRegisterBtn = document.getElementById('tab-register-btn');
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');

  tabLoginBtn.addEventListener('click', () => {
    tabLoginBtn.classList.add('active');
    tabRegisterBtn.classList.remove('active');
    formLogin.style.display = 'block';
    formRegister.style.display = 'none';
  });

  tabRegisterBtn.addEventListener('click', () => {
    tabRegisterBtn.classList.add('active');
    tabLoginBtn.classList.remove('active');
    formRegister.style.display = 'block';
    formLogin.style.display = 'none';
  });

  const btnLoginSubmit = document.getElementById('btn-login-submit');
  if (btnLoginSubmit) {
    btnLoginSubmit.addEventListener('click', performLogin);
  }

  const btnRegisterSubmit = document.getElementById('btn-register-submit');
  if (btnRegisterSubmit) {
    btnRegisterSubmit.addEventListener('click', performRegister);
  }

  ['login-email', 'login-password'].forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          performLogin();
        }
      });
    }
  });

  ['reg-nombre', 'reg-email', 'reg-password'].forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          performRegister();
        }
      });
    }
  });

  document.getElementById('btn-logout').addEventListener('click', logoutUser);

  // --- UTILS & LISTENERS ---

  function formatCurrency(val) {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(val || 0);
  }

  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <i data-lucide="${type === 'success' ? 'check-circle' : 'alert-circle'}"></i>
      <span>${message}</span>
    `;
    container.appendChild(toast);
    requestAnimationFrame(() => {
      if (window.lucide) window.lucide.createIcons({ scope: toast });
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('btn-add-proveedor').addEventListener('click', () => window.openProveedorForm());
  document.getElementById('btn-add-articulo').addEventListener('click', () => window.openArticuloForm());
  document.getElementById('btn-add-membresia').addEventListener('click', () => window.openMembresiaForm());
  document.getElementById('btn-add-cliente').addEventListener('click', () => window.openClienteForm());
  document.getElementById('btn-add-entrada').addEventListener('click', () => window.openEntradaForm());
  document.getElementById('btn-add-salida').addEventListener('click', () => window.openSalidaForm());

  // Debounced search input filters (150ms delay)
  let searchDebounceTimeout = null;
  ['search-membresias', 'search-proveedores', 'search-clientes', 'search-articulos', 'search-entradas', 'search-stock', 'search-salidas', 'search-auditoria', 'filter-auditoria-modulo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        if (searchDebounceTimeout) clearTimeout(searchDebounceTimeout);
        searchDebounceTimeout = setTimeout(() => {
          renderAllViews();
        }, 150);
      });
      el.addEventListener('change', () => {
        renderAllViews();
      });
    }
  });

  window.closeModal = closeModal;

  // Initialize
  loadState();

})();
