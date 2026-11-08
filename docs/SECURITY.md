# DevMirror Threat Model & Security Specification

**Document Version:** 1.0.0 (Production Release)  
**Status:** Approved Security Architecture & Implementation Review  
**Monorepo Path:** `D:\code\DevMirror`  

---

## 1. Threat Landscape & Security Mandate

Local development servers (such as Vite, Next.js, and Webpack Dev Server) are designed for rapid feedback, not production-grade network isolation. By default, dev servers:
- Run without authentication.
- Read and expose local source code, environment variables, source maps, and API secrets.
- Often contain debug or evaluation endpoints (e.g., Fast Refresh, error overlay RPCs) that could allow arbitrary code execution if exposed to an attacker.

When a developer runs `devmirror` to share their local project over a Local Area Network (Wi-Fi), their project could become reachable by other devices on the same subnet (e.g., shared office networks, public coffee shop Wi-Fi).

**DevMirror Security Mandate:** Under no circumstances should running DevMirror degrade the workstation's security posture, leak developer secrets, or expose local development servers to unauthenticated network peers or malicious local browser scripts.

---

## 2. Implemented STRIDE Threat Matrix

| Threat Category | Specific Attack Vector | DevMirror Defense & Implementation |
| :--- | :--- | :--- |
| **S - Spoofing Identity** | Rogue LAN device guessing session URL or impersonating mobile device. | 256-bit CSPRNG token (`crypto.randomBytes(32).toString('base64url')`). Compared exclusively with `crypto.timingSafeEqual`. |
| **T - Tampering with Data** | Packet sniffing or manipulation on unencrypted Wi-Fi traffic. | Query token is immediately exchanged for an `HttpOnly`, `SameSite=Lax` cookie and stripped from URL address bar. Supports upstream HTTPS with `--insecure` opt-in. |
| **R - Repudiation** | Unaudited client accessing project. | Real-time device registry tracking IP, user-agent, and pairing timestamp visible in CLI and Chrome Extension. |
| **I - Information Disclosure** | Attacker on LAN scanning ports to access `.env`, source code, or internal dev APIs. | Strict auth gate on proxy before any dispatch. Upstream cookie sanitization strips internal token from dev server. |
| **D - Denial of Service** | Connection flooding exhausting proxy file descriptors or memory. | Execution timeouts on all probers and inspectors; active socket registry destroys lingering sockets on shutdown. |
| **E - Elevation of Privilege** | Local website using JavaScript `fetch` to take over DevMirror Control API. | Strict Origin checking; preflights for mutating requests from web origins blocked with `403 Forbidden`; extension and CLI headers required. |

---

## 3. Detailed Security Architecture & Countermeasures

### 3.1 Dual-Interface Separation

DevMirror strictly segregates external LAN traffic from local control mechanisms:

```
+-----------------------------------------------------------------------------------+
|                         NETWORK INTERFACE SEGREGATION                             |
+-----------------------------------------------------------------------------------+

     [ External LAN Interface ]                    [ Local Loopback Interface ]
        (e.g. 192.168.1.45)                                (127.0.0.1)
                 |                                              |
                 v                                              v
   +------------------------------+               +------------------------------+
   |   LAN Reverse Proxy Server   |               |   Local Fastify Control API  |
   |   Default: 0.0.0.0:4000      |               |   Default: 127.0.0.1:4100    |
   +------------------------------+               +------------------------------+
   | - Ephemeral token auth gate  |               | - Strictly bound to loopback |
   | - Upstream cookie stripping  |               | - Web origins forbidden      |
   | - HTML & HMR path rewriting  |               | - Extension & CLI IPC only   |
   | - Compression handling       |               | - Preflight mutating block   |
   +------------------------------+               +------------------------------+
```

1. **Local Control API (`127.0.0.1:4100`):**
   - Strictly bound to loopback `127.0.0.1`. Never listens on `0.0.0.0`.
   - Incoming TCP connections from external LAN interfaces are dropped at the TCP listener level.
2. **Mobile LAN Proxy (`0.0.0.0:4000`):**
   - Listens on LAN interface to accept mobile connections.
   - Enforces cryptographic authentication on 100% of incoming HTTP and WebSocket requests before any upstream proxying occurs.

---

### 3.2 Ephemeral Token Authentication & Address Bar Scrubbing

Authentication uses Node.js `node:crypto`:

```typescript
const token = crypto.randomBytes(32).toString('base64url'); // 256 bits of entropy
```

