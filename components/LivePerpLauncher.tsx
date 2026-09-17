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

type Side = "LONG" | "SHORT";
type OracleRound = {
  market: "BTC-USD";
  price: number;
  sourceCount: number;
  maxDeviationBps: number;
  generatedAt: string;
  roundId: string;
};

function quantity(utxos: UTxO[], unit: string) {
  return utxos.reduce((total, utxo) => {
    const found = utxo.output.amount.find((asset) => asset.unit === unit)?.quantity ?? "0";
    return total + BigInt(found);
  }, 0n);
}

export function LivePerpLauncher() {
  const [side, setSide] = useState<Side>("LONG");
  const [sizeUsd, setSizeUsd] = useState(1_000);
  const [leverage, setLeverage] = useState(5);
  const [status, setStatus] = useState("READY — LACE PREPROD");
  const [txHash, setTxHash] = useState("");
  const [oraclePrice, setOraclePrice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const collateralUsd = useMemo(() => sizeUsd / leverage, [sizeUsd, leverage]);

  async function openPosition() {
    if (busy) return;
    setBusy(true);
    setTxHash("");
    try {
      if (!Number.isFinite(sizeUsd) || sizeUsd < 10 || sizeUsd > 10_000) throw new Error("Demo notional must be $10–$10,000");
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
    <aside style={{
      position: "fixed",
      right: 18,
      bottom: 18,
      width: 340,
      zIndex: 50,
      border: "1px solid #262626",
      background: "rgba(5,5,5,.97)",
      boxShadow: "0 18px 60px rgba(0,0,0,.45)",
      padding: 16,
      fontFamily: "inherit",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: ".16em", color: "#858585" }}>LIVE CARDANO PREPROD</div>
          <strong style={{ fontSize: 16 }}>BTC-USD PERP</strong>
        </div>
        <span style={{ fontSize: 9, color: "#b7ff5a" }}>sUSD COLLATERAL</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
        <button type="button" onClick={() => setSide("LONG")} style={{ padding: 9, border: "1px solid #333", background: side === "LONG" ? "#f1f1f1" : "#0d0d0d", color: side === "LONG" ? "#050505" : "#aaa" }}>LONG</button>
        <button type="button" onClick={() => setSide("SHORT")} style={{ padding: 9, border: "1px solid #333", background: side === "SHORT" ? "#f1f1f1" : "#0d0d0d", color: side === "SHORT" ? "#050505" : "#aaa" }}>SHORT</button>
      </div>

      <label style={{ display: "block", marginTop: 12, fontSize: 9, letterSpacing: ".12em", color: "#858585" }}>
        NOTIONAL USD
        <input value={sizeUsd} onChange={(event) => setSizeUsd(Number(event.target.value))} type="number" min="10" max="10000" style={{ width: "100%", marginTop: 5, padding: 9, background: "#0d0d0d", border: "1px solid #292929", color: "#f5f5f5" }} />
      </label>
      <label style={{ display: "block", marginTop: 10, fontSize: 9, letterSpacing: ".12em", color: "#858585" }}>
        LEVERAGE — {leverage}×
        <input value={leverage} onChange={(event) => setLeverage(Number(event.target.value))} type="range" min="1" max="20" style={{ width: "100%", marginTop: 8 }} />
      </label>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 10 }}>
        <span style={{ color: "#777" }}>COLLATERAL<br /><b style={{ color: "#eee" }}>{collateralUsd.toFixed(2)} sUSD</b></span>
        <span style={{ color: "#777" }}>LIVE INDEX<br /><b style={{ color: "#eee" }}>{oraclePrice ? `$${oraclePrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "ON SUBMIT"}</b></span>
      </div>

      <button type="button" disabled={busy} onClick={openPosition} style={{ width: "100%", marginTop: 14, padding: 12, border: 0, background: busy ? "#333" : "#b7ff5a", color: "#050505", fontWeight: 800, letterSpacing: ".08em", cursor: busy ? "wait" : "pointer" }}>
        {busy ? "WORKING…" : `OPEN LIVE ${side}`}
      </button>
      <div style={{ marginTop: 10, fontSize: 9, lineHeight: 1.5, color: status.startsWith("ERROR") ? "#ff8585" : "#8b8b8b", wordBreak: "break-word" }}>{status}</div>
      {txHash ? (
        <a href={`https://preprod.cardanoscan.io/transaction/${txHash}`} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 8, fontSize: 10, color: "#b7ff5a", wordBreak: "break-all" }}>
          {txHash}
        </a>
      ) : null}
    </aside>
  );
}
