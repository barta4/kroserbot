/**
 * ==========================================================================
 * COTIBOT — AI Assistant Interactive Chat Widget
 * Conversational Catalog Search, Technical Advisor & Instant Quoting
 * ==========================================================================
 */

(function () {
  const history = [];
  let isSending = false;
  let lastRecommendedProducts = [];
  let currentConvId = localStorage.getItem('kroser_coti_conv_id') || ('coti_web_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now());
  localStorage.setItem('kroser_coti_conv_id', currentConvId);

  // Multimodal state: Image and Audio voice notes
  let pendingImage = null; // { dataUrl, mimeType, name, size }
  let pendingAudio = null; // { dataUrl, mimeType, name, duration }
  let activeMediaRecorder = null;
  let recordingTimerInterval = null;
  let recordingSeconds = 0;
  let activeAudioStream = null;

  function hasPendingHeroMedia() {
    return Boolean(pendingImage || pendingAudio);
  }
  window.hasPendingHeroMedia = hasPendingHeroMedia;

  function clearMediaTray() {
    pendingImage = null;
    pendingAudio = null;
    const tray = document.getElementById('heroMediaTray');
    if (tray) tray.style.display = 'none';

    const imgCard = document.getElementById('heroImagePreviewCard');
    if (imgCard) imgCard.style.display = 'none';

    const voiceCard = document.getElementById('heroVoicePreviewCard');
    if (voiceCard) voiceCard.style.display = 'none';

    const voiceBar = document.getElementById('heroVoiceRecordingBar');
    if (voiceBar) voiceBar.style.display = 'none';

    const photoInput = document.getElementById('heroPhotoInput');
    if (photoInput) photoInput.value = '';

    const generalFileInput = document.getElementById('heroFileInput');
    if (generalFileInput) generalFileInput.value = '';

    const btnRecord = document.getElementById('btnHeroRecordVoice');
    if (btnRecord) btnRecord.classList.remove('active-recording');

    const btnSendCircle = document.getElementById('btnHeroSearch');
    if (btnSendCircle) btnSendCircle.classList.remove('has-content');

    if (window.updateSearchInputUI) window.updateSearchInputUI();
  }
  window.clearHeroMediaTray = clearMediaTray;

  function initChatWidget() {
    setupMultimodalEvents();
  }

  function setupMultimodalEvents() {
    // 0. Paperclip File Picker (Documents, Text Lists, Materials)
    const btnAttachFile = document.getElementById('btnHeroAttachFile');
    const heroFileInput = document.getElementById('heroFileInput');

    if (btnAttachFile && heroFileInput) {
      btnAttachFile.addEventListener('click', (e) => {
        e.preventDefault();
        heroFileInput.click();
      });

      heroFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        // If it's a plain text or CSV file, read its text and paste directly into input
        if (file.type.includes('text') || file.name.endsWith('.txt') || file.name.endsWith('.csv')) {
          const reader = new FileReader();
          reader.onload = function(evt) {
            const content = evt.target.result;
            const input = document.getElementById('heroSearchInput');
            if (input && content) {
              input.value = content;
              if (window.updateSearchInputUI) window.updateSearchInputUI();
              input.focus();
              const btnSend = document.getElementById('btnHeroSearch');
              if (btnSend) btnSend.classList.add('has-content');
            }
          };
          reader.readAsText(file);
          return;
        }

        // If it's an image, attach as visual piece
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = function(evt) {
            const dataUrl = evt.target.result;
            pendingImage = {
              dataUrl,
              mimeType: file.type || 'image/jpeg',
              name: file.name || 'foto_obra.jpg',
              size: file.size,
            };

            const tray = document.getElementById('heroMediaTray');
            const imgCard = document.getElementById('heroImagePreviewCard');
            const thumb = document.getElementById('heroImagePreviewThumb');
            const nameEl = document.getElementById('heroImagePreviewName');

            if (thumb) thumb.src = dataUrl;
            if (nameEl) nameEl.textContent = file.name || 'Foto adjunta';
            if (imgCard) imgCard.style.display = 'flex';
            if (tray) tray.style.display = 'flex';

            const btnSend = document.getElementById('btnHeroSearch');
            if (btnSend) btnSend.classList.add('has-content');
          };
          reader.readAsDataURL(file);
          return;
        }

        // For other files (PDF, DOC), read as data URL and attach
        const reader = new FileReader();
        reader.onload = function(evt) {
          pendingImage = {
            dataUrl: evt.target.result,
            mimeType: file.type || 'application/octet-stream',
            name: file.name || 'archivo_obra.pdf',
            size: file.size,
          };
          const tray = document.getElementById('heroMediaTray');
          const imgCard = document.getElementById('heroImagePreviewCard');
          const nameEl = document.getElementById('heroImagePreviewName');
          if (nameEl) nameEl.textContent = file.name || 'Documento adjunto';
          if (imgCard) imgCard.style.display = 'flex';
          if (tray) tray.style.display = 'flex';

          const btnSend = document.getElementById('btnHeroSearch');
          if (btnSend) btnSend.classList.add('has-content');
        };
        reader.readAsDataURL(file);
      });
    }

    // 1. Photo File Picker / Camera
    const btnAttachPhoto = document.getElementById('btnHeroAttachPhoto');
    const photoInput = document.getElementById('heroPhotoInput');
    const btnRemoveImg = document.getElementById('btnRemoveHeroImage');

    if (btnAttachPhoto && photoInput) {
      btnAttachPhoto.addEventListener('click', (e) => {
        e.preventDefault();
        photoInput.click();
      });

      photoInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
          alert('Por favor seleccione un archivo de imagen (JPG, PNG, WEBP, HEIC)');
          return;
        }

        const reader = new FileReader();
        reader.onload = function(evt) {
          const dataUrl = evt.target.result;
          pendingImage = {
            dataUrl,
            mimeType: file.type || 'image/jpeg',
            name: file.name || 'foto_repuesto.jpg',
            size: file.size,
          };

          const tray = document.getElementById('heroMediaTray');
          const imgCard = document.getElementById('heroImagePreviewCard');
          const thumb = document.getElementById('heroImagePreviewThumb');
          const nameEl = document.getElementById('heroImagePreviewName');

          if (thumb) thumb.src = dataUrl;
          if (nameEl) nameEl.textContent = file.name || 'Foto de repuesto';
          if (imgCard) imgCard.style.display = 'flex';
          if (tray) tray.style.display = 'flex';

          const btnSend = document.getElementById('btnHeroSearch');
          if (btnSend) btnSend.classList.add('has-content');

          const input = document.getElementById('heroSearchInput');
          if (input && !input.value.trim()) {
            input.placeholder = 'Agregue detalles o envíe para identificar el repuesto con Visual Parts...';
          }
        };
        reader.readAsDataURL(file);
      });
    }

    if (btnRemoveImg) {
      btnRemoveImg.addEventListener('click', (e) => {
        e.preventDefault();
        pendingImage = null;
        const imgCard = document.getElementById('heroImagePreviewCard');
        if (imgCard) imgCard.style.display = 'none';
        if (photoInput) photoInput.value = '';
        if (heroFileInput) heroFileInput.value = '';
        if (!pendingAudio) {
          const tray = document.getElementById('heroMediaTray');
          if (tray) tray.style.display = 'none';
          const input = document.getElementById('heroSearchInput');
          if (!input || !input.value.trim()) {
            const btnSend = document.getElementById('btnHeroSearch');
            if (btnSend) btnSend.classList.remove('has-content');
          }
        }
      });
    }

    // 2. Audio Voice Recording (MediaRecorder API)
    const btnRecordVoice = document.getElementById('btnHeroRecordVoice');
    const btnStopVoice = document.getElementById('btnStopHeroVoice');
    const btnCancelVoice = document.getElementById('btnCancelHeroVoice');
    const btnRemoveVoice = document.getElementById('btnRemoveHeroVoice');

    if (btnRecordVoice) {
      btnRecordVoice.addEventListener('click', (e) => {
        e.preventDefault();
        if (activeMediaRecorder && activeMediaRecorder.state === 'recording') {
          stopVoiceRecording(true);
        } else {
          startVoiceRecording();
        }
      });
    }

    if (btnStopVoice) {
      btnStopVoice.addEventListener('click', (e) => {
        e.preventDefault();
        stopVoiceRecording(true);
      });
    }

    if (btnCancelVoice) {
      btnCancelVoice.addEventListener('click', (e) => {
        e.preventDefault();
        stopVoiceRecording(false);
      });
    }

    if (btnRemoveVoice) {
      btnRemoveVoice.addEventListener('click', (e) => {
        e.preventDefault();
        pendingAudio = null;
        const voiceCard = document.getElementById('heroVoicePreviewCard');
        if (voiceCard) voiceCard.style.display = 'none';
        if (!pendingImage) {
          const tray = document.getElementById('heroMediaTray');
          if (tray) tray.style.display = 'none';
        }
      });
    }

    // 3. Paste and Drag & Drop Image support on search box
    const heroBox = document.getElementById('heroPromptBox');
    const heroInput = document.getElementById('heroSearchInput');

    if (heroInput) {
      heroInput.addEventListener('paste', (e) => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            const file = items[i].getAsFile();
            if (file) {
              const reader = new FileReader();
              reader.onload = (evt) => {
                pendingImage = {
                  dataUrl: evt.target.result,
                  mimeType: file.type || 'image/jpeg',
                  name: 'captura_pegada.png',
                  size: file.size,
                };
                const tray = document.getElementById('heroMediaTray');
                const imgCard = document.getElementById('heroImagePreviewCard');
                const thumb = document.getElementById('heroImagePreviewThumb');
                const nameEl = document.getElementById('heroImagePreviewName');
                if (thumb) thumb.src = evt.target.result;
                if (nameEl) nameEl.textContent = 'Imagen pegada';
                if (imgCard) imgCard.style.display = 'flex';
                if (tray) tray.style.display = 'flex';
              };
              reader.readAsDataURL(file);
            }
            break;
          }
        }
      });
    }

    if (heroBox) {
      heroBox.addEventListener('dragover', (e) => {
        e.preventDefault();
        heroBox.style.borderColor = '#0070eb';
      });
      heroBox.addEventListener('dragleave', () => {
        heroBox.style.borderColor = '';
      });
      heroBox.addEventListener('drop', (e) => {
        e.preventDefault();
        heroBox.style.borderColor = '';
        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files[0] && files[0].type.startsWith('image/')) {
          const file = files[0];
          const reader = new FileReader();
          reader.onload = (evt) => {
            pendingImage = {
              dataUrl: evt.target.result,
              mimeType: file.type || 'image/jpeg',
              name: file.name,
              size: file.size,
            };
            const tray = document.getElementById('heroMediaTray');
            const imgCard = document.getElementById('heroImagePreviewCard');
            const thumb = document.getElementById('heroImagePreviewThumb');
            const nameEl = document.getElementById('heroImagePreviewName');
            if (thumb) thumb.src = evt.target.result;
            if (nameEl) nameEl.textContent = file.name;
            if (imgCard) imgCard.style.display = 'flex';
            if (tray) tray.style.display = 'flex';
          };
          reader.readAsDataURL(file);
        }
      });
    }
  }

  async function startVoiceRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Su navegador no admite grabación de audio desde el micrófono.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      activeAudioStream = stream;

      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/ogg;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/mp4';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      activeMediaRecorder = recorder;
      const chunks = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        if (activeAudioStream) {
          activeAudioStream.getTracks().forEach((track) => track.stop());
          activeAudioStream = null;
        }

        if (recorder.__discard) {
          return;
        }

        const audioBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onload = (evt) => {
          const dataUrl = evt.target.result;
          pendingAudio = {
            dataUrl,
            mimeType: audioBlob.type || 'audio/webm',
            name: 'nota_de_voz.webm',
            duration: recordingSeconds,
          };

          const tray = document.getElementById('heroMediaTray');
          const voiceBar = document.getElementById('heroVoiceRecordingBar');
          const voiceCard = document.getElementById('heroVoicePreviewCard');
          const audioEl = document.getElementById('heroVoiceAudioPreview');

          if (voiceBar) voiceBar.style.display = 'none';
          if (audioEl) audioEl.src = dataUrl;
          if (voiceCard) voiceCard.style.display = 'flex';
          if (tray) tray.style.display = 'flex';

          const btnRecord = document.getElementById('btnHeroRecordVoice');
          if (btnRecord) btnRecord.classList.remove('active-recording');

          const input = document.getElementById('heroSearchInput');
          if (input && !input.value.trim()) {
            input.placeholder = 'Mensaje de voz listo. Presione Cotizar o agregue texto adicional...';
          }
        };
        reader.readAsDataURL(audioBlob);
      };

      recorder.start();
      recordingSeconds = 0;

      const tray = document.getElementById('heroMediaTray');
      const voiceBar = document.getElementById('heroVoiceRecordingBar');
      const voiceCard = document.getElementById('heroVoicePreviewCard');
      const timerEl = document.getElementById('heroVoiceTimer');
      const btnRecord = document.getElementById('btnHeroRecordVoice');

      if (tray) tray.style.display = 'flex';
      if (voiceBar) voiceBar.style.display = 'flex';
      if (voiceCard) voiceCard.style.display = 'none';
      if (btnRecord) btnRecord.classList.add('active-recording');
      if (timerEl) timerEl.textContent = '00:00';

      clearInterval(recordingTimerInterval);
      recordingTimerInterval = setInterval(() => {
        recordingSeconds++;
        const mins = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
        const secs = String(recordingSeconds % 60).padStart(2, '0');
        if (timerEl) timerEl.textContent = `${mins}:${secs}`;
      }, 1000);

    } catch (err) {
      console.warn('Microphone permission or access error:', err);
      alert('No se pudo acceder al micrófono. Por favor habilite los permisos en su navegador.');
    }
  }

  function stopVoiceRecording(save = true) {
    clearInterval(recordingTimerInterval);
    if (!activeMediaRecorder) return;

    if (!save) {
      activeMediaRecorder.__discard = true;
      const voiceBar = document.getElementById('heroVoiceRecordingBar');
      if (voiceBar) voiceBar.style.display = 'none';
      const btnRecord = document.getElementById('btnHeroRecordVoice');
      if (btnRecord) btnRecord.classList.remove('active-recording');
      if (!pendingImage) {
        const tray = document.getElementById('heroMediaTray');
        if (tray) tray.style.display = 'none';
      }
    }

    if (activeMediaRecorder.state === 'recording') {
      activeMediaRecorder.stop();
    }
  }

  let agentFocusReturnEl = null;

  function focusAgentInput() {
    setTimeout(() => {
      const input = document.getElementById('heroSearchInput');
      if (input) input.focus();
    }, 120);
  }

  function setAgentFocus(enabled) {
    const container = document.getElementById('heroChatContainer');
    const backdrop = document.getElementById('agentFocusBackdrop');
    const reopen = document.getElementById('btnAgentReopen');
    if (!container) return;

    const isEnabled = document.body.classList.contains('agent-focus');
    if (enabled === isEnabled) {
      if (enabled) focusAgentInput();
      return;
    }

    if (enabled) {
      agentFocusReturnEl = document.activeElement && document.activeElement !== document.body
        ? document.activeElement
        : null;

      document.body.classList.add('agent-focus');
      container.setAttribute('role', 'dialog');
      container.setAttribute('aria-modal', 'true');
      container.setAttribute('aria-label', 'Asistente Cotibot');
      if (backdrop) {
        backdrop.classList.add('show');
        backdrop.setAttribute('aria-hidden', 'false');
      }
      if (reopen) {
        reopen.classList.remove('visible');
        reopen.setAttribute('aria-expanded', 'true');
      }
      focusAgentInput();
    } else {
      const hasConversation = container.classList.contains('active-chat');

      document.body.classList.remove('agent-focus');
      container.removeAttribute('role');
      container.removeAttribute('aria-modal');
      container.removeAttribute('aria-label');
      if (backdrop) {
        backdrop.classList.remove('show');
        backdrop.setAttribute('aria-hidden', 'true');
      }
      if (reopen) {
        reopen.classList.toggle('visible', hasConversation);
        reopen.setAttribute('aria-expanded', 'false');
      }

      // Devolvemos el foco al punto de origen para no perder el contexto del teclado.
      const target = hasConversation && reopen ? reopen : agentFocusReturnEl;
      if (target && typeof target.focus === 'function' && document.body.contains(target)) {
        try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
      }
      agentFocusReturnEl = null;
    }
  }

  window.focusAgentChat = function focusAgentChat() {
    setAgentFocus(true);
  };

  window.minimizeAgentFocus = function minimizeAgentFocus() {
    setAgentFocus(false);
  };

  function ensureHeroCanvasVisible() {
    const container = document.getElementById('heroChatContainer');
    if (container) {
      container.classList.add('active-chat');
    }
    const header = document.getElementById('heroCanvasHeader');
    if (header) {
      header.style.display = 'flex';
    }
    const messages = document.getElementById('heroMessagesContainer');
    if (messages) {
      messages.style.display = 'flex';
    }
    const input = document.getElementById('heroSearchInput');
    if (input) {
      input.placeholder = 'Consulte otro artículo o responda para ajustar su presupuesto...';
    }
    // Si el catálogo quedó filtrado por una búsqueda previa, lo restauramos al iniciar el chat.
    if (window.AppState && window.AppState.searchQuery) {
      window.AppState.searchQuery = '';
      window.AppState.currentPage = 1;
      if (typeof window.loadProducts === 'function') window.loadProducts();
    }
    // Al iniciar la conversación, el chat pasa a foco central.
    setAgentFocus(true);
  }

  function resetHeroChat() {
    clearMediaTray();
    const container = document.getElementById('heroChatContainer');
    if (container) {
      container.classList.remove('active-chat');
    }
    setAgentFocus(false);
    const reopen = document.getElementById('btnAgentReopen');
    if (reopen) reopen.classList.remove('visible');
    const header = document.getElementById('heroCanvasHeader');
    if (header) {
      header.style.display = 'none';
    }
    const heroMessages = document.getElementById('heroMessagesContainer');
    if (heroMessages) {
      heroMessages.innerHTML = '';
      heroMessages.style.display = 'none';
    }
    const quickTags = document.getElementById('heroQuickTags');
    if (quickTags) {
      quickTags.style.display = 'flex';
    }
    history.length = 0;
    const input = document.getElementById('heroSearchInput');
    if (input) {
      input.value = '';
      input.placeholder = 'Ingrese producto, código, marca o pegue su lista de materiales para cotizar...';
      input.focus();
      if (window.updateSearchInputUI) window.updateSearchInputUI();
    }
  }
  window.resetHeroChat = resetHeroChat;

  function getActiveMessageContainers() {
    const list = [];
    const heroEl = document.getElementById('heroMessagesContainer');
    const modalEl = document.getElementById('chatMessagesContainer');
    if (heroEl) list.push(heroEl);
    if (modalEl) list.push(modalEl);
    return list;
  }

  function renderWelcomeGreeting() {
    const messagesEl = document.getElementById('chatMessagesContainer');
    if (!messagesEl || messagesEl.children.length > 0) return;

    const cliente = window.AppState ? window.AppState.cliente : null;
    let welcomeText = `¡Hola! Soy **Cotibot**, tu asistente de ferretería y cotizaciones de Kroser.`;

    if (cliente) {
      const pct = parseFloat(cliente.descuento_porcentaje) || 0;
      welcomeText += ` Veo que tienes tu cuenta **${cliente.categoria.toUpperCase()}** activa con **${pct}% de descuento**. ¿Qué artículos o materiales necesitas cotizar hoy?`;
    } else {
      welcomeText += ` Puedo ayudarte a encontrar productos, asesorarte sobre pinturas, herramientas o calcular tus cotizaciones al instante. ¿Qué estás buscando hoy?`;
    }

    const bubble = createBotBubbleElement(welcomeText, [
      '🎨 Pinturas para exteriores e impermeabilizantes',
      '🛠️ Taladros y herramientas eléctricas',
      '💧 Sanitaria, caños y canillas',
      '🚚 Consultar costos de envío',
    ]);
    messagesEl.appendChild(bubble);
  }

  async function handleChatSubmit(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('chatInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await executePrompt(text);
  }

  async function executePrompt(rawText) {
    if (isSending) return;
    const text = (rawText || '').trim();
    if (!text && !pendingImage && !pendingAudio) return;

    // Snapshot media attachments and clear composer tray
    const currentImage = pendingImage;
    const currentAudio = pendingAudio;
    clearMediaTray();

    // Make hero ChatGPT canvas active
    ensureHeroCanvasVisible();

    // Clear hero search textarea if it matches
    const heroInput = document.getElementById('heroSearchInput');
    if (heroInput) {
      heroInput.value = '';
      if (window.updateSearchInputUI) window.updateSearchInputUI();
    }
    const modalInput = document.getElementById('chatInput');
    if (modalInput) {
      modalInput.value = '';
    }

    // Detect if user wants to add one of the recently recommended products directly
    if (text) {
      const quickAddIdx = detectQuickAddIntent(text);
      if (quickAddIdx >= 0 && lastRecommendedProducts[quickAddIdx]) {
        const targetProd = lastRecommendedProducts[quickAddIdx];
        appendUserMessage(text);
        history.push({ role: 'user', content: text });

        window.quickAddFromChat(targetProd);
        const confirmReply = `¡Excelente! Agregué **${targetProd.nombre}** a tu cotización 🛒.\n\nPuedes abrir tu cotización arriba para verificarla o exportarla a WhatsApp, o pedirme cotización de cualquier otro material.`;
        history.push({ role: 'assistant', content: confirmReply });
        appendBotMessage(confirmReply);
        return;
      }
    }

    appendUserMessage(text, currentImage, currentAudio);
    const historySummary = text || (currentAudio ? '[Mensaje de voz enviado]' : '[Foto de repuesto enviada]');
    history.push({ role: 'user', content: historySummary });

    isSending = true;
    showTypingIndicator();

    try {
      const cliente = window.AppState ? window.AppState.cliente : null;
      
      const payloadAttachments = [];
      if (currentImage) {
        payloadAttachments.push({
          file_type: 'image',
          data_url: currentImage.dataUrl,
          content_type: currentImage.mimeType,
          name: currentImage.name,
        });
      }
      if (currentAudio) {
        payloadAttachments.push({
          file_type: 'audio',
          data_url: currentAudio.dataUrl,
          content_type: currentAudio.mimeType,
          name: currentAudio.name,
        });
      }

      const res = await fetch('/api/cotibot/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message: text,
          history: history.slice(-6),
          customerName: cliente ? cliente.nombre : 'Cliente Web',
          attachments: payloadAttachments,
          conversationId: currentConvId,
        }),
      });

      removeTypingIndicator();
      const data = await res.json();

      if (!res.ok) {
        appendBotMessage(data.error || 'Disculpa, no pude procesar tu consulta en este momento.');
        isSending = false;
        return;
      }

      if (data.conversationId) {
        currentConvId = data.conversationId;
        localStorage.setItem('kroser_coti_conv_id', currentConvId);
      }

      history.push({ role: 'assistant', content: data.reply });
      appendBotMessage(
        data.reply,
        data.chips || null,
        data.productos,
        data.isMaterialList,
        data.listaItems,
        data.totalEstimado,
        data.transcription || null,
        data.mediaAnalysis || null
      );
    } catch (err) {
      removeTypingIndicator();
      appendBotMessage('Ocurrió un error de conexión al consultar el asistente.');
    } finally {
      isSending = false;
      scrollChatToBottom();
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function appendUserMessage(text, image = null, audio = null) {
    const containers = getActiveMessageContainers();
    containers.forEach((container) => {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble user';

      let mediaHtml = '';
      if (image && image.dataUrl) {
        mediaHtml += `
          <div class="bubble-user-media">
            <img src="${image.dataUrl}" alt="Foto adjunta" class="bubble-user-img" onclick="window.open('${image.dataUrl}', '_blank')">
          </div>
        `;
      }
      if (audio && audio.dataUrl) {
        mediaHtml += `
          <div class="bubble-user-media">
            <div class="bubble-user-audio">
              <span>🎙️</span>
              <audio controls src="${audio.dataUrl}"></audio>
            </div>
          </div>
        `;
      }

      const textHtml = text ? `<div class="bubble-user-text">${escapeHtml(text)}</div>` : '';

      bubble.innerHTML = `
        <div class="bubble-sender-row">
          <span class="bubble-sender-icon">👤</span>
          <span class="bubble-sender-label">Su consulta</span>
        </div>
        ${mediaHtml}
        ${textHtml}
      `;
      container.appendChild(bubble);
    });
    scrollChatToBottom();
  }

  function createBotBubbleElement(
    text,
    chips = null,
    products = null,
    isMaterialList = false,
    listaItems = null,
    totalEstimado = 0,
    transcription = null,
    mediaAnalysis = null
  ) {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble bot';

    let badgesHtml = '';
    if (transcription) {
      badgesHtml += `<div class="bubble-transcription-pill">🎙️ Audio transcripto: <em>"${escapeHtml(transcription)}"</em></div>`;
    }
    if (mediaAnalysis && mediaAnalysis.identifiedParts && mediaAnalysis.identifiedParts.length > 0) {
      badgesHtml += `<div class="bubble-vision-badge">🔍 Pieza identificada: <strong>${escapeHtml(mediaAnalysis.identifiedParts[0])}</strong></div>`;
    }

    // Format basic markdown bolding
    const formatted = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    bubble.innerHTML = `
      <div class="bubble-sender-row">
        <span class="bubble-sender-icon">🏬</span>
        <span class="bubble-sender-label">Asesor Kroser Martínez</span>
      </div>
      ${badgesHtml}
      <div class="bubble-bot-text">${formatted}</div>
    `;

    // Chips
    if (chips && Array.isArray(chips)) {
      const chipsRow = document.createElement('div');
      chipsRow.className = 'chat-chips-row';
      chips.forEach((c) => {
        const chipBtn = document.createElement('button');
        chipBtn.className = 'chip-btn';
        chipBtn.textContent = c;
        chipBtn.onclick = () => {
          executePrompt(c);
        };
        chipsRow.appendChild(chipBtn);
      });
      bubble.appendChild(chipsRow);
    }

    // A) Multi-item material list quote card
    if (isMaterialList && listaItems && Array.isArray(listaItems) && listaItems.length > 0) {
      const listCard = document.createElement('div');
      listCard.className = 'chat-material-list-card';

      const foundItems = listaItems.filter((it) => it.encontrado);
      const totalCount = listaItems.length;

      const cardHeader = document.createElement('div');
      cardHeader.className = 'list-card-header';
      cardHeader.innerHTML = `<span>📋 Lista Cotizada (${foundItems.length}/${totalCount} disponibles)</span>`;
      listCard.appendChild(cardHeader);

      listaItems.forEach((it) => {
        const row = document.createElement('div');
        row.className = 'list-item-row';

        if (it.encontrado) {
          const qty = it.cantidad || 1;
          const subtotal = it.subtotal || (it.precio_final * qty);
          row.innerHTML = `
            <div style="display:flex; align-items:center; gap:0.4rem; flex:1; min-width:0;">
              <span class="list-item-qty">x${qty}</span>
              <span class="list-item-title" title="${it.nombre}">${it.nombre}</span>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem; flex-shrink:0;">
              <span class="list-item-subtotal">$ ${subtotal}</span>
            </div>
          `;

          const addSingleBtn = document.createElement('button');
          addSingleBtn.type = 'button';
          addSingleBtn.className = 'list-item-btn';
          addSingleBtn.innerHTML = '➕ Agregar';
          addSingleBtn.setAttribute('aria-label', `Agregar ${it.nombre || 'artículo'} a la cotización`);
          addSingleBtn.onclick = (e) => {
            e.preventDefault();
            if (window.addToQuote) {
              for (let i = 0; i < qty; i++) {
                window.addToQuote(it);
              }
            }
            addSingleBtn.innerHTML = '✓';
            addSingleBtn.style.background = '#22c55e';
            addSingleBtn.style.color = '#fff';
            setTimeout(() => {
              addSingleBtn.innerHTML = '➕ Agregar';
              addSingleBtn.style.background = '';
              addSingleBtn.style.color = '';
            }, 1800);
          };

          row.querySelector('div:last-child').appendChild(addSingleBtn);
        } else {
          row.innerHTML = `
            <div style="display:flex; align-items:center; gap:0.4rem; flex:1;">
              <span class="list-item-qty" style="color:#f87171; background:rgba(239,68,68,0.15);">x${it.cantidad || 1}</span>
              <span class="list-item-title" style="color:#94a3b8; font-style:italic;">"${it.solicitado}" (Consultar sucursal)</span>
            </div>
            <span class="list-item-subtotal" style="color:#94a3b8;">—</span>
          `;
        }
        listCard.appendChild(row);
      });

      if (foundItems.length > 0) {
        const footer = document.createElement('div');
        footer.className = 'list-card-footer';
        footer.innerHTML = `
          <div class="list-total-line">
            <span>Total Estimado:</span>
            <span class="total-val">$ ${(totalEstimado || 0).toFixed(2)} UYU</span>
          </div>
        `;

        const addAllBtn = document.createElement('button');
        addAllBtn.type = 'button';
        addAllBtn.className = 'btn-add-all-list';
        addAllBtn.innerHTML = `🛒 ➕ Agregar Toda la Lista a mi Cotización (${foundItems.length} artículos)`;
        addAllBtn.setAttribute('aria-label', `Agregar toda la lista de ${foundItems.length} artículos a la cotización`);
        addAllBtn.onclick = (e) => {
          e.preventDefault();
          foundItems.forEach((it) => {
            const qty = it.cantidad || 1;
            if (window.addToQuote) {
              for (let i = 0; i < qty; i++) {
                window.addToQuote(it);
              }
            }
          });
          addAllBtn.innerHTML = `✓ ¡Lista Completa Agregada!`;
          addAllBtn.style.background = '#22c55e';
          addAllBtn.style.color = '#ffffff';
          if (window.showToast) {
            window.showToast(`¡Agregados ${foundItems.length} artículos a tu cotización!`);
          }
          setTimeout(() => {
            addAllBtn.innerHTML = `🛒 ➕ Agregar Toda la Lista a mi Cotización`;
            addAllBtn.style.background = '';
            addAllBtn.style.color = '';
          }, 2400);
        };
        footer.appendChild(addAllBtn);
        listCard.appendChild(footer);
      }

      bubble.appendChild(listCard);
    }
    // B) Individual recommended products
    else if (products && Array.isArray(products) && products.length > 0) {
      products.slice(0, 6).forEach((p) => {
        const mini = document.createElement('div');
        mini.className = 'chat-product-mini';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'mini-title';
        titleDiv.textContent = p.nombre;

        const priceDiv = document.createElement('div');
        priceDiv.className = 'mini-price';
        priceDiv.textContent = p.precio_texto || (p.precio ? `$ ${p.precio} UYU` : '$ Consultar');

        const addBtn = document.createElement('button');
        addBtn.className = 'mini-btn';
        addBtn.type = 'button';
        addBtn.innerHTML = '➕ Agregar a Cotización';
        addBtn.setAttribute('aria-label', `Agregar ${p.nombre} a la cotización`);
        addBtn.onclick = (e) => {
          e.preventDefault();
          window.quickAddFromChat(p, addBtn);
        };

        mini.appendChild(titleDiv);
        mini.appendChild(priceDiv);
        mini.appendChild(addBtn);
        bubble.appendChild(mini);
      });
    }

    return bubble;
  }

  function appendBotMessage(
    text,
    chips = null,
    products = null,
    isMaterialList = false,
    listaItems = null,
    totalEstimado = 0,
    transcription = null,
    mediaAnalysis = null
  ) {
    if (products && Array.isArray(products) && products.length > 0) {
      lastRecommendedProducts = products;
    }

    const containers = getActiveMessageContainers();
    containers.forEach((container) => {
      const bubble = createBotBubbleElement(
        text,
        chips,
        products,
        isMaterialList,
        listaItems,
        totalEstimado,
        transcription,
        mediaAnalysis
      );
      container.appendChild(bubble);
    });
    scrollChatToBottom();
  }

  function detectQuickAddIntent(rawText) {
    if (!lastRecommendedProducts || lastRecommendedProducts.length === 0) return -1;
    if (!rawText || typeof rawText !== 'string') return -1;

    const clean = rawText
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

    // If message mentions units, materials, products, or pricing inquiries, it is NEVER a quick-add
    const isMaterialOrProductQuery = /\b(?:bolsas?|kilos?|kgs?|litros?|lts?|metros?|mts?|unidades?|tubos?|canos?|caños?|baldes?|latas?|cajas?|rollos?|planchas?|portland|cemento|arena|cal|hierro|varilla|ladrillo|bloque|pastina|adhesivo|membrana|pintura|esmalte|latex|barniz|taladro|amoladora|disco|pincel|rodillo|tornillos?|clavos?|tarugos?|tienen|precio|cuanto|cotizame)\b/i;
    if (isMaterialOrProductQuery.test(clean)) return -1;

    // Strict end-to-end matching for choosing option 1
    if (/^(?:(?:agrega|agregar|agregame|agregale|suma|sumar|sumame|inclui|incluir|poner|poneme)\s+)?(?:el\s+|la\s+|opcion\s+)?(?:primer[oa]|1|1ro|1er|uno)(?:\s+(?:articulo|producto|opcion))?(?:\s+(?:a|en)\s+(?:la\s+)?(?:cotizacion|presupuesto|carrito))?$/i.test(clean)) {
      return 0;
    }

    // Strict end-to-end matching for choosing option 2
    if (/^(?:(?:agrega|agregar|agregame|agregale|suma|sumar|sumame|inclui|incluir|poner|poneme)\s+)?(?:el\s+|la\s+|opcion\s+)?(?:segund[oa]|2|2do|2da|dos)(?:\s+(?:articulo|producto|opcion))?(?:\s+(?:a|en)\s+(?:la\s+)?(?:cotizacion|presupuesto|carrito))?$/i.test(clean)) {
      return 1;
    }

    // Strict end-to-end matching for choosing option 3
    if (/^(?:(?:agrega|agregar|agregame|agregale|suma|sumar|sumame|inclui|incluir|poner|poneme)\s+)?(?:el\s+|la\s+|opcion\s+)?(?:tercer[oa]|3|3ro|3ra|tres)(?:\s+(?:articulo|producto|opcion))?(?:\s+(?:a|en)\s+(?:la\s+)?(?:cotizacion|presupuesto|carrito))?$/i.test(clean)) {
      return 2;
    }

    // General add single item: "agregalo", "agregar a la cotizacion", "agrega este"
    if (/^(?:agrega|agregalo|agregar|agregala|agregalos|agrega este|agregame este)(?:\s+(?:a|en)\s+(?:la\s+)?(?:cotizacion|presupuesto|carrito))?$/i.test(clean)) {
      return 0;
    }

    return -1;
  }

  window.quickAddFromChat = function(productOrSku, btnElement) {
    let p = null;
    if (typeof productOrSku === 'object' && productOrSku !== null) {
      p = productOrSku;
    } else {
      const sku = String(productOrSku);
      if (window.AppState && window.AppState.products) {
        p = window.AppState.products.find((item) => item.sku === sku);
      }
      if (!p && lastRecommendedProducts.length > 0) {
        p = lastRecommendedProducts.find((item) => item.sku === sku);
      }
      if (!p) {
        p = { sku, nombre: 'Artículo Cotizado', precio: 0 };
      }
    }

    // Try extracting numeric price from precio_texto if precio_numerico is missing
    if (!p.precio_numerico && p.precio_texto) {
      const match = String(p.precio_texto).match(/[\d]+(?:[.,]\d+)?/);
      if (match) {
        p.precio_numerico = parseFloat(match[0].replace(',', '.'));
      }
    }

    if (window.addToQuote) {
      window.addToQuote(p);
    } else if (window.AppState) {
      const pId = p.id || Date.now();
      window.AppState.cart.push({
        id: pId,
        sku: p.sku || '',
        nombre: p.nombre,
        precio_lista: p.precio_numerico || 0,
        precio_final: p.precio_numerico || 0,
        ahorro_monto: 0,
        moneda: p.moneda || 'UYU',
        cantidad: 1,
      });
      if (window.saveCartToStorage) window.saveCartToStorage();
      if (window.updateCartBadge) window.updateCartBadge();
      if (window.renderQuoteDrawer) window.renderQuoteDrawer();
      if (window.showToast) window.showToast(`"${p.nombre}" agregado a tu cotización`);
    }

    // Visual button feedback
    if (btnElement) {
      const origText = btnElement.innerHTML;
      btnElement.innerHTML = '✓ ¡Agregado!';
      btnElement.style.background = '#22c55e';
      btnElement.style.color = '#ffffff';
      setTimeout(() => {
        btnElement.innerHTML = origText;
        btnElement.style.background = '';
        btnElement.style.color = '';
      }, 1800);
    }
  };

  function sendQuickPrompt(promptText) {
    executePrompt(promptText);
  }

  function showTypingIndicator() {
    const containers = getActiveMessageContainers();
    containers.forEach((container) => {
      const ind = document.createElement('div');
      ind.className = 'chat-bubble bot chat-typing-ind';
      ind.innerHTML = `
        <div class="bubble-sender-row">
          <span class="bubble-sender-icon">🏬</span>
          <span class="bubble-sender-label">Asesor Kroser Martínez</span>
        </div>
        <div style="font-style:italic; opacity:0.85;">Consultando catálogo y calculando precios de mostrador... ✍️</div>
      `;
      container.appendChild(ind);
    });
    scrollChatToBottom();
  }

  function removeTypingIndicator() {
    document.querySelectorAll('.chat-typing-ind').forEach((el) => el.remove());
  }

  function scrollChatToBottom() {
    const modalEl = document.getElementById('chatMessagesContainer');
    if (modalEl) {
      modalEl.scrollTop = modalEl.scrollHeight;
    }
    const heroEl = document.getElementById('heroMessagesContainer');
    if (heroEl) {
      heroEl.scrollTop = heroEl.scrollHeight;
    }
  }

  const agentFocusBackdrop = document.getElementById('agentFocusBackdrop');
  if (agentFocusBackdrop) {
    agentFocusBackdrop.addEventListener('click', () => setAgentFocus(false));
  }

  // Mantiene el foco del teclado dentro del chat cuando está en modo foco.
  function trapAgentFocus(event) {
    if (event.key !== 'Tab') return;
    const container = document.getElementById('heroChatContainer');
    if (!container) return;

    const focusables = Array.from(container.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    )).filter((el) => el.offsetParent !== null && !el.hasAttribute('hidden'));

    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', (event) => {
    if (!document.body.classList.contains('agent-focus')) return;
    // Dejamos que los modales (login, pedido) manejen sus propios atajos.
    if (document.querySelector('.auth-modal-backdrop.open, .quote-drawer.open')) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      setAgentFocus(false);
      return;
    }
    trapAgentFocus(event);
  });

  document.addEventListener('DOMContentLoaded', initChatWidget);

  window.submitHeroPrompt = executePrompt;
  window.submitHeroQuickPrompt = function(promptText) {
    const input = document.getElementById('heroSearchInput');
    if (input) {
      input.value = promptText;
      if (window.updateSearchInputUI) window.updateSearchInputUI();
    }
    executePrompt(promptText);
  };

  window.CotibotChat = {
    openChat: () => {
      const input = document.getElementById('heroSearchInput');
      if (input) {
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
    closeChat: () => {
      resetHeroChat();
    },
    toggleChat: () => {},
    sendMessage: (msg) => {
      executePrompt(msg);
    },
  };
})();
