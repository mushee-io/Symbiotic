import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveScriptHash, serializePlutusScript } from "@meshsdk/core";
import { applyParamsToScript } from "@meshsdk/core-csl";

const EXPECTED_BLUEPRINT_SHA256 = "bdb8eea4d9159c9026a66479f6389d5cad4fddf55f32957222855652b05e2855";
const mmRoot = process.cwd();
const repoRoot = resolve(mmRoot, "..");
const binary = resolve(mmRoot, "node_modules", ".bin", process.platform === "win32" ? "aiken.cmd" : "aiken");
const build = spawnSync(binary, ["build"], { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32" });
if (build.error) throw build.error;
if (build.status !== 0) throw new Error(`aiken build failed: ${build.status}`);

const raw = readFileSync(resolve(repoRoot, "plutus.json"));
const digest = createHash("sha256").update(raw).digest("hex");
if (digest !== EXPECTED_BLUEPRINT_SHA256) throw new Error(`Blueprint SHA mismatch: ${digest}`);
const blueprint = JSON.parse(raw.toString("utf8")) as {
  validators: Array<{ title: string; compiledCode: string; parameters?: unknown[] }>;
};

const pkhA = "11".repeat(28);
const pkhB = "22".repeat(28);
const policy = "33".repeat(28);
const asset = "73555344";
const specs: Array<[string, Array<string | number>]> = [
  ["collateral.collateral.spend", [policy, asset]],
  ["perpetual.perpetual.spend", [pkhA, pkhB, 500, policy, asset]],
  ["options.options.spend", [pkhA, policy, asset]],
  ["notional.notional.spend", [pkhB]],
  ["registry.registry.spend", [pkhA, pkhB]],
];

const seen = new Set<string>();
for (const [title, params] of specs) {
  const validator = blueprint.validators.find((candidate) => candidate.title === title);
  if (!validator) throw new Error(`Missing ${title}`);
  if ((validator.parameters?.length ?? 0) !== params.length) throw new Error(`Parameter count mismatch for ${title}`);
  const cbor = applyParamsToScript(validator.compiledCode, params);
  const hash = resolveScriptHash(cbor, "V3");
  const address = serializePlutusScript({ code: cbor, version: "V3" }, undefined, 0).address;
  if (!/^[0-9a-f]{56}$/i.test(hash)) throw new Error(`Invalid hash for ${title}: ${hash}`);
  if (!address.startsWith("addr_test1")) throw new Error(`Invalid Preprod/testnet address for ${title}: ${address}`);
  if (seen.has(hash)) throw new Error(`Duplicate applied validator hash: ${hash}`);
  seen.add(hash);
  console.log(`${title}: ${hash} ${address}`);
}

if (seen.size !== 5) throw new Error(`Expected five unique applied validators, got ${seen.size}`);
console.log("Five-validator deterministic parameterization smoke test: PASS");
