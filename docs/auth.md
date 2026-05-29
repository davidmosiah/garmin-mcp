# Auth

Garmin MCP uses unofficial Garmin Connect personal token mode.

```bash
npx -y garmin-mcp-unofficial auth
```

`auth` runs a **self-contained Node login** — no Python helper required. It prompts locally for your Garmin email, password and MFA code (when Garmin asks), exchanges them for Garmin Connect tokens, and writes them to `~/.garmin-mcp/garmin_tokens.json` with user-only (0600) permissions.

The MCP does not store Garmin passwords and does not return token values from any tool.

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
