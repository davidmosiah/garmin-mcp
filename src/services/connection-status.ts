import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GARMIN_DEFAULT_TOKEN_RELATIVE_PATH, PINNED_NPM_PACKAGE } from "../constants.js";
import type { PrivacyMode, GarminTokenSet } from "../types.js";
import { HERMES_DIRECT_TOOLS, type AgentClientName } from "./agent-manifest.js";
import { loadConfigSources } from "./local-config.js";

type Env = Record<string, string | undefined>;

export interface ConnectionStatusOptions {
  env?: Env;
  homeDir?: string;
  nowMs?: number;
  client?: AgentClientName;
}

export interface ConnectionStatus extends Record<string, unknown> {
  ok: boolean;
  ready_for_garmin_api: boolean;
  client?: AgentClientName;
  node: { version: string; supported: boolean };
  privacy_mode: PrivacyMode;
  required_env: Record<string, boolean>;
  missing_env: string[];
  redirect_uri?: string;
  automatic_auth_supported: boolean;
  config: { source: "env" | "local_config" | "mixed" | "missing"; path: string; exists: boolean; secure_permissions?: boolean; error?: string };
  token: {
    path: string;
    exists: boolean;
    readable: boolean;
    permissions?: string;
    secure_permissions?: boolean;
    expires_at?: number;
    expired?: boolean;
    has_refresh_token?: boolean;
    has_di_token?: boolean;
    display_name?: string;
    scope?: string;
    error?: string;
  };
  oauth: {
    recommended_scopes: string[];
    granted_scopes: string[];
    missing_recommended_scopes: string[];
    scope_status: "ok" | "missing_recommended" | "unknown" | "missing_token";
    activity_tools_ready: boolean;
    profile_tools_ready: boolean;
  };
  cache: { enabled: boolean; path: string };
  client_checks?: { hermes?: HermesClientCheck };
  next_steps: string[];
}

export interface HermesClientCheck {
  config_path: string;
  config_exists: boolean;
  garmin_server_configured: boolean;
  package_pinned: boolean;
  mcp_reload_confirmation_disabled?: boolean;
  skill_path: string;
  skill_installed: boolean;
  direct_tool_prefix: string;
  expected_direct_tools: string[];
  recommendations: string[];
  error?: string;
}

export async function buildConnectionStatus(options: ConnectionStatusOptions = {}): Promise<ConnectionStatus> {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const sources = loadConfigSources(env, homeDir);
  const value = (name: keyof typeof sources.values) => sources.values[name];
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const tokenPath = value("GARMIN_TOKEN_PATH") ?? join(homeDir, GARMIN_DEFAULT_TOKEN_RELATIVE_PATH);
  const cachePath = value("GARMIN_CACHE_PATH") ?? join(homeDir, ".garmin-mcp", "cache.sqlite");
  const token = await inspectToken(tokenPath, nowSeconds);
  const nodeSupported = Number(process.versions.node.split(".")[0] ?? 0) >= 20;
  const tokenUsable = token.exists && token.readable && token.secure_permissions !== false && (token.has_di_token || token.has_refresh_token);
  const ready = Boolean(tokenUsable);
  const clientChecks = options.client === "hermes" ? { hermes: await inspectHermesClient(homeDir) } : undefined;

  return {
    ok: ready && nodeSupported,
    ready_for_garmin_api: ready,
    client: options.client,
    node: { version: process.versions.node, supported: nodeSupported },
    privacy_mode: parsePrivacyMode(value("GARMIN_PRIVACY_MODE")),
    required_env: {},
    missing_env: [],
    automatic_auth_supported: true,
    config: {
      source: sources.source,
      path: sources.local.path,
      exists: sources.local.exists,
      secure_permissions: sources.local.secure_permissions,
      error: sources.local.error
    },
    token,
    oauth: buildCompatibilityAuthStatus(token),
    cache: { enabled: parseBool(value("GARMIN_CACHE")), path: cachePath },
    client_checks: clientChecks,
    next_steps: buildNextSteps({ token, nodeSupported })
  };
}

function parsePrivacyMode(value: string | undefined): PrivacyMode {
  if (value === "summary" || value === "structured" || value === "raw") return value;
  return "structured";
}

function parseBool(value: string | undefined): boolean {
  return Boolean(value && ["1", "true", "yes", "on", "sqlite"].includes(value.toLowerCase()));
}

