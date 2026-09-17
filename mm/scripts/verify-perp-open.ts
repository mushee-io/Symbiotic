import { BlockfrostProvider } from "@meshsdk/core";
import { config } from "../src/config.js";

const PERP_ADDRESS = "addr_test1wrkfd20gzpef073hy5n8r6z82d2eg2m6ezyc254zmjq6hhshp5t3t";
const PERP_SCRIPT_HASH = "ec96a9e8107297fa37252671e8475355942b7ac8898552a2dc81abde";
const SUSD_UNIT = "558015db095bf61d0fd364b484ebddedf16f8d193a884a1c7b9e62f673555344";

if (config.network !== "preprod" || config.networkId !== 0) throw new Error("Perp verification is pinned to Cardano Preprod");

const txHash = process.argv[2]?.trim().toLowerCase();
if (!txHash || !/^[0-9a-f]{64}$/.test(txHash)) {
  throw new Error("Usage: npm.cmd run perp:verify -- <64-char-preprod-tx-hash>");
}

const provider = new BlockfrostProvider(config.blockfrostProjectId);
let outputs = [] as Awaited<ReturnType<typeof provider.fetchUTxOs>>;
let lastError: unknown;
for (let attempt = 0; attempt < 36; attempt += 1) {
  try {
    outputs = await provider.fetchUTxOs(txHash);
    if (outputs.length) break;
  } catch (error) {
    lastError = error;
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
if (!outputs.length) throw new Error(`Transaction not visible on Preprod: ${String(lastError ?? txHash)}`);

const position = outputs.find((utxo) => {
  if (utxo.output.address !== PERP_ADDRESS) return false;
  const susd = BigInt(utxo.output.amount.find((asset) => asset.unit === SUSD_UNIT)?.quantity ?? "0");
  return susd > 0n && Boolean(utxo.output.plutusData);
});

if (!position) throw new Error("Transaction is confirmed but contains no sUSD-backed inline-datum output at the deployed Perpetual validator");

const collateralBaseUnits = BigInt(position.output.amount.find((asset) => asset.unit === SUSD_UNIT)?.quantity ?? "0");
const lovelace = BigInt(position.output.amount.find((asset) => asset.unit === "lovelace")?.quantity ?? "0");

const receipt = {
  status: "confirmed",
  network: "preprod",
  txHash,
  positionUtxo: `${position.input.txHash}#${position.input.outputIndex}`,
  perpetualScriptHash: PERP_SCRIPT_HASH,
  perpetualAddress: PERP_ADDRESS,
  sUsdUnit: SUSD_UNIT,
  collateralBaseUnits: collateralBaseUnits.toString(),
  collateralWholeUsd: Number(collateralBaseUnits) / 1_000_000,
  lovelace: lovelace.toString(),
  hasInlineDatum: Boolean(position.output.plutusData),
  inlineDatumCbor: position.output.plutusData,
};

console.log(JSON.stringify(receipt, null, 2));
console.log("REAL BTC-USD PERP OPEN UTxO: PASS");
