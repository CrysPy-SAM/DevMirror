# @devmirror/extension

> Chrome Extension Dashboard for DevMirror - Instant Mobile Preview Controller.

The DevMirror Chrome Extension connects to your local DevMirror agent running on `http://127.0.0.1:4100`, providing a clean, responsive browser popup to discover local dev servers, generate mobile pairing QR codes, monitor connected devices, and manage active preview sessions.

---

## Features

- **Agent Status Indicator**: Real-time status badge showing whether the local DevMirror agent is running.
- **One-Click Project Discovery**: Discovers running web servers (Vite, Next.js, Nuxt, Astro, Angular, CRA) and allows starting previews with one click.
- **In-Browser QR Code**: Renders an SVG QR code directly inside the extension popup for instant physical camera scanning.
- **One-Click URL Copy**: Copies the full LAN preview pairing URL to your clipboard.
- **Real-Time Connected Devices**: Displays connected mobile devices (iOS, Android, etc.) with local IP addresses and pairing timestamps.
- **Zero Token Leakage**: Pairing tokens remain strictly in memory and are never saved to extension storage or printed to logs.

---

## Development & Building

### 1. Build the Extension

From the repository root:

```bash
# Build all packages including extension
pnpm run build

# Or build the extension specifically
pnpm --filter @devmirror/extension run build
```

This compiles TypeScript, bundles React with Vite, processes Tailwind CSS, and outputs the production bundle to `apps/extension/dist`.

### 2. Run in Development Mode

```bash
pnpm --filter @devmirror/extension run dev
```

---

## Loading Unpacked Extension in Chrome

1. Open Google Chrome (or any Chromium-based browser like Brave, Edge, or Arc).
2. Navigate to `chrome://extensions`.
3. In the top-right corner, enable **Developer mode**.
4. Click **Load unpacked** in the top-left.
5. Select the `apps/extension/dist` directory (or `apps/extension` if loading directly).
6. The **DevMirror** extension icon will appear in your browser toolbar. Pin it for quick access!

---

## Required Permissions & Least Privilege

The extension complies strictly with **Chrome Extension Manifest V3** and follows the principle of least privilege:

| Permission | Purpose |
| :--- | :--- |
| `storage` | Saves user preferences (e.g. customized local Control API port). |
| `host_permissions` | Strictly limited to `http://127.0.0.1/*` and `http://localhost/*` to communicate with the local agent. |

**No sensitive permissions requested**:
- `cookies` is **not** requested.
- `webRequest` is **not** requested.
- `tabs` is **not** requested.
- `<all_urls>` is strictly avoided.

---

## Security Architecture

1. **Exact Deterministic Extension ID Allowlist**:
   - The extension manifest contains a pinned RSA 2048-bit SPKI public key (`"key"`), yielding the deterministic extension ID:
     ```
     kmcaoghdokfdbadplofpkeabloldmoga
     ```
   - The local DevMirror agent strictly enforces this allowlist. Arbitrary extensions or browser scripts receive `403 Forbidden`.
2. **CORS & CSRF Protection**:
   - All mutating requests (`POST /api/v1/session`, `DELETE /api/v1/session`) transmit `x-devmirror-csrf: 1`.
   - The agent rejects requests with missing or invalid Origin headers. Wildcard CORS (`*`) is never used.
3. **Pairing URL Isolation**:
   - The unmasked pairing URL (`GET /api/v1/session/pairing-url`) is accessible **only** to the trusted Chrome Extension origin. Web origins (e.g. `http://localhost:3000`) are blocked with `403 Forbidden`.
   - The pairing URL is kept strictly in React memory state and is never saved to extension storage.
4. **Localhost Isolation**:
   - The Control API is strictly bound to `127.0.0.1` and is never reachable from the LAN.

---

## Troubleshooting

### "Agent Offline" in Popup
1. Ensure the DevMirror CLI or core engine is running in your terminal:
   ```bash
   npx devmirror
   ```
2. If your Control API is running on a port other than `4100`, click the **Settings** gear icon in the extension popup and enter your custom port.

---

## License

MIT
