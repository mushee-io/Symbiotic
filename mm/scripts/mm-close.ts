import { config } from "../src/config.js";
import { PreprodMmExecutionAdapter } from "../src/execution-adapter.js";

if (config.liveConfirmation !== "YES") {
  throw new Error('Closing managed positions submits Preprod transactions. Set CONFIRM_MM_PREPROD="YES" first.');
}

const adapter = await PreprodMmExecutionAdapter.create();
const state = await adapter.closeManagedPair();
console.log(JSON.stringify(state, null, 2));
console.log("Managed Symbiotic-MM quote pair CLOSED on Cardano Preprod.");
