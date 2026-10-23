/**
 * ==========================================================================
 * COTIBOT — Core Frontend Application Logic
 * Product Catalog, Live Search, Client Auth, Discount Engine & Quote Drawer
 * ==========================================================================
 */

const API_BASE = '/api';

// Formato de moneda consistente para tarjetas, carrito y resúmenes (es-UY).
const MONEY_FORMATTER = new Intl.NumberFormat('es-UY', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatMoney(value, currency = 'UYU') {
  const amount = parseFloat(value);
  const isUsd = String(currency).toUpperCase() === 'USD' || currency === 'U$S';
  const symbol = isUsd ? 'U$S' : '$';
  return `${symbol} ${MONEY_FORMATTER.format(Number.isFinite(amount) ? amount : 0)}`;
}

const AppState = {
  cliente: null,
  cart: [],
  products: [],
  categories: [],
  activeCategory: '',
  searchQuery: '',
  activePromoId: null,
  activePromoTitle: '',
  activePromoBadge: '',
  activePromoDiscount: 0,
  currentPage: 1,
  limit: 20,
  totalPages: 1,
  isLoadingProducts: false,
};

// Expose AppState to window for modular scripts (e.g. chatWidget)
window.AppState = AppState;

// ──────────────────────────────────────────────────────────────────────────
// INITIALIZATION
// ──────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initDemoAccounts();
  loadCartFromStorage();
  updateCartBadge();
  await checkClientAuth();
  await loadCategories();
  await loadPromocionesBanner();
  await loadProducts();
  setupEventListeners();
});

function isMaterialListQuery(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (t.includes('\n')) {
    const lines = t.split('\n').filter((l) => l.trim().length > 1);
    if (lines.length >= 2) return true;
  }
  if (t.includes(';') || (t.includes(',') && t.split(',').length >= 3)) {
    return true;
  }
  if (/(?:^|\s)(?:\d+[.)-]|\*|-)\s+/.test(t) && t.split(/\s+/).length >= 4) {
    return true;
  }
  return false;
}

function isConversationalQuery(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim().toLowerCase();
  if (t.includes('?') || t.includes('¿')) return true;
  const conversationalStarters = [
    'hola', 'buenas', 'buenos', 'che', 'consulta', 'pregunta',
    'tenes', 'tenés', 'tienen', 'tendras', 'tendrás', 'hay',
    'preciso', 'necesito', 'busco', 'cuanto', 'cuánto', 'precio',
    'como', 'cómo', 'donde', 'dónde', 'que', 'qué', 'gracias', 'por favor'
  ];
  const firstWord = t.split(/\s+/)[0];
  if (conversationalStarters.includes(firstWord)) return true;
  if (t.split(/\s+/).length > 4) return true;
  return false;
}

function updateSearchInputUI() {
  const input = document.getElementById('heroSearchInput');
  const pill = document.getElementById('heroListDetectionPill');
  const btnText = document.getElementById('btnHeroSearchText');
  if (!input) return;

  // Auto-expand textarea height
  input.style.height = 'auto';
  const newHeight = Math.min(Math.max(input.scrollHeight, 44), 140);
  input.style.height = `${newHeight}px`;

  const val = input.value.trim();
  const isList = isMaterialListQuery(val);

  if (isList) {
    if (pill) pill.style.display = 'inline-flex';
    if (btnText) btnText.textContent = 'Cotizar lista de materiales';
  } else {
    if (pill) pill.style.display = 'none';
    if (btnText) btnText.textContent = 'Cotizar';
  }

  const btnSend = document.getElementById('btnHeroSearch');
  if (btnSend) {
    const hasMedia = window.hasPendingHeroMedia ? window.hasPendingHeroMedia() : false;
    btnSend.classList.toggle('has-content', Boolean(val || hasMedia));
  }
}
window.updateSearchInputUI = updateSearchInputUI;

function executeHeroSearch() {
  const input = document.getElementById('heroSearchInput');
  if (!input) return;
  const val = input.value.trim();
  const hasPendingMedia = window.hasPendingHeroMedia ? window.hasPendingHeroMedia() : false;
  if (!val && !hasPendingMedia) return;

  // El buscador principal actúa directamente como ChatGPT con Cotibot IA
  if (window.submitHeroPrompt) {
    window.submitHeroPrompt(val);
  } else if (window.CotibotChat) {
    window.CotibotChat.sendMessage(val);
  }

  // Solo actualizar el catálogo si es un término de búsqueda concreto (no una pregunta conversacional ni lista)
  if (val && !isMaterialListQuery(val) && !isConversationalQuery(val)) {
    AppState.searchQuery = val;
    AppState.currentPage = 1;
    loadProducts();
  }

  // Limpiar y resetear el prompt box
  input.value = '';
  updateSearchInputUI();
}
window.executeHeroSearch = executeHeroSearch;

