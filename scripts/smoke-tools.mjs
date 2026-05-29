import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const expectedTools = [
  'garmin_agent_manifest', 'garmin_auth_instructions', 'garmin_cache_status', 'garmin_capabilities',
  'garmin_connection_status', 'garmin_daily_summary', 'garmin_data_inventory', 'garmin_demo',
  'garmin_disconnect_local', 'garmin_get_activity', 'garmin_get_activity_details', 'garmin_get_activity_hr_zones',
  'garmin_get_activity_splits', 'garmin_get_activity_weather', 'garmin_get_body_battery_day',
  'garmin_get_body_battery_events', 'garmin_get_daily_summary', 'garmin_get_heart_day', 'garmin_get_hrv_day',
  'garmin_get_hydration_day', 'garmin_get_intensity_minutes_day', 'garmin_get_primary_training_device',
  'garmin_get_profile', 'garmin_get_respiration_day', 'garmin_get_sleep_day', 'garmin_get_spo2_day',
  'garmin_get_steps_day', 'garmin_get_stress_day', 'garmin_get_training_readiness_day',
  'garmin_get_training_status_day', 'garmin_get_user_settings', 'garmin_get_weight_range', 'garmin_list_activities',
  'garmin_list_devices', 'garmin_onboarding', 'garmin_privacy_audit', 'garmin_profile_get',
  'garmin_profile_update', 'garmin_quickstart', 'garmin_weekly_summary', 'garmin_wellness_context'
];

const expectedResources = [
  'garmin://agent-manifest', 'garmin://capabilities', 'garmin://inventory', 'garmin://latest/activity',
  'garmin://profile', 'garmin://summary/daily', 'garmin://summary/weekly'
];
const expectedPrompts = ['garmin_daily_checkin', 'garmin_intraday_investigation', 'garmin_weekly_review'];
const expectedDocsUrl = 'https://garminconnectmcp.vercel.app/';
const home = mkdtempSync(join(tmpdir(), 'Garmin MCP-smoke-home-'));

const client = new Client({ name: 'Garmin MCP-smoke-test', version: '0.0.0' });
const transport = new StdioClientTransport({ command: 'node', args: ['dist/index.js'], env: { ...process.env, HOME: home } });
await client.connect(transport);
try {
  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, expectedTools.sort());

  const resources = await client.listResources();
  const resourceUris = resources.resources.map((resource) => resource.uri).sort();
  assert.deepEqual(resourceUris, expectedResources.sort());

  const prompts = await client.listPrompts();
  const promptNames = prompts.prompts.map((prompt) => prompt.name).sort();
  assert.deepEqual(promptNames, expectedPrompts.sort());

  const prompt = await client.getPrompt({ name: 'garmin_daily_checkin', arguments: { focus: 'sleep' } });
  assert.ok(prompt.messages[0]?.content?.type === 'text');

  const auditResult = await client.callTool({ name: 'garmin_privacy_audit', arguments: { response_format: 'json' } });
  assert.equal(auditResult.structuredContent?.unofficial, true);
  assert.ok(auditResult.structuredContent?.secret_env_vars?.includes('GARMIN_PASSWORD'));

  const capabilitiesResult = await client.callTool({ name: 'garmin_capabilities', arguments: { response_format: 'json' } });
  assert.equal(capabilitiesResult.structuredContent?.unofficial, true);
  assert.equal(capabilitiesResult.structuredContent?.links?.docs, expectedDocsUrl);
  assert.ok(capabilitiesResult.structuredContent?.api_boundary?.does_not_include?.includes('raw accelerometer or gyroscope telemetry'));
  assert.ok(capabilitiesResult.structuredContent?.recommended_agent_flow?.some((step) => step.includes('garmin_connection_status')));

  const authResult = await client.callTool({ name: 'garmin_auth_instructions', arguments: { response_format: 'json' } });
  assert.equal(authResult.structuredContent?.stores_password, false);
  assert.match(authResult.structuredContent?.command, /garmin-mcp-unofficial auth$/);
  assert.match(authResult.structuredContent?.legacy_python_command, /auth --use-python/);

  const inventoryResult = await client.callTool({ name: 'garmin_data_inventory', arguments: { response_format: 'json' } });
  assert.equal(inventoryResult.structuredContent?.kind, 'data_inventory');
  assert.equal(typeof inventoryResult.structuredContent?.source, 'string');

  const manifestResult = await client.callTool({ name: 'garmin_agent_manifest', arguments: { client: 'hermes', response_format: 'json' } });
  assert.equal(manifestResult.structuredContent?.client, 'hermes');
  assert.equal(manifestResult.structuredContent?.auth?.provider, 'Garmin Connect');
  assert.equal(manifestResult.structuredContent?.links?.docs, expectedDocsUrl);
  assert.ok(manifestResult.structuredContent?.hermes?.common_tool_names?.includes('mcp_garmin_garmin_connection_status'));
  assert.equal(manifestResult.structuredContent?.hermes?.no_gateway_restart_for_data_access, true);

  const statusResult = await client.callTool({ name: 'garmin_connection_status', arguments: { client: 'hermes', response_format: 'json' } });
  assert.equal(statusResult.structuredContent?.ok, false);
  assert.deepEqual(statusResult.structuredContent?.missing_env, []);
  assert.equal(statusResult.structuredContent?.client, 'hermes');

  console.log(JSON.stringify({ ok: true, tools: toolNames.length, resources: resourceUris.length, prompts: promptNames.length }, null, 2));
} finally {
  await client.close();
  rmSync(home, { recursive: true, force: true });
}
