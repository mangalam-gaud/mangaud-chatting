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
    leaving: false,
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

    /* ---- Message history for host transfer ---- */
    msgHistory: [],
    _replayingHistory: false,

    /* ---- Heartbeat ---- */
    heartbeatId: null,
    lastHeartbeatAck: 0,

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
    blockedIPs: [],
    allowedSenders: [],

    /* ---- Guest-side user list ---- */
    guestUsers: [],
    hostName: '',
    senderAllowed: false,

    /* ---- Room mode ---- */
    roomMode: 'normal',

    /* ---- Sound ---- */
    soundEnabled: true,
    audioCtx: null,

    /* ---- Scanner ---- */
    cameraStream: null,
    scannerActive: false,
    animFrameId: null,

    /* ---- Toast ---- */
    toastTimeout: null,

    /* ---- Users panel refresh ---- */
    _usersRefreshInt: null,

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

  function safeCopy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    /* Fallback for HTTP / non-secure contexts */
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    return Promise.resolve();
  }

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
    D.btnLeave      = $('#btn-leave');
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
    D.roomModeSelect  = $('#room-mode-select');
    D.btnUsersPanel   = $('#btn-users-panel');
    D.usersOverlay    = $('#users-overlay');
    D.usersList       = $('#users-list');
    D.usersClose      = $('#btn-users-close');
  }

  /* ==========================================================================
     TOAST
     ========================================================================== */
  function toast(msg, type, duration) {
    clearTimeout(S.toastTimeout);
    D.toast.textContent = msg;
    D.toast.className = 'toast' + (type ? ' ' + type : '');
    D.toast.classList.remove('hidden');
    S.toastTimeout = setTimeout(function () { D.toast.classList.add('hidden'); }, duration || 3500);
  }

  /* ---- Custom confirm modal ---- */
  function showConfirm(msg) {
    return new Promise(function (resolve) {
      var overlay = document.getElementById('confirm-modal');
      var msgEl = document.getElementById('confirm-msg');
      var okBtn = document.getElementById('confirm-ok');
      var cancelBtn = document.getElementById('confirm-cancel');
      if (!overlay || !msgEl || !okBtn || !cancelBtn) { resolve(false); return; }
      msgEl.textContent = msg;
      overlay.classList.remove('hidden');
      function cleanup(val) {
        overlay.classList.add('hidden');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onBg);
        resolve(val);
      }
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onBg(e) { if (e.target === overlay) cleanup(false); }
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      overlay.addEventListener('click', onBg);
    });
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
      var stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (_) {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      S.cameraStream = stream;
      S.scannerActive = true;
      D.scanVideo.srcObject = stream;
      D.scanOverlay.classList.remove('hidden');
      await D.scanVideo.play();
      scanLoop();
    } catch (_) {
      stopCamera();
      D.scanOverlay.classList.add('hidden');
      toast('Camera unavailable. Enter the code manually.', 'error');
    }
  }

  function scanLoop() {
    if (!S.scannerActive) return;
    if (typeof jsQR === 'undefined') { stopCamera(); D.scanOverlay.classList.add('hidden'); toast('QR library failed to load. Enter code manually.', 'error'); return; }
    if (D.scanVideo.readyState < 2 || !D.scanVideo.videoWidth) {
      S.animFrameId = requestAnimationFrame(scanLoop);
      return;
    }
    var v = D.scanVideo;
    var c = D.scanCanvas;
    if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
    }
    var ctx;
    try { ctx = c.getContext('2d', { willReadFrequently: true }); } catch (_) {}
    if (!ctx) { try { ctx = c.getContext('2d'); } catch (_) {} }
    if (!ctx) { S.animFrameId = requestAnimationFrame(scanLoop); return; }
    try { ctx.drawImage(v, 0, 0, c.width, c.height); } catch (_) { S.animFrameId = requestAnimationFrame(scanLoop); return; }
    var img;
    try { img = ctx.getImageData(0, 0, c.width, c.height); } catch (_) { S.animFrameId = requestAnimationFrame(scanLoop); return; }
    try {
      var found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      if (found && /^[0-9A-Z]{6}$/.test(found.data)) {
        stopCamera();
        D.scanOverlay.classList.add('hidden');
        showNamePrompt('join', found.data);
        return;
      }
    } catch (_) {}
    S.animFrameId = requestAnimationFrame(scanLoop);
  }


  /* ==========================================================================
     JOIN CODE INPUT — Text input for 6-char alphanumeric code
     ========================================================================== */
  function renderCode(code, el) {
    el.textContent = '';
    if (!code) {
      el.textContent = '\u2014\u2014\u2014\u2014\u2014\u2014';
      return;
    }
    var spaced = code.split('').join(' ');
    el.textContent = spaced;
  }

  function updateJoinDisp() {
    var val = D.joinCodeInput.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
    D.joinCodeInput.value = val;
    renderCode(val, D.joinCodeDisp);
    D.btnJoinSubmit.disabled = val.length !== 6;
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
     HEARTBEAT — Detects dead connections via periodic ping/pong
     ========================================================================== */
  function initHeartbeat() {
    if (S.heartbeatId) { clearInterval(S.heartbeatId); }
    S.lastHeartbeatAck = Date.now();
    var HEARTBEAT_INTERVAL = 15000; /* 15s between pings */
    var HEARTBEAT_TIMEOUT = 45000;  /* 45s without ack = dead connection */
    S.heartbeatId = setInterval(function () {
      if (S.destroyed) { clearInterval(S.heartbeatId); S.heartbeatId = null; return; }
      var now = Date.now();
      /* Check if we haven't received an ack in too long */
      if (S.lastHeartbeatAck && (now - S.lastHeartbeatAck > HEARTBEAT_TIMEOUT)) {
        clearInterval(S.heartbeatId);
        S.heartbeatId = null;
        if (S.role === 'host') {
          toast('Connection lost. Guests may have disconnected.', 'error');
          destroy('heartbeat-timeout');
        } else {
          toast('Connection to host lost. Reconnecting\u2026', 'error');
          startReconnect();
        }
        return;
      }
      /* Send heartbeat to all peers */
      var payload = { type: 'heartbeat', ts: now };
      if (S.role === 'host') {
        S.conns.forEach(function (c) { try { c.send(payload); } catch (_) {} });
      } else if (S.conn) {
        try { S.conn.send(payload); } catch (_) {}
      }
    }, HEARTBEAT_INTERVAL);
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
     HOST TRANSFER — Chunked history transfer
     ========================================================================== */
  function chunkHistory(history, maxBytes) {
    maxBytes = maxBytes || 55000;
    if (!history || history.length === 0) return [];
    var str = JSON.stringify(history);
    if (str.length <= maxBytes) return [history];
    var chunks = [];
    var arr = history.slice();
    while (arr.length > 0) {
      var chunk = [];
      var size = 2;
      for (var i = 0; i < arr.length; i++) {
        var itemSize = JSON.stringify(arr[i]).length + 1;
        if (size + itemSize > maxBytes && chunk.length > 0) break;
        chunk.push(arr[i]);
        size += itemSize;
      }
      chunks.push(chunk);
      arr = arr.slice(chunk.length);
    }
    return chunks;
  }

  function sendChunkedHistory(conn, history, type) {
    if (!history || history.length === 0) return;
    var chunks = chunkHistory(history);
    chunks.forEach(function (chunk, idx) {
      try {
        conn.send({ type: type, messages: chunk, chunkIndex: idx, totalChunks: chunks.length });
      } catch (_) {}
    });
  }

  function replayHistory(messages) {
    D.msgs.textContent = '';
    S.msgElements = [];
    S.lastMsgDate = null;
    if (!messages || messages.length === 0) {
      var emptyMsg = document.createElement('div');
      emptyMsg.className = 'chat-empty';
      emptyMsg.textContent = 'Chat history';
      D.msgs.appendChild(emptyMsg);
      return;
    }
    /* Skip history tracking during replay to avoid doubling */
    S._replayingHistory = true;
    messages.forEach(function (msg) {
      renderDateSeparator(msg.ts);
      if (msg.type === 'chat') {
        addMsg(msg.text, msg.isMine, msg.ts, null, '', msg.sender);
      } else if (msg.type === 'file') {
        addFileMsg(msg.name, msg.size, msg.data, msg.isMine, msg.ts, null, '', msg.sender);
      }
    });
    S._replayingHistory = false;
    if (!S.userScrolledUp) D.msgs.scrollTop = D.msgs.scrollHeight;
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

    /* Track history for host transfer (skip during replay) */
    if (!S._replayingHistory) {
      var historySender = fromName || (isMine ? S.myName : S.peerName) || 'Unknown';
      S.msgHistory.push({ type: 'chat', text: text, ts: ts || Date.now(), sender: historySender });
    }

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
  function showTyping(role, name) {
    var el = role === 'guest' ? D.typingGuest : D.typingHost;
    var who = role === 'guest' ? (name || 'Someone') : 'You';
    el.textContent = who + ' is typing\u2026';
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
    if (S.destroyed) return;
    if (S.role !== 'host' && (!S.connected || !S.conn)) return;
    if (S.role === 'host' && S.conns.length === 0) return;
    clearTimeout(S.typingThrottle);
    if (!S.localTyping) {
      S.localTyping = true;
      if (S.role === 'host') {
        S.conns.forEach(function (c) { try { c.send({ type: 'typing', name: S.myName }); } catch (_) {} });
      } else {
        try { S.conn.send({ type: 'typing', name: S.myName }); } catch (_) {}
      }
    }
    S.typingThrottle = setTimeout(function () {
      S.localTyping = false;
      if (S.connected) {
        if (S.role === 'host') {
          S.conns.forEach(function (c) { try { c.send({ type: 'stopped-typing', name: S.myName }); } catch (_) {} });
        } else if (S.conn) {
          try { S.conn.send({ type: 'stopped-typing', name: S.myName }); } catch (_) {}
        }
      }
    }, 1200);
  }

  /* ==========================================================================
     SEND MESSAGE
     ========================================================================== */
  async function sendMsg() {
    var text = D.input.value.trim();
    if (!text || S.destroyed) return;
    if (S.role === 'host') {
      if (S.conns.length === 0) { toast('Waiting for a guest to connect\u2026', 'error'); return; }
    } else {
      if (!S.connected || !S.conn) { toast('Not connected to host', 'error'); return; }
    }
    if (S.role !== 'host' && S.roomMode === 'readonly' && !S.senderAllowed) { toast('Room is in read-only mode', 'error'); return; }
    if (!checkRateLimit()) { toast('Slow down!', 'error'); return; }
    if (text.length > 50000) { text = text.substring(0, 50000); toast('Message truncated to 50,000 characters', ''); }

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
     FILE SHARING — Send/receive files as base64 messages
     ========================================================================== */
  var MIME_MAP = {
    '.c': 'text/x-c', '.cpp': 'text/x-c++', '.h': 'text/x-c', '.hpp': 'text/x-c++',
    '.java': 'text/x-java', '.py': 'text/x-python', '.js': 'text/javascript',
    '.ts': 'text/typescript', '.rb': 'text/x-ruby', '.go': 'text/x-go',
    '.rs': 'text/x-rust', '.cs': 'text/x-csharp', '.swift': 'text/x-swift',
    '.kt': 'text/x-kotlin', '.php': 'text/x-php', '.pl': 'text/x-perl',
    '.sh': 'text/x-shellscript', '.bat': 'text/x-bat', '.sql': 'text/x-sql',
    '.html': 'text/html', '.css': 'text/css', '.scss': 'text/x-scss',
    '.xml': 'text/xml', '.json': 'application/json', '.yaml': 'text/yaml',
    '.yml': 'text/yaml', '.toml': 'text/plain', '.ini': 'text/plain',
    '.md': 'text/markdown', '.txt': 'text/plain', '.log': 'text/plain',
    '.csv': 'text/csv', '.env': 'text/plain', '.r': 'text/x-r',
    '.lua': 'text/x-lua', '.dart': 'text/x-dart', '.nim': 'text/x-nim',
    '.zig': 'text/x-zig', '.v': 'text/x-verilog', '.tcl': 'text/x-tcl',
    '.clj': 'text/x-clojure', '.elm': 'text/x-elm', '.nix': 'text/x-nix',
    '.tf': 'text/x-hcl', '.proto': 'text/x-protobuf'
  };

  function getMime(filename) {
    var ext = '.' + filename.split('.').pop().toLowerCase();
    return MIME_MAP[ext] || 'application/octet-stream';
  }

  function sendFile(file) {
    if (!file || S.destroyed) return;
    if (S.role === 'host') {
      if (S.conns.length === 0) { toast('Waiting for a guest to connect\u2026', 'error'); return; }
    } else {
      if (!S.connected || !S.conn) { toast('Not connected to host', 'error'); return; }
    }
    if (S.role !== 'host' && S.roomMode === 'readonly' && !S.senderAllowed) { toast('Room is in read-only mode', 'error'); return; }
    if (!checkRateLimit()) { toast('Slow down!', 'error'); return; }

    var reader = new FileReader();
    reader.onload = function () {
      var base64 = reader.result.split(',')[1];
      if (!base64) { toast('Failed to read file', 'error'); return; }
      if (base64.length > 5000000) { toast('File too large (max ~3.7MB encoded)', 'error'); return; }

      var msgId = 'f' + (++S.msgCounter) + '_' + Date.now();
      var timestamp = Date.now();
      var payload = {
        type: 'file',
        name: file.name,
        mime: getMime(file.name),
        size: file.size,
        data: base64,
        timestamp: timestamp,
        id: msgId,
        sender: S.myName || 'Anonymous'
      };

      if (S.role === 'host') {
        S.conns.forEach(function (c) { try { c.send(payload); } catch (_) {} });
      } else {
        try { S.conn.send(payload); } catch (_) { toast('Failed to send', 'error'); return; }
      }

      haptic(20);
      renderDateSeparator(timestamp);
      addFileMsg(file.name, file.size, base64, true, timestamp, msgId, 'sent');
      onActivity();
    };
    reader.readAsDataURL(file);
  }

  function addFileMsg(name, size, base64, isMine, ts, msgId, deliveryStatus, fromName) {
    var empty = D.msgs.querySelector('.chat-empty');
    if (empty) empty.remove();

    var w = document.createElement('div');
    w.className = 'msg ' + (isMine ? 'sent' : 'received') + ' msg-file';
    w.dataset.msgId = msgId || '';

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

    var card = document.createElement('div');
    card.className = 'file-card';

    var top = document.createElement('div');
    top.className = 'file-top';

    var icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = '\uD83D\uDCC4';
    top.appendChild(icon);

    var info = document.createElement('div');
    info.className = 'file-info';

    var fname = document.createElement('span');
    fname.className = 'file-name';
    fname.textContent = name;
    info.appendChild(fname);

    var fsize = document.createElement('span');
    fsize.className = 'file-size';
    fsize.textContent = size > 1048576
      ? (size / 1048576).toFixed(1) + ' MB'
      : size > 1024
        ? (size / 1024).toFixed(1) + ' KB'
        : size + ' B';
    info.appendChild(fsize);

    top.appendChild(info);
    card.appendChild(top);

    var dlBtn = document.createElement('button');
    dlBtn.className = 'btn btn-primary file-dl-btn';
    dlBtn.textContent = 'Download';
    dlBtn.setAttribute('aria-label', 'Download ' + name);
    dlBtn.type = 'button';
    dlBtn.addEventListener('click', function () {
      var mime = getMime(name);
      var byteStr = atob(base64);
      var ab = new ArrayBuffer(byteStr.length);
      var ia = new Uint8Array(ab);
      for (var i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
      var blob = new Blob([ab], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    });
    card.appendChild(dlBtn);

    w.appendChild(card);

    var footer = document.createElement('div');
    footer.className = 'msg-footer';

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

    D.msgs.appendChild(w);
    S.msgElements.push(w);

    /* Track history for host transfer (skip during replay) */
    if (!S._replayingHistory) {
      var historySender = fromName || (isMine ? S.myName : S.peerName) || 'Unknown';
      S.msgHistory.push({ type: 'file', name: name, size: size, data: base64, ts: ts || Date.now(), sender: historySender });
    }

    while (S.msgElements.length > S.maxMessages) {
      var oldest = S.msgElements.shift();
      if (oldest && oldest.parentNode) oldest.parentNode.removeChild(oldest);
    }

    if (!S.userScrolledUp) D.msgs.scrollTop = D.msgs.scrollHeight;
    return w;
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

      conn.on('data', makeConnHandler(conn));
      conn.on('close', function () { if (!S.destroyed) startReconnect(); });
      conn.on('error', function () {});

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

    if (reason !== 'host-transfer' && S.role === 'host') {
      S.conns.forEach(function (c) {
        if (c) {
          try { c.send({ type: 'room-destroy', reason: reason }); } catch (_) {}
        }
      });
    }

    hideDetails();
    cleanup();

    D.msgs.textContent = '';
    var emptyMsg = document.createElement('div');
    emptyMsg.className = 'chat-empty';
    emptyMsg.textContent = reason === 'host-transfer' ? 'Host role transferred\u2026' : 'Room destroyed. Nothing was saved.';
    D.msgs.appendChild(emptyMsg);
    S.msgElements = [];
    if (reason !== 'host-transfer') S.msgHistory = [];
    S.peerName = '';
    S.users = [];
    S.blockedIPs = [];
    S.allowedSenders = [];
    S.guestUsers = [];
    S.hostName = '';
    S.senderAllowed = false;
    S.roomMode = 'normal';
    updateChatHeader();
    if (D.btnUsersPanel) D.btnUsersPanel.classList.add('hidden');
    if (D.usersOverlay) D.usersOverlay.classList.add('hidden');

    if (D.joinCodeInput) D.joinCodeInput.value = '';
    updateJoinDisp();

    renderCode('', D.hostCode);
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
    if (S.toastTimeout) { clearTimeout(S.toastTimeout); S.toastTimeout = null; }
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
    S.blockedIPs = [];
    S.allowedSenders = [];
    S.guestUsers = [];
    S.hostName = '';
    S.senderAllowed = false;
    S.roomMode = 'normal';
    S.encryptionKey = null;
    S.encryptionKeyB64 = null;
    S.encryptionReady = false;
    S.reconnectAttempts = 0;
    S.peerTyping = false;
    S.localTyping = false;
    S.leaving = false;
    Object.keys(S.pendingDeliveries).forEach(function (id) {
      clearTimeout(S.pendingDeliveries[id].timer);
    });
    S.pendingDeliveries = {};
    S.msgCounter = 0;
    S.waitingForGuest = false;
    S.storedQR = null;

    hideTyping('guest');
    hideTyping('host');
    if (S.audioCtx) { try { S.audioCtx.close(); } catch (_) {} S.audioCtx = null; }
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
    var arr = new Uint32Array(6);
    crypto.getRandomValues(arr);
    var code = '';
    for (var i = 0; i < 6; i++) code += CODE_CHARS[arr[i] % 36];
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

            /* Host: forward to all OTHER guests */
            if (S.role === 'host') {
              S.conns.forEach(function (c) {
                if (c !== conn) {
                  try { c.send(data); } catch (_) {}
                }
              });
            }

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

          case 'file': {
            onActivity();
            var fname = String(data.name || 'file');
            var fdata = String(data.data || '');
            var fsize = Number(data.size) || 0;
            if (!fdata) break;
            if (fdata.length > 5000000) { toast('File too large, skipped', 'error'); break; }

            haptic(15);
            renderDateSeparator(data.timestamp || Date.now());
            var fileSender = data.sender || conn._name || 'Guest';
            addFileMsg(fname, fsize, fdata, false, data.timestamp || Date.now(), data.id, null, fileSender);
            playNotification();

            if (conn._uid) incrementUserMsgCount(conn._uid);

            /* Host: forward to all OTHER guests */
            if (S.role === 'host') {
              S.conns.forEach(function (c) {
                if (c !== conn) {
                  try { c.send(data); } catch (_) {}
                }
              });
            }

            if (data.id && conn) {
              try { conn.send({ type: 'delivered', id: data.id }); } catch (_) {}
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
                /* Guest stores host name */
                S.hostName = conn._name;
                S.peerName = conn._name;
                updateChatHeader();
              }
            }
            break;
          }

          case 'client-ip': {
            if (data.ip && typeof data.ip === 'string' && conn && conn._uid) {
              conn._ip = data.ip;
              if (S.blockedIPs.indexOf(data.ip) !== -1) {
                conn._blocked = true;
                if (S.guestCount > 0) S.guestCount--;
                removeUserByUid(conn._uid);
                S.conns = S.conns.filter(function (c) { return c !== conn; });
                try { conn.send({ type: 'blocked' }); } catch (_) {}
                try { conn.close(); } catch (_) {}
                toast('Blocked user attempted to join', '');
                break;
              }
              var existing = S.users.find(function (u) { return u.uid === conn._uid; });
              if (existing) {
                existing.ip = data.ip;
                renderUsersPanel();
              } else {
                addOrUpdateUser(conn._uid, conn._name || 'Guest', data.ip);
                renderUsersPanel();
              }
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
            }
            if (D.encryptBadge) D.encryptBadge.classList.remove('hidden');
            D.input.disabled = false;
            D.btnSend.disabled = false;
            D.input.focus();
            break;
          }

          case 'typing': {
            showTyping('guest', data.name);
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
            S.lastHeartbeatAck = Date.now();
            break;
          }

          case 'blocked': {
            toast('You have been removed from this room.', 'error');
            destroy('disconnect');
            break;
          }

          case 'room-mode': {
            if (data.mode && typeof data.mode === 'string') {
              S.roomMode = data.mode === 'readonly' ? 'readonly' : 'normal';
              updateRoomModeUI();
            }
            break;
          }

          case 'host-transfer': {
            if (S.destroyed) break;
            S.hostName = data.hostName;
            toast(data.hostName + ' transferred host to you. Restarting as host\u2026', 'success');
            var transferName = S.myName;
            var transferCode = data.code;
            var transferKey = data.encryptionKey;
            var transferRoomMode = data.roomMode || 'normal';
            var transferBlockedIPs = data.blockedIPs || [];
            var transferAllowedSenders = data.allowedSenders || [];
            var pendingHistory = [];

            S._transferHistoryHandler = function (d) {
              if (d && d.type === 'transfer-history' && Array.isArray(d.messages)) {
                pendingHistory = pendingHistory.concat(d.messages);
              }
            };
            if (S.conn) S.conn.on('data', S._transferHistoryHandler);

            setTimeout(finishTransferReceive, 150);
            var transferDone = false;

            function finishTransferReceive() {
              if (transferDone) return;
              transferDone = true;
              if (S.conn && S._transferHistoryHandler) {
                S.conn.removeListener('data', S._transferHistoryHandler);
                S._transferHistoryHandler = null;
              }
              S.msgHistory = pendingHistory;
              destroy('host-transfer');
              setTimeout(function () {
                S.myName = transferName;
                S.roomMode = transferRoomMode;
                S.blockedIPs = transferBlockedIPs;
                S.allowedSenders = transferAllowedSenders;
                createRoomWithCode(transferCode, {
                  history: S.msgHistory,
                  encryptionKey: transferKey,
                  roomMode: transferRoomMode,
                  blockedIPs: transferBlockedIPs,
                  allowedSenders: transferAllowedSenders,
                  transfer: true
                });
              }, 200);
            }
            break;
          }

          case 'user-list': {
            if (Array.isArray(data.users)) {
              S.guestUsers = data.users;
              renderGuestUserList();
            }
            break;
          }

          case 'sender-permission': {
            S.senderAllowed = !!data.allowed;
            updateRoomModeUI();
            break;
          }

          case 'reconnect': {
            var savedName = S.myName;
            var savedCode = data.code;
            var newHostName = data.hostName || 'Host';
            var pendingHistory = [];

            S._reconnectHistoryHandler = function (d) {
              if (d && d.type === 'chat-history' && Array.isArray(d.messages)) {
                pendingHistory = pendingHistory.concat(d.messages);
              }
            };
            if (S.conn) S.conn.on('data', S._reconnectHistoryHandler);

            if (!S.destroyed) destroy('host-transfer');
            toast(newHostName + ' is now the host. Reconnecting\u2026', '');

            setTimeout(function () {
              if (S.conn && S._reconnectHistoryHandler) {
                S.conn.removeListener('data', S._reconnectHistoryHandler);
                S._reconnectHistoryHandler = null;
              }
              S.msgHistory = pendingHistory;
              S.myName = savedName;
              joinWithCode(savedCode, { history: pendingHistory });
            }, 500);
            break;
          }

          case 'transfer-history': {
            /* Received during transfer — consumed by host-transfer handler above */
            break;
          }

          case 'chat-history': {
            if (Array.isArray(data.messages)) {
              S.msgHistory = S.msgHistory.concat(data.messages);
              replayHistory(S.msgHistory);
            }
            break;
          }
        }
      } catch (e) {
        handleError('onData-' + msgType, e);
      }
    };
  }

  /* ==========================================================================
     HOST — Shared peer initialization for createRoom / createRoomWithCode
     ========================================================================== */
  async function initHostPeer(code, opts) {
    opts = opts || {};
    if (S.destroyed) return;
    if (typeof Peer === 'undefined') { toast('PeerJS library failed to load.', 'error'); return; }

    if (S.peer) destroy('manual');

    S.destroyed = false;
    S.role = 'host';
    S.code = code;
    S.lastActivity = Date.now();
    S.encryptionReady = false;
    S.encryptionKey = null;
    S.encryptionKeyB64 = null;
    S.guestCount = 0;
    S.users = [];
    S.conns = [];

    /* Import transferred encryption key or generate new one */
    if (opts.encryptionKey) {
      try {
        var rawBytes = base64ToArrayBuffer(opts.encryptionKey);
        S.encryptionKey = await importKey(new Uint8Array(rawBytes));
        S.encryptionKeyB64 = opts.encryptionKey;
        S.encryptionReady = true;
      } catch (_) {
        try {
          S.encryptionKey = await generateEncryptionKey();
          S.encryptionKeyB64 = await exportKeyBase64(S.encryptionKey);
          S.encryptionReady = true;
        } catch (_) {
          toast('Encryption init failed', 'error');
        }
      }
    } else {
      try {
        S.encryptionKey = await generateEncryptionKey();
        S.encryptionKeyB64 = await exportKeyBase64(S.encryptionKey);
        S.encryptionReady = true;
      } catch (_) {
        toast('Encryption init failed', 'error');
      }
    }

    /* Restore chat history from transfer */
    if (opts.history && opts.history.length > 0) {
      S.msgHistory = opts.history;
    }

    /* Restore transferred host rights */
    if (opts.roomMode) S.roomMode = opts.roomMode;
    if (opts.blockedIPs) S.blockedIPs = opts.blockedIPs;
    if (opts.allowedSenders) S.allowedSenders = opts.allowedSenders;

    var peer = new Peer(code, peerOpts());
    S.peer = peer;

    /* Host timeout: if signaling server unreachable */
    var hostTimeout = setTimeout(function () {
      if (!S.connected && !S.destroyed && S.role === 'host' && (!S.peer || !S.peer.id)) {
        toast('Cannot reach signaling server. Try again.', 'error');
        destroy('manual');
      }
    }, 20000);

    peer.on('open', function (id) {
      clearTimeout(hostTimeout);
      renderCode(id, D.hostCode);
      genQR(id);
      try {
        var qrCanvas = D.qrHost.querySelector('canvas');
        if (qrCanvas) S.storedQR = qrCanvas.toDataURL();
      } catch (_) {}
      S.waitingForGuest = true;
      showScreen('host');
      if (opts.toast) toast(opts.toast, 'success');
      /* After transfer: enter chat to show name + replay history */
      if (opts.history && opts.history.length > 0) {
        setTimeout(function () {
          enterChat(S.code);
          replayHistory(S.msgHistory);
          D.input.disabled = true;
          D.btnSend.disabled = true;
          S.waitingForGuest = true;
          D.chatDot.className = 'status-dot';
          D.chatDot.style.background = 'var(--accent)';
          D.chatDot.style.boxShadow = '0 0 8px var(--accent-glow)';
          D.chatLabel.textContent = (S.myName || 'Host') + ' \u2014 Waiting for guests\u2026';
        }, 200);
      } else if (opts.transfer) {
        enterChat(S.code, true);
      }
    });

    peer.on('connection', function (conn) {
      S.conns.push(conn);
      S.connected = true;
      S.guestCount++;
      S.lastActivity = Date.now();

      conn._uid = opts.connUid
        ? opts.connUid()
        : 'g' + (++_connIdCounter);
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
              if (report.type === 'candidate-pair' && report.nominated && report.remoteCandidateId) {
                candidateId = report.remoteCandidateId;
              }
              if (report.type === 'remote-candidate' && report.address && report.address !== '0.0.0.0' && report.address !== '::') {
                ip = report.address;
              }
            });
            if (ip === 'N/A' && candidateId) {
              stats.forEach(function (report) {
                if (report.id === candidateId && report.address && report.address !== '0.0.0.0' && report.address !== '::') {
                  ip = report.address;
                }
              });
            }
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
        if (S.blockedIPs.indexOf(ip) !== -1) {
          conn._blocked = true;
          if (S.guestCount > 0) S.guestCount--;
          removeUserByUid(conn._uid);
          S.conns = S.conns.filter(function (c) { return c !== conn; });
          try { conn.send({ type: 'blocked' }); } catch (_) {}
          try { conn.close(); } catch (_) {}
          toast('Blocked user attempted to join', '');
          return;
        }
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

      var onConnData = makeConnHandler(conn);
      conn.on('data', onConnData);
      function sendInitToGuest() {
        if (S.destroyed || conn._initSent) return;
        conn._initSent = true;
        sendKeyToGuest(0);
        sendKeyToGuest(500);
        sendKeyToGuest(2000);
        if (S.myName) {
          try { conn.send({ type: 'name-exchange', name: S.myName }); } catch (_) {}
        }
        if (S.roomMode) {
          try { conn.send({ type: 'room-mode', mode: S.roomMode }); } catch (_) {}
        }
        var isAllowed = S.allowedSenders.indexOf(conn._uid) !== -1;
        if (isAllowed) {
          try { conn.send({ type: 'sender-permission', allowed: true }); } catch (_) {}
        }
        /* Send chat history to new guest */
        if (S.msgHistory.length > 0) {
          sendChunkedHistory(conn, S.msgHistory, 'chat-history');
        }
      }
      conn.on('open', sendInitToGuest);
      if (conn.open) sendInitToGuest();
      conn.on('close', function () {
        if (S.destroyed || conn._blocked) return;
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
        S.encryptionReady = true;
        D.input.disabled = false;
        D.btnSend.disabled = false;
        D.chatDot.className = 'status-dot connected';
        D.chatDot.style.background = '';
        D.chatDot.style.boxShadow = '';
        var lbl = S.myName || 'Host';
        D.chatLabel.textContent = lbl + ' \u2014 ' + (S.guestCount === 1 ? '1 guest' : S.guestCount + ' guests');
      } else {
        D.input.disabled = false;
        D.btnSend.disabled = false;
        D.chatDot.className = 'status-dot connected';
        D.chatDot.style.background = '';
        D.chatDot.style.boxShadow = '';
        var lbl = S.myName || 'Host';
        D.chatLabel.textContent = lbl + ' \u2014 ' + (S.guestCount === 1 ? '1 guest' : S.guestCount + ' guests');
        toast('Guest connected', 'success');
      }
      initRateLimiter();
      initHeartbeat();
      S.waitingForGuest = false;
      renderUsersPanel();
      if (D.btnUsersPanel) D.btnUsersPanel.classList.remove('hidden');
    });

    peer.on('disconnected', function () {
      if (S.destroyed || S.role !== 'host') return;
      if (peer && !peer.destroyed) {
        try { peer.reconnect(); } catch (_) {}
      }
    });

    peer.on('error', function (err) {
      if (err.type === 'unavailable-id') {
        if (opts.onCollision) {
          opts.onCollision();
        } else {
          toast('Code collision. Generating a new one\u2026', '');
          setTimeout(function () { createRoom(); }, 600);
        }
      } else {
        toast('Error: ' + err.message, 'error');
      }
    });
  }

  async function createRoom() {
    var code = genCode();
    initHostPeer(code, {});
  }

  async function createRoomWithCode(code, opts) {
    opts = opts || {};
    initHostPeer(code, {
      toast: opts.toast || 'You are now the host',
      connUid: function () { return 'g_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5); },
      history: opts.history || [],
      encryptionKey: opts.encryptionKey || null,
      roomMode: opts.roomMode || 'normal',
      blockedIPs: opts.blockedIPs || [],
      allowedSenders: opts.allowedSenders || [],
      transfer: !!opts.transfer,
      onCollision: function () {
        toast('Code collision. Retrying\u2026', '');
        setTimeout(function () { createRoomWithCode(code, opts); }, 600);
      }
    });
  }

  /* ==========================================================================
     GUEST
     ========================================================================== */
  function joinWithCode(code, opts) {
    opts = opts || {};
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
    S.msgHistory = opts.history || [];
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

      function onGuestConnOpen() {
        if (conn._openFired) return;
        conn._openFired = true;
        clearTimeout(joinTimeout);
        if (S.destroyed) { try { conn.close(); } catch (_) {} return; }
        S.connecting = false;
        S.connected = true;
        S.lastActivity = Date.now();
        enterChat(code);
        /* Replay transferred chat history */
        if (opts.history && opts.history.length > 0) {
          S.msgHistory = opts.history;
          setTimeout(function () { replayHistory(opts.history); }, 500);
        }
        initRateLimiter();
        initHeartbeat();
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
      }

      conn.on('data', makeConnHandler(conn));
      conn.on('open', onGuestConnOpen);
      if (conn.open) onGuestConnOpen();
      conn.on('close', function () {
        S.connected = false;
        if (S.leaving) return;
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

    /* Room mode selector always hidden — toggled from users panel instead */
    if (D.roomModeSelect) {
      D.roomModeSelect.classList.add('hidden');
    }
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

  function updateRoomModeUI() {
    if (S.roomMode === 'readonly') {
      if (S.role !== 'host') {
        if (S.senderAllowed) {
          D.input.disabled = false;
          D.btnSend.disabled = false;
          D.input.placeholder = 'You have send permission\u2026';
        } else {
          D.input.disabled = true;
          D.btnSend.disabled = true;
          D.input.placeholder = 'Room is in read-only mode\u2026';
        }
      }
      if (D.encryptBadge) D.encryptBadge.classList.add('hidden');
    } else {
      if (S.role !== 'host') {
        D.input.disabled = false;
        D.btnSend.disabled = false;
        D.input.placeholder = 'Type a message\u2026';
      }
    }
  }

  function toggleRoomMode() {
    S.roomMode = S.roomMode === 'readonly' ? 'normal' : 'readonly';
    if (S.role === 'host' && S.connected) {
      S.conns.forEach(function (c) {
        try { c.send({ type: 'room-mode', mode: S.roomMode }); } catch (_) {}
      });
    }
    updateRoomModeUI();
    renderUsersPanel();
    toast(S.roomMode === 'readonly' ? 'Read-only mode enabled' : 'Normal mode enabled', '');
  }

  function blockIP(ip) {
    if (!ip || ip === 'N/A') return;
    if (S.blockedIPs.indexOf(ip) === -1) S.blockedIPs.push(ip);
    S.conns.forEach(function (c) {
      if (c._ip === ip) {
        try { c.send({ type: 'blocked' }); } catch (_) {}
        try { c.close(); } catch (_) {}
      }
    });
    S.conns = S.conns.filter(function (c) { return c._ip !== ip; });
    renderUsersPanel();
    toast('Blocked IP: ' + ip, 'success');
  }

  function unblockIP(ip) {
    var idx = S.blockedIPs.indexOf(ip);
    if (idx !== -1) S.blockedIPs.splice(idx, 1);
    renderUsersPanel();
    toast('Unblocked IP: ' + ip, '');
  }

  function toggleSenderPermission(uid) {
    var idx = S.allowedSenders.indexOf(uid);
    if (idx !== -1) {
      S.allowedSenders.splice(idx, 1);
      toast('Send permission revoked', '');
    } else {
      S.allowedSenders.push(uid);
      toast('Send permission granted', 'success');
    }
    broadcastAllowedSenders();
    renderUsersPanel();
  }

  function broadcastAllowedSenders() {
    if (S.role !== 'host') return;
    S.conns.forEach(function (c) {
      var uid = c._uid;
      var allowed = S.allowedSenders.indexOf(uid) !== -1;
      try { c.send({ type: 'sender-permission', allowed: allowed }); } catch (_) {}
    });
  }

  function broadcastUserList() {
    if (S.role !== 'host') return;
    var userList = [{ name: S.myName, isHost: true }];
    S.users.forEach(function (u) {
      userList.push({ name: u.name, isHost: false });
    });
    S.conns.forEach(function (c) {
      try { c.send({ type: 'user-list', users: userList }); } catch (_) {}
    });
  }

  function makeHost(uid) {
    if (S.role !== 'host') return;
    var user = S.users.find(function (u) { return u.uid === uid; });
    if (!user) return;

    var targetConn = S.conns.find(function (c) { return c._uid === uid; });
    if (!targetConn) { toast('User not connected', 'error'); return; }

    var newCode = genCode();
    var myName = S.myName;

    toast('Transferring host to ' + user.name + '\u2026', '');

    /* Fire everything — WebRTC buffers deliver even after destroy */
    try {
      targetConn.send({
        type: 'host-transfer',
        hostName: user.name,
        code: newCode,
        encryptionKey: S.encryptionKeyB64,
        roomMode: S.roomMode,
        blockedIPs: S.blockedIPs.slice(),
        allowedSenders: S.allowedSenders.slice()
      });
      sendChunkedHistory(targetConn, S.msgHistory, 'transfer-history');
    } catch (_) {}

    S.conns.forEach(function (c) {
      if (c !== targetConn) {
        try {
          c.send({ type: 'reconnect', code: newCode, hostName: user.name });
          sendChunkedHistory(c, S.msgHistory, 'chat-history');
        } catch (_) {}
      }
    });

    /* Destroy immediately — messages already buffered in WebRTC send queue */
    S.leaving = true;
    setTimeout(function () {
      S.leaving = false;
      destroy('host-transfer');
      setTimeout(function () {
        S.myName = myName;
        joinWithCode(newCode);
      }, 500);
    }, 50);
  }

  function renderGuestUserList() {
    if (S.role === 'host') return;
    D.usersList.textContent = '';

    /* Host name at top with HOST tag */
    var hostCard = document.createElement('div');
    hostCard.className = 'guest-user-card host-card';
    var hostNameEl = document.createElement('span');
    hostNameEl.className = 'guest-user-name';
    hostNameEl.textContent = S.hostName || 'Host';
    var hostTag = document.createElement('span');
    hostTag.className = 'host-tag';
    hostTag.textContent = 'HOST';
    hostCard.appendChild(hostNameEl);
    hostCard.appendChild(hostTag);
    D.usersList.appendChild(hostCard);

    /* Other guests sorted alphabetically */
    var guests = S.guestUsers
      .filter(function (u) { return !u.isHost; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });

    guests.forEach(function (u) {
      var card = document.createElement('div');
      card.className = 'guest-user-card';
      var nameEl = document.createElement('span');
      nameEl.className = 'guest-user-name';
      nameEl.textContent = u.name;
      card.appendChild(nameEl);
      D.usersList.appendChild(card);
    });
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

    /* Apply room mode for guests */
    if (S.role !== 'host') {
      updateRoomModeUI();
    }

    showScreen('chat');
    if (D.btnUsersPanel) {
      D.btnUsersPanel.classList.remove('hidden');
    }
    /* Host sees destroy button; guest sees leave button */
    if (S.role === 'host') {
      if (D.btnDestroy) D.btnDestroy.classList.remove('hidden');
      if (D.btnLeave) D.btnLeave.classList.add('hidden');
    } else {
      if (D.btnDestroy) D.btnDestroy.classList.add('hidden');
      if (D.btnLeave) D.btnLeave.classList.remove('hidden');
    }
    if (!waiting) setTimeout(function () { D.input.focus(); }, 300);
  }

  /* ==========================================================================
     DETAILS POPUP
     ========================================================================== */
  function showDetails() {
    if (S.code) {
      renderCode(S.code, D.detailsCode);
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
    renderUsersPanel();
    broadcastUserList();
  }

  function removeUserByUid(uid) {
    var idx = S.users.findIndex(function (u) { return u.uid === uid; });
    if (idx !== -1) {
      S.users.splice(idx, 1);
      renderUsersPanel();
      broadcastUserList();
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

    /* Room mode control for host */
    if (S.role === 'host') {
      var modeControl = document.createElement('div');
      modeControl.className = 'room-mode-control';

      var modeLabel = document.createElement('span');
      modeLabel.className = 'room-mode-label';
      modeLabel.textContent = 'Room Mode:';

      var modeBtn = document.createElement('button');
      modeBtn.className = 'room-mode-btn ' + (S.roomMode === 'readonly' ? 'readonly' : 'normal');
      modeBtn.textContent = S.roomMode === 'readonly' ? 'Read Only' : 'Normal';
      modeBtn.onclick = function () { toggleRoomMode(); };

      modeControl.appendChild(modeLabel);
      modeControl.appendChild(modeBtn);
      D.usersList.appendChild(modeControl);
    }

    if (S.users.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'users-empty';
      empty.textContent = 'No users connected';
      D.usersList.appendChild(empty);
    } else {
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

        var actions = document.createElement('div');
        actions.className = 'user-actions';

        var makeHostBtn = document.createElement('button');
        makeHostBtn.className = 'user-makehost-btn';
        makeHostBtn.textContent = 'Make Host';
        makeHostBtn.onclick = function (e) {
          e.stopPropagation();
          showConfirm('Transfer host to ' + user.name + '?').then(function (ok) {
            if (ok) makeHost(user.uid);
          });
        };

        var allowBtn = document.createElement('button');
        allowBtn.className = 'user-allow-btn';
        var isAllowed = S.allowedSenders.indexOf(user.uid) !== -1;
        allowBtn.textContent = isAllowed ? 'Deny Send' : 'Allow Send';
        allowBtn.classList.toggle('allowed', isAllowed);
        allowBtn.onclick = function (e) {
          e.stopPropagation();
          toggleSenderPermission(user.uid);
        };

        var blockBtn = document.createElement('button');
        blockBtn.className = 'user-block-btn';
        blockBtn.textContent = 'Block';
        blockBtn.onclick = function (e) {
          e.stopPropagation();
          showConfirm('Block IP ' + user.ip + '?').then(function (ok) {
            if (ok) blockIP(user.ip);
          });
        };

        actions.appendChild(makeHostBtn);
        if (S.roomMode === 'readonly') actions.appendChild(allowBtn);
        actions.appendChild(blockBtn);

        var topRow = document.createElement('div');
        topRow.className = 'user-card-top';
        topRow.appendChild(avatar);
        topRow.appendChild(info);
        topRow.appendChild(stat);

        card.appendChild(topRow);
        card.appendChild(actions);
        D.usersList.appendChild(card);
      });
    }

    /* Blocked IPs section */
    if (S.role === 'host' && S.blockedIPs.length > 0) {
      var blockedHeader = document.createElement('div');
      blockedHeader.className = 'blocked-header';
      blockedHeader.textContent = 'Blocked IPs';
      D.usersList.appendChild(blockedHeader);

      S.blockedIPs.forEach(function (ip) {
        var blockedCard = document.createElement('div');
        blockedCard.className = 'blocked-card';

        var ipText = document.createElement('span');
        ipText.className = 'blocked-ip';
        ipText.textContent = ip;

        var unblockBtn = document.createElement('button');
        unblockBtn.className = 'user-unblock-btn';
        unblockBtn.textContent = 'Unblock';
        unblockBtn.onclick = function () { unblockIP(ip); };

        blockedCard.appendChild(ipText);
        blockedCard.appendChild(unblockBtn);
        D.usersList.appendChild(blockedCard);
      });
    }
  }

  function showUsersPanel() {
    if (S.role === 'host') {
      renderUsersPanel();
    } else {
      renderGuestUserList();
    }
    D.usersOverlay.classList.remove('hidden');
    if (S._usersRefreshInt) clearInterval(S._usersRefreshInt);
    S._usersRefreshInt = setInterval(function () {
      if (S.role === 'host') renderUsersPanel();
      else renderGuestUserList();
    }, 10000);
  }

  function hideUsersPanel() {
    D.usersOverlay.classList.add('hidden');
    if (S._usersRefreshInt) { clearInterval(S._usersRefreshInt); S._usersRefreshInt = null; }
  }

  /* ==========================================================================
     PWA — Install Prompt
     ========================================================================== */
  function initPwaInstall() {
    var isFirefox = typeof InstallTrigger !== 'undefined' || navigator.userAgent.indexOf('Firefox') !== -1;
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var isSafari = isIOS && navigator.userAgent.indexOf('Safari') !== -1 && navigator.userAgent.indexOf('CriOS') === -1;
    if (isFirefox && !S.installDismissed && !S.connected) {
      D.installBtn.textContent = 'How to Install';
      D.installBtn.addEventListener('click', function () {
        D.installBanner.classList.add('hidden');
        toast('Firefox: click the address bar icon (pencil) or use the menu \u2192 "Install Page as App"', 'info', 6000);
      });
      D.installDismiss.addEventListener('click', function () {
        D.installBanner.classList.add('hidden');
        S.installDismissed = true;
      });
      setTimeout(function () { D.installBanner.classList.remove('hidden'); }, 3000);
      return;
    }
    if (isSafari && !S.installDismissed && !S.connected) {
      D.installBtn.textContent = 'How to Install';
      D.installBtn.addEventListener('click', function () {
        D.installBanner.classList.add('hidden');
        toast('Safari: tap the Share button \u2192 "Add to Home Screen"', 'info', 6000);
      });
      D.installDismiss.addEventListener('click', function () {
        D.installBanner.classList.add('hidden');
        S.installDismissed = true;
      });
      setTimeout(function () { D.installBanner.classList.remove('hidden'); }, 3000);
      return;
    }
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
    var msg = (error && error.message) ? error.message : String(error);
    toast('Error: ' + msg, 'error');
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

    /* Help Panel */
    (function () {
      var panel = document.getElementById('help-panel');
      var overlay = document.getElementById('help-overlay');
      var btnOpen = document.getElementById('btn-help-open');
      var btnClose = document.getElementById('btn-help-close');
      var searchInput = document.getElementById('help-search-input');
      var sections = panel ? panel.querySelectorAll('.help-section') : [];

      function openHelp() {
        if (!panel || !overlay) return;
        overlay.classList.remove('hidden');
        panel.classList.add('open');
        if (searchInput) { searchInput.value = ''; filterHelp(''); searchInput.focus(); }
      }
      function closeHelp() {
        if (!panel || !overlay) return;
        panel.classList.remove('open');
        setTimeout(function () { overlay.classList.add('hidden'); }, 350);
      }
      function filterHelp(query) {
        var q = query.toLowerCase().trim();
        sections.forEach(function (sec) {
          if (!q) { sec.classList.remove('hidden-section'); return; }
          var searchText = (sec.getAttribute('data-search') || '') + ' ' + sec.textContent.toLowerCase();
          var match = q.split(/\s+/).every(function (term) { return searchText.indexOf(term) !== -1; });
          sec.classList.toggle('hidden-section', !match);
        });
      }
      if (btnOpen) btnOpen.addEventListener('click', openHelp);
      if (btnClose) btnClose.addEventListener('click', closeHelp);
      if (overlay) overlay.addEventListener('click', closeHelp);
      if (searchInput) searchInput.addEventListener('input', function () { filterHelp(searchInput.value); });
    })();

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
        safeCopy(S.code).then(function () {
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
        safeCopy(shareUrl).then(function () { toast('Link copied!', 'success'); }).catch(function () { toast('Failed to copy', 'error'); });
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
      if (D.joinCodeInput.value.length === 6) showNamePrompt('join', D.joinCodeInput.value.toUpperCase());
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
        S.roomMode = 'normal';
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
        safeCopy(S.code).then(function () {
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
        safeCopy(shareUrl).then(function () { toast('Link copied!', 'success'); }).catch(function () { toast('Failed to copy', 'error'); });
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
    var fileInput = document.getElementById('file-input');
    var btnFile = document.getElementById('btn-file');
    if (btnFile && fileInput) {
      btnFile.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        var files = fileInput.files;
        if (!files || !files.length) return;
        for (var i = 0; i < files.length; i++) { sendFile(files[i]); }
        fileInput.value = '';
      });
    }
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

    /* Destroy with confirmation (double-tap) — HOST ONLY */
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

    /* Leave room — GUEST ONLY (disconnects without destroying room) */
    var leavePending = false;
    D.btnLeave.addEventListener('click', function () {
      if (leavePending) {
        leavePending = false;
        S.leaving = true;
        try { if (S.conn) S.conn.close(); } catch (_) {}
        try { if (S.peer) S.peer.destroy(); } catch (_) {}
        S.conn = null;
        S.peer = null;
        S.connected = false;
        S.connecting = false;
        S.role = null;
        S.code = null;
        showScreen('landing');
        toast('Left the room.', '');
        return;
      }
      leavePending = true;
      D.btnLeave.style.color = 'var(--danger)';
      D.btnLeave.style.background = 'var(--danger-soft)';
      D.btnLeave.textContent = '\u2713';
      setTimeout(function () {
        leavePending = false;
        D.btnLeave.style.color = '';
        D.btnLeave.style.background = '';
        D.btnLeave.textContent = '\u2190';
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
      safeCopy(msgText).then(function () {
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
      safeCopy(textEl.textContent).then(function () {
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
    if (sharedCode && /^[0-9A-Z]{6}$/.test(sharedCode.toUpperCase())) {
      setTimeout(function () { showNamePrompt('join', sharedCode.toUpperCase()); }, 300);
    }

  }

  window.addEventListener('error', function () {
    toast('Something went wrong. Refresh the page.', 'error');
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
