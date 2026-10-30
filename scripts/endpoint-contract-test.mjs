import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GarminClient } from '../dist/services/garmin-client.js';

const dir = mkdtempSync(join(tmpdir(), 'garmin-mcp-endpoint-contract-'));
const tokenPath = join(dir, 'tokens.json');
writeFileSync(tokenPath, JSON.stringify({ di_token: 'synthetic-token' }), { mode: 0o600 });

const config = {
  tokenPath,
  cacheEnabled: false,
  cachePath: join(dir, 'cache.sqlite'),
  privacyMode: 'structured',
  domain: 'garmin.com'
};
const client = new GarminClient(config);

const originalFetch = globalThis.fetch;
const originalNoCache = process.env.GARMIN_NO_CACHE;
const requestedUrls = [];
process.env.GARMIN_NO_CACHE = 'true';

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  requestedUrls.push(url);
  return Response.json([{ activityId: 1, activityName: 'Synthetic run' }]);
};

try {
  const failures = [];

  const result = await client.listActivities({
    after: '2026-07-08T23:00:00-03:00',
    before: '2026-07-15T23:00:00-03:00',
    limit: 25
  });
  const activityUrl = requestedUrls.at(-1);
  try {
    assert.equal(activityUrl.searchParams.get('startDate'), '2026-07-08');
    assert.equal(activityUrl.searchParams.get('endDate'), '2026-07-15');
    assert.equal(activityUrl.searchParams.get('start'), '0');
    assert.equal(activityUrl.searchParams.get('limit'), '25');
    assert.equal(result.records[0].activityId, 1);
  } catch (error) {
    failures.push(error);
  }

  const fetchCountBeforeInvalid = requestedUrls.length;
  try {
    await assert.rejects(
      client.listActivities({ after: 'not-a-date' }),
      /Invalid Garmin date range value/
    );
    assert.equal(requestedUrls.length, fetchCountBeforeInvalid, 'invalid dates must fail before an HTTP request');
  } catch (error) {
    failures.push(error);
  }

  if (failures.length) throw new AggregateError(failures, 'Garmin endpoint contract regressions');

  // Exercise the real authenticated request path; cache operations are a generic
  // method+URL Map double. No SQLite constructor, token refresh or network runs.
  const persistentCases = [
    { name: 'initial success', cacheEnabled: true, outcome: 'success' },
    { name: 'cookie success', cacheEnabled: true, cookie: true, outcome: 'success' },
    { name: 'cookie HTTP error', cacheEnabled: true, cookie: true, outcome: 'http' },
    { name: 'refreshed success', cacheEnabled: true, refresh: true, outcome: 'success' },
    { name: 'initial HTTP error', cacheEnabled: true, outcome: 'http' },
    { name: 'refreshed HTTP error', cacheEnabled: true, refresh: true, outcome: 'http' },
    { name: 'same credential HTTP error', cacheEnabled: true, sameCredential: true, outcome: 'http' },
    { name: 'disabled cache HTTP error', cacheEnabled: false, outcome: 'http' },
    { name: 'transport error', cacheEnabled: true, outcome: 'transport' },
    { name: 'response read error', cacheEnabled: true, outcome: 'read' },
  ];
  for (const scenario of persistentCases) {
    const scoped = new GarminClient({ ...config, cacheEnabled: scenario.cacheEnabled });
    const url = 'https://connectapi.garmin.com/userprofile-service/userprofile/personal-information';
    const key = `GET ${url}`;
    const stale = { marker: 'synthetic-existing-cache-entry' };
    const cached = new Map([[key, stale]]);
    const calls = { opens: 0, gets: 0, sets: 0, refreshes: 0, requests: [] };
    const storage = {
      get(method, requestUrl) { calls.gets++; return cached.get(`${method} ${requestUrl}`); },
      set(method, requestUrl, payload) { calls.sets++; cached.set(`${method} ${requestUrl}`, payload); },
      status() { return { enabled: true, path: 'synthetic-cache.sqlite', entries: cached.size }; },
    };
    scoped.getCache = () => { calls.opens++; return storage; };
    let credential = 'synthetic-A';
    scoped.getValidToken = async () => (scenario.cookie ? { jwt_web: credential } : { di_token: credential, di_refresh_token: 'synthetic-refresh', di_client_id: 'synthetic-client' });
    scoped.refreshToken = async () => { calls.refreshes++; return { di_token: 'synthetic-refreshed' }; };
    const error = new Error(`synthetic ${scenario.outcome} failure`);
    let phase = 'first';
    scoped.fetchWithRetry = async (requestUrl, init) => {
      calls.requests.push({ url: requestUrl, authorization: new Headers(init.headers).get(scenario.cookie ? 'Cookie' : 'Authorization') });
      if (phase === 'first') return Response.json({ marker: 'synthetic-fresh-A' });
      if (scenario.refresh && calls.refreshes === 0) return new Response('', { status: 401 });
      if (scenario.outcome === 'transport') throw error;
      if (scenario.outcome === 'read') {
        const response = new Response('', { status: 200 });
        response.text = async () => { throw error; };
        return response;
      }
      if (scenario.outcome === 'http') return Response.json({ message: 'synthetic unavailable' }, { status: 503 });
      return Response.json({ marker: 'synthetic-fresh-B' });
    };
    assert.deepEqual(await scoped.get('/userprofile-service/userprofile/personal-information'), { marker: 'synthetic-fresh-A' }, scenario.name);
    phase = 'second';
    if (!scenario.sameCredential) credential = 'synthetic-B';
    if (scenario.outcome === 'success') {
      assert.deepEqual(await scoped.get('/userprofile-service/userprofile/personal-information'), { marker: 'synthetic-fresh-B' }, scenario.name);
    } else if (scenario.outcome === 'http') {
      await assert.rejects(() => scoped.get('/userprofile-service/userprofile/personal-information'), /Garmin Connect API HTTP 503/, scenario.name);
    } else {
      await assert.rejects(() => scoped.get('/userprofile-service/userprofile/personal-information'), observed => observed === error, scenario.name);
    }
    assert.equal(calls.opens, 0, `${scenario.name}: authenticated payloads must not open persistent cache`);
    assert.equal(calls.gets, 0, `${scenario.name}: authenticated errors must not read fallback`);
    assert.equal(calls.sets, 0, `${scenario.name}: authenticated successes must not persist payloads`);
    assert.deepEqual([...cached.entries()], [[key, stale]], `${scenario.name}: existing cache entries stay untouched`);
    assert.equal((await scoped.cacheStatus()).enabled, false, `${scenario.name}: cache status must not report a persistent cache that authenticated reads never use`);
    assert.equal(calls.opens, 0, `${scenario.name}: cache status must not open persistent cache`);
    assert.equal(calls.refreshes, scenario.refresh ? 1 : 0, scenario.name);
    assert.deepEqual(calls.requests.map(r => r.url), Array(scenario.refresh ? 3 : 2).fill(url), scenario.name);
    assert.deepEqual(calls.requests.map(r => r.authorization), [
      scenario.cookie ? 'JWT_WEB=synthetic-A' : 'Bearer synthetic-A',
      scenario.cookie ? 'JWT_WEB=synthetic-B' : scenario.sameCredential ? 'Bearer synthetic-A' : 'Bearer synthetic-B',
      ...(scenario.refresh ? ['Bearer synthetic-refreshed'] : []),
    ], scenario.name);
  }
  console.log(JSON.stringify({ ok: true, suite: 'endpoint-contracts', requests: requestedUrls.length, persistent_cases: persistentCases.length }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  if (originalNoCache === undefined) delete process.env.GARMIN_NO_CACHE;
  else process.env.GARMIN_NO_CACHE = originalNoCache;
  rmSync(dir, { recursive: true, force: true });
}
