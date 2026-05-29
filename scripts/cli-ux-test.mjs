import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildConnectionStatus } from '../dist/services/connection-status.js';

const dir = mkdtempSync(join(tmpdir(), 'Garmin MCP-cli-'));

try {
  const missing = await buildConnectionStatus({ env: {}, homeDir: dir, nowMs: 1_000_000 });
  assert.equal(missing.ok, false);
  assert.equal(missing.ready_for_garmin_api, false);
  assert.deepEqual(missing.missing_env, []);
  assert.ok(missing.next_steps.some((step) => step.includes('garmin-mcp-server auth')));
  assert.ok(missing.next_steps.some((step) => step.includes('no Python')));

  const tokenPath = join(dir, 'garmin_tokens.json');
  writeFileSync(tokenPath, JSON.stringify({
    di_token: 'not-a-jwt-but-valid-for-readiness-test',
    di_refresh_token: 'refresh',
    di_client_id: 'client-id',
    display_name: 'fixture-user'
  }), { mode: 0o600 });

  const ready = await buildConnectionStatus({
    env: {
      GARMIN_TOKEN_PATH: tokenPath,
      GARMIN_PRIVACY_MODE: 'summary',
      GARMIN_CACHE: 'sqlite'
    },
    homeDir: dir,
    nowMs: 1_000_000
  });
  assert.equal(ready.ok, true);
  assert.equal(ready.ready_for_garmin_api, true);
  assert.equal(ready.privacy_mode, 'summary');
  assert.equal(ready.cache.enabled, true);
  assert.equal(ready.token.exists, true);
  assert.equal(ready.token.secure_permissions, true);
  assert.equal(ready.token.has_refresh_token, true);
  assert.equal(ready.token.has_di_token, true);
  assert.equal(ready.oauth.scope_status, 'ok');

  const doctor = spawnSync(process.execPath, ['dist/index.js', 'doctor', '--json'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: dir
    }
  });
  assert.equal(doctor.status, 0, doctor.stderr);
  const doctorPayload = JSON.parse(doctor.stdout);
  assert.equal(doctorPayload.ok, false);
  assert.ok(doctorPayload.next_steps.some((step) => step.includes('garmin-mcp-server auth')));

  const typo = spawnSync(process.execPath, ['dist/index.js', 'docter'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: dir
    }
  });
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /Unknown command: docter/);

  // Native (default) auth in --json mode fails cleanly when credentials are absent,
  // without ever touching Python.
  const authNativeNoCreds = spawnSync(process.execPath, ['dist/index.js', 'auth', '--json'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: dir,
      PYTHON: '/bin/false'
    }
  });
  assert.equal(authNativeNoCreds.status, 1);
  const authNativePayload = JSON.parse(authNativeNoCreds.stdout);
  assert.equal(authNativePayload.ok, false);
  assert.match(authNativePayload.error, /GARMIN_EMAIL/);
  assert.doesNotMatch(authNativePayload.error, new RegExp('at .*dist/'));

  // Legacy Python helper path still reports a clean error when python is missing.
  const authPythonMissing = spawnSync(process.execPath, ['dist/index.js', 'auth', '--use-python', '--json'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: dir,
      PYTHON: '/bin/false'
    }
  });
  assert.equal(authPythonMissing.status, 1);
  const authPythonPayload = JSON.parse(authPythonMissing.stdout);
  assert.equal(authPythonPayload.ok, false);
  assert.doesNotMatch(authPythonPayload.error, new RegExp('at .*dist/'));

  const setup = spawnSync(process.execPath, [
    'dist/index.js',
    'setup',
    '--client',
    'generic',
    '--privacy-mode',
    'summary',
    '--cache',
    'sqlite',
    '--token-path',
    tokenPath,
    '--no-auth',
    '--json'
  ], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: dir
    }
  });
  assert.equal(setup.status, 0, setup.stderr);
  const setupPayload = JSON.parse(setup.stdout);
  assert.equal(setupPayload.ok, true);
  assert.equal(setupPayload.auth_started, false);
  assert.match(setupPayload.next_step, /garmin-mcp-server auth/);
  assert.match(setupPayload.config_path, /config\.json$/);
  assert.match(setupPayload.client_config_path, /generic\.json$/);

  const configPath = join(dir, '.garmin-mcp', 'config.json');
  const configMode = (statSync(configPath).mode & 0o777).toString(8);
  assert.equal(configMode, '600');
  const savedConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(savedConfig.GARMIN_TOKEN_PATH, tokenPath);
  assert.equal(savedConfig.GARMIN_PRIVACY_MODE, 'summary');
  assert.equal(savedConfig.GARMIN_CACHE, 'sqlite');
  assert.equal(savedConfig.GARMIN_CLIENT_SECRET, undefined);

  const doctorAfterSetup = spawnSync(process.execPath, ['dist/index.js', 'doctor', '--json'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: dir
    }
  });
  assert.equal(doctorAfterSetup.status, 0, doctorAfterSetup.stderr);
  const doctorAfterSetupPayload = JSON.parse(doctorAfterSetup.stdout);
  assert.deepEqual(doctorAfterSetupPayload.missing_env, []);
  assert.equal(doctorAfterSetupPayload.config.source, 'local_config');
  assert.equal(doctorAfterSetupPayload.automatic_auth_supported, true);

  console.log(JSON.stringify({ ok: true, cli_ux: true, doctor: true, status: true, auth_plan: true, setup: true }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
