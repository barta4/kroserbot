    function escHtml(str) {
      if (str == null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    const API_BASE = '/api';
    let currentPedidosList = [];
    let currentFilter = 'todos';
    let pendingAuthResolver = null;

    // --- AUTHENTICATION ---
    function showLoginModal() {
      document.getElementById('login-modal').classList.add('active');
      document.getElementById('admin-login-password').focus();
    }

    function hideLoginModal() {
      document.getElementById('login-modal').classList.remove('active');
    }

    async function handleAdminLoginSubmit(event) {
      event.preventDefault();
      const username = document.getElementById('admin-login-username').value.trim();
      const password = document.getElementById('admin-login-password').value;
      const errorDiv = document.getElementById('admin-login-error');
      errorDiv.style.display = 'none';

      try {
        const loginRes = await fetch(`${API_BASE}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ username, password })
        });
        const data = await loginRes.json();
        if (!loginRes.ok || !data.success) {
          throw new Error(data.error || 'Credenciales incorrectas');
        }
        localStorage.setItem('kroser_admin_token', data.token);
        hideLoginModal();
        if (pendingAuthResolver) {
          pendingAuthResolver(data.token);
          pendingAuthResolver = null;
        } else {
          loadDashboard();
          initSimulator();
        }
      } catch (err) {
        errorDiv.textContent = err.message || 'Contraseña o usuario incorrecto';
        errorDiv.style.display = 'block';
      }
    }

    async function apiFetch(url, options = {}) {
      options.credentials = 'include';
      let token = localStorage.getItem('kroser_admin_token');
      if (token) {
        options.headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
      }
      let response = await fetch(url, options);
      if (response.status === 401 && !url.includes('/auth/login')) {
        localStorage.removeItem('kroser_admin_token');
        showLoginModal();
        token = await new Promise(resolve => { pendingAuthResolver = resolve; });
        if (token) {
          options.headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
        }
        response = await fetch(url, options);
      }
      return response;
    }

    function logoutAdmin() {
      localStorage.removeItem('kroser_admin_token');
      fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' }).finally(() => {
        showLoginModal();
      });
    }

    // --- NAVIGATION LOGIC ---
    const TAB_TITLES = {
      dashboard: 'Dashboard de Operaciones & Chat IA',
      catalogo: 'Catálogo de Productos Scrapeados (USD)',
      locales: 'Sucursales Kroser en Uruguay (50+)',
      zonas: 'Zonas y Tarifas de Envío',
      pagos: 'Formas y Métodos de Pago',
      pedidos: 'Gestión de Pedidos & Vista Depósito',
      contactos: 'Destinatarios de Alertas y Notificaciones de Pedido',
      clientes: 'Clientes Registrados & Descuentos Cotibot',
      prompt: 'Prompt del Sistema & Mensajes Predeterminados',
      chatwoot: 'Integración Uruchat (Inboxes & Canales)',
      datasource: 'Estrategia y Fuente de Datos del Catálogo',
      llm: 'Conector Agente IA (Gemini / OpenAI / Modelos)',
      scraper: 'Panel de Control del Scraper Oficial',
      guias: 'Guías Técnicas, Rendimientos de Materiales & Diagnóstico',
      promociones: 'Banners & Promociones Especiales (Cotibot)',
    };

    const TAB_PARENT_GROUPS = {
      dashboard: null,
      catalogo: 'trigger-catalogo',
      locales: 'trigger-catalogo',
      zonas: 'trigger-catalogo',
      pagos: 'trigger-catalogo',
      guias: 'trigger-catalogo',
      promociones: 'trigger-catalogo',
      pedidos: 'trigger-pedidos',
      contactos: 'trigger-pedidos',
      clientes: 'trigger-pedidos',
      prompt: 'trigger-config',
      chatwoot: 'trigger-config',
      datasource: 'trigger-config',
      llm: 'trigger-config',
      scraper: 'trigger-config',
    };

    function toggleDropdown(groupId, event) {
      if (event) event.stopPropagation();
      const group = document.getElementById(groupId);
      const isAlreadyOpen = group.classList.contains('open');
      
      // Close all
      document.querySelectorAll('.dropdown-group').forEach(g => g.classList.remove('open'));
      
      if (!isAlreadyOpen) {
        group.classList.add('open');
      }
    }

    // Close dropdowns on outside click
    document.addEventListener('click', () => {
      document.querySelectorAll('.dropdown-group').forEach(g => g.classList.remove('open'));
    });

    function toggleMobileDrawer() {
      const drawer = document.getElementById('mobile-drawer');
      const backdrop = document.getElementById('mobile-backdrop');
      if (drawer && backdrop) {
        drawer.classList.toggle('open');
        backdrop.classList.toggle('open');
      }
    }

    function closeMobileDrawer() {
      const drawer = document.getElementById('mobile-drawer');
      const backdrop = document.getElementById('mobile-backdrop');
      if (drawer && backdrop) {
        drawer.classList.remove('open');
        backdrop.classList.remove('open');
      }
    }

    function switchMobileChatView(view) {
      const chatPane = document.getElementById('pane-chat-conversation');
      const telePane = document.getElementById('pane-chat-telemetry');
      const btnChat = document.getElementById('seg-btn-chat');
      const btnTele = document.getElementById('seg-btn-telemetry');

      if (view === 'telemetry') {
        chatPane.classList.add('mobile-hidden');
        telePane.classList.add('mobile-active');
        btnTele.classList.add('active');
        btnChat.classList.remove('active');
      } else {
        chatPane.classList.remove('mobile-hidden');
        telePane.classList.remove('mobile-active');
        btnChat.classList.add('active');
        btnTele.classList.remove('active');
      }
    }

    function switchTab(tabName, event) {
      // 1. Hide all sections
      document.querySelectorAll('.tab-view-section').forEach(el => el.classList.remove('active'));

      // 2. Clear all desktop nav active classes
      document.querySelectorAll('.nav-btn-direct, .dropdown-item-btn').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.dropdown-trigger-btn').forEach(el => el.classList.remove('active-parent'));

      // 3. Clear mobile nav active classes
      document.querySelectorAll('.mobile-nav-link').forEach(el => el.classList.remove('active'));

      // 4. Activate target tab section
      const targetSection = document.getElementById(`tab-${tabName}`);
      if (targetSection) targetSection.classList.add('active');

      // 5. Activate desktop nav item
      const targetDesktopBtn = document.getElementById(`nav-btn-${tabName}`);
      if (targetDesktopBtn) targetDesktopBtn.classList.add('active');

      // 6. Highlight parent dropdown group trigger
      const parentTriggerId = TAB_PARENT_GROUPS[tabName];
      if (parentTriggerId) {
        const parentTrigger = document.getElementById(parentTriggerId);
        if (parentTrigger) parentTrigger.classList.add('active-parent');
      }

      // 7. Highlight mobile nav item
      const targetMobBtn = document.getElementById(`mob-btn-${tabName}`);
      if (targetMobBtn) targetMobBtn.classList.add('active');

      // 8. Update page title
      const pageTitleEl = document.getElementById('page-title');
      if (pageTitleEl) pageTitleEl.innerText = TAB_TITLES[tabName] || tabName.toUpperCase();

      // 9. Close mobile drawer and dropdowns
      closeMobileDrawer();
      document.querySelectorAll('.dropdown-group').forEach(g => g.classList.remove('open'));

      // 10. Load corresponding section data
      if (tabName === 'dashboard') {
        loadDashboard();
        initSimulator();
      }
      if (tabName === 'prompt') loadConfig();
      if (tabName === 'chatwoot') loadUruchatConfig();
      if (tabName === 'datasource') loadDataSourceConfig();
      if (tabName === 'llm') loadLLMConfig();
      if (tabName === 'pedidos') loadPedidos();
      if (tabName === 'catalogo') loadProducts();
      if (tabName === 'locales') loadLocales();
      if (tabName === 'contactos') loadContactos();
      if (tabName === 'zonas') loadZonas();
      if (tabName === 'pagos') loadFormasPago();
      if (tabName === 'guias') loadGuias();
      if (tabName === 'promociones') loadPromocionesAdmin();
      if (tabName === 'clientes') {
        loadCategoriasDescuento();
        loadClientesAdmin();
      }
      if (tabName === 'scraper') loadScraperStatus();

      // Smooth scroll to top on mobile
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function closeModal(id) { document.getElementById(id).classList.remove('active'); }
    function openModal(id) { document.getElementById(id).classList.add('active'); }

    // --- DASHBOARD METRICS ---
    async function loadDashboard() {
      try {
        const res = await apiFetch(`${API_BASE}/analytics/dashboard`);
        const data = await res.json();
        document.getElementById('metric-orders').innerText = data.metrics.totalOrders;
        document.getElementById('metric-products').innerText = data.metrics.totalProducts;
        document.getElementById('metric-derivations').innerText = data.metrics.totalDerivations;
      } catch (err) { console.error(err); }
    }

    // --- SIMULADOR DE CHAT IA ---
    let simulatorHistory = [];
    let simulatorIsLoading = false;

    async function initSimulator() {
      try {
        const res = await apiFetch(`${API_BASE}/configuracion`);
        const cfg = await res.json();
        const prov = cfg.llm_provider || 'Gemini';
        const mod = cfg.llm_model || 'gemini-1.5-flash';
        const headerModel = document.getElementById('chat-header-model');
        if (headerModel) headerModel.innerText = `Proveedor: ${prov} | Modelo: ${mod}`;
      } catch (_e) {}
    }

    function clearSimulator() {
      simulatorHistory = [];
      const container = document.getElementById('sim-messages-container');
      if (container) {
        container.innerHTML = `
          <div class="chat-bubble-bot">
            👋 ¡Hola! Soy el asesor virtual de <strong>Kroser Uruguay</strong>. Puede consultarme por artículos, precios en dólares (U$S), asesoramiento técnico, sucursales o costos de envío. ¿En qué le podemos ayudar hoy?
          </div>
        `;
      }
      resetInspector();
    }

    function resetInspector() {
      const latBadge = document.getElementById('inspector-latency-badge');
      if (latBadge) latBadge.innerText = 'Latencia: -- ms';
      const intentEl = document.getElementById('insp-intent');
      if (intentEl) intentEl.innerText = '--';
      const emoEl = document.getElementById('insp-emotion');
      if (emoEl) emoEl.innerText = '--';
      const prodCount = document.getElementById('insp-prod-count');
      if (prodCount) prodCount.innerText = '0 encontrados';
      const prodList = document.getElementById('insp-products-list');
      if (prodList) prodList.innerHTML = '<div style="color:var(--text-muted); font-style:italic; font-size:0.8rem;">Envíe un mensaje para ver los productos recuperados.</div>';
      const crossList = document.getElementById('insp-cross-list');
      if (crossList) crossList.innerHTML = '<span style="font-style:italic;">Sin sugerencias activas.</span>';
      const extraInfo = document.getElementById('insp-extra-info');
      if (extraInfo) extraInfo.innerHTML = 'Sin información complementaria inyectada.';
      const rawPrompt = document.getElementById('insp-raw-prompt');
      if (rawPrompt) rawPrompt.innerText = '';
    }

    function sendQuickPrompt(text) {
      const input = document.getElementById('sim-input-text');
      if (input) {
        input.value = text;
        handleSimulatorSubmit(new Event('submit'));
      }
    }

    function formatMarkdownChat(rawText) {
      if (!rawText) return '';
      let text = escHtml(rawText);

      // 1. Parse markdown links [Title](URL)
      text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2" target="_blank" style="color:var(--primary); font-weight:700; text-decoration:underline;">🔗 $1</a>');

      // 2. Parse naked URLs
      text = text.replace(/(?<!href=")(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:var(--primary); font-weight:700; text-decoration:underline;">🔗 $1</a>');

      // 3. Parse bold text **bold**
      text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

      // 4. Parse linebreaks
      text = text.replace(/\n/g, '<br>');

      return text;
    }

    async function handleSimulatorSubmit(event) {
      if (event && event.preventDefault) event.preventDefault();
      if (simulatorIsLoading) return;

      const input = document.getElementById('sim-input-text');
      const text = input ? input.value.trim() : '';
      if (!text) return;

      input.value = '';
      simulatorIsLoading = true;

      const container = document.getElementById('sim-messages-container');
      const typing = document.getElementById('sim-typing-indicator');

      // Append User Bubble
      const userBubble = document.createElement('div');
      userBubble.className = 'chat-bubble-user';
      userBubble.innerText = text;
      container.appendChild(userBubble);
      container.scrollTop = container.scrollHeight;

      if (typing) typing.style.display = 'block';

      try {
        const fetchStartTime = Date.now();
        const res = await apiFetch(`${API_BASE}/simulator/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            history: simulatorHistory,
            customerName: 'Cliente de Prueba',
            channel: 'Web Simulator',
          })
        });

        const data = await res.json();

        // Natural human debounce pacing: keep typing wave for a brief realistic moment
        const elapsed = Date.now() - fetchStartTime;
        if (elapsed < 600) {
          await new Promise((r) => setTimeout(r, 600 - elapsed));
        }

        if (typing) typing.style.display = 'none';

        if (data.success && data.reply) {
          const formattedReply = formatMarkdownChat(data.reply);

          const botBubble = document.createElement('div');
          botBubble.className = 'chat-bubble-bot';
          botBubble.innerHTML = formattedReply;
          container.appendChild(botBubble);
          container.scrollTop = container.scrollHeight;

          simulatorHistory.push({ role: 'user', content: text });
          simulatorHistory.push({ role: 'assistant', content: data.reply });

          // If an order was created in DB, render celebratory order card & refresh dashboard metrics
          if (data.pedidoCreated) {
            const orderCard = document.createElement('div');
            orderCard.style.cssText = 'align-self:stretch; background:#ecfdf5; border:1px solid #10b981; border-radius:6px; padding:0.85rem 1rem; margin:0.4rem 0; box-shadow:var(--shadow-sm); animation:modalFadeIn 0.3s ease;';
            
            const cliente = typeof data.pedidoCreated.cliente === 'string' ? JSON.parse(data.pedidoCreated.cliente) : (data.pedidoCreated.cliente || {});
            const items = typeof data.pedidoCreated.items === 'string' ? JSON.parse(data.pedidoCreated.items) : (data.pedidoCreated.items || []);
            const total = items.reduce((acc, item) => acc + (parseFloat(item.subtotal) || (parseFloat(item.precio || 0) * parseInt(item.cantidad || 1))), 0);

            orderCard.innerHTML = `
              <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #a7f3d0; padding-bottom:0.4rem; margin-bottom:0.5rem;">
                <span style="font-weight:800; color:#065f46; font-size:0.92rem; display:flex; align-items:center; gap:0.35rem;">
                  🛒 ¡Pedido #${data.pedidoCreated.id} Creado en BD!
                </span>
                <span class="badge confirmado" style="font-size:0.75rem;">${(data.pedidoCreated.estado || 'PENDIENTE').toUpperCase()}</span>
              </div>
              <div style="font-size:0.82rem; color:#047857; line-height:1.4;">
                <div><strong>Cliente:</strong> ${cliente.nombre || 'N/A'} ${cliente.telefono ? `(${cliente.telefono})` : ''}</div>
                <div><strong>Entrega / Retiro:</strong> ${cliente.direccion || cliente.sucursal_retiro || 'A coordinar'}</div>
                <div style="margin-top:0.35rem;"><strong>Artículos:</strong> ${items.map(i => `${i.cantidad || 1}x ${i.nombre} ($${i.precio || 0})`).join(', ')}</div>
                <div style="margin-top:0.25rem; font-weight:700; color:#065f46;">Total estimado: U$S ${total.toFixed(2)}</div>
              </div>
              <button class="btn-action btn-success" style="margin-top:0.6rem; padding:0.35rem 0.75rem; font-size:0.78rem; width:100%;" onclick="switchTab('pedidos')">
                📦 Ver Pedido en Depósito & Despacho →
              </button>
            `;
            container.appendChild(orderCard);
            loadDashboard();
          }

          updateSimulatorInspector(data);
        } else {
          const errBubble = document.createElement('div');
          errBubble.style.cssText = 'align-self:flex-start; max-width:88%; background:#fee2e2; color:#dc2626; border:1px solid #f87171; border-radius:4px; padding:0.75rem 1rem; font-size:0.85rem;';
          errBubble.innerText = `Error: ${data.error || 'No se pudo generar respuesta'}`;
          container.appendChild(errBubble);
        }
      } catch (err) {
        if (typing) typing.style.display = 'none';
        const errBubble = document.createElement('div');
        errBubble.style.cssText = 'align-self:flex-start; max-width:88%; background:#fee2e2; color:#dc2626; border:1px solid #f87171; border-radius:4px; padding:0.75rem 1rem; font-size:0.85rem;';
        errBubble.innerText = `Error de conexión: ${err.message}`;
        container.appendChild(errBubble);
      } finally {
        simulatorIsLoading = false;
        container.scrollTop = container.scrollHeight;
      }
    }

    function updateSimulatorInspector(data) {
      if (!data) return;

      const latBadge = document.getElementById('inspector-latency-badge');
      if (latBadge) {
        latBadge.innerText = `Latencia: ${data.latencyMs || 0} ms (${data.provider || 'IA'})`;
      }

      const intentEl = document.getElementById('insp-intent');
      if (intentEl) intentEl.innerText = data.analysis?.intent || 'General';

      const emoEl = document.getElementById('insp-emotion');
      if (emoEl) emoEl.innerText = data.analysis?.emotion || 'Neutral';

      const prodList = document.getElementById('insp-products-list');
      const prodCount = document.getElementById('insp-prod-count');
      const prods = data.rag?.productos || [];
      if (prodCount) prodCount.innerText = `${prods.length} encontrados`;

      if (prodList) {
        if (prods.length === 0) {
          prodList.innerHTML = '<div style="color:var(--text-muted); font-style:italic; font-size:0.8rem;">No se requirieron productos específicos del catálogo.</div>';
        } else {
          prodList.innerHTML = prods.map(p => {
            const isUyu = (p.moneda || '').toUpperCase() === 'UYU' || (parseFloat(p.precio) >= 200 && (p.moneda || '').toUpperCase() !== 'USD');
            const priceTag = isUyu ? `$ ${parseFloat(p.precio) || 0} UYU` : `U$S ${parseFloat(p.precio) || 0}`;
            return `
              <div style="background:#ffffff; padding:0.45rem 0.65rem; border-radius:4px; border:1px solid var(--border-subtle); font-size:0.8rem; display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <strong>${escHtml(p.nombre)}</strong>
                  <div style="color:var(--text-muted); font-size:0.72rem;">SKU: ${escHtml(p.sku)} · Stock: ${escHtml(p.stock_status)}</div>
                </div>
                <strong style="color:var(--primary); font-size:0.86rem; white-space:nowrap; margin-left:0.5rem;">${priceTag}</strong>
              </div>
            `;
          }).join('');
        }
      }

      const crossList = document.getElementById('insp-cross-list');
      const crossItems = data.rag?.complementarios || [];
      if (crossList) {
        if (crossItems.length === 0) {
          crossList.innerHTML = '<span style="font-style:italic; font-size:0.8rem;">Sin sugerencias activadas para este término.</span>';
        } else {
          crossList.innerHTML = crossItems.map(c => {
            const isUyu = (c.moneda || '').toUpperCase() === 'UYU' || (parseFloat(c.precio) >= 200 && (c.moneda || '').toUpperCase() !== 'USD');
            const priceTag = isUyu ? `$ ${parseFloat(c.precio) || 0} UYU` : `U$S ${parseFloat(c.precio) || 0}`;
            return `
              <div style="font-size:0.78rem; color:var(--text-main); margin-top:2px;">
                🔹 <strong>${escHtml(c.nombre)}</strong> (${priceTag})
              </div>
            `;
          }).join('');
        }
      }

      const extraInfo = document.getElementById('insp-extra-info');
      if (extraInfo) {
        const parts = [];
        if (data.toolsUsed && data.toolsUsed.length > 0) {
          parts.push(`⚙️ <strong>Herramientas ejecutadas:</strong> ` + data.toolsUsed.map(t => `<code style="background:#e2e8f0; padding:1px 5px; border-radius:3px; font-size:0.75rem;">${t.name}</code>`).join(' '));
        } else {
          parts.push(`⚡ <em style="color:var(--text-muted);">Respuesta directa (sin herramientas requeridas)</em>`);
        }
        if (data.rag?.locales?.length > 0) parts.push(`🏪 <strong>${data.rag.locales.length} Sucursales</strong> consultadas`);
        if (data.rag?.zonasEnvio?.length > 0) parts.push(`🚚 <strong>${data.rag.zonasEnvio.length} Zonas de Envío</strong> consultadas`);
        if (data.rag?.formasPago?.length > 0) parts.push(`💳 <strong>${data.rag.formasPago.length} Formas de Pago</strong> consultadas`);
        if (data.rag?.guiasTecnicas?.length > 0) parts.push(`📚 <strong>${data.rag.guiasTecnicas.length} Guías Técnicas</strong> consultadas`);

        extraInfo.innerHTML = parts.join('<br>');
      }

      const rawPrompt = document.getElementById('insp-raw-prompt');
      if (rawPrompt) rawPrompt.innerText = data.systemPrompt || '';
    }

    // --- PROMPT & CONFIG ---
    async function loadConfig() {
      try {
        const res = await apiFetch(`${API_BASE}/configuracion`);
        const cfg = await res.json();
        document.getElementById('system-prompt-input').value = cfg.system_prompt || '';
        document.getElementById('msg-pendiente').value = cfg.msg_pedido_pendiente || '';
        document.getElementById('msg-listo').value = cfg.msg_pedido_listo || '';
        document.getElementById('msg-rechazado').value = cfg.msg_pedido_rechazado || '';
        document.getElementById('msg-derivacion').value = cfg.msg_derivacion || '';
        const select = document.getElementById('config-pedidos-enabled-select');
        if (select) {
          select.value = cfg.pedidos_enabled !== 'false' ? 'true' : 'false';
        }

        // Business hours & out-of-hours (Meta 24h window)
        const elWStart = document.getElementById('bh-weekday-start');
        if (elWStart) elWStart.value = cfg.business_hours_weekday_start || '09:00';
        const elWEnd = document.getElementById('bh-weekday-end');
        if (elWEnd) elWEnd.value = cfg.business_hours_weekday_end || '18:00';
        const elSatEn = document.getElementById('bh-sat-enabled');
        if (elSatEn) {
          elSatEn.value = cfg.business_hours_saturday_enabled !== 'false' ? 'true' : 'false';
          toggleSaturdayHoursFields();
        }
        const elSatStart = document.getElementById('bh-sat-start');
        if (elSatStart) elSatStart.value = cfg.business_hours_saturday_start || '09:00';
        const elSatEnd = document.getElementById('bh-sat-end');
        if (elSatEnd) elSatEnd.value = cfg.business_hours_saturday_end || '13:00';
        const elAltMail = document.getElementById('bh-alt-email');
        if (elAltMail) elAltMail.value = cfg.contact_alternative_email || 'atencion@kroser.com.uy';
        const elCustomMsg = document.getElementById('bh-custom-msg');
        if (elCustomMsg) elCustomMsg.value = cfg.msg_fuera_de_horario || '';
      } catch (err) { console.error(err); }
    }

    function toggleSaturdayHoursFields() {
      const enabled = document.getElementById('bh-sat-enabled')?.value === 'true';
      const group = document.getElementById('bh-sat-hours-group');
      if (group) group.style.opacity = enabled ? '1' : '0.4';
    }

    async function saveBusinessHoursConfig() {
      const wStart = document.getElementById('bh-weekday-start').value;
      const wEnd = document.getElementById('bh-weekday-end').value;
      const satEnabled = document.getElementById('bh-sat-enabled').value;
      const satStart = document.getElementById('bh-sat-start').value;
      const satEnd = document.getElementById('bh-sat-end').value;
      const altEmail = document.getElementById('bh-alt-email').value.trim();
      const customMsg = document.getElementById('bh-custom-msg').value.trim();

      await Promise.all([
        apiFetch(`${API_BASE}/configuracion`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'business_hours_weekday_start', value: wStart }),
        }),
        apiFetch(`${API_BASE}/configuracion`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'business_hours_weekday_end', value: wEnd }),
        }),
        apiFetch(`${API_BASE}/configuracion`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'business_hours_saturday_enabled', value: satEnabled }),
        }),
        apiFetch(`${API_BASE}/configuracion`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'business_hours_saturday_start', value: satStart }),
        }),
        apiFetch(`${API_BASE}/configuracion`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'business_hours_saturday_end', value: satEnd }),
        }),
        apiFetch(`${API_BASE}/configuracion`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'contact_alternative_email', value: altEmail || 'atencion@kroser.com.uy' }),
        }),
        apiFetch(`${API_BASE}/configuracion`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'msg_fuera_de_horario', value: customMsg }),
        }),
      ]);

      alert('Horarios comerciales y mensajes de fuera de horario guardados exitosamente.');
    }

    async function saveConfig(key, elementId) {
      const val = document.getElementById(elementId).value;
      await apiFetch(`${API_BASE}/configuracion`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: val })
      });
      alert(`Configuración '${key}' guardada exitosamente.`);
    }

    // --- URUCHAT & CANALES (DINÁMICO) ---
    let currentInboxes = [];
    let currentDisabledChannels = [];

    function getChannelIcon(channelType) {
      const type = (channelType || '').toLowerCase();
      if (type.includes('whatsapp')) return '💬';
      if (type.includes('instagram')) return '📸';
      if (type.includes('webwidget') || type.includes('widget') || type.includes('web')) return '🌐';
      if (type.includes('email')) return '✉️';
      if (type.includes('facebook') || type.includes('page')) return '👥';
      if (type.includes('telegram')) return '✈️';
      if (type.includes('api')) return '🔌';
      return '📥';
    }

    function getChannelPrettyName(channelType) {
      const type = (channelType || '').toLowerCase();
      if (type.includes('whatsapp')) return 'WhatsApp Business';
      if (type.includes('instagram')) return 'Instagram Direct';
      if (type.includes('webwidget')) return 'Web Widget Live Chat';
      if (type.includes('email')) return 'Email / Correo';
      if (type.includes('facebook')) return 'Facebook Messenger';
      if (type.includes('telegram')) return 'Telegram';
      if (type.includes('api')) return 'API Externa';
      return channelType || 'Canal';
    }

    async function loadUruchatConfig() {
      try {
        const res = await apiFetch(`${API_BASE}/configuracion`);
        const cfg = await res.json();
        document.getElementById('chatwoot-url-input').value = cfg.chatwoot_base_url || '';
        document.getElementById('chatwoot-token-input').value = cfg.chatwoot_api_token || '';
        if (document.getElementById('chatwoot-account-input')) {
          document.getElementById('chatwoot-account-input').value = cfg.chatwoot_account_id || '2';
        }

        const autoFarewell = cfg.auto_resolve_on_farewell !== 'false';
        const elFarewell = document.getElementById('auto-resolve-farewell-check');
        if (elFarewell) elFarewell.checked = autoFarewell;

        const elTimeout = document.getElementById('auto-resolve-timeout-input');
        if (elTimeout) elTimeout.value = cfg.auto_resolve_timeout_minutes ?? '15';

        const elLabel = document.getElementById('auto-resolve-label-input');
        if (elLabel) elLabel.value = cfg.auto_resolve_label || 'resuelto-bot';

        const elDerivAgent = document.getElementById('derivation-agent-id-input');
        if (elDerivAgent) {
          elDerivAgent.value = cfg.derivation_agent_id || cfg.chatwoot_default_assignee_id || '';
        }
        const elDerivLabel = document.getElementById('derivation-label-input');
        if (elDerivLabel) {
          elDerivLabel.value = cfg.derivation_label || 'derivar';
        }
        await loadUruchatAgents();

        let disabledList = [];
        if (cfg.canales_desactivados) {
          try {
            if (cfg.canales_desactivados.trim().startsWith('[')) {
              disabledList = JSON.parse(cfg.canales_desactivados);
            } else {
              disabledList = cfg.canales_desactivados.split(',').map(s => s.trim()).filter(Boolean);
            }
          } catch (_e) {
            disabledList = cfg.canales_desactivados.split(',').map(s => s.trim()).filter(Boolean);
          }
        }
        currentDisabledChannels = disabledList;
        await refreshUruchatInboxes();
      } catch (err) {
        console.error('Error cargando configuración de Uruchat / Canales:', err);
      }
    }

    async function refreshUruchatInboxes() {
      const container = document.getElementById('inboxes-list-container');
      const loader = document.getElementById('inboxes-loading');
      if (loader) loader.style.display = 'block';

      try {
        const res = await apiFetch(`${API_BASE}/chatwoot/inboxes`);
        const data = await res.json();
        currentInboxes = data.inboxes || [];
        renderInboxesList();
      } catch (err) {
        console.error('Error obteniendo inboxes de Uruchat:', err);
        if (container) {
          container.innerHTML = `<div style="color:var(--danger); grid-column:1/-1;">Error al consultar la API de Uruchat: ${escHtml(err.message)}</div>`;
        }
      } finally {
        if (loader) loader.style.display = 'none';
      }
    }

    function renderInboxesList() {
      const container = document.getElementById('inboxes-list-container');
      if (!container) return;

      if (!currentInboxes || currentInboxes.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); grid-column:1/-1;">No se encontraron bandejas configuradas en Uruchat.</div>';
        return;
      }

      container.innerHTML = currentInboxes.map(inbox => {
        const strId = String(inbox.id);
        const isNumericIdDisabled = currentDisabledChannels.includes(strId) || currentDisabledChannels.includes(`inbox:${strId}`);
        const isNameDisabled = currentDisabledChannels.some(d => String(d).toLowerCase() === String(inbox.name).toLowerCase());
        const isTypeDisabled = currentDisabledChannels.some(d => {
          const lower = String(d).toLowerCase();
          return lower && (String(inbox.channel_type).toLowerCase().includes(lower) || lower.includes(String(inbox.channel_type).toLowerCase()));
        });
        const isOff = isNumericIdDisabled || isNameDisabled || isTypeDisabled;

        const icon = getChannelIcon(inbox.channel_type);
        const prettyChannel = getChannelPrettyName(inbox.channel_type);
        const contactInfo = inbox.phone_number || inbox.email || (inbox.is_mock ? 'Modo Demostración / Offline' : 'Conectado');

        return `
          <div style="background:#f8fafc; padding:1.1rem; border-radius:0.6rem; border:1px solid ${isOff ? 'var(--danger)' : 'var(--border-subtle)'}; display:flex; flex-direction:column; justify-content:space-between;">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
                <div>
                  <span style="font-weight:700; font-size:1rem; color:var(--text-main);">${icon} ${escHtml(inbox.name)}</span>
                  <div style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;">
                    <strong>ID #${inbox.id}</strong> · <span>${escHtml(prettyChannel)}</span>
                  </div>
                </div>
                <span id="badge-inbox-${inbox.id}" class="badge ${isOff ? 'rechazado' : 'confirmado'}" style="font-size:0.75rem; white-space:nowrap;">
                  ${isOff ? '🔴 Solo Humanos' : '🟢 Bot Activo'}
                </span>
              </div>
              <p style="color:var(--text-muted); font-size:0.8rem; margin:0.6rem 0 0.8rem;">
                ${escHtml(contactInfo)}
              </p>
            </div>
            <div style="border-top:1px solid rgba(0,0,0,0.06); padding-top:0.6rem;">
              <label style="display:flex; align-items:center; gap:0.6rem; cursor:pointer; font-weight:normal; text-transform:none; margin:0;">
                <input type="checkbox" id="inbox-toggle-${inbox.id}" style="width:18px; height:18px; margin:0;" ${isOff ? 'checked' : ''} onchange="toggleInboxBot(${inbox.id})">
                <span style="font-size:0.85rem;"><strong>Apagar Bot</strong> (Atención 100% Humana)</span>
              </label>
            </div>
          </div>
        `;
      }).join('');
    }

    function toggleInboxBot(inboxId) {
      const checkbox = document.getElementById(`inbox-toggle-${inboxId}`);
      const badge = document.getElementById(`badge-inbox-${inboxId}`);
      if (!checkbox || !badge) return;

      const strId = String(inboxId);
      if (checkbox.checked) {
        badge.className = 'badge rechazado';
        badge.innerText = '🔴 Solo Humanos';
        if (!currentDisabledChannels.includes(strId)) {
          currentDisabledChannels.push(strId);
        }
      } else {
        badge.className = 'badge confirmado';
        badge.innerText = '🟢 Bot Activo';
        currentDisabledChannels = currentDisabledChannels.filter(id => String(id) !== strId && String(id) !== `inbox:${strId}`);
        const inbox = currentInboxes.find(i => i.id === inboxId);
        if (inbox) {
          currentDisabledChannels = currentDisabledChannels.filter(id => {
            const lower = String(id).toLowerCase();
            return lower !== String(inbox.name).toLowerCase() && !String(inbox.channel_type).toLowerCase().includes(lower);
          });
        }
      }
    }

    async function saveUruchatConfig() {
      const url = document.getElementById('chatwoot-url-input').value;
      const accountId = document.getElementById('chatwoot-account-input')?.value || '2';
      const token = document.getElementById('chatwoot-token-input').value;
      const autoFarewell = document.getElementById('auto-resolve-farewell-check')?.checked ? 'true' : 'false';
      const timeoutMins = document.getElementById('auto-resolve-timeout-input')?.value || '15';
      const label = document.getElementById('auto-resolve-label-input')?.value || 'resuelto-bot';

      if (url && url.trim()) {
        await apiFetch(`${API_BASE}/configuracion`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'chatwoot_base_url', value: url.trim() })
        });
      }
      await apiFetch(`${API_BASE}/configuracion`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'chatwoot_account_id', value: String(accountId).trim() })
      });
      if (token && token.trim()) {
        await apiFetch(`${API_BASE}/configuracion`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'chatwoot_api_token', value: token.trim() })
        });
      }
      await apiFetch(`${API_BASE}/configuracion`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'auto_resolve_on_farewell', value: autoFarewell })
      });
      await apiFetch(`${API_BASE}/configuracion`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'auto_resolve_timeout_minutes', value: timeoutMins })
      });
      await apiFetch(`${API_BASE}/configuracion`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'auto_resolve_label', value: label })
      });

      const derivAgentId = document.getElementById('derivation-agent-id-input')?.value?.trim();
      const derivLabel = document.getElementById('derivation-label-input')?.value?.trim() || 'derivar';

      if (derivAgentId) {
        await apiFetch(`${API_BASE}/configuracion`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'derivation_agent_id', value: derivAgentId })
        });
        await apiFetch(`${API_BASE}/configuracion`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'chatwoot_default_assignee_id', value: derivAgentId })
        });
      }
      await apiFetch(`${API_BASE}/configuracion`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'derivation_label', value: derivLabel })
      });

      alert('Configuración de Uruchat, Agente de Derivación y Resolución Automática guardada exitosamente.');
      await refreshUruchatInboxes();
      await loadUruchatAgents();
    }

    async function loadUruchatAgents() {
      const select = document.getElementById('derivation-agent-select');
      if (!select) return;
      try {
        const res = await apiFetch(`${API_BASE}/chatwoot/agents`);
        const data = await res.json();
        if (data.success && Array.isArray(data.agents) && data.agents.length > 0) {
          select.innerHTML = '<option value="">-- Seleccionar operador de Uruchat --</option>' +
            data.agents.map(a => `<option value="${a.id}">${a.name} (ID: ${a.id}${a.role ? ' · ' + a.role : ''})</option>`).join('');
          
          const currentId = document.getElementById('derivation-agent-id-input')?.value;
          if (currentId) {
            select.value = currentId;
          }
        } else {
          select.innerHTML = '<option value="">Sin agentes disponibles (ingrese ID manual)</option>';
        }
      } catch (err) {
        console.warn('No se pudieron cargar los agentes de Uruchat:', err);
        select.innerHTML = '<option value="">Ingrese ID manual</option>';
      }
    }

    function onSelectDerivationAgent(selectEl) {
      if (selectEl.value) {
        const input = document.getElementById('derivation-agent-id-input');
        if (input) input.value = selectEl.value;
      }
    }

    async function saveChannelConfig() {
      await apiFetch(`${API_BASE}/configuracion`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'canales_desactivados',
          value: JSON.stringify(currentDisabledChannels)
        })
      });
      alert(`Control de canales e inboxes guardado exitosamente.\nInboxes con bot apagado: ${currentDisabledChannels.length > 0 ? currentDisabledChannels.join(', ') : 'Ninguno (Bot activo en todos)'}`);
    }

    // --- DATASOURCE ---
    async function loadDataSourceConfig() {
      const res = await apiFetch(`${API_BASE}/configuracion`);
      const cfg = await res.json();
      document.getElementById('datasource-select').value = cfg.fuente_datos || 'scraping';
      document.getElementById('ds-sql-url').value = cfg.sql_directo_url || '';
      document.getElementById('ds-api-url').value = cfg.api_productos_url || '';
      document.getElementById('ds-api-key').value = cfg.api_productos_key || '';
      toggleDataSourceFields();
      loadProveedoresScraper();
    }

    function toggleDataSourceFields() {
      const v = document.getElementById('datasource-select').value;
      document.getElementById('ds-sql-fields').style.display = (v === 'sql_directo') ? 'block' : 'none';
      document.getElementById('ds-api-fields').style.display = (v === 'api') ? 'block' : 'none';
    }

    async function saveDataSourceConfig() {
      const fuente = document.getElementById('datasource-select').value;
      const sqlUrl = document.getElementById('ds-sql-url').value;
      const apiUrl = document.getElementById('ds-api-url').value;
      const apiKey = document.getElementById('ds-api-key').value;

      await apiFetch(`${API_BASE}/configuracion`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'fuente_datos', value: fuente })
      });
      await apiFetch(`${API_BASE}/configuracion`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'sql_directo_url', value: sqlUrl })
      });
      await apiFetch(`${API_BASE}/configuracion`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'api_productos_url', value: apiUrl })
      });
      await apiFetch(`${API_BASE}/configuracion`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'api_productos_key', value: apiKey })
      });
      alert('Estrategia de Ingestión guardada.');
    }

    // --- MULTI-SCRAPER & PROVEEDORES ---
    async function loadProveedoresScraper() {
      try {
        const res = await apiFetch(`${API_BASE}/proveedores-scraper`);
        const data = await res.json();
        const tbody = document.getElementById('proveedores-table-body');
        if (!tbody) return;

        if (!data.proveedores || data.proveedores.length === 0) {
          tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:1.5rem;">No hay proveedores registrados.</td></tr>';
          return;
        }

        tbody.innerHTML = data.proveedores.map(p => `
          <tr>
            <td>
              <span class="badge ${p.activo ? 'confirmado' : 'rechazado'}">
                ${p.activo ? 'Activo 🟢' : 'Inactivo ⚪'}
              </span>
            </td>
            <td>
              <strong>${escHtml(p.nombre)}</strong>
              <div style="font-size:0.75rem; color:var(--text-muted);">Código: <code>${escHtml(p.codigo)}</code></div>
            </td>
            <td>
              <input type="text" id="prov-sku-${p.codigo}" value="${escHtml(p.prefijo_sku || '')}" style="width:70px; padding:0.3rem; font-size:0.85rem; margin:0;">
            </td>
            <td>
              <div style="display:flex; align-items:center; gap:0.25rem;">
                <input type="number" step="0.5" id="prov-margen-${p.codigo}" value="${parseFloat(p.margen_porcentaje) || 0}" style="width:75px; padding:0.3rem; font-size:0.85rem; margin:0;">
                <span style="font-size:0.85rem; font-weight:700;">%</span>
              </div>
            </td>
            <td>
              <select id="prov-costo-iva-${p.codigo}" style="width:auto; padding:0.3rem; font-size:0.85rem; margin:0;">
                <option value="true" ${p.costo_incluye_iva ? 'selected' : ''}>Sí (IVA inc.)</option>
                <option value="false" ${!p.costo_incluye_iva ? 'selected' : ''}>No (Neto)</option>
              </select>
            </td>
            <td>
              <select id="prov-aplicar-iva-${p.codigo}" style="width:auto; padding:0.3rem; font-size:0.85rem; margin:0;">
                <option value="false" ${!p.aplicar_iva_venta ? 'selected' : ''}>No recargar</option>
                <option value="true" ${p.aplicar_iva_venta ? 'selected' : ''}>+22% IVA</option>
              </select>
            </td>
            <td>
              <select id="prov-moneda-${p.codigo}" style="width:auto; padding:0.3rem; font-size:0.85rem; margin:0;">
                <option value="UYU" ${p.moneda_defecto === 'UYU' ? 'selected' : ''}>UYU ($)</option>
                <option value="USD" ${p.moneda_defecto === 'USD' ? 'selected' : ''}>USD (U$S)</option>
              </select>
            </td>
            <td>
              <span style="font-weight:700; color:var(--primary); font-size:0.9rem;">
                ${p.total_productos_activos || 0}
              </span>
              <span style="font-size:0.75rem; color:var(--text-muted);">activos</span>
            </td>
            <td>
              <div style="display:flex; gap:0.35rem;">
                <button class="btn-action btn-primary" onclick="guardarProveedor('${p.codigo}')" style="padding:0.3rem 0.6rem; font-size:0.78rem;" title="Guardar configuración">💾</button>
                <button class="btn-action btn-success" onclick="recalcularPreciosProveedor('${p.codigo}')" style="padding:0.3rem 0.6rem; font-size:0.78rem;" title="Recalcular precios de este proveedor">⚡</button>
              </div>
            </td>
          </tr>
        `).join('');
      } catch (err) {
        console.error('Error cargando proveedores scraper:', err);
      }
    }

    async function guardarProveedor(codigo) {
      try {
        const prefijo = document.getElementById(`prov-sku-${codigo}`)?.value || '';
        const margen = parseFloat(document.getElementById(`prov-margen-${codigo}`)?.value) || 0;
        const costoIva = document.getElementById(`prov-costo-iva-${codigo}`)?.value === 'true';
        const aplicarIva = document.getElementById(`prov-aplicar-iva-${codigo}`)?.value === 'true';
        const moneda = document.getElementById(`prov-moneda-${codigo}`)?.value || 'UYU';

        const res = await apiFetch(`${API_BASE}/proveedores-scraper/${codigo}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prefijo_sku: prefijo,
            margen_porcentaje: margen,
            costo_incluye_iva: costoIva,
            aplicar_iva_venta: aplicarIva,
            moneda_defecto: moneda,
            activo: true
          })
        });

        if (res.ok) {
          alert(`Configuración guardada para proveedor ${codigo}.`);
          loadProveedoresScraper();
        } else {
          alert(`Error al guardar proveedor ${codigo}.`);
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    async function recalcularPreciosProveedor(codigo) {
      if (!confirm(`¿Deseas recalcular los precios de venta de todos los productos del proveedor "${codigo}" aplicando las reglas de margen e IVA vigentes?`)) return;
      try {
        const res = await apiFetch(`${API_BASE}/proveedores-scraper/${codigo}/recalcular-precios`, {
          method: 'POST'
        });
        const data = await res.json();
        if (res.ok) {
          alert(`¡Precios recalculados!\n${data.resultado.productos_actualizados} productos actualizados con margen del ${data.resultado.margen_aplicado}% e IVA ${data.resultado.iva_aplicado}%.`);
          loadProveedoresScraper();
          loadProducts();
        } else {
          alert(`Error: ${data.error || 'No se pudieron recalcular los precios'}`);
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    async function recalcularTodosPrecios() {
      if (!confirm('¿Deseas recalcular los precios de venta de TODOS los proveedores externos activos?')) return;
      try {
        const res = await apiFetch(`${API_BASE}/proveedores-scraper/recalcular-todos`, {
          method: 'POST'
        });
        const data = await res.json();
        if (res.ok) {
          const totalActualizados = (data.resultados || []).reduce((acc, r) => acc + (r.productos_actualizados || 0), 0);
          alert(`¡Recálculo completado en todos los proveedores!\nTotal productos recalculados: ${totalActualizados}`);
          loadProveedoresScraper();
          loadProducts();
        } else {
          alert(`Error: ${data.error || 'No se pudieron recalcular'}`);
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    // --- LLM & FAIL-SAFE ---
    async function loadLLMConfig() {
      try {
        const res = await apiFetch(`${API_BASE}/configuracion`);
        const cfg = await res.json();

        // Primary
        const prov = cfg.llm_provider || 'gemini';
        document.getElementById('llm-provider-select').value = prov;
        document.getElementById('llm-apikey-input').value = cfg.llm_api_key || '';
        document.getElementById('llm-baseurl-input').value = cfg.llm_base_url || '';

        // Fallback
        const failsafeActive = cfg.llm_failsafe_enabled !== 'false';
        const elFailsafe = document.getElementById('llm-failsafe-enabled-check');
        if (elFailsafe) elFailsafe.checked = failsafeActive;

        const fbProv = cfg.llm_fallback_provider || (prov === 'gemini' ? 'openai' : 'gemini');
        document.getElementById('llm-fallback-provider-select').value = fbProv;
        document.getElementById('llm-fallback-apikey-input').value = cfg.llm_fallback_api_key || '';
        document.getElementById('llm-fallback-baseurl-input').value = cfg.llm_fallback_base_url || '';

        await Promise.all([
          fetchAvailableModels(cfg.llm_model),
          fetchAvailableFallbackModels(cfg.llm_fallback_model),
        ]);
      } catch (err) {
        console.error('Error cargando configuración LLM:', err);
      }
    }

    async function fetchAvailableModels(selectedModelToPreserve = null) {
      const provider = document.getElementById('llm-provider-select').value;
      const apiKey = document.getElementById('llm-apikey-input').value;
      const baseUrl = document.getElementById('llm-baseurl-input').value;
      const modelSelect = document.getElementById('llm-model-select');
      const curVal = selectedModelToPreserve || modelSelect.value;
      modelSelect.innerHTML = '<option value="">Consultando modelos...</option>';
      try {
        const res = await apiFetch(`${API_BASE}/llm/models`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, apiKey, baseUrl })
        });
        const data = await res.json();
        if (data.models && data.models.length > 0) {
          modelSelect.innerHTML = data.models.map(m => `<option value="${escHtml(m.id)}" ${m.id === curVal ? 'selected' : ''}>${escHtml(m.name)} (${escHtml(m.id)})</option>`).join('');
          if (curVal && !data.models.some(m => m.id === curVal)) {
            modelSelect.insertAdjacentHTML('afterbegin', `<option value="${escHtml(curVal)}" selected>${escHtml(curVal)} (Actual)</option>`);
          }
        } else {
          const defVal = curVal || (provider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini');
          const defLabel = curVal || (provider === 'gemini' ? 'Gemini 1.5 Flash' : 'GPT-4o Mini');
          modelSelect.innerHTML = `<option value="${escHtml(defVal)}" selected>${escHtml(defLabel)}</option>`;
        }
      } catch (err) {
        const fbVal = curVal || 'gemini-1.5-flash';
        const fbLabel = curVal || 'Gemini 1.5 Flash';
        modelSelect.innerHTML = `<option value="${escHtml(fbVal)}" selected>${escHtml(fbLabel)}</option>`;
      }
    }

    async function fetchAvailableFallbackModels(selectedModelToPreserve = null) {
      const provider = document.getElementById('llm-fallback-provider-select').value;
      const apiKey = document.getElementById('llm-fallback-apikey-input').value;
      const baseUrl = document.getElementById('llm-fallback-baseurl-input').value;
      const modelSelect = document.getElementById('llm-fallback-model-select');
      const curVal = selectedModelToPreserve || modelSelect.value;
      modelSelect.innerHTML = '<option value="">Consultando modelos de respaldo...</option>';
      try {
        const res = await apiFetch(`${API_BASE}/llm/models`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, apiKey, baseUrl })
        });
        const data = await res.json();
        if (data.models && data.models.length > 0) {
          modelSelect.innerHTML = data.models.map(m => `<option value="${escHtml(m.id)}" ${m.id === curVal ? 'selected' : ''}>${escHtml(m.name)} (${escHtml(m.id)})</option>`).join('');
          if (curVal && !data.models.some(m => m.id === curVal)) {
            modelSelect.insertAdjacentHTML('afterbegin', `<option value="${escHtml(curVal)}" selected>${escHtml(curVal)} (Actual)</option>`);
          }
        } else {
          const defVal = curVal || (provider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini');
          const defLabel = curVal || (provider === 'gemini' ? 'Gemini 1.5 Flash' : 'GPT-4o Mini');
          modelSelect.innerHTML = `<option value="${escHtml(defVal)}" selected>${escHtml(defLabel)}</option>`;
        }
      } catch (err) {
        const fbVal = curVal || 'gpt-4o-mini';
        const fbLabel = curVal || 'GPT-4o Mini';
        modelSelect.innerHTML = `<option value="${escHtml(fbVal)}" selected>${escHtml(fbLabel)}</option>`;
      }
    }

    async function saveLLMConfig() {
      const provider = document.getElementById('llm-provider-select').value;
      const apiKey = document.getElementById('llm-apikey-input').value;
      const baseUrl = document.getElementById('llm-baseurl-input').value;
      const model = document.getElementById('llm-model-select').value;

      const fallbackEnabled = document.getElementById('llm-failsafe-enabled-check')?.checked ? 'true' : 'false';
      const fallbackProvider = document.getElementById('llm-fallback-provider-select').value;
      const fallbackApiKey = document.getElementById('llm-fallback-apikey-input').value;
      const fallbackBaseUrl = document.getElementById('llm-fallback-baseurl-input').value;
      const fallbackModel = document.getElementById('llm-fallback-model-select').value;

      await apiFetch(`${API_BASE}/llm/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          apiKey,
          baseUrl,
          fallbackProvider,
          fallbackModel,
          fallbackApiKey,
          fallbackBaseUrl,
          fallbackEnabled,
        })
      });
      alert(`Configuración de IA y Fail-Safe guardada exitosamente:\n• Principal: ${provider} (${model})\n• Respaldo: ${fallbackProvider} (${fallbackModel}) [${fallbackEnabled === 'true' ? 'Activo 🟢' : 'Inactivo 🔴'}]`);
    }

    // --- PEDIDOS & DEPOSITO ---
    let pedidosTakingEnabled = true;

    async function loadPedidos() {
      await loadPedidosToggleStatus();
      const res = await apiFetch(`${API_BASE}/pedidos`);
      currentPedidosList = await res.json();
      renderPedidos();
    }

    async function loadPedidosToggleStatus() {
      try {
        const res = await apiFetch(`${API_BASE}/pedidos/toggle-status`);
        const data = await res.json();
        pedidosTakingEnabled = data.enabled !== false;
        renderPedidosToggleUI();
      } catch (err) {
        console.error('Error cargando estado de toma de pedidos:', err);
      }
    }

    function renderPedidosToggleUI() {
      const badge = document.getElementById('pedidos-global-badge');
      const btn = document.getElementById('pedidos-toggle-action-btn');
      const select = document.getElementById('config-pedidos-enabled-select');

      if (badge) {
        badge.className = `badge ${pedidosTakingEnabled ? 'confirmado' : 'rechazado'}`;
        badge.innerHTML = pedidosTakingEnabled ? 'Habilitada 🟢' : 'Pausada 🔴';
      }
      if (btn) {
        btn.className = `btn-action ${pedidosTakingEnabled ? 'btn-danger' : 'btn-success'}`;
        btn.innerHTML = pedidosTakingEnabled ? '⏸️ Pausar Toma de Pedidos' : '▶️ Habilitar Toma de Pedidos';
      }
      if (select) {
        select.value = pedidosTakingEnabled ? 'true' : 'false';
      }
    }

    async function togglePedidosGlobal() {
      const targetState = !pedidosTakingEnabled;
      const confirmMsg = targetState
        ? '¿Deseas HABILITAR la toma de pedidos por IA en el chat?'
        : '¿Deseas PAUSAR la toma de pedidos por IA en el chat?\n(El bot orientará cordialmente a los clientes a comprar en kroser.com.uy o sucursales físicas)';
      if (!confirm(confirmMsg)) return;

      try {
        const res = await apiFetch(`${API_BASE}/pedidos/toggle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: targetState }),
        });
        const data = await res.json();
        pedidosTakingEnabled = data.enabled;
        renderPedidosToggleUI();
        alert(`Toma de pedidos ${pedidosTakingEnabled ? 'HABILITADA 🟢' : 'PAUSADA 🔴'}`);
      } catch (err) {
        alert('Error cambiando estado: ' + err.message);
      }
    }

    async function savePedidosToggleFromSelect() {
      const select = document.getElementById('config-pedidos-enabled-select');
      if (!select) return;
      const targetState = select.value === 'true';
      try {
        const res = await apiFetch(`${API_BASE}/pedidos/toggle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: targetState }),
        });
        const data = await res.json();
        pedidosTakingEnabled = data.enabled;
        renderPedidosToggleUI();
        alert(`Toma de pedidos ${pedidosTakingEnabled ? 'HABILITADA 🟢' : 'PAUSADA 🔴'}`);
      } catch (err) {
        alert('Error cambiando estado: ' + err.message);
      }
    }

    function filterPedidos(filter, event) {
      currentFilter = filter;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      if (event && event.target) event.target.classList.add('active');
      renderPedidos();
    }

    function renderPedidos() {
      let filtered = currentPedidosList;
      if (currentFilter === 'deposito') {
        filtered = currentPedidosList.filter(p => p.estado === 'confirmado' || p.estado === 'pendiente' || p.estado === 'en_preparacion');
      } else if (currentFilter === 'ecommerce') {
        filtered = currentPedidosList.filter(p => p.origen === 'ecommerce');
      } else if (currentFilter === 'bot') {
        filtered = currentPedidosList.filter(p => p.origen === 'bot' || !p.origen);
      } else if (currentFilter !== 'todos') {
        filtered = currentPedidosList.filter(p => p.estado === currentFilter);
      }

      const tbody = document.getElementById('pedidos-table-body');
      tbody.innerHTML = filtered.map(p => {
        const cliente = typeof p.cliente === 'string' ? JSON.parse(p.cliente) : (p.cliente || {});
        
        let origenBadge = '<span class="badge" style="background:#f3e8ff; color:#6b21a8;">🤖 Bot</span>';
        if (p.origen === 'ecommerce') {
          origenBadge = '<span class="badge" style="background:#e0f2fe; color:#0369a1;">🛒 Ecommerce</span>';
        } else if (p.origen === 'admin') {
          origenBadge = '<span class="badge" style="background:#f3f4f6; color:#374151;">👤 Admin</span>';
        }

        let pagoBadge = '<span class="badge" style="background:#f3f4f6; color:#6b7280;">—</span>';
        if (p.pago_estado === 'pagado') {
          pagoBadge = '<span class="badge" style="background:#dcfce7; color:#15803d;">💳 Pagado</span>';
        } else if (p.pago_estado === 'pendiente_pago') {
          pagoBadge = '<span class="badge" style="background:#fef3c7; color:#b45309;">⏳ Pendiente</span>';
        }

        return `
          <tr>
            <td>#${p.id}</td>
            <td>${origenBadge}</td>
            <td><strong>${escHtml(p.ecommerce_order_number || '-')}</strong></td>
            <td>${escHtml(p.conversation_id || '-')}</td>
            <td><strong>${escHtml(cliente.nombre || 'Cliente')}</strong></td>
            <td>${escHtml(cliente.telefono || cliente.whatsapp || '-')}</td>
            <td>${pagoBadge}</td>
            <td><span class="badge ${escHtml(p.estado)}">${escHtml(p.estado)}</span></td>
            <td>
              <button class="btn-action" onclick="viewPedidoDetails(${p.id})">👁️ Ver / Editar</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    async function viewPedidoDetails(id) {
      const p = currentPedidosList.find(item => item.id === id);
      if (!p) return;
      const cliente = typeof p.cliente === 'string' ? JSON.parse(p.cliente) : (p.cliente || {});
      const items = typeof p.items === 'string' ? JSON.parse(p.items) : (p.items || []);

      let html = `
        <div style="margin-bottom:1rem; background:#f8fafc; padding:1rem; border-radius:0.5rem; border:1px solid var(--border-subtle);">
          <p style="margin-bottom:0.3rem;"><strong>Pedido ID:</strong> #${p.id} ${p.ecommerce_order_number ? `(${escHtml(p.ecommerce_order_number)})` : ''} | <strong>Origen:</strong> ${escHtml(p.origen || 'bot')} | <strong>Estado:</strong> <span class="badge ${escHtml(p.estado)}">${escHtml(p.estado)}</span></p>
          <p style="margin-bottom:0.3rem;"><strong>Estado de Pago:</strong> ${escHtml(p.pago_estado || 'sin_pago')} ${p.pago_referencia ? `(Ref: ${escHtml(p.pago_referencia)})` : ''}</p>
          <p style="margin-bottom:0.3rem;"><strong>Cliente:</strong> ${escHtml(cliente.nombre || 'No especificado')} | <strong>Tel/WA:</strong> ${escHtml(cliente.telefono || cliente.whatsapp || 'No especificado')}</p>
          <p style="margin-bottom:0.3rem;"><strong>Email:</strong> ${escHtml(cliente.email || 'No especificado')}</p>
          <p><strong>Dirección:</strong> ${escHtml(cliente.direccion || 'Retiro en sucursal')}</p>
        </div>

        <h4 style="margin: 1rem 0 0.5rem;">📦 Productos Solicitados (Edición de Stock)</h4>
        <table id="pedido-items-table" style="margin-bottom:1rem; min-width:100%;">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Producto</th>
              <th>Cant</th>
              <th>Precio Unit.</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((item, idx) => `
              <tr id="item-row-${idx}">
                <td>${escHtml(item.sku || '-')}</td>
                <td>${escHtml(item.nombre || item.producto || 'Producto')}</td>
                <td><input type="number" id="item-cant-${idx}" value="${parseInt(item.cantidad, 10) || 1}" style="width:60px;" min="0"></td>
                <td>U$S ${parseFloat(item.precio) || 0}</td>
                <td><button class="btn-action btn-danger" onclick="removeItemRow(${idx})">🗑️ Quitar</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <label>Motivo de Modificación / Nota para la IA y el Cliente (ej. Sin stock del ítem X)</label>
        <textarea id="pedido-motivo-input" rows="2" placeholder="Indicar brevemente si falta stock o se modifica el pedido...">${escHtml(p.motivo_modificacion || '')}</textarea>

        <label>Notas Internas del Depósito</label>
        <textarea id="pedido-notas-input" rows="2" placeholder="Notas de empaque o preparación...">${escHtml(p.notas || '')}</textarea>

        <div style="margin-top:1.25rem; display:flex; gap:0.5rem; flex-wrap:wrap;">
          <button class="btn-action btn-success" onclick="savePedidoChanges(${p.id}, 'confirmado')">✅ Confirmar / Pedido Listo</button>
          <button class="btn-action btn-primary" onclick="savePedidoChanges(${p.id}, 'entregado')">🚚 Marcar Entregado</button>
          <button class="btn-action btn-danger" onclick="savePedidoChanges(${p.id}, 'rechazado')">❌ Rechazar Pedido</button>
          <button class="btn-action btn-secondary" onclick="savePedidoChanges(${p.id}, '${escHtml(p.estado)}')">💾 Guardar Cambios</button>
        </div>
      `;

      document.getElementById('modal-pedido-title').innerText = `Pedido #${p.id} — Gestión Depósito`;
      document.getElementById('modal-pedido-content').innerHTML = html;
      openModal('pedido-modal');
    }

    function removeItemRow(idx) {
      const row = document.getElementById(`item-row-${idx}`);
      if (row) row.remove();
    }

    async function savePedidoChanges(id, nuevoEstado) {
      const p = currentPedidosList.find(item => item.id === id);
      const originalItems = typeof p.items === 'string' ? JSON.parse(p.items) : (p.items || []);

      const newItems = [];
      originalItems.forEach((item, idx) => {
        const cantInput = document.getElementById(`item-cant-${idx}`);
        if (cantInput) {
          const cant = parseInt(cantInput.value, 10);
          if (cant > 0) {
            newItems.push({ ...item, cantidad: cant });
          }
        }
      });

      const motivo = document.getElementById('pedido-motivo-input').value;
      const notas = document.getElementById('pedido-notas-input').value;

      await apiFetch(`${API_BASE}/pedidos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          estado: nuevoEstado,
          items: newItems,
          motivo_modificacion: motivo,
          notas: notas
        })
      });

      alert(`Pedido #${id} actualizado correctamente.`);
      closeModal('pedido-modal');
      loadPedidos();
    }

    // --- CATALOGO (PAGINADO & BÚSQUEDA) ---
    let catalogCurrentPage = 1;
    let catalogTotalPages = 1;
    let catalogDebounceTimer = null;

    function debouncedLoadProducts() {
      clearTimeout(catalogDebounceTimer);
      catalogDebounceTimer = setTimeout(() => {
        loadProducts(1);
      }, 300);
    }

    function changeCatalogPage(delta) {
      const targetPage = catalogCurrentPage + delta;
      if (targetPage >= 1 && targetPage <= catalogTotalPages) {
        loadProducts(targetPage);
      }
    }

    async function loadProducts(page = 1) {
      catalogCurrentPage = page;
      const q = (document.getElementById('product-search')?.value || '').trim();
      const cat = (document.getElementById('product-category')?.value || '').trim();
      const fuente = (document.getElementById('product-fuente')?.value || '').trim();
      const limit = parseInt(document.getElementById('catalog-page-size')?.value || '50', 10);

      const params = new URLSearchParams({
        page: catalogCurrentPage,
        limit,
      });
      if (q) params.set('search', q);
      if (cat) params.set('categoria', cat);
      if (fuente) params.set('fuente_origen', fuente);

      const res = await apiFetch(`${API_BASE}/productos?${params.toString()}`);
      const data = await res.json();

      const items = Array.isArray(data) ? data : (data.items || []);
      const total = data.total !== undefined ? data.total : items.length;
      catalogTotalPages = data.totalPages || 1;

      const summaryEl = document.getElementById('catalog-summary-text');
      if (summaryEl) {
        summaryEl.innerText = `Total: ${total.toLocaleString()} productos vectorizados e indexados ($ UYU y U$S)`;
      }
      const pageInfoEl = document.getElementById('catalog-page-info');
      if (pageInfoEl) {
        pageInfoEl.innerText = `Página ${catalogCurrentPage} de ${catalogTotalPages}`;
      }
      const prevBtn = document.getElementById('btn-prev-page');
      if (prevBtn) prevBtn.disabled = catalogCurrentPage <= 1;
      const nextBtn = document.getElementById('btn-next-page');
      if (nextBtn) nextBtn.disabled = catalogCurrentPage >= catalogTotalPages;

      const tbody = document.getElementById('products-table-body');
      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:1.5rem;">No se encontraron productos coincidentes.</td></tr>`;
        return;
      }

      tbody.innerHTML = items.map(p => {
        const isUyu = (p.moneda || '').toUpperCase() === 'UYU' || (parseFloat(p.precio) >= 200 && (p.moneda || '').toUpperCase() !== 'USD');
        const priceLabel = isUyu ? `$ ${parseFloat(p.precio) || 0} UYU` : `U$S ${parseFloat(p.precio) || 0}`;
        const priceBadge = isUyu
          ? `<span class="badge" style="background:#fef3c7; color:#b45309;">${priceLabel}</span>`
          : `<span class="badge" style="background:#e0f2fe; color:#0369a1;">${priceLabel}</span>`;

        const costoInfo = p.precio_costo
          ? `<div><strong style="font-size:0.83rem;">$ ${parseFloat(p.precio_costo)}</strong><div style="font-size:0.71rem; color:var(--text-muted);">+${parseFloat(p.margen_aplicado) || 0}% mrg ${parseFloat(p.iva_aplicado) > 0 ? '+IVA' : ''}</div></div>`
          : `<span style="font-size:0.75rem; color:var(--text-muted);">-</span>`;

        const origenBadge = (p.fuente_origen && p.fuente_origen !== 'kroser')
          ? `<span class="badge" style="background:#f3e8ff; color:#7e22ce; font-weight:700;">${escHtml(p.fuente_origen.toUpperCase())}</span>`
          : `<span class="badge" style="background:#f1f5f9; color:#475569;">Kroser</span>`;

        return `
          <tr>
            <td><img src="${p.imagen_url || 'https://via.placeholder.com/45'}" class="img-thumb" alt="img" onerror="this.src='https://via.placeholder.com/45'"></td>
            <td><code>${escHtml(p.sku)}</code></td>
            <td><strong>${escHtml(p.nombre)}</strong></td>
            <td>${priceBadge}</td>
            <td>${costoInfo}</td>
            <td>${origenBadge}</td>
            <td><span style="font-size:0.8rem; color:var(--text-muted);">${escHtml(p.categoria || 'General')}</span></td>
            <td><span class="badge ${p.stock_status === 'in_stock' ? 'confirmado' : 'rechazado'}">${escHtml(p.stock_status)}</span></td>
            <td>
              ${p.producto_url ? `<a href="${escHtml(p.producto_url)}" target="_blank" class="btn-action" style="padding:0.35rem 0.65rem; font-size:0.75rem; text-decoration:none;">🔗 Ver Web</a>` : '-'}
            </td>
          </tr>
        `;
      }).join('');
    }

    // --- LOCALES ---
    async function loadLocales() {
      const res = await apiFetch(`${API_BASE}/locales`);
      const data = await res.json();
      const tbody = document.getElementById('locales-table-body');
      tbody.innerHTML = data.map(l => `
        <tr>
          <td>#${l.id}</td>
          <td><strong>${escHtml(l.nombre)}</strong></td>
          <td>${escHtml(l.zona)}</td>
          <td>${escHtml(l.direccion)}</td>
          <td>${escHtml(l.telefono)}</td>
          <td>${escHtml(l.horario)}</td>
          <td>
            <button class="btn-action" onclick='editLocal(${JSON.stringify(l)})'>✏️ Editar</button>
            <button class="btn-action btn-danger" onclick="deleteLocal(${l.id})">🗑️</button>
          </td>
        </tr>
      `).join('');
    }

    function openLocalModal(l = null) {
      document.getElementById('local-id').value = l ? l.id : '';
      document.getElementById('local-nombre').value = l ? l.nombre : '';
      document.getElementById('local-zona').value = l ? l.zona : '';
      document.getElementById('local-direccion').value = l ? l.direccion : '';
      document.getElementById('local-telefono').value = l ? l.telefono : '';
      document.getElementById('local-horario').value = l ? l.horario : '';
      document.getElementById('local-modal-title').innerText = l ? `Editar Sucursal #${l.id}` : 'Agregar Sucursal';
      openModal('local-modal');
    }

    function editLocal(l) { openLocalModal(l); }

    async function saveLocal() {
      const id = document.getElementById('local-id').value;
      const body = {
        nombre: document.getElementById('local-nombre').value,
        zona: document.getElementById('local-zona').value,
        direccion: document.getElementById('local-direccion').value,
        telefono: document.getElementById('local-telefono').value,
        horario: document.getElementById('local-horario').value,
      };
      if (id) {
        await apiFetch(`${API_BASE}/locales/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } else {
        await apiFetch(`${API_BASE}/locales`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      closeModal('local-modal');
      loadLocales();
    }

    async function deleteLocal(id) {
      if (!confirm(`¿Eliminar sucursal #${id}?`)) return;
      await apiFetch(`${API_BASE}/locales/${id}`, { method: 'DELETE' });
      loadLocales();
    }

    // --- CONTACTOS & AVISOS ---
    async function loadContactos() {
      const res = await apiFetch(`${API_BASE}/configuracion`);
      const cfg = await res.json();
      document.getElementById('aviso-email-input').value = cfg.aviso_email_pedido || '';
      document.getElementById('aviso-telefono-input').value = cfg.aviso_telefono_pedido || '';
    }

    async function saveContactosConfig() {
      const email = document.getElementById('aviso-email-input').value;
      const tel = document.getElementById('aviso-telefono-input').value;
      await apiFetch(`${API_BASE}/configuracion`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'aviso_email_pedido', value: email }) });
      await apiFetch(`${API_BASE}/configuracion`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'aviso_telefono_pedido', value: tel }) });
      alert('Contactos de alertas guardados.');
    }

    // --- ZONAS DE ENVIO ---
    async function loadZonas() {
      const res = await apiFetch(`${API_BASE}/zonas-envio`);
      const data = await res.json();
      const tbody = document.getElementById('zonas-table-body');
      tbody.innerHTML = data.map(z => `
        <tr>
          <td>#${z.id}</td>
          <td><strong>${escHtml(z.departamento_ciudad)}</strong></td>
          <td>${escHtml(z.barrio_zona)}</td>
          <td>$${z.costo_envio}</td>
          <td><span class="badge ${z.activo ? 'confirmado' : 'rechazado'}">${z.activo ? 'Activa' : 'Inactiva'}</span></td>
          <td>
            <button class="btn-action" onclick='editZona(${JSON.stringify(z)})'>✏️ Editar</button>
            <button class="btn-action btn-danger" onclick="deleteZona(${z.id})">🗑️</button>
          </td>
        </tr>
      `).join('');
    }

    function openZonaModal(z = null) {
      document.getElementById('zona-id').value = z ? z.id : '';
      document.getElementById('zona-depto').value = z ? z.departamento_ciudad : '';
      document.getElementById('zona-barrio').value = z ? z.barrio_zona : '';
      document.getElementById('zona-costo').value = z ? z.costo_envio : '';
      document.getElementById('zona-modal-title').innerText = z ? `Editar Zona #${z.id}` : 'Agregar Zona de Envío';
      openModal('zona-modal');
    }

    function editZona(z) { openZonaModal(z); }

    async function saveZona() {
      const id = document.getElementById('zona-id').value;
      const body = {
        departamento_ciudad: document.getElementById('zona-depto').value,
        barrio_zona: document.getElementById('zona-barrio').value,
        costo_envio: parseFloat(document.getElementById('zona-costo').value || 0),
      };
      if (id) {
        await apiFetch(`${API_BASE}/zonas-envio/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } else {
        await apiFetch(`${API_BASE}/zonas-envio`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      closeModal('zona-modal');
      loadZonas();
    }

    async function deleteZona(id) {
      if (!confirm(`¿Eliminar zona #${id}?`)) return;
      await apiFetch(`${API_BASE}/zonas-envio/${id}`, { method: 'DELETE' });
      loadZonas();
    }

    // --- FORMAS DE PAGO & MERCADOPAGO ---
    async function loadFormasPago() {
      const res = await apiFetch(`${API_BASE}/formas-pago`);
      const data = await res.json();
      const tbody = document.getElementById('pagos-table-body');
      tbody.innerHTML = data.map(f => `
        <tr>
          <td>#${f.id}</td>
          <td><strong>${escHtml(f.nombre)}</strong></td>
          <td>${escHtml(f.descripcion || '-')}</td>
          <td>${escHtml(f.instrucciones || '-')}</td>
          <td><span class="badge ${f.activo ? 'confirmado' : 'rechazado'}">${f.activo ? 'Activo' : 'Inactivo'}</span></td>
          <td>
            <button class="btn-action" onclick='editFormaPago(${JSON.stringify(f)})'>✏️ Editar</button>
            <button class="btn-action btn-danger" onclick="deleteFormaPago(${f.id})">🗑️</button>
          </td>
        </tr>
      `).join('');

      await loadMercadoPagoConfig();
    }

    async function loadMercadoPagoConfig() {
      try {
        const res = await apiFetch(`${API_BASE}/configuracion`);
        const cfg = await res.json();
        document.getElementById('mp-enabled-select').value = cfg.mercadopago_enabled === 'true' ? 'true' : 'false';
        document.getElementById('mp-access-token').value = cfg.mercadopago_access_token || '';
        document.getElementById('mp-public-key').value = cfg.mercadopago_public_key || '';
        document.getElementById('mp-webhook-secret').value = cfg.mercadopago_webhook_secret || '';
        document.getElementById('ecommerce-autoconfirm-check').checked = cfg.ecommerce_auto_confirm_paid !== 'false';
      } catch (err) { console.error('Error cargando config MP:', err); }
    }

    async function saveMPToggle() {
      const enabled = document.getElementById('mp-enabled-select').value === 'true';
      await apiFetch(`${API_BASE}/mercadopago/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      alert(`MercadoPago ${enabled ? 'ACTIVADO 🟢' : 'DESACTIVADO 🔴'}`);
    }

    async function saveMercadoPagoConfig() {
      const enabled = document.getElementById('mp-enabled-select').value === 'true';
      const token = document.getElementById('mp-access-token').value;
      const pubKey = document.getElementById('mp-public-key').value;
      const secret = document.getElementById('mp-webhook-secret').value;
      const autoConfirm = document.getElementById('ecommerce-autoconfirm-check').checked;

      await apiFetch(`${API_BASE}/mercadopago/toggle`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      await apiFetch(`${API_BASE}/configuracion`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'mercadopago_access_token', value: token })
      });
      await apiFetch(`${API_BASE}/configuracion`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'mercadopago_public_key', value: pubKey })
      });
      await apiFetch(`${API_BASE}/configuracion`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'mercadopago_webhook_secret', value: secret })
      });
      await apiFetch(`${API_BASE}/configuracion`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'ecommerce_auto_confirm_paid', value: autoConfirm ? 'true' : 'false' })
      });

      alert('Configuración de MercadoPago y E-commerce guardada exitosamente.');
    }

    function openFormaPagoModal(f = null) {
      document.getElementById('forma-id').value = f ? f.id : '';
      document.getElementById('forma-nombre').value = f ? f.nombre : '';
      document.getElementById('forma-desc').value = f ? f.descripcion : '';
      document.getElementById('forma-instrucciones').value = f ? f.instrucciones : '';
      document.getElementById('forma-modal-title').innerText = f ? `Editar Método #${f.id}` : 'Agregar Método de Pago';
      openModal('forma-pago-modal');
    }

    function editFormaPago(f) { openFormaPagoModal(f); }

    async function saveFormaPago() {
      const id = document.getElementById('forma-id').value;
      const body = {
        nombre: document.getElementById('forma-nombre').value,
        descripcion: document.getElementById('forma-desc').value,
        instrucciones: document.getElementById('forma-instrucciones').value,
      };
      if (id) {
        await apiFetch(`${API_BASE}/formas-pago/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } else {
        await apiFetch(`${API_BASE}/formas-pago`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      closeModal('forma-pago-modal');
      loadFormasPago();
    }

    async function deleteFormaPago(id) {
      if (!confirm(`¿Eliminar método #${id}?`)) return;
      await apiFetch(`${API_BASE}/formas-pago/${id}`, { method: 'DELETE' });
      loadFormasPago();
    }

    // --- GUÍAS TÉCNICAS & CÁLCULOS ---
    async function loadGuias() {
      try {
        const res = await apiFetch(`${API_BASE}/guias-tecnicas`);
        const data = await res.json();
        const tbody = document.getElementById('guias-table-body');
        if (!tbody) return;
        tbody.innerHTML = data.map(g => `
          <tr>
            <td>#${g.id}</td>
            <td><strong>${escHtml(g.titulo)}</strong></td>
            <td><span class="badge" style="background:#e0f2fe; color:#0369a1;">${escHtml(g.categoria)}</span></td>
            <td>
              <div style="font-size:0.83rem; font-weight:600; color:var(--text-main);">${escHtml(g.resumen || '-')}</div>
              <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">🔑 <em>${escHtml(g.keywords || '-')}</em></div>
            </td>
            <td><span class="badge ${g.activo ? 'confirmado' : 'rechazado'}">${g.activo ? 'Activa' : 'Inactiva'}</span></td>
            <td>
              <button class="btn-action" onclick='editGuia(${JSON.stringify(g).replace(/'/g, "&#39;")})'>✏️ Editar</button>
              <button class="btn-action btn-danger" onclick="deleteGuia(${g.id})">🗑️</button>
            </td>
          </tr>
        `).join('');
      } catch (err) {
        console.error('Error cargando guías técnicas:', err);
      }
    }

    function openGuiaModal(g = null) {
      document.getElementById('guia-id').value = g ? g.id : '';
      document.getElementById('guia-titulo').value = g ? g.titulo : '';
      document.getElementById('guia-categoria').value = g ? g.categoria : 'pintura';
      document.getElementById('guia-activo').value = g ? (g.activo ? 'true' : 'false') : 'true';
      document.getElementById('guia-resumen').value = g ? (g.resumen || '') : '';
      document.getElementById('guia-keywords').value = g ? (g.keywords || '') : '';
      document.getElementById('guia-contenido').value = g ? (g.contenido || '') : '';
      document.getElementById('guia-modal-title').innerText = g ? `Editar Guía Técnica #${g.id}` : 'Agregar Guía Técnica';
      openModal('guia-modal');
    }

    function editGuia(g) { openGuiaModal(g); }

    async function saveGuia() {
      const id = document.getElementById('guia-id').value;
      const body = {
        titulo: document.getElementById('guia-titulo').value.trim(),
        categoria: document.getElementById('guia-categoria').value,
        activo: document.getElementById('guia-activo').value === 'true',
        resumen: document.getElementById('guia-resumen').value.trim(),
        keywords: document.getElementById('guia-keywords').value.trim(),
        contenido: document.getElementById('guia-contenido').value.trim(),
      };
      if (!body.titulo || !body.contenido) {
        alert('Por favor ingrese título y contenido técnico.');
        return;
      }
      if (id) {
        await apiFetch(`${API_BASE}/guias-tecnicas/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } else {
        await apiFetch(`${API_BASE}/guias-tecnicas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      closeModal('guia-modal');
      loadGuias();
    }

    async function deleteGuia(id) {
      if (!confirm(`¿Eliminar guía técnica #${id}?`)) return;
      await apiFetch(`${API_BASE}/guias-tecnicas/${id}`, { method: 'DELETE' });
      loadGuias();
    }

    // --- SCRAPER ---
    async function loadScraperStatus() {
      const res = await apiFetch(`${API_BASE}/scraper/status`);
      const data = await res.json();
      document.getElementById('scraper-status').innerText = data.currentRun ? data.currentRun.status.toUpperCase() : 'Inactivo';
      loadEmbeddingsStatus();
    }

    async function startScraper() {
      await apiFetch(`${API_BASE}/scraper/start`, { method: 'POST' });
      loadScraperStatus();
    }

    async function stopScraper() {
      await apiFetch(`${API_BASE}/scraper/stop`, { method: 'POST' });
      loadScraperStatus();
    }

    // --- EMBEDDINGS VECTORIALES ---
    async function loadEmbeddingsStatus() {
      try {
        const res = await apiFetch(`${API_BASE}/scraper/embeddings/status`);
        if (!res.ok) return;
        const data = await res.json();

        const totalEl = document.getElementById('emb-total-activos');
        const vectEl = document.getElementById('emb-vectorizados');
        const pendEl = document.getElementById('emb-pendientes');
        const cobEl = document.getElementById('emb-cobertura');
        const badgeEl = document.getElementById('embeddings-provider-badge');

        if (totalEl) totalEl.innerText = (data.total_activos || 0).toLocaleString();
        if (vectEl) vectEl.innerText = (data.vectorizados || 0).toLocaleString();
        if (pendEl) pendEl.innerText = (data.pendientes || 0).toLocaleString();
        if (cobEl) cobEl.innerText = `${data.porcentaje_completado || 0}%`;

        if (badgeEl && data.provider) {
          const p = data.provider;
          if (p.isMock) {
            badgeEl.style.background = '#fef3c7';
            badgeEl.style.color = '#b45309';
            badgeEl.innerText = '⚠️ Mock Offline (768d)';
          } else {
            badgeEl.style.background = '#ecfdf5';
            badgeEl.style.color = '#047857';
            badgeEl.innerText = `🟢 ${p.primaryProvider.toUpperCase()} (${p.dimensions}d)`;
          }
        }

        const btnGen = document.getElementById('btn-generate-embeddings');
        if (btnGen) {
          if (data.is_running) {
            btnGen.disabled = true;
            btnGen.innerText = '⏳ Indexando en progreso...';
          } else {
            btnGen.disabled = (data.pendientes || 0) === 0;
            btnGen.innerText = (data.pendientes || 0) === 0 ? '✅ Todo Vectorizado' : '⚡ Indexar Productos Pendientes';
          }
        }
      } catch (err) {
        console.error('Error cargando estado de embeddings:', err);
      }
    }

    async function triggerEmbeddingsGeneration() {
      const msgEl = document.getElementById('embeddings-action-msg');
      if (msgEl) msgEl.innerText = 'Iniciando generación de vectores...';
      try {
        const res = await apiFetch(`${API_BASE}/scraper/embeddings/generate`, { method: 'POST' });
        const data = await res.json();
        if (msgEl) msgEl.innerText = data.message || 'Proceso iniciado';
        setTimeout(loadEmbeddingsStatus, 1500);
      } catch (err) {
        if (msgEl) msgEl.innerText = 'Error al iniciar indexación';
      }
    }

    // --- CATEGORÍAS & NIVELES DE DESCUENTO COTIBOT ---
    let adminCategoriasDescuento = [];

    async function loadCategoriasDescuento() {
      const tbody = document.getElementById('categorias-table-body');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:var(--text-muted);">Cargando categorías...</td></tr>';
      }
      try {
        const res = await apiFetch(`${API_BASE}/clientes/categorias`);
        const data = await res.json();
        adminCategoriasDescuento = data.categorias || [];

        renderCategoriasTable(adminCategoriasDescuento);
        renderCategoriasFilter(adminCategoriasDescuento);
      } catch (err) {
        if (tbody) {
          tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:var(--danger);">Error al cargar categorías: ${err.message}</td></tr>`;
        }
      }
    }

    function renderCategoriasTable(categorias) {
      const tbody = document.getElementById('categorias-table-body');
      if (!tbody) return;
      if (categorias.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:var(--text-muted);">No hay categorías configuradas. Haz clic en "+ Nueva Categoría".</td></tr>';
        return;
      }
      tbody.innerHTML = '';
      categorias.forEach(cat => {
        const isActivo = cat.activo !== false;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><code style="background:rgba(255,255,255,0.06); padding:0.2rem 0.4rem; border-radius:4px; font-weight:700;">${cat.codigo}</code></td>
          <td>
            <strong>${cat.nombre}</strong>
            ${cat.descripcion ? `<br><small style="color:var(--text-muted);">${cat.descripcion}</small>` : ''}
          </td>
          <td>
            <div style="display:flex; align-items:center; gap:0.35rem;">
              <input type="number" id="cat-desc-${cat.codigo}" value="${parseFloat(cat.descuento_porcentaje) || 0}" min="0" max="100" step="0.5" style="width:70px; padding:0.25rem 0.4rem; font-size:0.82rem; margin:0;">
              <button class="btn-action" style="padding:0.25rem 0.5rem; font-size:0.75rem;" title="Guardar descuento rápido" onclick="quickSaveCategoriaDiscount('${cat.codigo}')">💾</button>
            </div>
          </td>
          <td>
            <div style="display:flex; align-items:center; gap:0.25rem;">
              <input type="number" id="cat-orden-${cat.codigo}" value="${parseInt(cat.orden, 10) || 0}" min="0" style="width:55px; padding:0.25rem 0.35rem; font-size:0.82rem; margin:0;">
              <button class="btn-action" style="padding:0.25rem 0.45rem; font-size:0.72rem;" title="Guardar orden" onclick="quickSaveCategoriaOrden('${cat.codigo}')">💾</button>
            </div>
          </td>
          <td>
            <span class="badge ${isActivo ? 'confirmado' : 'rechazado'}" style="font-size:0.75rem;">
              ${isActivo ? 'Activa' : 'Inactiva'}
            </span>
          </td>
          <td>
            <div style="display:flex; gap:0.35rem; align-items:center;">
              <button class="btn-action" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="openEditarCategoriaModal('${cat.codigo}')">✏️</button>
              <button class="btn-action ${isActivo ? 'btn-danger' : 'btn-success'}" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="toggleCategoriaStatus('${cat.codigo}', ${!isActivo})">
                ${isActivo ? 'Desactivar' : 'Activar'}
              </button>
              <button class="btn-action btn-danger" style="padding:0.25rem 0.45rem; font-size:0.75rem;" title="Eliminar categoría" onclick="deleteCategoria('${cat.codigo}')">🗑️</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    function renderCategoriasFilter(categorias) {
      const select = document.getElementById('clientes-filter-categoria');
      if (!select) return;
      const currentVal = select.value;
      let html = '<option value="">Todas las categorías</option>';
      categorias.forEach(cat => {
        html += `<option value="${cat.codigo}" ${currentVal === cat.codigo ? 'selected' : ''}>${cat.nombre} (${parseFloat(cat.descuento_porcentaje) || 0}%)</option>`;
      });
      select.innerHTML = html;
    }

    function openNuevaCategoriaModal() {
      document.getElementById('categoria-modal-title').innerText = '🏷️ Nueva Categoría de Descuento';
      document.getElementById('categoria-form-is-edit').value = '0';
      const codInp = document.getElementById('categoria-form-codigo');
      codInp.value = '';
      codInp.disabled = false;
      document.getElementById('categoria-form-nombre').value = '';
      document.getElementById('categoria-form-descuento').value = '10';
      document.getElementById('categoria-form-orden').value = (adminCategoriasDescuento.length + 1) * 5;
      document.getElementById('categoria-form-descripcion').value = '';
      document.getElementById('categoria-form-activo').checked = true;
      openModal('categoria-modal');
    }

    function openEditarCategoriaModal(codigo) {
      const cat = adminCategoriasDescuento.find(c => c.codigo === codigo);
      if (!cat) return;
      document.getElementById('categoria-modal-title').innerText = `✏️ Editar Categoría: ${cat.nombre}`;
      document.getElementById('categoria-form-is-edit').value = '1';
      const codInp = document.getElementById('categoria-form-codigo');
      codInp.value = cat.codigo;
      codInp.disabled = true;
      document.getElementById('categoria-form-nombre').value = cat.nombre;
      document.getElementById('categoria-form-descuento').value = parseFloat(cat.descuento_porcentaje) || 0;
      document.getElementById('categoria-form-orden').value = parseInt(cat.orden, 10) || 0;
      document.getElementById('categoria-form-descripcion').value = cat.descripcion || '';
      document.getElementById('categoria-form-activo').checked = cat.activo !== false;
      openModal('categoria-modal');
    }

    async function saveCategoriaForm(event) {
      event.preventDefault();
      const isEdit = document.getElementById('categoria-form-is-edit').value === '1';
      const codigo = document.getElementById('categoria-form-codigo').value.trim().toLowerCase();
      const nombre = document.getElementById('categoria-form-nombre').value.trim();
      const descuento_porcentaje = parseFloat(document.getElementById('categoria-form-descuento').value) || 0;
      const orden = parseInt(document.getElementById('categoria-form-orden').value, 10) || 0;
      const descripcion = document.getElementById('categoria-form-descripcion').value.trim();
      const activo = document.getElementById('categoria-form-activo').checked;

      if (!nombre) {
        alert('Debe ingresar el nombre de la categoría');
        return;
      }

      try {
        let res;
        if (isEdit) {
          res = await apiFetch(`${API_BASE}/clientes/categorias/${encodeURIComponent(codigo)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre, descuento_porcentaje, orden, descripcion, activo }),
          });
        } else {
          if (!codigo) {
            alert('Debe ingresar un código único');
            return;
          }
          res = await apiFetch(`${API_BASE}/clientes/categorias`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codigo, nombre, descuento_porcentaje, orden, descripcion, activo }),
          });
        }

        const data = await res.json();
        if (res.ok) {
          closeModal('categoria-modal');
          await loadCategoriasDescuento();
          await loadClientesAdmin();
          alert(isEdit ? 'Categoría actualizada exitosamente' : 'Nueva categoría creada exitosamente');
        } else {
          alert(data.error || 'Error al guardar la categoría');
        }
      } catch (err) {
        alert('Error de conexión al guardar categoría');
      }
    }

    async function quickSaveCategoriaDiscount(codigo) {
      const input = document.getElementById(`cat-desc-${codigo}`);
      if (!input) return;
      const pct = parseFloat(input.value) || 0;
      try {
        const res = await apiFetch(`${API_BASE}/clientes/categorias/${encodeURIComponent(codigo)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ descuento_porcentaje: pct }),
        });
        if (res.ok) {
          await loadCategoriasDescuento();
          await loadClientesAdmin();
        } else {
          alert('Error al actualizar descuento base');
        }
      } catch (e) {
        alert('Error de conexión');
      }
    }

    async function quickSaveCategoriaOrden(codigo) {
      const input = document.getElementById(`cat-orden-${codigo}`);
      if (!input) return;
      const orden = parseInt(input.value, 10) || 0;
      try {
        const res = await apiFetch(`${API_BASE}/clientes/categorias/${encodeURIComponent(codigo)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orden }),
        });
        if (res.ok) {
          await loadCategoriasDescuento();
        } else {
          alert('Error al actualizar orden');
        }
      } catch (e) {
        alert('Error de conexión');
      }
    }

    async function toggleCategoriaStatus(codigo, newStatus) {
      try {
        const res = await apiFetch(`${API_BASE}/clientes/categorias/${encodeURIComponent(codigo)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activo: newStatus }),
        });
        if (res.ok) {
          await loadCategoriasDescuento();
          await loadClientesAdmin();
        } else {
          alert('Error al cambiar estado');
        }
      } catch (e) {
        alert('Error de conexión');
      }
    }

    async function deleteCategoria(codigo) {
      if (!confirm(`¿Está seguro de eliminar o desactivar la categoría '${codigo}'?`)) return;
      try {
        const res = await apiFetch(`${API_BASE}/clientes/categorias/${encodeURIComponent(codigo)}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (res.ok) {
          if (data.message) alert(data.message);
          await loadCategoriasDescuento();
          await loadClientesAdmin();
        } else {
          alert(data.error || 'Error al eliminar categoría');
        }
      } catch (e) {
        alert('Error de conexión');
      }
    }

    // --- CLIENTES & DESCUENTOS COTIBOT ---
    let clientesDebounceTimer;
    function debounceClientesSearch() {
      clearTimeout(clientesDebounceTimer);
      clientesDebounceTimer = setTimeout(() => {
        loadClientesAdmin();
      }, 350);
    }

    async function loadClientesAdmin() {
      const tbody = document.getElementById('clientes-table-body');
      if (!tbody) return;
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:1.5rem; color:var(--text-muted);">Cargando clientes...</td></tr>';

      try {
        if (adminCategoriasDescuento.length === 0) {
          const catRes = await apiFetch(`${API_BASE}/clientes/categorias`);
          const catData = await catRes.json();
          adminCategoriasDescuento = catData.categorias || [];
          renderCategoriasTable(adminCategoriasDescuento);
          renderCategoriasFilter(adminCategoriasDescuento);
        }

        const search = document.getElementById('clientes-search-input')?.value.trim() || '';
        const categoria = document.getElementById('clientes-filter-categoria')?.value || '';
        const params = new URLSearchParams();
        if (search) params.append('search', search);
        if (categoria) params.append('categoria', categoria);

        const res = await apiFetch(`${API_BASE}/clientes?${params.toString()}`);
        const data = await res.json();
        const items = data.items || [];

        if (items.length === 0) {
          tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:2rem; color:var(--text-muted);">No se encontraron clientes registrados.</td></tr>';
          return;
        }

        tbody.innerHTML = '';
        items.forEach(c => {
          const tr = document.createElement('tr');
          const isActivo = c.activo !== false;
          const currentCat = (c.categoria || 'minorista').toLowerCase();

          // Opciones de categoría dinámicas
          let optionsHtml = '';
          let matched = false;
          adminCategoriasDescuento.forEach(cat => {
            const isSel = cat.codigo === currentCat;
            if (isSel) matched = true;
            optionsHtml += `<option value="${cat.codigo}" ${isSel ? 'selected' : ''}>${cat.nombre} (${parseFloat(cat.descuento_porcentaje) || 0}%)</option>`;
          });
          if (!matched && currentCat) {
            optionsHtml += `<option value="${currentCat}" selected>${currentCat}</option>`;
          }

          tr.innerHTML = `
            <td><strong>#${c.id}</strong></td>
            <td>
              <strong>${c.nombre}</strong>
              ${c.empresa_razon_social ? `<br><small style="color:var(--text-muted)">${c.empresa_razon_social}</small>` : ''}
            </td>
            <td>${c.email}</td>
            <td>${c.rut_ci || '-'}</td>
            <td>${c.telefono || '-'}</td>
            <td>
              <select style="padding:0.3rem 0.5rem; font-size:0.8rem; margin:0; width:150px;" onchange="updateClienteTier(${c.id}, this.value)">
                ${optionsHtml}
              </select>
            </td>
            <td>
              <div style="display:flex; align-items:center; gap:0.25rem;">
                <input type="number" id="desc-inp-${c.id}" value="${parseFloat(c.descuento_porcentaje) || 0}" min="0" max="100" step="0.5" style="width:65px; padding:0.25rem 0.4rem; font-size:0.82rem; margin:0;">
                <button class="btn-action" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="saveClienteExactDiscount(${c.id})">💾</button>
              </div>
            </td>
            <td>
              <span class="badge ${isActivo ? 'confirmado' : 'rechazado'}" style="font-size:0.75rem;">
                ${isActivo ? 'Activo' : 'Inactivo'}
              </span>
            </td>
            <td>
              <button class="btn-action ${isActivo ? 'btn-danger' : 'btn-success'}" style="padding:0.25rem 0.55rem; font-size:0.75rem;" onclick="toggleClienteStatus(${c.id}, ${!isActivo})">
                ${isActivo ? 'Desactivar' : 'Activar'}
              </button>
            </td>
          `;
          tbody.appendChild(tr);
        });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:1.5rem; color:var(--danger);">Error al cargar clientes: ${err.message}</td></tr>`;
      }
    }

    async function updateClienteTier(id, newCategoria) {
      const found = adminCategoriasDescuento.find(cat => cat.codigo === newCategoria);
      const defaultPct = found ? (parseFloat(found.descuento_porcentaje) || 0) : 0;
      try {
        const res = await apiFetch(`${API_BASE}/clientes/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categoria: newCategoria, descuento_porcentaje: defaultPct }),
        });
        if (res.ok) {
          loadClientesAdmin();
        } else {
          alert('Error al actualizar categoría del cliente');
        }
      } catch (e) {
        alert('Error de conexión');
      }
    }

    async function saveClienteExactDiscount(id) {
      const input = document.getElementById(`desc-inp-${id}`);
      if (!input) return;
      const pct = parseFloat(input.value) || 0;
      try {
        const res = await apiFetch(`${API_BASE}/clientes/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ descuento_porcentaje: pct }),
        });
        if (res.ok) {
          alert('Descuento actualizado correctamente');
          loadClientesAdmin();
        } else {
          alert('Error al guardar descuento');
        }
      } catch (e) {
        alert('Error de conexión');
      }
    }

    async function toggleClienteStatus(id, newStatus) {
      try {
        const res = await apiFetch(`${API_BASE}/clientes/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activo: newStatus }),
        });
        if (res.ok) {
          loadClientesAdmin();
        }
      } catch (e) {
        alert('Error al cambiar estado del cliente');
      }
    }

    // --- BANNERS & PROMOCIONES ESPECIALES ---
    let currentPromocionesAdminList = [];

    async function loadPromocionesAdmin() {
      const tbody = document.getElementById('promociones-table-body');
      if (!tbody) return;
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:1.5rem; color:var(--text-muted);">Cargando promociones especiales...</td></tr>';

      try {
        let res = await apiFetch(`${API_BASE}/promociones/all`);
        if (!res.ok) {
          res = await fetch(`${API_BASE}/promociones`);
        }
        const data = await res.json();
        currentPromocionesAdminList = data.promociones || [];

        if (currentPromocionesAdminList.length === 0) {
          tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:2rem; color:var(--text-muted);">No hay promociones registradas. Haz clic en "+ Nueva Promoción" para crear una.</td></tr>';
          return;
        }

        tbody.innerHTML = currentPromocionesAdminList.map((p) => {
          const isActivo = p.activo !== false;
          const statusBadge = isActivo
            ? '<span class="badge confirmado" style="cursor:pointer;" onclick="togglePromocionAdmin(' + p.id + ')">🟢 Activa</span>'
            : '<span class="badge rechazado" style="cursor:pointer;" onclick="togglePromocionAdmin(' + p.id + ')">🔴 Inactiva</span>';

          const gradientLabels = {
            amber: '🔥 Ámbar',
            emerald: '🌿 Esmeralda',
            blue: '⚡ Azul',
            purple: '✨ Púrpura',
            red: '💥 Rojo',
          };

          const gradLabel = gradientLabels[p.gradiente] || p.gradiente || 'Ámbar';
          const descVal = p.descuento_porcentaje ? `${Math.round(p.descuento_porcentaje)}% OFF` : '-';
          const prodsCount = p.productos_count || (p.productos ? p.productos.length : 0);
          const skusSample = (p.productos_skus || []).slice(0, 3).join(', ');
          const skusExtra = (p.productos_skus || []).length > 3 ? '...' : '';

          return `
            <tr>
              <td>${statusBadge}</td>
              <td style="text-align:center;"><strong>${p.orden != null ? p.orden : 0}</strong></td>
              <td><span class="badge entregado">${escHtml(p.badge || 'OFERTA')}</span></td>
              <td><strong>${escHtml(p.titulo)}</strong></td>
              <td style="font-size:0.85rem; color:var(--text-muted); max-width:260px;">${escHtml(p.subtitulo || '-')}</td>
              <td><strong style="color:var(--success);">${descVal}</strong></td>
              <td>
                <strong style="color:var(--primary); font-size:0.85rem;">📦 ${prodsCount} prod${prodsCount === 1 ? '' : 's'}</strong>
                ${skusSample ? `<div style="font-size:0.75rem; color:var(--text-muted); font-family:monospace; margin-top:2px;">${escHtml(skusSample)}${skusExtra}</div>` : '<div style="font-size:0.75rem; color:var(--text-muted);">Sin productos asignados</div>'}
              </td>
              <td><span style="font-size:0.82rem; font-weight:600;">${gradLabel}</span></td>
              <td><span style="font-size:0.82rem; color:var(--primary); font-weight:600;">${escHtml(p.texto_boton || 'Ver Ofertas')}</span></td>
              <td>
                <div style="display:flex; gap:0.35rem;">
                  <button class="btn-action btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.78rem;" onclick="openPromoModal(${p.id})">✏️ Editar</button>
                  <button class="btn-action btn-danger" style="padding:0.25rem 0.5rem; font-size:0.78rem;" onclick="deletePromocionAdmin(${p.id})">🗑️</button>
                </div>
              </td>
            </tr>
          `;
        }).join('');
      } catch (err) {
        console.error('Error cargando promociones:', err);
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:1.5rem; color:var(--danger);">Error al cargar promociones especiales.</td></tr>';
      }
    }

    // --- GESTIÓN DE PRODUCTOS EN PROMOCIÓN (CONTROL TOTAL) ---
    let currentPromoSelectedProducts = [];
    let promoSearchDebounceTimer = null;

    function renderPromoSelectedProductsTable() {
      const tbody = document.getElementById('promo-selected-products-tbody');
      const countBadge = document.getElementById('promo-selected-count-badge');
      const discountInput = document.getElementById('promo-form-descuento');
      const discountPct = parseFloat(discountInput ? discountInput.value : 0) || 0;

      if (countBadge) {
        countBadge.textContent = `${currentPromoSelectedProducts.length} producto${currentPromoSelectedProducts.length === 1 ? '' : 's'}`;
      }

      if (!tbody) return;

      if (currentPromoSelectedProducts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1.25rem; color:var(--text-muted);">No has agregado productos a esta promoción aún.</td></tr>';
        return;
      }

      tbody.innerHTML = currentPromoSelectedProducts.map((p) => {
        const precioNormal = parseFloat(p.precio || p.precio_lista) || 0;
        const precioPromo = Math.round(precioNormal * (1 - discountPct / 100) * 100) / 100;
        const thumb = p.imagen_url ? `<img src="${escHtml(p.imagen_url)}" style="width:28px; height:28px; object-fit:cover; border-radius:4px; border:1px solid rgba(255,255,255,0.1);">` : '📦';
        const itemIdentifier = p.id ? p.id : `'${p.sku}'`;

        return `
          <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
            <td style="padding:0.4rem 0.5rem; display:flex; align-items:center; gap:0.5rem;">
              ${thumb}
              <div>
                <strong style="font-family:monospace; color:var(--primary);">${escHtml(p.sku || 'S/N')}</strong>
                <div style="font-size:0.75rem; color:var(--text-main); max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(p.nombre || 'Sin nombre')}</div>
              </div>
            </td>
            <td style="padding:0.4rem 0.5rem; font-family:monospace;">$ ${precioNormal.toFixed(2)}</td>
            <td style="padding:0.4rem 0.5rem;"><span class="badge warning" style="font-size:0.72rem;">-${discountPct}%</span></td>
            <td style="padding:0.4rem 0.5rem; font-family:monospace;"><strong style="color:var(--success);">$ ${precioPromo.toFixed(2)}</strong></td>
            <td style="padding:0.4rem 0.5rem; text-align:center;">
              <button type="button" class="btn-action btn-danger" style="padding:0.15rem 0.45rem; font-size:0.75rem;" onclick="removeProductFromPromo(${itemIdentifier})">✕</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    function removeProductFromPromo(idOrSku) {
      currentPromoSelectedProducts = currentPromoSelectedProducts.filter(p => p.id !== idOrSku && p.sku !== idOrSku);
      renderPromoSelectedProductsTable();
    }

    function handlePromoSearchProductInput(val) {
      clearTimeout(promoSearchDebounceTimer);
      const resultsBox = document.getElementById('promo-search-prod-results');
      if (!resultsBox) return;

      if (!val || val.trim().length < 2) {
        resultsBox.style.display = 'none';
        resultsBox.innerHTML = '';
        return;
      }

      promoSearchDebounceTimer = setTimeout(async () => {
        try {
          const res = await fetch(`${API_BASE}/productos?search=${encodeURIComponent(val.trim())}&limit=8`);
          const data = await res.json();
          const items = data.items || [];

          if (items.length === 0) {
            resultsBox.innerHTML = '<div style="padding:0.75rem; text-align:center; color:var(--text-muted); font-size:0.8rem;">No se encontraron artículos con ese nombre o SKU.</div>';
            resultsBox.style.display = 'block';
            return;
          }

          resultsBox.innerHTML = items.map((prod) => {
            const isAdded = currentPromoSelectedProducts.some(p => p.id === prod.id || (p.sku && prod.sku && p.sku === prod.sku));
            const btnText = isAdded ? '✓ Agregado' : '+ Agregar';
            const btnStyle = isAdded ? 'opacity:0.6; pointer-events:none;' : '';
            const thumb = prod.imagen_url ? `<img src="${escHtml(prod.imagen_url)}" style="width:28px; height:28px; object-fit:cover; border-radius:4px;">` : '📦';
            const jsonSafe = escHtml(JSON.stringify(prod));

            return `
              <div style="display:flex; align-items:center; justify-content:space-between; padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06); gap:0.5rem;">
                <div style="display:flex; align-items:center; gap:0.5rem; overflow:hidden;">
                  ${thumb}
                  <div>
                    <strong style="font-family:monospace; font-size:0.78rem; color:var(--primary);">${escHtml(prod.sku || '')}</strong>
                    <div style="font-size:0.78rem; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:320px;">${escHtml(prod.nombre)}</div>
                    <div style="font-size:0.72rem; color:var(--text-muted);">$ ${prod.precio} ${prod.moneda || 'UYU'}</div>
                  </div>
                </div>
                <button type="button" class="btn-action btn-success" style="padding:0.25rem 0.55rem; font-size:0.75rem; white-space:nowrap; ${btnStyle}" onclick='addSingleProductToPromoFromData(this)' data-prod="${jsonSafe}">${btnText}</button>
              </div>
            `;
          }).join('');
          resultsBox.style.display = 'block';
        } catch (_err) {
          resultsBox.innerHTML = '<div style="padding:0.75rem; text-align:center; color:var(--danger); font-size:0.8rem;">Error al buscar productos.</div>';
          resultsBox.style.display = 'block';
        }
      }, 250);
    }

    function addSingleProductToPromoFromData(btn) {
      try {
        const raw = btn.getAttribute('data-prod');
        const prod = JSON.parse(raw);
        if (!currentPromoSelectedProducts.some(p => p.id === prod.id || (p.sku && prod.sku && p.sku === prod.sku))) {
          currentPromoSelectedProducts.push(prod);
          renderPromoSelectedProductsTable();
        }
        const resultsBox = document.getElementById('promo-search-prod-results');
        if (resultsBox) resultsBox.style.display = 'none';
        const input = document.getElementById('promo-search-prod-input');
        if (input) input.value = '';
      } catch (err) {
        console.error('Error adding product to promo:', err);
      }
    }

    async function addSkusToPromoFromInput() {
      const input = document.getElementById('promo-skus-quick-input');
      if (!input) return;
      const raw = input.value.trim();
      if (!raw) return;

      const skus = raw.split(',').map(s => s.trim()).filter(Boolean);
      if (skus.length === 0) return;

      for (const sku of skus) {
        if (currentPromoSelectedProducts.some(p => p.sku && p.sku.toLowerCase() === sku.toLowerCase())) {
          continue;
        }
        try {
          const res = await fetch(`${API_BASE}/productos?search=${encodeURIComponent(sku)}&limit=1`);
          const data = await res.json();
          if (data.items && data.items.length > 0) {
            currentPromoSelectedProducts.push(data.items[0]);
          } else {
            currentPromoSelectedProducts.push({
              id: null,
              sku: sku,
              nombre: `SKU: ${sku}`,
              precio: 0,
            });
          }
        } catch (_e) {
          currentPromoSelectedProducts.push({
            id: null,
            sku: sku,
            nombre: `SKU: ${sku}`,
            precio: 0,
          });
        }
      }

      input.value = '';
      renderPromoSelectedProductsTable();
    }

    async function openPromoModal(promoId = null) {
      const modal = document.getElementById('promo-modal');
      const title = document.getElementById('promo-modal-title');
      const form = document.getElementById('form-promocion');
      if (!modal || !form) return;

      form.reset();
      document.getElementById('promo-form-id').value = '';
      document.getElementById('promo-form-activo').checked = true;
      document.getElementById('promo-form-orden').value = '1';
      document.getElementById('promo-form-gradiente').value = 'amber';
      currentPromoSelectedProducts = [];

      const resultsBox = document.getElementById('promo-search-prod-results');
      if (resultsBox) resultsBox.style.display = 'none';

      if (promoId) {
        let p = currentPromocionesAdminList.find((item) => Number(item.id) === Number(promoId));
        if (!p) {
          try {
            const res = await apiFetch(`${API_BASE}/promociones/all`);
            const data = await res.json();
            if (data.promociones) {
              currentPromocionesAdminList = data.promociones;
              p = currentPromocionesAdminList.find((item) => Number(item.id) === Number(promoId));
            }
          } catch (_e) {}
        }

        if (p) {
          title.textContent = '✏️ Editar Promoción Especial';
          document.getElementById('promo-form-id').value = p.id;
          document.getElementById('promo-form-titulo').value = p.titulo || '';
          document.getElementById('promo-form-subtitulo').value = p.subtitulo || '';
          document.getElementById('promo-form-badge').value = p.badge || '';
          document.getElementById('promo-form-descuento').value = p.descuento_porcentaje ? parseFloat(p.descuento_porcentaje) : 0;
          document.getElementById('promo-form-accion').value = p.link_accion || '';
          document.getElementById('promo-form-boton').value = p.texto_boton || '';
          document.getElementById('promo-form-gradiente').value = p.gradiente || 'amber';
          document.getElementById('promo-form-orden').value = p.orden != null ? p.orden : 1;
          document.getElementById('promo-form-activo').checked = p.activo !== false;

          if (p.productos && Array.isArray(p.productos)) {
            currentPromoSelectedProducts = [...p.productos];
          }
        }
      } else {
        title.textContent = '🎯 Cargar Nueva Promoción Especial';
      }

      renderPromoSelectedProductsTable();
      openModal('promo-modal');
    }

    async function savePromocionForm(event) {
      if (event) event.preventDefault();
      const id = document.getElementById('promo-form-id').value;
      const titulo = document.getElementById('promo-form-titulo').value.trim();
      if (!titulo) {
        alert('El título de la promoción es obligatorio');
        return;
      }

      const payload = {
        titulo,
        subtitulo: document.getElementById('promo-form-subtitulo').value.trim(),
        badge: document.getElementById('promo-form-badge').value.trim() || 'OFERTA ESPECIAL',
        descuento_porcentaje: parseFloat(document.getElementById('promo-form-descuento').value) || 0,
        link_accion: document.getElementById('promo-form-accion')?.value.trim() || '',
        texto_boton: document.getElementById('promo-form-boton').value.trim() || 'Ver Ofertas',
        gradiente: document.getElementById('promo-form-gradiente').value,
        orden: parseInt(document.getElementById('promo-form-orden').value, 10) || 0,
        activo: document.getElementById('promo-form-activo').checked,
        productos_ids: currentPromoSelectedProducts.map(p => p.id).filter(Boolean),
        productos_skus: currentPromoSelectedProducts.map(p => p.sku).filter(Boolean),
      };

      try {
        const url = id ? `${API_BASE}/promociones/${id}` : `${API_BASE}/promociones`;
        const method = id ? 'PUT' : 'POST';

        const res = await apiFetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (res.ok) {
          closeModal('promo-modal');
          alert(id ? 'Promoción y productos actualizados con éxito' : 'Promoción creada y productos asignados con éxito');
          loadPromocionesAdmin();
        } else {
          alert('Error: ' + (data.error || 'No se pudo guardar la promoción'));
        }
      } catch (err) {
        alert('Error de conexión: ' + err.message);
      }
    }

    async function togglePromocionAdmin(id) {
      try {
        const res = await apiFetch(`${API_BASE}/promociones/${id}/toggle`, {
          method: 'PATCH',
        });
        if (res.ok) {
          loadPromocionesAdmin();
        } else {
          alert('Error al alternar estado de la promoción');
        }
      } catch (err) {
        alert('Error de conexión: ' + err.message);
      }
    }

    async function deletePromocionAdmin(id) {
      if (!confirm('¿Estás seguro de que deseas eliminar esta promoción especial?')) return;
      try {
        const res = await apiFetch(`${API_BASE}/promociones/${id}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          loadPromocionesAdmin();
        } else {
          alert('Error al eliminar la promoción');
        }
      } catch (err) {
        alert('Error de conexión: ' + err.message);
      }
    }

    // Initialization on Page Load
    document.addEventListener('DOMContentLoaded', () => {
      loadDashboard();
      initSimulator();
      loadEmbeddingsStatus();
    });