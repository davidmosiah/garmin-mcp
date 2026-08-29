---
name: garmin
description: >
  Unofficial Garmin Connect data for AI agents. Prefer MCP tools if connected; otherwise the package CLI.
  Use when the user wants Garmin data or actions through an agent.
---

# Garmin — skill or MCP

Same binary either way. Do not duplicate the API client.

## Choose a surface

**MCP** — tools appear natively after stdio/HTTP config:

```json
{ "mcpServers": { "garmin": { "command": "npx", "args": ["-y", "garmin-mcp-unofficial"] } } }
```

Do not put mutation flags in that snippet.

**Skill / CLI** — no MCP client required. Same tools:

```bash
npx -y garmin-mcp-unofficial call garmin_connection_status --json '{}'
```

If MCP tools named `garmin_*` are already available, use them. Do not also shell out.

## Loop

1. Call `garmin_connection_status` (or `doctor --json` when that exists).
2. Use read tools as asked.
3. Stop on `USER_ACTION_REQUIRED`. Do not invent env flags. Do not enable mutations from this skill.

## Never

- Paste tokens into git, chat logs, or the prompt
- Copy a mutations-enabled assignment into config
