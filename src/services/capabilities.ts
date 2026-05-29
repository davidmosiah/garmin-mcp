import { GARMIN_CONNECT_PERSONAL_BOUNDARY, GARMIN_DEVELOPER_PORTAL_URL, GARMIN_MCP_DOCS_URL } from "../constants.js";

export function buildCapabilities() {
  return {
    project: "garmin-mcp-unofficial",
    mcp_name: "io.github.davidmosiah/garminmcp",
    creator: { name: "David Mosiah", github: "https://github.com/davidmosiah" },
    unofficial: true,
    api_boundary: {
      source: "Unofficial personal Garmin Connect mode, backed by local Garmin Connect tokens.",
      raw_definition: "raw means the JSON payload returned by supported Garmin Connect endpoints. It does not mean unrestricted raw device telemetry.",
      does_not_include: [
        "official Garmin Health API partnership access",
        "raw accelerometer or gyroscope telemetry",
        "continuous unrestricted sensor streams",
        "write/upload actions",
        "medical diagnosis or treatment guidance"
      ]
    },
    auth_model: {
      type: "Local Garmin Connect login helper with user-only token storage",
      token_storage: "~/.garmin-mcp/garmin_tokens.json with 0600 permissions",
      token_source: "Community garminconnect helper; this MCP does not store the Garmin password.",
      default_scopes: ["garmin-connect-personal"]
    },
    privacy_modes: [
      { mode: "summary", use_when: "Default-safe interpretation with identifiers, GPS and profile details minimized." },
      { mode: "structured", use_when: "Normalized Garmin profile, device, activity, sleep, heart and recovery data for agents." },
      { mode: "raw", use_when: "The user explicitly needs upstream Garmin payloads for debugging or deep analysis." }
    ],
    supported_data: [
      { name: "Profile and devices", examples: ["display name", "units", "registered devices", "primary training device"], tools: ["garmin_get_profile", "garmin_get_user_settings", "garmin_list_devices", "garmin_get_primary_training_device"] },
      { name: "Daily movement", examples: ["steps", "calories", "distance", "intensity minutes", "floors"], tools: ["garmin_get_daily_summary", "garmin_get_steps_day", "garmin_get_intensity_minutes_day"] },
      { name: "Sleep and recovery", examples: ["sleep duration", "sleep stages", "HRV", "body battery", "stress", "training readiness"], tools: ["garmin_get_sleep_day", "garmin_get_hrv_day", "garmin_get_body_battery_day", "garmin_get_stress_day", "garmin_get_training_readiness_day"] },
      { name: "Heart and physiology", examples: ["daily heart-rate samples", "resting HR", "respiration", "SpO2"], tools: ["garmin_get_heart_day", "garmin_get_respiration_day", "garmin_get_spo2_day"] },
      { name: "Activities", examples: ["recent workouts", "activity detail", "splits", "weather", "heart-rate zones"], tools: ["garmin_list_activities", "garmin_get_activity", "garmin_get_activity_details", "garmin_get_activity_splits", "garmin_get_activity_weather", "garmin_get_activity_hr_zones"] },
      { name: "Body logs", examples: ["weight range", "hydration day"], tools: ["garmin_get_weight_range", "garmin_get_hydration_day"] },
      { name: "Agent summaries", examples: ["daily diagnostic", "weekly trend review", "action candidates", "normalized wellness_context"], tools: ["garmin_daily_summary", "garmin_weekly_summary", "garmin_wellness_context"] }
    ],
    recommended_agent_flow: [
      "Call garmin_agent_manifest when installing or operating inside a server agent such as Hermes.",
      "Call garmin_connection_status before calling Garmin data tools.",
      "If setup is incomplete, guide the user through setup, auth and doctor.",
      "Use garmin_daily_summary or garmin_weekly_summary before low-level endpoint tools.",
      "Use garmin_wellness_context when handing readiness, sleep, Body Battery and load context to Exercise Catalog.",
      "Treat health data as sensitive; avoid raw payloads unless explicitly requested.",
      "Explain clearly that this is unofficial Garmin Connect personal mode and can break if Garmin changes private auth or endpoints.",
      "Use Garmin as trend context, not medical diagnosis. Escalate symptoms or abnormal vitals to clinicians."
    ],
    client_aliases: {
      hermes: {
        tool_prefix: "mcp_garmin_",
        direct_tools: ["mcp_garmin_garmin_agent_manifest", "mcp_garmin_garmin_connection_status", "mcp_garmin_garmin_daily_summary", "mcp_garmin_garmin_weekly_summary"],
        reload_command: "/reload-mcp",
        gateway_restart_required_for_data_access: false
      }
    },
    contribution_paths: [
      "Improve non-technical setup UX for Garmin accounts with MFA.",
      "Add more MCP client examples and screenshots.",
      "Expand endpoint coverage as Garmin Connect changes.",
      "Add evaluations for realistic health, training and recovery questions.",
      "Add optional official Garmin Health API mode if Garmin partner credentials are available."
    ],
    links: {
      github: "https://github.com/davidmosiah/garmin-mcp",
      docs: GARMIN_MCP_DOCS_URL,
      npm: "https://www.npmjs.com/package/garmin-mcp-unofficial",
      garmin_developer_program: GARMIN_DEVELOPER_PORTAL_URL,
      garmin_health_api: "https://developer.garmin.com/gc-developer-program/health-api/",
      garmin_connect: "https://connect.garmin.com/",
      caveat: GARMIN_CONNECT_PERSONAL_BOUNDARY
    }
  };
}
