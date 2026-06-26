# MANGAUD

> **Encrypted peer-to-peer messenger.** Zero servers. Zero persistence. Soft Neon UI.

[![License: MIT](https://img.shields.io/badge/License-MIT-7c6aef.svg)](./LICENSE)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-00d4aa.svg)](#pwa)
[![Security](https://img.shields.io/badge/AES--256--GCM-Secure-ff4d6a.svg)](#security)
[![PeerJS](https://img.shields.io/badge/WebRTC-PeerJS-7c6aef.svg)](#tech-stack)

**[Live Demo](https://mangaud-chatting.netlify.app)** | **[Report Issue](https://github.com/mangalam-gaud/mangaud-chatting/issues)**

---

## What is MANGAUD?

A zero-persistence, peer-to-peer encrypted messenger with **multi-guest support**. Messages exist only in RAM and vanish the moment you close the tab. No servers. No databases. No logs. Just pure, encrypted conversations with unlimited participants in a room.

Designed with a **Soft Neon** aesthetic — deep space dark backgrounds, electric indigo accents, teal secondary, frosted glass panels, and smooth animations that work beautifully in both dark and light modes.

---

## Features

### Core
- **AES-256-GCM Encryption** — Military-grade encryption via Web Crypto API with per-message random IVs
- **Multi-Guest Support** — Unlimited guests can join a single room, all seeing messages in real-time
- **Peer-to-Peer** — Direct WebRTC connections (PeerJS) with STUN/TURN for NAT traversal
- **Zero Persistence** — No localStorage, IndexedDB, or cookies. Close tab = everything vanishes
- **Room Persistence** — Room stays alive when guests leave; only host disconnect destroys it

### Messaging
- **Sender Names** — Every message shows who sent it; host name shows with "(Host)" tag
- **Multiline Code Sharing** — Paste code blocks, renders in monospace with dark background
- **Copy Button** — Per-message copy with "Copied!" feedback, plus right-click shortcut
- **Delivery Status** — Single check (sent) → double check (delivered) via ACK protocol
- **Typing Indicators** — Shows peer's actual name when typing
- **Notification Sound** — Optional audio chime on new messages (togglable)
- **50K Character Limit** — Messages truncated with warning if too long
- **Date Separators** — "Today", "Yesterday", or date between message groups
- **Haptic Feedback** — Vibration on send/receive (mobile devices)

### Host Controls
- **Users Panel** — Live panel showing each guest's name, IP, join time, and message count
- **Block IP** — Kick and block any user by IP; blocked users cannot rejoin
- **Make Host** — Transfer host role to any connected user; all guests auto-reconnect
- **Room Mode** — Toggle between Normal (everyone sends) and Read-Only (host only)
- **Allow Send** — Grant specific users permission to send in read-only mode
- **Room Destruction** — Double-tap to confirm; notifies all guests before cleanup

### QR & Sharing
- **QR Code Generation** — Room code displayed as QR for easy sharing
- **QR Code Scanning** — Camera scanner with animated scan line, auto-joins on detection
- **Shared Link Joining** — Share URL with `?code=XXXXXXXX`, auto-opens name prompt
- **Diamond/Pyramid Code Display** — 8-character codes shown in 1-2-3-2 pyramid pattern

### UX
- **Dark / Light Mode** — Respects OS preference with manual toggle on every screen
- **Refresh Lock** — Prevents accidental F5/Ctrl+R while in a room
- **Auto-Scroll** — New messages scroll to bottom unless you've scrolled up
- **Scroll-to-Bottom Button** — Floating button appears when scrolled up
- **Auto-Resize Textarea** — Input grows as you type, up to 120px
- **Paste Handling** — Preserves formatting and cursor position

### PWA
- **Installable** — Works like a native app on Android, iOS, and Desktop
- **Offline Support** — App shell cached by service worker after first visit
- **Auto-Update** — Service worker detects new versions and prompts to refresh
- **App Shortcuts** — "Host a Room" and "Join a Room" on long-press
- **Standalone Mode** — No browser chrome, full-screen experience
- **Maskable Icons** — Adaptive icon support on Android

---

## Quick Start

### Host a Room
1. Click **Host a Room**
2. Enter your name
3. Choose **Normal** or **Read-Only** mode
4. Share the 8-character code, QR code, or link with others
5. Each guest who joins appears in the **Users Panel** (click the users icon)

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
Sender:
  plaintext --> AES-256-GCM encrypt(randomIV, key) --> WebRTC --> Host

Host broadcasts:
  decrypt(key, ciphertext, IV) --> display + re-encrypt --> forward to all guests
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
| **CSP** | Strict Content-Security-Policy (script/style/img/connect sources) |
| **SRI** | Subresource Integrity hashes on all CDN scripts |
| **IP Blocking** | Host can block IPs to prevent rejoin |

See [SECURITY.md](./SECURITY.md) for detailed security documentation.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | HTML5, CSS3 (Soft Neon theme), Vanilla JS |
| **Networking** | WebRTC via PeerJS |
| **Encryption** | Web Crypto API — AES-256-GCM |
| **QR Generation** | QRCode.js |
| **QR Scanning** | jsQR |
| **PWA** | Service Worker (cache-first) + Web App Manifest |
| **Fonts** | Inter (UI) + JetBrains Mono (code) via Google Fonts |
| **Hosting** | Static (Netlify, Vercel, GitHub Pages, etc.) |

---

## Project Structure

```
mangaud-chatting/
├── index.html            # All screens (landing, host, join, chat, overlays, scanner)
├── manifest.json         # PWA manifest (name: "MANGAUD")
├── sw.js                 # Service worker (cache-first, v12)
├── .netlify.toml         # Netlify config (SPA redirect, security headers, cache control)
├── css/
│   └── style.css         # Soft Neon theme (~1413 lines)
├ js/
│   └── app.js            # All application logic (~2494 lines)
├── scripts/
│   └── gen-icons.py      # Icon resizing script (Python Pillow)
├── assets/
│   ├── logo.jpeg         # Original brand logo
│   ├── icon-192.png      # PWA icon (192x192)
│   └── icon-512.png      # PWA icon (512x512)
├── README.md
├── SECURITY.md
└── LICENSE               # MIT
```

---

## PWA

MANGAUD is a fully-featured Progressive Web App:

- **Install prompts** on Android (Chrome), iOS (Safari Share > Add to Home Screen), and Desktop (address bar install icon)
- **Offline support** — App shell cached by service worker after first visit
- **Auto-update** — Service worker detects new versions and shows update banner
- **Maskable icons** for adaptive icon support on Android
- **Standalone mode** — No browser chrome, full-screen experience
- **Shortcuts** for quick Host/Join actions on long-press
- **Online/offline detection** — Toast notifications for connectivity changes

### Service Worker Strategy
| Request Type | Strategy |
|-------------|----------|
| Local assets | Cache-first with stale-while-revalidate |
| CDN scripts | Cache-first with network fallback |
| External APIs | Network-only with offline fallback |

### Install Instructions
| Platform | Steps |
|----------|-------|
| **Android Chrome** | Tap "Add to Home Screen" when prompted |
| **iOS Safari** | Share > Add to Home Screen |
| **Desktop Chrome** | Click install icon in address bar |
| **Desktop Edge** | Settings > Apps > Install |

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
| `Enter` | Send message / Submit code / Submit name |
| `Shift + Enter` | New line in message |
| `Escape` | Close active overlay (name prompt / details / users / scanner) |
| `F5 / Ctrl+R` | Blocked while in a room (prevents accidental refresh) |
| `Right-click` on message | Copy message text |

---

## Responsive Design

| Breakpoint | Behavior |
|------------|----------|
| <= 320px | Ultra-compact layout, smallest fonts |
| <= 380px | Compact padding, smaller elements |
| 400-599px | Default mobile layout (520px max-width) |
| 600px+ | Wider container (560px), larger elements |
| 900px+ | Desktop width (600px) |
| >= 800px height | More vertical spacing |

---

## Animations

| Animation | Purpose |
|-----------|---------|
| `fadeUp` | Messages and screen transitions |
| `scaleIn` | Cards, panels, popups |
| `pulse` | Status dots, loading indicators |
| `borderGlow` | Filled pyramid characters |
| `float` | Brand logo bobbing |
| `gradientShift` | Landing page background |
| `scanLine` | QR scanner scanning line |
| `toastIn/Out` | Toast notifications |

All animations respect `prefers-reduced-motion: reduce` for accessibility.

---

## Icon Generation

To regenerate PWA icons from the logo:
```bash
pip install Pillow
python scripts/gen-icons.py
```

This creates circular-cropped 192x192 and 512x512 PNGs from `assets/logo.jpeg`.

---

## License

MIT License — see [LICENSE](./LICENSE)

---

## Author

**MANGAUD** — [github.com/mangalam-gaud](https://github.com/mangalam-gaud)
