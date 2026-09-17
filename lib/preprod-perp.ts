import { deserializeDatum, type UTxO } from "@meshsdk/core";
import { PREPROD_LIVE } from "@/lib/preprod-live";

export type ParsedPerpPosition = {
  owner: string;
  marketHex: string;
  side: 1 | -1;
  sizeBaseUnits: bigint;
  collateralBaseUnits: bigint;
  entryPriceBaseUnits: bigint;
  nonce: bigint;
};

function readBytes(value: unknown, label: string): string {
  if (typeof value === "string" && /^[0-9a-f]*$/i.test(value)) return value.toLowerCase();
  if (value && typeof value === "object" && "bytes" in value) {
    const bytes = (value as { bytes?: unknown }).bytes;
    if (typeof bytes === "string" && /^[0-9a-f]*$/i.test(bytes)) return bytes.toLowerCase();
  }
  throw new Error(`Invalid ${label} bytes in position datum`);
}

function readInt(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  if (value && typeof value === "object" && "int" in value) {
    const int = (value as { int?: unknown }).int;
    if (typeof int === "number" && Number.isSafeInteger(int)) return BigInt(int);
    if (typeof int === "string" && /^-?\d+$/.test(int)) return BigInt(int);
    if (typeof int === "bigint") return int;
  }
  throw new Error(`Invalid ${label} integer in position datum`);
}

export function parsePerpDatumCbor(cbor: string): ParsedPerpPosition {
  if (!cbor || !/^[0-9a-f]+$/i.test(cbor)) throw new Error("Position is missing a valid inline datum");
  const decoded = deserializeDatum(cbor) as { constructor?: number; alternative?: number; fields?: unknown[] };
  const ctor = decoded.constructor ?? decoded.alternative;
  if (ctor !== 0 || !Array.isArray(decoded.fields) || decoded.fields.length !== 7) {
    throw new Error("Unexpected Perpetual PositionDatum shape");
  }
  const side = readInt(decoded.fields[2], "side");
  if (side !== 1n && side !== -1n) throw new Error("Position side must be LONG(1) or SHORT(-1)");
  const parsed: ParsedPerpPosition = {
    owner: readBytes(decoded.fields[0], "owner"),
    marketHex: readBytes(decoded.fields[1], "market"),
    side: side === 1n ? 1 : -1,
    sizeBaseUnits: readInt(decoded.fields[3], "size"),
    collateralBaseUnits: readInt(decoded.fields[4], "collateral"),
    entryPriceBaseUnits: readInt(decoded.fields[5], "entry price"),
    nonce: readInt(decoded.fields[6], "nonce"),
  };
  if (parsed.sizeBaseUnits <= 0n || parsed.collateralBaseUnits <= 0n || parsed.entryPriceBaseUnits <= 0n || parsed.nonce < 0n) {
    throw new Error("Position datum fails base invariants");
  }
  return parsed;
}

export function findPerpPosition(utxos: UTxO[]) {
  return utxos.find((utxo) => {
    if (utxo.output.address !== PREPROD_LIVE.perpetual.scriptAddress || !utxo.output.plutusData) return false;
    const quantity = BigInt(utxo.output.amount.find((asset) => asset.unit === PREPROD_LIVE.sUsd.unit)?.quantity ?? "0");
    return quantity > 0n;
  });
}

export function serialisePerpPosition(utxo: UTxO, datum: ParsedPerpPosition) {
  const collateralOnChain = BigInt(utxo.output.amount.find((asset) => asset.unit === PREPROD_LIVE.sUsd.unit)?.quantity ?? "0");
  if (collateralOnChain !== datum.collateralBaseUnits) throw new Error("Position datum collateral does not match on-chain sUSD units");
  return {
    txHash: utxo.input.txHash,
    outputIndex: utxo.input.outputIndex,
    positionUtxo: `${utxo.input.txHash}#${utxo.input.outputIndex}`,
    owner: datum.owner,
    marketHex: datum.marketHex,
    side: datum.side === 1 ? "LONG" : "SHORT",
    sizeBaseUnits: datum.sizeBaseUnits.toString(),
    sizeUsd: Number(datum.sizeBaseUnits) / 1_000_000,
    collateralBaseUnits: datum.collateralBaseUnits.toString(),
    collateralUsd: Number(datum.collateralBaseUnits) / 1_000_000,
    entryPriceBaseUnits: datum.entryPriceBaseUnits.toString(),
    entryPrice: Number(datum.entryPriceBaseUnits) / 1_000_000,
    nonce: datum.nonce.toString(),
    lovelace: utxo.output.amount.find((asset) => asset.unit === "lovelace")?.quantity ?? "0",
    hasInlineDatum: Boolean(utxo.output.plutusData),
  };
}
