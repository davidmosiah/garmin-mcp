import { GARMIN_CONNECT_PERSONAL_BOUNDARY, GARMIN_MCP_DOCS_URL, NPM_PACKAGE_NAME, PINNED_NPM_PACKAGE, SERVER_VERSION } from "../constants.js";

export const AGENT_CLIENTS = ["generic", "claude", "cursor", "windsurf", "hermes", "openclaw"] as const;
export type AgentClientName = typeof AGENT_CLIENTS[number];

export const HERMES_DIRECT_TOOLS = [
  "mcp_garmin_garmin_agent_manifest", "mcp_garmin_garmin_auth_instructions", "mcp_garmin_garmin_connection_status",
  "mcp_garmin_garmin_daily_summary", "mcp_garmin_garmin_data_inventory", "mcp_garmin_garmin_get_body_battery_day",
  "mcp_garmin_garmin_get_heart_day", "mcp_garmin_garmin_get_sleep_day", "mcp_garmin_garmin_get_training_readiness_day",
  "mcp_garmin_garmin_list_activities", "mcp_garmin_garmin_weekly_summary", "mcp_garmin_garmin_wellness_context"
];

const STANDARD_TOOLS = [
  "garmin_activity_series", "garmin_agent_manifest", "garmin_auth_instructions", "garmin_cache_status",
  "garmin_capabilities", "garmin_connection_status", "garmin_daily_summary",
  "garmin_data_inventory", "garmin_demo", "garmin_disconnect_local", "garmin_get_activity",
  "garmin_get_activity_details", "garmin_get_activity_hr_zones", "garmin_get_activity_splits",
  "garmin_get_activity_weather", "garmin_get_body_battery_day", "garmin_get_body_battery_events",
  "garmin_get_daily_summary", "garmin_get_heart_day", "garmin_get_hrv_day",
  "garmin_get_hydration_day", "garmin_get_intensity_minutes_day", "garmin_get_primary_training_device",
  "garmin_get_profile", "garmin_get_respiration_day", "garmin_get_sleep_day",
  "garmin_get_spo2_day", "garmin_get_steps_day", "garmin_get_stress_day",
  "garmin_get_training_readiness_day", "garmin_get_training_status_day", "garmin_get_user_settings",
  "garmin_get_weight_range", "garmin_list_activities", "garmin_list_devices",
  "garmin_onboarding", "garmin_privacy_audit", "garmin_profile_get",
  "garmin_profile_update", "garmin_quickstart", "garmin_weekly_summary",
  "garmin_wellness_context"
];

const RESOURCES = [
  "garmin://agent-manifest", "garmin://capabilities", "garmin://inventory",
  "garmin://latest/activity", "garmin://profile", "garmin://summary/daily",
  "garmin://summary/weekly"
];

export function parseAgentClientName(value: string): AgentClientName {
  return AGENT_CLIENTS.includes(value as AgentClientName) ? value as AgentClientName : "generic";
}

