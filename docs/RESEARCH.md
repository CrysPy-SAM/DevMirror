# DevMirror: Technical Research & Feasibility Analysis

**Document Status:** Approved Architecture Plan  
**Target Version:** v0.1.0 – v1.0.0  
**Author:** DevMirror Architecture & Developer Tools Engineering Team  

---

## 1. Executive Summary & Problem Space

Modern web development heavily relies on responsive design and mobile-first user experiences. While desktop browser developer tools provide device emulation (e.g., Chrome DevTools device mode), simulated environments fail to capture:
- Physical touch ergonomics, inertial scrolling, and gesture responsiveness.
- Real hardware performance (GPU rasterization, low-memory throttling, thermal constraints).
- Real mobile browser engine quirks (iOS WebKit vs. Android Blink).
- Software keyboard behavior, viewport resizing (`dvh`, `lvh`, `svh`), and notch/safe-area insets.

Developers currently test on physical devices via two brittle methods:
1. **Binding dev servers to `0.0.0.0`** and manually typing local IP addresses (e.g., `http://192.168.1.45:5173`) into mobile browsers. This breaks Hot Module Replacement (HMR) if the bundler expects `localhost`, fails when firewalls block ports, exposes unauthenticated local servers to untrusted Wi-Fi peers, and is tedious to type.
2. **Third-party public tunnels (e.g., ngrok, Cloudflare Tunnels, localtunnel)**: These add external internet roundtrip latency (ruining HMR sub-50ms feedback loops), require account sign-ups, frequently hit rate limits, and risk leaking proprietary corporate code over public URLs.

**DevMirror** bridges this gap: a zero-configuration, secure, local-first developer tool that detects active local dev servers, launches a high-performance reverse proxy on the local area network (LAN), serves an authenticated QR code in both terminal and a Chrome Extension, and seamlessly mirrors real-time HMR updates onto physical mobile devices.

---

## 2. Technical Feasibility Analysis

| Functional Requirement | Feasibility Rating | Primary Mechanism | Key Technical Risk |
| :--- | :--- | :--- | :--- |
| **Local Dev Server Detection** | **High** | Process table inspection + socket probing + Chrome active tab discovery | Zombie processes, ephemeral port collisions |
| **HTTP Reverse Proxy** | **Very High** | Fastify + `@fastify/http-proxy` (duplex stream forwarding) | Chunked transfer encoding, compression decompression for HTML injection |
| **WebSocket / HMR Proxy** | **High** | `ws` package bidirectional stream forwarding with protocol negotiation | Ping/pong keepalive mismatch, path rewrites |
| **QR Code Generation** | **Very High** | ANSI terminal render (`qrcode-terminal`) & Canvas in Extension (`qrcode`) | Terminal contrast readability, QR version sizing |
| **Mobile Browser Compatibility** | **High** | Modern Safari (iOS 15+) and Chrome/Firefox (Android) | Client isolation on enterprise Wi-Fi, mixed content |
| **Zero-Config HMR Propagation** | **High** | Header rewriting + dynamic HTML injection of HMR socket shim | Framework-specific client bundle hardcoding `localhost` |

---

## 3. Deep-Dive: Framework-Specific HMR Mechanics

Hot Module Replacement (HMR) is not standardized across the JavaScript ecosystem. Different bundlers and frameworks use distinct protocols, WebSocket endpoints, payload contracts, and client-side runtimes.

```
+--------------------------------------------------------------------------------------------------+
|                                    HMR PROTOCOL TAXONOMY                                         |
+--------------------------------------------------------------------------------------------------+
| Framework / Tool  | Transport      | Default Path             | Payload Schema / Client Behavior |
+-------------------+----------------+--------------------------+----------------------------------+
| Vite (React/Vue)  | WebSocket      | `/@vite-hmr` or root WS  | JSON `{ type: 'update' | ... }`  |
| Next.js (Webpack) | EventSource/SSE| `/_next/webpack-hmr`     | JSON chunks with compilation hash|
| Next.js (Turbopk) | WebSocket      | `/_next/webpack-hmr`     | Custom Turbo binary/JSON frames  |
| Angular (Webpack) | WebSocket      | `/ng-cli-ws`             | Webpack dev server action packets|
| Angular (Vite)    | WebSocket      | `/@vite-hmr`             | Vite standard protocol           |
| Vanilla LiveServer| WebSocket      | `/ws` or `/live-server`  | Trigger full page reload signals |
+-------------------+----------------+--------------------------+----------------------------------+
```