- **Timing-Safe Comparison:** All token comparisons use `crypto.timingSafeEqual` over fixed-length buffers to eliminate side-channel timing attacks.
- **Address Bar Sanitization (Token Scrubbing):**
  1. Mobile camera scans QR code containing `http://192.168.1.45:4000/?dm_token=<token>`.
  2. LAN proxy validates the token.
  3. Proxy sets an `HttpOnly`, `SameSite=Lax` session cookie (`__devmirror_session=<token>`).
  4. Proxy immediately responds with an HTTP 302 redirect to `/` (without query parameters).
  5. The secret token is removed from the mobile browser's address bar and browser history, preventing accidental leakage via copy-pasting, screenshots, or HTTP `Referer` headers.

---

### 3.3 Upstream Cookie Isolation

DevMirror isolates its internal session token from the developer's application:
- When forwarding HTTP requests upstream, `LanProxyServer.stripSessionCookie()` removes `__devmirror_session` from the `Cookie` header.
- If `__devmirror_session` was the only cookie, the `Cookie` header is removed entirely.
- All developer application cookies (e.g. `authToken`, `session_id`, `theme`) are preserved untouched.
- When forwarding WebSocket upgrades, the upgrade request headers undergo identical cookie sanitization.
- Result: **The DevMirror pairing token never reaches the upstream dev server, server-side logs, or upstream third-party analytics.**

---

### 3.4 Control API Hardening against Cross-Origin Attacks

A common attack vector against local developer tools is **Drive-By Cross-Origin Request Forgery**: a malicious web page running in the developer's browser makes AJAX or fetch requests to `http://localhost:4100` to manipulate local tools.

DevMirror neutralizes this attack vector using multi-layered defenses in `packages/core/src/control/api.ts`:

1. **CORS Preflight Blocking:**
   - In Fastify's wildcard `OPTIONS` handler, any preflight request requesting a mutating HTTP method (`POST`, `DELETE`, `PUT`, `PATCH`) from a web origin (`http://localhost:*` or `http://127.0.0.1:*`) is immediately terminated with **`403 Forbidden`**.
2. **Strict Origin Separation on Mutating Requests:**
   - Browser requests (`Origin` header present and not `null`) are only permitted if they originate from the verified Chrome Extension (`chrome-extension://kmcaoghdokfdbadplofpkeabloldmoga`).
   - Trusted extension requests must also present the `x-devmirror-csrf: 1` header.
   - Non-browser CLI requests (no `Origin` header) must present `x-devmirror-cli: 1` or an authorization token. A generic CSRF header alone is rejected.
3. **Sensitive Endpoint Protection:**
   - `GET /api/v1/session/pairing-url`: Returns the pairing URL only to the verified extension or authenticated CLI. Web origins are rejected with `403 Forbidden`.
   - `GET /api/v1/discover`: Port scanning results are restricted to the verified extension or authenticated CLI. Web origins are rejected with `403 Forbidden`.
   - `GET /api/v1/devices`: Connected device details are restricted to the verified extension or authenticated CLI. Web origins are rejected with `403 Forbidden`.

---

### 3.5 SSRF & Cloud Metadata Protections

The dev server scanner (`@devmirror/scanner`) probes ports on the local machine. To prevent Server-Side Request Forgery (SSRF) and DNS rebinding attacks:
- Destination hosts are strictly validated using `isAllowedHost()`.
- Loopback addresses (`127.0.0.1`, `::1`, `localhost`) and private RFC 1918 IPv4 addresses (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) are permitted.
- Cloud metadata endpoints (e.g. `169.254.169.254`, AWS, GCP, Azure, OpenStack instance metadata) are strictly blocked across all IPv4 and IPv6 notations.
- Public internet IP addresses and external domain names are rejected.
- Redirects during HTTP probing are capped (maximum 3 redirects) and each redirect destination is re-validated before opening a connection.

---

### 3.6 Safe System & Process Execution

When inspecting listening processes on Windows (`netstat`, `tasklist`) and POSIX (`lsof`, `ss`, `ps`):
- All invocations strictly use `execFile` with typed argument arrays.
- Shell interpolation is prohibited (`shell: false`).
- Port arguments are validated as integer values between 1 and 65535.
- PID arguments are validated as positive integer values between 1 and 4,194,304.
- All commands enforce strict execution timeouts (default: 1000ms) to prevent hanging or blocking the CLI.

---

### 3.7 Zero Telemetry & Privacy Guarantee

DevMirror is 100% self-contained:
- Zero telemetry, usage beacons, or analytics collection.
- Zero external cloud relays or tunnel servers.
- All network communication occurs exclusively over the local machine's loopback and local Wi-Fi interfaces.
- Session tokens are ephemeral, stored exclusively in volatile memory, and wiped upon process exit.
