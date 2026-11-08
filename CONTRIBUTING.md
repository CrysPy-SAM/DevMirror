# Contributing to DevMirror

Thank you for your interest in contributing to **DevMirror**! DevMirror is an open-source developer tool engineered to give web developers instant, zero-configuration mobile previews of local web applications with preserved Hot Module Replacement (HMR) and strict LAN security isolation.

---

## 1. Monorepo Structure

DevMirror is organized as a `pnpm` workspace monorepo:

| Package | Path | Responsibility |
| :--- | :--- | :--- |
| **`@devmirror/shared`** | `packages/shared` | Shared TypeScript contracts, protocol constants, IPC schemas, and security utilities. |
| **`@devmirror/core`** | `packages/core` | LAN reverse proxy, Fastify Control API, HMR WebSocket adapters, HTML streaming rewriter, session manager, and network interface resolver. |
| **`@devmirror/scanner`** | `packages/scanner` | Port scanner, OS process inspector (Windows `netstat`/`tasklist`, POSIX `lsof`/`ss`/`ps`), and HTTP framework detector. |
| **`@devmirror/cli`** | `packages/cli` | Terminal interface, ANSI QR code generator, interactive keyboard shortcuts, and engine runner. |
| **`@devmirror/extension`** | `apps/extension` | Manifest V3 Chrome Extension providing a browser popup dashboard for pairing and session control. |

---

## 2. Prerequisites

- **Node.js:** `>= 20.0.0` (tested on Node 20 and Node 22)
- **Package Manager:** `pnpm >= 9.0.0` (configured with `pnpm@10.15.0`)
- **Supported Operating Systems:** Windows (10/11), macOS (12+), Linux (Ubuntu, Debian, Fedora, Arch)

---

## 3. Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/CrysPy-SAM/DevMirror.git
   cd DevMirror
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Build all packages:**
   ```bash
   pnpm run build
   ```

4. **Run typechecks:**
   ```bash
   pnpm run typecheck
   ```

5. **Run the test suite:**
   ```bash
   pnpm test
   ```

---

## 4. Running DevMirror Locally

### Running the CLI in Development Mode
You can invoke the CLI binary directly against a local project:

```bash
# Build packages first
pnpm run build

# Run CLI against an auto-discovered dev server
node packages/cli/bin/devmirror.js

# Or specify a target port directly
node packages/cli/bin/devmirror.js --port 5173
```

### Loading the Chrome Extension in Developer Mode
1. Build the extension:
   ```bash
   pnpm --filter @devmirror/extension run build
   ```
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `apps/extension` directory (or `apps/extension/dist`).
5. The extension will register with its deterministic development ID (`kmcaoghdokfdbadplofpkeabloldmoga`), allowing it to securely communicate with the local Control API at `127.0.0.1:4100`.

---

## 5. Coding & Security Standards

All contributions must adhere to DevMirror's security and architecture standards:

1. **Strict TypeScript:**
   - No implicit `any`. All APIs, requests, and options must be fully typed.
   - Run `pnpm run typecheck` before submitting pull requests.

2. **Zero Insecure Origin Assumptions:**
   - Web origins (`http://localhost:*` or `http://127.0.0.1:*`) are considered **untrusted** for mutating Control API operations.
   - Never remove or relax Origin, CSRF, or CLI header checks in `packages/core/src/control/api.ts`.
   - Never disable SSL/TLS certificate verification by default.

3. **Safe Process & System Execution:**
   - When executing OS binaries (`lsof`, `ss`, `ps`, `netstat`, `tasklist`), always use `execFile` with typed argument arrays.
   - Never use string interpolation or shell wrappers (`shell: true` is strictly prohibited).
   - Enforce execution timeouts on every external process call.

4. **Upstream Sanitization:**
   - Internal DevMirror session cookies (`__devmirror_session`) and tokens (`dm_token`) must be stripped before forwarding HTTP or WebSocket requests upstream to the developer's server.

5. **Test Coverage:**
   - New features or bug fixes must include corresponding Vitest tests covering positive cases, negative cases, and error boundaries.

---

## 6. Pull Request Guidelines

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Verify that all tests and typechecks pass:
   ```bash
   pnpm run typecheck
   pnpm test
   ```
3. Commit your changes with clear, descriptive commit messages.
4. Push to your fork and submit a Pull Request to `main`.

---

## 7. Security Vulnerability Reporting

If you discover a security vulnerability in DevMirror, **do not open a public GitHub issue**. Please report it privately to the maintainers or via GitHub Security Advisories so that a security patch can be coordinated and released responsibly.
