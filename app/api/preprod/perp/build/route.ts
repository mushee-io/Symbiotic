import {
  KoiosProvider,
  MeshTxBuilder,
  deserializeAddress,
  mConStr,
  mConStr0,
  type UTxO,
} from "@meshsdk/core";
import { NextResponse } from "next/server";
import { PREPROD_LIVE, priceToDatumUnits, usdToBaseUnits } from "@/lib/preprod-live";
import { fetchBtcUsdOracleRound } from "@/lib/server-btc-oracle";
import { findPerpPosition, parsePerpDatumCbor } from "@/lib/preprod-perp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const provider = new KoiosProvider("preprod");

type Action = "increase" | "reduce" | "close";
type BuildBody = {
  action?: Action;
  positionTxHash?: string;
  changeAddress?: string;
  walletUtxos?: UTxO[];
  collateral?: UTxO;
  sizeDeltaUsd?: number;
  collateralDeltaUsd?: number;
};

function ref(utxo: UTxO) {
  return `${utxo.input.txHash}#${utxo.input.outputIndex}`;
}

function quantity(utxos: UTxO[], unit: string) {
  return utxos.reduce((sum, utxo) => sum + BigInt(utxo.output.amount.find((asset) => asset.unit === unit)?.quantity ?? "0"), 0n);
}

function parseRef(value: string) {
  const [txHash, indexRaw] = value.split("#");
  const index = Number(indexRaw);
  if (!txHash || !/^[0-9a-f]{64}$/i.test(txHash) || !Number.isInteger(index) || index < 0) throw new Error(`Invalid reference UTxO ${value}`);
  return { txHash, index };
}

