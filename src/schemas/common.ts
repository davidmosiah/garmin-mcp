import { z } from "zod";
import { DEFAULT_LIMIT, DEFAULT_MAX_PAGES, MAX_PAGES, MAX_GARMIN_LIMIT } from "../constants.js";
import { AGENT_CLIENTS } from "../services/agent-manifest.js";
import {
  SERIES_DEFAULT_MAX_POINTS,
  SERIES_DEFAULT_RESOLUTION_SECONDS,
  SERIES_HARD_MAX_POINTS,
  SERIES_METRICS
} from "../services/series.js";

export const ResponseFormatSchema = z.enum(["markdown", "json"]).default("markdown");
export const AgentClientSchema = z.enum(AGENT_CLIENTS).default("generic");
export const PrivacyModeValueSchema = z.enum(["summary", "structured", "raw"]);
export const PrivacyModeSchema = PrivacyModeValueSchema.optional()
  .describe("Optional per-call privacy override. Defaults to GARMIN_PRIVACY_MODE or structured. raw returns upstream Garmin JSON. summary removes GPS/map details.");

export const ExplicitPrivacyIntentSchema = z
  .boolean()
  .optional()
  .describe("Required true when privacy_mode=raw or include_gps=true (agent escalation of redaction).");

export const DateTimeSchema = z.string()
  .datetime({ offset: true })
  .optional()
  .describe("ISO 8601 date-time with timezone, e.g. 2026-05-01T00:00:00Z");

export const CollectionInputSchema = z.object({
  after: DateTimeSchema.describe("Only return activities after this time. Used as Garmin startDate when supported."),
  before: DateTimeSchema.describe("Only return activities before this time. Used as Garmin endDate when supported."),
  page: z.number().int().min(1).default(1).describe("Garmin page number."),
  limit: z.number().int().min(1).max(MAX_GARMIN_LIMIT).default(DEFAULT_LIMIT)
    .describe("Garmin page size."),
  activity_type: z.string().optional().describe("Optional Garmin activity type filter, e.g. running, cycling, walking."),
  all_pages: z.boolean().default(false).describe("Fetch multiple pages up to max_pages."),
  max_pages: z.number().int().min(1).max(MAX_PAGES).default(DEFAULT_MAX_PAGES)
    .describe("Maximum pages to fetch when all_pages is true."),
  privacy_mode: PrivacyModeSchema,
  explicit_user_intent: ExplicitPrivacyIntentSchema,
  response_format: ResponseFormatSchema
}).strict();

export const IdInputSchema = z.object({
  id: z.union([z.string().min(1), z.number().int().positive()]).describe("Garmin resource id."),
  privacy_mode: PrivacyModeSchema,
  explicit_user_intent: ExplicitPrivacyIntentSchema,
  response_format: ResponseFormatSchema
}).strict();

export const SimpleReadInputSchema = z.object({
  privacy_mode: PrivacyModeSchema,
  explicit_user_intent: ExplicitPrivacyIntentSchema,
  response_format: ResponseFormatSchema
}).strict();

export const ActivitySeriesInputSchema = z.object({
  id: z.union([z.string().min(1), z.number().int().positive()]).describe("Garmin activity id."),
  metric: z.enum(SERIES_METRICS).default("heart_rate")
    .describe("Which sample stream to shape. GPS is never available here; use privacy_mode escalation on garmin_get_activity_details instead."),
  resolution_seconds: z.number().int().min(1).max(3600).default(SERIES_DEFAULT_RESOLUTION_SECONDS)
    .describe("Requested bucket width. Automatically increased when it would exceed max_points; the response reports what was actually used."),
  max_points: z.number().int().min(1).max(SERIES_HARD_MAX_POINTS).default(SERIES_DEFAULT_MAX_POINTS)
    .describe(`Point budget for the returned series. Server hard cap is ${SERIES_HARD_MAX_POINTS}.`),
  reference_max_hr: z.number().int().min(100).max(240).optional()
    .describe("Reference max heart rate for zone math (reference_source=caller_provided). Without it, uses the activity row maxHR when available (activity_recorded_max), else the series observed max."),
  response_format: ResponseFormatSchema
}).strict();

const SeriesPointSchema = z.object({
  t: z.number().describe("Seconds since activity start."),
  value: z.number(),
  min: z.number(),
  max: z.number(),
  samples: z.number().int().positive()
}).strict();

