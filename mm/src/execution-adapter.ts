import { BlockfrostProvider, MeshTxBuilder, MeshWallet, deserializeAddress, type UTxO } from "@meshsdk/core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";
import type { OracleRound } from "./oracle.js";
import type { TwoSidedQuote } from "./quote-engine.js";

const USD_SCALE = 1_000_000;
const DEFAULT_POSITION_LOVELACE = 2_000_000n;
const MIN_COLLATERAL_LOVELACE = 5_000_000n;
const CONFIRM_POLL_MS = 5_000;
const CONFIRM_ATTEMPTS = 48;

type CanonicalAssets = {
  network: string;
  networkMagic: number;
  assets: {
    sUSD: {
      assetUnit: string;
      decimals: number;
      ownerAddress: string;
      baseUnits: string;
      canonicalForDemo: boolean;
    };
  };
};

type DeploymentReceipt = {
  name: string;
  scriptHash: string;
  scriptAddress: string;
  txHash: string;
  outputIndex: number;
  referenceUtxo: string;
};

type DeploymentManifest = {
  status: "partial" | "complete";
  network: string;
  mmAddress: string;
  validators: DeploymentReceipt[];
};

export type MmLegSide = "LONG" | "SHORT";

export type MmExecutionLeg = {
  side: MmLegSide;
  entryPrice: number;
  sizeUsd: number;
  collateralUsd: number;
  nonce: number;
  txHash: string;
  outputIndex: number;
  positionUtxo: string;
  confirmedAt: string;
  closedTxHash?: string;
  closedAt?: string;
};

export type MmExecutionState = {
  version: 1;
  network: "preprod";
  market: string;
  pairId: string;
  status: "open" | "closed";
  oracleRoundId: string;
  quoteGeneratedAt: string;
  openedAt: string;
  closedAt?: string;
  mmAddress: string;
  perpetualAddress: string;
  legs: MmExecutionLeg[];
};

export type MmExecutionRisk = {
  leverage: number;
  maxLegNotionalUsd: number;
  maxGrossNotionalUsd: number;
  maxQuoteAgeMs: number;
  maxOracleAgeMs: number;
  maxQuoteOracleDeviationBps: number;
};

function paths() {
  const root = process.cwd();
  const secretRoot = resolve(root, ".secrets");
  mkdirSync(secretRoot, { recursive: true });
  return {
    assets: resolve(root, "config", "preprod-assets.json"),
    manifest: resolve(secretRoot, "preprod-validator-deployment.json"),
    state: resolve(secretRoot, "mm-live-state.json"),
  };
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) throw new Error(`Missing required file: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function utxoRef(utxo: UTxO) {
  return `${utxo.input.txHash}#${utxo.input.outputIndex}`;
}

function quantityOf(utxo: UTxO, unit: string) {
  return BigInt(utxo.output.amount.find((asset) => asset.unit === unit)?.quantity ?? "0");
}

function wholeToBase(value: number, decimals: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error("Amount must be positive");
  const scale = 10 ** decimals;
  const scaled = Math.round(value * scale);
  if (!Number.isSafeInteger(scaled) || scaled <= 0) throw new Error("Scaled amount is outside the safe integer range");
  return BigInt(scaled);
}

function priceToBase(price: number) {
  if (!Number.isFinite(price) || price <= 0) throw new Error("Price must be positive");
  const scaled = Math.round(price * USD_SCALE);
  if (!Number.isSafeInteger(scaled) || scaled <= 0) throw new Error("Scaled price is outside the safe integer range");
  return scaled;
}

function usdToBase(value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error("USD value must be positive");
  const scaled = Math.round(value * USD_SCALE);
  if (!Number.isSafeInteger(scaled) || scaled <= 0) throw new Error("Scaled USD value is outside the safe integer range");
  return scaled;
}

