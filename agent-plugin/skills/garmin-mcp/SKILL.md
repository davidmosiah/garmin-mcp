---
name: garmin-mcp
description: >-
  Read the user's Garmin Body Battery, HRV status, sleep, stress, training readiness and activities through the local garmin MCP server. Use when the user asks about Garmin data, Body Battery, training readiness or status, HRV, sleep, or whether to train hard today. Starts with connection status, uses synthetic demo data before login, and never asks for the Garmin password in chat.
---

# Garmin

MCP server `garmin` from the `garmin-mcp-unofficial@0.8.0` npm package, run locally through `npx`. It reads Body Battery, HRV status, sleep, stress, training readiness and status, activities. Data source: Garmin Connect in unofficial personal mode (Garmin has no public consumer API): the user logs in locally once and the connector reuses the resulting Garmin Connect tokens.

## Workflow

1. Start with `garmin_connection_status`. Then pick what fits the question: `garmin_daily_summary`, `garmin_weekly_summary`.
2. If `garmin_connection_status` reports the connector is not ready, call `garmin_demo` for clearly labelled synthetic data so the user sees the shape of the answer, then give them the setup commands below to run in their own terminal.
3. Lead with the answer to the user's question, then the two or three numbers that support it, with dates. Say when data is missing or stale instead of filling gaps.

## Setup (the user runs this in a terminal, not in chat)

```bash
npx -y garmin-mcp-unofficial@0.8.0 setup --client generic
npx -y garmin-mcp-unofficial@0.8.0 auth
npx -y garmin-mcp-unofficial@0.8.0 doctor
```

`--client generic` keeps setup from writing a second Hermes server entry. `auth` asks for the Garmin Connect email, password and MFA code in the user's own terminal and saves only the resulting tokens to `~/.garmin-mcp/garmin_tokens.json`; the password is not stored.

## Safety

- Never ask the user to paste client secrets, passwords, tokens or MFA codes into the chat; setup happens in their terminal.
- Tools that change local state: garmin_profile_update (local profile only). Use them only when the user asks.
- Destructive: garmin_disconnect_local (deletes the local Garmin tokens). Confirm with the user first.
- Unofficial: Garmin may change or rate-limit the private Connect endpoints this mode relies on.
- Not medical advice: the data supports personal reflection and planning, not diagnosis or treatment. Point the user to a clinician for symptoms, medication or anything urgent.