export const ActivitySeriesOutputSchema = z.object({
  contract_version: z.literal("agent-safe-series/v1"),
  activity_id: z.union([z.string(), z.number()]),
  metric: z.enum(SERIES_METRICS),
  unit: z.string(),
  start_time: z.string().optional()
    .describe("Absolute activity start (ISO 8601) when known. points[].t is relative to this."),
  t_unit: z.literal("seconds_from_start"),
  resolution_seconds: z.number(),
  requested_resolution_seconds: z.number(),
  points: z.array(SeriesPointSchema),
  stats: z.object({
    avg: z.number(),
    min: z.number(),
    max: z.number(),
    p25: z.number(),
    p50: z.number(),
    p75: z.number(),
    percentile_method: z.literal("linear_interpolation")
  }).strict(),
  time_in_zone: z.object({
    zone_model: z.literal("percent_of_reference_max_hr"),
    reference_max_hr: z.number(),
    reference_source: z.enum(["caller_provided", "activity_recorded_max", "observed_max"]),
    zones: z.array(z.object({
      zone: z.number().int(),
      min_bpm: z.number(),
      max_bpm: z.number().nullable(),
      seconds: z.number(),
      percent: z.number()
    }).strict())
  }).strict().optional(),
  downsampled: z.boolean(),
  source_points: z.number().int().nonnegative(),
  returned_points: z.number().int().nonnegative(),
  method: z.enum(["time_bucket_mean", "none"]),
  data_quality: z.object({
    expected_samples: z.number().int().nonnegative(),
    actual_samples: z.number().int().nonnegative(),
    coverage_ratio: z.number().min(0).max(1),
    longest_gap_seconds: z.number().nonnegative(),
    sample_interval_seconds: z.number().positive(),
    coverage_anchor: z.enum(["nominal_duration", "sample_span"])
  }).strict(),
  notes: z.array(z.string())
}).strict();

export const ResponseOnlyInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

export const AgentManifestInputSchema = z.object({
  client: AgentClientSchema,
  response_format: ResponseFormatSchema
}).strict();

export const ConnectionStatusInputSchema = z.object({
  client: AgentClientSchema.optional(),
  response_format: ResponseFormatSchema
}).strict();

export const AuthInstructionsInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

export const DailySummaryInputSchema = z.object({
  days: z.number().int().min(1).max(30).default(7).describe("Lookback window for recent training context."),
  timezone: z.string().min(1).max(80).default("UTC").describe("IANA timezone used only for display, e.g. America/New_York."),
  response_format: ResponseFormatSchema
}).strict();

export const WellnessContextInputSchema = z.object({
  days: z.number().int().min(1).max(30).default(7).describe("Lookback window for normalized Garmin wellness context."),
  timezone: z.string().min(1).max(80).default("UTC").describe("IANA timezone used only for display, e.g. America/New_York."),
  soreness: z.array(z.string().min(1).max(80)).default([]),
  injury_flags: z.array(z.string().min(1).max(120)).default([]),
  notes: z.string().max(500).optional(),
  response_format: ResponseFormatSchema
}).strict();

export const WeeklySummaryInputSchema = z.object({
  days: z.number().int().min(7).max(60).default(7).describe("Recent analysis window in days."),
  compare_days: z.number().int().min(0).max(60).default(7).describe("Prior comparison window in days. Use 0 to disable comparison."),
  timezone: z.string().min(1).max(80).default("UTC").describe("IANA timezone used only for display, e.g. America/New_York."),
  response_format: ResponseFormatSchema
}).strict();

export const AuthInstructionsOutputSchema = z.object({
  auth_model: z.string(),
  command: z.string(),
  legacy_python_command: z.string().optional(),
  token_path: z.string(),
  stores_password: z.boolean(),
  notes: z.array(z.string()),
  next_step: z.string()
}).strict();

export const EndpointDataOutputSchema = z.object({
  endpoint: z.string(),
  privacy_mode: PrivacyModeValueSchema,
  data: z.unknown()
}).strict();

export const CollectionOutputSchema = z.object({
  endpoint: z.string(),
  privacy_mode: PrivacyModeValueSchema,
  count: z.number().int().nonnegative(),
  records: z.array(z.unknown()),
  next_page: z.number().int().positive().optional(),
  has_more: z.boolean(),
  pages_fetched: z.number().int().nonnegative()
}).strict();