function buildPositionDatum(input: {
  ownerKeyHash: string;
  market: string;
  side: MmLegSide;
  sizeUsd: number;
  collateralUsd: number;
  entryPrice: number;
  nonce: number;
}) {
  return {
    alternative: 0,
    fields: [
      input.ownerKeyHash,
      Buffer.from(input.market, "utf8").toString("hex"),
      input.side === "LONG" ? 1 : -1,
      usdToBase(input.sizeUsd),
      usdToBase(input.collateralUsd),
      priceToBase(input.entryPrice),
      input.nonce,
    ],
  };
}

function closeRedeemer() {
  return { alternative: 2, fields: [] };
}

function assertRisk(quote: TwoSidedQuote, oracle: OracleRound, risk: MmExecutionRisk, nowMs = Date.now()) {
  if (quote.market !== oracle.market) throw new Error("Quote/oracle market mismatch");
  if (!(quote.bid < quote.indexPrice && quote.indexPrice < quote.ask)) throw new Error("Invalid quote geometry");
  if (quote.notionalUsd > risk.maxLegNotionalUsd) throw new Error("MM leg notional exceeds configured maximum");
  if (quote.notionalUsd * 2 > risk.maxGrossNotionalUsd) throw new Error("MM gross quote notional exceeds configured maximum");
  if (!Number.isFinite(risk.leverage) || risk.leverage < 1 || risk.leverage > 20) throw new Error("MM leverage must be between 1x and 20x");
  const quoteAge = nowMs - new Date(quote.generatedAt).getTime();
  const oracleAge = nowMs - oracle.attestedAtMs;
  if (!Number.isFinite(quoteAge) || quoteAge < 0 || quoteAge > risk.maxQuoteAgeMs) throw new Error("Quote is stale");
  if (!Number.isFinite(oracleAge) || oracleAge < 0 || oracleAge > risk.maxOracleAgeMs) throw new Error("Oracle round is stale");
  if (oracle.sourceCount < 2) throw new Error("Oracle quorum is below two sources");
  const deviationBps = Math.abs(quote.indexPrice - oracle.price) / oracle.price * 10_000;
  if (deviationBps > risk.maxQuoteOracleDeviationBps) throw new Error("Quote index deviates too far from oracle");
  return { deviationBps, collateralUsdPerLeg: quote.notionalUsd / risk.leverage };
}

async function waitForTransactionOutputs(provider: BlockfrostProvider, txHash: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
    try {
      const outputs = await provider.fetchUTxOs(txHash);
      if (outputs.length) return outputs;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, CONFIRM_POLL_MS));
  }
  throw new Error(`Timed out waiting for Preprod transaction ${txHash}: ${String(lastError ?? "no outputs")}`);
}

export class PreprodMmExecutionAdapter {
  readonly provider: BlockfrostProvider;
  readonly wallet: MeshWallet;
  readonly mmAddress: string;
  readonly mmKeyHash: string;
  readonly susdUnit: string;
  readonly susdDecimals: number;
  readonly perpetual: DeploymentReceipt;
  readonly manifest: DeploymentManifest;
  private readonly statePath: string;

  private constructor(input: {
    provider: BlockfrostProvider;
    wallet: MeshWallet;
    mmAddress: string;
    mmKeyHash: string;
    susdUnit: string;
    susdDecimals: number;
    perpetual: DeploymentReceipt;
    manifest: DeploymentManifest;
    statePath: string;
  }) {
    Object.assign(this, input);
    this.provider = input.provider;
    this.wallet = input.wallet;
    this.mmAddress = input.mmAddress;
    this.mmKeyHash = input.mmKeyHash;
    this.susdUnit = input.susdUnit;
    this.susdDecimals = input.susdDecimals;
    this.perpetual = input.perpetual;
    this.manifest = input.manifest;
    this.statePath = input.statePath;
  }

