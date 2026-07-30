import { URL, URLSearchParams } from "node:url";
import { DEFAULT_LIMIT, GARMIN_CONNECT_API_BASE_URL, GARMIN_DI_TOKEN_URL, MAX_GARMIN_LIMIT } from "../constants.js";
import type { GarminConfig, GarminTokenSet } from "../types.js";
import { disabledCacheStatus, GarminCache, type CacheStatus } from "./cache.js";
import { fetchWithCache, getCacheStats } from "./http-cache.js";
import { fetchWithRetry as fetchWithRetryMiddleware } from "./http-retry.js";
import { redactErrorMessage } from "./redaction.js";
import { TokenStore } from "./token-store.js";

export interface ListParams {
  after?: string;
  before?: string;
  page?: number;
  limit?: number;
  all_pages?: boolean;
  max_pages?: number;
  activity_type?: string;
}

const NATIVE_API_USER_AGENT = "GCM-Android-5.23";
const NATIVE_X_GARMIN_USER_AGENT = "com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0";

export class GarminClient {
  private readonly tokenStore: TokenStore;
  private cache?: GarminCache;

  constructor(private readonly config: GarminConfig) {
    this.tokenStore = new TokenStore(config.tokenPath);
  }

  async get(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", path, undefined, params);
  }

  async post(path: string, body?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("POST", path, body);
  }

  async listActivities(params: ListParams = {}): Promise<{ records: unknown[]; next_page?: number; pages_fetched: number }> {
    const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_GARMIN_LIMIT);
    const maxPages = params.all_pages ? Math.max(1, params.max_pages ?? 1) : 1;
    const records: unknown[] = [];
    let start = Math.max(((params.page ?? 1) - 1) * limit, 0);
    let pages = 0;

    while (pages < maxPages) {
      const payload = await this.get("/activitylist-service/activities/search/activities", {
        start,
        limit,
        activityType: params.activity_type,
        startDate: params.after ? toDate(params.after) : undefined,
        endDate: params.before ? toDate(params.before) : undefined
      });
      const pageRecords = extractRecords(payload);
      records.push(...pageRecords);
      pages += 1;
      if (!params.all_pages || pageRecords.length < limit) break;
      start += limit;
    }