export const CacheStatusOutputSchema = z.object({
  enabled: z.boolean(),
  path: z.string(),
  entries: z.number().int().nonnegative(),
  newest_cached_at: z.string().optional(),
  http_cache: z.object({
    size: z.number().int().nonnegative(),
    hit_count: z.number().int().nonnegative(),
    miss_count: z.number().int().nonnegative(),
    hit_rate: z.number().min(0).max(1),
    default_ttl_seconds: z.number().int().nonnegative(),
    bypass_env_var: z.string()
  }).strict().optional()
}).strict();

export const RevokeAccessOutputSchema = z.object({
  ok: z.boolean(),
  token_path: z.string(),
  local_tokens_cleared: z.boolean(),
  note: z.string()
}).strict();

export const PrivacyAuditOutputSchema = z.object({
  project: z.string(),
  unofficial: z.boolean(),
  config_source: z.enum(["env", "local_config", "mixed", "missing"]),
  local_config_path: z.string(),
  local_config_exists: z.boolean(),
  local_config_secure_permissions: z.boolean().optional(),
  privacy_mode_default: PrivacyModeValueSchema,
  raw_payloads_opt_in: z.boolean(),
  gps_redaction_default: z.boolean(),
  cache_enabled: z.boolean(),
  cache_path: z.string(),
  token_path: z.string(),
  stdout_safe: z.boolean(),
  secret_env_vars: z.array(z.string()),
  required_env_present: z.record(z.string(), z.boolean()),
  redacted_key_patterns: z.array(z.string()),
  notes: z.array(z.string())
}).strict();

export const CapabilitiesOutputSchema = z.object({
  project: z.string(),
  mcp_name: z.string(),
  creator: z.object({ name: z.string(), github: z.string() }).strict(),
  unofficial: z.boolean(),
  api_boundary: z.object({ source: z.string(), raw_definition: z.string(), does_not_include: z.array(z.string()) }).strict(),
  auth_model: z.object({ type: z.string(), token_storage: z.string(), token_source: z.string(), default_scopes: z.array(z.string()) }).strict(),
  privacy_modes: z.array(z.object({ mode: PrivacyModeValueSchema, use_when: z.string() }).strict()),
  supported_data: z.array(z.object({ name: z.string(), examples: z.array(z.string()), tools: z.array(z.string()) }).strict()),
  recommended_agent_flow: z.array(z.string()),
  client_aliases: z.object({
    hermes: z.object({
      tool_prefix: z.string(),
      direct_tools: z.array(z.string()),
      reload_command: z.string(),
      gateway_restart_required_for_data_access: z.boolean()
    }).strict()
  }).strict(),
  contribution_paths: z.array(z.string()),
  links: z.record(z.string(), z.string())
}).passthrough();

export const AgentManifestOutputSchema = z.object({
  project: z.string(),
  mcp_name: z.string(),
  client: AgentClientSchema,
  unofficial: z.boolean(),
  package: z.object({
    name: z.string(),
    version: z.string(),
    install_command: z.string(),
    pinned_install_command: z.string(),
    binary: z.string()
  }).strict(),
  auth: z.object({
    provider: z.string(),
    mode: z.string(),
    token_storage: z.string(),
    secret_storage: z.string(),
    caveat: z.string()
  }).strict(),
  recommended_first_calls: z.array(z.string()),
  standard_tools: z.array(z.string()),
  resources: z.array(z.string()),
  hermes: z.object({
    config_path: z.string(),
    skill_path: z.string(),
    tool_name_prefix: z.string(),
    common_tool_names: z.array(z.string()),
    recommended_config: z.string(),
    use_direct_tools: z.boolean(),
    avoid_terminal_workarounds: z.boolean(),
    no_gateway_restart_for_data_access: z.boolean(),
    reload_after_config_change: z.string(),
    doctor_command: z.string()
  }).strict(),
  agent_rules: z.array(z.string()),
  troubleshooting: z.array(z.object({ symptom: z.string(), action: z.string() }).strict()),
  links: z.record(z.string(), z.string())
}).strict();