function setupEventListeners() {
  // Hero Search input
  const searchInput = document.getElementById('heroSearchInput');
  if (searchInput) {
    let debounceTimer;

    searchInput.addEventListener('input', () => {
      updateSearchInputUI();
      const val = searchInput.value.trim();
      const isList = isMaterialListQuery(val);
      const isConversational = isConversationalQuery(val);

      clearTimeout(debounceTimer);
      // Solo autofiltrar catálogo si es una búsqueda de término de producto (no pregunta ni lista)
      if (!isList && !isConversational && val.length >= 2) {
        debounceTimer = setTimeout(() => {
          AppState.searchQuery = val;
          AppState.currentPage = 1;
          loadProducts();
        }, 500);
      } else if (val.length === 0) {
        debounceTimer = setTimeout(() => {
          if (AppState.searchQuery) {
            AppState.searchQuery = '';
            AppState.currentPage = 1;
            loadProducts();
          }
        }, 300);
      }
    });

    searchInput.addEventListener('paste', () => {
      setTimeout(updateSearchInputUI, 20);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        executeHeroSearch();
      }
    });
  }

  // Hero Search button
  const btnHeroSearch = document.getElementById('btnHeroSearch');
  if (btnHeroSearch) {
    btnHeroSearch.addEventListener('click', executeHeroSearch);
  }

  // Ask Cotibot button in Hero
  const btnAskBotHero = document.getElementById('btnAskBotHero');
  if (btnAskBotHero) {
    btnAskBotHero.addEventListener('click', () => {
      const input = document.getElementById('heroSearchInput');
      const val = input ? input.value.trim() : '';
      if (val) {
        executeHeroSearch();
      } else if (input) {
        input.focus();
      }
    });
  }

  // Quote / Cart Drawer toggles
  const btnQuoteCart = document.getElementById('btnQuoteCart');
  const btnCloseDrawer = document.getElementById('btnCloseDrawer');
  const quoteBackdrop = document.getElementById('quoteDrawerBackdrop');

  if (btnQuoteCart) btnQuoteCart.addEventListener('click', toggleQuoteDrawer);
  if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', toggleQuoteDrawer);
  if (quoteBackdrop) quoteBackdrop.addEventListener('click', toggleQuoteDrawer);

  // Auth Modal toggles
  const btnOpenLogin = document.getElementById('btnOpenLogin');
  const btnCloseAuthModal = document.getElementById('btnCloseAuthModal');
  const authBackdrop = document.getElementById('authModalBackdrop');

  if (btnOpenLogin) btnOpenLogin.addEventListener('click', () => openAuthModal('login'));
  if (btnCloseAuthModal) btnCloseAuthModal.addEventListener('click', closeAuthModal);
  if (authBackdrop) {
    authBackdrop.addEventListener('click', (e) => {
      if (e.target === authBackdrop) closeAuthModal();
    });
  }

  // Auth Tabs
  const tabLogin = document.getElementById('tabLoginBtn');
  const tabRegister = document.getElementById('tabRegisterBtn');
  if (tabLogin) tabLogin.addEventListener('click', () => switchAuthTab('login'));
  if (tabRegister) tabRegister.addEventListener('click', () => switchAuthTab('register'));

  // Auth Forms
  const loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);

  const registerForm = document.getElementById('registerForm');
  if (registerForm) registerForm.addEventListener('submit', handleRegisterSubmit);

  // Logout button
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) btnLogout.addEventListener('click', handleLogout);

  // Quote Action buttons
  const btnExportWhatsApp = document.getElementById('btnExportWhatsApp');
  if (btnExportWhatsApp) btnExportWhatsApp.addEventListener('click', exportQuoteToWhatsApp);

  const btnOpenOrderModal = document.getElementById('btnOpenOrderModal');
  if (btnOpenOrderModal) btnOpenOrderModal.addEventListener('click', openOrderModal);

  const btnCloseOrderModal = document.getElementById('btnCloseOrderModal');
  if (btnCloseOrderModal) btnCloseOrderModal.addEventListener('click', closeOrderModal);

  const orderBackdrop = document.getElementById('orderModalBackdrop');
  if (orderBackdrop) {
    orderBackdrop.addEventListener('click', (e) => {
      if (e.target === orderBackdrop) closeOrderModal();
    });
  }

  // Delivery toggle
  const optEnvio = document.getElementById('optEnvio');
  const optRetiro = document.getElementById('optRetiro');
  const groupDireccion = document.getElementById('groupDireccion');
  const groupSucursal = document.getElementById('groupSucursal');
  const orderDireccion = document.getElementById('orderDireccion');

  if (optEnvio && optRetiro) {
    optEnvio.addEventListener('click', () => {
      optEnvio.classList.add('active');
      optRetiro.classList.remove('active');
      const r = optEnvio.querySelector('input');
      if (r) r.checked = true;
      if (groupDireccion) groupDireccion.style.display = 'block';
      if (groupSucursal) groupSucursal.style.display = 'none';
      if (orderDireccion) orderDireccion.required = true;
    });

    optRetiro.addEventListener('click', () => {
      optRetiro.classList.add('active');
      optEnvio.classList.remove('active');
      const r = optRetiro.querySelector('input');
      if (r) r.checked = true;
      if (groupDireccion) groupDireccion.style.display = 'none';
      if (groupSucursal) groupSucursal.style.display = 'block';
      if (orderDireccion) orderDireccion.required = false;
    });
  }

  const orderForm = document.getElementById('orderForm');
  if (orderForm) orderForm.addEventListener('submit', handleOrderSubmit);

  const btnNotifyWhatsAppOrder = document.getElementById('btnNotifyWhatsAppOrder');
  if (btnNotifyWhatsAppOrder) btnNotifyWhatsAppOrder.addEventListener('click', notifyWhatsAppOrder);

  const btnCloseSuccessOrder = document.getElementById('btnCloseSuccessOrder');
  if (btnCloseSuccessOrder) btnCloseSuccessOrder.addEventListener('click', () => {
    closeOrderModal();
    toggleQuoteDrawer();
  });
}

// ──────────────────────────────────────────────────────────────────────────
// AUTHENTICATION & USER TIERS
// ──────────────────────────────────────────────────────────────────────────
async function checkClientAuth() {
  try {
    const res = await fetch(`${API_BASE}/auth/cliente/me`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (data.cliente) {
        AppState.cliente = data.cliente;
        updateUserUI();
        return;
      }
    }
  } catch (_e) {}
  AppState.cliente = null;
  updateUserUI();
}

