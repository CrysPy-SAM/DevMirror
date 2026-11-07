# DevMirror: Threat Model & Security Specification

**Document Status:** Approved Architecture Plan  
**Target Version:** v0.1.0 – v1.0.0  
**Author:** DevMirror Architecture & Security Engineering Team  

---

## 1. Security Context & Threat Landscape

Local development servers (such as Vite, Next.js, and Webpack) are intentionally engineered for fast feedback and developer convenience, not production-grade network isolation. By default, dev servers:
- Run without authentication.
- Read and expose local source code, environment variables, source maps, and API secrets.
- Often contain debug or evaluation endpoints (e.g., Fast Refresh, error overlay RPCs) that could allow arbitrary code execution if exposed to an attacker.

When a developer runs `devmirror` to share their local project over a Local Area Network (Wi-Fi), their project could become reachable by other devices on the same subnet (e.g., shared office networks, public coffee shop Wi-Fi).

**DevMirror's security mandate:** Under no circumstances should running DevMirror degrade the workstation's security posture or expose local development servers to unauthenticated network peers.

---

## 2. STRIDE Threat Model

```
+--------------------------------------------------------------------------------------------------+
|                                    STRIDE THREAT MATRIX                                          |
+--------------------------------------------------------------------------------------------------+
| Threat Category             | Specific Vector                          | DevMirror Countermeasure|
+-----------------------------+------------------------------------------+-------------------------+
| S - Spoofing Identity       | Rogue device on LAN guessing session URL | 256-bit CSPRNG token +  |
|                             | or impersonating the mobile client.      | Device Pairing Guard.   |
+-----------------------------+------------------------------------------+-------------------------+
| T - Tampering with Data     | Man-in-the-middle packet injection on    | URL token strip + cookie|
|                             | unencrypted HTTP Wi-Fi traffic.          | + optional local TLS.   |
+-----------------------------+------------------------------------------+-------------------------+
| R - Repudiation             | Unaudited client accessing project.      | Client registry + active|
|                             |                                          | device log in CLI & Ext.|
+-----------------------------+------------------------------------------+-------------------------+
| I - Information Disclosure  | Attacker scanning LAN accessing `.env`,   | Strict auth gate before |
|                             | source maps, or internal API proxies.    | any proxy dispatch.     |
+-----------------------------+------------------------------------------+-------------------------+
| D - Denial of Service       | Flood of connections exhausting file     | Rate limiting + max     |
|                             | descriptors or proxy memory.             | client connection limit.|
+-----------------------------+------------------------------------------+-------------------------+
| E - Elevation of Privilege  | SSRF or Path Traversal escaping the      | Strict loopback target  |
|                             | target port to internal LAN services.    | validation whitelist.   |
+-----------------------------+------------------------------------------+-------------------------+
```

---

## 3. Detailed Security Architecture & Mitigations

### 3.1 Network Interface & Binding Segregation

DevMirror implements a dual-port architecture with strict network interface segregation:

```
+-----------------------------------------------------------------------------------+
|                         NETWORK INTERFACE SEGREGATION                             |
+-----------------------------------------------------------------------------------+

     [ External LAN Interface ]                    [ Local Loopback Interface ]
         (e.g., 192.168.1.45)                                (127.0.0.1)
                  |                                               |
                  v                                               v
   +------------------------------+                +------------------------------+
   |   DevMirror Mobile Proxy     |                |  DevMirror Control REST/WS   |
   |   (Port 4000)                |                |  (Port 4100)                 |
   +------------------------------+                +------------------------------+
   | - STRICT TOKEN AUTH REQUIRED |                | - BOUND STRICTLY TO LOOPBACK |
   | - Only forwards to target    |                | - Extension & CLI IPC only   |
   | - Rate limited               |                | - Reject any non-127.0.0.1   |
   +------------------------------+                +------------------------------+
```

1. **Loopback Control API (`127.0.0.1:4100`):**
   - Strictly refuses connections arriving from external IP interfaces.
   - Any attempt to reach `4100` from a remote LAN IP is dropped at the TCP listener level.
2. **Mobile Proxy (`0.0.0.0:4000` or LAN IP):**
   - Requires valid authentication token on every HTTP request and WebSocket connection.
   - Any unauthenticated request immediately receives `401 Unauthorized` with an access-denied landing page (no project assets or headers leaked).

---

### 3.2 Ephemeral Cryptographic Token Authentication

Authentication is built on cryptographic primitives using Node.js `node:crypto`:

```typescript
// Token generation using cryptographically secure random bytes
const token = crypto.randomBytes(32).toString('base64url'); // 256 bits of entropy
```