  static async create() {
    if (config.network !== "preprod" || config.networkId !== 0) throw new Error("MM execution is pinned to Cardano Preprod");
    const p = paths();
    const assets = readJson<CanonicalAssets>(p.assets);
    const manifest = readJson<DeploymentManifest>(p.manifest);
    if (assets.network !== "preprod" || assets.networkMagic !== 1 || !assets.assets.sUSD.canonicalForDemo) {
      throw new Error("Canonical Preprod sUSD config is invalid");
    }
    if (manifest.status !== "complete" || manifest.network !== "preprod" || manifest.validators.length !== 5) {
      throw new Error("Complete five-validator Preprod manifest is required before MM execution");
    }
    const perpetual = manifest.validators.find((entry) => entry.name === "perpetual");
    if (!perpetual) throw new Error("Perpetual validator receipt is missing from deployment manifest");

    const provider = new BlockfrostProvider(config.blockfrostProjectId);
    const wallet = new MeshWallet({
      networkId: config.networkId,
      fetcher: provider,
      submitter: provider,
      key: { type: "mnemonic", words: config.mnemonic.split(/\s+/) },
    });
    await wallet.init();
    const mmAddress = await wallet.getChangeAddress();
    if (mmAddress !== manifest.mmAddress || mmAddress !== assets.assets.sUSD.ownerAddress) {
      throw new Error("MM signer/address does not match the canonical deployment");
    }
    const mmKeyHash = deserializeAddress(mmAddress).pubKeyHash;
    if (!mmKeyHash) throw new Error("Unable to derive MM payment key hash");

    const liveRefs = new Set((await provider.fetchAddressUTxOs(mmAddress)).map(utxoRef));
    if (!liveRefs.has(perpetual.referenceUtxo)) throw new Error("Perpetual reference-script UTxO is not live at the MM address");

    return new PreprodMmExecutionAdapter({
      provider,
      wallet,
      mmAddress,
      mmKeyHash,
      susdUnit: assets.assets.sUSD.assetUnit,
      susdDecimals: assets.assets.sUSD.decimals,
      perpetual,
      manifest,
      statePath: p.state,
    });
  }

  readState(): MmExecutionState | undefined {
    if (!existsSync(this.statePath)) return undefined;
    return JSON.parse(readFileSync(this.statePath, "utf8")) as MmExecutionState;
  }

