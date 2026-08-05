/**
 * Contract gate for the ```json blocks published in the docs.
 *
 * README.md and examples/auth-quickstart.md are the first thing a human reads,
 * and examples/auth-quickstart.md claims every block is "captured from the
 * actual CLI". Nothing verified that claim, so the `doctor --json` example had
 * silently lost `required_env`, `missing_env` and the whole `config` object.
 *
 * This gate extracts the fenced blocks FROM THE MARKDOWN ITSELF (copying them
 * into this file would just recreate the drift one layer up), classifies each
 * one, and checks it against reality:
 *
 *   - config blocks   -> deep-equal against the config the real `setup` writes
 *   - payload blocks  -> key paths compared against the real producer, failing
 *                        in both directions:
 *                          a key in the doc the CLI never emits -> invented
 *                          a key the CLI emits the doc omits    -> incomplete
 *
 * The block registry below is exhaustive per file: a new ```json block that
 * nobody classified fails this gate instead of shipping unchecked.
 *
 * Everything here runs against synthetic tokens in a throwaway HOME. No real
 * Garmin account, no real health data.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAuthSuccessPayload } from '../dist/cli/auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const entry = path.join(repo, 'dist', 'index.js');

/**
 * Every ```json block published in these files, in document order.
 *
 * kind: 'config'  -> MCP client configuration. Not tool/CLI output; checked
 *                    against what `setup` actually writes.
 * kind: 'payload' -> something the code prints. Checked field by field.
 */
const EXPECTED_BLOCKS = {
  'README.md': [{ kind: 'config', label: 'MCP client config snippet' }],
  'examples/auth-quickstart.md': [
    { kind: 'payload', label: 'auth --json (success)', producer: 'auth_json' },
    { kind: 'payload', label: 'doctor --json (ready)', producer: 'doctor_json' }
  ]
};

/** A throwaway JWT with an `exp` claim, so `token.expired` is exercised. */
function syntheticJwt() {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${head}.${body}.not-a-real-signature`;
}

function extractJsonBlocks(relativePath) {
  const text = readFileSync(path.join(repo, relativePath), 'utf8');
  const lines = text.split('\n');
  const blocks = [];
  let buffer = null;
  let startLine = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (buffer === null) {
      if (line.trim() === '```json') {
        buffer = [];
        startLine = index + 1;
      }
      continue;
    }
    if (line.trim() === '```') {
      blocks.push({ line: startLine, raw: buffer.join('\n') });
      buffer = null;
      continue;
    }
    buffer.push(line);
  }
  assert.equal(buffer, null, `${relativePath}: unterminated \`\`\`json block`);
  return blocks;
}

function keyPaths(value, prefix = '', out = new Set()) {
  if (Array.isArray(value)) {
    // Union across elements: either element alone under-describes the shape.
    for (const item of value) keyPaths(item, `${prefix}[]`, out);
    return out;
  }
  if (value === null || typeof value !== 'object') return out;
  for (const key of Object.keys(value)) {
    const p = prefix ? `${prefix}.${key}` : key;
    out.add(p);
    keyPaths(value[key], p, out);
  }
  return out;
}

/**
 * Keys the CLI only emits in a path the documented journey does not take. Each
 * entry needs a reason. Deliberately narrow: adding a key here to silence the
 * gate defeats the gate.
 */
const OPTIONAL_IN_REAL = new Map([
  // `auth --json` copies display_name out of the token file. The built-in Node
  // login never writes one; only the legacy `--use-python` helper does. Proven
  // by the display_name assertion further down rather than assumed here.
  ['display_name', 'only the legacy Python helper writes display_name into the token file']
]);

