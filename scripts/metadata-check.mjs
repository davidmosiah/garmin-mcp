import { existsSync, readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const serverJson = JSON.parse(readFileSync('server.json', 'utf8'));
const errors = [];

function requireFile(path) {
  if (!existsSync(path)) errors.push(`Missing required file: ${path}`);
}

requireFile('README.md');
if (packageJson.private !== true && packageJson.license !== 'UNLICENSED') {
  requireFile('LICENSE');
}
requireFile('llms.txt');
requireFile('server.json');

if (serverJson.version !== packageJson.version) {
  errors.push(`server.json version ${serverJson.version} does not match package.json version ${packageJson.version}`);
}

const expectsRegistryPackage = packageJson.private !== true && serverJson.publication?.npm !== false;
const npmPackage = serverJson.packages?.find((pkg) => pkg.registryType === 'npm');
if (expectsRegistryPackage && !npmPackage) {
  errors.push('server.json must declare an npm package.');
}
if (npmPackage) {
  if (npmPackage.identifier !== packageJson.name) {
    errors.push(`server.json package identifier ${npmPackage.identifier} does not match package name ${packageJson.name}`);
  }
  if (npmPackage.version !== packageJson.version) {
    errors.push(`server.json package version ${npmPackage.version} does not match package version ${packageJson.version}`);
  }
}

if (Array.isArray(packageJson.files) && !packageJson.files.includes('llms.txt')) {
  errors.push('package.json files must include llms.txt.');
}

// Dependabot cannot rewrite npm overrides. Pins below these floors make the
// grouped security job fail with security_update_not_possible (2026-09-08+).
const OVERRIDE_FLOORS = {
  qs: '6.16.0',
  hono: '4.13.7',
  'fast-uri': '3.1.8',
  'ip-address': '10.7.1'
};

function isVersionBelow(actual, floor) {
  const left = String(actual).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = String(floor).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a < b) return true;
    if (a > b) return false;
  }
  return false;
}

const overrides = packageJson.overrides ?? {};
const lockfile = JSON.parse(readFileSync('package-lock.json', 'utf8'));
for (const [name, floor] of Object.entries(OVERRIDE_FLOORS)) {
  const pinned = overrides[name];
  if (!pinned) {
    errors.push(`package.json overrides must pin ${name} to at least ${floor} (Dependabot security updates).`);
    continue;
  }
  if (isVersionBelow(pinned, floor)) {
    errors.push(`package.json overrides.${name}=${pinned} is below patched floor ${floor}.`);
  }
  const locked = lockfile.packages?.[`node_modules/${name}`]?.version;
  if (!locked) {
    errors.push(`package-lock.json is missing node_modules/${name} (Dependabot security updates).`);
  } else if (isVersionBelow(locked, floor)) {
    errors.push(`package-lock.json ${name}@${locked} is below patched floor ${floor}.`);
  }
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, metadata: true, package: packageJson.name, version: packageJson.version }, null, 2));
