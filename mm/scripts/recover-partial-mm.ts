import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { UTxO } from "@meshsdk/core";
import { PreprodMmExecutionAdapter, type MmExecutionState } from "../src/execution-adapter.js";

const ABSENCE_CONFIRMATIONS = 3;
const ABSENCE_CONFIRMATION_DELAY_MS = 2_000;

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function utxoRef(utxo: UTxO) {
  return `${utxo.input.txHash}#${utxo.input.outputIndex}`;
}

function quantityOf(utxo: UTxO, unit: string) {
  return BigInt(utxo.output.amount.find((asset) => asset.unit === unit)?.quantity ?? "0");
}

function statePath() {
  return resolve(process.cwd(), ".secrets", "mm-live-state.json");
}

function writeState(state: MmExecutionState) {
  const path = statePath();
  if (!existsSync(path)) throw new Error(`Managed MM state file is missing: ${path}`);
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function livePositionRefs(adapter: PreprodMmExecutionAdapter) {
  const utxos = await adapter.provider.fetchAddressUTxOs(adapter.perpetual.scriptAddress);
  return new Set(
    utxos
      .filter((utxo) => quantityOf(utxo, adapter.susdUnit) > 0n && Boolean(utxo.output.plutusData))
      .map(utxoRef),
  );
}

async function isConsistentlyAbsent(adapter: PreprodMmExecutionAdapter, positionUtxo: string) {
  for (let attempt = 0; attempt < ABSENCE_CONFIRMATIONS; attempt += 1) {
    const refs = await livePositionRefs(adapter);
    if (refs.has(positionUtxo)) return false;
    if (attempt + 1 < ABSENCE_CONFIRMATIONS) await sleep(ABSENCE_CONFIRMATION_DELAY_MS);
  }
  return true;
}

if ((process.env.MM_EXECUTION_MODE ?? "").trim().toLowerCase() !== "live") {
  throw new Error('Partial-pair recovery can submit a close transaction. Set MM_EXECUTION_MODE="live" explicitly.');
}
if ((process.env.CONFIRM_MM_PREPROD ?? "").trim() !== "YES") {
  throw new Error('Partial-pair recovery requires CONFIRM_MM_PREPROD="YES".');
}

const adapter = await PreprodMmExecutionAdapter.create();
const state = adapter.readState();
if (!state) throw new Error("No managed MM state exists to recover");
if (state.mmAddress !== adapter.mmAddress || state.perpetualAddress !== adapter.perpetual.scriptAddress) {
  throw new Error("Managed MM state does not match the current Preprod deployment");
}

const initialLiveRefs = await livePositionRefs(adapter);
const locallyClosedButLive = state.legs.filter((leg) => leg.closedTxHash && initialLiveRefs.has(leg.positionUtxo));
if (locallyClosedButLive.length) {
  throw new Error(`Refusing recovery: ${locallyClosedButLive.length} leg(s) are marked closed locally but still unspent on-chain`);
}

if (state.status === "closed") {
  const remaining = state.legs.filter((leg) => initialLiveRefs.has(leg.positionUtxo));
  if (remaining.length) throw new Error(`Closed local pair still exposes ${remaining.length} live on-chain leg(s)`);
  console.log("MM recovery not required: pair is already closed and exposes zero live managed legs.");
  process.exit(0);
}

let reconciledSpentLegs = 0;
for (const leg of state.legs) {
  if (leg.closedTxHash) continue;
  if (initialLiveRefs.has(leg.positionUtxo)) continue;

  const confirmedSpent = await isConsistentlyAbsent(adapter, leg.positionUtxo);
  if (!confirmedSpent) {
    throw new Error(`Position ${leg.positionUtxo} reappeared during reconciliation; refusing to mutate local state`);
  }

  leg.closedTxHash = `reconciled-spent:${leg.positionUtxo}`;
  leg.closedAt = new Date().toISOString();
  reconciledSpentLegs += 1;
}

if (reconciledSpentLegs > 0) writeState(state);

const refreshedLiveRefs = await livePositionRefs(adapter);
const liveManagedLegs = state.legs.filter((leg) => !leg.closedTxHash && refreshedLiveRefs.has(leg.positionUtxo));
const unresolvedMissing = state.legs.filter((leg) => !leg.closedTxHash && !refreshedLiveRefs.has(leg.positionUtxo));
if (unresolvedMissing.length) {
  throw new Error(`Recovery still has ${unresolvedMissing.length} unresolved locally-open leg(s); refusing to submit anything`);
}

if (liveManagedLegs.length === 0) {
  state.status = "closed";
  state.closedAt = state.closedAt ?? new Date().toISOString();
  writeState(state);
  console.log(JSON.stringify({
    status: "RECOVERED",
    pairId: state.pairId,
    reconciledSpentLegs,
    liveManagedLegs: 0,
    action: "LOCAL_STATE_CLOSED_NO_TX_REQUIRED",
  }, null, 2));
  process.exit(0);
}

console.log(JSON.stringify({
  status: "PARTIAL_PAIR_CONFIRMED",
  pairId: state.pairId,
  reconciledSpentLegs,
  liveManagedLegs: liveManagedLegs.length,
  nextAction: "CLOSE_REMAINING_LIVE_LEGS",
}, null, 2));

const closed = await adapter.closeManagedPair();
const final = await adapter.reconcileState();
if (closed.status !== "closed" || final.liveLegs !== 0) {
  throw new Error(`Recovery close did not converge: state=${closed.status}, liveManagedLegs=${final.liveLegs}`);
}

console.log(JSON.stringify({
  status: "RECOVERED",
  pairId: closed.pairId,
  reconciledSpentLegs,
  liveManagedLegs: final.liveLegs,
  action: "REMAINING_LIVE_LEGS_CLOSED",
}, null, 2));
