## 0.5.5 - 2026-07-30



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
