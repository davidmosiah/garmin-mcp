export const SERVER_NAME = "garmin-mcp-server";
export const SERVER_VERSION = "0.5.2";
export const NPM_PACKAGE_NAME = "garmin-mcp-unofficial";
export const PINNED_NPM_PACKAGE = `${NPM_PACKAGE_NAME}@${SERVER_VERSION}`;

export const GARMIN_CONNECT_API_BASE_URL = "https://connectapi.garmin.com";
export const GARMIN_DI_TOKEN_URL = "https://diauth.garmin.com/di-oauth2-service/oauth/token";
export const GARMIN_DEVELOPER_PORTAL_URL = "https://developerportal.garmin.com/developer-programs/connect-developer-api";
export const GARMIN_CONNECT_STATUS_URL = "https://connect.garmin.com/status/";
export const GARMIN_MCP_DOCS_URL = "https://garminconnectmcp.vercel.app/";

export const DEFAULT_PRIVACY_MODE = "structured";
export const DEFAULT_LIMIT = 20;
export const MAX_GARMIN_LIMIT = 100;
export const DEFAULT_MAX_PAGES = 1;
export const MAX_PAGES = 10;

export const GARMIN_TOKEN_FILENAME = "garmin_tokens.json";
export const GARMIN_DEFAULT_TOKEN_RELATIVE_PATH = `.garmin-mcp/${GARMIN_TOKEN_FILENAME}`;
export const GARMIN_CACHE_FILENAME = "cache.sqlite";

export const GARMIN_CONNECT_PERSONAL_BOUNDARY = "Personal Garmin Connect token mode is unofficial and may break if Garmin changes auth or private endpoints.";
