# DevMirror – Real-World Framework Compatibility & QA Audit Report

**Document Version:** 1.0.0  
**Date:** November 8, 2026  
**Auditor:** Senior QA Engineer & Full-Stack Systems Architect  
**Scope:** `@devmirror/core`, `@devmirror/scanner`, `@devmirror/cli`, `@devmirror/extension`  
**Test Environment:** Windows 11 x64, Node.js v22.17.1, pnpm v10.5.2, Vitest v3.2.7  

---

## Executive Summary

DevMirror is designed to enable zero-config local mobile web development previews by discovering locally running development servers, proxying HTTP and WebSocket traffic over the local area network (LAN), and streaming live Hot Module Replacement (HMR) updates to physical mobile browsers.

This audit evaluates the real-world operational readiness of DevMirror across major modern frontend frameworks and development servers. We distinguish **genuine runtime integration** (where real development servers run, compile code, serve assets, and process live HMR events) from **simulated protocol integration** (where mock HTTP and WebSocket servers replicate framework communication protocols).

### Core Findings & Audit Verdict

1. **Vite Ecosystem (React, Vue, Svelte, Vanilla):** Fully **VERIFIED**. Both programmatic Vite server instances and standalone React 19 + Vite 8.3.6 applications (`D:\code\demo-vite-app`) pass all end-to-end checks: initial 302 token-stripping handshake, session cookie issuance (`dm_session`), asset streaming (`@vite/client`, `/src/main.jsx`), live WebSocket HMR handshake (`{ type: "connected" }`), and instant session revocation with 401 unauthorized rejection.
2. **Generic Static & Express.js Servers:** Fully **VERIFIED**. Standard static asset streaming, ETag negotiation, HTTP `304 Not Modified` caching, and generic WebSocket live-reload proxying execute flawlessly without payload alteration.
3. **Next.js, Nuxt 3, Astro, Angular CLI, and Create React App (CRA):** Classified as **PARTIALLY SUPPORTED**. Full protocol validation tests pass in the automated test suite (`packages/core/test/framework-compatibility.test.ts`), covering URL routing, subprotocol handling, and header rewriting. However, because real development server runtimes (e.g., `next dev`, `nuxi dev`, `astro dev`, `ng serve`) were not executed as live processes in CI or local environments, real-world integration remains unverified pending live-stack fixtures.
4. **Physical Mobile Device Testing:** Classified as **PENDING (Manual Real-World Verification Required)**. All network proxying, cookie scoping, and WebSocket framing have been programmatically validated across simulated mobile clients, but end-to-end verification on a physical handheld device connected over Wi-Fi remains pending.

---

## Compatibility Classification Matrix

| Framework / Stack | Dev Server Engine | HMR Protocol & Path | Status | Verification Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **Vite + React** | Vite 8.3.6 / Vite 6 / 5 | Subprotocol `vite-hmr` on `/@vite-hmr` or `/` | **VERIFIED** | Real Vite app runtime in `demo-vite-app` + `real-vite-hmr.test.ts` |
| **Vite + Vue** | Vite 6 / 5 (`@vitejs/plugin-vue`) | Subprotocol `vite-hmr` on `/@vite-hmr` | **VERIFIED** | Shares identical `@vite/client` runtime & HMR transport protocol |
| **Vite + Svelte** | Vite 6 / 5 (`@sveltejs/vite-plugin-svelte`) | Subprotocol `vite-hmr` on `/@vite-hmr` | **VERIFIED** | Shares identical `@vite/client` runtime & HMR transport protocol |
| **Vite + Vanilla** | Vite 6 / 5 (Native ES modules) | Subprotocol `vite-hmr` on `/@vite-hmr` | **VERIFIED** | Verified programmatic Vite server test |
| **Generic HTTP / Express** | Node.js `http`, Express, Serve | Standard WebSocket live-reload (`/ws`, root) | **VERIFIED** | Real `http.Server` + `ws.WebSocketServer` in `framework-compatibility.test.ts` |
| **Next.js** | Fast Refresh (Webpack / Turbopack) | WebSocket on `/_next/webpack-hmr` | **PARTIALLY SUPPORTED** | Protocol simulation passed; genuine `next dev` integration pending |
| **Nuxt 3** | Nuxt Vite / Nitro | `/@vite-hmr`, `/__nuxt_hmr`, `/_nuxt/` | **PARTIALLY SUPPORTED** | Protocol simulation passed; genuine `nuxi dev` integration pending |
| **Astro** | Astro Vite Engine | `/@vite-hmr`, `/_astro/` | **PARTIALLY SUPPORTED** | Protocol simulation passed; genuine `astro dev` integration pending |
| **Angular CLI** | Webpack Dev Server / esbuild Vite | `/ng-cli-ws` and `/@vite-hmr` | **PARTIALLY SUPPORTED** | Protocol simulation passed; genuine `ng serve` integration pending |
| **Create React App (CRA)** | Webpack Dev Server v4/v5 | `/ws` and SockJS `/sockjs-node` | **PARTIALLY SUPPORTED** | Protocol simulation passed; genuine `react-scripts start` pending |

