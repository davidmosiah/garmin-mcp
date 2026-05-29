# Auth quickstart — self-contained Node login (no Python)

As of `garmin-mcp-unofficial` 0.5.0, `auth` runs a **pure-Node** Garmin Connect
login: SSO sign-in, MFA, and the OAuth1 → OAuth2 ticket exchange are implemented
in the package itself. **No Python and no `garminconnect` package are required.**

Your Garmin **password is never stored** — only short-lived Garmin Connect
tokens are written to `~/.garmin-mcp/garmin_tokens.json` with `0600`
(user-only) permissions.

This page shows the real command output for the whole first-call journey. Every
block below is captured from the actual CLI (the login here ran against a mocked
Garmin endpoint so no real account was used; the success/doctor output is the
genuine code path).

## The three-command path

```bash
npx -y garmin-mcp-unofficial setup    # writes local MCP config (no password)
npx -y garmin-mcp-unofficial auth     # built-in Node login, prompts locally
npx -y garmin-mcp-unofficial doctor   # confirms you're ready
```

## What `--help` shows

```text
$ garmin-mcp-server --help
Garmin MCP Server

Usage:
  garmin-mcp-server                 Start MCP stdio server
  garmin-mcp-server --http          Start local HTTP MCP server
  garmin-mcp-server setup           Guided setup, local config, and MCP client config
  garmin-mcp-server setup --auth    Setup, then immediately start local Garmin auth
  garmin-mcp-server doctor          Check setup and next steps
  garmin-mcp-server doctor --json   Print setup status as JSON
  garmin-mcp-server doctor --client hermes
  garmin-mcp-server auth            Log in to Garmin locally (no Python needed) and save ~/.garmin-mcp/garmin_tokens.json
  garmin-mcp-server auth --json     Non-interactive login using GARMIN_EMAIL / GARMIN_PASSWORD (+ GARMIN_MFA_CODE)
  garmin-mcp-server auth --use-python
                                  Use the legacy Python garminconnect helper instead of the built-in login
  garmin-mcp-server auth --install-helper
                                  Alias of --use-python: install the Python garminconnect helper if missing
  garmin-mcp-server onboarding      Print the shared Delx wellness onboarding flow (11 questions)
  garmin-mcp-server onboarding --pt-BR
                                  Print the onboarding flow in pt-BR

Optional env/config:
  GARMIN_TOKEN_PATH=~/.garmin-mcp/garmin_tokens.json
  GARMIN_PRIVACY_MODE=summary|structured|raw
  GARMIN_CACHE=sqlite
```

## Interactive login

`auth` with no flags prompts in your terminal. The password input is masked, and
MFA is requested only when your account requires it:

```text
$ garmin-mcp-server auth
Garmin email: you@example.com
Garmin password: ************
Garmin MFA code: 123456        # only asked if your account has MFA enabled

✓ Garmin connected

  Token file:   /home/you/.garmin-mcp/garmin_tokens.json
  Permissions:  600

→ Next: Run `garmin-mcp-server doctor`, then start your MCP client.
```

## Non-interactive login (CI / agents): `auth --json`

For automation, pass credentials via environment variables. Output is a single
JSON object you can parse:

```bash
GARMIN_EMAIL=you@example.com \
GARMIN_PASSWORD=app-password \
GARMIN_MFA_CODE=123456 \
  garmin-mcp-server auth --json
```

```json
{
  "ok": true,
  "token_path": "/home/you/.garmin-mcp/garmin_tokens.json",
  "permissions": "600",
  "has_di_token": true,
  "has_refresh_token": true,
  "next_step": "Run `garmin-mcp-server doctor`, then start your MCP client."
}
```

If credentials are missing, `auth --json` exits `1` with a clear, actionable
error (real output):

```text
$ garmin-mcp-server auth --json
{
  "ok": false,
  "error": "Set GARMIN_EMAIL and GARMIN_PASSWORD (and GARMIN_MFA_CODE if prompted) to run `auth --json`, or run `garmin-mcp-server auth` interactively."
}
```

## Confirm readiness with `doctor`

After a successful `auth`, `doctor` reports `READY` and verifies token
permissions are locked down (real output):

```text
$ garmin-mcp-server doctor
Garmin MCP · Doctor
Status: READY ✓

Checks
  ✓  Node.js >=20
  ·  Local config
  ✓  Token file
  ✓  Token permissions
  ✓  DI token
  ✓  DI refresh token
  ·  Privacy mode
  ·  Cache

Next steps
  1. Ready. Add this MCP server to your agent and start with garmin_daily_summary.
```

`doctor --json` for programmatic checks:

```json
{
  "ok": true,
  "node": { "version": "22.22.2", "supported": true },
  "automatic_auth_supported": true,
  "privacy_mode": "structured",
  "token": {
    "exists": true,
    "readable": true,
    "secure_permissions": true,
    "expired": false,
    "has_refresh_token": true,
    "has_di_token": true
  },
  "cache": { "enabled": false },
  "next_steps": [
    "Ready. Add this MCP server to your agent and start with garmin_daily_summary."
  ]
}
```

## First agent call

Once `doctor` is `READY`, point your MCP client at the server and ask:

```text
Call garmin_connection_status. If ready, call garmin_daily_summary with
response_format=json and give me today's main recovery/training signal with
3 practical actions. Do not provide medical diagnosis.
```

## Prefer the legacy Python helper?

The old flow still works and is fully opt-in:

```bash
garmin-mcp-server auth --use-python      # use an existing garminconnect install
garmin-mcp-server auth --install-helper  # install garminconnect (falls back to ~/.garmin-mcp/venv)
```

---

This is an **unofficial** project that uses personal Garmin Connect token mode —
not the official Garmin Health API. Garmin can change private auth at any time;
treat failures as integration drift, not user error.
