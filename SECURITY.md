# Security

Report security issues through GitHub issues if they do not contain secrets. Do not paste Garmin passwords, Garmin Connect tokens, raw GPS exports or private activity payloads into public issues.

## Sensitive data

Treat these as secrets:

- Garmin password and MFA codes
- `di_token`, `di_refresh_token`, `jwt_web` and CSRF token values
- raw Garmin Connect payloads with profile, location or GPS data
- local SQLite cache if enabled

## Local storage

By default tokens are stored at `~/.garmin-mcp/garmin_tokens.json` with `0600` permissions. The MCP never returns token values from tools.

## Supported posture

- Read-only tools only.
- Local-first token storage.
- `summary` and `structured` privacy modes for normal agent use.
- `raw` mode only by explicit opt-in.
- No medical diagnosis or treatment claims.

Run:

```bash
npx -y garmin-mcp-unofficial doctor
npx -y garmin-mcp-unofficial doctor --client hermes
```

## Input and dependency hardening

The server supports a single trusted local OS user. HTTP remains loopback-only by default and has no per-client authorization layer; do not expose it to untrusted networks.

- Both stdio and HTTP tool calls accept at most 10,000 combined object members and array elements in arguments. Larger inputs fail before tool input-schema validation or tool execution. This is not a global process-memory limit.
- HTTP JSON bodies remain limited to 1 MiB. Compressed request bodies are explicitly unsupported and return HTTP 415; send uncompressed JSON.
- Dependency security updates do not enable caching or change provider authentication. Run `npm run test:input-limits` after a build to verify ordinary requests, the element boundary, oversized arguments, malformed JSON, body size and compressed-body rejection using synthetic data only.

SDK option reference: https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/mcp.ts#L100-L109 . `maxToolInputElements` is opt-in upstream; this server explicitly sets it to 10,000.
