import { buildDeploymentPlan, deployValidators } from "../src/preprod-deployment.js";

const { plan, wallet, provider } = await buildDeploymentPlan();
console.log(`Verified deployment plan ${plan.planRoot}`);
console.log(`Deploying ${plan.validators.length} Plutus V3 reference scripts to Cardano Preprod...`);
const manifest = await deployValidators(plan, wallet, provider);
console.log(JSON.stringify(manifest, null, 2));
console.log("\nFive-validator Preprod reference-script deployment COMPLETE.");
console.log("Keep .secrets/preprod-validator-deployment.json; it contains the public on-chain deployment receipts.");