function updateUserUI() {
  const headerGuest = document.getElementById('headerGuestBox');
  const headerUser = document.getElementById('headerUserBadge');
  const clientNameSpan = document.getElementById('headerClientName');
  const discountPill = document.getElementById('headerDiscountPill');

  if (AppState.cliente) {
    if (headerGuest) headerGuest.style.display = 'none';
    if (headerUser) {
      headerUser.style.display = 'flex';
      headerUser.classList.add('visible');
    }
    if (clientNameSpan) {
      const shortName = AppState.cliente.nombre.split(' ')[0];
      clientNameSpan.textContent = `Hola, ${shortName}`;
    }
    if (discountPill) {
      const pct = parseFloat(AppState.cliente.descuento_porcentaje) || 0;
      const cat = AppState.cliente.categoria.toUpperCase();
      discountPill.textContent = pct > 0 ? `${cat} · ${pct}% OFF` : cat;
    }
  } else {
    if (headerGuest) headerGuest.style.display = 'flex';
    if (headerUser) {
      headerUser.style.display = 'none';
      headerUser.classList.remove('visible');
    }
  }
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await fetch(`${API_BASE}/auth/cliente/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Error al iniciar sesión');
      return;
    }

    AppState.cliente = data.cliente;
    updateUserUI();
    closeAuthModal();
    showToast(`¡Bienvenido ${AppState.cliente.nombre}! Precios actualizados.`);

    // Recalcular productos y cotización con el nuevo descuento
    await loadProducts();
    recalculateCart();
  } catch (err) {
    showToast('Error de conexión al iniciar sesión');
  }
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const nombre = document.getElementById('regNombre').value.trim();
  const empresa_razon_social = document.getElementById('regEmpresa').value.trim();
  const rut_ci = document.getElementById('regRut').value.trim();
  const telefono = document.getElementById('regTelefono').value.trim();
  const categoria = document.getElementById('regCategoria').value;

  try {
    const res = await fetch(`${API_BASE}/auth/cliente/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        email,
        password,
        nombre,
        empresa_razon_social,
        rut_ci,
        telefono,
        categoria,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Error al crear cuenta');
      return;
    }

    AppState.cliente = data.cliente;
    updateUserUI();
    closeAuthModal();
    showToast(`¡Cuenta creada! Nivel asignado: ${AppState.cliente.categoria.toUpperCase()}`);

    await loadProducts();
    recalculateCart();
  } catch (err) {
    showToast('Error de conexión al registrar cuenta');
  }
}

