import { createHmac, randomBytes } from "node:crypto";
import { URL, URLSearchParams } from "node:url";
import type { GarminTokenSet } from "../types.js";

/**
 * Native (pure Node) Garmin Connect login.
 *
 * Ports the Garth / python-garminconnect SSO + OAuth flow so the CLI can mint
 * the same `~/.garmin-mcp/garmin_tokens.json` token set the runtime client
 * consumes — without requiring a separate Python helper. The token shape stays
 * identical (di_token / di_refresh_token / di_client_id) so the rest of the
 * connector and `doctor` keep working unchanged.
 *
 * Reference: https://github.com/matin/garth (src/garth/sso.py)
 */

const CLIENT_ID = "GCM_ANDROID_DARK";
const OAUTH_CONSUMER_URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json";
const OAUTH_USER_AGENT = "com.garmin.android.apps.connectmobile";
const SSO_PAGE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

const SSO_SUCCESSFUL = "SUCCESSFUL";
const SSO_MFA_REQUIRED = "MFA_REQUIRED";

export interface GarminLoginInput {
  email: string;
  password: string;
  domain?: "garmin.com" | "garmin.cn";
  /** Called when Garmin requires an MFA code. Return the user-entered code. */
  promptMfa?: () => Promise<string>;
}

export interface OAuthConsumer {
  consumer_key: string;
  consumer_secret: string;
}

export interface NativeLoginDeps {
  /** Injectable fetch + consumer fetch for testing. Defaults to global fetch + S3. */
  fetchImpl?: typeof fetch;
  getConsumer?: () => Promise<OAuthConsumer>;
}

interface OAuth1Token {
  oauth_token: string;
  oauth_token_secret: string;
  mfa_token?: string;
}

interface OAuth2Response {
  access_token: string;
  refresh_token: string;
  scope?: string;
  token_type?: string;
}

/**
 * Run the full Garmin login and return the token set the connector stores.
 * Throws a descriptive Error on any failure (bad credentials, MFA, network).
 */
export async function nativeGarminLogin(
  input: GarminLoginInput,
  deps: NativeLoginDeps = {}
): Promise<GarminTokenSet> {
  const domain = input.domain ?? "garmin.com";
  const fetchImpl = deps.fetchImpl ?? fetch;
  const jar = new CookieJar();
  const ssoHost = `https://sso.${domain}`;
  const connectApiHost = `https://connectapi.${domain}`;
  const serviceUrl = `https://mobile.integration.${domain}/gcm/android`;

  // 1. Seed SSO cookies.
  await ssoFetch(fetchImpl, jar, "GET", `${ssoHost}/sso/mobile/sso/en/sign-in?clientId=${CLIENT_ID}`, {
    headers: { ...ssoPageHeaders(), "Sec-Fetch-Site": "none" }
  });

  // 2. Submit credentials.
  const loginParams = new URLSearchParams({ clientId: CLIENT_ID, locale: "en-US", service: serviceUrl });
  const loginResp = await ssoFetch(fetchImpl, jar, "POST", `${ssoHost}/sso/mobile/api/login?${loginParams.toString()}`, {
    headers: { ...ssoPageHeaders(), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username: input.email, password: input.password, rememberMe: false, captchaToken: "" })
  });
  const loginJson = await parseJson(loginResp);
  const loginType = responseStatusType(loginJson);

  let ticket: string;
  if (loginType === SSO_SUCCESSFUL) {
    ticket = requireTicket(loginJson);
  } else if (loginType === SSO_MFA_REQUIRED) {
    if (!input.promptMfa) {
      throw new Error("Garmin requires an MFA code but no MFA prompt was provided.");
    }
    const mfaInfo = (loginJson.customerMfaInfo as Record<string, unknown> | undefined) ?? {};
    const mfaMethod = typeof mfaInfo.mfaLastMethodUsed === "string" ? mfaInfo.mfaLastMethodUsed : "email";
    const code = (await input.promptMfa()).trim();
    if (!code) throw new Error("Garmin MFA code was empty.");
    const mfaResp = await ssoFetch(fetchImpl, jar, "POST", `${ssoHost}/sso/mobile/api/mfa/verifyCode?${loginParams.toString()}`, {
      headers: { ...ssoPageHeaders(), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ mfaMethod, mfaVerificationCode: code, rememberMyBrowser: false, reconsentList: [], mfaSetup: false })
    });
    const mfaJson = await parseJson(mfaResp);
    if (responseStatusType(mfaJson) !== SSO_SUCCESSFUL) {
      throw new Error(`Garmin MFA verification failed: ${responseStatusDetail(mfaJson)}`);
    }
    ticket = requireTicket(mfaJson);
  } else {
    throw new Error(`Garmin login failed: ${responseStatusDetail(loginJson)}`);
  }

  // 3. Exchange ticket → OAuth1 → OAuth2 (signed with the Garmin consumer key).
  const consumer = await (deps.getConsumer ?? (() => fetchConsumer(fetchImpl)))();
  const oauth1 = await getOAuth1Token(fetchImpl, jar, consumer, ticket, connectApiHost, serviceUrl, domain);
  const oauth2 = await exchangeOAuth2(fetchImpl, jar, consumer, oauth1, connectApiHost, domain);

  return tokenSetFromOAuth2(oauth2);
}