export const ConnectionStatusOutputSchema = z.object({
  ok: z.boolean(),
  ready_for_garmin_api: z.boolean(),
  client: AgentClientSchema.optional(),
  node: z.object({ version: z.string(), supported: z.boolean() }).strict(),
  privacy_mode: PrivacyModeValueSchema,
  required_env: z.record(z.string(), z.boolean()),
  missing_env: z.array(z.string()),
  redirect_uri: z.string().optional(),
  automatic_auth_supported: z.boolean(),
  config: z.object({ source: z.enum(["env", "local_config", "mixed", "missing"]), path: z.string(), exists: z.boolean(), secure_permissions: z.boolean().optional(), error: z.string().optional() }).strict(),
  token: z.object({ path: z.string(), exists: z.boolean(), readable: z.boolean(), permissions: z.string().optional(), secure_permissions: z.boolean().optional(), expires_at: z.number().optional(), expired: z.boolean().optional(), has_refresh_token: z.boolean().optional(), has_di_token: z.boolean().optional(), display_name: z.string().optional(), scope: z.string().optional(), error: z.string().optional() }).strict(),
  oauth: z.object({
    recommended_scopes: z.array(z.string()),
    granted_scopes: z.array(z.string()),
    missing_recommended_scopes: z.array(z.string()),
    scope_status: z.enum(["ok", "missing_recommended", "unknown", "missing_token"]),
    activity_tools_ready: z.boolean(),
    profile_tools_ready: z.boolean()
  }).strict(),
  cache: z.object({ enabled: z.boolean(), path: z.string() }).strict(),
  client_checks: z.object({
    hermes: z.object({
      config_path: z.string(),
      config_exists: z.boolean(),
      garmin_server_configured: z.boolean(),
      package_pinned: z.boolean(),
      mcp_reload_confirmation_disabled: z.boolean().optional(),
      skill_path: z.string(),
      skill_installed: z.boolean(),
      direct_tool_prefix: z.string(),
      expected_direct_tools: z.array(z.string()),
      recommendations: z.array(z.string()),
      error: z.string().optional()
    }).strict().optional()
  }).strict().optional(),
  next_steps: z.array(z.string())
}).strict();


export const DataInventoryOutputSchema = z.object({
  kind: z.literal("data_inventory"),
  source: z.string(),
  mcp_name: z.string(),
  generated_at: z.string(),
  unofficial: z.boolean(),
  data_access_model: z.string(),
  auth: z.unknown().optional(),
  scopes: z.array(z.string()),
  api_boundary: z.unknown().optional(),
  privacy_modes: z.array(z.unknown()),
  categories: z.array(z.object({
    name: z.string(),
    examples: z.array(z.string()),
    tools: z.array(z.string())
  }).strict()),
  totals: z.object({
    categories: z.number().int().nonnegative(),
    listed_tools: z.number().int().nonnegative(),
    scopes: z.number().int().nonnegative()
  }).strict(),
  first_tools: z.array(z.string()),
  recommended_agent_flow: z.array(z.string()),
  links: z.record(z.string(), z.string()),
  notes: z.array(z.string())
}).strict();

export const SummaryOutputSchema = z.object({
  kind: z.enum(["daily_summary", "weekly_summary"]),
  generated_at: z.string()
}).passthrough();

export const WellnessContextOutputSchema = z.object({
  source: z.literal("garmin"),
  context_contract_version: z.literal("delx-wellness-context/v1"),
  context_type: z.literal("wellness_context"),
  generated_at: z.string(),
  readiness_score: z.number().min(0).max(100).optional(),
  sleep_score: z.number().min(0).max(100).optional(),
  body_battery: z.number().min(0).max(100).optional(),
  recent_training_load: z.enum(["low", "normal", "high", "unknown"]),
  recent_training_load_minutes: z.number().nonnegative().optional(),
  soreness: z.array(z.string()),
  injury_flags: z.array(z.string()),
  notes: z.array(z.string()),
  data_quality: z.unknown().optional(),
  recommended_handoff: z.object({ tool: z.string(), reason: z.string() }).strict(),
  telegram_summary: z.string().optional()
}).strict();

export type CollectionInput = z.infer<typeof CollectionInputSchema>;
export type IdInput = z.infer<typeof IdInputSchema>;
export type ActivitySeriesInput = z.infer<typeof ActivitySeriesInputSchema>;
export type SimpleReadInput = z.infer<typeof SimpleReadInputSchema>;
export type ResponseOnlyInput = z.infer<typeof ResponseOnlyInputSchema>;
export type AgentManifestInput = z.infer<typeof AgentManifestInputSchema>;
export type AuthInstructionsInput = z.infer<typeof AuthInstructionsInputSchema>;
export type DailySummaryInput = z.infer<typeof DailySummaryInputSchema>;
export type WellnessContextInput = z.infer<typeof WellnessContextInputSchema>;
export type WeeklySummaryInput = z.infer<typeof WeeklySummaryInputSchema>;
