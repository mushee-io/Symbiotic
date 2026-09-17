import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensurePinnedAiken } from "./ensure-aiken.js";

type Receipt = {
  name: string;
  title: string;
  scriptHash: string;
  scriptAddress: string;
  txHash: string;
  outputIndex: number;
  referenceUtxo: string;
};

type Manifest = {
  version: number;
  status: "partial" | "complete";
  network: string;
  networkMagic: number;
  blueprintSha256: string;
  planRoot: string;
  mmAddress: string;
  deployerAddress: string;
  authorities: Record<string, string>;
  collateral: {
    unit: string;
    policyId: string;
    tokenNameHex: string;
    requiredBaseUnits: string;
    observedBaseUnits: string;
  };
  validators: Receipt[];
};

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function refOf(txHash: string, outputIndex: number) {
  return `${txHash}#${outputIndex}`;
}

const aiken = ensurePinnedAiken();
console.log(`Using ${aiken.version}`);

const { buildDeploymentPlan } = await import("../src/preprod-deployment.js");
const { plan, provider } = await buildDeploymentPlan();

const manifestPath = resolve(process.cwd(), ".secrets", "preprod-validator-deployment.json");
if (!existsSync(manifestPath)) throw new Error("Missing .secrets/preprod-validator-deployment.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
if (manifest.status !== "complete") throw new Error(`Existing deployment manifest is ${manifest.status}, not complete`);
if (manifest.validators.length !== plan.validators.length) {
  throw new Error(`Existing manifest has ${manifest.validators.length} validator receipts; expected ${plan.validators.length}`);
}

if (manifest.network !== plan.network || manifest.networkMagic !== plan.networkMagic) {
  throw new Error("Existing deployment is on a different Cardano network");
}
if (manifest.mmAddress !== plan.mmAddress) throw new Error("Existing deployment MM address does not match current plan");
if (manifest.deployerAddress !== plan.deployerAddress) throw new Error("Existing deployment governor/deployer does not match current plan");
if (manifest.blueprintSha256 !== plan.blueprintSha256) throw new Error("Existing deployment blueprint digest does not match current verified build");
if (!sameJson(manifest.authorities, plan.authorities)) throw new Error("Existing deployment authorities do not match current plan");

for (const key of ["unit", "policyId", "tokenNameHex"] as const) {
  if (manifest.collateral[key] !== plan.collateral[key]) {
    throw new Error(`Existing deployment collateral ${key} does not match current plan`);
  }
}

for (const current of plan.validators) {
  const receipt = manifest.validators.find((candidate) => candidate.name === current.name);
  if (!receipt) throw new Error(`Missing existing receipt for ${current.name}`);
  if (receipt.title !== current.title) throw new Error(`${current.name} validator title mismatch`);
  if (receipt.scriptHash !== current.scriptHash) throw new Error(`${current.name} script hash mismatch`);
  if (receipt.scriptAddress !== current.scriptAddress) throw new Error(`${current.name} script address mismatch`);
  if (receipt.referenceUtxo !== refOf(receipt.txHash, receipt.outputIndex)) {
    throw new Error(`${current.name} receipt reference UTxO is internally inconsistent`);
  }
}

const liveUtxos = await provider.fetchAddressUTxOs(plan.mmAddress);
const liveRefs = new Set(liveUtxos.map((utxo) => refOf(utxo.input.txHash, utxo.input.outputIndex)));
for (const receipt of manifest.validators) {
  if (!liveRefs.has(receipt.referenceUtxo)) {
    throw new Error(`Recorded reference UTxO is no longer unspent at the MM address: ${receipt.name} ${receipt.referenceUtxo}`);
  }
}

const oldPlanRoot = manifest.planRoot;
const backupPath = resolve(
  process.cwd(),
  ".secrets",
  `preprod-validator-deployment.pre-adopt-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
copyFileSync(manifestPath, backupPath);

manifest.planRoot = plan.planRoot;
manifest.collateral = { ...plan.collateral };
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

console.log(`Verified ${manifest.validators.length}/${plan.validators.length} existing validator reference UTxOs on Cardano Preprod.`);
console.log(`Old plan root: ${oldPlanRoot}`);
console.log(`Current plan root: ${plan.planRoot}`);
console.log(`Backup written: ${backupPath}`);
console.log("Existing complete deployment ADOPTED. No Cardano transaction was submitted.");
