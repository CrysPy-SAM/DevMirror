# Changelog

All notable changes to the DevMirror project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-11-08

### Added
- **Monorepo Architecture (`@devmirror/shared`, `@devmirror/core`, `@devmirror/scanner`, `@devmirror/cli`, `@devmirror/extension`)**:
  - Organized as a unified `pnpm` workspace with strict TypeScript configurations.
- **LAN Reverse Proxy (`@devmirror/core`)**:
  - Reverse proxy binding to `0.0.0.0:4000` (with automatic port conflict fallback).
  - Zero-latency HTTP request proxying with keep-alive socket management and compression support (gzip, Brotli, deflate).
  - WebSocket proxying supporting bidirectional message forwarding and clean connection teardown.
- **Framework-Aware HMR Adapters (`@devmirror/core`)**:
  - Native runtime proxying for Vite development servers and `@vite/client`.
  - Protocol compatibility adapters for Next.js Fast Refresh (`/_next/webpack-hmr`), Angular CLI (`/ng-cli-ws`), Astro, Nuxt 3, Create React App / Webpack Dev Server (`/ws`), and generic live-reload servers.
- **HTML Streaming Rewriter & Companion HUD (`@devmirror/core`)**:
  - Zero-dependency HTML streaming transformer that rewrites inline framework HMR paths to proxy coordinates.
  - Automatic CSP `<meta>` tag and header parsing with nonce preservation.
  - Optional mobile companion overlay banner (`--overlay`) with live connection status.
- **Dev Server Scanner & Port Prober (`@devmirror/scanner`)**:
  - Concurrent TCP probing across standard dev ports (3000, 5173, 4200, 8080, etc.).
  - Cross-platform OS process inspection:
    - **Windows:** Native `netstat -ano -p tcp` and `tasklist.exe` parsing.
    - **Linux & macOS:** Native `lsof -n -P -iTCP:<port> -sTCP:LISTEN -F pc`, `ss -tlpn`, and `ps` parsing with argument arrays and strict execution timeouts.
  - Framework signature detection based on HTTP headers, HTML DOM markers, and framework scripts (Vite, Next.js, Angular, Astro, Nuxt, CRA).
- **Interactive Terminal CLI (`@devmirror/cli`)**:
  - Zero-config mobile preview workflow: `npx devmirror`.
  - In-terminal ANSI QR code rendering for one-tap mobile camera pairing.
  - Interactive server selector with confidence ranking (`high`, `medium`, `low`).
  - Runtime keyboard shortcuts (`q` to quit, `r` to rescan, `h` for help).
  - Command-line arguments: `--port`, `--host`, `--overlay`, `--insecure`, `--proxy-port`, `--control-port`, `--help`, `--version`.
- **Manifest V3 Chrome Extension (`@devmirror/extension`)**:
  - Browser dashboard with instant pairing QR code, server discovery, and connected device tracking.
  - Deterministic development Chrome Extension ID (`kmcaoghdokfdbadplofpkeabloldmoga`) based on pinned RSA SPKI key.
- **Cryptographic Session & Security Architecture**:
  - Ephemeral 256-bit CSPRNG tokens with `crypto.timingSafeEqual` validation.
  - Automatic token exchange: Query parameter token is converted into an `HttpOnly`, `SameSite=Lax` session cookie (`__devmirror_session`), scrubbing the token from the browser address bar.
  - Strict Control API Origin separation:
    - Wildcard `OPTIONS` preflights reject mutating methods (`POST`, `DELETE`, `PUT`, `PATCH`) from web origins with `403 Forbidden`.
    - Mutating endpoints and sensitive endpoints (`/api/v1/session/pairing-url`, `/api/v1/discover`, `/api/v1/devices`) strictly require verified Chrome Extension origins or non-browser CLI authorization (`x-devmirror-cli: 1`).
  - Upstream Cookie Sanitization: The internal `__devmirror_session` cookie is stripped before forwarding HTTP or WebSocket requests upstream to the developer's server.
  - SSRF & Metadata Protection: Private LAN and loopback IP validator blocking link-local, loopback rebinds, broadcast, and cloud metadata endpoints (`169.254.169.254`).
