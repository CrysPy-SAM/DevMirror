# @devmirror/cli

> Zero-config mobile browser preview with preserved framework HMR for local web development.

DevMirror connects to your running local development server (Vite, Next.js, Nuxt, Astro, Angular, CRA, etc.), generates a cryptographically paired QR code in your terminal, and lets you preview your web app on a physical mobile device over your local Wi-Fi network without requiring public cloud tunnels.

---

## Features

- **Automated Discovery**: Detects running development servers across common dev ports (3000, 5173, 4200, 4321, 8080, etc.) with framework fingerprinting.
- **Interactive Multi-Server Selection**: When multiple servers are active, prompts you to select the project to preview.
- **Terminal QR Code**: Renders an ASCII QR code directly in your terminal for instant camera scanning.
- **Auto-Trust Secure Pairing**: Cryptographically secure 256-bit session token exchanged once via QR code, then transitioned to HttpOnly SameSite session cookies.
- **Preserved Framework HMR**: Seamlessly forwards WebSocket traffic and HMR events for Vite, Next.js, and Angular.
- **Non-Invasive**: No project code changes, bundler plugins, or dependencies required in your local project.

---

## Installation & Quick Start

### Run with npx (Recommended)

```bash
npx devmirror
```

### Install Globally

```bash
npm install -g @devmirror/cli
# or
pnpm add -g @devmirror/cli

# Run directly
devmirror
```

---

## CLI Options & Usage

```bash
USAGE:
  $ npx devmirror [options]

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
   devmirror
   ```
   Scans common ports, shows discovered framework and process name, and starts the preview.

2. **Explicit Port Target**:
   ```bash
   devmirror --port 5173
   ```
   Directly previews the development server running on port `5173`.

3. **Explicit Host & Port**:
   ```bash
   devmirror --port 3000 --host localhost
   ```

4. **Self-Signed HTTPS Target**:
   ```bash
   devmirror --port 5173 --insecure
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

## Security Architecture

1. **Token Security**:
   - Pairing tokens are 256-bit cryptographically secure random values generated with Node native `crypto.randomBytes()`.
   - On the first mobile scan, the token is exchanged and automatically stripped from the URL via a `302 Found` redirect.
   - Subsequent communication relies on an authenticated `HttpOnly; SameSite=Lax` cookie (`dm_session`).
   - Tokens never appear in application logs or upstream dev server requests.
2. **SSRF and Metadata Protection**:
   - The scanner and proxy strictly reject cloud metadata endpoints (`169.254.169.254`, `fd00:ec2::254`), public IP addresses (`8.8.8.8`), and unauthorized domain names.
   - Built-in `safeLookup` prevents DNS rebinding attacks on loopback and LAN hostnames.
3. **Strict Origin & Host Validation**:
   - The Control API is strictly bound to `127.0.0.1`.
   - LAN proxy validates `Host` headers and rejects cross-site request forgery attempts.

---

## Windows Setup & Troubleshooting

### Same-Wi-Fi Connectivity
Ensure your physical mobile device and development PC are connected to the same Wi-Fi network. DevMirror automatically detects your machine's local IPv4 address (e.g. `192.168.1.50` or `10.x.x.x`).

### Windows Firewall
If your mobile phone cannot load the page:
1. Windows Firewall may prompt to allow Node.js on Private Networks. Select **Allow access**.
2. If blocked, open Windows PowerShell (Run as Administrator) and allow inbound TCP for the proxy port:
   ```powershell
   New-NetFirewallRule -DisplayName "DevMirror LAN Proxy" -Direction Inbound -LocalPort 4000 -Protocol TCP -Action Allow
   ```

### Port Conflicts
If port `4000` (LAN Proxy) or `4100` (Control API) is occupied, DevMirror will automatically probe and bind to the next available port (e.g. `4001`, `4101`). The exact assigned ports are displayed in the startup dashboard.

---

## License

MIT
