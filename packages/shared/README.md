# @devmirror/shared

Shared TypeScript types, protocol contracts, IPC schemas, and security constants for DevMirror.

## Overview
This package contains zero-runtime-dependency type definitions and cryptographic utilities shared across the DevMirror engine, scanner, CLI, and Chrome Extension.

## Exports
- **Protocol Constants:** Default ports, header keys (`x-devmirror-cli`, `x-devmirror-csrf`, `x-devmirror-token`), cookie keys.
- **Session Types:** Ephemeral token contracts, target definitions, and sanitized session info.
- **IPC Schemas:** Control API endpoints and request/response shapes.
- **Security Utilities:** Token redaction and logging URL sanitizers.

## License
MIT
