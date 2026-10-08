import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_GARMIN_DOMAIN,
  GARMIN_SSO_CLIENT_ID,
  garminHosts,
  parseExplicitGarminDomain,
  resolveGarminDomain,
  resolveGarminDomainWithSource
} from '../dist/services/garmin-region.js';
import { parseAuthRegionFlags as parseAuthFlags } from '../dist/cli/auth.js';
import { nativeGarminLogin } from '../dist/cli/garmin-login.js';
import { GarminClient } from '../dist/services/garmin-client.js';
import { buildConnectionStatus } from '../dist/services/connection-status.js';
import { GARMIN_CONNECT_API_BASE_URL, GARMIN_DI_TOKEN_URL } from '../dist/constants.js';

function fakeAccessJwt(clientId, expOffsetSeconds = 3600) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    client_id: clientId,
    exp: Math.floor(Date.now() / 1000) + expOffsetSeconds
  })).toString('base64url');
  return `${header}.${payload}.sig`;
}

const CONSUMER = { consumer_key: 'fake-consumer-key', consumer_secret: 'fake-consumer-secret' };

function mockLoginFetch() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: (init.method || 'GET').toUpperCase() });
    const u = String(url);
    if (u.includes('/sso/mobile/sso/en/sign-in')) return new Response('', { status: 200 });
    if (u.includes('/sso/mobile/api/login')) {
      return new Response(JSON.stringify({ responseStatus: { type: 'SUCCESSFUL' }, serviceTicketId: 'ST-OK' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (u.includes('/oauth-service/oauth/preauthorized')) {
      return new Response('oauth_token=ot-xyz&oauth_token_secret=ots-abc', { status: 200 });
    }
    if (u.includes('/oauth-service/oauth/exchange/user/2.0')) {
      return new Response(JSON.stringify({ access_token: fakeAccessJwt('exchange-client'), refresh_token: 'rt-final' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return { fetchImpl, calls };
}

// ---- 1. Host templates match python-garminconnect / garth --------------------
{
  const intl = garminHosts('garmin.com');
  assert.equal(intl.sso, 'https://sso.garmin.com');
  assert.equal(intl.connect, 'https://connect.garmin.com');
  assert.equal(intl.connectApi, 'https://connectapi.garmin.com');
  assert.equal(intl.diTokenUrl, 'https://diauth.garmin.com/di-oauth2-service/oauth/token');
  assert.equal(intl.mobileAndroidServiceUrl, 'https://mobile.integration.garmin.com/gcm/android');
  assert.equal(intl.connectModernUrl, 'https://connect.garmin.com/modern/');
  assert.equal(intl.diBackend, 'connectapi.garmin.com');
  assert.equal(intl.connectApi, GARMIN_CONNECT_API_BASE_URL);
  assert.equal(intl.diTokenUrl, GARMIN_DI_TOKEN_URL);

  const cn = garminHosts('garmin.cn');
  assert.equal(cn.sso, 'https://sso.garmin.cn');
  assert.equal(cn.connect, 'https://connect.garmin.cn');
  assert.equal(cn.connectApi, 'https://connectapi.garmin.cn');
  assert.equal(cn.diTokenUrl, 'https://diauth.garmin.cn/di-oauth2-service/oauth/token');
  assert.equal(cn.mobileAndroidServiceUrl, 'https://mobile.integration.garmin.cn/gcm/android');
  assert.equal(cn.connectModernUrl, 'https://connect.garmin.cn/modern/');
  assert.equal(cn.diBackend, 'connectapi.garmin.cn');
  assert.equal(GARMIN_SSO_CLIENT_ID, 'GCM_ANDROID_DARK');
  assert.equal(garminHosts().domain, DEFAULT_GARMIN_DOMAIN);
}

// ---- 2. Config aliases and precedence ---------------------------------------
{
  assert.equal(parseExplicitGarminDomain(undefined, undefined), undefined);
  assert.equal(parseExplicitGarminDomain('garmin.cn'), 'garmin.cn');
  assert.equal(parseExplicitGarminDomain('cn'), 'garmin.cn');
  assert.equal(parseExplicitGarminDomain('garmin.com'), 'garmin.com');
  assert.equal(parseExplicitGarminDomain(undefined, 'true'), 'garmin.cn');
  assert.equal(parseExplicitGarminDomain(undefined, 'false'), 'garmin.com');
  assert.equal(parseExplicitGarminDomain('garmin.com', 'true'), 'garmin.com', 'GARMIN_DOMAIN wins over GARMIN_IS_CN');
  assert.equal(parseExplicitGarminDomain('garmin.cn', 'false'), 'garmin.cn');

  assert.deepEqual(resolveGarminDomain({}), { domain: 'garmin.com', source: 'default', is_cn: false });
  assert.deepEqual(resolveGarminDomain({ tokenDomain: 'garmin.cn' }), { domain: 'garmin.cn', source: 'token', is_cn: true });
  assert.deepEqual(
    resolveGarminDomain({ explicit: 'garmin.com', tokenDomain: 'garmin.cn' }),
    { domain: 'garmin.com', source: 'env', is_cn: false },
    'env/explicit overrides token metadata'
  );
  assert.deepEqual(resolveGarminDomain({ isCn: true }), { domain: 'garmin.cn', source: 'env', is_cn: true });

  assert.equal(resolveGarminDomainWithSource({ tokenDomain: 'garmin.cn' }).source, 'token');
  assert.equal(resolveGarminDomainWithSource({ localDomain: 'garmin.cn', tokenDomain: 'garmin.com' }).source, 'local_config');
  assert.equal(resolveGarminDomainWithSource({ envDomain: 'garmin.com', localDomain: 'garmin.cn', tokenDomain: 'garmin.cn' }).domain, 'garmin.com');
  assert.equal(resolveGarminDomainWithSource({ envDomain: 'garmin.com', localDomain: 'garmin.cn', tokenDomain: 'garmin.cn' }).source, 'env');
  assert.equal(resolveGarminDomainWithSource({ envIsCn: 'true', tokenDomain: 'garmin.com' }).domain, 'garmin.cn');
}

// ---- 3. CLI flags -----------------------------------------------------------
{
  assert.equal(parseAuthFlags(['--cn']), 'garmin.cn');
  assert.equal(parseAuthFlags(['--domain', 'garmin.cn']), 'garmin.cn');
  assert.equal(parseAuthFlags(['--domain', 'cn']), 'garmin.cn');
  assert.equal(parseAuthFlags(['--domain', 'garmin.com', '--cn']), 'garmin.com', '--domain wins over --cn');
  assert.equal(parseAuthFlags(['--json']), undefined);
  assert.throws(() => parseAuthFlags(['--domain']), /Missing value for --domain/);
  assert.throws(() => parseAuthFlags(['--domain', 'garmin.co.uk']), /must be garmin.com or garmin.cn/);
}

// ---- 4. Native login URLs: default vs CN ------------------------------------
{
  const intl = mockLoginFetch();
  const intlTokens = await nativeGarminLogin(
    { email: 'a@b.com', password: 'pw' },
    { fetchImpl: intl.fetchImpl, getConsumer: async () => CONSUMER }
  );
  assert.ok(intl.calls.every((c) => c.url.includes('garmin.com') && !c.url.includes('garmin.cn')));
  assert.ok(intl.calls.some((c) => c.url.startsWith('https://sso.garmin.com/')));
  assert.ok(intl.calls.some((c) => c.url.startsWith('https://connectapi.garmin.com/')));
  assert.ok(intl.calls.some((c) => c.url.includes('mobile.integration.garmin.com')));
  assert.equal(intlTokens.domain, 'garmin.com');

  const cn = mockLoginFetch();
  const cnTokens = await nativeGarminLogin(
    { email: 'a@b.com', password: 'pw', domain: 'garmin.cn' },
    { fetchImpl: cn.fetchImpl, getConsumer: async () => CONSUMER }
  );
  assert.ok(cn.calls.every((c) => c.url.includes('garmin.cn') && !c.url.includes('garmin.com')));
  assert.ok(cn.calls.some((c) => c.url.startsWith('https://sso.garmin.cn/')));
  assert.ok(cn.calls.some((c) => c.url.includes('/sso/mobile/api/login')));
  assert.ok(cn.calls.some((c) => c.url.startsWith('https://connectapi.garmin.cn/oauth-service/oauth/preauthorized')));
  assert.ok(cn.calls.some((c) => c.url.startsWith('https://connectapi.garmin.cn/oauth-service/oauth/exchange/user/2.0')));
  assert.ok(cn.calls.some((c) => c.url.includes('mobile.integration.garmin.cn')));
  assert.equal(cnTokens.domain, 'garmin.cn');
}

// ---- 5. Client refresh + API hosts, token fallback, env override ------------
{
  const dir = mkdtempSync(join(tmpdir(), 'garmin-region-client-'));
  const originalFetch = globalThis.fetch;
  const originalNoCache = process.env.GARMIN_NO_CACHE;
  process.env.GARMIN_NO_CACHE = 'true';

  try {
    const tokenPath = join(dir, 'tokens.json');
    writeFileSync(tokenPath, JSON.stringify({
      di_token: fakeAccessJwt('android-client', -60),
      di_refresh_token: 'rt-cn',
      di_client_id: 'android-client',
      domain: 'garmin.cn'
    }), { mode: 0o600 });

    const calls = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, method: (init.method || 'GET').toUpperCase(), headers: init.headers || {} });
      if (url.includes('/di-oauth2-service/oauth/token')) {
        return Response.json({ access_token: fakeAccessJwt('android-client', 3600), refresh_token: 'rt-cn-2' });
      }
      return Response.json({ displayName: 'cn-user' });
    };

    const cnClient = new GarminClient({
      tokenPath,
      cacheEnabled: false,
      cachePath: join(dir, 'cache.sqlite'),
      privacyMode: 'structured'
    });
    await cnClient.get('/userprofile-service/socialProfile');
    const refresh = calls.find((c) => c.url.includes('/di-oauth2-service/oauth/token'));
    const api = calls.find((c) => c.url.includes('/userprofile-service/socialProfile'));
    assert.equal(refresh?.url, 'https://diauth.garmin.cn/di-oauth2-service/oauth/token');
    assert.ok(api?.url.startsWith('https://connectapi.garmin.cn/userprofile-service/socialProfile'));
    assert.ok(!calls.some((c) => c.url.includes('garmin.com')), 'CN token metadata must not hit garmin.com when env is unset');

    calls.length = 0;
    writeFileSync(tokenPath, JSON.stringify({
      di_token: fakeAccessJwt('android-client', -60),
      di_refresh_token: 'rt-cn',
      di_client_id: 'android-client',
      domain: 'garmin.cn'
    }), { mode: 0o600 });

    const overrideClient = new GarminClient({
      tokenPath,
      cacheEnabled: false,
      cachePath: join(dir, 'cache-override.sqlite'),
      privacyMode: 'structured',
      domain: 'garmin.com'
    });
    await overrideClient.get('/userprofile-service/socialProfile');
    assert.equal(
      calls.find((c) => c.url.includes('/di-oauth2-service/oauth/token'))?.url,
      'https://diauth.garmin.com/di-oauth2-service/oauth/token',
      'explicit GARMIN_DOMAIN must override token metadata on refresh'
    );
    assert.ok(calls.some((c) => c.url.startsWith('https://connectapi.garmin.com/')));
    assert.ok(!calls.some((c) => c.url.includes('garmin.cn')));

    calls.length = 0;
    writeFileSync(tokenPath, JSON.stringify({
      jwt_web: 'jwt-cookie',
      csrf_token: 'csrf',
      domain: 'garmin.cn'
    }), { mode: 0o600 });
    const jwtClient = new GarminClient({
      tokenPath,
      cacheEnabled: false,
      cachePath: join(dir, 'cache-jwt.sqlite'),
      privacyMode: 'structured'
    });
    await jwtClient.get('/userprofile-service/socialProfile');
    const jwtCall = calls.find((c) => c.url.includes('/userprofile-service/socialProfile'));
    assert.equal(jwtCall.headers.Origin, 'https://connect.garmin.cn');
    assert.equal(jwtCall.headers.Referer, 'https://connect.garmin.cn/modern/');
    assert.equal(jwtCall.headers['DI-Backend'], 'connectapi.garmin.cn');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNoCache === undefined) delete process.env.GARMIN_NO_CACHE;
    else process.env.GARMIN_NO_CACHE = originalNoCache;
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- 6. doctor / connection_status reports region ---------------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'garmin-region-status-'));
  try {
    const missing = await buildConnectionStatus({ env: {}, homeDir: dir, nowMs: 1_000_000 });
    assert.equal(missing.region.domain, 'garmin.com');
    assert.equal(missing.region.source, 'default');
    assert.equal(missing.region.is_cn, false);

    const tokenPath = join(dir, 'garmin_tokens.json');
    writeFileSync(tokenPath, JSON.stringify({
      di_token: 'not-a-jwt',
      di_refresh_token: 'refresh',
      di_client_id: 'client-id',
      domain: 'garmin.cn'
    }), { mode: 0o600 });

    const fromToken = await buildConnectionStatus({
      env: { GARMIN_TOKEN_PATH: tokenPath },
      homeDir: dir,
      nowMs: 1_000_000
    });
    assert.equal(fromToken.region.domain, 'garmin.cn');
    assert.equal(fromToken.region.source, 'token');
    assert.equal(fromToken.region.is_cn, true);
    assert.equal(fromToken.token.domain, 'garmin.cn');

    const envOverride = await buildConnectionStatus({
      env: { GARMIN_TOKEN_PATH: tokenPath, GARMIN_DOMAIN: 'garmin.com' },
      homeDir: dir,
      nowMs: 1_000_000
    });
    assert.equal(envOverride.region.domain, 'garmin.com');
    assert.equal(envOverride.region.source, 'env');
    assert.equal(envOverride.region.is_cn, false);

    const isCnAlias = await buildConnectionStatus({
      env: { GARMIN_TOKEN_PATH: tokenPath, GARMIN_IS_CN: 'true' },
      homeDir: dir,
      nowMs: 1_000_000
    });
    assert.equal(isCnAlias.region.domain, 'garmin.cn');
    assert.equal(isCnAlias.region.source, 'env');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  ok: true,
  suite: 'garmin-region',
  hosts: true,
  precedence: true,
  cli_flags: true,
  native_login: true,
  refresh: true,
  connection_status: true
}, null, 2));