async function inspectToken(path: string, nowSeconds: number): Promise<ConnectionStatus["token"]> {
  try {
    const [stat, text] = await Promise.all([fs.stat(path), fs.readFile(path, "utf8")]);
    const permissions = (stat.mode & 0o777).toString(8).padStart(3, "0");
    const securePermissions = process.platform === "win32" ? true : (stat.mode & 0o077) === 0;
    const token = JSON.parse(text) as Partial<GarminTokenSet>;
    const expiresAt = typeof token.di_token === "string" ? jwtExp(token.di_token) : undefined;
    return {
      path,
      exists: true,
      readable: true,
      permissions,
      secure_permissions: securePermissions,
      expires_at: expiresAt,
      expired: expiresAt ? expiresAt <= nowSeconds : undefined,
      has_refresh_token: typeof token.di_refresh_token === "string" && token.di_refresh_token.length > 0,
      has_di_token: typeof token.di_token === "string" && token.di_token.length > 0,
      display_name: typeof token.display_name === "string" ? token.display_name : undefined,
      scope: "garmin-connect-personal"
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { path, exists: false, readable: false };
    return { path, exists: true, readable: false, error: (error as Error).message };
  }
}

async function inspectHermesClient(homeDir: string): Promise<HermesClientCheck> {
  const configPath = join(homeDir, ".hermes", "config.yaml");
  const skillPath = join(homeDir, ".hermes", "skills", "garmin-mcp", "SKILL.md");
  const base: Omit<HermesClientCheck, "recommendations"> = {
    config_path: configPath,
    config_exists: false,
    garmin_server_configured: false,
    package_pinned: false,
    skill_path: skillPath,
    skill_installed: false,
    direct_tool_prefix: "mcp_garmin_",
    expected_direct_tools: HERMES_DIRECT_TOOLS
  };

  try {
    const [config, skillExists] = await Promise.all([readOptionalText(configPath), existsFile(skillPath)]);
    const configText = config.text ?? "";
    const check = {
      ...base,
      config_exists: config.exists,
      garmin_server_configured: /garmin-mcp-unofficial|garmin-mcp-server|garmin-mcp|garminmcp/i.test(configText) && /^\s*garmin\s*:/m.test(configText),
      package_pinned: /garmin-mcp-unofficial@\d+\.\d+\.\d+/.test(configText),
      mcp_reload_confirmation_disabled: config.exists ? /mcp_reload_confirm\s*:\s*false/.test(configText) : undefined,
      skill_installed: skillExists
    };
    return { ...check, recommendations: buildHermesRecommendations(check) };
  } catch (error) {
    const check = { ...base, error: (error as Error).message };
    return { ...check, recommendations: buildHermesRecommendations(check) };
  }
}

async function readOptionalText(path: string): Promise<{ exists: boolean; text?: string }> {
  try { return { exists: true, text: await fs.readFile(path, "utf8") }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false }; throw error; }
}

async function existsFile(path: string): Promise<boolean> {
  try { return (await fs.stat(path)).isFile(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

function buildHermesRecommendations(check: Omit<HermesClientCheck, "recommendations">): string[] {
  const recommendations: string[] = [];
  if (!check.config_exists) recommendations.push("Run `garmin-mcp-server setup --client hermes --no-auth` to create Hermes MCP config and local skill.");
  else if (!check.garmin_server_configured) recommendations.push("Add a `garmin` MCP server block to `~/.hermes/config.yaml`.");
  if (check.config_exists && check.garmin_server_configured && !check.package_pinned) recommendations.push(`Pin Hermes to \`${PINNED_NPM_PACKAGE}\` to avoid stale npx cache behavior.`);
  if (!check.skill_installed) recommendations.push("Install the Hermes skill at `~/.hermes/skills/garmin-mcp/SKILL.md` so agents prefer direct MCP tools.");
  if (check.config_exists && check.mcp_reload_confirmation_disabled !== true) recommendations.push("Optional: set `approvals.mcp_reload_confirm: false` if your Hermes policy allows MCP reload without confirmation.");
  recommendations.push("After Hermes config changes, use `/reload-mcp` or `hermes mcp test garmin`; do not restart the gateway for normal Garmin data access.");
  return recommendations;
}

function buildCompatibilityAuthStatus(token: ConnectionStatus["token"]): ConnectionStatus["oauth"] {
  if (!token.exists || !token.readable) {
    return { recommended_scopes: [], granted_scopes: [], missing_recommended_scopes: [], scope_status: "missing_token", activity_tools_ready: false, profile_tools_ready: false };
  }
  return { recommended_scopes: [], granted_scopes: ["garmin-connect-personal"], missing_recommended_scopes: [], scope_status: token.has_di_token ? "ok" : "unknown", activity_tools_ready: Boolean(token.has_di_token), profile_tools_ready: Boolean(token.has_di_token) };
}

function buildNextSteps(input: { token: ConnectionStatus["token"]; nodeSupported: boolean }): string[] {
  const steps: string[] = [];
  if (!input.nodeSupported) steps.push("Install Node.js 20 or newer.");
  if (!input.token.exists) steps.push("Run `garmin-mcp-server auth` and log in to Garmin locally (no Python needed). Tokens are saved under ~/.garmin-mcp with 0600 permissions.");
  else if (!input.token.readable) steps.push(`Fix token file readability at ${input.token.path}.`);
  else if (input.token.secure_permissions === false) steps.push(`Restrict token file permissions with: chmod 600 ${input.token.path}`);
  else if (!input.token.has_di_token) steps.push("Token file exists but does not contain a DI token. Run `garmin-mcp-server auth` again.");
  if (steps.length === 0) steps.push("Ready. Add this MCP server to your agent and start with garmin_daily_summary.");
  return steps;
}

function jwtExp(token: string): number | undefined {
  try {
    const part = token.split(".")[1];
    if (!part) return undefined;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
    return typeof payload.exp === "number" ? payload.exp : undefined;
  } catch { return undefined; }
}
