import { ensurePinnedAiken } from "./ensure-aiken.js";

const MAX_TRANSIENT_RETRIES = 12;
const RETRY_DELAY_MS = 10_000;

function errorText(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}\n${error.stack ?? ""}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isTransientSpentInputError(error: unknown) {
  const text = errorText(error);
  return text.includes("All inputs are spent") || text.includes("BadInputsUTxO");
}

const aiken = ensurePinnedAiken();
console.log(`Using ${aiken.version}`);
const { buildDeploymentPlan, deployValidators } = await import("../src/preprod-deployment.js");
const { plan, wallet, provider } = await buildDeploymentPlan();
console.log(`Verified deployment plan ${plan.planRoot}`);
console.log(`Deploying ${plan.validators.length} Plutus V3 reference scripts to Cardano Preprod...`);

let manifest: Awaited<ReturnType<typeof deployValidators>> | undefined;
for (let attempt = 1; attempt <= MAX_TRANSIENT_RETRIES + 1; attempt += 1) {
  try {
    manifest = await deployValidators(plan, wallet, provider);
    break;
  } catch (error) {
    if (!isTransientSpentInputError(error) || attempt > MAX_TRANSIENT_RETRIES) throw error;
    console.warn(
      `Preprod address UTxO view is still catching up after a confirmed transaction; preserving the manifest and retrying with fresh UTxOs in ${RETRY_DELAY_MS / 1000}s (${attempt}/${MAX_TRANSIENT_RETRIES}).`,
    );
    await new Promise((resolvePromise) => setTimeout(resolvePromise, RETRY_DELAY_MS));
  }
}

if (!manifest) throw new Error("Validator deployment ended without a manifest");
console.log(JSON.stringify(manifest, null, 2));
console.log("\nFive-validator Preprod reference-script deployment COMPLETE.");
console.log("Keep .secrets/preprod-validator-deployment.json; it contains the public on-chain deployment receipts.");
