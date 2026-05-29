import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface as createPromptInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getConfig } from "../services/config.js";
import { TokenStore } from "../services/token-store.js";
import { nativeGarminLogin } from "./garmin-login.js";

export async function runAuthCommand(args: string[]): Promise<number> {
  const json = args.includes("--json");
  // Default path is the self-contained Node login. `--use-python` (or the
  // legacy `--install-helper`) opts into the Python `garminconnect` helper.
  const usePython = args.includes("--use-python") || args.includes("--install-helper");
  if (!usePython) {
    return runNativeAuth(args, json);
  }
  return runPythonAuth(args, json);
}

/**
 * Self-contained login: no Python helper, no external script. Prompts for the
 * Garmin email/password/MFA in this terminal and writes the same token set the
 * connector reads, matching how the other Delx wellness connectors store tokens
 * locally (~/.garmin-mcp/garmin_tokens.json, 0600).
 */
async function runNativeAuth(args: string[], json: boolean): Promise<number> {
  const config = getConfig();
  let credentials: { email: string; password: string };
  try {
    credentials = await collectCredentials(json);
  } catch (error) {
    return printAuthFailure(json, (error as Error).message);
  }

  try {
    const tokens = await nativeGarminLogin({
      email: credentials.email,
      password: credentials.password,
      domain: config.domain,
      promptMfa: json ? promptMfaFromEnv : promptMfaInteractive
    });
    const store = new TokenStore(config.tokenPath);
    await store.withLock(async () => {
      const existing = (await store.read()) ?? {};
      await store.write({ ...existing, ...tokens, updated_at: new Date().toISOString() });
    });
    chmodSync(config.tokenPath, 0o600);
    return printAuthSuccess(json, config.tokenPath);
  } catch (error) {
    return printAuthFailure(json, `Garmin login failed: ${(error as Error).message}`);
  }
}

async function collectCredentials(json: boolean): Promise<{ email: string; password: string }> {
  const email = process.env.GARMIN_EMAIL ?? (json ? undefined : await promptLine("Garmin email: "));
  const password = process.env.GARMIN_PASSWORD ?? (json ? undefined : await promptHidden("Garmin password: "));
  if (!email || !password) {
    throw new Error(
      json
        ? "Set GARMIN_EMAIL and GARMIN_PASSWORD (and GARMIN_MFA_CODE if prompted) to run `auth --json`, or run `garmin-mcp-server auth` interactively."
        : "Garmin email and password are required."
    );
  }
  return { email, password };
}