async function handleLogout() {
  try {
    await fetch(`${API_BASE}/auth/cliente/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch (_e) {}
  AppState.cliente = null;
  updateUserUI();
  showToast('Sesión cerrada. Precios de lista restaurados.');
  await loadProducts();
  recalculateCart();
}

// Demo quick-fill accounts helper.
// Las cuentas de prueba solo se habilitan en local o con ?demo=1 para no
// exponer credenciales compartidas en el sitio público de producción.
function isDemoMode() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1') return true;
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch (_e) {
    return false;
  }
}

window.quickFillDemoAccount = function(email, pass = 'Cotibot123!') {
  if (!isDemoMode()) return;
  const emailInput = document.getElementById('loginEmail');
  const passInput = document.getElementById('loginPassword');
  if (emailInput && passInput) {
    emailInput.value = email;
    passInput.value = pass;
    document.getElementById('loginForm').dispatchEvent(new Event('submit'));
  }
};

function initDemoAccounts() {
  if (!isDemoMode()) return;
  const box = document.getElementById('demoAccountsBox');
  if (box) box.hidden = false;
}

function openAuthModal(tab = 'login') {
  const backdrop = document.getElementById('authModalBackdrop');
  if (backdrop) backdrop.classList.add('open');
  switchAuthTab(tab);
}

function closeAuthModal() {
  const backdrop = document.getElementById('authModalBackdrop');
  if (backdrop) backdrop.classList.remove('open');
}

function switchAuthTab(tab) {
  const tabLogin = document.getElementById('tabLoginBtn');
  const tabReg = document.getElementById('tabRegisterBtn');
  const formLogin = document.getElementById('loginForm');
  const formReg = document.getElementById('registerForm');

  if (tab === 'login') {
    tabLogin.classList.add('active');
    tabReg.classList.remove('active');
    formLogin.style.display = 'block';
    formReg.style.display = 'none';
  } else {
    tabLogin.classList.remove('active');
    tabReg.classList.add('active');
    formLogin.style.display = 'none';
    formReg.style.display = 'block';
  }
}

// ──────────────────────────────────────────────────────────────────────────
// CATEGORIES & PRODUCTS
// ──────────────────────────────────────────────────────────────────────────
async function loadCategories() {
  try {
    const res = await fetch(`${API_BASE}/productos/categorias`);
    if (res.ok) {
      const data = await res.json();
      AppState.categories = data.categorias || [];
      renderCategoryPills();
    }
  } catch (err) {
    console.warn('[Cotibot] Error al cargar categorías', err);
  }
}

function renderCategoryPills() {
  const container = document.getElementById('categoryPillsContainer');
  if (!container) return;

  container.innerHTML = `
    <button class="cat-pill active" onclick="selectCategory('')" id="catPillAll">
      <span>Todos los artículos</span>
    </button>
  `;

  AppState.categories.forEach((c) => {
    const pill = document.createElement('button');
    pill.className = 'cat-pill';
    pill.innerHTML = `<span>${c.categoria}</span> <small style="opacity:0.6">(${c.count || ''})</small>`;
    pill.onclick = () => selectCategory(c.categoria);
    container.appendChild(pill);
  });
}

window.selectCategory = function(cat) {
  AppState.activeCategory = cat;
  AppState.searchQuery = '';
  AppState.currentPage = 1;

  const searchInput = document.getElementById('heroSearchInput');
  if (searchInput) searchInput.value = '';
  if (window.updateSearchInputUI) window.updateSearchInputUI();

  // Actualizar clases activas
  document.querySelectorAll('.cat-pill').forEach((btn) => {
    btn.classList.remove('active');
  });
  if (!cat) {
    const all = document.getElementById('catPillAll');
    if (all) all.classList.add('active');
  }

  loadProducts();
};

window.clearCatalogSearch = function() {
  AppState.searchQuery = '';
  AppState.activeCategory = '';
  AppState.currentPage = 1;
  const searchInput = document.getElementById('heroSearchInput');
  if (searchInput) searchInput.value = '';
  if (window.updateSearchInputUI) window.updateSearchInputUI();

  document.querySelectorAll('.cat-pill').forEach((btn) => btn.classList.remove('active'));
  const allPill = document.getElementById('catPillAll');
  if (allPill) allPill.classList.add('active');

  loadProducts();
};

window.quickSearchTag = function(term) {
  const input = document.getElementById('heroSearchInput');
  if (input) input.value = term;
  AppState.searchQuery = term;
  AppState.currentPage = 1;
  loadProducts();
  const catalogEl = document.getElementById('catalogoSection');
  if (catalogEl) catalogEl.scrollIntoView({ behavior: 'smooth' });
};

async function loadProducts() {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;

  AppState.isLoadingProducts = true;
  grid.setAttribute('aria-busy', 'true');
  grid.innerHTML = `
    <div class="catalog-loading" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <p>Consultando catálogo y calculando descuentos...</p>
    </div>
  `;

  try {
    const params = new URLSearchParams();
    if (AppState.searchQuery) params.append('search', AppState.searchQuery);
    if (AppState.activeCategory) params.append('categoria', AppState.activeCategory);
    if (AppState.activePromoId) params.append('promo_id', AppState.activePromoId);
    params.append('limit', AppState.limit);
    params.append('page', AppState.currentPage);

    const res = await fetch(`${API_BASE}/productos?${params.toString()}`, { credentials: 'include' });
    const data = await res.json();

    AppState.products = data.items || [];
    AppState.totalPages = data.totalPages || 1;
    renderProductsGrid();
    renderPagination();
  } catch (err) {
    grid.innerHTML = `
      <div class="catalog-loading" role="alert">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>
        </svg>
        <h3 style="color:#fff; margin:0;">No pudimos cargar el catálogo</h3>
        <p style="margin:0;">Revisá tu conexión e intentá nuevamente.</p>
        <button type="button" class="retry-btn" onclick="loadProducts()">Reintentar</button>
      </div>
    `;
  } finally {
    AppState.isLoadingProducts = false;
    grid.setAttribute('aria-busy', 'false');
  }
}

function renderProductsGrid() {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;

  if (AppState.products.length === 0) {
    grid.innerHTML = `
      <div class="catalog-loading">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
        </svg>
        <h3 style="color:#fff; margin:0;">No encontramos artículos</h3>
        <p style="margin:0;">Probá con otros términos o consultá a <strong>Cotibot</strong> en el asistente.</p>
        <button type="button" class="retry-btn" onclick="clearCatalogSearch()">Ver todos los artículos</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = '';
  AppState.products.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'product-card';

    const inStock = p.stock_status === 'in_stock';
    const hasDiscount = p.descuento_porcentaje && p.descuento_porcentaje > 0;
    const isPublicOffer = p.es_oferta_publica;
    const safeName = escapeHtml(p.nombre || 'Artículo');
    const finalPrice = formatMoney(p.precio_final || p.precio, p.moneda);
    const listPrice = formatMoney(p.precio_lista || p.precio, p.moneda);
    const savingAmount = formatMoney(p.ahorro_monto, p.moneda);

    card.innerHTML = `
      <div class="product-thumb-wrap">
        <span class="badge-stock ${inStock ? 'badge-in-stock' : 'badge-out-stock'}">
          <span class="stock-dot" aria-hidden="true"></span>${inStock ? 'En stock' : 'Sin stock'}
        </span>
        ${hasDiscount ? `
          <span class="badge-discount-tag">
            -${p.descuento_porcentaje}% ${p.categoria_cliente ? p.categoria_cliente.toUpperCase() : 'OFF'}
          </span>
        ` : ''}
        ${p.imagen_url ? `
          <img class="product-thumb" src="${p.imagen_url}" alt="${safeName}" loading="lazy" decoding="async" onerror="this.style.display='none'; this.parentElement.classList.add('thumb-fallback');">
        ` : `
          <div class="product-thumb-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>
            </svg>
            <small>Kroser Catálogo</small>
          </div>
        `}
      </div>

      <div class="product-content">
        <div class="product-meta-row">
          <span class="product-sku">SKU: ${escapeHtml(p.sku || 'N/A')}</span>
          <span class="product-brand">${escapeHtml(p.marca || 'Kroser')}</span>
        </div>

        <h3 class="product-title" title="${safeName}">${safeName}</h3>

        <div class="product-pricing-box">
          <div class="price-row-regular">
            ${(hasDiscount || isPublicOffer) ? `
              <span class="price-strike">${listPrice}</span>
            ` : ''}
            <span class="price-final ${(hasDiscount || isPublicOffer) ? 'discounted' : ''}">
              ${finalPrice}
            </span>
          </div>
          ${p.ahorro_monto && p.ahorro_monto > 0 ? `
            <div class="savings-label">
              <span>Ahorrás ${savingAmount}${p.motivo_descuento ? ` · ${escapeHtml(p.motivo_descuento)}` : ''}</span>
            </div>
          ` : ''}
        </div>

        <div class="product-actions-row">
          <button class="btn-add-quote" onclick="addToQuote(${p.id})" aria-label="Agregar ${safeName} a mi cotización">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            <span>Agregar</span>
          </button>
          <button class="btn-view-detail" onclick="viewProductDetail(${p.id})" title="Ver detalles y alternativas" aria-label="Ver detalles técnicos de ${safeName}">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>
          </button>
        </div>
      </div>
    `;

    grid.appendChild(card);
  });
}

