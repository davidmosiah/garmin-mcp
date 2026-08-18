# Garmin MCP Skill

Use this skill whenever a user asks Hermes to inspect Garmin activity, sleep, heart-rate, HRV, stress, Body Battery, training readiness, daily summaries or weekly summaries through the Garmin MCP.

## Rules

- Start with `mcp_garmin_garmin_connection_status`.
- If tokens are missing, ask the user to run `garmin-mcp-server auth` locally.
- If auth reports HTTP 429, Cloudflare, or missing `responseStatus.type`, tell the user to stop retrying and follow `docs/auth.md`.
- Prefer `mcp_garmin_garmin_daily_summary` and `mcp_garmin_garmin_weekly_summary` before low-level endpoint calls.
- Pass the user's IANA timezone into those summaries so "today" is the local Garmin calendar date, not UTC.
- If sleep/HRV fields are omitted, read `data_quality.availability` — empty is not a recorded zero-sleep night.
- Treat Garmin data as sensitive. Do not request raw payloads unless the user explicitly asks.
- Explain that this is unofficial Garmin Connect personal mode and can break if Garmin changes private auth or endpoints.
- Do not diagnose or treat medical conditions.
- Reload MCP with `/reload-mcp` or `hermes mcp test garmin`; do not restart the gateway for normal data access.
