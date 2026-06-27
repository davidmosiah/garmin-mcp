# Garmin MCP — Tools, Prompts, Resources & Data

Full reference for the [Garmin MCP](https://github.com/davidmosiah/garmin-mcp) server. For install see the [README](../README.md) and [quickstart](quickstart.md).

> **Unofficial project.** Not affiliated with, endorsed by or supported by Garmin. Uses the unofficial Garmin Connect personal-token mode. This is **not medical advice**.

## Tools

**Start with these:**

- `garmin_connection_status` — verify local setup before calling Garmin Connect
- `garmin_data_inventory` — inventory supported data domains, scopes, privacy modes and recommended first calls without calling Garmin APIs
- `garmin_daily_summary` — daily readiness, sleep, load, action candidates
- `garmin_weekly_summary` — scorecard, bottlenecks, next-week plan

**Auth & diagnostics**

- `garmin_capabilities`, `garmin_agent_manifest`, `garmin_auth_instructions`, `garmin_privacy_audit`

Auth troubleshooting lives in [docs/auth.md](auth.md). If login returns HTTP
429, Cloudflare, or a missing `responseStatus.type`, stop retrying and follow
the backoff guidance there.

**Profile & devices**

- `garmin_get_profile`, `garmin_get_user_settings`
- `garmin_list_devices`, `garmin_get_primary_training_device`

**Daily wellness signals** (each takes a `date`)

- `garmin_get_daily_summary`, `garmin_get_steps_day`
- `garmin_get_sleep_day`, `garmin_get_heart_day`, `garmin_get_hrv_day`
- `garmin_get_stress_day`, `garmin_get_body_battery_day`, `garmin_get_body_battery_events`
- `garmin_get_training_readiness_day`, `garmin_get_training_status_day`
- `garmin_get_respiration_day`, `garmin_get_spo2_day`
- `garmin_get_intensity_minutes_day`, `garmin_get_hydration_day`

**Activities**

- `garmin_list_activities`, `garmin_get_activity_details`

**Body & weight**

- `garmin_get_weight_range`

## Prompts

- `garmin_daily_checkin` — practical daily health and training check-in
- `garmin_weekly_review` — review trends across activity, sleep, stress, Body Battery, heart
- `garmin_intraday_investigation` — investigate one day's signals (heart, stress, Body Battery, activity)

## Resources

- `garmin://capabilities`, `garmin://agent-manifest`
- `garmin://summary/daily`, `garmin://summary/weekly`

## Data availability

This package reads processed Garmin Connect data via the unofficial personal-token mode. When `raw` is mentioned, it means upstream Garmin Connect JSON — **not** raw accelerometer / gyroscope / continuous device telemetry.

| Data | Available | Notes |
|---|:---:|---|
| Sleep duration + stages + score | ✓ | When the device/account supports it |
| HRV status + overnight HRV | ✓ | When supported by device/account |
| Body Battery (daily + events) | ✓ | Charge/drain reports |
| Stress samples + daily summary | ✓ | Per-day stress context |
| Training readiness + training status | ✓ | When supported by device/account |
| Daily movement (steps, calories, distance, floors, intensity minutes) | ✓ | Standard wellness signals |
| Heart rate (resting + daily samples) | ✓ | Per-day samples and resting HR |
| Activities + details + splits + zones | ✓ | Recent activities and detail payloads |
| Body composition / weight + hydration | ✓ | When logged |
| Continuous device telemetry / accelerometer / gyroscope | — | Not exposed by Garmin Connect web endpoints |

> Garmin can change private auth or endpoints at any time. Failures should be treated as integration drift, not user error.

## Configuration

```bash
GARMIN_TOKEN_PATH=~/.garmin-mcp/garmin_tokens.json
GARMIN_PRIVACY_MODE=summary                  # summary | structured | raw
GARMIN_CACHE=sqlite                          # optional read-through cache
GARMIN_CACHE_PATH=~/.garmin-mcp/cache.sqlite
GARMIN_DOMAIN=garmin.com                     # or garmin.cn for China accounts
```

## Hermes / remote setup

```bash
npx -y garmin-mcp-unofficial setup --client hermes
npx -y garmin-mcp-unofficial auth
npx -y garmin-mcp-unofficial doctor --client hermes
hermes mcp test garmin
```

After Hermes config changes, use `/reload-mcp` or `hermes mcp test garmin`. Don't restart the gateway for normal data access.

### Human-to-agent handoff

Paste this into your agent when you want it to install the bridge for you:

```text
Install the unofficial Garmin MCP server for me.
Repository: https://github.com/davidmosiah/garmin-mcp
Run setup, then auth, then doctor.
If this is Hermes, use setup --client hermes and reload MCP with /reload-mcp or hermes mcp test garmin.
Never ask me to paste Garmin passwords, tokens or raw private payloads into chat.
Start with garmin_connection_status, then garmin_daily_summary.
This is not medical advice.
```

## Requirements

- Node.js 20+
- A Garmin Connect account with active devices
- Python 3 only if you opt into the legacy `auth --use-python` helper; the default `auth` login is pure Node

## Development

```bash
git clone https://github.com/davidmosiah/garmin-mcp.git
cd garmin-mcp
npm install
npm test
npm run build
```

Test with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Links

- npm: <https://www.npmjs.com/package/garmin-mcp-unofficial>
- Docs site: <https://wellness.delx.ai/connectors/garmin>
- Legacy docs: <https://garminconnectmcp.vercel.app/>
- GitHub: <https://github.com/davidmosiah/garmin-mcp>
- Delx Wellness registry: <https://github.com/davidmosiah/delx-wellness>
- Connector quality standard: <https://github.com/davidmosiah/delx-wellness/blob/main/docs/connector-quality-standard.md>
- Garmin Health API program (official, partner-licensed): <https://developer.garmin.com/gc-developer-program/health-api/>