function renderPagination() {
  const container = document.getElementById('paginationContainer');
  if (!container) return;

  if (AppState.totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = `
    <button class="btn-page" ${AppState.currentPage === 1 ? 'disabled' : ''} onclick="goToPage(${AppState.currentPage - 1})">
      &laquo; Anterior
    </button>
  `;

  for (let i = 1; i <= Math.min(AppState.totalPages, 7); i++) {
    html += `
      <button class="btn-page ${i === AppState.currentPage ? 'active' : ''}" onclick="goToPage(${i})">
        ${i}
      </button>
    `;
  }

  html += `
    <button class="btn-page" ${AppState.currentPage === AppState.totalPages ? 'disabled' : ''} onclick="goToPage(${AppState.currentPage + 1})">
      Siguiente &raquo;
    </button>
  `;

  container.innerHTML = html;
}

window.goToPage = function(page) {
  if (page < 1 || page > AppState.totalPages) return;
  AppState.currentPage = page;
  loadProducts();
  const catalogEl = document.getElementById('catalogoSection');
  if (catalogEl) catalogEl.scrollIntoView({ behavior: 'smooth' });
};

// ──────────────────────────────────────────────────────────────────────────
// PRODUCT DETAIL MODAL
// ──────────────────────────────────────────────────────────────────────────
window.viewProductDetail = async function(id) {
  try {
    const res = await fetch(`${API_BASE}/productos/${id}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok || !data.producto) return;

    const p = data.producto;
    const currency = (p.moneda || 'UYU') === 'USD' ? 'U$S' : '$';

    alert(`Detalles del Artículo:\n\n• Nombre: ${p.nombre}\n• SKU: ${p.sku}\n• Categoría: ${p.categoria || 'N/A'}\n• Marca: ${p.marca || 'N/A'}\n• Precio Lista: ${currency} ${p.precio_lista || p.precio}\n• Tu Precio: ${currency} ${p.precio_final || p.precio} ${p.descuento_porcentaje ? `(-${p.descuento_porcentaje}%)` : ''}\n\nDescripción:\n${p.descripcion || 'Sin descripción adicional'}`);
  } catch (err) {
    showToast('Error al obtener datos del producto');
  }
};

// ──────────────────────────────────────────────────────────────────────────
// QUOTE / CART DRAWER & RECALCULATIONS
// ──────────────────────────────────────────────────────────────────────────
window.addToQuote = function(productOrId) {
  let p = null;
  if (typeof productOrId === 'object' && productOrId !== null) {
    p = productOrId;
  } else {
    p = AppState.products.find((item) => item.id === productOrId);
  }
  if (!p) return;

  const pId = p.id || (p.sku ? `sku_${p.sku}` : `item_${Date.now()}`);
  const existing = AppState.cart.find((item) => (item.id && item.id === pId) || (item.sku && p.sku && item.sku === p.sku));

  if (existing) {
    existing.cantidad += 1;
  } else {
    // Determine raw list price
    let precioLista = parseFloat(p.precio_lista || p.precio_numerico || p.precio) || 0;
    if (!precioLista && p.precio_texto) {
      const match = String(p.precio_texto).match(/[\d]+(?:[.,]\d+)?/);
      if (match) precioLista = parseFloat(match[0].replace(',', '.'));
    }

    let precioFinal = parseFloat(p.precio_final || p.precio_numerico || p.precio) || precioLista;
    let ahorroMonto = parseFloat(p.ahorro_monto || 0);

    // Dynamic customer tier discount if logged in and not already applied
    if (AppState.cliente && (!p.precio_final || p.precio_final === precioLista)) {
      const pct = parseFloat(AppState.cliente.descuento_porcentaje) || 0;
      if (pct > 0 && precioLista > 0) {
        precioFinal = Math.round(precioLista * (1 - pct / 100) * 100) / 100;
        ahorroMonto = Math.round((precioLista - precioFinal) * 100) / 100;
      }
    }

    AppState.cart.push({
      id: pId,
      sku: p.sku || '',
      nombre: p.nombre || 'Artículo Cotizado',
      precio_lista: precioLista,
      precio_final: precioFinal,
      ahorro_monto: ahorroMonto,
      moneda: p.moneda || 'UYU',
      cantidad: 1,
    });
  }

  saveCartToStorage();
  updateCartBadge();
  renderQuoteDrawer();
  showToast(`"${(p.nombre || 'Artículo').substring(0, 25)}..." agregado a tu cotización`);
};

function toggleQuoteDrawer() {
  const backdrop = document.getElementById('quoteDrawerBackdrop');
  const drawer = document.getElementById('quoteDrawer');
  if (drawer && backdrop) {
    const isOpen = drawer.classList.contains('open');
    if (isOpen) {
      drawer.classList.remove('open');
      backdrop.classList.remove('open');
    } else {
      renderQuoteDrawer();
      drawer.classList.add('open');
      backdrop.classList.add('open');
    }
  }
}

function renderQuoteDrawer() {
  const listEl = document.getElementById('drawerItemsList');
  if (!listEl) return;

  if (AppState.cart.length === 0) {
    listEl.innerHTML = `
      <div class="drawer-empty-msg">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-bottom:0.6rem; color:var(--text-dim);"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/></svg>
        <p>Tu lista de cotización está vacía.</p>
        <small>Agrega artículos desde el catálogo o pídele ayuda a Cotibot.</small>
      </div>
    `;
    updateQuoteSummary({ subtotalUYU: 0, totalUYU: 0, ahorroUYU: 0, subtotalUSD: 0, totalUSD: 0, ahorroUSD: 0 });
    return;
  }

  listEl.innerHTML = '';
  let subtotalUYU = 0;
  let totalUYU = 0;
  let subtotalUSD = 0;
  let totalUSD = 0;

  AppState.cart.forEach((item, index) => {
    const isUSD = item.moneda === 'USD' || item.moneda === 'U$S';
    const itemTotal = item.precio_final * item.cantidad;
    const itemListaTotal = item.precio_lista * item.cantidad;

    if (isUSD) {
      subtotalUSD += itemListaTotal;
      totalUSD += itemTotal;
    } else {
      subtotalUYU += itemListaTotal;
      totalUYU += itemTotal;
    }

    const row = document.createElement('div');
    row.className = 'quote-item-row';

    row.innerHTML = `
      <div class="quote-item-info">
        <h4 class="quote-item-title">${escapeHtml(item.nombre)}</h4>
        <div class="quote-item-price">${formatMoney(item.precio_final, item.moneda)} <small style="color:var(--text-dim)">(x${item.cantidad} = ${formatMoney(itemTotal, item.moneda)})</small></div>
      </div>
      <div class="quote-qty-control">
        <button class="qty-btn" onclick="updateCartQty(${index}, -1)" aria-label="Disminuir una unidad de ${escapeHtml(item.nombre)}">-</button>
        <span class="qty-val">${item.cantidad}</span>
        <button class="qty-btn" onclick="updateCartQty(${index}, 1)" aria-label="Aumentar una unidad de ${escapeHtml(item.nombre)}">+</button>
      </div>
    `;

    listEl.appendChild(row);
  });

  const ahorroUYU = Math.max(0, subtotalUYU - totalUYU);
  const ahorroUSD = Math.max(0, subtotalUSD - totalUSD);
  updateQuoteSummary({ subtotalUYU, totalUYU, ahorroUYU, subtotalUSD, totalUSD, ahorroUSD });
}

window.updateCartQty = function(index, delta) {
  if (!AppState.cart[index]) return;
  AppState.cart[index].cantidad += delta;
  if (AppState.cart[index].cantidad <= 0) {
    AppState.cart.splice(index, 1);
  }
  saveCartToStorage();
  updateCartBadge();
  renderQuoteDrawer();
};

function updateQuoteSummary(amounts) {
  const subtotalEl = document.getElementById('summarySubtotal');
  const discountEl = document.getElementById('summaryDiscount');
  const totalEl = document.getElementById('summaryTotal');

  if (!amounts || typeof amounts !== 'object') {
    if (subtotalEl) subtotalEl.textContent = formatMoney(0, 'UYU');
    if (discountEl) discountEl.textContent = `-${formatMoney(0, 'UYU')}`;
    if (totalEl) totalEl.textContent = formatMoney(0, 'UYU');
    return;
  }

  const { subtotalUYU = 0, totalUYU = 0, ahorroUYU = 0, subtotalUSD = 0, totalUSD = 0, ahorroUSD = 0 } = amounts;

  if (totalUSD > 0 && totalUYU > 0) {
    if (subtotalEl) subtotalEl.textContent = `${formatMoney(subtotalUYU, 'UYU')} + ${formatMoney(subtotalUSD, 'USD')}`;
    if (discountEl) discountEl.textContent = `${ahorroUYU > 0 ? `-${formatMoney(ahorroUYU, 'UYU')}` : ''}${ahorroUSD > 0 ? ` -${formatMoney(ahorroUSD, 'USD')}` : (ahorroUYU === 0 ? `-${formatMoney(0, 'UYU')}` : '')}`;
    if (totalEl) totalEl.innerHTML = `${formatMoney(totalUYU, 'UYU')} <span style="font-size:0.85rem; font-weight:600; color:var(--text-muted);">+ ${formatMoney(totalUSD, 'USD')}</span>`;
  } else if (totalUSD > 0) {
    if (subtotalEl) subtotalEl.textContent = formatMoney(subtotalUSD, 'USD');
    if (discountEl) discountEl.textContent = `-${formatMoney(ahorroUSD, 'USD')}`;
    if (totalEl) totalEl.textContent = formatMoney(totalUSD, 'USD');
  } else {
    if (subtotalEl) subtotalEl.textContent = formatMoney(subtotalUYU, 'UYU');
    if (discountEl) discountEl.textContent = `-${formatMoney(ahorroUYU, 'UYU')}`;
    if (totalEl) totalEl.textContent = formatMoney(totalUYU, 'UYU');
  }
}

function recalculateCart() {
  if (AppState.cart.length === 0) return;
  // Si cambia el usuario logueado, re-asigna precio según el producto cargado
  AppState.cart.forEach((item) => {
    const p = AppState.products.find((prod) => prod.id === item.id);
    if (p) {
      item.precio_final = parseFloat(p.precio_final || p.precio) || item.precio_final;
      item.precio_lista = parseFloat(p.precio_lista || p.precio) || item.precio_lista;
    }
  });
  saveCartToStorage();
  renderQuoteDrawer();
}

function updateCartBadge() {
  const countBadge = document.getElementById('quoteCountBadge');
  const totalCount = AppState.cart.reduce((sum, item) => sum + item.cantidad, 0);
  if (countBadge) {
    countBadge.textContent = totalCount;
  }
}

function saveCartToStorage() {
  try {
    localStorage.setItem('cotibot_cart', JSON.stringify(AppState.cart));
  } catch (_e) {}
}

function loadCartFromStorage() {
  try {
    const raw = localStorage.getItem('cotibot_cart');
    if (raw) AppState.cart = JSON.parse(raw);
  } catch (_e) {
    AppState.cart = [];
  }
}

function exportQuoteToWhatsApp() {
  if (AppState.cart.length === 0) {
    showToast('Agrega artículos antes de exportar la cotización');
    return;
  }

  const clientName = AppState.cliente ? AppState.cliente.nombre : 'Cliente Web';
  const tier = AppState.cliente ? AppState.cliente.categoria.toUpperCase() : 'MINORISTA';

  let text = `*SOLICITUD DE COTIZACIÓN — COTIBOT*\n`;
  text += `Cliente: ${clientName} (${tier})\n\n`;
  text += `*Artículos solicitados:*\n`;

  let totalUYU = 0;
  let totalUSD = 0;
  AppState.cart.forEach((i, idx) => {
    const isUSD = i.moneda === 'USD' || i.moneda === 'U$S';
    const currSym = isUSD ? 'U$S' : '$';
    const itemSub = i.precio_final * i.cantidad;
    if (isUSD) totalUSD += itemSub;
    else totalUYU += itemSub;
    text += `${idx + 1}. ${i.nombre} (x${i.cantidad}) — ${currSym} ${itemSub.toFixed(2)}\n`;
  });

  text += `\n*TOTAL ESTIMADO: `;
  if (totalUYU > 0 && totalUSD > 0) {
    text += `$ ${totalUYU.toFixed(2)} UYU + U$S ${totalUSD.toFixed(2)} USD*\n\n`;
  } else if (totalUSD > 0) {
    text += `U$S ${totalUSD.toFixed(2)} USD*\n\n`;
  } else {
    text += `$ ${totalUYU.toFixed(2)} UYU*\n\n`;
  }
  text += `Generado desde cotibot.uy`;

  const url = `https://api.whatsapp.com/send?phone=59899123456&text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

// ──────────────────────────────────────────────────────────────────────────
// ORDER CHECKOUT FLOW (HACER PEDIDO)
// ──────────────────────────────────────────────────────────────────────────
function openOrderModal() {
  if (AppState.cart.length === 0) {
    showToast('Agrega al menos un artículo a tu cotización para hacer el pedido');
    return;
  }

  const backdrop = document.getElementById('orderModalBackdrop');
  const countEl = document.getElementById('orderModalItemsCount');
  const totalEl = document.getElementById('orderModalTotal');
  const previewEl = document.getElementById('orderModalItemsPreview');
  const formEl = document.getElementById('orderForm');
  const successBox = document.getElementById('orderSuccessBox');

  // Pre-fill customer data if logged in
  const nombreInput = document.getElementById('orderNombre');
  const telInput = document.getElementById('orderTelefono');
  const emailInput = document.getElementById('orderEmail');
  const dirInput = document.getElementById('orderDireccion');

  if (AppState.cliente) {
    if (nombreInput) nombreInput.value = AppState.cliente.nombre || '';
    if (telInput) telInput.value = AppState.cliente.telefono || '';
    if (emailInput) emailInput.value = AppState.cliente.email || '';
    if (dirInput && AppState.cliente.direccion) dirInput.value = AppState.cliente.direccion;
  }

  // Calculate items and total
  const totalItems = AppState.cart.reduce((sum, item) => sum + item.cantidad, 0);
  let totalUYU = 0;
  let totalUSD = 0;
  AppState.cart.forEach((it) => {
    const isUSD = it.moneda === 'USD' || it.moneda === 'U$S';
    if (isUSD) totalUSD += it.precio_final * it.cantidad;
    else totalUYU += it.precio_final * it.cantidad;
  });

  if (countEl) countEl.textContent = `${totalItems} artículo${totalItems === 1 ? '' : 's'} en la lista`;
  if (totalEl) {
    if (totalUSD > 0 && totalUYU > 0) {
      totalEl.textContent = `${formatMoney(totalUYU, 'UYU')} + ${formatMoney(totalUSD, 'USD')}`;
    } else if (totalUSD > 0) {
      totalEl.textContent = formatMoney(totalUSD, 'USD');
    } else {
      totalEl.textContent = formatMoney(totalUYU, 'UYU');
    }
  }

  // Mini preview chips
  if (previewEl) {
    previewEl.innerHTML = '';
    AppState.cart.slice(0, 8).forEach((it) => {
      const chip = document.createElement('span');
      chip.className = 'order-item-chip';
      chip.title = it.nombre;
      chip.textContent = `${it.cantidad}x ${it.nombre}`;
      previewEl.appendChild(chip);
    });
    if (AppState.cart.length > 8) {
      const more = document.createElement('span');
      more.className = 'order-item-chip';
      more.textContent = `+${AppState.cart.length - 8} más...`;
      previewEl.appendChild(more);
    }
  }

  if (formEl) formEl.style.display = 'block';
  if (successBox) successBox.style.display = 'none';

  if (backdrop) backdrop.classList.add('open');
}

function closeOrderModal() {
  const backdrop = document.getElementById('orderModalBackdrop');
  if (backdrop) backdrop.classList.remove('open');
}

async function handleOrderSubmit(e) {
  e.preventDefault();
  if (AppState.cart.length === 0) {
    showToast('Tu cotización está vacía');
    return;
  }

  const nombre = document.getElementById('orderNombre').value.trim();
  const telefono = document.getElementById('orderTelefono').value.trim();
  const email = document.getElementById('orderEmail').value.trim();
  const deliveryType = document.querySelector('input[name="orderDeliveryType"]:checked')?.value || 'envio';
  const direccion = document.getElementById('orderDireccion').value.trim();
  const sucursal = document.getElementById('orderSucursal').value;
  const formaPago = document.getElementById('orderFormaPago').value;
  const notas = document.getElementById('orderNotas').value.trim();

  if (!nombre) {
    showToast('Por favor ingresa tu nombre');
    return;
  }
  if (!telefono || telefono.length < 6) {
    showToast('Ingresa un teléfono válido de contacto');
    return;
  }
  if (deliveryType === 'envio' && !direccion) {
    showToast('Ingresa la dirección para el envío');
    return;
  }

  const submitBtn = document.getElementById('btnSubmitOrder');
  const submitText = document.getElementById('btnSubmitOrderText');
  if (submitBtn) submitBtn.disabled = true;
  if (submitText) submitText.textContent = 'Enviando Pedido... ⏳';

  try {
    const payload = {
      cliente: {
        nombre,
        telefono,
        email,
        direccion: deliveryType === 'envio' ? direccion : sucursal,
        sucursal_retiro: deliveryType === 'retiro' ? sucursal : '',
        forma_pago: formaPago,
        notas,
      },
      items: AppState.cart,
      deliveryType,
      notas,
    };

    const res = await fetch(`${API_BASE}/cotibot/pedido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'No se pudo registrar el pedido');
    }

    // Success!
    AppState.lastOrder = data.pedido;

    const formEl = document.getElementById('orderForm');
    const successBox = document.getElementById('orderSuccessBox');
    const refMsg = document.getElementById('orderSuccessRefMsg');
    const detailsEl = document.getElementById('orderSuccessDetails');

    if (refMsg) {
      refMsg.textContent = `Registrado como Pedido ${data.pedido.referencia} a nombre de ${data.pedido.cliente}.`;
    }

    if (detailsEl) {
      detailsEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:0.35rem;">
          <span>Referencia:</span>
          <strong style="color:var(--coti-accent);">${data.pedido.referencia}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:0.35rem;">
          <span>Modalidad:</span>
          <strong>${data.pedido.modalidad_entrega}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:0.35rem;">
          <span>Lugar:</span>
          <strong style="text-align:right; max-width:260px;">${data.pedido.direccion}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:0.5rem; padding-top:0.5rem; border-top:1px solid rgba(255,255,255,0.1);">
          <span>Total estimado:</span>
          <strong style="font-size:1.05rem; color:#34d399;">${formatMoney(data.pedido.total, 'UYU')} UYU</strong>
        </div>
      `;
    }

    if (formEl) formEl.style.display = 'none';
    if (successBox) successBox.style.display = 'block';

    // Clear cart
    AppState.cart = [];
    saveCartToStorage();
    updateCartBadge();
    renderQuoteDrawer();

    showToast(`¡Pedido ${data.pedido.referencia} registrado con éxito!`);
  } catch (err) {
    showToast(err.message || 'Error al enviar pedido');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (submitText) submitText.textContent = '✅ Enviar Pedido a Mostrador';
  }
}

function notifyWhatsAppOrder() {
  const o = AppState.lastOrder;
  if (!o) {
    showToast('No hay pedido reciente para notificar');
    return;
  }

  let text = `*CONFIRMACIÓN DE PEDIDO WEB — KROSER MARTÍNEZ*\n`;
  text += `¡Hola! Acabo de registrar el *Pedido ${o.referencia}* en el cotizador web.\n\n`;
  text += `*Cliente:* ${o.cliente}\n`;
  text += `*Teléfono:* ${o.telefono}\n`;
  text += `*Entrega:* ${o.modalidad_entrega} (${o.direccion})\n`;
  text += `*Total estimado:* $ ${o.total.toFixed(2)} UYU\n\n`;
  text += `¿Me podrían confirmar recepción y coordinación? ¡Muchas gracias!`;

  const url = `https://api.whatsapp.com/send?phone=59899123456&text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

// ──────────────────────────────────────────────────────────────────────────
// TOAST NOTIFICATIONS
// ──────────────────────────────────────────────────────────────────────────
window.showToast = function(msg) {
  let toast = document.getElementById('cotiToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cotiToast';
    toast.className = 'coti-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }

  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
};

// ──────────────────────────────────────────────────────────────────────────
// PROMOTIONS & SPECIAL DEALS BANNER
// ──────────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.applyPromoFilter = async function(promoIdOrTerm, promoTitle = '', promoDiscount = 0, promoBadge = '') {
  const numericId = parseInt(promoIdOrTerm, 10);
  if (!isNaN(numericId) && numericId > 0 && String(promoIdOrTerm).match(/^d+$/)) {
    AppState.activePromoId = numericId;
    AppState.activePromoTitle = promoTitle || 'Promoción Especial';
    AppState.activePromoBadge = promoBadge || (promoDiscount > 0 ? `${Math.round(promoDiscount)}% OFF` : 'OFERTA');
    AppState.activePromoDiscount = promoDiscount;
    AppState.searchQuery = '';
    AppState.activeCategory = '';
    AppState.currentPage = 1;

    const searchInput = document.getElementById('heroSearchInput');
    if (searchInput) searchInput.value = '';
    document.querySelectorAll('.cat-pill').forEach((btn) => btn.classList.remove('active'));
    const allPill = document.getElementById('catPillAll');
    if (allPill) allPill.classList.add('active');

    const bar = document.getElementById('activePromoIndicatorBar');
    const titleEl = document.getElementById('activePromoIndicatorTitle');
    const badgeEl = document.getElementById('activePromoIndicatorBadge');
    if (bar) bar.style.display = 'flex';
    if (titleEl) titleEl.textContent = AppState.activePromoTitle;
    if (badgeEl) badgeEl.textContent = AppState.activePromoBadge;

    await loadProducts();

    const catalogEl = document.getElementById('catalogoSection');
    if (catalogEl) catalogEl.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  if (!promoIdOrTerm || typeof promoIdOrTerm !== 'string') return;
  const cleanTerm = promoIdOrTerm.trim();
  if (cleanTerm.toLowerCase() === 'registro' || cleanTerm.toLowerCase() === 'register') {
    openAuthModal('register');
    return;
  }

  await clearPromoFilter(false);

  if (typeof quickSearchTag === 'function') {
    quickSearchTag(cleanTerm);
  } else {
    const input = document.getElementById('heroSearchInput');
    if (input) input.value = cleanTerm;
    AppState.searchQuery = cleanTerm;
    AppState.currentPage = 1;
    loadProducts();
    const catalogEl = document.getElementById('catalogoSection');
    if (catalogEl) catalogEl.scrollIntoView({ behavior: 'smooth' });
  }
};

window.clearPromoFilter = async function(reload = true) {
  AppState.activePromoId = null;
  AppState.activePromoTitle = '';
  AppState.activePromoBadge = '';
  AppState.activePromoDiscount = 0;

  const bar = document.getElementById('activePromoIndicatorBar');
  if (bar) bar.style.display = 'none';

  if (reload) {
    AppState.currentPage = 1;
    await loadProducts();
  }
};

async function loadPromocionesBanner() {
  const container = document.getElementById('promocionesCardsGrid');
  if (!container) return;

  try {
    const res = await fetch(`${API_BASE}/promociones`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.promociones || data.promociones.length === 0) return;

    container.innerHTML = data.promociones.map((p) => {
      const gradClass = `promo-gradient-${p.gradiente || 'amber'}`;
      const discountPill = (p.descuento_porcentaje && parseFloat(p.descuento_porcentaje) > 0)
        ? `<span class="promo-discount-pill">${Math.round(p.descuento_porcentaje)}% OFF</span>`
        : '';
      const actionText = p.texto_boton || 'Ver Ofertas';
      const safeTitle = escapeHtml(p.titulo).replace(/'/g, "\\'");
      const safeBadge = escapeHtml(p.badge || 'OFERTA ESPECIAL').replace(/'/g, "\\'");
      const discountVal = parseFloat(p.descuento_porcentaje) || 0;

      return `
        <div class="promo-card ${gradClass}" onclick="applyPromoFilter(${p.id}, '${safeTitle}', ${discountVal}, '${safeBadge}')" role="button" tabindex="0">
          <div class="promo-card-top">
            <span class="promo-badge">${escapeHtml(p.badge || 'OFERTA ESPECIAL')}</span>
            ${discountPill}
          </div>
          <div class="promo-card-body">
            <h3 class="promo-card-title">${escapeHtml(p.titulo)}</h3>
            ${p.subtitulo ? `<p class="promo-card-desc">${escapeHtml(p.subtitulo)}</p>` : ''}
          </div>
          <div class="promo-card-footer">
            <span class="promo-action-btn">${escapeHtml(actionText)} →</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.warn('[Cotibot] Error al cargar promociones dinámicas:', err);
  }
}

// Expose quote & drawer utilities globally
window.saveCartToStorage = saveCartToStorage;
window.loadCartFromStorage = loadCartFromStorage;
window.updateCartBadge = updateCartBadge;
window.renderQuoteDrawer = renderQuoteDrawer;
window.toggleQuoteDrawer = toggleQuoteDrawer;
window.loadPromocionesBanner = loadPromocionesBanner;
window.openOrderModal = openOrderModal;
window.closeOrderModal = closeOrderModal;
window.handleOrderSubmit = handleOrderSubmit;
window.notifyWhatsAppOrder = notifyWhatsAppOrder;
