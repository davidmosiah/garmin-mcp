# Garmin MCP Quickstart

## 1. Install setup

```bash
npx -y garmin-mcp-unofficial setup
```

This creates local MCP configuration only. It does not ask for your Garmin password.

For Hermes:

```bash
npx -y garmin-mcp-unofficial setup --client hermes
```

## 2. Connect Garmin locally

```bash
npx -y garmin-mcp-unofficial auth
```

The built-in login prompts locally for Garmin email, password and MFA when needed — no Python required. The MCP does not store your Garmin password.

Prefer the legacy Python helper? Use `auth --use-python`, or `auth --install-helper` to install the `garminconnect` package (it falls back to an isolated virtualenv under `~/.garmin-mcp/venv` if Homebrew or PEP 668 blocks the install).

## 3. Check readiness

```bash
npx -y garmin-mcp-unofficial doctor
```

## 4. Ask your agent

Start with:

```text
Call garmin_connection_status. If ready, call garmin_daily_summary with response_format=json and give me today's main recovery/training signal with 3 practical actions. Do not provide medical diagnosis.
```

## Notes

Garmin MCP is unofficial. It uses personal Garmin Connect token mode, not official Garmin Health API partner access.

You do not need to create a Garmin developer app, client ID, client secret or redirect URL for this personal local mode.