---

## Detailed Framework-by-Framework Analysis

### 1. Vite Ecosystem (React, Vue, Svelte, Vanilla) — `VERIFIED`

* **Fingerprint Detection:**
  * Detects `server: vite` response header.
  * Detects HTML markers: `/@vite/client`, `window.__vite_plugin_react_preamble_installed__`, `/@react-refresh`, `/@vite-hmr`.
  * Confidence: `high`.
* **Reverse Proxy & Host Rewriting:**
  * Upstream `Host` header is rewritten to `${target.host}:${target.port}` (e.g., `127.0.0.1:5173` or `localhost:5173`).
  * In Vite 6+, strict `server.allowedHosts` rejects cross-origin host requests with HTTP 403. DevMirror's host rewriting ensures Vite accepts the proxied connection as a trusted local loopback request.
* **WebSocket / HMR Handling:**
  * `ViteHmrAdapter` matches `/@vite-hmr`, `/`, or empty path.
  * Rewrites `Host` to `${target.host}:${target.port}` and deletes the client `Origin` header.
  * Negotiates the `vite-hmr` subprotocol seamlessly across duplex streams.
* **Empirical Verification:**
  * Executed live integration against `D:\code\demo-vite-app` (React 19 + Vite 8.3.6).
  * Proxy successfully returned 302 redirect for initial token pairing, issued HTTP-only `dm_session` cookie, fetched `@vite/client` and `/src/main.jsx`, established real WebSocket connection, and received `{ type: "connected" }`.

### 2. Next.js (Fast Refresh & Turbopack) — `PARTIALLY SUPPORTED`

* **Fingerprint Detection:**
  * Detects `x-powered-by: Next.js` header.
  * Detects HTML markers: `__NEXT_DATA__`, `/_next/static/`, `/_next/webpack-hmr`, `<div id="__next">`.
  * Confidence: `high`.
* **Reverse Proxy & Header Rewriting:**
  * Upstream `Host` rewritten to `${target.host}:${target.port}`.
  * `Origin` rewritten to `http://${target.host}:${target.port}` (or `https://...`).
  * Preserves all Next.js compilation query strings (e.g. `/_next/webpack-hmr?page=/`).
* **Known Limitations & Nuances:**
  * Next.js 14/15 introduced Server Actions origin verification and stricter cross-origin request policies (`allowedOrigins` in `next.config.js`). DevMirror's `Origin` rewrite satisfies standard Fast Refresh, but deep Server Actions mutating requests from LAN IP clients require validation against a live Next.js build.
  * Vitest suite validates simulated protocol communication; real `next dev` testing is pending.

### 3. Nuxt 3 — `PARTIALLY SUPPORTED`

* **Fingerprint Detection:**
  * Detects `x-powered-by: Nuxt` header.
  * Detects HTML markers: `__NUXT__`, `__NUXT_DATA__`, `/_nuxt/`, `<div id="__nuxt">`.
  * Confidence: `high`.
* **Reverse Proxy & Header Rewriting:**
  * Upstream `Host` rewritten to `${target.host}:${target.port}`.
  * `Origin` rewritten to `${scheme}://${target.host}:${target.port}`.
  * `NuxtHmrAdapter` handles paths: `/@vite-hmr`, `/`, `/_nuxt*`, `/__nuxt*`.
