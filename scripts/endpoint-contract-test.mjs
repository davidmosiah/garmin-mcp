import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GarminClient } from '../dist/services/garmin-client.js';

const dir = mkdtempSync(join(tmpdir(), 'garmin-mcp-endpoint-contract-'));
const tokenPath = join(dir, 'tokens.json');
writeFileSync(tokenPath, JSON.stringify({ di_token: 'synthetic-token' }), { mode: 0o600 });

const client = new GarminClient({
  tokenPath,
  cacheEnabled: false,
  cachePath: join(dir, 'cache.sqlite'),
  privacyMode: 'structured',
  domain: 'garmin.com'
});

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

  console.log(JSON.stringify({ ok: true, suite: 'endpoint-contracts', requests: requestedUrls.length }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  if (originalNoCache === undefined) delete process.env.GARMIN_NO_CACHE;
  else process.env.GARMIN_NO_CACHE = originalNoCache;
  rmSync(dir, { recursive: true, force: true });
}
