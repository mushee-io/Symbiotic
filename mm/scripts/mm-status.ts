import { PreprodMmExecutionAdapter } from "../src/execution-adapter.js";

const adapter = await PreprodMmExecutionAdapter.create();
const [reconciliation, wallet] = await Promise.all([
  adapter.reconcileState(),
  adapter.walletSnapshot(),
]);

console.log(JSON.stringify({
  network: "preprod",
  mmAddress: adapter.mmAddress,
  perpetualAddress: adapter.perpetual.scriptAddress,
  perpetualReferenceUtxo: adapter.perpetual.referenceUtxo,
  managedState: reconciliation.state ?? null,
  liveManagedLegs: reconciliation.liveLegs,
  spendableWalletUtxos: wallet.spendable.length,
  protectedReferenceUtxos: wallet.protectedRefs.size,
  spendableSusdBaseUnits: wallet.susd.toString(),
  spendableLovelace: wallet.lovelace.toString(),
}, null, 2));
