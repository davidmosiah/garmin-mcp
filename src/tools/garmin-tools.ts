import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ActivitySeriesInputSchema,
  ActivitySeriesOutputSchema,
  AgentManifestInputSchema,
  AgentManifestOutputSchema,
  AuthInstructionsInputSchema,
  AuthInstructionsOutputSchema,
  CacheStatusOutputSchema,
  CapabilitiesOutputSchema,
  CollectionInputSchema,
  CollectionOutputSchema,
  ConnectionStatusInputSchema,
  ConnectionStatusOutputSchema,
  DailySummaryInputSchema,
  DataInventoryOutputSchema,
  EndpointDataOutputSchema,
  IdInputSchema,
  PrivacyAuditOutputSchema,
  ResponseFormatSchema,
  ResponseOnlyInputSchema,
  RevokeAccessOutputSchema,
  SimpleReadInputSchema,
  SummaryOutputSchema,
  WeeklySummaryInputSchema,
  WellnessContextInputSchema,
  WellnessContextOutputSchema
} from "../schemas/common.js";
import { buildPrivacyAudit } from "../services/audit.js";
import { buildAgentManifest, formatAgentManifestMarkdown } from "../services/agent-manifest.js";
import { buildCapabilities } from "../services/capabilities.js";
import { buildDataInventory, formatInventoryMarkdown } from "../services/inventory.js";
import { buildConnectionStatus } from "../services/connection-status.js";
import { getConfig } from "../services/config.js";
import { bulletList, formatCollection, makeError, makeResponse } from "../services/format.js";
import { applyPrivacy, resolvePrivacyMode } from "../services/privacy.js";
import { buildDailySummary, buildWeeklySummary, formatSummaryMarkdown } from "../services/summary.js";
import { buildWellnessContext, formatWellnessContextMarkdown } from "../services/context.js";
import { SERIES_HARD_MAX_POINTS, buildActivitySeries, type GarminDetailsPayload } from "../services/series.js";
import {
  buildProfileSummary,
  getOnboardingFlow,
  getProfile,
  getProfilePath,
  missingCriticalFields,
  updateProfile,
  type WellnessProfileDocument
} from "../services/profile-store.js";
import { GarminClient } from "../services/garmin-client.js";

const DateReadInputSchema = z.object({
  date: z.string().default("today").describe("Date as yyyy-MM-dd or today."),
  privacy_mode: SimpleReadInputSchema.shape.privacy_mode,
  response_format: ResponseFormatSchema
}).strict();

const WeightRangeInputSchema = z.object({
  start_date: z.string().default("today").describe("Start date as yyyy-MM-dd or today."),
  end_date: z.string().default("today").describe("End date as yyyy-MM-dd or today."),
  privacy_mode: SimpleReadInputSchema.shape.privacy_mode,
  response_format: ResponseFormatSchema
}).strict();

type DateEndpointBuilder = (client: GarminClient, date: string) => string | Promise<string>;

function client(): GarminClient {
  return new GarminClient(getConfig());
}

function dateValue(value: string): string {
  if (value === "today") return new Date().toISOString().slice(0, 10);
  return value.slice(0, 10);
}

async function displayName(client: GarminClient): Promise<string> {
  return encodeURIComponent(await client.getDisplayName());
}

function registerCollectionTool(server: McpServer, name: string, title: string, description: string): void {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: CollectionInputSchema.shape,
      outputSchema: CollectionOutputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        const config = getConfig();
        const privacyMode = resolvePrivacyMode(config, params.privacy_mode, { explicit_user_intent: (params as { explicit_user_intent?: boolean }).explicit_user_intent, include_gps: (params as { include_gps?: boolean }).include_gps });
        const garmin = new GarminClient(config);
        const result = await garmin.listActivities(params);
        const endpoint = "/activitylist-service/activities/search/activities";
        const records = applyPrivacy(endpoint, { records: result.records }, privacyMode) as { records: unknown[] };
        const output = {
          endpoint,
          privacy_mode: privacyMode,
          count: records.records.length,
          records: records.records,
          next_page: result.next_page,
          has_more: Boolean(result.next_page),
          pages_fetched: result.pages_fetched
        };
        return makeResponse(output, params.response_format, formatCollection(title, records.records, output));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );
}