  private writeState(state: MmExecutionState) {
    writeFileSync(this.statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  }

  async walletSnapshot() {
    const utxos = await this.provider.fetchAddressUTxOs(this.mmAddress);
    const protectedRefs = new Set(this.manifest.validators.map((validator) => validator.referenceUtxo));
    const spendable = utxos.filter((utxo) => !protectedRefs.has(utxoRef(utxo)));
    const susd = spendable.reduce((sum, utxo) => sum + quantityOf(utxo, this.susdUnit), 0n);
    const lovelace = spendable.reduce((sum, utxo) => sum + quantityOf(utxo, "lovelace"), 0n);
    return { utxos, spendable, protectedRefs, susd, lovelace };
  }

  private async livePerpetualUtxos() {
    return (await this.provider.fetchAddressUTxOs(this.perpetual.scriptAddress))
      .filter((utxo) => quantityOf(utxo, this.susdUnit) > 0n && Boolean(utxo.output.plutusData));
  }

  async openQuotePair(input: { quote: TwoSidedQuote; oracle: OracleRound; risk: MmExecutionRisk; pairId?: string }) {
    const existing = this.readState();
    if (existing?.status === "open") throw new Error(`MM already has an open managed pair: ${existing.pairId}`);
    const riskResult = assertRisk(input.quote, input.oracle, input.risk);
    const collateralUsd = riskResult.collateralUsdPerLeg;
    const requiredSusd = wholeToBase(collateralUsd * 2, this.susdDecimals);
    const snapshot = await this.walletSnapshot();
    if (snapshot.susd < requiredSusd) {
      throw new Error(`Insufficient spendable sUSD for MM pair: need ${requiredSusd}, observed ${snapshot.susd}`);
    }
    if (snapshot.lovelace < DEFAULT_POSITION_LOVELACE * 2n + 5_000_000n) {
      throw new Error("Insufficient spendable tADA for two position outputs and fees");
    }

    const longDatum = buildPositionDatum({
      ownerKeyHash: this.mmKeyHash,
      market: input.quote.market,
      side: "LONG",
      sizeUsd: input.quote.notionalUsd,
      collateralUsd,
      entryPrice: input.quote.bid,
      nonce: 0,
    });
    const shortDatum = buildPositionDatum({
      ownerKeyHash: this.mmKeyHash,
      market: input.quote.market,
      side: "SHORT",
      sizeUsd: input.quote.notionalUsd,
      collateralUsd,
      entryPrice: input.quote.ask,
      nonce: 0,
    });
    const collateralBase = wholeToBase(collateralUsd, this.susdDecimals).toString();
    const positionAssets = [
      { unit: "lovelace", quantity: DEFAULT_POSITION_LOVELACE.toString() },
      { unit: this.susdUnit, quantity: collateralBase },
    ];

    const unsignedTx = await new MeshTxBuilder({ fetcher: this.provider, submitter: this.provider })
      .txOut(this.perpetual.scriptAddress, positionAssets)
      .txOutInlineDatumValue(longDatum)
      .txOut(this.perpetual.scriptAddress, positionAssets)
      .txOutInlineDatumValue(shortDatum)
      .changeAddress(this.mmAddress)
      .selectUtxosFrom(snapshot.spendable)
      .complete();
    const signedTx = await this.wallet.signTx(unsignedTx);
    const txHash = await this.wallet.submitTx(signedTx);
    const outputs = await waitForTransactionOutputs(this.provider, txHash);
    const positions = outputs
      .filter((utxo) => utxo.output.address === this.perpetual.scriptAddress && quantityOf(utxo, this.susdUnit) === BigInt(collateralBase) && Boolean(utxo.output.plutusData))
      .sort((a, b) => a.input.outputIndex - b.input.outputIndex);
    if (positions.length !== 2) throw new Error(`Expected two confirmed MM position outputs, observed ${positions.length}`);

    const confirmedAt = new Date().toISOString();
    const state: MmExecutionState = {
      version: 1,
      network: "preprod",
      market: input.quote.market,
      pairId: input.pairId ?? `mm-${Date.now()}`,
      status: "open",
      oracleRoundId: input.oracle.roundId,
      quoteGeneratedAt: input.quote.generatedAt,
      openedAt: confirmedAt,
      mmAddress: this.mmAddress,
      perpetualAddress: this.perpetual.scriptAddress,
      legs: [
        {
          side: "LONG",
          entryPrice: input.quote.bid,
          sizeUsd: input.quote.notionalUsd,
          collateralUsd,
          nonce: 0,
          txHash,
          outputIndex: positions[0]!.input.outputIndex,
          positionUtxo: utxoRef(positions[0]!),
          confirmedAt,
        },
        {
          side: "SHORT",
          entryPrice: input.quote.ask,
          sizeUsd: input.quote.notionalUsd,
          collateralUsd,
          nonce: 0,
          txHash,
          outputIndex: positions[1]!.input.outputIndex,
          positionUtxo: utxoRef(positions[1]!),
          confirmedAt,
        },
      ],
    };
    this.writeState(state);
    return { state, txHash, risk: riskResult };
  }

  private async ensureCollateralUtxo() {
    const snapshot = await this.walletSnapshot();
    const pureAda = snapshot.spendable
      .filter((utxo) => utxo.output.amount.length === 1 && quantityOf(utxo, "lovelace") >= MIN_COLLATERAL_LOVELACE)
      .sort((a, b) => Number(quantityOf(b, "lovelace") - quantityOf(a, "lovelace")));
    if (pureAda[0]) return pureAda[0];

    if (snapshot.lovelace < 20_000_000n) throw new Error("Need at least 20 tADA spendable to create a dedicated Plutus collateral UTxO");
    const unsignedTx = await new MeshTxBuilder({ fetcher: this.provider, submitter: this.provider })
      .txOut(this.mmAddress, [{ unit: "lovelace", quantity: "10000000" }])
      .changeAddress(this.mmAddress)
      .selectUtxosFrom(snapshot.spendable)
      .complete();
    const signedTx = await this.wallet.signTx(unsignedTx);
    const txHash = await this.wallet.submitTx(signedTx);
    const outputs = await waitForTransactionOutputs(this.provider, txHash);
    const collateral = outputs.find((utxo) => utxo.output.address === this.mmAddress && utxo.output.amount.length === 1 && quantityOf(utxo, "lovelace") >= MIN_COLLATERAL_LOVELACE);
    if (!collateral) throw new Error("Dedicated collateral UTxO was not found after confirmation");
    return collateral;
  }

  private async closeLeg(leg: MmExecutionLeg) {
    if (leg.closedTxHash) return leg.closedTxHash;

    const livePositions = await this.livePerpetualUtxos();
    const position = livePositions.find((utxo) => utxoRef(utxo) === leg.positionUtxo);
    if (!position) {
      throw new Error(`Managed position is not in the current unspent perpetual set: ${leg.positionUtxo}`);
    }
    if (position.output.address !== this.perpetual.scriptAddress || quantityOf(position, this.susdUnit) <= 0n || !position.output.plutusData) {
      throw new Error(`Managed position no longer matches the deployed Perpetual validator: ${leg.positionUtxo}`);
    }

    const collateral = await this.ensureCollateralUtxo();

    const unsignedTx = await new MeshTxBuilder({ fetcher: this.provider, submitter: this.provider, evaluator: this.provider })
      .spendingPlutusScriptV3()
      .txIn(position.input.txHash, position.input.outputIndex, position.output.amount, position.output.address)
      .txInInlineDatumPresent()
      .txInRedeemerValue(closeRedeemer())
      .spendingTxInReference(this.perpetual.txHash, this.perpetual.outputIndex, this.perpetual.scriptHash)
      .requiredSignerHash(this.mmKeyHash)
      .txInCollateral(collateral.input.txHash, collateral.input.outputIndex, collateral.output.amount, collateral.output.address)
      .changeAddress(this.mmAddress)
      .complete();
    const signedTx = await this.wallet.signTx(unsignedTx, true);
    const txHash = await this.wallet.submitTx(signedTx);
    await waitForTransactionOutputs(this.provider, txHash);
    return txHash;
  }

  async closeManagedPair() {
    const state = this.readState();
    if (!state) throw new Error("No managed MM state exists");
    if (state.status === "closed") return state;
    if (state.mmAddress !== this.mmAddress || state.perpetualAddress !== this.perpetual.scriptAddress) {
      throw new Error("Managed MM state does not match the current deployment");
    }

    for (const leg of state.legs) {
      if (leg.closedTxHash) continue;
      const txHash = await this.closeLeg(leg);
      leg.closedTxHash = txHash;
      leg.closedAt = new Date().toISOString();
      this.writeState(state);
    }
    state.status = "closed";
    state.closedAt = new Date().toISOString();
    this.writeState(state);
    return state;
  }

  async reconcileState() {
    const state = this.readState();
    if (!state) return { state: undefined, liveLegs: 0 };

    const livePositions = await this.livePerpetualUtxos();
    const liveRefs = new Set(livePositions.map(utxoRef));
    const expectedOpenLegs = state.legs.filter((leg) => !leg.closedTxHash);
    const unexpectedlyLiveClosed = state.legs.filter((leg) => leg.closedTxHash && liveRefs.has(leg.positionUtxo));
    if (unexpectedlyLiveClosed.length) {
      throw new Error(`MM state/chain divergence: ${unexpectedlyLiveClosed.length} leg(s) are marked closed locally but remain unspent on-chain`);
    }

    const missingOpen = expectedOpenLegs.filter((leg) => !liveRefs.has(leg.positionUtxo));
    if (state.status === "open" && missingOpen.length) {
      throw new Error(`MM state/chain divergence: ${missingOpen.length} locally-open leg(s) are no longer unspent on-chain`);
    }

    const liveLegs = expectedOpenLegs.filter((leg) => liveRefs.has(leg.positionUtxo)).length;
    if (state.status === "closed" && liveLegs !== 0) {
      throw new Error(`MM state/chain divergence: closed pair still exposes ${liveLegs} live leg(s)`);
    }
    return { state, liveLegs };
  }
}
