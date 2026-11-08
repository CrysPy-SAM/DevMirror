# DevMirror v0.1.0 Release Notes

**Release Tag:** `v0.1.0`  
**Date:** 2026-11-08  
**License:** MIT  

---

## Highlights

DevMirror v0.1.0 is the inaugural open-source release of DevMirror — a zero-configuration developer tool designed to preview locally running web applications on physical mobile devices by scanning a terminal QR code, with preserved Hot Module Replacement (HMR) and strict LAN security isolation.

- **Zero-Config Mobile Previews (`npx devmirror`):** Auto-discovers locally running dev servers on standard ports, resolves local Wi-Fi interface addresses, and renders an in-terminal ANSI QR code.
- **Preserved Framework HMR:** Proxies HTTP assets and forwards WebSocket HMR connections without breaking live reloads or requiring dev servers to bind to `0.0.0.0`.
- **Ephemeral 256-Bit Cryptographic Security:** 256-bit CSPRNG token authentication, automatic address-bar token scrubbing, and upstream cookie sanitization.
- **Cross-Platform OS Process Inspection:** Native process inspection for Windows (`netstat`/`tasklist`) and POSIX (`lsof`/`ss`/`ps`) without shell interpolation.
- **Manifest V3 Chrome Extension:** Browser companion dashboard for monitoring connected mobile devices, viewing pairing QR codes, and dynamically switching targets.

---

## Included Packages

| Package | Version | Description |
| :--- | :--- | :--- |
| **`@devmirror/cli`** | `0.1.0` | CLI application and terminal runner (`npx devmirror`). |
| **`@devmirror/core`** | `0.1.0` | LAN reverse proxy, HMR adapters, HTML streaming rewriter, session manager, and Control API. |
| **`@devmirror/scanner`** | `0.1.0` | TCP port prober, process inspector, and framework fingerprinting engine. |
| **`@devmirror/shared`** | `0.1.0` | Shared TypeScript contracts, protocol constants, and token security utilities. |
| **`@devmirror/extension`** | `0.1.0` | Manifest V3 Chrome Extension companion dashboard. |

---

## Verified Framework Compatibility Matrix

| Framework | Verification Level | Verification Details |
| :--- | :--- | :--- |
| **Vite + React / Vue / Svelte** | **Genuine Runtime Integration** | Verified against live Vite dev server instances (`@vite/client` script rewrite and WebSocket HMR message forwarding). |
| **Generic HTTP Dev Servers** | **Genuine Runtime Integration** | Verified against live HTTP servers (static asset delivery, 304 Not Modified cache headers, and custom live reload WebSockets). |
| **Next.js (Pages & App Router)** | **Simulated Protocol Integration** | Verified against simulated Fast Refresh wire protocol (`/_next/webpack-hmr`). |
| **Angular CLI** | **Simulated Protocol Integration** | Verified against simulated Angular Webpack Dev Server protocol (`/ng-cli-ws`). |
| **Astro** | **Simulated Protocol Integration** | Verified against simulated Astro HTML endpoints and nested Vite HMR WebSockets. |
| **Nuxt 3** | **Simulated Protocol Integration** | Verified against simulated Nuxt 3 HTML payloads with `__NUXT_DATA__` and Nitro HMR WebSockets. |
| **Create React App (CRA)** | **Simulated Protocol Integration** | Verified against simulated Webpack Dev Server v4/v5 WebSocket protocol (`/ws`). |

---

## Publishing Instructions (Maintainers Only)

> [!WARNING]
> Do NOT publish packages or extension bundles without prior explicit authorization from the project owner.

### 1. Publishing to npm

1. **Verify packages locally via dry-run:**
   ```bash
   pnpm run build
   pnpm test
   cd packages/cli && npm pack --dry-run
   cd ../core && npm pack --dry-run
   cd ../scanner && npm pack --dry-run
   cd ../shared && npm pack --dry-run
   ```
2. **Publish packages:**
   ```bash
   # From monorepo root
   pnpm -r publish --access public
   ```

### 2. Submitting the Chrome Extension to Chrome Web Store

1. **Generate the production Web Store bundle:**
   ```bash
   pnpm --filter @devmirror/extension run build
   pnpm --filter @devmirror/extension run package
   ```
2. **Locate the production ZIP:**
   `apps/extension/dist/devmirror-extension-webstore-v0.1.0.zip`
   *(Note: This package strictly strips the development `"key"` field as mandated by Chrome Web Store developer policies).*
3. **Upload to Chrome Web Store Developer Dashboard:**
   - Log into the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
   - Click **Add new item**.
   - Upload `devmirror-extension-webstore-v0.1.0.zip`.
   - Fill in store listing metadata, screenshots, and privacy policy declaration (declaring that DevMirror collects zero user data).
   - Submit for review.

---

## Known Limitations

1. **Physical Network Isolation:** Devices must reside on the same Local Area Network (Wi-Fi subnet). Public Wi-Fi networks with "Client Isolation" enabled will prevent direct mobile-to-workstation communication.
2. **Linux User Permissions:** Inspecting processes started by another user on multi-user Linux workstations may hide the PID if running without sudo. DevMirror handles this gracefully and serves the proxy without crashing.
3. **WSL 2 on Windows:** Projects running inside WSL 2 require host port forwarding or WSL 2 mirrored networking mode (`networkingMode=mirrored`) to accept inbound mobile Wi-Fi packets.
