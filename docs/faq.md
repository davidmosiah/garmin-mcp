# FAQ

## Is this official?

No. This is an unofficial open-source project and is not affiliated with Garmin.

## Why not use the official Garmin Health API?

Garmin Health API access is partner-approved and oriented toward business/developer programs. This MCP is for personal local Garmin Connect access.

## Do I need to create a Garmin developer app?

No. For this personal local mode, you do not create a client ID, client secret, redirect URI or scopes. Run `setup`, then `auth`.

## Does it store my Garmin password?

No. The auth helper prompts locally and stores Garmin Connect tokens, not your password.

## Why are setup and auth separate?

So non-technical users know exactly when Garmin credentials are requested. `setup` writes MCP config only. `auth` starts local Garmin login. `setup --auth` is available for one-shot installs.

## Why did auth mention HTTP 429, Cloudflare or missing responseStatus.type?

Garmin's private mobile SSO endpoint can rate-limit or bot-challenge headless
logins. Stop retrying for a while, confirm web/app login works, then retry from
a normal residential/browser-like network. Do not paste cookies, passwords,
tokens or `cf_clearance` into chat or GitHub issues.

## What data can agents read?

Profile, devices, daily movement, sleep, heart rate, HRV, stress, Body Battery, training readiness/status, respiration, SpO2, activities, weight and hydration when Garmin Connect has that data and the device/account supports it.

## Does it fetch raw sensor data?

No unrestricted raw accelerometer/gyroscope telemetry. It reads processed Garmin Connect data and supported activity detail payloads.

## How do you keep agent context under control for time-series?

Token budget is a product of tool design, not a request that the model “remember” to stay small.

1. **Summaries first** — `garmin_daily_summary`, `garmin_weekly_summary`, and `garmin_wellness_context` return scorecards and readiness context, not dense sample streams.
2. **Civil-day and range tools** — wellness endpoints take one `date` (or an explicit weight range). Collections use `limit` (default 20, max 100), optional `after`/`before`, and multi-page fetch only when `all_pages` is set (`max_pages` capped at 10).
3. **Privacy modes shape payload size** — `summary` minimizes fields; `structured` is the usual agent path with secrets/GPS stripped; `raw` is opt-in upstream Garmin Connect JSON only.
4. **Escalate activities carefully** — list → activity summary → splits / HR zones → `garmin_get_activity_details` only when samples are needed. Detail payloads can still be large in structured/raw mode; prefer `privacy_mode=summary` for coaching questions.
5. **Markdown previews truncate** — collection markdown shows a short preview and notes remaining rows; structured content remains the fuller channel.
6. **Synthetic demo** — `garmin_demo` returns contract-shaped samples with `is_demo: true` and never calls Garmin Connect.

There is no unrestricted per-second telemetry dump. Dense activity series remain an intentional deep-dive path, not the default agent flow. Design discussion with other local-first health MCPs: [issue #19](https://github.com/davidmosiah/garmin-mcp/issues/19).

## Why did tonight's daily summary drop sleep and HRV?

`garmin_daily_summary` queries Garmin by civil date. If you omit `timezone` (or pass `UTC`), "today" is the UTC calendar day. West of UTC, local evening after 00:00 UTC is already the next UTC date — a day whose night has not been slept yet — so sleep/HRV fields disappear from the JSON.

Pass an IANA `timezone` (for example `America/New_York`) so the queried date matches the local day. After local midnight, last night's sleep is usually still on the previous Garmin date until wake/sync. In that case `data_quality.availability.sleep` / `.hrv` is `empty` (not synced yet or absent) or `failed` (request error), `missing_or_failed` is true, and `confidence` is `partial`. Do not treat omitted scorecard keys as a recorded zero-sleep night.

## Can Garmin break this?

Yes. Personal Garmin Connect mode is unofficial and can break if Garmin changes private auth or endpoints. Open an issue with sanitized error output if that happens.
