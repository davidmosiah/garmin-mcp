import { buildConnectionStatus } from "../services/connection-status.js";
import { SERVER_VERSION } from "../constants.js";
import { parseAgentClientName } from "../services/agent-manifest.js";
import { getOnboardingFlow, getProfilePath } from "../services/profile-store.js";
import { runAuthCommand } from "./auth.js";
import { runSetupCommand } from "./setup.js";

export async function runCliCommand(args: string[]): Promise<number | undefined> {
  const [command, ...rest] = args;
  if (!command || command === "--http") return undefined;
  if (command === "setup") return runSetupCommand(rest);
  if (command === "doctor" || command === "status") return runDoctor(rest);
  if (command === "auth") return runAuthCommand(rest);
  if (command === "onboarding") return runOnboarding(rest);
  if (command === "version" || command === "--version" || command === "-v") {
    console.log(SERVER_VERSION);
    return 0;
  }
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }
  if (!command.startsWith("--")) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    return 1;
  }
  return undefined;
}

function runOnboarding(args: string[]): number {
  let locale: "en" | "pt-BR" = "en";
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--locale") {
      const value = args[index + 1];
      if (value === "pt-BR" || value === "en") locale = value;
      index += 1;
    } else if (args[index] === "--pt-BR" || args[index] === "--pt") {
      locale = "pt-BR";
    }
  }
  const flow = getOnboardingFlow(locale);
  console.log(JSON.stringify(flow, null, 2));
  if (process.stderr.isTTY) {
    const lines = [
      "",
      "# Delx Wellness Onboarding (shared profile)",
      "",
      `The agent will ask these ${flow.questions.length} questions next — non-secret data only,`,
      `stored at ~/.delx-wellness/profile.json (locale: ${flow.locale}).`,
      "",
      "Privacy contract:",
      "- Profile NEVER stores OAuth tokens, API keys, refresh tokens, cookies, or any provider secret.",
      "- Tokens stay in this connector's own ~/.garmin-mcp/garmin_tokens.json (0600 permissions).",
      "- The shared profile is read/written by every Delx Wellness connector — answer once, reuse everywhere.",
      "",
      `Storage path: ${getProfilePath()}`,
      ""
    ];
    process.stderr.write(lines.join("\n"));
  }
  return 0;
}

async function runDoctor(args: string[]): Promise<number> {
  const options = parseDoctorOptions(args);
  const status = await buildConnectionStatus({ client: options.client });
  if (options.json) {
    console.log(JSON.stringify(safeDoctorStatus(status), null, 2));
  } else {
    printDoctor(status);
  }
  return options.strict && !status.ok ? 1 : 0;
}

function parseDoctorOptions(args: string[]) {
  let client: ReturnType<typeof parseAgentClientName> | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--client") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --client.");
      client = parseAgentClientName(value);
      index += 1;
    }
  }
  return {
    json: args.includes("--json"),
    strict: args.includes("--strict"),
    client
  };
}


function safeDoctorStatus(status: Awaited<ReturnType<typeof buildConnectionStatus>>): unknown {
  const raw = status as Record<string, any>;
  const hermes = raw.client_checks?.hermes;
  const safeHermes = hermes ? Object.fromEntries(
    Object.entries(hermes).filter(([key]) => key !== "config_path" && key !== "skill_path")
  ) : undefined;
  return {
    ok: Boolean(raw.ok),
    client: raw.client,
    node: raw.node,
    required_env: raw.required_env,
    missing_env: raw.missing_env,
    automatic_auth_supported: Boolean(raw.automatic_auth_supported),
    privacy_mode: raw.privacy_mode,
    config: raw.config ? {
      exists: Boolean(raw.config.exists),
      source: raw.config.source
    } : undefined,
    token: raw.token ? {
      exists: Boolean(raw.token.exists),
      readable: Boolean(raw.token.readable),
      secure_permissions: raw.token.secure_permissions,
      expired: raw.token.expired,
      has_refresh_token: raw.token.has_refresh_token,
      has_di_token: raw.token.has_di_token
    } : undefined,
    oauth: raw.oauth ? {
      scope_status: raw.oauth.scope_status
    } : undefined,
    cache: raw.cache ? {
      enabled: Boolean(raw.cache.enabled)
    } : undefined,
    client_checks: safeHermes ? { hermes: safeHermes } : undefined,
    next_steps: raw.next_steps
  };
}

