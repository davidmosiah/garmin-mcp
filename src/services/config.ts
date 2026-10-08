import { homedir } from "node:os";
import { join } from "node:path";
import { GARMIN_CACHE_FILENAME, GARMIN_DEFAULT_TOKEN_RELATIVE_PATH } from "../constants.js";
import type { PrivacyMode, GarminConfig } from "../types.js";
import { parseExplicitGarminDomain, type GarminDomain } from "./garmin-region.js";
import { loadConfigSources } from "./local-config.js";

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export function getConfig(): GarminConfig {
  const sources = loadConfigSources(process.env, homedir());
  const value = (name: keyof typeof sources.values) => env(name) ?? sources.values[name];
  const tokenPath = value("GARMIN_TOKEN_PATH") ?? join(homedir(), GARMIN_DEFAULT_TOKEN_RELATIVE_PATH);
  const cachePath = value("GARMIN_CACHE_PATH") ?? join(homedir(), ".garmin-mcp", GARMIN_CACHE_FILENAME);
  const privacyMode = parsePrivacyMode(value("GARMIN_PRIVACY_MODE"));
  const cacheEnabled = parseBool(value("GARMIN_CACHE"), false);
  const domain = parseExplicitGarminDomain(value("GARMIN_DOMAIN"), env("GARMIN_IS_CN"));

  return {
    tokenPath,
    privacyMode,
    cacheEnabled,
    cachePath,
    domain
  };
}

function parsePrivacyMode(value: string | undefined): PrivacyMode {
  if (value === "summary" || value === "structured" || value === "raw") return value;
  return "structured";
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return ["1", "true", "yes", "on", "sqlite"].includes(value.toLowerCase());
}

export function parseDomain(value: string | undefined): GarminDomain {
  return parseExplicitGarminDomain(value) ?? "garmin.com";
}
