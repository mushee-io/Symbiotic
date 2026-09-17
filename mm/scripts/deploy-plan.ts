import { ensurePinnedAiken } from "./ensure-aiken.js";

const aiken = ensurePinnedAiken();
console.log(`Using ${aiken.version}`);
const { buildDeploymentPlan, publicPlan } = await import("../src/preprod-deployment.js");
const { plan } = await buildDeploymentPlan();
console.log(JSON.stringify(publicPlan(plan), null, 2));
console.log("\nPLAN ONLY — no Cardano transaction was submitted.");
console.log("If every address/hash/reserve is correct, run deploy:validators with CONFIRM_PREPROD_DEPLOY=YES.");