### 3.1 Vite (React, Vue, Svelte, Vanilla)
* **Client Runtime:** Vite injects `/@vite/client` into index HTML.
* **WebSocket Endpoint:** By default, connects to the same host/port on `ws://<host>:<port>/` or explicit `hmr.path` (defaults to root or `/@vite-hmr`).
* **The HMR Pitfall:**
  - If Vite is started on `localhost:5173`, the generated client bundle hardcodes or infers the connection string from `window.location`.
  - When accessed over a proxy at `http://192.168.1.12:4000`, Vite attempts to connect to `ws://192.168.1.12:4000`.
  - If Vite's internal `server.hmr.clientPort` or `server.hmr.host` is misaligned or if Vite blocks the Host header via `server.allowedHosts` (introduced in Vite 6), requests fail with `403 Forbidden` or WS connection timeout.
* **DevMirror Mitigation:**
  1. Proxy transparently rewrites incoming `Host` and `Origin` headers to match `localhost:5173` before forwarding to Vite.
  2. For the mobile client, DevMirror dynamically intercepts responses to `/@vite/client` or the root HTML and injects a micro-shim overriding `window.__vite_plugin_react_preamble_installed__` and HMR WebSocket URL resolution to target DevMirror's proxy port.

### 3.2 Next.js (Pages and App Router)
* **Client Runtime:** Next.js embeds Fast Refresh runtime.
* **Transport Mechanisms:**
  - **Webpack (Pages & legacy App Router):** Server-Sent Events (SSE) via `GET /_next/webpack-hmr`.
  - **Turbopack (`next dev --turbo`):** WebSocket duplex connection via `GET /_next/webpack-hmr` (with `Upgrade: websocket`).
* **The HMR Pitfall:**
  - SSE connections require infinite response streams without socket buffering or premature timeout.
  - Next.js enforces cross-origin protections on development assets and checks `x-forwarded-host`.
  - If Next.js uses an asset prefix (`assetPrefix`), relative URLs on mobile can fail if proxy path routing alters the base.
* **DevMirror Mitigation:**
  1. DevMirror's HTTP proxy disables response buffering and compression on `/_next/webpack-hmr`, ensuring SSE chunks stream immediately to the mobile device.
  2. Both SSE and WebSocket upgrade requests on `/_next/*` are forwarded seamlessly with correct `X-Forwarded-For` and `X-Forwarded-Host` headers.

### 3.3 Angular (`ng serve`)
* **Client Runtime:**
  - **Angular CLI <= v16 (Webpack):** Uses Webpack Dev Server connecting to `ws://<host>:<port>/ng-cli-ws`.
  - **Angular CLI >= v17 (Application Builder with Vite/esbuild):** Uses Vite's internal dev server architecture.
* **The HMR Pitfall:**
  - Angular's Webpack dev server validates Host headers strictly against `allowedHosts`.
* **DevMirror Mitigation:**
  - Header normalization replaces `Host: 192.168.x.x` with `Host: localhost:<angular-port>`, passing Angular's host check while proxying the `/ng-cli-ws` WebSocket endpoint.

### 3.4 Vanilla HTML/CSS/JS (Live Server, http-server, serve)
* **Client Runtime:**
  - VS Code Live Server uses an injected `<script>` tag that connects to `ws://127.0.0.1:5500/ws`.
  - `http-server` or `serve` do not provide HMR at all.
* **DevMirror Mitigation:**
  - DevMirror proxies the underlying static server. If Live Server is present, the WS traffic on `/ws` is routed.
  - If a static server lacks HMR, DevMirror provides an optional synthetic live-reload script injection powered by a lightweight file-watcher inside DevMirror itself.

---

## 4. Automatic Dev Server & Port Detection Strategies

To provide a zero-configuration developer experience, DevMirror must autonomously discover which port and framework the developer is running.

```
+-----------------------------------------------------------------------------------+
|                        PORT & SERVER DETECTION PIPELINE                           |
+-----------------------------------------------------------------------------------+
| 1. OS Process Scanning  --> Find running node/vite/next processes & working dir  |
| 2. Socket Table Scan    --> Query active TCP listening sockets (3000-9000)        |
| 3. Chrome Extension     --> Active tab inspection (detect http://localhost:PORT)  |
| 4. Probe & Fingerprint  --> Send lightweight HTTP HEAD / GET probe + inspect tags|
| 5. Candidate Selector   --> Prioritize active tab, CWD match, or prompt user      |
+-----------------------------------------------------------------------------------+
```

### 4.1 Comparison of Detection Approaches

| Detection Method | Mechanics | Latency | Accuracy | Limitations |
| :--- | :--- | :--- | :--- | :--- |
| **1. Socket Table Probe** | Scan well-known ports (`3000`, `5173`, `8080`, `4200`, `8000`, etc.) using raw TCP client connection. | ~50–150ms | Medium | Fast, but cannot identify *which* project is running if multiple servers exist. |
| **2. OS Process Inspection** | Query OS process table (`Get-NetTCPConnection` on Windows, `lsof` / `ss` on macOS/Linux) matching PID to Node.js CLI. | ~200–400ms | High | Matches current working directory (`process.cwd()`) to the dev server PID. |
| **3. Chrome Extension Active Tab** | Extension queries active tab URL via `chrome.tabs.query({ active: true, currentWindow: true })`. | ~20–50ms | Highest (Intent-based) | Developer is actively looking at the project tab in Chrome. Requires extension installed. |
| **4. HTTP Fingerprint Probe** | Issue `GET /` and check headers (`X-Powered-By`, Vite preamble, `<div id="__next">`). | ~50ms | Very High | Confirms the server is an active web application and detects framework. |

