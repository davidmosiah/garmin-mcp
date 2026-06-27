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

## Can Garmin break this?

Yes. Personal Garmin Connect mode is unofficial and can break if Garmin changes private auth or endpoints. Open an issue with sanitized error output if that happens.
