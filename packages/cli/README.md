# devmirror-cli

> Zero-config mobile browser preview with preserved framework HMR for local web development.

DevMirror connects to your running local development server (Vite, Next.js, Nuxt, Astro, Angular, CRA, etc.), generates a cryptographically paired QR code in your terminal, and lets you preview your web app on a physical mobile device over your local Wi-Fi network without requiring public cloud tunnels.

---

> [!NOTE]
> **npm Release Status**: The packages are prepared for public distribution under package name `devmirror-cli`. Once published to the public npm registry, `npx devmirror-cli` will be accessible globally. For local workspace development in this repository, run `pnpm run devmirror` or `node packages/cli/bin/devmirror.js`.

---

## Features

- **Automated Discovery**: Detects running development servers across common dev ports (3000, 5173, 4200, 4321, 8080, etc.) with framework fingerprinting.
- **Interactive Multi-Server Selection**: When multiple servers are active, prompts you to select the project to preview.
- **Terminal QR Code**: Renders an ASCII QR code directly in your terminal for instant camera scanning.
- **Auto-Trust Secure Pairing**: Cryptographically secure 256-bit session token exchanged once via QR code, then transitioned to HttpOnly SameSite session cookies.
- **Preserved Framework HMR**: Seamlessly forwards WebSocket traffic and HMR events for Vite, Next.js, and Angular.
- **Non-Invasive**: No project code changes, bundler plugins, or dependencies required in your local project.
- **Optional Chrome Extension**: Companion browser popup for one-click session inspection, QR code display, and server switching.

---

## Prerequisites

- **Node.js**: `>= 20.0.0` (LTS 20, 22, or 24 recommended).
- **Network**: Development machine and mobile phone connected to the **same local Wi-Fi network**.

---

## Installation & Quick Start

### Run with npx (Recommended)

```bash
npx devmirror-cli
```

### Install Globally

```bash
npm install -g devmirror-cli
# or
pnpm add -g devmirror-cli

# Run directly
devmirror
```

---

## CLI Options & Usage

```bash
USAGE:
  $ npx devmirror-cli [options]
  $ devmirror [options]

OPTIONS:
  -p, --port <port>                 Manually specify target development server port
  -H, --host <host>                 Target dev server host interface (default: 127.0.0.1)
  --overlay                         Enable companion mobile overlay banner (default: false)
  -k, --insecure                    Allow self-signed HTTPS certificates on dev server
  --proxy-port <port>               Preferred LAN reverse proxy port (default: 4000)
  --control-port <port>             Preferred Control API port (default: 4100)
  -h, --help                        Show help message
  -v, --version                     Show package version
```

### Common Examples

1. **Auto-Discovery Mode**:
   ```bash
   npx devmirror-cli
   ```
   Scans common ports, shows discovered framework and process name, and starts the preview.

2. **Explicit Port Target**:
   ```bash
   npx devmirror-cli --port 5173
   ```
   Directly previews the development server running on port `5173`.

3. **Explicit Host & Port**:
   ```bash
   npx devmirror-cli --port 3000 --host localhost
   ```

4. **Self-Signed HTTPS Target**:
   ```bash
   npx devmirror-cli --port 5173 --insecure
   ```
   Enables support for development servers running on HTTPS with self-signed local certificates.

---

## Keyboard Controls

While DevMirror is active in your terminal:

| Key | Action |
| :---: | :--- |
| `q` | Stop DevMirror, terminate sessions, release ports, and exit cleanly. |
| `r` | Check session status, assigned ports, and active connected mobile devices. |
| `h` | Display the keyboard shortcuts menu. |
| `Ctrl+C` | Graceful shutdown and immediate port cleanup. |

---

## Companion Chrome Extension (Optional)

DevMirror provides an optional Chrome Extension (Manifest V3) companion dashboard:
- Visual status dashboard in your Chrome toolbar.
- Real-time connected device counter.
- One-click QR code and pairing URL copy.
- Switch active dev servers without restarting the terminal.

To load the extension in developer mode:
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select `apps/extension/dist`.

---

## Cross-Platform Notes & Troubleshooting

### Same-Wi-Fi Connectivity
Ensure your mobile phone and development machine are connected to the same Wi-Fi subnet without client isolation. DevMirror automatically prioritizes physical Wi-Fi/Ethernet adapters over virtual bridges (Docker, WSL, Hyper-V).

### Firewall Guidance
- **Windows**: Windows Firewall may prompt to allow Node.js on Private Networks. Select **Allow access** for the proxy port (`4000`). Never expose the Control API (`4100`), which binds strictly to loopback (`127.0.0.1`).
  ```powershell
  New-NetFirewallRule -DisplayName "DevMirror LAN Proxy" -Direction Inbound -LocalPort 4000 -Protocol TCP -Action Allow -Profile Private
  ```
- **macOS / Linux**: Process inspection uses safe, parameterized `lsof` / `ss` with strict execution timeouts. Ensure your user has permissions to read local process port bindings.

### Port Conflicts
If port `4000` (LAN Proxy) or `4100` (Control API) is occupied, DevMirror will automatically probe and bind to the next available port (e.g. `4001`, `4101`).

---

## License

MIT