function compare(label, docValue, realValue) {
  // Round-trip the real payload: `undefined` fields are dropped on print, so
  // this is the shape a reader of the docs actually sees.
  const real = JSON.parse(JSON.stringify(realValue));
  const docSet = keyPaths(docValue);
  const realSet = keyPaths(real);
  const invented = [...docSet].filter((k) => !realSet.has(k)).sort();
  const missing = [...realSet].filter((k) => !docSet.has(k) && !OPTIONAL_IN_REAL.has(k)).sort();
  const lines = [];
  if (invented.length > 0) {
    lines.push(
      `\n  ${label}: ${invented.length} key(s) in the doc that the CLI NEVER prints.`,
      '  A reader trusting these parses for data that never arrives:',
      ...invented.map((k) => `    - ${k}`)
    );
  }
  if (missing.length > 0) {
    lines.push(
      `\n  ${label}: ${missing.length} key(s) the CLI prints but the doc omits.`,
      '  Readers of the doc will not know these exist:',
      ...missing.map((k) => `    + ${k}`)
    );
  }
  return { report: lines.join('\n'), ok: lines.length === 0, checked: docSet.size };
}

const home = mkdtempSync(path.join(tmpdir(), 'garmin-docs-contract-'));
const failures = [];
let checked = 0;