### 4.2 Fingerprinting Signatures
- **Vite:** Response HTML contains `/@vite/client` or script with `type="module"`.
- **Next.js:** Response HTML contains `/_next/static/` or header `X-Powered-By: Next.js`.
- **Angular:** HTML contains `<app-root>` or `<script src="runtime.js">`.
- **Astro:** HTML contains `astro-island` or `Astro.generator`.
- **Vanilla/Webpack:** Response headers or standard HTML structure.

---

## 5. Technical Challenges & Limitations

### 5.1 Local Network & Wi-Fi Client Isolation (AP Isolation)
* **The Problem:** In corporate offices, co-working spaces, university networks, and guest Wi-Fi networks, Access Point (AP) Isolation is often enabled by network administrators. This prevents Wi-Fi clients from communicating directly with each other (mobile phone cannot reach computer LAN IP `192.168.1.50`).
* **DevMirror Strategy:**
  1. At startup, DevMirror runs a fast UDP/TCP echo or self-diagnostic LAN probe.
  2. If client isolation is detected or the mobile client cannot ping the local agent within 5 seconds, DevMirror displays a clear diagnostic warning with recommended solutions:
     - Connect mobile and laptop to a personal hotspot.
     - Use USB reverse tethering (`adb reverse tcp:4000 tcp:4000` for Android / Safari Web Inspector for iOS).
     - Switch to DevMirror Remote Tunnel mode (future architectural milestone).

### 5.2 HTTPS vs. HTTP Mixed Content & Security Restrictions
* **The Problem:** Modern mobile browsers restrict several Web APIs over insecure HTTP (e.g., Geolocation, Camera/Microphone, Web Crypto, Clipboard, Service Workers). Furthermore, if the developer project itself runs HTTPS locally (via `mkcert`), a proxy running HTTP will trigger mixed content errors.
* **DevMirror Strategy:**
  - DevMirror operates on plain HTTP by default for seamless zero-install LAN pairing without SSL certificate warning dialogues.
  - When the target dev server uses HTTPS (`https://localhost:5173`), DevMirror's proxy establishes a TLS connection to the local target while terminating or mirroring certificates.
  - For projects requiring mobile HTTPS Web APIs, DevMirror includes a local ephemeral Certificate Authority generator (using pure JS certificate minting or `mkcert` integration) with instructions to install the local root CA on the mobile device once.

### 5.3 Mobile Viewport & Operating System Quirks
* **iOS Safari Bottom URL Bar:** Safari dynamically shifts viewport heights between `100vh`, `100svh`, and `100dvh`. DevMirror's mobile companion overlay is styled with `env(safe-area-inset-bottom)` and fixed anchoring to never obstruct touch interaction.
* **Screen Sleep / Battery Saver:** Mobile devices quickly suspend background WebSockets when the screen turns off. DevMirror's mobile companion script implements an exponential backoff reconnect loop with heartbeat pings every 5 seconds to instantly restore HMR synchronization upon unlock.

---

## 6. Competitive Analysis & Positioning

| Capability | DevMirror | ngrok / Cloudflare Tunnels | Vite `--host` | Expo / Metro |
| :--- | :--- | :--- | :--- | :--- |
| **Connectivity** | Local Wi-Fi (P2P LAN) | Public Cloud Relay | Local Wi-Fi | Local Wi-Fi / Tunnel |
| **Latency** | **< 3ms** (LAN speed) | 50–250ms (Cloud hop) | < 3ms | < 10ms |
| **Security Model** | Ephemeral cryptographic token + LAN bound | Public URL (often brute-forceable unless gated) | Open (Unauthenticated LAN) | Open LAN |
| **HMR Support** | Vite, Next.js, Angular, Webpack | Frequently drops WS, slow | Vite only (fails Next/others) | React Native only |
| **Browser Extension** | Yes (1-Click QR & Port Auto-Detect) | No | No | No |
| **Mobile Diagnostics** | Injected mobile console/log HUD | No | No | Mobile DevMenu |
| **Cloud Account Req.**| **Zero (100% Free & Open Source)** | Required | None | None |

---

## 7. Feasibility Verdict

The technical feasibility of DevMirror is confirmed. By combining Fastify's low-overhead HTTP/WebSocket streaming proxy, intelligent header normalization, automated port probing, and Chrome Manifest V3 active tab discovery, DevMirror achieves an instantaneous, secure developer loop without relying on cloud infrastructure.