function safeDelta(value: unknown, label: string, allowZero = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < (allowZero ? 0 : 1) || number > 10_000) throw new Error(`${label} must be ${allowZero ? "0–10,000" : "1–10,000"} USD`);
  return usdToBaseUnits(number);
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as BuildBody;
    const action = body.action;
    if (action !== "increase" && action !== "reduce" && action !== "close") {
      return NextResponse.json({ error: "Action must be increase, reduce, or close" }, { status: 400 });
    }
    const positionTxHash = body.positionTxHash?.trim().toLowerCase() ?? "";
    if (!/^[0-9a-f]{64}$/.test(positionTxHash)) throw new Error("Invalid position transaction hash");
    const changeAddress = body.changeAddress?.trim() ?? "";
    if (!changeAddress.startsWith("addr_test1")) throw new Error("A Cardano Preprod change address is required");
    if (!Array.isArray(body.walletUtxos) || body.walletUtxos.length === 0) throw new Error("Wallet UTxOs are required");
    if (!body.collateral?.input?.txHash || !body.collateral.output?.address) throw new Error("A Lace collateral UTxO is required");

    const outputs = await provider.fetchUTxOs(positionTxHash);
    const position = findPerpPosition(outputs);
    if (!position || !position.output.plutusData) throw new Error("Live Perpetual position UTxO not found; it may already be spent");
    const datum = parsePerpDatumCbor(position.output.plutusData);
    const { pubKeyHash } = deserializeAddress(changeAddress);
    if (!pubKeyHash || pubKeyHash.toLowerCase() !== datum.owner) throw new Error("Connected Lace wallet does not own this position");
    const collateralOnChain = BigInt(position.output.amount.find((asset) => asset.unit === PREPROD_LIVE.sUsd.unit)?.quantity ?? "0");
    if (collateralOnChain !== datum.collateralBaseUnits) throw new Error("Position collateral/datum mismatch");

    const collateralRef = ref(body.collateral);
    const walletUtxos = body.walletUtxos.filter((utxo) => ref(utxo) !== collateralRef);
    if (!walletUtxos.length) throw new Error("No non-collateral wallet UTxOs available to pay fees");

    const reference = parseRef(PREPROD_LIVE.perpetual.referenceUtxo);
    const txBuilder = new MeshTxBuilder({ fetcher: provider });
    txBuilder
      .spendingPlutusScriptV3()
      .txIn(position.input.txHash, position.input.outputIndex, position.output.amount, position.output.address)
      .txInInlineDatumPresent();

    let nextPosition: Record<string, string | number> | null = null;
    let oracleRoundId: string | null = null;

    if (action === "increase") {
      const sizeDelta = safeDelta(body.sizeDeltaUsd, "Increase size");
      const collateralDelta = safeDelta(body.collateralDeltaUsd ?? 0, "Increase collateral", true);
      if (collateralDelta > 0n && quantity(walletUtxos, PREPROD_LIVE.sUsd.unit) < collateralDelta) throw new Error("Wallet does not have enough spendable sUSD for collateral increase");
      const oracle = await fetchBtcUsdOracleRound();
      oracleRoundId = oracle.roundId;
      const livePrice = priceToDatumUnits(oracle.price);
      const nextSize = datum.sizeBaseUnits + sizeDelta;
      const nextCollateral = datum.collateralBaseUnits + collateralDelta;
      const minimumMaintenance = nextSize * 500n / 10_000n;
      if (nextCollateral <= minimumMaintenance) throw new Error("Resulting position would be at/below maintenance margin");
      const weightedEntry = (datum.entryPriceBaseUnits * datum.sizeBaseUnits + livePrice * sizeDelta) / nextSize;
      const nextDatum = mConStr0([
        datum.owner,
        datum.marketHex,
        BigInt(datum.side),
        nextSize,
        nextCollateral,
        weightedEntry,
        datum.nonce + 1n,
      ]);
      const nextAmount = position.output.amount.map((asset) => asset.unit === PREPROD_LIVE.sUsd.unit
        ? { ...asset, quantity: nextCollateral.toString() }
        : asset);
      txBuilder
        .txInRedeemerValue(mConStr(0, [sizeDelta, collateralDelta]))
        .spendingTxInReference(reference.txHash, reference.index, PREPROD_LIVE.perpetual.scriptHash)
        .txOut(PREPROD_LIVE.perpetual.scriptAddress, nextAmount)
        .txOutInlineDatumValue(nextDatum);
      nextPosition = {
        sizeUsd: Number(nextSize) / 1_000_000,
        collateralUsd: Number(nextCollateral) / 1_000_000,
        entryPrice: Number(weightedEntry) / 1_000_000,
        nonce: Number(datum.nonce + 1n),
      };
    } else if (action === "reduce") {
      const sizeDelta = safeDelta(body.sizeDeltaUsd, "Reduce size");
      if (sizeDelta >= datum.sizeBaseUnits) throw new Error("Reduce size must be smaller than the current position; use Close for the full position");
      const nextSize = datum.sizeBaseUnits - sizeDelta;
      const nextDatum = mConStr0([
        datum.owner,
        datum.marketHex,
        BigInt(datum.side),
        nextSize,
        datum.collateralBaseUnits,
        datum.entryPriceBaseUnits,
        datum.nonce + 1n,
      ]);
      txBuilder
        .txInRedeemerValue(mConStr(1, [sizeDelta]))
        .spendingTxInReference(reference.txHash, reference.index, PREPROD_LIVE.perpetual.scriptHash)
        .txOut(PREPROD_LIVE.perpetual.scriptAddress, position.output.amount)
        .txOutInlineDatumValue(nextDatum);
      nextPosition = {
        sizeUsd: Number(nextSize) / 1_000_000,
        collateralUsd: Number(datum.collateralBaseUnits) / 1_000_000,
        entryPrice: Number(datum.entryPriceBaseUnits) / 1_000_000,
        nonce: Number(datum.nonce + 1n),
      };
    } else {
      txBuilder
        .txInRedeemerValue(mConStr(2, []))
        .spendingTxInReference(reference.txHash, reference.index, PREPROD_LIVE.perpetual.scriptHash)
        .txOut(changeAddress, position.output.amount);
    }

    txBuilder
      .requiredSignerHash(datum.owner)
      .txInCollateral(
        body.collateral.input.txHash,
        body.collateral.input.outputIndex,
        body.collateral.output.amount,
        body.collateral.output.address,
      )
      .metadataValue(674, { msg: [`Symbiotic BTC-USD ${action.toUpperCase()}`] })
      .changeAddress(changeAddress)
      .selectUtxosFrom(walletUtxos);

    const unsignedTx = await txBuilder.complete();
    return NextResponse.json({
      network: "preprod",
      action,
      positionUtxo: ref(position),
      unsignedTx,
      nextPosition,
      oracleRoundId,
      truthBoundary: action === "close"
        ? "Submitted transaction must confirm before the position is considered closed."
        : "Submitted transaction must confirm and create the continuation script UTxO before state is advanced.",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to build Perpetual lifecycle transaction" }, { status: 400 });
  }
}
