# MANGAUD

> **Encrypted peer-to-peer messenger.** Zero servers. Zero persistence. Glassmorphism + Cyberpunk UI.

[![License: MIT](https://img.shields.io/badge/License-MIT-00f5ff.svg)](./LICENSE)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-00ff88.svg)](#pwa)
[![Security](https://img.shields.io/badge/AES--256--GCM-Secure-ff3366.svg)](#security)
[![PeerJS](https://img.shields.io/badge/WebRTC-PeerJS-7c3aed.svg)](#tech-stack)

**[Live Demo](https://mangaud-chatting.netlify.app)** | **[Report Issue](https://github.com/mangalam-gaud/mangaud-chatting/issues)**

---

## What is MANGAUD?

A zero-persistence, peer-to-peer encrypted messenger with **multi-guest support**. Messages exist only in RAM and vanish the moment you close the tab. No servers. No databases. No logs. Just pure, encrypted conversations with unlimited participants in a room.

Designed with a **glassmorphism + cyberpunk** aesthetic — frosted glass panels, neon accents, and a dark cyberpunk atmosphere that works beautifully in both dark and light modes.

---

## Features

- **AES-256-GCM Encryption** — Military-grade encryption via Web Crypto API with per-message random IVs
- **Multi-Guest Support** — Unlimited guests can join a single room, all seeing messages in real-time
- **Peer-to-Peer** — Direct WebRTC connections (PeerJS), no relay servers, no data storage
- **Zero Persistence** — No localStorage, IndexedDB, or cookies. Close tab = everything vanishes
- **Refresh Lock** — Prevents accidental F5/Ctrl+R while in a room
- **Users Panel (Host)** — Live panel showing each guest's name, IP, join time, and message count
- **Sender Names** — Every message shows who sent it (all guest names + host name)
- **Copy Icon + Right-Click Copy** — Always-visible copy button on every message, plus right-click shortcut
- **QR Code Sharing + Scanning** — Generate QR codes to share room, scan to join instantly
- **Shared Link Joining** — Share a URL with `?code=XXXXXXXX`, recipient auto-joins
- **Diamond / Pyramid Code Display** — 8-character room codes shown in a diamond pattern for visual clarity
- **Dark / Light Mode** — Respects OS preference with manual toggle, both modes professionally themed
- **PWA Installable** — Works like a native app on Android, iOS, and Desktop
- **8-Character Room Codes** — Cryptographically random (36^8 possibilities via `crypto.getRandomValues()`)
- **No Timers** — Rooms persist until tab is closed (never auto-destroy from inactivity)
- **Typing Indicators** — See when someone is typing
- **Notification Sound** — Optional audio chime on new messages
- **Delivery Status** — Sent / Delivered indicators on your messages

---

## Quick Start

### Host a Room
1. Click **Host a Room**
2. Enter your name
3. Share the 8-character code, QR code, or link with others
4. Each guest who joins appears in the **Users Panel** (`👥` button)

### Join a Room
1. Click **Join a Room** (or open a shared `?code=XXXXXXXX` link)
2. Enter the 8-character code or scan the QR code
3. Enter your name and start chatting instantly

---

## How It Works

```
Host generates room code (8-char alphanumeric)
  |
  +--> Host creates AES-256-GCM encryption key
  |
  +--> Guest #1 joins with code
  |      |
  |      +--> Key exchanged over WebRTC (DTLS-encrypted)
  |      +--> Messages encrypted with AES-256-GCM
  |
  +--> Guest #2, #3, ... join
  |      |
  |      +--> Each guest gets the shared encryption key
  |      +--> All messages broadcast to all guests
  |
  +--> Host closes tab = room destroyed, everything wiped
```

### Encryption Flow
```
Guest sends:
  plaintext --> AES-256-GCM encrypt(randomIV, key) --> WebRTC --> Host
Host broadcasts:
  decrypt(key, ciphertext, IV) --> display + re-encrypt --> forward to others
```

---

## Security

| Feature | Implementation |
|---------|---------------|
| **Encryption Algorithm** | AES-256-GCM (Web Crypto API — `SubtleCrypto`) |
| **Key Exchange** | Over WebRTC data channel (DTLS 1.2 encrypted) |
| **Initialization Vector** | 12-byte random per message, transmitted alongside ciphertext |
| **Key Derivation** | `crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 })` |
| **Transport** | WebRTC Peer-to-Peer via PeerJS with STUN/TURN |
| **Storage** | RAM only (zero persistence — no localStorage, IndexedDB, cookies) |
| **XSS Protection** | `textContent` / `createTextNode` only — never `innerHTML` with user input |
| **Message IDs** | Cryptographically random per message for delivery tracking |
| **Rate Limiting** | Token-bucket algorithm prevents abuse |

See [SECURITY.md](./SECURITY.md) for detailed security documentation.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | HTML5, CSS3 (Glassmorphism + Cyberpunk), Vanilla JS |
| **Networking** | WebRTC via PeerJS |
| **Encryption** | Web Crypto API — AES-256-GCM |
| **QR Generation** | QRCode.js |
| **QR Scanning** | jsQR |
| **PWA** | Service Worker (cache-first) + Web App Manifest |
| **Fonts** | Inter (UI) + JetBrains Mono (code) |
| **Hosting** | Static (Netlify, Vercel, GitHub Pages, etc.) |

---

## Project Structure

```
mangaud-chatting/
├── index.html            # All app screens (landing, host, join, chat, overlays)
├── manifest.json         # PWA manifest (name: "MANGAUD")
├── sw.js                 # Service worker (cache-first, v12)
├── css/
│   └── style.css         # Soft Neon theme (~1033 lines)
├── js/
│   └── app.js            # All application logic (~1684 lines)
├── scripts/
│   └── gen-icons.py      # Icon resizing script (Python Pillow)
├── assets/
│   ├── logo.jpeg         # Original brand logo
│   ├── icon-192.png      # PWA icon (192×192)
│   └── icon-512.png      # PWA icon (512×512)
├── README.md
├── SECURITY.md
└── LICENSE               # MIT
```

---

## PWA

MANGAUD is a fully-featured Progressive Web App:

- **Install prompts** on Android (Chrome), iOS (Safari Share → Add to Home Screen), and Desktop (address bar install icon)
- **Offline support** — App shell cached by service worker after first visit
- **Maskable icons** for adaptive icon support on Android
- **Standalone mode** — No browser chrome, full-screen experience
- **Shortcuts** for quick Host/Join actions

### Install Instructions
| Platform | Steps |
|----------|-------|
| **Android Chrome** | Tap "Add to Home Screen" when prompted |
| **iOS Safari** | Share → Add to Home Screen |
| **Desktop Chrome** | Click install icon in address bar |
| **Desktop Edge** | Settings → Apps → Install |

---

## Browser Support

| Browser | Minimum Version |
|---------|----------------|
| Chrome | 56+ |
| Firefox | 55+ |
| Safari | 14+ |
| Edge | 79+ |
| Opera | 43+ |
| Samsung Internet | 6.0+ |
| Mobile Chrome (Android) | 56+ |
| Mobile Safari (iOS) | 14.1+ |

---

## Deploy

### Netlify (one-click)
```bash
netlify deploy --prod --dir=.
```

### Any Static Host
Just upload the project folder. No build step, no dependencies to install.

Ensure your host:
- Serves `index.html` for all routes (for deep-linking with `?code=`)
- Supports HTTPS (required for WebRTC, Service Worker, Web Crypto API)

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Escape` | Close active overlay (name prompt / details / users / scanner) |
| `Right-click` on message | Copy message text |

---

## Icon Generation

To regenerate PWA icons from the logo:
```bash
pip install Pillow
python scripts/gen-icons.py
```

This creates circular-cropped 192×192 and 512×512 PNGs from `assets/logo.jpeg`.

---

## License

MIT License — see [LICENSE](./LICENSE)

---

## Author

**MANGAUD** — [github.com/mangalam-gaud](https://github.com/mangalam-gaud)
