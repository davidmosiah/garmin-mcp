import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPrivacyAudit } from '../dist/services/audit.js';
import { GarminCache } from '../dist/services/cache.js';
import { applyPrivacy, normalizeStreams } from '../dist/services/privacy.js';
import { redactErrorMessage, redactSensitive } from '../dist/services/redaction.js';

const activity = {
  id: 123,
  name: 'Morning Ride',
  activityName: 'Ride',
  distance: 42,
  activeDuration: 5400000,
  start_latlng: [40.1, -73.1],
  map: { summary_polyline: 'encoded' },
  averageHeartRate: 142
};

const structured = applyPrivacy('/activities/123', activity, 'structured');
assert.equal(structured.id, 123);
assert.equal(structured.averageHeartRate, 142);
assert.equal(structured.start_latlng, undefined);
assert.equal(structured.map, undefined);

const summary = applyPrivacy('/activities/123', activity, 'summary');
assert.equal(summary.distance, 42);
assert.equal(summary.averageHeartRate, 142);
assert.equal(summary.map, undefined);

const raw = applyPrivacy('/activities/123', activity, 'raw');
assert.equal(raw.map.summary_polyline, 'encoded');

const structuredCollision = applyPrivacy('/activities/123', {
  activityId: 456,
  activityName: 'Collision fixture',
  averageHR: null,
  averageHeartRate: 142,
  futureMetrics: { stamina: 73 }
}, 'structured');
assert.equal(structuredCollision.averageHR, null, 'structured mode must not replace an upstream field with a normalized fallback');
assert.equal(structuredCollision.averageHeartRate, 142);
assert.deepEqual(structuredCollision.futureMetrics, { stamina: 73 });

const streams = normalizeStreams({ heartrate: { data: [120, 121] }, latlng: { data: [[1, 2]] } }, 'structured', false);
assert.equal(streams.latlng, undefined);
assert.deepEqual(streams.heartrate.data, [120, 121]);

// Nested GPS must not survive structured mode (recursive redaction).
const nested = applyPrivacy('/activity-service/activity/99/details', {
  activityId: 99,
  averageHeartRate: 130,
  geo: {
    startLatitude: 1.2,
    startLongitude: 3.4,
    label: 'keep-me',
  },
  track: {
    points: [
      { latitude: 10, longitude: 20, elev: 100 },
      { latitude: 11, longitude: 21, elev: 110 },
    ],
  },
  map: { summary_polyline: 'secret-route', color: 'blue' },
}, 'structured');
assert.equal(nested.averageHeartRate, 130);
assert.equal(nested.map, undefined, 'map key is GPS-class and must be dropped entirely');
assert.equal(nested.geo?.startLatitude, undefined);
assert.equal(nested.geo?.startLongitude, undefined);
assert.equal(nested.geo?.label, 'keep-me');
assert.equal(nested.track?.points?.[0]?.latitude, undefined);
assert.equal(nested.track?.points?.[0]?.longitude, undefined);
assert.equal(nested.track?.points?.[0]?.elev, 100);
assert.equal(nested.track?.points?.[1]?.elev, 110);

assert.equal(redactSensitive({ access_token: 'abc', nested: { client_secret: 'def' } }).access_token, '[REDACTED]');
assert.match(redactErrorMessage('Authorization: Bearer abc.def.ghi'), /REDACTED/);
assert.equal(buildPrivacyAudit().unofficial, true);
assert.equal(buildPrivacyAudit().gps_redaction_default, true);

const dir = mkdtempSync(join(tmpdir(), 'Garmin MCP-cache-'));
try {
  const path = join(dir, 'cache.sqlite');
  const cache = new GarminCache(path);
  cache.set('GET', 'https://example.com/a', { ok: true });
  assert.deepEqual(cache.get('GET', 'https://example.com/a'), { ok: true });
  assert.equal(cache.status().entries, 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, privacy: true, cache: true, redaction: true, audit: true }, null, 2));
