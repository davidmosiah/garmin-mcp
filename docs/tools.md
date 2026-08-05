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
- `garmin_activity_series` — bounded time-series for one metric of one activity

### `garmin_activity_series` — agent-safe time-series

A 3-hour ride at 1 Hz is ~10,800 samples. Passing that to an agent burns the context
window and buys nothing. This tool returns exact aggregates plus a bounded series,
and states precisely what it discarded.

| Field | Meaning |
| --- | --- |
| `metric` | `heart_rate`, `power`, `cadence`, `speed`, `elevation`. GPS is never available here. |
| `start_time` / `t_unit` | Absolute start when known; `points[].t` is always seconds from that start. |
| `resolution_seconds` | Bucket width actually used. Raised automatically when the request would exceed `max_points`. |
| `max_points` | Point budget, default 400. Server hard cap is 500, even if you ask for more. |
| `stats` | `avg`/`min`/`max`/`p25`/`p50`/`p75`, always computed on **full-resolution** samples, never on buckets. `percentile_method` is named so you can reproduce them. |
| `points[]` | `{t, value, min, max, samples}` — intra-bucket spread stays visible instead of being flattened. |
| `time_in_zone` | Five bands of a reference max HR. `reference_source` is one of `caller_provided` / `activity_recorded_max` / `observed_max`. |
| `downsampled`, `source_points`, `returned_points`, `method` | Explicit loss accounting, so the agent never invents precision. |
| `data_quality` | `expected_samples`, `actual_samples`, `coverage_ratio`, `coverage_anchor`, `longest_gap_seconds`, `sample_interval_seconds`. |

Measured on the synthetic 3-hour fixture: **10,800 samples (379 KB) → 180 points
(11.3 KB), a 97% reduction**, with `avg`/`min`/`max`/percentiles still exact.

`coverage_anchor: "nominal_duration"` uses the activity row duration so a missing
leading 20 minutes of a 3h ride reports `coverage_ratio ≈ 0.889` instead of
"shorter, fully-sampled". Falls back to `sample_span` (interior holes only) when
Garmin does not return a duration. That close came from
[Mi Fitness Data Bridge](https://github.com/shkyyy18/mi-fitness-data-bridge)
(`agent-safe-series/v1`, commit `1647472`).

The response shape is aligned with the Mi Fitness Data Bridge (Kindred)
`workout_series` contract — see [issue #19](https://github.com/davidmosiah/garmin-mcp/issues/19) —
so one agent can consume both servers without special-casing. The shared
regression fixture lives in `scripts/synthetic-series-fixture.mjs`.

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
