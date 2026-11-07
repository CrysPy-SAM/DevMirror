# DevMirror: Implementation Roadmap & Execution Plan

**Document Status:** Approved Architecture Plan  
**Target Version:** v0.1.0 – v1.0.0  
**Author:** DevMirror Architecture & Developer Tools Engineering Team  

---

## 1. Phased Execution Roadmap

The roadmap is structured into 8 progressive, modular milestones. Each phase delivers a verifiable, testable slice of functionality.

```
+--------------------------------------------------------------------------------------------------+
|                                    IMPLEMENTATION TIMELINE                                       |
+--------------------------------------------------------------------------------------------------+
[Phase 0: Workspace & Tooling] ──> [Phase 1: Core Proxy & Auth] ──> [Phase 2: HMR Adapters]
                                                                             │
[Phase 5: Chrome Extension MV3] <── [Phase 4: Scanner Engine] <── [Phase 3: CLI & Terminal QR]
             │
             └──> [Phase 6: Mobile Companion HUD] ──> [Phase 7: Test Suite & Hardening]
                                                                  │
                                                                  └──> [Phase 8: Remote Tunnel]
+--------------------------------------------------------------------------------------------------+
```

---

### Phase 0: Workspace Setup & Monorepo Tooling
**Objective:** Establish the pnpm monorepo structure, build pipelines, strict TypeScript configs, and shared types.

- **Tasks:**
  1. Initialize root `package.json`, `pnpm-workspace.yaml`, and `.gitignore`.
  2. Configure root `tsconfig.base.json` with strict type checking and project references.
  3. Initialize package directories: `packages/shared`, `packages/core`, `packages/scanner`, `packages/client-overlay`, `apps/cli`, `apps/extension`.
  4. Implement `@devmirror/shared` with core interfaces: `TargetDevServer`, `SessionInfo`, `ConnectedClient`, and IPC schemas.
  5. Configure Vitest workspace runner (`vitest.workspace.ts`).
- **Acceptance Criteria:**
  - `pnpm install` succeeds across all workspaces.
  - `pnpm build` compiles `@devmirror/shared` without type errors.
  - `pnpm test` runs cleanly.

---

### Phase 1: Core Proxy Engine & Network Resolver (`@devmirror/core`)
**Objective:** Build high-performance Fastify reverse proxy with cryptographic session authentication and LAN IP resolution.

- **Tasks:**
  1. Implement `network/interface.ts`: Enumerate and select active Wi-Fi IPv4 address.
  2. Implement `session/manager.ts`: 256-bit CSPRNG token minting, constant-time validation (`crypto.timingSafeEqual`), and in-memory session registry.
  3. Build `proxy/http.ts`: Fastify HTTP reverse proxy with stream forwarding.
  4. Implement header rewriting: Normalizing `Host`, `Origin`, `Referer`, and injecting `X-Forwarded-*`.
  5. Build `proxy/ws.ts`: WebSocket upgrade dispatcher routing raw frames to target ports.
  6. Add session guard middleware: Reject unauthenticated requests with `401 Unauthorized`.
- **Acceptance Criteria:**
  - Fastify proxy forwards HTTP requests from `http://<LAN_IP>:4000/?dm_token=...` to a mock target server on `127.0.0.1:8080`.
  - Cookie promotion (`Set-Cookie: dm_session=...`) and 302 redirect succeed.
  - Unauthenticated requests are rejected.
  - WebSocket duplex echo test passes with zero dropped frames.

---

### Phase 2: Framework-Specific HMR Adapters & HTML Rewriter Pipeline
**Objective:** Guarantee seamless Hot Module Replacement (HMR) across Vite, Next.js, and Angular.

- **Tasks:**
  1. Implement `injection/stream.ts`: Streaming HTML transformer supporting gzip/brotli decompression and injecting custom scripts before `</head>`.
  2. Implement `hmr/vite.ts`: Vite HMR adapter (rewrites `/@vite/client` WebSocket endpoint resolution).
  3. Implement `hmr/nextjs.ts`: Next.js Fast Refresh adapter (unbuffered SSE stream forwarding on `/_next/webpack-hmr` + Turbopack WS upgrades).
  4. Implement `hmr/angular.ts`: Angular adapter handling `/ng-cli-ws` Webpack and Vite application builders.
  5. Implement Content-Security-Policy (CSP) patching to allow companion WebSocket connections.
- **Acceptance Criteria:**
  - HTML responses receive the injected companion script without corrupting the DOM or encoding.
  - Test fixture for Vite React updates dynamically on a mock mobile client without full page refresh.
  - Test fixture for Next.js App Router preserves Fast Refresh over proxy.

---

### Phase 3: DevMirror CLI & Terminal QR UI (`apps/cli`)
**Objective:** Deliver the primary developer CLI tool with interactive ANSI QR code display and zero-config startup.

