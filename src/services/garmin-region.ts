/**
 * Garmin Connect region / hostname helper.
 *
 * International accounts live on garmin.com; China (Garmin China app) accounts
 * live on garmin.cn. Hostnames, not client ids, change by region.
 *
 * References (do not guess):
 * - python-garminconnect `ALLOWED_DOMAINS = {"garmin.com", "garmin.cn"}` and
 *   Client.__init__ host templates: sso.{domain}, connect.{domain},
 *   connectapi.{domain}, diauth.{domain}/di-oauth2-service/oauth/token,
 *   mobile.integration.{domain}/gcm/android
 *   https://github.com/cyberjunky/python-garminconnect/blob/master/garminconnect/client.py
 * - garth `Client.domain` default "garmin.com" and
 *   `https://{subdomain}.{domain}` plus the same mobile/connectapi URL shapes
 *   https://github.com/matin/garth/blob/main/src/garth/http.py
 *   https://github.com/matin/garth/blob/main/src/garth/sso.py
 *
 * SSO client id `GCM_ANDROID_DARK` is the same for both regions (garth +
 * python-garminconnect). DI refresh client_id comes from the minted JWT.
 */

export const ALLOWED_GARMIN_DOMAINS = ["garmin.com", "garmin.cn"] as const;
export type GarminDomain = (typeof ALLOWED_GARMIN_DOMAINS)[number];

export const DEFAULT_GARMIN_DOMAIN: GarminDomain = "garmin.com";
export const GARMIN_CN_DOMAIN: GarminDomain = "garmin.cn";

/** Mobile SSO client id — identical for garmin.com and garmin.cn. */
export const GARMIN_SSO_CLIENT_ID = "GCM_ANDROID_DARK";

const DI_TOKEN_PATH = "/di-oauth2-service/oauth/token";
const MOBILE_ANDROID_SERVICE_PATH = "/gcm/android";

export type GarminDomainSource = "env" | "local_config" | "cli" | "token" | "default";

export interface GarminHosts {
  domain: GarminDomain;
  sso: string;
  connect: string;
  connectApi: string;
  diTokenUrl: string;
  mobileAndroidServiceUrl: string;
  connectModernUrl: string;
  diBackend: string;
}

export interface ResolveGarminDomainInput {
  /** Explicit setting from env, local config, or CLI. Wins over token metadata. */
  explicit?: string;
  /** `GARMIN_IS_CN` alias; ignored when `explicit` (GARMIN_DOMAIN) is set. */
  isCn?: string | boolean;
  /** Domain persisted next to saved tokens. */
  tokenDomain?: string;
}

export interface ResolvedGarminDomain {
  domain: GarminDomain;
  source: GarminDomainSource;
  is_cn: boolean;
}

export function isGarminDomain(value: unknown): value is GarminDomain {
  return value === "garmin.com" || value === "garmin.cn";
}

/**
 * Parse a domain string. `garmin.cn` / `cn` select China; any other non-empty
 * value (including `garmin.com`) is the international domain.
 */
export function parseGarminDomainValue(value: string | undefined): GarminDomain | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "garmin.cn" || trimmed === "cn") return "garmin.cn";
  return "garmin.com";
}

export function parseGarminIsCn(value: string | boolean | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (["1", "true", "yes", "on"].includes(trimmed)) return true;
  if (["0", "false", "no", "off"].includes(trimmed)) return false;
  return undefined;
}

/**
 * Explicit region from GARMIN_DOMAIN and/or GARMIN_IS_CN.
 * GARMIN_DOMAIN wins when both are set. Returns undefined when neither is set
 * so callers can fall back to token metadata.
 */
export function parseExplicitGarminDomain(
  domainValue: string | undefined,
  isCnValue?: string | boolean
): GarminDomain | undefined {
  const fromDomain = parseGarminDomainValue(domainValue);
  if (fromDomain) return fromDomain;
  const isCn = parseGarminIsCn(isCnValue);
  if (isCn === undefined) return undefined;
  return isCn ? "garmin.cn" : "garmin.com";
}

export function resolveGarminDomain(input: ResolveGarminDomainInput = {}): ResolvedGarminDomain {
  const explicit = parseExplicitGarminDomain(input.explicit, input.isCn);
  if (explicit) {
    return { domain: explicit, source: "env", is_cn: explicit === "garmin.cn" };
  }
  if (isGarminDomain(input.tokenDomain)) {
    return { domain: input.tokenDomain, source: "token", is_cn: input.tokenDomain === "garmin.cn" };
  }
  return { domain: DEFAULT_GARMIN_DOMAIN, source: "default", is_cn: false };
}

/** Precedence: env (`GARMIN_DOMAIN` / `GARMIN_IS_CN`) > local config > token metadata > garmin.com. */
export function resolveGarminDomainWithSource(input: {
  envDomain?: string;
  envIsCn?: string | boolean;
  localDomain?: string;
  tokenDomain?: string;
}): ResolvedGarminDomain {
  const fromEnv = parseExplicitGarminDomain(input.envDomain, input.envIsCn);
  if (fromEnv) {
    return { domain: fromEnv, source: "env", is_cn: fromEnv === "garmin.cn" };
  }
  const fromLocal = parseGarminDomainValue(input.localDomain);
  if (fromLocal) {
    return { domain: fromLocal, source: "local_config", is_cn: fromLocal === "garmin.cn" };
  }
  if (isGarminDomain(input.tokenDomain)) {
    return { domain: input.tokenDomain, source: "token", is_cn: input.tokenDomain === "garmin.cn" };
  }
  return { domain: DEFAULT_GARMIN_DOMAIN, source: "default", is_cn: false };
}

/**
 * Same host templates python-garminconnect Client.__init__ and garth use:
 * https://{sso|connect|connectapi|diauth|mobile.integration}.{domain}/...
 */
export function garminHosts(domain: GarminDomain = DEFAULT_GARMIN_DOMAIN): GarminHosts {
  const resolved = isGarminDomain(domain) ? domain : DEFAULT_GARMIN_DOMAIN;
  const connect = `https://connect.${resolved}`;
  const connectApi = `https://connectapi.${resolved}`;
  return {
    domain: resolved,
    sso: `https://sso.${resolved}`,
    connect,
    connectApi,
    diTokenUrl: `https://diauth.${resolved}${DI_TOKEN_PATH}`,
    mobileAndroidServiceUrl: `https://mobile.integration.${resolved}${MOBILE_ANDROID_SERVICE_PATH}`,
    connectModernUrl: `${connect}/modern/`,
    diBackend: `connectapi.${resolved}`
  };
}

export function defaultGarminHosts(): GarminHosts {
  return garminHosts(DEFAULT_GARMIN_DOMAIN);
}