function printDoctor(status: Awaited<ReturnType<typeof buildConnectionStatus>>): void {
  const ok = "✓";
  const fail = "✗";
  const info = "·";
  const check = (passed: boolean) => (passed ? ok : fail);
  const line = (mark: string, label: string, detail?: string) => {
    const labelCol = label.padEnd(28);
    console.log(`  ${mark}  ${labelCol}${detail ? `  ${detail}` : ""}`);
  };

  console.log("Garmin MCP · Doctor");
  console.log(`Status: ${status.ok ? `READY ${ok}` : `NEEDS SETUP ${fail}`}`);
  if (status.client) console.log(`Client: ${status.client}`);
  console.log("");
  console.log("Checks");
  line(check(status.node.supported), "Node.js >=20", status.node.supported ? undefined : `version ${status.node.version}`);
  line(status.config.exists ? ok : info, "Local config", status.config.exists ? status.config.source : "optional (none yet)");
  line(check(status.token.exists), "Token file", status.token.exists ? "present" : "missing — run auth --install-helper");
  if (status.token.exists) {
    line(status.token.secure_permissions === false ? fail : ok, "Token permissions", status.token.secure_permissions === false ? "insecure (chmod 600)" : undefined);
    line(check(Boolean(status.token.has_di_token)), "DI token", status.token.has_di_token ? undefined : "missing");
    line(check(Boolean(status.token.has_refresh_token)), "DI refresh token", status.token.has_refresh_token ? undefined : "missing");
    if (status.token.display_name) line(info, "Garmin display name", "available");
  }
  line(info, "Privacy mode", status.privacy_mode);
  line(status.cache.enabled ? ok : info, "Cache", status.cache.enabled ? "enabled" : "disabled");
  if (status.client_checks?.hermes) {
    const hermes = status.client_checks.hermes;
    console.log("");
    console.log("Hermes");
    line(info, "config path", hermes.config_path ? "configured" : "missing");
    line(check(hermes.garmin_server_configured), "configured");
    line(check(hermes.package_pinned), "pinned package");
    line(check(hermes.skill_installed), "skill", hermes.skill_installed ? "installed" : "missing");
    line(info, "direct tool prefix", hermes.direct_tool_prefix);
  }
  console.log("");
  console.log("Next steps");
  status.next_steps.forEach((step, index) => console.log(`  ${index + 1}. ${step}`));
  if (status.client_checks?.hermes?.recommendations.length) {
    console.log("");
    console.log("Hermes recommendations");
    status.client_checks.hermes.recommendations.forEach((step, index) => console.log(`  ${index + 1}. ${step}`));
  }
}

function printHelp(): void {
  console.log(`Garmin MCP Server

Usage:
  garmin-mcp-server                 Start MCP stdio server
  garmin-mcp-server --http          Start local HTTP MCP server
  garmin-mcp-server setup           Guided setup, local config, and MCP client config
  garmin-mcp-server setup --auth    Setup, then immediately start local Garmin auth
  garmin-mcp-server doctor          Check setup and next steps
  garmin-mcp-server doctor --json   Print setup status as JSON
  garmin-mcp-server doctor --client hermes
  garmin-mcp-server auth            Login locally through the helper and save ~/.garmin-mcp/garmin_tokens.json
  garmin-mcp-server auth --install-helper
                                  Install the Python garminconnect helper if missing
  garmin-mcp-server onboarding      Print the shared Delx wellness onboarding flow (11 questions)
  garmin-mcp-server onboarding --pt-BR
                                  Print the onboarding flow in pt-BR

Optional env/config:
  GARMIN_TOKEN_PATH=~/.garmin-mcp/garmin_tokens.json
  GARMIN_PRIVACY_MODE=summary|structured|raw
  GARMIN_CACHE=sqlite
`);
}
