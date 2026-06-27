# Auth

Garmin MCP uses unofficial Garmin Connect personal token mode.

```bash
npx -y garmin-mcp-unofficial auth
```

`auth` runs a **self-contained Node login** — no Python helper required. It prompts locally for your Garmin email, password and MFA code (when Garmin asks), exchanges them for Garmin Connect tokens, and writes them to `~/.garmin-mcp/garmin_tokens.json` with user-only (0600) permissions.

The MCP does not store Garmin passwords and does not return token values from any tool.

## Rate limits, Cloudflare and unknown login responses

Garmin's private mobile SSO endpoint can rate-limit or Cloudflare-challenge
headless login attempts. Older versions could collapse that into:

```text
Garmin login failed: Garmin login failed: UNKNOWN
```

Current versions detect the common failure modes and call out HTTP 429,
non-JSON Cloudflare-like responses, or JSON payloads that omit
`responseStatus.type`.

If you see one of those messages:

1. Stop retrying immediately. Repeated `auth` attempts can turn a soft
   challenge into a longer per-account or per-network throttle.
2. Wait before retrying, then try from a normal residential/browser-like
   network rather than a datacenter, VPN or CI runner.
3. Confirm Garmin web/app login works in a browser.
4. If the built-in Node login keeps getting blocked, try the legacy Python
   helper: `garmin-mcp-server auth --use-python` or
   `garmin-mcp-server auth --install-helper`.
5. If you use any trusted local token-minting workflow, place the resulting
   Garmin token file at `~/.garmin-mcp/garmin_tokens.json` with `0600`
   permissions. Never paste tokens, cookies, passwords or raw browser session
   values into chat or GitHub issues.

For public bug reports, paste only sanitized command output. Do not include
Garmin credentials, cookies, `cf_clearance`, token files or raw private health
payloads.

## Non-interactive / CI

```bash
GARMIN_EMAIL=you@example.com GARMIN_PASSWORD='…' npx -y garmin-mcp-unofficial auth --json
```

If Garmin requires MFA, also set `GARMIN_MFA_CODE`. The `--json` mode never prompts; it fails cleanly when credentials are missing.

## Legacy Python helper (optional)

The previous Python-based flow is still available if you prefer it:

```bash
npx -y garmin-mcp-unofficial auth --use-python        # requires the garminconnect package
npx -y garmin-mcp-unofficial auth --install-helper     # installs garminconnect, with a venv fallback
```

`auth --install-helper` first tries the active Python environment. If that environment cannot install packages because of Homebrew/PEP 668 restrictions, it creates an isolated helper environment at `~/.garmin-mcp/venv` and installs `garminconnect` there.

## Setup vs. auth

`setup` and `auth` are separate by default so you can see exactly when credentials are requested. Use `setup --auth` only when you intentionally want setup to continue directly into Garmin login.