export function tokenSetFromOAuth2(oauth2: OAuth2Response): GarminTokenSet {
  const now = new Date().toISOString();
  return {
    di_token: oauth2.access_token,
    di_refresh_token: oauth2.refresh_token,
    di_client_id: extractClientIdFromJwt(oauth2.access_token),
    created_at: now,
    updated_at: now
  };
}

async function getOAuth1Token(
  fetchImpl: typeof fetch,
  jar: CookieJar,
  consumer: OAuthConsumer,
  ticket: string,
  connectApiHost: string,
  serviceUrl: string,
  domain: string
): Promise<OAuth1Token> {
  const url =
    `${connectApiHost}/oauth-service/oauth/preauthorized` +
    `?ticket=${encodeURIComponent(ticket)}` +
    `&login-url=${encodeURIComponent(serviceUrl)}` +
    `&accepts-mfa-tokens=true`;
  const auth = oauth1Header("GET", url, { consumer });
  const resp = await fetchImpl(url, {
    method: "GET",
    headers: { "User-Agent": OAUTH_USER_AGENT, Authorization: auth, Cookie: jar.header(url) }
  });
  if (!resp.ok) {
    throw new Error(`Garmin OAuth1 preauthorized failed (HTTP ${resp.status}). The login ticket may have expired — retry login.`);
  }
  const parsed = Object.fromEntries(new URLSearchParams(await resp.text()).entries());
  if (!parsed.oauth_token || !parsed.oauth_token_secret) {
    throw new Error("Garmin OAuth1 response did not contain oauth_token/oauth_token_secret.");
  }
  void domain;
  return { oauth_token: parsed.oauth_token, oauth_token_secret: parsed.oauth_token_secret, mfa_token: parsed.mfa_token };
}

async function exchangeOAuth2(
  fetchImpl: typeof fetch,
  jar: CookieJar,
  consumer: OAuthConsumer,
  oauth1: OAuth1Token,
  connectApiHost: string,
  domain: string
): Promise<OAuth2Response> {
  const url = `${connectApiHost}/oauth-service/oauth/exchange/user/2.0`;
  const form: Record<string, string> = { audience: "GARMIN_CONNECT_MOBILE_ANDROID_DI" };
  if (oauth1.mfa_token) form.mfa_token = oauth1.mfa_token;
  const body = new URLSearchParams(form).toString();
  // OAuth1 signs the POST form params plus the consumer + resource-owner token.
  const auth = oauth1Header("POST", url, {
    consumer,
    token: { key: oauth1.oauth_token, secret: oauth1.oauth_token_secret },
    bodyParams: form
  });
  const resp = await fetchImpl(url, {
    method: "POST",
    headers: {
      "User-Agent": OAUTH_USER_AGENT,
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jar.header(url)
    },
    body
  });
  if (!resp.ok) {
    throw new Error(`Garmin OAuth2 exchange failed (HTTP ${resp.status}).`);
  }
  const json = await parseJson(resp);
  if (typeof json.access_token !== "string" || typeof json.refresh_token !== "string") {
    throw new Error("Garmin OAuth2 exchange response was missing access_token/refresh_token.");
  }
  void domain;
  return json as unknown as OAuth2Response;
}