- **Tasks:**
  1. Setup Commander.js CLI entry point: `devmirror start`, `devmirror status`, `devmirror scan`.
  2. Integrate `qrcode-terminal` for compact, high-contrast QR display in terminal output.
  3. Implement Interactive TUI (terminal status display showing active target port, LAN URL, connected mobile devices count, and shortcut keys: `r` to regenerate token, `q` to quit).
  4. Bind CLI daemon to Fastify proxy engine.
  5. Launch the Loopback Control API on `127.0.0.1:4100` for Chrome Extension integration.
- **Acceptance Criteria:**
  - Running `npx devmirror --target 5173` prints a clean terminal UI with a scannable ANSI QR code.
  - Scanning QR with physical mobile phone opens the local project immediately.

---

### Phase 4: Port Detection & Process Scanner Engine (`@devmirror/scanner`)
**Objective:** Enable zero-config discovery of active dev servers.

- **Tasks:**
  1. Implement `ports/prober.ts`: High-speed concurrent TCP socket prober for default dev ports (`5173`, `3000`, `8080`, `4200`, `8000`, `5000`, etc.).
  2. Implement `process/inspector.ts`: Cross-platform process table scanner (Windows PowerShell `Get-NetTCPConnection`, macOS/Linux `lsof`/`ss`) resolving PID to working directory.
  3. Implement `fingerprint/detector.ts`: HTTP signature probe identifying Vite, Next.js, Angular, or Vanilla.
  4. Combine into single unified `detectActiveDevServer()` method.
- **Acceptance Criteria:**
  - CLI detects Vite or Next.js server automatically without passing `--target` or `--port`.
  - Detection runs in < 250ms.

---

### Phase 5: Chrome Extension MV3 (`apps/extension`)
**Objective:** Create a companion Chrome Extension for 1-click QR display and active tab pairing.

- **Tasks:**
  1. Create Manifest V3 configuration with least-privilege permissions (`activeTab`, `storage`).
  2. Implement background service worker:
     - Polls/connects to DevMirror Local Agent Control API (`127.0.0.1:4100`).
     - Detects when active tab URL matches `http://localhost:*` or `http://127.0.0.1:*`.
     - Sends detected port to Local Agent via REST endpoint `/api/target`.
  3. Build Extension Popup with React + Tailwind CSS:
     - Crisp SVG/Canvas QR Code.
     - Live connected device indicator.
     - Target port selector and switch button.
     - 1-click "Copy URL" and "Revoke Session" controls.
- **Acceptance Criteria:**
  - Extension connects to running CLI agent.
  - Active tab on `localhost:3000` updates extension popup and generates matching QR code in < 100ms.
  - Extension works completely offline on local loopback.

---

### Phase 6: Mobile Client Overlay (`packages/client-overlay`)
**Objective:** Provide a lightweight, zero-dependency mobile on-screen debugging HUD.

- **Tasks:**
  1. Build `client-overlay` as a standalone TypeScript project compiling to `< 12KB` standalone JS (`companion.min.js`).
  2. Implement Collapsible Floating Pill (draggable, thumb-friendly, safe-area inset aware).
  3. Implement In-Browser Console Drawer: Intercepts `console.log`, `console.error`, and `window.onerror` to display real-time errors directly on mobile.
  4. Implement Reload & Cache Buster button.
  5. Implement WebSocket heartbeat indicator (Ping latency & status).
- **Acceptance Criteria:**
  - Companion HUD renders smoothly on iOS Safari and Android Chrome without interfering with the parent web app's CSS/layout.
  - Errors logged in mobile console appear immediately in the HUD drawer.

---

### Phase 7: Verification, Hardening & Automated Testing Suite
**Objective:** Monorepo test coverage, security verification, and performance benchmarking.

- **Tasks:**
  1. Build comprehensive unit test suite in Vitest for crypto, headers, proxy streaming, and port scanning.
  2. Build integration test suite with mock Vite and Next.js fixture servers.
  3. Run security audit against STRIDE threat model:
     - Timing attack verification on token checking.
     - Loopback isolation verification on Control API.
     - SSRF target validation tests.
  4. Measure proxy throughput and latency overhead (target: < 3ms added latency).
- **Acceptance Criteria:**
  - All Vitest suites pass across Windows, macOS, and Linux runners.
  - Zero unauthenticated requests can reach target servers.
  - 100% of documented features verified.

---

### Phase 8: Future Architecture: Remote Tunnel Extension
**Objective:** Enable remote mobile preview across different networks (e.g. cellular data or firewalled Wi-Fi) without changing core proxy code.

- **Tasks:**
  1. Implement `ITunnelProvider` interface in `@devmirror/core`.
  2. Integrate an open-source tunnel provider adapter (e.g., Cloudflare Tunnel / WebRTC P2P Data Channel).
  3. Add CLI flag: `devmirror --tunnel`.
  4. Update Chrome Extension popup to toggle between "Local Wi-Fi" and "Remote Tunnel".
- **Acceptance Criteria:**
  - Remote tunnel generates a secure HTTPS tunnel URL with end-to-end token authentication.
  - HMR continues to function over remote tunnel WebSocket connection.