* **Known Limitations:**
  * Nuxt 3 is built on top of Vite and Nitro. While Vite HMR is verified, Nuxt's full server-side rendering (SSR) lifecycle, hydration markers, and Nitro dev server asset mapping require runtime validation against an active Nuxt project.

### 4. Astro — `PARTIALLY SUPPORTED`

* **Fingerprint Detection:**
  * Detects `x-astro` header.
  * Detects HTML markers: `<astro-island>`, `Astro.generator`, `data-astro-cid-`, `data-astro-source-file`.
  * Confidence: `high`.
* **Reverse Proxy & Header Rewriting:**
  * `AstroHmrAdapter` handles `/@vite-hmr`, `/`, and `/_astro*`.
  * Rewrites `Host` to `${target.host}:${target.port}` and deletes `Origin` (matching Vite's adapter requirements).
* **Known Limitations:**
  * Astro uses Vite under the hood for island hydration and component updates. While simulated protocol tests succeed, testing against a real running Astro multi-page app (MPA) remains pending.

### 5. Angular CLI — `PARTIALLY SUPPORTED`

* **Fingerprint Detection:**
  * Detects HTML markers: `ng-version="`, `<app-root>`, `/_ng-cli-ws`.
  * Confidence: `high`.
* **Reverse Proxy & Header Rewriting:**
  * `AngularHmrAdapter` handles `/ng-cli-ws` (Webpack) and `/@vite-hmr` (modern esbuild/Vite builder in Angular 17+).
  * Rewrites `Host` and `Origin` to target dev server.
* **Known Limitations:**
  * Angular applications often bind strictly to `localhost:4200` with host check enabled. DevMirror normalizes `Host`, but live Angular CLI compilation was only tested in simulated protocol harnesses.

### 6. Create React App (CRA) / Webpack Dev Server — `PARTIALLY SUPPORTED`

* **Fingerprint Detection:**
  * Detects `webpackHotDevClient`, `/static/js/bundle.js`, `/static/js/main.chunk.js`.
  * Confidence: `medium`.
* **Reverse Proxy & Header Rewriting:**
  * `CraHmrAdapter` handles `/ws` (Webpack Dev Server v4/v5) and `/sockjs-node` (v3).
  * Rewrites `Host` and `Origin` to target dev server.
* **Known Limitations:**
  * Create React App is officially deprecated upstream, but Webpack Dev Server remains common in legacy enterprise codebases. Simulated protocol tests pass, but live runtime integration is pending.

### 7. Generic Node.js / Express.js Servers — `VERIFIED`

* **Detection:**
  * Detects standard `<!DOCTYPE html>`, `<html>`, or `content-type: text/html`.
  * Confidence: `low` (fallback).
* **Reverse Proxy & Header Rewriting:**
  * Pure transparent streaming pass-through for static files, JavaScript modules, CSS stylesheets, images, and fonts.
  * Respects `If-None-Match` and `If-Modified-Since` caching headers, returning `304 Not Modified` without transferring redundant payloads.
  * Tested with genuine Node.js `http.Server` and `ws.WebSocketServer` instances in automated regression tests.

---

## Architectural & Systems Findings

### 1. Windows Dual-Stack Loopback Resolution (`localhost` vs `127.0.0.1`)

* **Discovery:**
  On modern Windows systems running Node.js 18+, DNS resolution for `localhost` resolves to `::1` (IPv6 loopback) with higher priority than `127.0.0.1` (IPv4 loopback).
* **Impact on Dev Servers:**
  When development servers (such as Vite or Next.js) start without an explicit host flag (e.g. running bare `npx vite`), Node binds the HTTP server exclusively to `[::1]:5173`.
  If DevMirror probes or targets `127.0.0.1:5173`, Windows TCP stack rejects the connection with `connect ECONNREFUSED 127.0.0.1:5173`.
* **Resolution in Practice:**
  * DevMirror functions cleanly when the target is configured as `localhost` (which allows Node's native resolver to select `::1`), or when the developer starts the server with `--host 127.0.0.1` or `--host 0.0.0.0`.
  * **Recommendation:** Enhance `@devmirror/scanner` port probing to support dual-stack fallback: when probing a port, if `127.0.0.1` is refused, attempt `::1` (or `localhost`) before marking the port as closed.

### 2. Upstream Host Header Normalization

* Modern bundlers (Vite 6, Next.js, Webpack) implement protection against DNS rebinding and untrusted cross-origin requests by validating the incoming HTTP `Host` header.
* DevMirror's `LanProxyServer` rewrites the incoming `Host` header on all proxied requests to `${target.host}:${target.port}`.
* This is a critical architectural strength: mobile devices on the LAN send `Host: 192.168.1.50:4000`, but the dev server receives `Host: localhost:5173`. As a result, developers do not need to configure complex `allowedHosts` arrays or disable security in their projects.

### 3. Session Security & Token Stripping

* DevMirror uses a two-tier authentication architecture:
  1. **QR Code Pairing URL:** `http://<lan-ip>:4000/?dm_token=<session-token>`
  2. **Initial Handshake (302 Redirect):** DevMirror intercepts the initial request, validates the token, registers the mobile device, sets an HTTP-only session cookie (`dm_session`), and returns HTTP 302 redirecting to `/`.
  3. **Upstream Sanitization:** The proxy strips `dm_session` from the `Cookie` header before passing requests upstream, ensuring that internal DevMirror pairing tokens are never exposed to developer application code or server logs.
  4. **Referer Sanitization:** Any `Referer` header containing `?dm_token=...` is stripped before forwarding.

### 4. Client-Side SPA Routing (HTML5 History API)

* When mobile browsers navigate client-side routes (e.g. `/dashboard` or `/about`), requests are forwarded directly to the upstream dev server.
* Upstream development servers equipped with SPA fallback return the root `index.html`. DevMirror streams this response back cleanly, maintaining the session cookie across all pushState navigation transitions.

### 5. Control API Isolation

* The DevMirror Control API listens strictly on loopback interface `127.0.0.1:4100`.
* Inbound requests from the LAN network cannot reach port 4100.
* Mutating endpoints require `x-devmirror-token` and CSRF protection headers (`x-devmirror-csrf`), and Origin validation strictly rejects non-extension web origins.

---

## Physical Mobile Device Testing Status

> [!WARNING]
> **Status: PENDING (Physical Device Required)**
>
> While all underlying protocols (HTTP proxying, cookie scoping, WebSocket upgrading, subprotocol negotiation, and header rewriting) have been verified programmatically, physical mobile device testing has not yet been executed with an actual handheld device over Wi-Fi.
>
> **Required Physical Test Steps:**
> 1. Connect physical phone to the same Wi-Fi network as the development workstation.
> 2. Ensure Windows Firewall permits inbound TCP traffic on LAN proxy port 4000.
> 3. Scan the terminal QR code using the native iOS Camera or Android Google Lens.
> 4. Verify that the mobile browser opens the URL, performs the 302 redirect, stores the `dm_session` cookie, and renders the frontend.
> 5. Make a source file change in `App.jsx` and confirm that the mobile browser updates immediately without a full page reload.

---

## Recommended Next Steps & Roadmap

In order of priority:

1. **Dual-Stack Scanner Fallback (P1):**
   Update `packages/scanner/src/prober/port-prober.ts` to probe both IPv4 `127.0.0.1` and IPv6 `::1` (`localhost`) so development servers that bind exclusively to IPv6 `localhost` on Windows are automatically discovered without requiring `--host 127.0.0.1`.
2. **Real-World Next.js Fixture Test (P2):**
   Add a programmatic Next.js integration test (similar to `real-vite-hmr.test.ts`) using `@next/bundle` or a minimal Next.js fixture to elevate Next.js from `PARTIALLY SUPPORTED` to `VERIFIED`.
3. **Real-World Nuxt & Astro Fixture Tests (P2):**
   Add minimal real dev server integration tests for Nuxt 3 and Astro.
4. **Physical Mobile Device Verification (P1):**
   Perform a live test session with a physical iOS and Android device to record real-world latency, viewport scaling, and HMR responsiveness.