- **Entropy:** 256 bits of true cryptographic entropy makes brute-forcing computationally infeasible. An attacker attempting 1,000,000 requests/sec would take $1.8 \times 10^{64}$ years to guess the token.
- **Timing-Safe Comparison:** When comparing session tokens or cookies, DevMirror strictly uses `crypto.timingSafeEqual` to prevent side-channel timing attacks:
  ```typescript
  function verifyToken(incoming: string, expected: string): boolean {
    const a = Buffer.from(incoming);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  ```
- **URL Parameter Strip & Cookie Promotion:**
  - The QR code contains `http://<LAN_IP>:4000/?dm_token=<TOKEN>`.
  - Upon initial access, the proxy sets an `HttpOnly`, `SameSite=Lax` session cookie (`dm_session=<TOKEN>`).
  - The proxy immediately responds with an HTTP `302 Found` redirecting to `/` (stripping `?dm_token=...` from the browser address bar).
  - This prevents token leakage via:
    - Browser history inspection.
    - Shoulder surfing.
    - HTTP `Referer` headers on outgoing external links.

---

### 3.3 Interactive Pairing Guard (Zero-Trust Mode)

To provide defense-in-depth against shoulder-surfing or QR code interception:

1. When a mobile device scans the QR code for the first time, DevMirror places the connection into a `PENDING_APPROVAL` state.
2. The CLI terminal and Chrome Extension popup display an interactive pairing prompt:
   ```
   [DevMirror Security Guard]
   New mobile device requesting connection:
     Device: iPhone 15 Pro (Safari / iOS 17.4)
     IP:     192.168.1.88
   Allow access? [Y/n]
   ```
3. Until the developer confirms (or enables "Auto-Approve Local Subnet" in CLI flags: `--trust-local`), no proxy traffic or source code is dispatched.
4. Once approved, the device's unique fingerprint (Client ID + User Agent + Subnet) is recorded in the active session.

---

### 3.4 Server-Side Request Forgery (SSRF) & Target Validation

To prevent DevMirror from being abused to scan or attack other internal network services or cloud metadata endpoints:

1. **Target Whitelisting:** DevMirror's proxy will **only** forward traffic to `127.0.0.1` and `localhost`.
2. **Blocked Targets:** Forwarding requests to internal private IPs (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local addresses (`169.254.169.254` AWS/GCP metadata), or external domain names is strictly rejected by the proxy router.
3. **Port Sanitization:** Target ports must be positive integers between `1024` and `65535`. System privileged ports (`< 1024`) are blocked.

---

### 3.5 Header Sanitization & Information Leakage Prevention

When proxying requests between the mobile browser and the local dev server:

1. **Developer Cookie Isolation:** Cookies originating from the mobile browser are scoped strictly to the proxy host. Developer session cookies from other localhost services are not forwarded.
2. **Proxy Header Stripping:** Inbound headers such as `X-Forwarded-Server` or internal routing headers are sanitized to avoid confusing framework middleware.
3. **Error Redaction:** If the upstream dev server crashes or is stopped while DevMirror is running, DevMirror returns a clean, sanitized error page (`502 Bad Gateway: Upstream Target Disconnected`) rather than dumping Node.js stack traces or file system paths.

---

### 3.6 Chrome Extension Manifest V3 Security

The DevMirror Chrome Extension adheres to the Principle of Least Privilege:

- **Manifest V3 Compliant:** No remote code execution or `unsafe-eval` allowed. All scripts are bundled at build time.
- **Minimal Permissions:**
  ```json
  {
    "manifest_version": 3,
    "name": "DevMirror Companion",
    "permissions": [
      "activeTab",
      "storage"
    ],
    "host_permissions": [
      "http://localhost/*",
      "http://127.0.0.1/*"
    ]
  }
  ```
- **Permission Justification:**
  - `activeTab`: Used exclusively to detect whether the user is viewing `localhost:<port>` in their active browser tab.
  - `host_permissions`: Strictly restricted to loopback addresses (`localhost` and `127.0.0.1`). The extension cannot interact with or read any external website or user browsing history.

---

### 3.7 DoS & Resource Exhaustion Protection

- **Rate Limiting:** Fastify proxy incorporates a sliding-window rate limiter (default: 300 requests/second per IP) to prevent rogue scripts or scanning tools on the LAN from saturating CPU or network bandwidth.
- **WebSocket Connection Cap:** At most 10 concurrent WebSocket connections are allowed per active session.
- **Request Size Limiting:** HTTP request body size is capped at 50MB (accommodating file uploads during testing) to avoid heap memory exhaustion.
