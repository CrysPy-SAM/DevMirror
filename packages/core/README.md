# @devmirror/core

Core reverse proxy, session management, framework HMR adapters, and local Control API engine for DevMirror.

## Overview
`@devmirror/core` is the runtime coordination engine that powers DevMirror's local mobile previews:
- **LAN Reverse Proxy:** High-performance HTTP and WebSocket reverse proxy with keep-alive socket management and compression handling.
- **Framework HMR Adapters:** Rewrites and proxies WebSocket handshakes for Vite (`/@vite-hmr`), Next.js (`/_next/webpack-hmr`), Angular (`/ng-cli-ws`), and generic development servers.
- **HTML Streaming Rewriter:** Rewrites HTML markers on the fly and optionally injects mobile companion overlays while preserving CSP nonces.
- **Local Control API:** Fastify-based loopback REST API strictly bound to `127.0.0.1` for extension and CLI management.
- **Session Manager:** Ephemeral 256-bit CSPRNG token management and upstream cookie sanitization.

## License
MIT
