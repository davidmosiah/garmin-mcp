import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { nativeGarminLogin, oauth1Header, tokenSetFromOAuth2 } from '../dist/cli/garmin-login.js';

// A throwaway JWT carrying a client_id claim, so di_client_id extraction works.
function fakeAccessJwt(clientId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ client_id: clientId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${payload}.sig`;
}

const CONSUMER = { consumer_key: 'fake-consumer-key', consumer_secret: 'fake-consumer-secret' };

// ---- 1. OAuth1 signature is well-formed and verifiable -----------------------
{
  const url = 'https://connectapi.garmin.com/oauth-service/oauth/preauthorized?ticket=ST-1&accepts-mfa-tokens=true';
  const header = oauth1Header('GET', url, { consumer: CONSUMER });
  assert.match(header, /^OAuth /);
  assert.match(header, /oauth_consumer_key="fake-consumer-key"/);
  assert.match(header, /oauth_signature_method="HMAC-SHA1"/);
  assert.match(header, /oauth_signature="[^"]+"/);

  // Independently recompute the signature from the same base string to confirm correctness.
  const params = Object.fromEntries(
    header
      .slice('OAuth '.length)
      .split(', ')
      .map((kv) => {
        const eq = kv.indexOf('=');
        return [decodeURIComponent(kv.slice(0, eq)), decodeURIComponent(kv.slice(eq + 1).replace(/^"|"$/g, ''))];
      })
  );
  const sigFromHeader = params.oauth_signature;
  const toSign = { ...params };
  delete toSign.oauth_signature;
  // include query param "ticket" and "accepts-mfa-tokens"
  toSign.ticket = 'ST-1';
  toSign['accepts-mfa-tokens'] = 'true';
  const rfc = (s) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const normalized = Object.entries(toSign)
    .map(([k, v]) => [rfc(k), rfc(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const base = ['GET', rfc('https://connectapi.garmin.com/oauth-service/oauth/preauthorized'), rfc(normalized)].join('&');
  const expected = createHmac('sha1', `${rfc(CONSUMER.consumer_secret)}&`).update(base).digest('base64');
  assert.equal(sigFromHeader, expected, 'OAuth1 signature must match an independent recomputation');
}

// ---- 2. tokenSetFromOAuth2 maps fields to the connector's token shape --------
{
  const set = tokenSetFromOAuth2({ access_token: fakeAccessJwt('android-client'), refresh_token: 'rt-123', scope: 'connect' });
  assert.equal(set.di_refresh_token, 'rt-123');
  assert.equal(set.di_client_id, 'android-client');
  assert.ok(set.di_token);
  assert.ok(set.created_at);
}

// ---- 3. Full login happy path against a mocked Garmin (no real account) ------
function mockFetch(spec) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: (init.method || 'GET').toUpperCase(), headers: init.headers || {}, body: init.body });
    const u = String(url);
    if (u.includes('/sso/mobile/sso/en/sign-in')) {
      return new Response('', { status: 200, headers: { 'set-cookie': 'GARMIN-SSO=1; Path=/' } });
    }
    if (u.includes('/sso/mobile/api/login')) {
      return new Response(JSON.stringify(spec.login), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/sso/mobile/api/mfa/verifyCode')) {
      return new Response(JSON.stringify(spec.mfa), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/oauth-service/oauth/preauthorized')) {
      // OAuth1 token returned as urlencoded form
      return new Response('oauth_token=ot-xyz&oauth_token_secret=ots-abc&mfa_token=', { status: 200 });
    }
    if (u.includes('/oauth-service/oauth/exchange/user/2.0')) {
      return new Response(JSON.stringify({ access_token: fakeAccessJwt('exchange-client'), refresh_token: 'rt-final', scope: 'connect' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return { fetchImpl, calls };
}

{
  const { fetchImpl, calls } = mockFetch({
    login: { responseStatus: { type: 'SUCCESSFUL' }, serviceTicketId: 'ST-OK' }
  });
  const tokens = await nativeGarminLogin(
    { email: 'a@b.com', password: 'pw' },
    { fetchImpl, getConsumer: async () => CONSUMER }
  );
  assert.equal(tokens.di_refresh_token, 'rt-final');
  assert.equal(tokens.di_client_id, 'exchange-client');
  assert.ok(tokens.di_token);
  // Confirm the cookie set during sign-in was carried into the login POST.
  const loginCall = calls.find((c) => c.url.includes('/sso/mobile/api/login'));
  assert.ok(String(loginCall.headers.Cookie || '').includes('GARMIN-SSO=1'), 'login POST must send the SSO cookie');
  // Confirm the OAuth1 preauthorized + exchange were signed.
  const preauth = calls.find((c) => c.url.includes('preauthorized'));
  assert.match(preauth.headers.Authorization, /^OAuth /);
  const exchange = calls.find((c) => c.url.includes('exchange/user/2.0'));
  assert.match(exchange.headers.Authorization, /oauth_token="ot-xyz"/);
  assert.ok(String(exchange.body).includes('audience=GARMIN_CONNECT_MOBILE_ANDROID_DI'));
}

// ---- 4. MFA path prompts and completes ---------------------------------------
{
  const { fetchImpl } = mockFetch({
    login: { responseStatus: { type: 'MFA_REQUIRED' }, customerMfaInfo: { mfaLastMethodUsed: 'email' } },
    mfa: { responseStatus: { type: 'SUCCESSFUL' }, serviceTicketId: 'ST-MFA' }
  });
  let prompted = false;
  const tokens = await nativeGarminLogin(
    {
      email: 'a@b.com',
      password: 'pw',
      promptMfa: async () => {
        prompted = true;
        return '123456';
      }
    },
    { fetchImpl, getConsumer: async () => CONSUMER }
  );
  assert.equal(prompted, true, 'MFA prompt must be invoked');
  assert.equal(tokens.di_refresh_token, 'rt-final');
}

// ---- 5. Bad credentials raise a descriptive error ----------------------------
{
  const { fetchImpl } = mockFetch({
    login: { responseStatus: { type: 'INVALID_CREDENTIALS', message: 'bad password' } }
  });
  await assert.rejects(
    () => nativeGarminLogin({ email: 'a@b.com', password: 'wrong' }, { fetchImpl, getConsumer: async () => CONSUMER }),
    /Garmin login failed: INVALID_CREDENTIALS: bad password/
  );
}

// ---- 6. MFA required but no prompt provided -> clear error -------------------
{
  const { fetchImpl } = mockFetch({
    login: { responseStatus: { type: 'MFA_REQUIRED' }, customerMfaInfo: {} }
  });
  await assert.rejects(
    () => nativeGarminLogin({ email: 'a@b.com', password: 'pw' }, { fetchImpl, getConsumer: async () => CONSUMER }),
    /requires an MFA code/
  );
}

// ---- 7. CLI: auth --json without credentials fails cleanly (no Python) -------
{
  const dir = mkdtempSync(join(tmpdir(), 'garmin-native-auth-'));
  try {
    const res = spawnSync(process.execPath, ['dist/index.js', 'auth', '--json'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: dir }
    });
    assert.equal(res.status, 1);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /GARMIN_EMAIL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({ ok: true, oauth1_signing: true, token_mapping: true, full_login: true, mfa: true, errors: true, cli: true }, null, 2));
