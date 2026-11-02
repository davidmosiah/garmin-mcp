# Migration to 0.8.0

This pre-1.0 minor release tightens security-related behavior. Review existing configuration before upgrading from 0.7.6.

- Run Node.js 20 or newer. The release candidate configures CI for Node.js 20, 22 and 24; each matrix job must pass before release.
- HTTP transport is local-only: use loopback addresses or `localhost`; wildcard/non-loopback binds are rejected. Prefer stdio for local MCP clients. This is not a remotely authenticated HTTP deployment.
- Authenticated responses no longer use HTTP/SQLite response caching. `GARMIN_CACHE` is deprecated and has no effect. Stop the connector and remove old `~/.garmin-mcp/cache.sqlite` files if you need to erase previously cached data; upgrading does not erase them automatically.
- Profile inputs and persisted content are validated. Invalid or oversized legacy profile data may now be rejected. Keep profile JSON within 256 KiB; shorten oversized text rather than bypassing validation.
- Profile persistence rejects symlink targets and uses a cooperative writer lock. These checks do not guarantee safety against a hostile process racing filesystem changes; keep the profile directory private and controlled by the same trusted user.
- Tool arguments are bounded to 10,000 elements; endpoint-specific collection and page caps still apply. HTTP JSON bodies remain limited to 1 MiB and compressed request bodies are rejected. Split oversized requests; send uncompressed JSON.
- Restart clients after installing the new package and verify their configured executable/version. Package metadata and fixture tests do not guarantee automatic rollout to every client. No live account authorization is required for local fixture tests.