export function buildAgentManifest(client: AgentClientName = "generic") {
  return {
    project: "garmin-mcp-unofficial",
    mcp_name: "io.github.davidmosiah/garminmcp",
    client,
    unofficial: true,
    package: {
      name: NPM_PACKAGE_NAME,
      version: SERVER_VERSION,
      install_command: `npx -y ${NPM_PACKAGE_NAME}`,
      pinned_install_command: `npx -y ${PINNED_NPM_PACKAGE}`,
      binary: "garmin-mcp-server"
    },
    auth: {
      provider: "Garmin Connect",
      mode: "Unofficial personal token mode through a local helper",
      token_storage: "~/.garmin-mcp/garmin_tokens.json with 0600 permissions",
      secret_storage: "Garmin password is requested only by the local auth helper and is not saved by this MCP.",
      caveat: GARMIN_CONNECT_PERSONAL_BOUNDARY
    },
    recommended_first_calls: ["garmin_profile_get", "garmin_quickstart", "garmin_connection_status", "garmin_data_inventory", "garmin_wellness_context", "garmin_daily_summary", "garmin_weekly_summary"],
    standard_tools: STANDARD_TOOLS,
    resources: RESOURCES,
    hermes: {
      config_path: "~/.hermes/config.yaml",
      skill_path: "~/.hermes/skills/garmin-mcp/SKILL.md",
      tool_name_prefix: "mcp_garmin_",
      common_tool_names: HERMES_DIRECT_TOOLS,
      recommended_config: hermesConfigSnippet(),
      use_direct_tools: true,
      avoid_terminal_workarounds: true,
      no_gateway_restart_for_data_access: true,
      reload_after_config_change: "/reload-mcp or hermes mcp test garmin",
      doctor_command: "npx -y garmin-mcp-unofficial doctor --client hermes --json"
    },
    agent_rules: [
      "Call garmin_connection_status and garmin_data_inventory before Garmin data tools.",
      "If setup is incomplete, guide the user through setup, auth and doctor instead of guessing token state.",
      "Treat Garmin health data as sensitive. Do not expose raw payloads unless the user asks for raw mode.",
      "Do not ask users to paste Garmin passwords or tokens into agent chat. Run local auth instead.",
      "Explain that this is unofficial Garmin Connect personal mode, not Garmin Health API partnership access.",
      "For Hermes, do not restart the gateway for normal Garmin data access; reload MCP instead.",
      "Use garmin_wellness_context as the normalized handoff to exercise recommendation tools.",
      "Pass an IANA timezone to garmin_daily_summary, garmin_weekly_summary and garmin_wellness_context so the Garmin calendar date matches the user's local day. If sleep/HRV fields are omitted, read data_quality.availability and notes — empty means not synced yet or absent, not a recorded zero-sleep night.",
      "Do not provide medical diagnosis or treatment instructions. Frame outputs as health/training context."
    ],
    troubleshooting: [
      { symptom: "token file missing", action: "Run `garmin-mcp-server auth` locally. The built-in login supports MFA prompts (no Python needed)." },
      { symptom: "401, expired token, or refresh failure", action: "Run `garmin-mcp-server auth` again. Garmin can invalidate personal tokens." },
      { symptom: "429 or repeated auth failures", action: "Back off, avoid repeated logins, then retry later. Garmin can rate-limit private auth." },
      { symptom: "endpoint changed or 404", action: "Treat as Garmin Connect drift. Open an issue with the endpoint and sanitized error." },
      { symptom: "daily summary missing sleep/HRV after local evening", action: "Pass timezone (IANA, e.g. America/New_York). Check data_quality.availability — empty is not a zero-sleep night; overnight metrics usually attach after wake/sync." },
      { symptom: "Hermes configured but tools unavailable", action: "Run `/reload-mcp` or `hermes mcp test garmin`; do not restart gateway for normal reload." }
    ],
    links: {
      github: "https://github.com/davidmosiah/garmin-mcp",
      docs: GARMIN_MCP_DOCS_URL,
      npm: "https://www.npmjs.com/package/garmin-mcp-unofficial",
      garmin_connect: "https://connect.garmin.com/",
      garmin_health_api: "https://developer.garmin.com/gc-developer-program/health-api/"
    }
  };
}

export function formatAgentManifestMarkdown(manifest: ReturnType<typeof buildAgentManifest>): string {
  return `# Garmin MCP Agent Manifest

Unofficial: ${manifest.unofficial}
Package: \`${manifest.package.name}\` v${manifest.package.version}
Install: \`${manifest.package.install_command}\`
Pinned install: \`${manifest.package.pinned_install_command}\`

## Auth
Provider: ${manifest.auth.provider}
Mode: ${manifest.auth.mode}
Tokens: ${manifest.auth.token_storage}
Secret handling: ${manifest.auth.secret_storage}
Caveat: ${manifest.auth.caveat}

## First Calls
${manifest.recommended_first_calls.map((tool) => `- \`${tool}\``).join("\n")}

## Hermes
Config: \`${manifest.hermes.config_path}\`
Skill: \`${manifest.hermes.skill_path}\`
Reload: \`${manifest.hermes.reload_after_config_change}\`
Direct tools:
${manifest.hermes.common_tool_names.map((tool) => `- \`${tool}\``).join("\n")}

## Agent Rules
${manifest.agent_rules.map((rule) => `- ${rule}`).join("\n")}
`;
}

export function hermesConfigSnippet(): string {
  return `mcp_servers:\n  garmin:\n    command: npx\n    args:\n      - -y\n      - ${PINNED_NPM_PACKAGE}\n    timeout: 120\n    connect_timeout: 60\n    sampling:\n      enabled: false`;
}

export function hermesSkillMarkdown(): string {
  return `# Garmin MCP Skill

Use this skill whenever a user asks Hermes to inspect Garmin activity, sleep, heart-rate, HRV, stress, Body Battery, training readiness, daily summaries or weekly summaries through the Garmin MCP.

## Rules
- Start with \`mcp_garmin_garmin_connection_status\`.
- If tokens are missing, ask the user to run \`garmin-mcp-server auth\` locally. Never ask them to paste Garmin passwords or token values into chat.
- Prefer \`mcp_garmin_garmin_daily_summary\` and \`mcp_garmin_garmin_weekly_summary\` before low-level endpoint calls.
- Pass the user's IANA timezone into those summaries so "today" is the local Garmin calendar date, not UTC.
- If sleep/HRV fields are omitted, read \`data_quality.availability\` — empty is not a recorded zero-sleep night.
- Treat Garmin data as sensitive. Do not request raw payloads unless the user explicitly asks.
- Explain that this is unofficial Garmin Connect personal mode and can break if Garmin changes private auth or endpoints.
- Do not diagnose or treat medical conditions.
- Reload MCP with \`/reload-mcp\` or \`hermes mcp test garmin\`; do not restart the gateway for normal data access.
`;
}
