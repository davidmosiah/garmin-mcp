import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Re-implement the shipped formula from garmin-client listActivities return
// to lock the regression without live Garmin. The dist client is integration-tested
// elsewhere; this asserts the page arithmetic class (startPage + pages).
function nextPage({ startPage, pages, recordsLen, limit }) {
  return recordsLen && recordsLen % limit === 0 ? startPage + pages : undefined;
}

assert.equal(nextPage({ startPage: 1, pages: 1, recordsLen: 20, limit: 20 }), 2, 'full first page → page 2');
assert.equal(nextPage({ startPage: 1, pages: 1, recordsLen: 7, limit: 20 }), undefined, 'partial → no more');
assert.equal(nextPage({ startPage: 2, pages: 1, recordsLen: 20, limit: 20 }), 3, 'full page 2 → page 3');
// Old buggy formula would return 1 when start offset stayed 0:
const start = 0, limit = 20, pages = 1, recordsLen = 20;
const buggy = Math.floor(start / limit) + 1;
assert.equal(buggy, 1, 'document old bug');
assert.notEqual(nextPage({ startPage: 1, pages, recordsLen, limit }), buggy);

// Also verify shipped source contains the fixed expression (structural gate)
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/services/garmin-client.ts', import.meta.url), 'utf8');
assert.match(src, /startPage \+ pages/, 'shipped source uses startPage + pages');
assert.doesNotMatch(src, /Math\.floor\(start \/ limit\) \+ 1/, 'old offset formula removed');

console.log(JSON.stringify({ ok: true, suite: 'pagination-next-page' }, null, 2));