export async function fetchConsumer(fetchImpl: typeof fetch): Promise<OAuthConsumer> {
  const resp = await fetchImpl(OAUTH_CONSUMER_URL);
  if (!resp.ok) throw new Error(`Could not fetch Garmin OAuth consumer (HTTP ${resp.status}).`);
  const json = await parseJson(resp);
  if (typeof json.consumer_key !== "string" || typeof json.consumer_secret !== "string") {
    throw new Error("Garmin OAuth consumer payload was malformed.");
  }
  return { consumer_key: json.consumer_key, consumer_secret: json.consumer_secret };
}

// --- OAuth1 (HMAC-SHA1, one-legged + token) signing -----------------------

interface Oauth1Options {
  consumer: OAuthConsumer;
  token?: { key: string; secret: string };
  bodyParams?: Record<string, string>;
}

export function oauth1Header(method: string, fullUrl: string, options: Oauth1Options): string {
  const url = new URL(fullUrl);
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: options.consumer.consumer_key,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0"
  };
  if (options.token) oauthParams.oauth_token = options.token.key;

  // Collect all params to sign: query string + oauth params + form body.
  const allParams: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => allParams.push([key, value]));
  for (const [key, value] of Object.entries(oauthParams)) allParams.push([key, value]);
  for (const [key, value] of Object.entries(options.bodyParams ?? {})) allParams.push([key, value]);

  const normalizedParams = allParams
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
  const signatureBase = [method.toUpperCase(), rfc3986(baseUrl), rfc3986(normalizedParams)].join("&");
  const signingKey = `${rfc3986(options.consumer.consumer_secret)}&${rfc3986(options.token?.secret ?? "")}`;
  const signature = createHmac("sha1", signingKey).update(signatureBase).digest("base64");

  const headerParams = { ...oauthParams, oauth_signature: signature };
  return (
    "OAuth " +
    Object.entries(headerParams)
      .map(([k, v]) => `${rfc3986(k)}="${rfc3986(v)}"`)
      .join(", ")
  );
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// --- Minimal cookie jar (global fetch has no jar) --------------------------

class CookieJar {
  private readonly cookies = new Map<string, string>();

  capture(response: Response): void {
    // Node's fetch exposes getSetCookie() (undici) for multiple Set-Cookie headers.
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : collectSetCookie(response.headers);
    for (const raw of setCookies) {
      const first = raw.split(";")[0];
      const eq = first.indexOf("=");
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  header(_url: string): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

function collectSetCookie(headers: Headers): string[] {
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

// --- HTTP helpers ----------------------------------------------------------

function ssoPageHeaders(): Record<string, string> {
  return {
    "User-Agent": SSO_PAGE_USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document"
  };
}

async function ssoFetch(
  fetchImpl: typeof fetch,
  jar: CookieJar,
  method: string,
  url: string,
  init: { headers: Record<string, string>; body?: string }
): Promise<Response> {
  const cookie = jar.header(url);
  const headers = cookie ? { ...init.headers, Cookie: cookie } : init.headers;
  const response = await fetchImpl(url, { method, headers, body: init.body });
  jar.capture(response);
  return response;
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) {
    if (!response.ok) throw new Error(`Garmin returned HTTP ${response.status} with an empty body.`);
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Garmin returned a non-JSON response (HTTP ${response.status}). Login may be blocked — try again from a browser-like network.`);
  }
}

function responseStatusType(json: Record<string, unknown>): string | undefined {
  const status = json.responseStatus as Record<string, unknown> | undefined;
  return typeof status?.type === "string" ? status.type : undefined;
}

function responseStatusDetail(json: Record<string, unknown>): string {
  const status = json.responseStatus as Record<string, unknown> | undefined;
  const type = typeof status?.type === "string" ? status.type : "UNKNOWN";
  const message = typeof status?.message === "string" ? status.message : "";
  return message ? `${type}: ${message}` : type;
}

function requireTicket(json: Record<string, unknown>): string {
  const ticket = json.serviceTicketId;
  if (typeof ticket !== "string" || !ticket) {
    throw new Error("Garmin login succeeded but no service ticket was returned.");
  }
  return ticket;
}

function extractClientIdFromJwt(token: string): string | undefined {
  try {
    const part = token.split(".")[1];
    if (!part) return undefined;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
    return typeof payload.client_id === "string" ? payload.client_id : undefined;
  } catch {
    return undefined;
  }
}