try {
  // ---- reality: the config `setup` writes -----------------------------------
  const setup = spawnSync(process.execPath, [entry, 'setup', '--no-auth', '--client', 'claude'], {
    encoding: 'utf8',
    cwd: repo,
    env: { PATH: process.env.PATH, HOME: home }
  });
  assert.equal(setup.status, 0, `setup failed: ${setup.stderr || setup.stdout}`);
  const writtenConfigPath = process.platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    : path.join(home, '.garmin-mcp', 'mcp-configs', 'claude-desktop.json');
  const realConfig = JSON.parse(readFileSync(writtenConfigPath, 'utf8'));

  // ---- reality: `auth --json` on a native-login token file ------------------
  const tokenPath = path.join(home, '.garmin-mcp', 'garmin_tokens.json');
  writeFileSync(
    tokenPath,
    JSON.stringify({ di_token: syntheticJwt(), di_refresh_token: 'synthetic-refresh', di_client_id: 'synthetic-client' }),
    { mode: 0o600 }
  );
  chmodSync(tokenPath, 0o600);
  const realAuthJson = buildAuthSuccessPayload(tokenPath);

  // ---- reality: `doctor --json` after setup + auth --------------------------
  const doctor = spawnSync(process.execPath, [entry, 'doctor', '--json'], {
    encoding: 'utf8',
    cwd: repo,
    env: { PATH: process.env.PATH, HOME: home }
  });
  assert.equal(doctor.status, 0, `doctor failed: ${doctor.stderr || doctor.stdout}`);
  const realDoctorJson = JSON.parse(doctor.stdout);
  assert.equal(realDoctorJson.ok, true, 'the documented journey must reach a READY doctor');

  const producers = { auth_json: realAuthJson, doctor_json: realDoctorJson };

  for (const [file, expected] of Object.entries(EXPECTED_BLOCKS)) {
    const blocks = extractJsonBlocks(file);
    assert.equal(
      blocks.length,
      expected.length,
      `${file}: found ${blocks.length} \`\`\`json block(s) but ${expected.length} are classified in EXPECTED_BLOCKS. ` +
        'Classify the new block as config or payload — an unclassified payload block is exactly the drift this gate exists to catch.'
    );

    blocks.forEach((block, index) => {
      const spec = expected[index];
      let parsed;
      try {
        parsed = JSON.parse(block.raw);
      } catch (error) {
        assert.fail(`${file}:${block.line} (${spec.label}) is not valid JSON: ${error.message}`);
      }

      if (spec.kind === 'config') {
        // Not CLI output, so no field-by-field payload contract applies — but it
        // must still be the config `setup` really writes.
        assert.ok(parsed.mcpServers, `${file}:${block.line} is classified as config but has no "mcpServers" key`);
        assert.deepEqual(
          parsed,
          realConfig,
          `${file}:${block.line} (${spec.label}) does not match the config \`setup\` writes to ${writtenConfigPath}`
        );
        checked += keyPaths(parsed).size;
        console.log(`PASS ${file}:${block.line} ${spec.label} — matches the config setup writes`);
        return;
      }

      const real = producers[spec.producer];
      assert.ok(real, `no producer wired for ${spec.producer}`);
      const result = compare(`${file}:${block.line} ${spec.label}`, parsed, real);
      checked += result.checked;
      if (result.ok) {
        console.log(`PASS ${file}:${block.line} ${spec.label} — ${result.checked} key paths match the real CLI output`);
      } else {
        failures.push(result.report);
      }
    });
  }

  // ---- values the docs quote verbatim from code ------------------------------
  const [authDoc, doctorDoc] = extractJsonBlocks('examples/auth-quickstart.md').map((b) => JSON.parse(b.raw));
  assert.equal(authDoc.ok, realAuthJson.ok, 'auth --json example: `ok` differs from the real payload');
  assert.equal(authDoc.permissions, realAuthJson.permissions, 'auth --json example: token permissions differ from what the CLI reports');
  assert.equal(authDoc.next_step, realAuthJson.next_step, 'auth --json example: `next_step` wording drifted from src/cli/auth.ts');
  assert.equal(doctorDoc.privacy_mode, realDoctorJson.privacy_mode, 'doctor --json example: default privacy_mode drifted');
  assert.equal(doctorDoc.config.source, realDoctorJson.config.source, 'doctor --json example: config.source drifted');
  assert.deepEqual(doctorDoc.next_steps, realDoctorJson.next_steps, 'doctor --json example: `next_steps` wording drifted from src/services/connection-status.ts');
  console.log('PASS quoted values match the strings the code owns');

  // ---- prove the one documented-optional key really is optional -------------
  const namedTokenPath = path.join(home, '.garmin-mcp', 'garmin_tokens_named.json');
  writeFileSync(
    namedTokenPath,
    JSON.stringify({ di_token: syntheticJwt(), di_refresh_token: 'synthetic-refresh', display_name: 'synthetic-user' }),
    { mode: 0o600 }
  );
  chmodSync(namedTokenPath, 0o600);
  const namedPaths = keyPaths(JSON.parse(JSON.stringify(buildAuthSuccessPayload(namedTokenPath))));
  const basePaths = keyPaths(JSON.parse(JSON.stringify(realAuthJson)));
  const extra = [...namedPaths].filter((k) => !basePaths.has(k));
  assert.deepEqual(
    extra,
    ['display_name'],
    'a token file carrying display_name must add exactly that one key; OPTIONAL_IN_REAL is otherwise lying'
  );
  console.log('PASS display_name is the only conditional key in auth --json');

  // ---- the docs must not teach agents to expect secrets ----------------------
  for (const file of Object.keys(EXPECTED_BLOCKS)) {
    for (const block of extractJsonBlocks(file)) {
      const lowered = block.raw.toLowerCase();
      for (const needle of ['di_token"', 'password', 'refresh_token"', 'latitude', 'longitude']) {
        assert.ok(!lowered.includes(needle), `${file}:${block.line} must not publish "${needle}"`);
      }
    }
  }
  console.log('PASS published blocks carry no secrets or coordinates');
} finally {
  rmSync(home, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('\nFAIL published JSON examples drifted from the real CLI output:');
  console.error(failures.join('\n'));
  console.error(
    '\nFix the markdown so the examples match what the CLI prints.' +
      '\nDo not widen OPTIONAL_IN_REAL to silence this — that is how the drift got here.\n'
  );
  process.exit(1);
}

console.log(`\ndocs-payload-contract: ${checked} key paths verified against the real CLI output`);
console.log(JSON.stringify({ ok: true, suite: 'docs-payload-contract', files: Object.keys(EXPECTED_BLOCKS).length }));
