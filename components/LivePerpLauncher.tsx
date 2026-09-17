"use client";

import { useMemo, useState } from "react";
import {
  BrowserWallet,
  MeshTxBuilder,
  deserializeAddress,
  mConStr0,
  stringToHex,
  type UTxO,
} from "@meshsdk/core";
import { PREPROD_LIVE, priceToDatumUnits, usdToBaseUnits } from "@/lib/preprod-live";
import type { PerpOrderType, PerpSide } from "@/lib/perps";

type OracleRound = {
  market: "BTC-USD";
  price: number;
  sourceCount: number;
  maxDeviationBps: number;
  generatedAt: string;
  roundId: string;
};

type LivePerpLauncherProps = {
  side: PerpSide;
  sizeUsd: number;
  leverage: number;
  orderType: PerpOrderType;
  onSideChange(side: PerpSide): void;
  onSizeUsdChange(value: number): void;
  onLeverageChange(value: number): void;
};

function quantity(utxos: UTxO[], unit: string) {
  return utxos.reduce((total, utxo) => {
    const found = utxo.output.amount.find((asset) => asset.unit === unit)?.quantity ?? "0";
    return total + BigInt(found);
  }, 0n);
}

export function LivePerpLauncher({
  side,
  sizeUsd,
  leverage,
  orderType,
  onSideChange,
  onSizeUsdChange,
  onLeverageChange,
}: LivePerpLauncherProps) {
  const [status, setStatus] = useState("READY — LACE PREPROD");
  const [txHash, setTxHash] = useState("");
  const [oraclePrice, setOraclePrice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const collateralUsd = useMemo(() => sizeUsd / leverage, [sizeUsd, leverage]);
  const marketOrderReady = orderType === "MARKET";

  async function openPosition() {
    if (busy || !marketOrderReady) return;
    setBusy(true);
    setTxHash("");
    try {
      if (!Number.isFinite(sizeUsd) || sizeUsd < 10 || sizeUsd > 10_000) throw new Error("Live notional must be $10–$10,000");
      if (!Number.isFinite(leverage) || leverage < 1 || leverage > 20) throw new Error("Leverage must be 1–20×");

      setStatus("CONNECTING LACE…");
      const wallet = await BrowserWallet.enable("lace");
      const networkId = await wallet.getNetworkId();
      if (networkId !== PREPROD_LIVE.cip30NetworkId) throw new Error("Switch Lace to Cardano Preprod");

      const changeAddress = await wallet.getChangeAddress();
      const { pubKeyHash } = deserializeAddress(changeAddress);
      if (!pubKeyHash) throw new Error("Unable to derive Lace payment key hash");
      if (pubKeyHash.toLowerCase() !== PREPROD_LIVE.seededDemoWallet.paymentKeyHash) {
        throw new Error("Connected Lace account is not the seeded Symbiotic demo wallet");
      }

      const utxos = await wallet.getUtxos();
      if (!utxos?.length) throw new Error("Lace has no spendable Preprod UTxOs");

      const collateralBase = usdToBaseUnits(collateralUsd);
      const sizeBase = usdToBaseUnits(sizeUsd);
      const availableSusd = quantity(utxos, PREPROD_LIVE.sUsd.unit);
      if (availableSusd < collateralBase) {
        throw new Error(`Insufficient sUSD collateral: need ${collateralBase}, wallet has ${availableSusd} base units`);
      }

      setStatus("FETCHING 2-OF-3 BTC/USD ORACLE…");
      const oracleResponse = await fetch("/api/oracle/btc-usd", { cache: "no-store" });
      const oracleBody = await oracleResponse.json() as OracleRound | { error?: string };
      if (!oracleResponse.ok || !("price" in oracleBody)) {
        throw new Error("error" in oracleBody && oracleBody.error ? oracleBody.error : "Live BTC/USD oracle unavailable");
      }
      const round = oracleBody as OracleRound;
      const ageMs = Date.now() - new Date(round.generatedAt).getTime();
      if (!Number.isFinite(ageMs) || ageMs < -5_000 || ageMs > 30_000) throw new Error("Oracle round is stale");
      if (round.sourceCount < 2 || round.maxDeviationBps > 75) throw new Error("Oracle quorum failed safety bounds");
      setOraclePrice(round.price);

      const datum = mConStr0([
        pubKeyHash,
        stringToHex(PREPROD_LIVE.market),
        side === "LONG" ? 1n : -1n,
        sizeBase,
        collateralBase,
        priceToDatumUnits(round.price),
        0n,
      ]);

      setStatus("BUILDING REAL PREPROD POSITION…");
      const unsignedTx = await new MeshTxBuilder()
        .txOut(PREPROD_LIVE.perpetual.scriptAddress, [
          { unit: "lovelace", quantity: "2000000" },
          { unit: PREPROD_LIVE.sUsd.unit, quantity: collateralBase.toString() },
        ])
        .txOutInlineDatumValue(datum)
        .metadataValue(674, {
          msg: [
            `Symbiotic BTC-USD ${side} OPEN`,
            `oracle:${round.roundId.slice(0, 24)}`,
          ],
        })
        .changeAddress(changeAddress)
        .selectUtxosFrom(utxos)
        .complete();

      setStatus("APPROVE THE TRANSACTION IN LACE…");
      const signedTx = await wallet.signTx(unsignedTx);
      setStatus("SUBMITTING TO CARDANO PREPROD…");
      const submittedHash = await wallet.submitTx(signedTx);
      if (!/^[0-9a-f]{64}$/i.test(submittedHash)) throw new Error("Lace returned an invalid transaction hash");
      setTxHash(submittedHash.toLowerCase());
      setStatus("SUBMITTED — VERIFYING ON PREPROD");
    } catch (error) {
      setStatus(`ERROR — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="live-launcher">
      <div className="live-launcher-head">
        <div>
          <span className="mono-label">LIVE EXECUTION</span>
          <strong>BTC-USD PERP</strong>
        </div>
        <span className="technical-badge"><i className="status-dot status-dot-live" />PREPROD</span>
      </div>

      <div className="side-switch" role="group" aria-label="Position side">
        <button type="button" className={side === "LONG" ? "is-active" : ""} onClick={() => onSideChange("LONG")}>LONG</button>
        <button type="button" className={side === "SHORT" ? "is-active short" : ""} onClick={() => onSideChange("SHORT")}>SHORT</button>
      </div>

      <label className="trade-field">
        <span>NOTIONAL USD</span>
        <input value={sizeUsd} onChange={(event) => onSizeUsdChange(Number(event.target.value))} type="number" min="10" max="10000" />
      </label>

      <label className="trade-field range-field">
        <span>LEVERAGE <b>{leverage}×</b></span>
        <input value={leverage} onChange={(event) => onLeverageChange(Number(event.target.value))} type="range" min="1" max="20" />
      </label>

      <div className="execution-summary">
        <div><span>COLLATERAL</span><b>{collateralUsd.toFixed(2)} sUSD</b></div>
        <div><span>LIVE INDEX</span><b>{oraclePrice ? `$${oraclePrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "ON SUBMIT"}</b></div>
        <div><span>NETWORK</span><b>CARDANO PREPROD</b></div>
        <div><span>SETTLEMENT</span><b>POSITION UTxO</b></div>
      </div>

      {!marketOrderReady ? (
        <div className="execution-warning">LIVE WALLET SUBMISSION IS CURRENTLY MARKET-ORDER ONLY. {orderType.replace("_", " ")} REMAINS A LOCAL VALIDATION PREVIEW.</div>
      ) : null}

      <button className="execute-button" type="button" disabled={busy || !marketOrderReady} onClick={openPosition}>
        {busy ? "BUILDING TRANSACTION…" : marketOrderReady ? `OPEN LIVE ${side}` : "MARKET ORDER REQUIRED"}
      </button>

      <div className={status.startsWith("ERROR") ? "execution-status is-error" : "execution-status"} aria-live="polite">{status}</div>
      {txHash ? (
        <a className="tx-link" href={`https://preprod.cardanoscan.io/transaction/${txHash}`} target="_blank" rel="noreferrer">
          VIEW TRANSACTION ↗<span>{txHash}</span>
        </a>
      ) : null}
    </div>
  );
}
