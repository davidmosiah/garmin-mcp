import type { GarminDomain } from "./services/garmin-region.js";

export type ResponseFormat = "markdown" | "json";
export type PrivacyMode = "summary" | "structured" | "raw";
export type { GarminDomain };

export interface GarminTokenSet {
  di_token?: string;
  di_refresh_token?: string;
  di_client_id?: string;
  jwt_web?: string;
  csrf_token?: string;
  display_name?: string;
  full_name?: string;
  unit_system?: string;
  /** Region the tokens were minted against. Used to refresh on garmin.cn when env is unset. */
  domain?: GarminDomain;
  created_at?: string;
  updated_at?: string;
}

export interface GarminConfig {
  tokenPath: string;
  privacyMode: PrivacyMode;
  cacheEnabled: boolean;
  cachePath: string;
  /** Explicit region from env / local config / CLI. Token metadata fills in when unset. */
  domain?: GarminDomain;
}

export interface GarminCollection<T = unknown> {
  records?: T[];
  next_page?: number;
}

export interface ToolResponse<T> extends Record<string, unknown> {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: T;
  isError?: boolean;
}