function registerDateTool(server: McpServer, name: string, title: string, endpointBuilder: DateEndpointBuilder, description: string): void {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: DateReadInputSchema.shape,
      outputSchema: EndpointDataOutputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        const config = getConfig();
        const garmin = new GarminClient(config);
        const privacyMode = resolvePrivacyMode(config, params.privacy_mode, { explicit_user_intent: (params as { explicit_user_intent?: boolean }).explicit_user_intent, include_gps: (params as { include_gps?: boolean }).include_gps });
        const date = dateValue(params.date);
        const endpoint = await endpointBuilder(garmin, date);
        const data = applyPrivacy(endpoint, await garmin.get(endpoint), privacyMode);
        return makeResponse({ endpoint, privacy_mode: privacyMode, data }, params.response_format, bulletList(title, { endpoint, date, data: JSON.stringify(data) }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );
}

function registerGetByIdTool(server: McpServer, name: string, title: string, endpointBuilder: (id: string | number) => string, description: string): void {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: IdInputSchema.shape,
      outputSchema: EndpointDataOutputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        const config = getConfig();
        const garmin = new GarminClient(config);
        const privacyMode = resolvePrivacyMode(config, params.privacy_mode, { explicit_user_intent: (params as { explicit_user_intent?: boolean }).explicit_user_intent, include_gps: (params as { include_gps?: boolean }).include_gps });
        const endpoint = endpointBuilder(params.id);
        const data = applyPrivacy(endpoint, await garmin.get(endpoint), privacyMode);
        return makeResponse({ endpoint, privacy_mode: privacyMode, data }, params.response_format, bulletList(title, { endpoint, data: JSON.stringify(data) }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );
}

function registerSimpleEndpointTool(server: McpServer, name: string, title: string, endpoint: string, description: string): void {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: SimpleReadInputSchema.shape,
      outputSchema: EndpointDataOutputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ response_format, privacy_mode, explicit_user_intent }) => {
      try {
        const config = getConfig();
        const privacyMode = resolvePrivacyMode(config, privacy_mode, { explicit_user_intent });
        const data = applyPrivacy(endpoint, await new GarminClient(config).get(endpoint), privacyMode);
        return makeResponse({ endpoint, privacy_mode: privacyMode, data }, response_format, bulletList(title, { endpoint, data: JSON.stringify(data) }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );
}

export function registerGarminTools(server: McpServer): void {
  server.registerTool("garmin_data_inventory", {
    title: "Garmin Data Inventory",
    description: "Inventory supported Garmin data domains, auth scope requirements, privacy boundary and recommended first calls. Does not call Garmin APIs or expose user data.",
    inputSchema: ResponseOnlyInputSchema.shape,
    outputSchema: DataInventoryOutputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }, async ({ response_format }) => {
    const inventory = buildDataInventory();
    return makeResponse(inventory, response_format, formatInventoryMarkdown(inventory));
  });
  server.registerTool("garmin_agent_manifest", {
    title: "Garmin Agent Manifest",
    description: "Machine-readable install, runtime and client guidance for AI agents. Does not call Garmin or expose secrets.",
    inputSchema: AgentManifestInputSchema.shape,
    outputSchema: AgentManifestOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ client: targetClient, response_format }) => {
    const manifest = buildAgentManifest(targetClient);
    return makeResponse(manifest, response_format, formatAgentManifestMarkdown(manifest));
  });

  server.registerTool("garmin_capabilities", {
    title: "Garmin MCP Capabilities",
    description: "Explain supported Garmin data, privacy boundaries, recommended agent workflow and project links.",
    inputSchema: ResponseOnlyInputSchema.shape,
    outputSchema: CapabilitiesOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    const capabilities = buildCapabilities();
    return makeResponse(capabilities, response_format, bulletList("Garmin MCP Capabilities", {
      project: capabilities.project,
      unofficial: capabilities.unofficial,
      api_boundary: capabilities.api_boundary.source,
      auth_model: capabilities.auth_model.type,
      recommended_first_tools: "garmin_connection_status, garmin_daily_summary, garmin_weekly_summary",
      docs: capabilities.links.docs
    }));
  });

  server.registerTool("garmin_quickstart", {
    title: "Garmin Quickstart",
    description:
      "Personalized 3-step setup walkthrough for the human user. Adapts to current state (env vars set? token present? what's next?). Call this first when the user asks 'how do I connect Garmin?'",
    inputSchema: ResponseOnlyInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    const config = getConfig();
    const status = await buildConnectionStatus();
    const hasToken = Boolean(status.token.exists && status.token.readable && status.token.has_di_token);
    const steps = [
      {
        step: 1,
        title: status.config.exists ? "(done) Local MCP config checked" : "Create local MCP config",
        action: status.config.exists
          ? `Config source: ${status.config.source}.`
          : "Run `garmin-mcp-server setup`. Setup writes MCP/client config only; it does not ask for or store your Garmin password.",
        done: status.config.exists,
      },
      {
        step: 2,
        title: hasToken ? "(done) Local Garmin token present" : "Run the local auth helper",
        action: hasToken
          ? `Tokens stored at ${config.tokenPath}. Auto-refresh handled by the connector.`
          : "Run `garmin-mcp-server auth`. The built-in login does the unofficial Garmin Connect auth locally (no Python needed, handles MFA). Stores tokens user-only.",
        done: hasToken,
      },
      {
        step: 3,
        title: "Verify with the agent",
        action: "Call garmin_connection_status, then garmin_daily_summary or garmin_wellness_context. Pair with wellness-nourish/cycle-coach/cgm for full coaching.",
        example: hasToken
          ? "garmin_wellness_context() → Body Battery + sleep + training readiness handoff."
          : "Until step 2 is done, data tools surface 'auth required' messages.",
        done: false,
      },
    ];
    const payload = {
      ok: true,
      ready: status.config.exists && hasToken,
      steps,
      next: steps.find((s) => !s.done) ?? steps[steps.length - 1],
      cross_connector_hints: [
        "Pair Garmin Body Battery + wellness-nourish for energy-aware meal coaching.",
        "Pair Garmin women's health + wellness-cycle-coach for phase-aware load adjustments.",
        "Pair Garmin training readiness + wellness-cgm-mcp for metabolic-stress detection.",
      ],
    };
    return makeResponse(payload, response_format, bulletList("Garmin Quickstart", {
      ready: payload.ready,
      next: payload.next.title,
    }));
  });

  server.registerTool("garmin_demo", {
    title: "Garmin Demo",
    description:
      "Returns realistic example payloads of garmin_daily_summary, garmin_wellness_context, and garmin_get_body_battery_day so agents see the contract before any real Garmin Connect call.",
    inputSchema: ResponseOnlyInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    const today = new Date().toISOString().slice(0, 10);
    const payload = {
      ok: true,
      is_demo: true,
      sample: {
        garmin_daily_summary: {
          date: today,
          steps: 8420,
          floors_climbed: 12,
          active_calories: 540,
          resting_heart_rate: 56,
          stress_avg: 28,
          body_battery_high: 84,
          body_battery_low: 23,
          sleep_score: 79,
          sleep_duration_min: 432,
        },
        garmin_wellness_context: {
          window: "last_24h",
          body_battery_now: 41,
          training_readiness: "moderate",
          stress_avg: 28,
          sleep_score: 79,
          recommendation: "Body Battery moderate, training readiness moderate. Tackle a Z2 endurance session today; save threshold work for tomorrow when battery should rebuild.",
        },
        garmin_get_body_battery_day: {
          date: today,
          high: 84,
          low: 23,
          end_of_day: 41,
          discharge_events: 3,
          recharge_events: 2,
        },
      },
      notes: [
        "All sample data is synthetic; tagged with is_demo=true.",
        "Real calls return live data from Garmin Connect after local auth.",
      ],
    };
    return makeResponse(payload, response_format, bulletList("Garmin Demo", {
      is_demo: true,
      body_battery_now: 41,
      training_readiness: "moderate",
      recommendation: payload.sample.garmin_wellness_context.recommendation,
    }));
  });

  server.registerTool(
    "garmin_profile_get",
    {
      title: "Garmin Profile Get (shared wellness profile)",
      description:
        "Read the shared Delx wellness profile (~/.delx-wellness/profile.json). Returns the user's preferred name, body basics, goals, devices, training context, nutrition context, agent preferences, and missing critical fields. Cross-connector — the same profile is also available from other Delx Wellness MCPs (WHOOP, Oura, Nourish, Fitbit, etc). Read-only.",
      inputSchema: ResponseOnlyInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ response_format }) => {
      try {
        const profile = await getProfile();
        const payload = {
          ok: true,
          profile,
          summary: buildProfileSummary(profile),
          missing_critical: missingCriticalFields(profile),
          storage_path: getProfilePath()
        };
        return makeResponse(
          payload,
          response_format,
          bulletList("Garmin Profile Get", {
            summary: payload.summary,
            missing_critical: payload.missing_critical.join(", ") || "none",
            storage_path: payload.storage_path
          })
        );
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  const ProfileUpdateInputSchema = z.object({
    patch: z.record(z.string(), z.unknown())
      .describe("Partial WellnessProfileDocument patch. Top-level keys may be: profile, goals, devices, training, nutrition, preferences, safety, notes."),
    explicit_user_intent: z.boolean().optional()
      .describe("Must be true. Set this AFTER the user has explicitly confirmed they want to save these changes to the shared wellness profile."),
    response_format: ResponseFormatSchema
  }).strict();

  server.registerTool(
    "garmin_profile_update",
    {
      title: "Garmin Profile Update (shared wellness profile)",
      description:
        "Persist a partial patch to the shared Delx wellness profile (~/.delx-wellness/profile.json). REQUIRES explicit_user_intent=true. Top-level fields stored: profile (preferred_name, language, timezone, units, age_or_birth_year, height, weight, sex_or_gender_context), goals, devices, training, nutrition, preferences, safety, notes. NEVER stores OAuth tokens, API keys, refresh tokens, cookies, or any secret-shaped field — writes will be rejected at validation time. Cross-connector — the same profile is read by other Delx Wellness MCPs.",
      inputSchema: ProfileUpdateInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ patch, explicit_user_intent, response_format }) => {
      if (!explicit_user_intent) {
        return makeResponse(
          {
            ok: false,
            error: "USER_ACTION_REQUIRED",
            hint: "Set explicit_user_intent=true after the user confirms they want to save this."
          },
          response_format,
          bulletList("Garmin Profile Update", {
            ok: false,
            error: "USER_ACTION_REQUIRED",
            hint: "Set explicit_user_intent=true after the user confirms they want to save this."
          })
        );
      }
      try {
        const updated_fields = Object.keys(patch);
        const profile = await updateProfile(patch as Partial<WellnessProfileDocument>);
        const payload = {
          ok: true,
          profile,
          summary: buildProfileSummary(profile),
          updated_fields
        };
        return makeResponse(
          payload,
          response_format,
          bulletList("Garmin Profile Update", {
            summary: payload.summary,
            updated_fields: updated_fields.join(", ") || "none"
          })
        );
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  const OnboardingInputSchema = z.object({
    locale: z.enum(["en", "pt-BR"]).optional()
      .describe("Onboarding locale. Defaults to 'en'. Use 'pt-BR' for Portuguese (Brazil)."),
    response_format: ResponseFormatSchema
  }).strict();

  server.registerTool(
    "garmin_onboarding",
    {
      title: "Garmin Onboarding (shared wellness profile)",
      description:
        "Return the 11-question Delx wellness onboarding flow (in English or pt-BR) plus the current shared profile state and missing critical fields. Read-only. The agent should ask these questions one-by-one, then call garmin_profile_update with explicit_user_intent=true to save. The same profile is reused by every Delx Wellness connector (WHOOP, Oura, Nourish, etc.) — agents can call the equivalent {connector}_onboarding tools to cover their respective domains, or rely on this one since all connectors share the same questions.",
      inputSchema: OnboardingInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ locale, response_format }) => {
      try {
        const flow = getOnboardingFlow(locale ?? "en");
        const profile = await getProfile();
        const payload = {
          ok: true,
          flow,
          profile,
          summary: buildProfileSummary(profile),
          missing_critical: missingCriticalFields(profile),
          cross_connector_hint:
            "The Delx wellness profile is shared across all connectors. Other connectors (whoop_onboarding, oura_onboarding, nourish_*, fitbit_*, etc.) read and write the same ~/.delx-wellness/profile.json — ask the user once and reuse everywhere."
        };
        return makeResponse(
          payload,
          response_format,
          bulletList("Garmin Onboarding", {
            locale: flow.locale,
            questions: flow.questions.length,
            missing_critical: payload.missing_critical.join(", ") || "none",
            storage_path: flow.storage_path
          })
        );
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  server.registerTool("garmin_auth_instructions", {
    title: "Garmin Auth Instructions",
    description: "Explain the local Garmin Connect authentication flow without asking the user to paste secrets into an agent.",
    inputSchema: AuthInstructionsInputSchema.shape,
    outputSchema: AuthInstructionsOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    const config = getConfig();
    const output = {
      auth_model: "Unofficial Garmin Connect personal token mode",
      command: "npx -y garmin-mcp-unofficial auth",
      legacy_python_command: "npx -y garmin-mcp-unofficial auth --use-python",
      token_path: config.tokenPath,
      stores_password: false,
      notes: [
        "`auth` runs a self-contained Node login (no Python required) and prompts locally for Garmin email, password and MFA when needed.",
        "If login reports HTTP 429, Cloudflare, or missing responseStatus.type, stop retrying and follow docs/auth.md; repeated attempts can worsen Garmin throttling.",
        "`auth --use-python` falls back to the legacy garminconnect helper if you prefer it.",
        "The MCP stores Garmin Connect tokens locally with user-only permissions and never returns token values from tools.",
        "This is not official Garmin Health API partnership access.",
        "Garmin can change private auth or endpoints; failures should be treated as integration drift, not user error."
      ],
      next_step: "Run garmin-mcp-server doctor, then start your MCP client and call garmin_connection_status."
    };
    return makeResponse(output, response_format, bulletList("Garmin Auth Instructions", output));
  });

  registerSimpleEndpointTool(server, "garmin_get_profile", "Garmin Profile", "/userprofile-service/socialProfile", "Get the authenticated Garmin profile using the configured privacy mode.");
  registerSimpleEndpointTool(server, "garmin_get_user_settings", "Garmin User Settings", "/userprofile-service/userprofile/user-settings", "Get Garmin account user settings such as units and display preferences.");
  registerSimpleEndpointTool(server, "garmin_list_devices", "Garmin Devices", "/device-service/deviceregistration/devices", "List devices registered to the Garmin account.");
  registerSimpleEndpointTool(server, "garmin_get_primary_training_device", "Garmin Primary Training Device", "/web-gateway/device-info/primary-training-device", "Get the primary Garmin training device when available.");

  registerDateTool(server, "garmin_get_daily_summary", "Garmin Daily Summary Raw", async (garmin, date) => `/usersummary-service/usersummary/daily/${await displayName(garmin)}?calendarDate=${date}`, "Get Garmin daily movement and wellness summary for a date.");
  registerDateTool(server, "garmin_get_steps_day", "Garmin Daily Steps Chart", async (garmin, date) => `/wellness-service/wellness/dailySummaryChart/${await displayName(garmin)}?date=${date}`, "Get Garmin daily steps and summary chart for a date.");
  registerDateTool(server, "garmin_get_heart_day", "Garmin Daily Heart Rate", async (garmin, date) => `/wellness-service/wellness/dailyHeartRate/${await displayName(garmin)}?date=${date}`, "Get Garmin daily heart-rate samples and resting heart-rate context for a date. Not medical advice.");
  registerDateTool(server, "garmin_get_sleep_day", "Garmin Daily Sleep", async (garmin, date) => `/wellness-service/wellness/dailySleepData/${await displayName(garmin)}?date=${date}&nonSleepBufferMinutes=60`, "Get Garmin sleep summary, stages and sleep window for a date. Not medical advice.");
  registerDateTool(server, "garmin_get_stress_day", "Garmin Daily Stress", (_garmin, date) => `/wellness-service/wellness/dailyStress/${date}`, "Get Garmin stress summary and samples for a date. Not medical advice.");
  registerDateTool(server, "garmin_get_body_battery_day", "Garmin Body Battery", (_garmin, date) => `/wellness-service/wellness/bodyBattery/reports/daily/${date}`, "Get Garmin Body Battery daily report for a date. Not medical advice.");
  registerDateTool(server, "garmin_get_body_battery_events", "Garmin Body Battery Events", (_garmin, date) => `/wellness-service/wellness/bodyBattery/events/${date}`, "Get Garmin Body Battery charge/drain events for a date. Not medical advice.");
  registerDateTool(server, "garmin_get_hrv_day", "Garmin HRV", (_garmin, date) => `/hrv-service/hrv/${date}`, "Get Garmin HRV status and overnight HRV metrics for a date when available. Not medical advice.");
  registerDateTool(server, "garmin_get_training_readiness_day", "Garmin Training Readiness", (_garmin, date) => `/metrics-service/metrics/trainingreadiness/${date}`, "Get Garmin training readiness for a date when supported by the device/account. Not medical advice.");
  registerDateTool(server, "garmin_get_training_status_day", "Garmin Training Status", (_garmin, date) => `/metrics-service/metrics/trainingstatus/aggregated/${date}`, "Get Garmin aggregated training status for a date when supported by the device/account. Not medical advice.");
  registerDateTool(server, "garmin_get_respiration_day", "Garmin Respiration", (_garmin, date) => `/wellness-service/wellness/daily/respiration/${date}`, "Get Garmin respiration data for a date when available. Not medical advice.");
  registerDateTool(server, "garmin_get_spo2_day", "Garmin SpO2", (_garmin, date) => `/wellness-service/wellness/daily/spo2/${date}`, "Get Garmin Pulse Ox / SpO2 data for a date when available. Not medical advice.");
  registerDateTool(server, "garmin_get_intensity_minutes_day", "Garmin Intensity Minutes", (_garmin, date) => `/wellness-service/wellness/daily/im/${date}`, "Get Garmin intensity minutes for a date.");
  registerDateTool(server, "garmin_get_hydration_day", "Garmin Hydration", async (garmin, date) => `/usersummary-service/usersummary/hydration/daily/${await displayName(garmin)}?calendarDate=${date}`, "Get Garmin hydration summary for a date when available.");

  server.registerTool("garmin_get_weight_range", {
    title: "Garmin Weight Range",
    description: "Get Garmin weight/body-composition logs for a date range. Not medical advice.",
    inputSchema: WeightRangeInputSchema.shape,
    outputSchema: EndpointDataOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (params) => {
    try {
      const config = getConfig();
      const privacyMode = resolvePrivacyMode(config, params.privacy_mode, { explicit_user_intent: (params as { explicit_user_intent?: boolean }).explicit_user_intent, include_gps: (params as { include_gps?: boolean }).include_gps });
      const start = dateValue(params.start_date);
      const end = dateValue(params.end_date);
      const endpoint = `/weight-service/weight/dateRange?startDate=${start}&endDate=${end}`;
      const data = applyPrivacy(endpoint, await new GarminClient(config).get(endpoint), privacyMode);
      return makeResponse({ endpoint, privacy_mode: privacyMode, data }, params.response_format, bulletList("Garmin Weight Range", { endpoint, start, end, data: JSON.stringify(data) }));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  registerCollectionTool(server, "garmin_list_activities", "Garmin Activities", "List recent Garmin activities. Supports pagination, optional date filters and privacy modes.");
  registerGetByIdTool(server, "garmin_get_activity", "Garmin Activity", (id) => `/activity-service/activity/${id}`, "Get a Garmin activity summary by activity id.");
  registerGetByIdTool(server, "garmin_get_activity_details", "Garmin Activity Details", (id) => `/activity-service/activity/${id}/details`, "Get detailed Garmin activity samples when available.");
  server.registerTool("garmin_activity_series", {
    title: "Garmin Activity Series",
    description:
      "Bounded time-series for one activity metric. Returns exact stats computed on full-resolution samples plus a downsampled series capped at " +
      `${SERIES_HARD_MAX_POINTS} points, so a 3-hour ride at 1 Hz never blows the context window. ` +
      "Prefer garmin_get_activity / splits / hr_zones first; reach for this when you actually need the shape of the effort over time. " +
      "GPS is never returned here.",
    inputSchema: ActivitySeriesInputSchema.shape,
    outputSchema: ActivitySeriesOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ id, metric, resolution_seconds, max_points, reference_max_hr, response_format }) => {
    try {
      const garmin = new GarminClient(getConfig());
      const endpoint = `/activity-service/activity/${id}/details`;
      // Deliberately unfiltered by privacy mode: summary mode strips the very sample
      // arrays this tool exists to compress, and the shaping below never emits GPS.
      const payload = await garmin.get(endpoint) as GarminDetailsPayload;
      const series = buildActivitySeries(payload, {
        activityId: id,
        metric,
        resolutionSeconds: resolution_seconds,
        maxPoints: max_points,
        referenceMaxHr: reference_max_hr
      });
      const zones = series.time_in_zone
        ? series.time_in_zone.zones.map((zone) => `Z${zone.zone} ${zone.percent}%`).join(", ")
        : undefined;
      return makeResponse(series, response_format, bulletList("Garmin Activity Series", {
        activity_id: series.activity_id,
        metric: `${series.metric} (${series.unit})`,
        avg: series.stats.avg,
        min_max: `${series.stats.min}–${series.stats.max}`,
        percentiles: `p25 ${series.stats.p25} | p50 ${series.stats.p50} | p75 ${series.stats.p75}`,
        time_in_zone: zones,
        resolution_seconds: series.resolution_seconds,
        points: `${series.returned_points} returned from ${series.source_points} samples`,
        downsampled: `${series.downsampled} (${series.method})`,
        coverage_ratio: series.data_quality.coverage_ratio,
        longest_gap_seconds: series.data_quality.longest_gap_seconds,
        notes: series.notes.length > 0 ? series.notes.join(" | ") : undefined
      }));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  registerGetByIdTool(server, "garmin_get_activity_splits", "Garmin Activity Splits", (id) => `/activity-service/activity/${id}/splits`, "Get Garmin activity splits/laps by activity id.");
  registerGetByIdTool(server, "garmin_get_activity_weather", "Garmin Activity Weather", (id) => `/activity-service/activity/${id}/weather`, "Get Garmin activity weather by activity id when available.");
  registerGetByIdTool(server, "garmin_get_activity_hr_zones", "Garmin Activity Heart-Rate Zones", (id) => `/activity-service/activity/${id}/hrTimeInZones`, "Get Garmin activity heart-rate zone time by activity id when available.");

  server.registerTool("garmin_connection_status", {
    title: "Garmin Connection Status",
    description: "Check local Garmin config, token file, Node version, privacy mode, cache readiness and optional MCP client readiness without calling Garmin or exposing secrets.",
    inputSchema: ConnectionStatusInputSchema.shape,
    outputSchema: ConnectionStatusOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format, client: targetClient }) => {
    const status = await buildConnectionStatus({ client: targetClient });
    return makeResponse(status, response_format, bulletList("Garmin Connection Status", {
      ok: status.ok,
      ready_for_garmin_api: status.ready_for_garmin_api,
      auth_mode: "garmin-connect-personal",
      token_path: status.token.path,
      token_exists: status.token.exists,
      has_di_token: status.token.has_di_token,
      has_refresh_token: status.token.has_refresh_token,
      privacy_mode: status.privacy_mode,
      next_steps: status.next_steps.join(" | ")
    }));
  });

  server.registerTool("garmin_cache_status", {
    title: "Garmin Cache Status",
    description: "Show optional local SQLite cache status. Enable with GARMIN_CACHE=sqlite or GARMIN_CACHE=true.",
    inputSchema: ResponseOnlyInputSchema.shape,
    outputSchema: CacheStatusOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    try {
      const status = await client().cacheStatus();
      return makeResponse(status, response_format, bulletList("Garmin Cache Status", status));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("garmin_privacy_audit", {
    title: "Garmin Privacy Audit",
    description: "Return local privacy, cache, token-path and env-presence posture without revealing secret values.",
    inputSchema: ResponseOnlyInputSchema.shape,
    outputSchema: PrivacyAuditOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    const audit = buildPrivacyAudit();
    return makeResponse(audit, response_format, bulletList("Garmin Privacy Audit", audit));
  });

  server.registerTool("garmin_disconnect_local", {
    title: "Disconnect Garmin Locally",
    description: "Delete the local Garmin token file. This does not change the Garmin account; use only when the user explicitly wants to disconnect this MCP. Gated by explicit_user_intent: true (requires explicit user intent).",
    inputSchema: {
      explicit_user_intent: z
        .boolean()
        .optional()
        .describe("Must be true after the user explicitly asked to disconnect. Prevents agents from revoking autonomously."),
      response_format: z.enum(["markdown", "json"]).default("markdown")
    },
    outputSchema: RevokeAccessOutputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  }, async ({ explicit_user_intent, response_format }) => {
    try {
      if (explicit_user_intent !== true) {
        return makeError(
          "USER_ACTION_REQUIRED: explicit_user_intent must be true to disconnect and clear local tokens. Ask the user to confirm disconnect first."
        );
      }

      const result = await client().clearLocalTokens();
      const output = { ...result, note: "Local Garmin MCP tokens were deleted. Run garmin-mcp-server auth before future API calls." };
      return makeResponse(output, response_format, bulletList("Garmin Local Tokens Deleted", output));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("garmin_daily_summary", {
    title: "Garmin Daily Health Summary",
    description: "Build a practical daily summary from Garmin activity, sleep, heart-rate, HRV, stress and Body Battery when available. Read-only and non-medical.",
    inputSchema: DailySummaryInputSchema.shape,
    outputSchema: SummaryOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (params) => {
    try {
      const summary = await buildDailySummary(client(), params);
      return makeResponse(summary, params.response_format, formatSummaryMarkdown(summary));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("garmin_weekly_summary", {
    title: "Garmin Weekly Health Review",
    description: "Build a weekly Garmin scorecard with movement, sleep, HRV, stress, Body Battery, bottlenecks and actions. Read-only and non-medical.",
    inputSchema: WeeklySummaryInputSchema.shape,
    outputSchema: SummaryOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (params) => {
    try {
      const summary = await buildWeeklySummary(client(), params);
      return makeResponse(summary, params.response_format, formatSummaryMarkdown(summary));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("garmin_wellness_context", {
    title: "Garmin Wellness Context",
    description: "Normalize Garmin readiness, sleep score, Body Battery and recent movement load into the shared wellness_context shape for recommendation engines.",
    inputSchema: WellnessContextInputSchema.shape,
    outputSchema: WellnessContextOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (params) => {
    try {
      const context = await buildWellnessContext(client(), params);
      return makeResponse(context, params.response_format, formatWellnessContextMarkdown(context));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });
}
