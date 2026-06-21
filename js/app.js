(function () {
  'use strict';

  /* ==========================================================================
     STATE — RAM-only. No localStorage, no IndexedDB, no cookies.
     ========================================================================== */
  const S = {
    role: null,
    peer: null,
    conn: null,
    conns: [],
    code: null,
    lastActivity: Date.now(),
    destroyed: false,
    connected: false,
    connecting: false,
    guestCount: 0,

    /* ---- E2E Encryption ---- */
    encryptionKey: null,
    encryptionKeyB64: null,
    encryptionReady: false,

    /* ---- Host waiting state ---- */
    waitingForGuest: false,
    storedQR: null,

    /* ---- Reconnection ---- */
    reconnectAttempts: 0,
    maxReconnectAttempts: 3,
    reconnectTimerId: null,

    /* ---- Typing ---- */
    localTyping: false,
    peerTyping: false,
    typingThrottle: null,

    /* ---- Message tracking ---- */
    msgCounter: 0,
    pendingDeliveries: {},

    /* ---- Rate limiting ---- */
    rateLimitTokens: 10,
    rateLimitMax: 10,
    rateLimitInterval: null,

    /* ---- DOM message limit ---- */
    maxMessages: 200,
    msgElements: [],

    /* ---- Heartbeat ---- */
    heartbeatId: null,

    /* ---- PWA Install ---- */
    deferredPrompt: null,
    installDismissed: false,

    /* ---- SW Update ---- */
    swUpdateReg: null,

    /* ---- Date tracking ---- */
    lastMsgDate: null,

    /* ---- Names ---- */
    myName: '',
    peerName: '',
    pendingJoinCode: '',

    /* ---- Users tracking (host side) ---- */
    users: [],

    /* ---- Sound ---- */
    soundEnabled: true,
    audioCtx: null,

    /* ---- Theme ---- */
    theme: 'dark',

    /* ---- Scroll-to-bottom ---- */
    userScrolledUp: false,
  };

  /* Closure map for message text (avoids dataset attribute XSS surface) */
  var _msgTextMap = new WeakMap();
  var _connIdCounter = 0;

  /* ==========================================================================
     DOM CACHE
     ========================================================================== */
  const $ = (s) => document.querySelector(s);
  const D = {};

  function cacheDom() {
    D.landing       = $('#screen-landing');
    D.host          = $('#screen-host');
    D.join          = $('#screen-join');
    D.chat          = $('#screen-chat');
    D.hostCode      = $('#host-code');
    D.qrHost        = $('#qr-host');
    D.hostStatus    = $('#host-status');
    D.joinCodeDisp  = $('#join-code-display');
    D.joinCodeInput = $('#join-code-input');
    D.btnJoinSubmit = $('#btn-join-submit');
    D.chatCode      = $('#chat-code');
    D.encryptBadge  = $('#chat-encrypt-badge');
    D.chatDot       = $('#chat-status-dot');
    D.chatLabel     = $('#chat-status-label');
    D.msgs          = $('#chat-messages');
    D.input         = $('#chat-input');
    D.btnSend       = $('#btn-send');
    D.btnDestroy    = $('#btn-destroy');
    D.scanOverlay   = $('#scanner-overlay');
    D.scanVideo     = $('#scanner-video');
    D.scanCanvas    = $('#scanner-canvas');
    D.toast         = $('#toast');
    D.typingGuest   = $('#typing-indicator-guest');
    D.typingHost    = $('#typing-indicator-host');
    D.btnDetails    = $('#btn-details');
    D.detailsOverlay = $('#details-overlay');
    D.detailsCode   = $('#details-code-display');
    D.detailsQr     = $('#details-qr');
    D.btnDetailsClose = $('#btn-details-close');
    D.detailsBtnCopy  = $('#details-btn-copy');
    D.installBanner   = $('#install-banner');
    D.installBtn      = $('#install-btn');
    D.installDismiss  = $('#install-dismiss');
    D.swUpdateBanner  = $('#sw-update-banner');
    D.swUpdateBtn     = $('#sw-update-btn');
    D.swUpdateDismiss = $('#sw-update-dismiss');
    D.scrollBottomBtn = $('#scroll-bottom-btn');
    D.btnSoundToggle  = $('#btn-sound-toggle');
    D.peerNameEl      = $('#chat-peer-name');
    D.nameOverlay     = $('#name-overlay');
    D.nameInput       = $('#name-input');
    D.nameTitle       = $('#name-prompt-title');
    D.nameSubmit      = $('#name-submit');
    D.nameCancel      = $('#name-cancel');
    D.btnUsersPanel   = $('#btn-users-panel');
    D.usersOverlay    = $('#users-overlay');
    D.usersList       = $('#users-list');
    D.usersClose      = $('#btn-users-close');
  }

  /* ==========================================================================
     TOAST
     ========================================================================== */
  function toast(msg, type) {
    clearTimeout(S.toastTimeout);
    D.toast.textContent = msg;
    D.toast.className = 'toast' + (type ? ' ' + type : '');
    D.toast.classList.remove('hidden');
    S.toastTimeout = setTimeout(function () { D.toast.classList.add('hidden'); }, 3500);
  }

  /* ==========================================================================
     SOUND — Web Audio API notification chime
     ========================================================================== */
  function playNotification() {
    if (!S.soundEnabled) return;
    try {
      if (!S.audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        S.audioCtx = new AC();
      }
      if (S.audioCtx.state === 'suspended') {
        S.audioCtx.resume();
      }
      var osc = S.audioCtx.createOscillator();
      var gain = S.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(S.audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, S.audioCtx.currentTime);
      osc.frequency.setValueAtTime(1100, S.audioCtx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.15, S.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, S.audioCtx.currentTime + 0.2);
      osc.start(S.audioCtx.currentTime);
      osc.stop(S.audioCtx.currentTime + 0.2);
    } catch (_) {}
  }

  /* ==========================================================================
     SCREEN NAVIGATION
     ========================================================================== */
  var ALL_SCREENS = ['landing', 'host', 'join', 'chat'];

  function showScreen(name) {
    ALL_SCREENS.forEach(function (k) { D[k].classList.toggle('active', k === name); });
    /* Focus management for accessibility */
    var focusTarget = D[name] ? D[name].querySelector('[autofocus],[id$="-input"],[id^="btn-"]') : null;
    if (focusTarget) setTimeout(function () { focusTarget.focus(); }, 100);
  }

  /* ==========================================================================
     CAMERA — QR scanning
     ========================================================================== */
  function stopCamera() {
    if (S.cameraStream) {
      S.cameraStream.getTracks().forEach(function (t) { t.stop(); });
      S.cameraStream = null;
    }
    S.scannerActive = false;
    if (S.animFrameId) { cancelAnimationFrame(S.animFrameId); S.animFrameId = null; }
  }

  async function startScanner() {
    if (S.scannerActive) return;
    try {
      var stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 640, height: 640 },
      });
      S.cameraStream = stream;
      S.scannerActive = true;
      D.scanVideo.srcObject = stream;
      D.scanOverlay.classList.remove('hidden');
      await D.scanVideo.play();
      scanLoop();
    } catch (_) {
      toast('Camera unavailable. Enter the code manually.', 'error');
    }
  }

  function scanLoop() {
    if (!S.scannerActive) return;
    if (D.scanVideo.readyState < 2) {
      S.animFrameId = requestAnimationFrame(scanLoop);
      return;
    }
    var v = D.scanVideo;
    var c = D.scanCanvas;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    var ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0);
    var img = ctx.getImageData(0, 0, c.width, c.height);
    try {
      var found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (found && /^[0-9A-Z]{8}$/.test(found.data)) {
        stopCamera();
        D.scanOverlay.classList.add('hidden');
        joinWithCode(found.data);
        return;
      }
    } catch (_) {}
    S.animFrameId = requestAnimationFrame(scanLoop);
  }


  /* ==========================================================================
     JOIN CODE INPUT — Text input for 8-char alphanumeric code
     ========================================================================== */
  function renderCodePyramid(code, el) {
    el.textContent = '';
    if (!code) {
      var empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;letter-spacing:0.15em;opacity:0.2;font-family:var(--mono);font-size:1.6rem;line-height:1.6';
      empty.textContent = '\u2014 \u2014 \u2014 \u2014 \u2014 \u2014 \u2014 \u2014';
      el.appendChild(empty);
      return;
    }
    var chars = code.split('');
    var rows = [
      [chars[0]],
      [chars[1], chars[2]],
      [chars[3], chars[4], chars[5]],
      [chars[6], chars[7]],
    ];
    var container = document.createElement('div');
    container.className = 'code-pyramid';
    rows.forEach(function (row) {
      var rowEl = document.createElement('div');
      rowEl.className = 'pyramid-row';
      row.forEach(function (ch) {
        var span = document.createElement('span');
        span.className = 'pyramid-char' + (ch && ch !== ' ' ? ' filled' : '');
        span.textContent = ch || '\u00A0';
        rowEl.appendChild(span);
      });
      container.appendChild(rowEl);
    });
    el.appendChild(container);
  }

  function updateJoinDisp() {
    var val = D.joinCodeInput.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
    D.joinCodeInput.value = val;
    renderCodePyramid(val.padEnd(8, ' '), D.joinCodeDisp);
    D.btnJoinSubmit.disabled = val.length !== 8;
  }

  function onJoinCodeInput() {
    if (S.destroyed || S.connected || S.connecting) return;
    updateJoinDisp();
  }

  /* ==========================================================================
     QR GENERATION
     ========================================================================== */
  function genQR(code) {
    D.qrHost.textContent = '';
    try {
      new QRCode(D.qrHost, {
        text: code,
        width: 180, height: 180,
        colorDark: '#06060b',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
      });
    } catch (_) {
      var fallback = document.createElement('div');
      fallback.className = 'qr-placeholder';
      fallback.textContent = 'QR unavailable';
      D.qrHost.appendChild(fallback);
    }
  }

  /* ==========================================================================
     RATE LIMITING
     ========================================================================== */
  function initRateLimiter() {
    S.rateLimitTokens = S.rateLimitMax;
    if (S.rateLimitInterval) clearInterval(S.rateLimitInterval);
    S.rateLimitInterval = setInterval(function () {
      if (S.rateLimitTokens < S.rateLimitMax) S.rateLimitTokens++;
    }, 200);
  }

  function checkRateLimit() {
    if (S.rateLimitTokens <= 0) return false;
    S.rateLimitTokens--;
    return true;
  }

  function stopRateLimiter() {
    if (S.rateLimitInterval) { clearInterval(S.rateLimitInterval); S.rateLimitInterval = null; }
  }

  /* ==========================================================================
     E2E ENCRYPTION — AES-GCM via Web Crypto API
     ========================================================================== */
  async function generateEncryptionKey() {
    var key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    return key;
  }

  async function exportKey(key) {
    var raw = await crypto.subtle.exportKey('raw', key);
    return new Uint8Array(raw);
  }

  async function exportKeyBase64(key) {
    var raw = await crypto.subtle.exportKey('raw', key);
    return arrayBufferToBase64(new Uint8Array(raw).buffer);
  }

  async function importKey(rawBytes) {
    return crypto.subtle.importKey(
      'raw', rawBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  function arrayBufferToBase64(buf) {
    var binary = '';
    var bytes = new Uint8Array(buf);
    for (var i = 0; i < bytes.length; i++) { binary += String.fromCharCode(bytes[i]); }
    return btoa(binary);
  }

  function base64ToArrayBuffer(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
    return bytes.buffer;
  }

  async function encryptMessage(plaintext, key) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var encoded = new TextEncoder().encode(plaintext);
    var ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encoded
    );
    return { iv: arrayBufferToBase64(iv), data: arrayBufferToBase64(ciphertext) };
  }

  async function decryptMessage(payload, key) {
    var iv = base64ToArrayBuffer(payload.iv);
    var data = base64ToArrayBuffer(payload.data);
    var decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      data
    );
    return new TextDecoder().decode(decrypted);
  }

  /* ==========================================================================
     CHAT — DOM rendering (XSS-safe via textContent)
     ========================================================================== */
  function renderMsg(text, isMine, ts, msgId, deliveryStatus, fromName) {
    var w = document.createElement('div');
    w.className = 'msg ' + (isMine ? 'sent' : 'received');
    w.dataset.msgId = msgId || '';
    _msgTextMap.set(w, text);

    var senderName = '';
    if (isMine) {
      senderName = S.myName || '';
      if (senderName && S.role === 'host') senderName += ' (Host)';
    } else {
      senderName = fromName || S.peerName || '';
    }
    if (senderName) {
      var nameEl = document.createElement('span');
      nameEl.className = 'msg-sender';
      nameEl.textContent = senderName;
      w.appendChild(nameEl);
    }

    var t = document.createElement('pre');
    t.className = 'msg-text' + (text.indexOf('\n') !== -1 ? ' multiline' : '');
    t.textContent = text;
    w.appendChild(t);

    var footer = document.createElement('div');
    footer.className = 'msg-footer';

    var copyBtn = document.createElement('button');
    copyBtn.className = 'msg-copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.setAttribute('aria-label', 'Copy message');
    copyBtn.type = 'button';
    footer.appendChild(copyBtn);

    var meta = document.createElement('span');
    meta.className = 'timestamp';
    meta.title = new Date(ts).toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

    var time = document.createTextNode(new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    meta.appendChild(time);

    if (isMine && deliveryStatus) {
      var status = document.createElement('span');
      status.className = 'delivery-status ' + deliveryStatus + '-status';
      status.textContent = deliveryStatus === 'delivered' ? '\u2713\u2713' : (deliveryStatus === 'sent' ? '\u2713' : '');
      meta.appendChild(status);
    }

    footer.appendChild(meta);
    w.appendChild(footer);
    return w;
  }

  function addMsg(text, isMine, ts, msgId, deliveryStatus, fromName) {
    var empty = D.msgs.querySelector('.chat-empty');
    if (empty) empty.remove();

    var el = renderMsg(text, isMine, ts || Date.now(), msgId, deliveryStatus || '', fromName);
    D.msgs.appendChild(el);
    S.msgElements.push(el);

    /* Enforce message limit */
    while (S.msgElements.length > S.maxMessages) {
      var oldest = S.msgElements.shift();
      if (oldest && oldest.parentNode) oldest.parentNode.removeChild(oldest);
    }

    if (!S.userScrolledUp) D.msgs.scrollTop = D.msgs.scrollHeight;
    return el;
  }

  function updateDeliveryStatus(msgId, status) {
    if (!msgId) return;
    for (var i = S.msgElements.length - 1; i >= 0; i--) {
      var el = S.msgElements[i];
      if (el.dataset.msgId === msgId) {
        var meta = el.querySelector('.timestamp');
        if (!meta) return;
        var existing = meta.querySelector('.delivery-status');
        if (existing) existing.remove();
        var s = document.createElement('span');
        s.className = 'delivery-status ' + status + '-status';
        s.textContent = status === 'delivered' ? '\u2713\u2713' : (status === 'sent' ? '\u2713' : '');
        meta.appendChild(s);
        return;
      }
    }
  }

  /* ==========================================================================
     TYPING INDICATOR
     ========================================================================== */
  function showTyping(role) {
    var el = role === 'guest' ? D.typingGuest : D.typingHost;
    el.textContent = role === 'guest' ? 'Guest is typing\u2026' : 'You are typing\u2026';
    el.classList.add('visible');
    S.peerTyping = true;
  }

  function hideTyping(role) {
    var el = role === 'guest' ? D.typingGuest : D.typingHost;
    el.textContent = '';
    el.classList.remove('visible');
    S.peerTyping = false;
  }

  function onLocalInput() {
    if (!S.connected || S.destroyed) return;
    if (S.role !== 'host' && !S.conn) return;
    clearTimeout(S.typingThrottle);
    if (!S.localTyping) {
      S.localTyping = true;
      if (S.role === 'host') {
        S.conns.forEach(function (c) { try { c.send({ type: 'typing' }); } catch (_) {} });
      } else {
        try { S.conn.send({ type: 'typing' }); } catch (_) {}
      }
    }
    S.typingThrottle = setTimeout(function () {
      S.localTyping = false;
      if (S.connected) {
        if (S.role === 'host') {
          S.conns.forEach(function (c) { try { c.send({ type: 'stopped-typing' }); } catch (_) {} });
        } else if (S.conn) {
          try { S.conn.send({ type: 'stopped-typing' }); } catch (_) {}
        }
      }
    }, 1200);
  }

  /* ==========================================================================
     SEND MESSAGE
     ========================================================================== */
  async function sendMsg() {
    var text = D.input.value.trim();
    if (!text || !S.connected || S.destroyed) return;
    if (S.role !== 'host' && !S.conn) return;
    if (!checkRateLimit()) { toast('Slow down!', 'error'); return; }

    var msgId = 'm' + (++S.msgCounter) + '_' + Date.now();
    var timestamp = Date.now();

    var payload = { type: 'chat', text: text, timestamp: timestamp, id: msgId, sender: S.myName || 'Anonymous' };

    if (S.encryptionReady && S.encryptionKey) {
      try {
        var encrypted = await encryptMessage(text, S.encryptionKey);
        payload.text = '';
        payload.encrypted = encrypted;
      } catch (_) {
        toast('Encryption failed', 'error');
        return;
      }
    }

    if (S.role === 'host') {
      S.conns.forEach(function (c) { try { c.send(payload); } catch (_) {} });
    } else {
      try { S.conn.send(payload); } catch (_) { toast('Failed to send', 'error'); return; }
    }
    D.input.value = '';
    D.input.style.height = '';

    haptic(20);
    renderDateSeparator(timestamp);
    addMsg(text, true, timestamp, msgId, 'sent');
    S.pendingDeliveries[msgId] = { timer: setTimeout(function () {
      if (S.pendingDeliveries[msgId]) {
        delete S.pendingDeliveries[msgId];
        updateDeliveryStatus(msgId, 'sent');
      }
    }, 10000) };
    onActivity();
  }


  /* ==========================================================================
     ACTIVITY DETECTION — Resets inactivity fuse, syncs to peer
     ========================================================================== */
  function onActivity() {
    if (S.destroyed) return;
    if (!S.connected && !S.waitingForGuest) return;
    var prev = S.lastActivity;
    S.lastActivity = Date.now();
  }

  /* ==========================================================================
     RECONNECTION LOGIC
     ========================================================================== */
  function startReconnect() {
    if (S.destroyed || S.reconnectAttempts >= S.maxReconnectAttempts) {
      if (!S.destroyed) destroy('disconnect');
      return;
    }

    S.reconnectAttempts++;

    if (S.peer && !S.peer.destroyed) {
      var targetCode = S.code;
      var conn = S.peer.connect(targetCode, { reliable: true });

      var reconnectTimeout = setTimeout(function () {
        if (!S.connected) {
          try { conn.close(); } catch (_) {}
          startReconnect();
        }
      }, 3000);
      S.reconnectTimerId = reconnectTimeout;

      conn.on('open', function () {
        if (S.destroyed) { try { conn.close(); } catch (_) {} return; }
        clearTimeout(reconnectTimeout);
        S.reconnectTimerId = null;
        S.conn = conn;
        S.connected = true;
        S.reconnectAttempts = 0;
        S.lastActivity = Date.now();
        D.chatDot.className = 'status-dot connected';
        D.chatLabel.textContent = 'Connected';

        S.encryptionReady = false;

        /* Resend name on reconnect */
        if (S.myName) {
          try { conn.send({ type: 'name-exchange', name: S.myName }); } catch (_) {}
        }

        conn.on('data', makeConnHandler(conn));
        conn.on('close', function () { if (!S.destroyed) startReconnect(); });
        conn.on('error', function () {});
        toast('Reconnected!', 'success');
      });

      conn.on('error', function () {
        clearTimeout(reconnectTimeout);
        S.reconnectTimerId = null;
        startReconnect();
      });
    } else {
      /* No peer to reconnect with — stop retrying */
      if (!S.destroyed) destroy('disconnect');
    }
  }

  /* ==========================================================================
     ROOM DESTRUCTION — Cleans up everything, wipes state
     ========================================================================== */
  function destroy(reason) {
    if (S.destroyed) return;
    S.destroyed = true;

    if (S.role === 'host') {
      S.conns.forEach(function (c) {
        if (c && S.connected) {
          try { c.send({ type: 'room-destroy', reason: reason }); } catch (_) {}
        }
      });
    } else if (S.conn && S.connected) {
      try { S.conn.send({ type: 'room-destroy', reason: reason }); } catch (_) {}
    }

    hideDetails();
    cleanup();

    D.msgs.textContent = '';
    var emptyMsg = document.createElement('div');
    emptyMsg.className = 'chat-empty';
    emptyMsg.textContent = 'Room destroyed. Nothing was saved.';
    D.msgs.appendChild(emptyMsg);
    S.msgElements = [];
    S.peerName = '';
    S.users = [];
    updateChatHeader();
    if (D.btnUsersPanel) D.btnUsersPanel.classList.add('hidden');
    D.usersOverlay.classList.add('hidden');

    if (D.joinCodeInput) D.joinCodeInput.value = '';
    updateJoinDisp();

    renderCodePyramid('', D.hostCode);
    D.qrHost.textContent = '';
    var qrPlaceholder = document.createElement('div');
    qrPlaceholder.className = 'qr-placeholder';
    qrPlaceholder.textContent = 'Generating QR\u2026';
    D.qrHost.appendChild(qrPlaceholder);

    D.hostStatus.textContent = '';
    var dot = document.createElement('span');
    dot.className = 'pulse-dot';
    D.hostStatus.appendChild(dot);
    D.hostStatus.appendChild(document.createTextNode('Waiting for a guest\u2026'));

    var msgs = {
      inactivity: 'Room destroyed due to inactivity.',
      expired:    'Room lifetime expired (60 min).',
      manual:     'Room manually destroyed.',
      disconnect: 'Peer disconnected. Room destroyed.',
      'tab-closed': 'Tab closed. Room destroyed.',
    };
    showScreen('landing');
    toast(msgs[reason] || 'Room destroyed.', '');

    S.destroyed = false;
  }

  function cleanup() {
    if (S.heartbeatId) { clearInterval(S.heartbeatId); S.heartbeatId = null; }
    if (S.animFrameId) { cancelAnimationFrame(S.animFrameId); S.animFrameId = null; }
    if (S.reconnectTimerId) { clearTimeout(S.reconnectTimerId); S.reconnectTimerId = null; }
    if (S.typingThrottle) { clearTimeout(S.typingThrottle); S.typingThrottle = null; }
    if (S._usersRefreshInt) { clearInterval(S._usersRefreshInt); S._usersRefreshInt = null; }
    stopRateLimiter();
    stopCamera();
    S.conns.forEach(function (c) { try { c.close(); } catch (_) {} });
    S.conns = [];
    if (S.conn) { try { S.conn.close(); } catch (_) {} S.conn = null; }
    if (S.peer) { try { S.peer.destroy(); } catch (_) {} S.peer = null; }

    S.role = null;
    S.code = null;
    S.lastActivity = Date.now();
    S.connected = false;
    S.connecting = false;
    S.guestCount = 0;
    S.users = [];
    S.encryptionKey = null;
    S.encryptionKeyB64 = null;
    S.encryptionReady = false;
    S.reconnectAttempts = 0;
    S.peerTyping = false;
    S.localTyping = false;
    S.pendingDeliveries = {};
    S.msgCounter = 0;
    S.waitingForGuest = false;
    S.storedQR = null;

    hideTyping('guest');
    hideTyping('host');
    S.cameraStream = null;
    S.scannerActive = false;
    D.detailsQr.textContent = '';
  }

  /* ==========================================================================
     WEBRTC — PeerJS connection
     ========================================================================== */
  function peerOpts() {
    return {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
          {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
          {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
        ],
      },
    };
  }

  var CODE_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function genCode() {
    var arr = new Uint32Array(8);
    crypto.getRandomValues(arr);
    var code = '';
    for (var i = 0; i < 8; i++) code += CODE_CHARS[arr[i] % 36];
    return code;
  }

  /* ==========================================================================
     DATA CHANNEL MESSAGE ROUTER (Per-Connection)
     ========================================================================== */
  function makeConnHandler(conn) {
    return async function (data) {
      if (S.destroyed) return;
      if (!data || typeof data !== 'object') return;

      var msgType = String(data.type || '').toLowerCase().trim();
      if (msgType.length === 0 || msgType.length > 50) return;

      try {
        switch (msgType) {
          case 'chat': {
            onActivity();
            var text;
            if (data.encrypted && S.encryptionReady && S.encryptionKey) {
              try {
                text = await decryptMessage(data.encrypted, S.encryptionKey);
              } catch (e) {
                handleError('decrypt', e);
                text = '[Decryption failed]';
              }
            } else {
              text = String(data.text || '');
            }
            if (!text || text.length === 0) text = '[Encrypted message]';
            if (text.length > 50000) text = text.substring(0, 50000);

            haptic(15);
            renderDateSeparator(data.timestamp || Date.now());
            var senderName = data.sender || conn._name || 'Guest';
            addMsg(text, false, data.timestamp || Date.now(), data.id, null, senderName);
            playNotification();

            if (conn._uid) incrementUserMsgCount(conn._uid);

            if (data.id && conn) {
              try { conn.send({ type: 'delivered', id: data.id }); } catch (_) {}
            }
            break;
          }

          case 'delivered': {
            if (data.id && S.pendingDeliveries[data.id]) {
              clearTimeout(S.pendingDeliveries[data.id].timer);
              delete S.pendingDeliveries[data.id];
              updateDeliveryStatus(data.id, 'delivered');
            }
            break;
          }

          case 'room-destroy': {
            if (!S.destroyed) destroy(String(data.reason || 'remote').substring(0, 50));
            break;
          }

          case 'name-exchange': {
            if (data.name && typeof data.name === 'string') {
              conn._name = data.name.substring(0, 100);
              if (S.role === 'host') {
                if (S.guestCount === 1) {
                  S.peerName = conn._name;
                  updateChatHeader();
                }
                addOrUpdateUser(conn._uid, conn._name, conn._ip || 'N/A');
                renderUsersPanel();
              } else {
                S.peerName = conn._name;
                updateChatHeader();
              }
            }
            break;
          }

          case 'client-ip': {
            if (data.ip && typeof data.ip === 'string' && conn && conn._uid) {
              var existing = S.users.find(function (u) { return u.uid === conn._uid; });
              if (existing) {
                existing.ip = data.ip;
                renderUsersPanel();
              } else {
                addOrUpdateUser(conn._uid, conn._name || 'Guest', data.ip);
                renderUsersPanel();
              }
              conn._ip = data.ip;
            }
            break;
          }

          case 'e2e-key': {
            if (data.key && typeof data.key === 'string') {
              try {
                var raw = base64ToArrayBuffer(data.key);
                S.encryptionKey = await importKey(new Uint8Array(raw));
                S.encryptionKeyB64 = data.key;
                S.encryptionReady = true;
                if (D.encryptBadge) D.encryptBadge.classList.remove('hidden');
                D.input.disabled = false;
                D.btnSend.disabled = false;
                D.input.focus();
                if (conn) {
                  try { conn.send({ type: 'e2e-key-ack' }); } catch (_) {}
                }
              } catch (e) {
                handleError('import-key', e);
              }
            }
            break;
          }

          case 'e2e-key-ack': {
            if (!S.encryptionReady && S.encryptionKey) {
              S.encryptionReady = true;
              if (D.encryptBadge) D.encryptBadge.classList.remove('hidden');
              D.input.disabled = false;
              D.btnSend.disabled = false;
              D.input.focus();
            }
            break;
          }

          case 'typing': {
            showTyping('guest');
            break;
          }

          case 'stopped-typing': {
            hideTyping('guest');
            break;
          }

          case 'heartbeat': {
            if (conn) {
              try { conn.send({ type: 'heartbeat-ack', ts: data.ts }); } catch (_) {}
            }
            break;
          }

          case 'heartbeat-ack': {
            break;
          }
        }
      } catch (e) {
        handleError('onData-' + msgType, e);
      }
    };
  }

  /* ==========================================================================
     HOST
     ========================================================================== */
  async function createRoom() {
    if (S.destroyed) return;
    if (typeof Peer === 'undefined') { toast('PeerJS library failed to load.', 'error'); return; }

    if (S.peer) destroy('manual');

    S.destroyed = false;
    var code = genCode();
    S.role = 'host';
    S.code = code;
    S.lastActivity = Date.now();
    S.encryptionReady = false;
    S.encryptionKey = null;
    S.encryptionKeyB64 = null;

    try {
      S.encryptionKey = await generateEncryptionKey();
      S.encryptionKeyB64 = await exportKeyBase64(S.encryptionKey);
    } catch (_) {
      toast('Encryption init failed', 'error');
    }

    var peer = new Peer(code, peerOpts());
    S.peer = peer;

    peer.on('open', function (id) {
      renderCodePyramid(id, D.hostCode);
      genQR(id);
      /* Store QR as data URL for details popup */
      try {
        var qrCanvas = D.qrHost.querySelector('canvas');
        if (qrCanvas) S.storedQR = qrCanvas.toDataURL();
      } catch (_) {}
        /* Show host screen while waiting for guest */
        S.waitingForGuest = true;
        showScreen('host');
      });

    peer.on('connection', function (conn) {
      S.conns.push(conn);
      S.connected = true;
      S.guestCount++;
      S.lastActivity = Date.now();

      conn._uid = ++_connIdCounter;
      conn._name = null;
      conn._ip = 'N/A';

      /* Get remote IP from WebRTC stats (best-effort, modern browsers mask it) */
      var ipPromise = Promise.resolve('N/A');
      try {
        if (conn.peerConnection && conn.peerConnection.getStats) {
          ipPromise = conn.peerConnection.getStats().then(function (stats) {
            var ip = 'N/A';
            var candidateId = null;
            stats.forEach(function (report) {
              /* Try nominated candidate pair first */
              if (report.type === 'candidate-pair' && report.nominated && report.remoteCandidateId) {
                candidateId = report.remoteCandidateId;
              }
              /* Direct remote-candidate lookup */
              if (report.type === 'remote-candidate' && report.address && report.address !== '0.0.0.0' && report.address !== '::') {
                ip = report.address;
              }
            });
            /* Fallback: look up the candidate by ID */
            if (ip === 'N/A' && candidateId) {
              stats.forEach(function (report) {
                if (report.id === candidateId && report.address && report.address !== '0.0.0.0' && report.address !== '::') {
                  ip = report.address;
                }
              });
            }
            /* Final fallback: any report with a real address */
            if (ip === 'N/A') {
              stats.forEach(function (report) {
                if (ip === 'N/A' && report.address && report.address !== '0.0.0.0' && report.address !== '::' && !report.address.startsWith('0.')) {
                  ip = report.address;
                }
              });
            }
            return ip;
          }).catch(function () { return 'N/A'; });
        }
      } catch (_) {}
      ipPromise.then(function (ip) {
        conn._ip = ip;
        addOrUpdateUser(conn._uid, 'Guest', ip);
        renderUsersPanel();
      });

      /* Send encryption key to guest */
      function sendKeyToGuest(retryMs) {
        if (!S.encryptionKeyB64 || S.destroyed) return;
        var doSend = function (retries) {
          if (S.destroyed || retries <= 0) return;
          try {
            conn.send({ type: 'e2e-key', key: S.encryptionKeyB64 });
          } catch (_) {
            setTimeout(function () { doSend(retries - 1); }, 500);
          }
        };
        if (retryMs) {
          setTimeout(function () { doSend(3); }, retryMs);
        } else {
          doSend(3);
        }
      }
      sendKeyToGuest(0);
      sendKeyToGuest(500);
      sendKeyToGuest(2000);

      /* Send host name to guest */
      if (S.myName) {
        try { conn.send({ type: 'name-exchange', name: S.myName }); } catch (_) {}
      }

      var onConnData = makeConnHandler(conn);
      conn.on('data', onConnData);
      conn.on('open', function () { sendKeyToGuest(0); });
      conn.on('close', function () {
        if (S.destroyed) return;
        var idx = S.conns.indexOf(conn);
        if (idx !== -1) S.conns.splice(idx, 1);
        if (S.guestCount > 0) S.guestCount--;
        removeUserByUid(conn._uid);
        if (S.guestCount === 0) {
          S.connected = false;
          S.waitingForGuest = true;
          D.chatDot.className = 'status-dot';
          D.chatDot.style.background = 'var(--accent)';
          D.chatDot.style.boxShadow = '0 0 8px var(--accent-glow)';
          D.chatLabel.textContent = (S.myName || 'Host') + ' \u2014 Waiting for guests\u2026';
          D.input.disabled = true;
          D.btnSend.disabled = true;
          if (D.btnUsersPanel) D.btnUsersPanel.classList.add('hidden');
          updateChatHeader();
          toast('All guests disconnected. Waiting\u2026', '');
        } else {
          var guestLabel = S.guestCount === 1 ? '1 guest' : S.guestCount + ' guests';
          D.chatLabel.textContent = (S.myName || 'Host') + ' \u2014 ' + guestLabel;
        }
      });
      conn.on('error', function () {});

      /* First connection: init chat screen */
      if (D.msgs.children.length <= 1) {
        enterChat(S.code);
        if (S.encryptionKey) {
          D.input.disabled = true;
          D.btnSend.disabled = true;
          D.chatLabel.textContent = (S.myName || 'Host') + ' \u2014 Encrypting\u2026';
          /* Safety fallback: enable after 30s if ack never arrives (bad network) */
          setTimeout(function () {
            if (D.input.disabled && !S.encryptionReady) {
              S.encryptionReady = true;
              D.input.disabled = false;
              D.btnSend.disabled = false;
              var label = S.myName || 'Host';
              D.chatLabel.textContent = label + ' \u2014 ' + (S.guestCount === 1 ? '1 guest' : S.guestCount + ' guests');
            }
          }, 30000);
        } else {
          S.encryptionReady = true;
          var label = S.myName || 'Host';
          D.chatLabel.textContent = label + ' \u2014 ' + (S.guestCount === 1 ? '1 guest' : S.guestCount + ' guests');
        }
      } else {
        D.input.disabled = false;
        D.btnSend.disabled = false;
        D.chatDot.className = 'status-dot connected';
        D.chatDot.style.background = '';
        D.chatDot.style.boxShadow = '';
        var label = S.myName || 'Host';
        D.chatLabel.textContent = label + ' \u2014 ' + (S.guestCount === 1 ? '1 guest' : S.guestCount + ' guests');
        toast('Guest connected', 'success');
      }
      initRateLimiter();
      S.waitingForGuest = false;
      renderUsersPanel();
      D.btnUsersPanel.classList.remove('hidden');
    });

    peer.on('error', function (err) {
      if (err.type === 'unavailable-id') {
        toast('Code collision. Generating a new one\u2026', '');
        setTimeout(function () { createRoom(); }, 600);
      } else {
        toast('Error: ' + err.message, 'error');
      }
    });
  }

  /* ==========================================================================
     GUEST
     ========================================================================== */
  function joinWithCode(code) {
    if (S.destroyed || S.connected || S.connecting) return;
    if (typeof Peer === 'undefined') { toast('PeerJS library failed to load.', 'error'); return; }

    if (S.peer) destroy('manual');
    S.destroyed = false;
    S.connecting = true;
    S.role = 'guest';
    S.code = code;
    S.lastActivity = Date.now();
    S.encryptionReady = false;
    S.encryptionKey = null;
    S.encryptionKeyB64 = null;
    D.joinCodeDisp.textContent = '\u2022 \u2022 \u2022 Connecting \u2022 \u2022 \u2022';

    var peer = new Peer(peerOpts());
    S.peer = peer;
    var joinTimeout = setTimeout(function () {
      if (S.connecting && !S.connected) {
        S.connecting = false;
        updateJoinDisp();
        toast('Connection timed out. Room may not exist.', 'error');
        cleanup();
        S.destroyed = false;
      }
    }, 15000);

    peer.on('open', function () {
      var conn = peer.connect(code, { reliable: true });
      S.conn = conn;

      conn.on('open', function () {
        clearTimeout(joinTimeout);
        if (S.destroyed) { try { conn.close(); } catch (_) {} return; }
        S.connecting = false;
        S.connected = true;
        S.lastActivity = Date.now();
        enterChat(code);
        initRateLimiter();
        /* Send name to host */
        if (S.myName) {
          try { conn.send({ type: 'name-exchange', name: S.myName }); } catch (_) {}
        }
        /* Send own IP to host (best-effort, fetches public IP) */
        fetch('https://api.ipify.org?format=json').then(function (r) { return r.json(); }).then(function (d) {
          if (d && d.ip) {
            try { conn.send({ type: 'client-ip', ip: d.ip }); } catch (_) {}
          }
        }).catch(function () {});
      });

      conn.on('data', makeConnHandler(conn));
      conn.on('close', function () {
        S.connected = false;
        if (!S.destroyed) { toast('Peer disconnected. Attempting reconnect\u2026', 'error'); startReconnect(); }
      });
      conn.on('error', function () {
        if (S.connecting) {
          S.connecting = false;
          updateJoinDisp();
          if (!S.connected) toast('Cannot reach this room.', 'error');
        }
      });
    });

    peer.on('error', function () {
      clearTimeout(joinTimeout);
      S.connecting = false;
      updateJoinDisp();
      if (!S.connected) toast('Room not found or unreachable.', 'error');
    });
  }

  /* ==========================================================================
     NAME PROMPT
     ========================================================================== */
  function showNamePrompt(action, code) {
    D.nameInput.value = '';
    D.nameTitle.textContent = action === 'host' ? 'Create a room' : 'Join a room';
    D.nameInput.placeholder = action === 'host' ? 'Enter your name as host...' : 'Enter your name...';
    D.nameSubmit.textContent = action === 'host' ? 'Create Room' : 'Join';
    D.nameOverlay.classList.remove('hidden');
    setTimeout(function () { D.nameInput.focus(); }, 150);
    S.pendingJoinCode = action === 'join' ? code : '';
    D.nameSubmit._action = action;
  }

  function updateChatHeader() {
    if (S.role === 'host') {
      if (S.guestCount > 0) {
        var guestLabel = S.guestCount === 1 ? (S.peerName || '1 guest') : S.guestCount + ' guests';
        D.peerNameEl.textContent = guestLabel;
        D.peerNameEl.classList.remove('hidden');
      } else {
        D.peerNameEl.textContent = '';
        D.peerNameEl.classList.add('hidden');
      }
    } else if (S.peerName) {
      D.peerNameEl.textContent = S.peerName;
      D.peerNameEl.classList.remove('hidden');
    } else {
      D.peerNameEl.textContent = '';
      D.peerNameEl.classList.add('hidden');
    }
  }

  /* ==========================================================================
     ENTER CHAT UI
     ========================================================================== */
  function enterChat(code, waiting) {
    D.chatCode.textContent = code;
    D.msgs.textContent = '';
    S.lastMsgDate = null;
    S.userScrolledUp = false;
    if (D.scrollBottomBtn) D.scrollBottomBtn.classList.add('hidden');
    S.peerName = '';
    updateChatHeader();
    var emptyMsg = document.createElement('div');
    emptyMsg.className = 'chat-empty';
    emptyMsg.textContent = waiting ? 'Waiting for guest to connect\u2026' : 'Connect to start chatting\u2026';
    D.msgs.appendChild(emptyMsg);
    D.input.value = '';
    D.input.disabled = !!waiting;
    D.btnSend.disabled = !!waiting;

    var selfLabel = S.myName ? S.myName + (S.role === 'host' ? ' (Host)' : '') : (S.role === 'host' ? 'Host' : 'Guest');
    if (waiting) {
      D.chatDot.className = 'status-dot';
      D.chatDot.style.background = 'var(--accent)';
      D.chatDot.style.boxShadow = '0 0 8px var(--accent-glow)';
      D.chatLabel.textContent = selfLabel + ' \u2014 Waiting\u2026';
      S.waitingForGuest = true;
    } else {
      D.chatDot.className = 'status-dot connected';
      D.chatDot.style.background = '';
      D.chatDot.style.boxShadow = '';
      D.chatLabel.textContent = selfLabel + ' \u2014 Connected';
      S.waitingForGuest = false;
    }

    showScreen('chat');
    if (D.btnUsersPanel) {
      D.btnUsersPanel.classList.toggle('hidden', S.role !== 'host');
    }
    if (!waiting) setTimeout(function () { D.input.focus(); }, 300);
  }

  /* ==========================================================================
     DETAILS POPUP
     ========================================================================== */
  function showDetails() {
    if (S.code) {
      renderCodePyramid(S.code, D.detailsCode);
      if (S.storedQR) {
        D.detailsQr.textContent = '';
        var img = document.createElement('img');
        img.src = S.storedQR;
        img.alt = 'QR code';
        img.width = 140;
        img.height = 140;
        D.detailsQr.appendChild(img);
      } else {
        genDetailsQR(S.code);
      }
    }
    D.detailsOverlay.classList.remove('hidden');
  }

  function hideDetails() {
    D.detailsOverlay.classList.add('hidden');
  }

  function genDetailsQR(code) {
    D.detailsQr.textContent = '';
    try {
      new QRCode(D.detailsQr, {
        text: code,
        width: 140, height: 140,
        colorDark: '#06060b',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
      });
    } catch (_) {
      var fb = document.createElement('div');
      fb.className = 'qr-placeholder';
      fb.textContent = 'QR unavailable';
      D.detailsQr.appendChild(fb);
    }
  }

  /* ==========================================================================
     USERS PANEL (Host only)
     ========================================================================== */
  function addOrUpdateUser(uid, name, ip) {
    var existing = S.users.find(function (u) { return u.uid === uid; });
    if (existing) {
      existing.name = name || 'Anonymous';
    } else {
      S.users.push({
        uid: uid,
        name: name || 'Anonymous',
        ip: ip || 'N/A',
        joinTime: Date.now(),
        msgCount: 0,
      });
    }
  }

  function removeUserByUid(uid) {
    var idx = S.users.findIndex(function (u) { return u.uid === uid; });
    if (idx !== -1) {
      S.users.splice(idx, 1);
      renderUsersPanel();
    }
  }

  function incrementUserMsgCount(uid) {
    var user = S.users.find(function (u) { return u.uid === uid; });
    if (user) user.msgCount++;
    if (D.usersOverlay && !D.usersOverlay.classList.contains('hidden')) {
      renderUsersPanel();
    }
  }

  function renderUsersPanel() {
    D.usersList.textContent = '';
    if (S.users.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'users-empty';
      empty.textContent = 'No users connected';
      D.usersList.appendChild(empty);
      return;
    }
    S.users.forEach(function (user) {
      var card = document.createElement('div');
      card.className = 'user-card';

      var avatar = document.createElement('div');
      avatar.className = 'user-avatar';
      avatar.textContent = user.name.charAt(0);

      var info = document.createElement('div');
      info.className = 'user-info';

      var nameEl = document.createElement('div');
      nameEl.className = 'user-name';
      nameEl.textContent = user.name;

      var meta = document.createElement('div');
      meta.className = 'user-meta';

      var ipSpan = document.createElement('span');
      var ipLabel = document.createElement('span');
      ipLabel.className = 'meta-label';
      ipLabel.textContent = 'IP:';
      var ipVal = document.createElement('span');
      ipVal.textContent = user.ip;
      ipSpan.appendChild(ipLabel);
      ipSpan.appendChild(ipVal);

      var timeSpan = document.createElement('span');
      var timeLabel = document.createElement('span');
      timeLabel.className = 'meta-label';
      timeLabel.textContent = 'Joined:';
      var timeVal = document.createElement('span');
      var elapsed = Math.floor((Date.now() - user.joinTime) / 1000);
      var mins = Math.floor(elapsed / 60);
      var secs = elapsed % 60;
      timeVal.textContent = mins + 'm ' + secs + 's ago';
      timeSpan.appendChild(timeLabel);
      timeSpan.appendChild(timeVal);

      meta.appendChild(ipSpan);
      meta.appendChild(timeSpan);
      info.appendChild(nameEl);
      info.appendChild(meta);

      var stat = document.createElement('div');
      stat.className = 'user-stat';
      stat.textContent = user.msgCount + ' msgs';

      card.appendChild(avatar);
      card.appendChild(info);
      card.appendChild(stat);
      D.usersList.appendChild(card);
    });
  }

  function showUsersPanel() {
    renderUsersPanel();
    D.usersOverlay.classList.remove('hidden');
    if (S._usersRefreshInt) clearInterval(S._usersRefreshInt);
    S._usersRefreshInt = setInterval(renderUsersPanel, 10000);
  }

  function hideUsersPanel() {
    D.usersOverlay.classList.add('hidden');
    if (S._usersRefreshInt) { clearInterval(S._usersRefreshInt); S._usersRefreshInt = null; }
  }

  /* ==========================================================================
     PWA — Install Prompt
     ========================================================================== */
  function initPwaInstall() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      S.deferredPrompt = e;
      if (!S.installDismissed && !S.connected) {
        D.installBanner.classList.remove('hidden');
      }
    });
    window.addEventListener('appinstalled', function () {
      S.deferredPrompt = null;
      D.installBanner.classList.add('hidden');
      toast('App installed successfully!', 'success');
    });
    D.installBtn.addEventListener('click', function () {
      if (!S.deferredPrompt) return;
      D.installBanner.classList.add('hidden');
      S.deferredPrompt.prompt();
      S.deferredPrompt.userChoice.then(function (choice) {
        if (choice.outcome === 'dismissed') {
          S.installDismissed = true;
        }
        S.deferredPrompt = null;
      });
    });
    D.installDismiss.addEventListener('click', function () {
      D.installBanner.classList.add('hidden');
      S.installDismissed = true;
    });
  }

  /* ==========================================================================
     PWA — SW Update + Online/Offline Detection
     ========================================================================== */
  function swShowUpdate() { D.swUpdateBanner.classList.remove('hidden'); }

  function initSwListeners() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      S.swUpdateReg = reg;
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            swShowUpdate();
          }
        });
      });
    }).catch(function () {});
    D.swUpdateBtn.addEventListener('click', function () {
      D.swUpdateBanner.classList.add('hidden');
      if (S.swUpdateReg && S.swUpdateReg.waiting) {
        S.swUpdateReg.waiting.postMessage({ type: 'SKIP_WAITING' });
        window.location.reload();
      }
    });
    D.swUpdateDismiss.addEventListener('click', function () {
      D.swUpdateBanner.classList.add('hidden');
    });
    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!refreshing) { refreshing = true; window.location.reload(); }
    });
  }

  function initNetworkDetection() {
    function onOnline() { toast('Back online', 'success'); }
    function onOffline() { toast('No internet connection', 'error'); }
    if (navigator.onLine === false) { toast('No internet connection', 'error'); }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
  }

  /* ==========================================================================
     ENHANCED ERROR HANDLING
     ========================================================================== */
  function haptic(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) {}
  }

  function handleError(context, error) {
    if (error && error.message) {
      console.error('[' + context + ']', error.message);
    } else {
      console.error('[' + context + ']', error);
    }
  }

  /* ==========================================================================
     THEME — Dark / Light toggle
     ========================================================================== */
  function getPreferredTheme() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    return 'dark';
  }

  function setTheme(t) {
    S.theme = t;
    document.documentElement.setAttribute('data-theme', t);
    var meta = document.getElementById('theme-color');
    if (meta) meta.content = t === 'dark' ? '#06060e' : '#f0f2f8';
  }

  function toggleTheme() {
    setTheme(S.theme === 'dark' ? 'light' : 'dark');
  }

  function initTheme() {
    setTheme(getPreferredTheme());
  }

  /* ==========================================================================
     UX — Date separators in chat
     ========================================================================== */
  function formatDateLabel(date) {
    var today = new Date();
    var d = new Date(date);
    var diff = Math.floor((today - d) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function renderDateSeparator(date) {
    var ts = new Date(date);
    var iso = ts.toISOString().slice(0, 10);
    if (S.lastMsgDate === iso) return;
    S.lastMsgDate = iso;
    var sep = document.createElement('div');
    sep.className = 'date-separator';
    var span = document.createElement('span');
    span.textContent = formatDateLabel(ts);
    sep.appendChild(span);
    D.msgs.appendChild(sep);
  }

  /* ==========================================================================
     SECURITY — Lifecycle hooks
     ========================================================================== */
  function onBeforeUnload() {
    if (S.connected || S.role) {
      return 'You are in an active room. Leaving will destroy it.';
    }
  }

  function onVisibilityChange() {
    /* timers removed — no-op */
  }

  /* ==========================================================================
     INIT
     ========================================================================== */
  function init() {
    cacheDom();
    initTheme();

    /* Hide skeleton */
    var skel = document.getElementById('skeleton');
    if (skel) skel.classList.remove('active');

    /* Landing */
    $('#btn-host').addEventListener('click', function () { showNamePrompt('host'); });
    $('#btn-join').addEventListener('click', function () { showScreen('join'); });

    /* Theme toggles */
    function onToggleTheme() { toggleTheme(); }
    var themeBtns = ['theme-toggle', 'theme-toggle-host', 'theme-toggle-join', 'theme-toggle-chat'];
    themeBtns.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', onToggleTheme);
    });

    /* Host screen */
    $('#btn-host-back').addEventListener('click', function () { destroy('manual'); });
    $('#btn-host-details').addEventListener('click', showDetails);
    $('#btn-copy-code').addEventListener('click', function () {
      if (S.code) {
        navigator.clipboard.writeText(S.code).then(function () {
          toast('Code copied!', 'success');
        }).catch(function () {
          toast('Failed to copy', 'error');
        });
      }
    });
    $('#btn-share-code').addEventListener('click', function () {
      if (!S.code) return;
      var shareUrl = window.location.origin + '?code=' + S.code;
      if (navigator.share) {
        navigator.share({ title: 'Mangaud-Chatting', text: 'Join my encrypted chat: ' + S.code, url: shareUrl }).catch(function () {});
      } else {
        navigator.clipboard.writeText(shareUrl).then(function () { toast('Link copied!', 'success'); }).catch(function () { toast('Failed to copy', 'error'); });
      }
    });

    /* Join */
    $('#btn-join-back').addEventListener('click', function () { destroy('manual'); });
    $('#btn-scan-qr').addEventListener('click', startScanner);
    D.joinCodeInput.addEventListener('input', onJoinCodeInput);
    D.joinCodeInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !D.btnJoinSubmit.disabled) { e.preventDefault(); D.btnJoinSubmit.click(); }
    });
    D.btnJoinSubmit.addEventListener('click', function () {
      if (D.joinCodeInput.value.length === 8) showNamePrompt('join', D.joinCodeInput.value.toUpperCase());
    });

    /* Scanner */
    $('#btn-scanner-close').addEventListener('click', function () {
      stopCamera();
      D.scanOverlay.classList.add('hidden');
    });

    /* Name Prompt */
    D.nameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); D.nameSubmit.click(); }
    });
    D.nameSubmit.addEventListener('click', function () {
      var name = D.nameInput.value.trim();
      if (!name) { toast('Please enter a name', 'error'); return; }
      S.myName = name;
      D.nameOverlay.classList.add('hidden');
      if (D.nameSubmit._action === 'host') {
        toast('Creating room\u2026', '');
        createRoom();
      } else if (S.pendingJoinCode) {
        toast('Joining room\u2026', '');
        joinWithCode(S.pendingJoinCode);
      }
    });
    D.nameCancel.addEventListener('click', function () {
      var wasHost = D.nameSubmit._action === 'host';
      D.nameOverlay.classList.add('hidden');
      S.pendingJoinCode = '';
      if (wasHost) {
        showScreen('landing');
      } else {
        if (D.joinCodeInput) D.joinCodeInput.value = '';
        updateJoinDisp();
        showScreen('join');
      }
    });
    D.nameOverlay.addEventListener('click', function (e) {
      if (e.target === D.nameOverlay) D.nameCancel.click();
    });

    /* Details Popup */
    D.btnDetails.addEventListener('click', showDetails);
    D.btnDetailsClose.addEventListener('click', hideDetails);
    D.detailsBtnCopy.addEventListener('click', function () {
      if (S.code) {
        navigator.clipboard.writeText(S.code).then(function () {
          toast('Code copied!', 'success');
        }).catch(function () {
          toast('Could not copy', 'error');
        });
      }
    });
    $('#details-btn-share').addEventListener('click', function () {
      if (!S.code) return;
      var shareUrl = window.location.origin + '?code=' + S.code;
      if (navigator.share) {
        navigator.share({ title: 'Mangaud-Chatting', text: 'Join my encrypted chat: ' + S.code, url: shareUrl }).catch(function () {});
      } else {
        navigator.clipboard.writeText(shareUrl).then(function () { toast('Link copied!', 'success'); }).catch(function () { toast('Failed to copy', 'error'); });
      }
    });
    D.detailsOverlay.addEventListener('click', function (e) {
      if (e.target === D.detailsOverlay) hideDetails();
    });

    /* Users Panel */
    if (D.btnUsersPanel) {
      D.btnUsersPanel.addEventListener('click', showUsersPanel);
    }
    if (D.usersClose) {
      D.usersClose.addEventListener('click', hideUsersPanel);
    }
    if (D.usersOverlay) {
      D.usersOverlay.addEventListener('click', function (e) {
        if (e.target === D.usersOverlay) hideUsersPanel();
      });
    }

    /* Chat */
    D.btnSend.addEventListener('click', sendMsg);
    D.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
    });
    D.input.addEventListener('input', function () {
      onLocalInput();
      /* Auto-resize textarea */
      D.input.style.height = 'auto';
      D.input.style.height = Math.min(D.input.scrollHeight, 120) + 'px';
    });
    D.input.addEventListener('paste', function (e) {
      e.preventDefault();
      var clip = e.clipboardData || window.clipboardData;
      var text = clip.getData('text');
      if (!text) return;
      var start = D.input.selectionStart;
      var end = D.input.selectionEnd;
      D.input.value = D.input.value.substring(0, start) + text + D.input.value.substring(end);
      D.input.selectionStart = D.input.selectionEnd = start + text.length;
      D.input.style.height = 'auto';
      D.input.style.height = Math.min(D.input.scrollHeight, 120) + 'px';
      onLocalInput();
    });

    /* Destroy with confirmation (double-tap) */
    var destroyPending = false;
    D.btnDestroy.addEventListener('click', function () {
      if (destroyPending) { destroyPending = false; destroy('manual'); return; }
      destroyPending = true;
      D.btnDestroy.style.color = 'var(--danger)';
      D.btnDestroy.style.background = 'var(--danger-soft)';
      D.btnDestroy.textContent = '\u2713';
      setTimeout(function () {
        destroyPending = false;
        D.btnDestroy.style.color = '';
        D.btnDestroy.style.background = '';
        D.btnDestroy.textContent = '\u00D7';
      }, 2500);
    });

    /* Scroll-to-bottom */
    D.msgs.addEventListener('scroll', function () {
      var atBottom = D.msgs.scrollHeight - D.msgs.scrollTop - D.msgs.clientHeight < 60;
      S.userScrolledUp = !atBottom;
      D.scrollBottomBtn.classList.toggle('hidden', atBottom);
    });
    D.scrollBottomBtn.addEventListener('click', function () {
      D.msgs.scrollTop = D.msgs.scrollHeight;
      S.userScrolledUp = false;
      D.scrollBottomBtn.classList.add('hidden');
    });

    /* Sound toggle */
    D.btnSoundToggle.addEventListener('click', function () {
      S.soundEnabled = !S.soundEnabled;
      D.btnSoundToggle.dataset.sound = S.soundEnabled ? 'on' : 'off';
      D.btnSoundToggle.textContent = S.soundEnabled ? '\uD83D\uDD0A' : '\uD83D\uDD07';
      D.btnSoundToggle.title = S.soundEnabled ? 'Mute notifications' : 'Unmute notifications';
    });

    /* Copy button on messages */
    D.msgs.addEventListener('click', function (e) {
      var btn = e.target.closest('.msg-copy-btn');
      if (!btn) return;
      var msgEl = btn.closest('.msg');
      if (!msgEl) return;
      var msgText = _msgTextMap.get(msgEl);
      if (!msgText) return;
      navigator.clipboard.writeText(msgText).then(function () {
        btn.classList.add('copied');
        btn.textContent = 'Copied!';
        toast('Copied', 'success');
        setTimeout(function () {
          btn.classList.remove('copied');
          btn.textContent = 'Copy';
        }, 1200);
      }).catch(function () {
        toast('Could not copy', 'error');
      });
    });

    /* Context menu: copy message text */
    D.msgs.addEventListener('contextmenu', function (e) {
      var msgEl = e.target.closest('.msg');
      if (!msgEl) return;
      e.preventDefault();
      var textEl = msgEl.querySelector('.msg-text');
      if (!textEl || !textEl.textContent) return;
      navigator.clipboard.writeText(textEl.textContent).then(function () {
        toast('Message copied', 'success');
      }).catch(function () {
        toast('Could not copy', 'error');
      });
    });

      /* Keyboard: Escape to close overlays */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!D.nameOverlay.classList.contains('hidden')) { D.nameCancel.click(); return; }
        if (!D.detailsOverlay.classList.contains('hidden')) { hideDetails(); return; }
        if (!D.usersOverlay.classList.contains('hidden')) { hideUsersPanel(); return; }
        if (!D.scanOverlay.classList.contains('hidden')) {
          stopCamera();
          D.scanOverlay.classList.add('hidden');
        }
        return;
      }
    });

    /* Activity (resets inactivity fuse) */
    var evts = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];
    evts.forEach(function (e) { document.addEventListener(e, onActivity, { passive: true }); });

    /* Security hooks */
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);

    /* Refresh lock — prevent accidental refresh while in a room */
    document.addEventListener('keydown', function (e) {
      if (S.connected || S.role) {
        if (e.key === 'F5' || (e.ctrlKey && e.key === 'r') || (e.metaKey && e.key === 'r')) {
          e.preventDefault();
          toast('Refresh locked. Leave room first.', 'error');
        }
      }
    });

    /* Mobile keyboard support */
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () {
        D.msgs.scrollTop = D.msgs.scrollHeight;
      });
    }

    /* PWA — Install Banner */
    initPwaInstall();

    /* PWA — SW Update + Online/Offline */
    initSwListeners();
    initNetworkDetection();

    /* Auto-join if URL contains ?code= parameter */
    var urlParams = new URLSearchParams(window.location.search);
    var sharedCode = urlParams.get('code');
    if (sharedCode && /^[0-9A-Z]{8}$/.test(sharedCode.toUpperCase())) {
      setTimeout(function () { showNamePrompt('join', sharedCode.toUpperCase()); }, 300);
    }

  }

  window.addEventListener('error', function (e) {
    console.error('Global error:', e.message);
    var toastEl = D && D.toast ? D.toast : null;
    if (toastEl) {
      toast('Something went wrong. Refresh the page.', 'error');
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
