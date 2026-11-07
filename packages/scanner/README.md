# @devmirror/scanner

High-speed port discovery, process inspection, and framework fingerprinting for local development servers.

---

## Overview

`@devmirror/scanner` is responsible for autonomously discovering active web development servers on a workstation. It enables zero-configuration project detection for DevMirror by:
1. Scanning commonly used development ports concurrently.
2. Fingerprinting frameworks (Vite, Next.js, Angular, Astro, Create React App, Nuxt, and Generic HTTP) from response headers and HTML body signatures.
3. Identifying process IDs and executable names using safe, read-only OS utilities.
4. Providing a manual validation API to verify custom hosts and ports.

---

## Installation

```bash
pnpm add @devmirror/scanner
```

---

## Public API

### 1. `scanDevServers(options?: ScanOptions): Promise<DiscoveredDevServer[]>`

Scans the local host for active development servers across common ports.

```typescript
import { scanDevServers } from '@devmirror/scanner';

const servers = await scanDevServers({
  timeoutMs: 300,
  concurrency: 10
});

console.log(servers);
/*
[
  {
    host: '127.0.0.1',
    port: 5173,
    url: 'http://127.0.0.1:5173',
    framework: 'vite',
    frameworkName: 'Vite',
    processId: 14208,
    processName: 'node.exe',
    status: 'online',
    confidence: 'high',
    title: 'Vite + React App',
    isHttps: false
  }
]
*/
```

### 2. `validateServer(host: string, port: number, options?: ValidateOptions): Promise<DiscoveredDevServer | null>`

Validates a manually entered host and port. Returns a `DiscoveredDevServer` object if reachable, or `null` if the port is closed or non-responsive.

```typescript
import { validateServer } from '@devmirror/scanner';

const server = await validateServer('127.0.0.1', 8080);
if (server) {
  console.log(`Found server at ${server.url} (${server.frameworkName})`);
} else {
  console.log('No active server found on port 8080');
}
```

---

## Configuration Options

### `ScanOptions`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `host` | `string` | `'127.0.0.1'` | Host interface to probe (loopback or private LAN). |
| `ports` | `number[]` | `COMMON_DEV_PORTS` | Explicit array of ports to scan. |
| `portRange` | `{ start: number, end: number }` | `undefined` | Sequential port range to scan. |
| `timeoutMs` | `number` | `350` | Timeout per port probe in milliseconds. |
| `concurrency` | `number` | `10` | Maximum number of concurrent socket probes. |
| `includeProcessInfo` | `boolean` | `true` | Whether to query the OS process table for PID/processName. |

### `ValidateOptions`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `timeoutMs` | `number` | `1500` | HTTP probe timeout for manual validation. |
| `includeProcessInfo` | `boolean` | `true` | Whether to query process details. |

---

## Framework Fingerprinting

The scanner inspects the HTTP response headers and up to the first 64KB of the response body for unambiguous framework signatures:

| Framework | Fingerprint Markers | Confidence |
| :--- | :--- | :--- |
| **Vite** | `/@vite/client`, `server: vite`, `__vite_plugin_react_preamble_installed__` | High |
| **Next.js** | `X-Powered-By: Next.js`, `__NEXT_DATA__`, `/_next/static/`, `/_next/webpack-hmr` | High |
| **Nuxt** | `X-Powered-By: Nuxt`, `__NUXT__`, `/_nuxt/` | High |
| **Astro** | `<astro-island>`, `Astro.generator`, `class="astro-"` | High |
| **Angular** | `ng-version="`, `<app-root>`, `/ng-cli-ws` | High |
| **Create React App** | `<div id="root">` + `/static/js/bundle.js`, `react-scripts` | Medium |
| **Generic** | Valid HTML/HTTP server without specific framework signature | Low |

### Limitations
- Production builds or custom reverse proxies that strip headers or bundle scripts into single unnamed files may be identified as `generic` or `unknown`.
- DevMirror allows developers to manually select any port regardless of framework detection results.

---

## Windows Process Detection

On Windows (`process.platform === 'win32'`), `@devmirror/scanner` uses read-only system utilities:
1. `netstat.exe -ano -p tcp`: Discovers the PID listening on the specific TCP port.
2. `tasklist.exe /fi "PID eq <pid>"`: Retrieves the executable image name (e.g. `node.exe`, `bun.exe`).

### Security & Fault Tolerance
- Commands are executed read-only with a 1000ms timeout via `child_process.execFile` (bypassing the shell interpreter to prevent command injection).
- If system utilities fail or permissions are restricted, the scanner catches the error and returns `processId: undefined`, allowing server discovery to succeed without interruption.