async function promptLine(question: string): Promise<string> {
  const rl = createPromptInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function promptHidden(question: string): Promise<string> {
  const rl = createPromptInterface({ input, output });
  // Mask typed characters by overriding readline's output writer.
  const writable = rl as unknown as { _writeToOutput?: (s: string) => void };
  const original = writable._writeToOutput?.bind(rl);
  if (original) {
    writable._writeToOutput = (chunk: string) => {
      if (chunk.includes("\n") || chunk.includes("\r") || chunk.startsWith(question)) original(chunk);
      else original("*".repeat(chunk.length));
    };
  }
  try {
    return (await rl.question(question)).trim();
  } finally {
    if (original) writable._writeToOutput = original;
    rl.close();
  }
}

async function promptMfaInteractive(): Promise<string> {
  return promptLine("Garmin MFA code: ");
}

async function promptMfaFromEnv(): Promise<string> {
  const code = process.env.GARMIN_MFA_CODE;
  if (!code) {
    throw new Error("Garmin MFA required but GARMIN_MFA_CODE is not set. Run interactively or provide GARMIN_MFA_CODE.");
  }
  return code;
}

async function runPythonAuth(args: string[], json: boolean): Promise<number> {
  // Only --install-helper installs the garminconnect package; --use-python alone
  // expects it to already be present.
  const installHelper = args.includes("--install-helper");
  const config = getConfig();

  const basePython = findPython();
  if (!basePython) {
    return printAuthFailure(json, "python3 was not found. Install Python 3, then run garmin-mcp-server auth again.");
  }

  const helper = ensurePythonWithGarminconnect(basePython, installHelper, dirname(config.tokenPath), json);
  if (helper.error || !helper.python) {
    return printAuthFailure(json, helper.error ?? "Could not prepare Garmin auth helper.");
  }
  const python = helper.python;

  const helperPath = writeHelperScript();
  const run = spawnSync(python, [helperPath, config.tokenPath], {
    encoding: "utf8",
    stdio: json ? "pipe" : "inherit",
    env: {
      ...process.env,
      GARMIN_MCP_TOKEN_PATH: config.tokenPath
    }
  });

  if (run.status !== 0) {
    const detail = json ? `${run.stderr || run.stdout}`.trim() : "Garmin login helper failed";
    return printAuthFailure(json, detail);
  }

  try {
    return printAuthSuccess(json, config.tokenPath);
  } catch (error) {
    return printAuthFailure(json, `Login finished but token file could not be inspected: ${(error as Error).message}`);
  }
}

function printAuthSuccess(json: boolean, tokenPath: string): number {
  chmodSync(tokenPath, 0o600);
  const stat = statSync(tokenPath);
  const payload = JSON.parse(readFileSync(tokenPath, "utf8")) as Record<string, unknown>;
  const result = {
    ok: true,
    token_path: tokenPath,
    permissions: (stat.mode & 0o777).toString(8).padStart(3, "0"),
    has_di_token: typeof payload.di_token === "string" && payload.di_token.length > 0,
    has_refresh_token: typeof payload.di_refresh_token === "string" && payload.di_refresh_token.length > 0,
    display_name: typeof payload.display_name === "string" ? payload.display_name : undefined,
    next_step: "Run `garmin-mcp-server doctor`, then start your MCP client."
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("");
    console.log("✓ Garmin connected");
    console.log("");
    console.log(`  Token file:   ${result.token_path}`);
    console.log(`  Permissions:  ${result.permissions}`);
    if (result.display_name) console.log(`  Display name: ${result.display_name}`);
    console.log("");
    console.log(`→ Next: ${result.next_step}`);
  }
  return 0;
}

function printAuthFailure(json: boolean, message: string): number {
  if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  else console.error(message);
  return 1;
}

function findPython(): string | undefined {
  for (const candidate of [process.env.PYTHON, "python3", "python"]) {
    if (!candidate) continue;
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (result.status === 0) return candidate;
  }
  return undefined;
}

function pythonHasGarminconnect(python: string): boolean {
  const result = spawnSync(python, ["-c", "import garminconnect"], { encoding: "utf8" });
  return result.status === 0;
}

function ensurePythonWithGarminconnect(python: string, installHelper: boolean, helperRoot: string, json: boolean): { python?: string; error?: string } {
  if (pythonHasGarminconnect(python)) return { python };
  if (!installHelper) {
    return { error: "Python helper package garminconnect is not installed. Run `garmin-mcp-server auth --install-helper`." };
  }

  const userInstall = spawnSync(python, ["-m", "pip", "install", "--user", "garminconnect==0.3.2"], { encoding: "utf8", stdio: json ? "pipe" : "inherit" });
  if (userInstall.status === 0 && pythonHasGarminconnect(python)) return { python };

  const venvDir = join(helperRoot, "venv");
  const venv = spawnSync(python, ["-m", "venv", venvDir], { encoding: "utf8", stdio: json ? "pipe" : "inherit" });
  if (venv.status !== 0) {
    const detail = json ? `${venv.stderr || venv.stdout || userInstall.stderr || userInstall.stdout}`.trim() : "venv creation failed";
    return { error: `Could not create isolated Python helper environment: ${detail}` };
  }

  const venvPython = join(venvDir, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  spawnSync(venvPython, ["-m", "pip", "install", "--upgrade", "pip"], { encoding: "utf8", stdio: json ? "pipe" : "inherit" });
  const venvInstall = spawnSync(venvPython, ["-m", "pip", "install", "garminconnect==0.3.2"], { encoding: "utf8", stdio: json ? "pipe" : "inherit" });
  if (venvInstall.status !== 0 || !pythonHasGarminconnect(venvPython)) {
    const detail = json ? `${venvInstall.stderr || venvInstall.stdout || userInstall.stderr || userInstall.stdout}`.trim() : "pip install failed";
    return { error: `Could not install garminconnect helper in isolated venv: ${detail}` };
  }
  return { python: venvPython };
}

function writeHelperScript(): string {
  const dir = mkdtempSync(join(tmpdir(), "garmin-mcp-auth-"));
  const path = join(dir, "auth_helper.py");
  writeFileSync(path, PYTHON_AUTH_HELPER, { mode: 0o600 });
  return path;
}

const PYTHON_AUTH_HELPER = String.raw`#!/usr/bin/env python3
import getpass
import json
import os
import sys
from pathlib import Path

from garminconnect import Garmin


def prompt_mfa():
    return input("Garmin MFA code: ").strip()


def main():
    token_path = Path(sys.argv[1]).expanduser()
    token_path.parent.mkdir(parents=True, exist_ok=True)

    email = os.environ.get("GARMIN_EMAIL") or input("Garmin email: ").strip()
    password = os.environ.get("GARMIN_PASSWORD") or getpass.getpass("Garmin password: ")
    if not email or not password:
        raise SystemExit("Garmin email and password are required.")

    api = Garmin(email, password, prompt_mfa=prompt_mfa)
    api.login(str(token_path))

    data = {}
    if token_path.exists():
        data = json.loads(token_path.read_text())
    data["display_name"] = getattr(api, "display_name", None)
    data["full_name"] = getattr(api, "full_name", None)
    data["unit_system"] = getattr(api, "unit_system", None)
    data["updated_at"] = __import__("datetime").datetime.utcnow().isoformat() + "Z"
    token_path.write_text(json.dumps(data, indent=2) + "\n")
    token_path.chmod(0o600)
    print("Garmin token saved:", token_path)


if __name__ == "__main__":
    main()
`;

export function tokenFileExists(path: string): boolean {
  return existsSync(path);
}

export function tokenDir(path: string): string {
  return dirname(path);
}
