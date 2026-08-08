## 0.7.2 - 2026-08-06

### Fixed
- Body Battery daily report no longer 404s: Garmin requires `startDate`/`endDate` query params (not a path date). Tools and daily/weekly summary unwrap the array response so the single-day contract is preserved ([#20](https://github.com/davidmosiah/garmin-mcp/pull/20) by @oysteinhagenpettersen).
- Demo-contract stub matches the live query-param endpoint (no soft body-battery miss in summary during tests).
- `date` inputs must be `yyyy-MM-dd` or `today` (civil-date only).

## 0.7.1 - 2026-08-05

### Added

- **`agent-safe-series/v1` parity with Mi Fitness Data Bridge** (Kindred,
  [shkyyy18/mi-fitness-data-bridge@1647472](https://github.com/shkyyy18/mi-fitness-data-bridge/commit/1647472),
  design thread [#19](https://github.com/davidmosiah/garmin-mcp/issues/19)):
  - `data_quality.coverage_anchor`: `nominal_duration` | `sample_span`. When the
    activity summary carries a duration, expected samples are derived from it so a
    missing leading/trailing segment reports `coverage_ratio < 1` instead of looking
    like a shorter, fully-sampled workout. Pattern invented and first shipped on the
    Xiaomi side — we adopted it.
  - `start_time` + `t_unit: "seconds_from_start"` on the series envelope.
  - `time_in_zone.reference_source` expanded to the shared vocabulary
    `caller_provided` | `activity_recorded_max` | `observed_max` (was `caller` |
    `observed_max`). Tool layer fetches the activity summary in parallel with
    details so duration, recorded max HR and start clock feed the contract without
    an extra agent call.

### Changed

- **Breaking (series enum only):** `reference_source: "caller"` is now
  `"caller_provided"` to match the shared contract. Zone math is unchanged.

## 0.7.0 - 2026-08-01

### Fixed

- **`garmin_demo` was teaching agents a contract that does not exist.** The tool's whole
  purpose is to let an agent see the payload shape before spending a real Garmin Connect
  call — but nobody had ever compared the examples to the builders, and all three had
  drifted. Of the 21 fields the demo advertised, **0 were returned by the server**; the
  examples omitted 94 key paths that are. Concretely, an agent that trusted the demo:
  - parsed `garmin_daily_summary` as a flat object and never found `scorecard`,
    `window`, `data_quality`, `diagnostic` or `safety` — the entire real envelope, plus
    every HRV, training-readiness, training-status, respiration and SpO2 field;
  - branched on `garmin_wellness_context.training_readiness === "moderate"`, a **string**
    field that does not exist; the server returns `readiness_score: 72`, a **number**
    under a different name. Same class of error for `body_battery_now` (real:
    `body_battery`) and `recommendation` (real: the structured
    `recommended_handoff.{tool,reason}`, which is the point of the
    `delx-wellness-context/v1` contract and was invisible in the demo);
  - expected `garmin_get_body_battery_day` to return `{ high, low, end_of_day,
    discharge_events, recharge_events }`. Not one of those six exists. Raw date tools
    return `{ endpoint, privacy_mode, data }` with the Garmin payload
    (`charged`, `drained`, `bodyBatteryValuesArray`, …) inside `data` — so the demo also
    hid the fact that the payload shape depends on `privacy_mode`.

  The examples now match the real output field for field. Demo values remain synthetic.

### Added

- `scripts/demo-contract-test.mjs`, wired into `npm test` — runs the real
  `buildDailySummary`, `buildWellnessContext` and `applyPrivacy` over a stub Garmin client,
  extracts recursive key paths, and fails in **both** directions: a key the demo invents,
  and a contract key the demo omits. 95 key paths verified. This is what makes the drift
  above impossible to reintroduce silently; a builder shape change now fails the build and
  points at `src/services/demo.ts`.
- `src/services/demo.ts` — the demo payload moved out of the tool handler so the gate can
  import it without standing up an MCP server.

## 0.6.0 - 2026-08-01

### Added

- `garmin_activity_series` — bounded, self-describing time-series for one activity metric.
  Exact stats (avg/min/max/p25/p50/p75, time-in-zone) are always computed on full-resolution
  samples; the returned series is downsampled into fixed time buckets under a 500-point server
  cap. Payload declares `downsampled`, `source_points`, `returned_points`, `method` and a
  `data_quality` block so agents never invent precision they do not have. On the synthetic
  3-hour 1 Hz fixture: 10,800 samples (379 KB) -> 180 points (11.3 KB), a 97% reduction.
- `scripts/synthetic-series-fixture.mjs` — deterministic synthetic 3-hour ride in Garmin
  `details` format (10,800 1 Hz HR points, closed-form profile, zero real health data), with
  independently computed ground truth. Counterpart to the Kindred / Mi Fitness Data Bridge
  fixture so both downsamplers can be regression-tested against the same effort.
- 22 regression checks in `scripts/activity-series-test.mjs`, wired into `npm test`.

### Notes

- Response shape is deliberately aligned with the Mi Fitness Data Bridge `workout_series`
  contract (issue #19) so a single agent can consume both servers without special-casing.
- GPS is never served by the series tool, whatever the caller requests; positional streams
  stay behind the existing `privacy_mode` / `include_gps` escalation.

## 0.5.5 - 2026-07-30




## 0.5.8 - 2026-07-30

### Security

- Agent-requested `privacy_mode=raw` and `include_gps=true` require `explicit_user_intent=true` (config-default raw still allowed without per-call intent).

## 0.5.7 - 2026-07-30

### Security

- Recursive GPS/PII redaction in privacy layer (nested lat/lon/polyline/map dropped; Polar/Strava parity).

## 0.5.6 - 2026-07-30

### Security

- Security: require explicit_user_intent on revoke/disconnect tools so agents cannot wipe OAuth grants autonomously.

### Fixed

- `listActivities` `next_page` no longer returns the current page after a full single-page fetch (agents looped forever). Matches startPage + pages_fetched (same class as strava/fitbit).

# Changelog

## 0.5.4 - 2026-07-16

### Fixed

- Garmin activity ranges now preserve the caller's calendar date when an ISO date-time includes an offset, and invalid dates fail before any HTTP request.
- Structured privacy output preserves upstream fields and nested DTOs after secret/GPS redaction; normalized aliases are additive and no longer replace upstream nulls or objects.
- Daily and weekly summaries still return useful partial data, but every underlying domain failure is now emitted to stderr with sensitive values redacted.

### Tests

- Add HTTP-boundary coverage for date serialization, pagination parameters, invalid-date fail-fast behavior and activity envelope extraction.
- Add regressions for structured-field collisions, future nested fields and partial-summary observability.

## 0.5.3 - 2026-06-27

### Fixed

- Native `auth` no longer collapses Garmin SSO rate-limit or bot-protection
  responses into `UNKNOWN`. HTTP 429, Cloudflare-like non-JSON challenges and
  JSON responses without `responseStatus.type` now return actionable guidance:
  stop retrying, back off, retry from a normal browser-like network, or use the
  legacy Python helper/trusted local token flow.
- CLI auth failure output no longer double-prefixes nested messages as
  `Garmin login failed: Garmin login failed: ...`.

### Changed

- Refresh README/docs into a shorter agent-first front door with a full
  `docs/tools.md` reference and safer auth troubleshooting guidance.

## 0.5.2 - 2026-06-27

### Security

- Pin transitive `hono` resolution to `4.12.27` via npm overrides, resolving production audit advisories while keeping the public MCP API unchanged.

## 0.5.1 - 2026-05-29

### Added

- **`examples/auth-quickstart.md`** — end-to-end walkthrough of the self-contained `auth` command with real captured terminal output: `--help`, interactive `auth`, non-interactive `auth --json` (success and missing-credentials error), and the post-auth `doctor` `READY` report. Linked from the README and `docs/quickstart.md` so the no-Python login flow is discoverable.

### Changed

- `server.json` `GARMIN_TOKEN_PATH` description now points at the self-contained `auth` (no Python) instead of the legacy `auth --install-helper`.

## 0.5.0 - 2026-05-28

### Added

- **Self-contained `auth` command (no Python helper required).** `garmin-mcp-server auth` now runs a pure-Node Garmin Connect login — SSO sign-in, MFA, and OAuth1→OAuth2 ticket exchange are implemented in `src/cli/garmin-login.ts` using `node:crypto` for HMAC-SHA1 signing. Tokens are written to `~/.garmin-mcp/garmin_tokens.json` (0600) in the same shape the connector already consumes (`di_token` / `di_refresh_token` / `di_client_id`).
- **`auth --json`** non-interactive login via `GARMIN_EMAIL` / `GARMIN_PASSWORD` (+ `GARMIN_MFA_CODE`).
- `scripts/native-auth-test.mjs` — verifies OAuth1 signature correctness against an independent recomputation, token-field mapping, full mocked login (happy path + MFA), error paths, and the CLI no-credentials failure.

### Changed

- The legacy Python `garminconnect` flow is now opt-in via `auth --use-python` (or `auth --install-helper` to install the package). Default `auth` no longer requires Python. Docs, help text, doctor hints, and agent guidance updated accordingly.

## 0.4.3 - 2026-05-20

### Added

- **HTTP response cache middleware** (`src/services/http-cache.ts`) — in-memory cache layered OUTSIDE retry (`fetchWithCache → fetchWithRetry → fetch`), so cached responses skip both network and retry. Default 60s TTL for GET only; POST/PUT/DELETE and 4xx/5xx responses are never cached.
- **`GARMIN_NO_CACHE=true` env var** — global per-process cache bypass; advertised in `server.json`.
- **Per-call `cache_ttl: 0`** request option — opts a single call out of cache without disabling globally.
- **Query-param-order-insensitive cache keys** — `?startDate=…&endDate=…` and `?endDate=…&startDate=…` share one cache entry.
- **`garmin_cache_status` now reports `http_cache` stats** alongside SQLite stats: `size`, `hit_count`, `miss_count`, `hit_rate`, `default_ttl_seconds`, `bypass_env_var`.
- `scripts/http-cache-test.mjs` — eight-case unit suite covering cache hit, POST never cached, TTL expiration, query-param normalization, 4xx not cached, env-var bypass, per-call `cache_ttl: 0`, and `getCacheStats()` math.

## 0.4.2 - 2026-05-19

### Added

- **Dedicated HTTP retry middleware** (`src/services/http-retry.ts`) — extracted from `GarminClient.fetchWithRetry` into a reusable, testable function with exponential backoff (500ms / 1s / 2s), ±20% jitter, and `Retry-After` header parsing (supports both seconds and HTTP-date formats).
- **`GARMIN_NO_RETRY=true` env flag** — disables retries entirely for tests or callers that want raw error propagation.
- **HTTP 408 added to retryable status set** alongside 429, 500, 502, 503, 504 — request-timeout responses are now transparently retried.
- **Network-error retries** — fetch failures (ECONNRESET, ENOTFOUND, timeouts) are now retried with the same backoff schedule as HTTP errors instead of bubbling up on the first failure.
- **Structured stderr logs** — each retry now writes `[garmin-mcp] retry N/3 after Xms (status=Y or error=Z)` so agents can correlate spike-and-recovery patterns in their logs.
- `scripts/http-retry-test.mjs` — six-case unit suite covering happy path, Retry-After header, env disable flag, 401 non-retry, exhaustion, and network-error retry.

### Changed

- `GarminClient.fetchWithRetry` now delegates to the shared middleware so the auth-failure 401 re-auth flow benefits from the same backoff guarantees.
- Backoff defers to `Retry-After` first (HTTP standard) and only computes jittered exponential when the header is absent or unparseable.

## 0.4.1 - 2026-05-11

### Fixed

- **Profile-store regex no longer false-positives on common wellness words.** Split `SECRET_PATTERNS` into `SECRET_KEY_PATTERNS` (broad, for field names like `oauth_token`) and `SECRET_VALUE_PATTERNS` (high-specificity, only credential shapes: JWTs, `Bearer <token>`, `sk_live_`, `sk-proj-`, `xoxb-`, `github_pat_`, raw `Authorization:` headers). Previously legitimate text like "5 training sessions per week", "limit cookies", "I need to refresh my approach", or "secret sauce: more sleep" was rejected.
- **Partial-profile reads no longer crash downstream.** `readProfileFile` now structurally merges with `DEFAULT_PROFILE` when legacy Hermes/OpenClaw files lacked sub-objects (goals, devices, training, nutrition, preferences, safety). Previously `buildProfileSummary` and `missingCriticalFields` would throw.
- **Onboarding `privacy_note` no longer hard-codes a single connector path.** Lists multiple example paths so the message reads correctly from every connector.

## 0.4.0 - 2026-05-11

- Add shared Delx wellness profile support, vendored from `delx-wellness/lib/profile-store.ts` into `src/services/profile-store.ts` (no new npm deps; Node built-ins only).
- Add `garmin_profile_get` tool — read the shared profile (`~/.delx-wellness/profile.json`), returns summary, missing_critical fields and storage_path. Read-only.
- Add `garmin_profile_update` tool — patch the shared profile; requires `explicit_user_intent=true`. Rejects any field that looks like a secret (oauth/token/secret/password/cookie/refresh/api_key/session).
- Add `garmin_onboarding` tool — return the 11-question onboarding flow (`en` or `pt-BR`) plus current profile state and missing critical fields. Read-only.
- Add `garmin-mcp-server onboarding` CLI command — print the onboarding flow JSON (and a TTY-friendly Markdown summary when stderr is a TTY).
- `recommended_first_calls` now leads with `garmin_profile_get` so agents check the shared profile state before walking quickstart.
- Auto-migration from Hermes (`~/.hermes/profiles/delx-wellness/wellness-profile.json`) and OpenClaw (`~/.openclaw-delx-wellness/workspace/wellness-profile.json`) legacy paths to the canonical `~/.delx-wellness/profile.json`.
- Tool count: 38 → 41.

## 0.1.4

- Fixed agent-facing docs links to use `https://garminconnectmcp.vercel.app/`.
- Made new Hermes setup configs include `approvals.mcp_reload_confirm: false` by default.
- Expanded HTTP smoke coverage to exercise the real MCP `/mcp` protocol, not only `/health`.

## 0.1.3

- Made `setup` non-interactive with respect to Garmin login by default; use `setup --auth` to start auth immediately.
- Actually added automatic isolated Python venv fallback for Garmin auth helper when Homebrew Python blocks `pip --user` installs.
- Added CLI regression coverage so smoke tests do not depend on a real local Garmin token.

## 0.1.2

- Added automatic isolated Python venv fallback for Garmin auth helper when Homebrew Python blocks pip --user installs.

## 0.1.1

- Updated public docs URL to https://garminconnectmcp.vercel.app after Vercel alias assignment.

## 0.1.0

- Initial Garmin MCP Unofficial release.
- Added local Garmin Connect auth helper using `garminconnect` without storing Garmin passwords.
- Added 34 read-only tools for profile, devices, daily summaries, sleep, heart, HRV, stress, Body Battery, training readiness, activities, weight and hydration.
- Added daily and weekly agent summaries with data-quality confidence and non-medical action candidates.
- Added privacy modes, token redaction, optional SQLite cache, local doctor checks and Hermes integration guidance.
- Added static documentation and Vercel landing page.
