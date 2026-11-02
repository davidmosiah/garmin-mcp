import { homedir } from "node:os";
import { join } from "node:path";
import { GARMIN_DEFAULT_TOKEN_RELATIVE_PATH, SERVER_NAME } from "../constants.js";
import type { PrivacyMode } from "../types.js";
import { loadConfigSources } from "./local-config.js";
import { REDACTED_KEY_PATTERNS } from "./redaction.js";

function parsePrivacyMode(value: string | undefined): PrivacyMode {
  if (value === "summary" || value === "structured" || value === "raw") return value;
  return "structured";
}

export function buildPrivacyAudit(): Record<string, unknown> {
  const sources = loadConfigSources();
  const value = (name: keyof typeof sources.values) => sources.values[name];
  return {
    project: SERVER_NAME,
    unofficial: true,
    config_source: sources.source,
    local_config_path: sources.local.path,
    local_config_exists: sources.local.exists,
    local_config_secure_permissions: sources.local.secure_permissions,
    privacy_mode_default: parsePrivacyMode(value("GARMIN_PRIVACY_MODE")),
    raw_payloads_opt_in: true,
    gps_redaction_default: true,
    cache_enabled: false,
    cache_path: value("GARMIN_CACHE_PATH") ?? join(homedir(), ".garmin-mcp", "cache.sqlite"),
    token_path: value("GARMIN_TOKEN_PATH") ?? join(homedir(), GARMIN_DEFAULT_TOKEN_RELATIVE_PATH),
    stdout_safe: true,
    secret_env_vars: ["GARMIN_EMAIL", "GARMIN_PASSWORD"],
    required_env_present: {},
    redacted_key_patterns: REDACTED_KEY_PATTERNS,
    notes: [
      "Authenticated Garmin responses are never cached; GARMIN_CACHE is accepted but has no effect.",
      "This is an unofficial Garmin Connect personal integration, not Garmin Health API partnership access.",
      "Garmin password is used only by the local auth helper when provided interactively or via env and is not stored by this MCP.",
      "Garmin Connect tokens are stored locally and are not returned by tools.",
      "Raw Garmin payloads require GARMIN_PRIVACY_MODE=raw or privacy_mode=raw.",
      "Sensitive profile, token and GPS fields are removed or minimized unless raw mode is explicitly requested.",
      "stdio transport logs to stderr to avoid corrupting JSON-RPC."
    ]
  };
}
