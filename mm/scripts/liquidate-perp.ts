import {
  BlockfrostProvider,
  MeshTxBuilder,
  MeshWallet,
  SLOT_CONFIG_NETWORK,
  deserializeAddress,
  deserializeDatum,
  mConStr,
  unixTimeToEnclosingSlot,
  type UTxO,
} from "@meshsdk/core";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../src/config.js";
import { fetchBtcUsdOracleRound } from "../src/oracle.js";

const PERP_ADDRESS = "addr_test1wrkfd20gzpef073hy5n8r6z82d2eg2m6ezyc254zmjq6hhshp5t3t";
const PERP_SCRIPT_HASH = "ec96a9e8107297fa37252671e8475355942b7ac8898552a2dc81abde";
const PERP_REFERENCE = "2f9d91e9971e845e83df270514c6ba5c552579e43de38a828ab6ebdf4af8cf76#0";
const SUSD_UNIT = "558015db095bf61d0fd364b484ebddedf16f8d193a884a1c7b9e62f673555344";
const DEMO_OWNER = "addr_test1qpdpatsf32h957mct8y7z6465fzt9nqdkdt0augpctd0z49galkv70u6sczqpxje3nuuy9kw9ts83uqtxjhk2v5pdyfqp72c6j";
const OPERATOR_HASH = "3ea1ff4ebd71336d1db9e428b603ee0c39207465d2c93f973e8326b1";
const MAINTENANCE_BPS = 500n;

type Manifest = { validators: Array<{ referenceUtxo: string }> };

function ref(utxo: UTxO) { return `${utxo.input.txHash}#${utxo.input.outputIndex}`; }
function readInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  if (value && typeof value === "object" && "int" in value) return readInt((value as { int: unknown }).int);
  throw new Error("Invalid integer in PositionDatum");
}

if (config.network !== "preprod" || config.networkId !== 0) throw new Error("Liquidation is pinned to Cardano Preprod");
const positionTxHash = process.argv[2]?.trim().toLowerCase();
if (!positionTxHash || !/^[0-9a-f]{64}$/.test(positionTxHash)) throw new Error("Usage: npm.cmd run perp:liquidate -- <position-tx-hash>");

const provider = new BlockfrostProvider(config.blockfrostProjectId);
const outputs = await provider.fetchUTxOs(positionTxHash);
const position = outputs.find((utxo) => utxo.output.address === PERP_ADDRESS && Boolean(utxo.output.plutusData) && BigInt(utxo.output.amount.find((asset) => asset.unit === SUSD_UNIT)?.quantity ?? "0") > 0n);
if (!position?.output.plutusData) throw new Error("Live Perpetual position UTxO not found; it may already be spent");
const decoded = deserializeDatum(position.output.plutusData) as { constructor?: number; alternative?: number; fields?: unknown[] };
if ((decoded.constructor ?? decoded.alternative) !== 0 || !Array.isArray(decoded.fields) || decoded.fields.length !== 7) throw new Error("Unexpected PositionDatum shape");
const side = readInt(decoded.fields[2]);
const size = readInt(decoded.fields[3]);
const collateral = readInt(decoded.fields[4]);
const entry = readInt(decoded.fields[5]);
if ((side !== 1n && side !== -1n) || size <= 0n || collateral <= 0n || entry <= 0n) throw new Error("Position datum fails liquidation base invariants");

const oracle = await fetchBtcUsdOracleRound({ minSources: config.oracleMinSources, maxDeviationBps: config.oracleMaxDeviationBps, timeoutMs: config.oracleTimeoutMs });
const mark = BigInt(Math.round(oracle.price * 1_000_000));
const equity = collateral + side * (mark - entry) * size / entry;
const maintenance = size * MAINTENANCE_BPS / 10_000n;
console.log(JSON.stringify({ position: ref(position), side: side.toString(), sizeUsd: Number(size) / 1_000_000, collateralUsd: Number(collateral) / 1_000_000, entryPrice: Number(entry) / 1_000_000, markPrice: oracle.price, equityUsd: Number(equity) / 1_000_000, maintenanceUsd: Number(maintenance) / 1_000_000, oracleRoundId: oracle.roundId }, null, 2));
if (equity > maintenance) throw new Error("Position is healthy; liquidation transaction refused");

const wallet = new MeshWallet({ networkId: config.networkId, fetcher: provider, submitter: provider, key: { type: "mnemonic", words: config.mnemonic.split(/\s+/) } });
await wallet.init();
const mmAddress = await wallet.getChangeAddress();
const { pubKeyHash } = deserializeAddress(mmAddress);
if (pubKeyHash?.toLowerCase() !== OPERATOR_HASH) throw new Error("MM signer is not the deployed oracle/keeper authority");

const manifestPath = resolve(process.cwd(), ".secrets", "preprod-validator-deployment.json");
if (!existsSync(manifestPath)) throw new Error("Missing Preprod validator deployment manifest");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
const protectedRefs = new Set(manifest.validators.map((validator) => validator.referenceUtxo));
const allMmUtxos = await provider.fetchAddressUTxOs(mmAddress);
const spendable = allMmUtxos.filter((utxo) => !protectedRefs.has(ref(utxo)));
const collateralUtxo = spendable.find((utxo) => utxo.output.amount.length === 1 && utxo.output.amount[0]?.unit === "lovelace" && BigInt(utxo.output.amount[0]?.quantity ?? "0") >= 5_000_000n);
if (!collateralUtxo) throw new Error("MM needs a separate >=5 tADA pure-ADA UTxO for Plutus collateral");
const feeInputs = spendable.filter((utxo) => ref(utxo) !== ref(collateralUtxo));
if (!feeInputs.length) throw new Error("No MM fee UTxO remains after reserving collateral");

const [referenceTxHash, referenceIndexRaw] = PERP_REFERENCE.split("#");
const referenceIndex = Number(referenceIndexRaw);
const lowerSlot = unixTimeToEnclosingSlot(oracle.attestedAtMs - 5_000, SLOT_CONFIG_NETWORK.preprod);
const upperSlot = unixTimeToEnclosingSlot(oracle.attestedAtMs + 60_000, SLOT_CONFIG_NETWORK.preprod);

const unsignedTx = await new MeshTxBuilder({ fetcher: provider })
  .spendingPlutusScriptV3()
  .txIn(position.input.txHash, position.input.outputIndex, position.output.amount, position.output.address)
  .txInInlineDatumPresent()
  .txInRedeemerValue(mConStr(3, [mark, BigInt(oracle.attestedAtMs)]))
  .spendingTxInReference(referenceTxHash!, referenceIndex, PERP_SCRIPT_HASH)
  .txOut(DEMO_OWNER, position.output.amount)
  .requiredSignerHash(OPERATOR_HASH)
  .txInCollateral(collateralUtxo.input.txHash, collateralUtxo.input.outputIndex, collateralUtxo.output.amount, collateralUtxo.output.address)
  .invalidBefore(lowerSlot)
  .invalidHereafter(upperSlot)
  .metadataValue(674, { msg: ["Symbiotic BTC-USD LIQUIDATE", `oracle:${oracle.roundId.slice(0, 24)}`] })
  .changeAddress(mmAddress)
  .selectUtxosFrom(feeInputs)
  .complete();

const signedTx = await wallet.signTx(unsignedTx, true);
const txHash = await wallet.submitTx(signedTx);
console.log(`Liquidation submitted: ${txHash}`);
console.log("Collateral is routed back to the demo owner in this Preprod safety implementation. Verify confirmation before treating the position as liquidated.");
