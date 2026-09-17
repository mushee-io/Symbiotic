import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const EXPECTED_VERSION = "1.1.22";

export function ensurePinnedAiken() {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  const lookup = spawnSync(finder, ["aiken"], { encoding: "utf8" });
  const candidates = (lookup.stdout ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !value.replace(/\\/g, "/").toLowerCase().includes("/node_modules/.bin/"));
  const aikenPath = candidates[0];
  if (!aikenPath) {
    const install = process.platform === "win32"
      ? 'powershell -ExecutionPolicy ByPass -c "irm https://github.com/aiken-lang/aiken/releases/download/v1.1.22/aiken-installer.ps1 | iex"'
      : "curl --proto '=https' --tlsv1.2 -LsSf https://github.com/aiken-lang/aiken/releases/download/v1.1.22/aiken-installer.sh | sh";
    throw new Error(`Aiken v${EXPECTED_VERSION} is not installed or not on PATH. Install it with:\n${install}\nThen reopen the terminal and retry.`);
  }

  const version = spawnSync(aikenPath, ["--version"], { encoding: "utf8", shell: false });
  if (version.error) throw version.error;
  const versionText = `${version.stdout ?? ""} ${version.stderr ?? ""}`.trim();
  if (version.status !== 0 || !versionText.includes(EXPECTED_VERSION)) {
    throw new Error(`Wrong Aiken compiler. Required v${EXPECTED_VERSION}; found: ${versionText || "unknown"}`);
  }

  // Preserve the resolved executable path for later deployment stages. Calling the
  // executable directly (shell:false) is required on Windows when the user profile
  // contains spaces, e.g. C:\\Users\\New User\\.aiken\\bin\\aiken.exe.
  process.env.SYMBIOTIC_AIKEN_BIN = aikenPath;

  const binDir = resolve(process.cwd(), "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  if (process.platform === "win32") {
    const shim = resolve(binDir, "aiken.cmd");
    writeFileSync(shim, `@echo off\r\n"${aikenPath}" %*\r\n`, "utf8");
    return { aikenPath, version: versionText, shim };
  }

  const shim = resolve(binDir, "aiken");
  const escaped = aikenPath.replace(/'/g, `'"'"'`);
  writeFileSync(shim, `#!/bin/sh\nexec '${escaped}' "$@"\n`, "utf8");
  chmodSync(shim, 0o755);
  return { aikenPath, version: versionText, shim };
}