    // Full last page ⇒ more data may exist. next_page is startPage + pages_fetched
    // (not Math.floor(start/limit)+1, which stays on the current page when only one
    // page was fetched because `start` is not advanced unless all_pages loops).
    const startPage = Math.max(params.page ?? 1, 1);
    return {
      records,
      next_page: records.length && records.length % limit === 0 ? startPage + pages : undefined,
      pages_fetched: pages
    };
  }

  async getDisplayName(): Promise<string> {
    const tokens = await this.tokenStore.read();
    if (tokens?.display_name) return tokens.display_name;
    const profile = await this.getProfile();
    const displayName = typeof profile.displayName === "string" && profile.displayName ? profile.displayName : undefined;
    if (!displayName) {
      throw new Error("Garmin profile has no displayName. Open Garmin Connect, complete the profile, then retry.");
    }
    await this.tokenStore.withLock(async () => {
      const latest = await this.tokenStore.read();
      if (latest) await this.tokenStore.write({ ...latest, display_name: displayName, full_name: typeof profile.fullName === "string" ? profile.fullName : latest.full_name, updated_at: new Date().toISOString() });
    });
    return displayName;
  }

  async getProfile(): Promise<Record<string, unknown>> {
    const profile = await this.get("/userprofile-service/socialProfile");
    if (!profile || typeof profile !== "object") throw new Error("Garmin profile response was empty or invalid.");
    return profile as Record<string, unknown>;
  }

  async cacheStatus(): Promise<CacheStatus> {
    const httpStats = getCacheStats();
    const http_cache = {
      size: httpStats.size,
      hit_count: httpStats.hit_count,
      miss_count: httpStats.miss_count,
      hit_rate: httpStats.hit_rate,
      default_ttl_seconds: 60,
      bypass_env_var: "GARMIN_NO_CACHE"
    };
    if (!this.config.cacheEnabled) return { ...disabledCacheStatus(this.config.cachePath), http_cache };
    return { ...this.getCache().status(), http_cache };
  }

  async clearLocalTokens(): Promise<{ ok: true; token_path: string; local_tokens_cleared: boolean }> {
    await this.tokenStore.withLock(async () => this.tokenStore.clear());
    return { ok: true, token_path: this.config.tokenPath, local_tokens_cleared: true };
  }

  private async request(method: "GET" | "POST", path: string, body?: Record<string, string | number | boolean | undefined>, params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    const token = await this.getValidToken();
    const url = this.buildUrl(path, params);
    const response = await this.fetchWithRetry(url, {
      method,
      headers: this.jsonHeaders(token),
      body: body ? JSON.stringify(cleanParams(body)) : undefined
    });

    if (response.status === 401 && token.di_refresh_token && token.di_client_id) {
      const refreshed = await this.refreshToken(true);
      const retry = await this.fetchWithRetry(url, {
        method,
        headers: this.jsonHeaders(refreshed),
        body: body ? JSON.stringify(cleanParams(body)) : undefined
      });
      return this.parseAndCache(method, url, retry);
    }

    return this.parseAndCache(method, url, response);
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const host = this.config.domain === "garmin.cn" ? "https://connectapi.garmin.cn" : GARMIN_CONNECT_API_BASE_URL;
    const url = new URL(`${host}${cleanPath}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async getValidToken(): Promise<GarminTokenSet> {
    const tokens = await this.tokenStore.read();
    if (!tokens?.di_token && !tokens?.jwt_web) {
      throw new Error(`Garmin token not found at ${this.config.tokenPath}. Run \`garmin-mcp-server auth\` first.`);
    }
    if (tokens.di_token && tokenExpiresSoon(tokens.di_token) && tokens.di_refresh_token && tokens.di_client_id) {
      return this.refreshToken(false);
    }
    return tokens;
  }

  private async refreshToken(force: boolean): Promise<GarminTokenSet> {
    return this.tokenStore.withLock(async () => {
      const current = await this.tokenStore.read();
      if (!current?.di_refresh_token || !current.di_client_id) {
        throw new Error("Garmin DI refresh token not found. Run `garmin-mcp-server auth` again.");
      }
      if (!force && current.di_token && !tokenExpiresSoon(current.di_token)) return current;

      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: current.di_client_id,
        refresh_token: current.di_refresh_token
      });
      const response = await this.fetchWithRetry(GARMIN_DI_TOKEN_URL, {
        method: "POST",
        headers: this.formHeaders(current.di_client_id),
        body: body.toString()
      });
      const data = await this.parseResponse(response) as Record<string, unknown>;
      const refreshed = {
        ...current,
        di_token: String(data.access_token ?? current.di_token ?? ""),
        di_refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : current.di_refresh_token,
        di_client_id: extractClientIdFromJwt(String(data.access_token ?? "")) ?? current.di_client_id,
        updated_at: new Date().toISOString()
      };
      await this.tokenStore.write(refreshed);
      return refreshed;
    });
  }

  private jsonHeaders(tokens: GarminTokenSet): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": NATIVE_API_USER_AGENT,
      "X-Garmin-User-Agent": NATIVE_X_GARMIN_USER_AGENT,
      "X-Garmin-Paired-App-Version": "10861",
      "X-Garmin-Client-Platform": "Android",
      "X-App-Ver": "10861",
      "X-Lang": "en",
      "X-GCExperience": "GC5"
    };
    if (tokens.di_token) headers.Authorization = `Bearer ${tokens.di_token}`;
    if (tokens.jwt_web) {
      headers.Cookie = `JWT_WEB=${tokens.jwt_web}`;
      headers.Origin = "https://connect.garmin.com";
      headers.Referer = "https://connect.garmin.com/modern/";
      headers["DI-Backend"] = "connectapi.garmin.com";
      if (tokens.csrf_token) headers["connect-csrf-token"] = tokens.csrf_token;
    }
    return headers;
  }

  private formHeaders(clientId: string): Record<string, string> {
    const basic = Buffer.from(`${clientId}:`).toString("base64");
    return {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "Cache-Control": "no-cache",
      "User-Agent": NATIVE_API_USER_AGENT,
      "X-Garmin-User-Agent": NATIVE_X_GARMIN_USER_AGENT
    };
  }

  private async parseResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    const payload = text ? safeJson(text) : null;
    if (!response.ok) {
      const details = payload && typeof payload === "object" ? JSON.stringify(payload) : text;
      throw new Error(`Garmin Connect API HTTP ${response.status}: ${redactErrorMessage(details || response.statusText)}`);
    }
    return payload ?? {};
  }

  private async parseAndCache(method: "GET" | "POST", url: string, response: Response): Promise<unknown> {
    try {
      const payload = await this.parseResponse(response);
      if (this.config.cacheEnabled && method === "GET") this.getCache().set(method, url, payload);
      return payload;
    } catch (error) {
      if (this.config.cacheEnabled && method === "GET") {
        const cached = this.getCache().get(method, url);
        if (cached !== undefined) return cached;
      }
      throw error;
    }
  }

  private getCache(): GarminCache {
    this.cache ??= new GarminCache(this.config.cachePath);
    return this.cache;
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    const retryWrappedFetch = (u: string, i?: RequestInit) => fetchWithRetryMiddleware(fetch, u, i, {
      vendor: "garmin",
      envFlag: "GARMIN_NO_RETRY"
    });
    return fetchWithCache(url, init, {
      defaultTtlSeconds: 60,
      envVarBypass: "GARMIN_NO_CACHE",
      innerFetch: retryWrappedFetch
    });
  }
}

function toDate(value: string): string {
  if (value === "today") return new Date().toISOString().slice(0, 10);
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:$|[Tt ])/);
  if (!match) throw new Error(`Invalid Garmin date range value: ${value}. Use YYYY-MM-DD or an ISO 8601 date-time.`);
  const date = match[1];
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid Garmin date range value: ${value}. Use a real calendar date.`);
  }
  return date;
}

function extractRecords(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["activities", "activityList", "records", "items", "data"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function cleanParams(input: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== "")) as Record<string, string | number | boolean>;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return undefined;
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function tokenExpiresSoon(token: string): boolean {
  const payload = decodeJwtPayload(token);
  const exp = typeof payload?.exp === "number" ? payload.exp : undefined;
  if (!exp) return false;
  return Math.floor(Date.now() / 1000) > exp - 900;
}

function extractClientIdFromJwt(token: string): string | undefined {
  const payload = decodeJwtPayload(token);
  return typeof payload?.client_id === "string" ? payload.client_id : undefined;
}
