# Hermes Example

Setup:

```bash
npx -y garmin-mcp-unofficial setup --client hermes
npx -y garmin-mcp-unofficial auth
npx -y garmin-mcp-unofficial doctor --client hermes
```

After config changes, use `/reload-mcp` or:

```bash
hermes mcp test garmin
```

Start with direct tools:

- `mcp_garmin_garmin_connection_status`
- `mcp_garmin_garmin_daily_summary`
- `mcp_garmin_garmin_weekly_summary`
- `mcp_garmin_garmin_get_sleep_day`
- `mcp_garmin_garmin_get_body_battery_day`

Do not ask the user to paste Garmin passwords or tokens into chat.
