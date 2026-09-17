"use client";

import { useEffect, useMemo, useState } from "react";
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
type LifecycleAction = "increase" | "reduce" | "close";
type OracleRound = {
  market: "BTC-USD";
  price: number;
  sourceCount: number;
  maxDeviationBps: number;
  generatedAt: string;
  roundId: string;
};
type PositionSnapshot = {
  txHash: string;
  outputIndex: number;
  positionUtxo: string;
  owner: string;
  side: "LONG" | "SHORT";
  sizeUsd: number;
  collateralUsd: number;
  entryPrice: number;
  nonce: string;
  hasInlineDatum: boolean;
};

type PositionResponse = { network: "preprod"; position: PositionSnapshot } | { error?: string };
type BuildResponse = { unsignedTx: string; action: LifecycleAction; nextPosition?: Record<string, unknown> | null; error?: string };

function quantity(utxos: UTxO[], unit: string) {
  return utxos.reduce((total, utxo) => {
    const found = utxo.output.amount.find((asset) => asset.unit === unit)?.quantity ?? "0";
    return total + BigInt(found);
  }, 0n);
}

async function readPosition(txHash: string): Promise<PositionSnapshot> {
  const response = await fetch(`/api/preprod/perp/position?txHash=${encodeURIComponent(txHash)}`, { cache: "no-store" });
  const body = await response.json() as PositionResponse;
  if (!response.ok || !("position" in body)) throw new Error("error" in body && body.error ? body.error : "Position is not visible on Preprod");
  return body.position;
}

async function waitForPosition(txHash: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 36; attempt += 1) {
    try {
      return await readPosition(txHash);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`Timed out waiting for continuation position: ${String(lastError ?? txHash)}`);
}

async function waitForConfirmation(txHash: string) {
  for (let attempt = 0; attempt < 36; attempt += 1) {
    const response = await fetch(`/api/preprod/tx?txHash=${encodeURIComponent(txHash)}`, { cache: "no-store" });
    if (response.ok) {
      const body = await response.json() as { confirmed?: boolean };
      if (body.confirmed) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("Timed out waiting for Cardano Preprod confirmation");
}

export function LivePerpLauncher() {
  const [side, setSide] = useState<Side>("LONG");
  const [sizeUsd, setSizeUsd] = useState(1_000);
  const [leverage, setLeverage] = useState(5);
  const [status, setStatus] = useState("READY — LACE PREPROD");
  const [txHash, setTxHash] = useState("");
  const [oraclePrice, setOraclePrice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [positionTxHash, setPositionTxHash] = useState(PREPROD_LIVE.perpetual.firstDemoPositionTx);
  const [position, setPosition] = useState<PositionSnapshot | null>(null);
  const [increaseSizeUsd, setIncreaseSizeUsd] = useState(100);
  const [increaseCollateralUsd, setIncreaseCollateralUsd] = useState(20);
  const [reduceSizeUsd, setReduceSizeUsd] = useState(100);

  const collateralUsd = useMemo(() => sizeUsd / leverage, [sizeUsd, leverage]);

  useEffect(() => {
    const stored = window.localStorage.getItem("symbiotic.perp.currentTx");
    const candidate = stored && /^[0-9a-f]{64}$/i.test(stored) ? stored : PREPROD_LIVE.perpetual.firstDemoPositionTx;
    setPositionTxHash(candidate);
    void refreshPosition(candidate, false);
  }, []);

  async function refreshPosition(candidate = positionTxHash, report = true) {
    if (!/^[0-9a-f]{64}$/i.test(candidate)) {
      if (report) setStatus("ERROR — ENTER A VALID POSITION TRANSACTION HASH");
      return;
    }
    try {
      if (report) setStatus("READING POSITION FROM PREPROD…");
      const current = await readPosition(candidate.toLowerCase());
      setPosition(current);
      setPositionTxHash(current.txHash);
      window.localStorage.setItem("symbiotic.perp.currentTx", current.txHash);
      if (report) setStatus(`POSITION LIVE — ${current.positionUtxo}`);
    } catch (error) {
      setPosition(null);
      if (report) setStatus(`ERROR — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

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
        .metadataValue(674, { msg: [`Symbiotic BTC-USD ${side} OPEN`, `oracle:${round.roundId.slice(0, 24)}`] })
        .changeAddress(changeAddress)
        .selectUtxosFrom(utxos)
        .complete();

      setStatus("APPROVE OPEN IN LACE…");
      const signedTx = await wallet.signTx(unsignedTx);
      setStatus("SUBMITTING OPEN TO PREPROD…");
      const submittedHash = (await wallet.submitTx(signedTx)).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(submittedHash)) throw new Error("Lace returned an invalid transaction hash");
      setTxHash(submittedHash);
      setPositionTxHash(submittedHash);
      window.localStorage.setItem("symbiotic.perp.currentTx", submittedHash);
      setStatus("OPEN SUBMITTED — WAITING FOR POSITION UTxO…");
      const confirmed = await waitForPosition(submittedHash);
      setPosition(confirmed);
      setStatus(`OPEN CONFIRMED — ${confirmed.positionUtxo}`);
    } catch (error) {
      setStatus(`ERROR — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function lifecycle(action: LifecycleAction) {
    if (busy || !position) return;
    setBusy(true);
    setTxHash("");
    try {
      setStatus("CONNECTING POSITION OWNER IN LACE…");
      const wallet = await BrowserWallet.enable("lace");
      if (await wallet.getNetworkId() !== PREPROD_LIVE.cip30NetworkId) throw new Error("Switch Lace to Cardano Preprod");
      const changeAddress = await wallet.getChangeAddress();
      const { pubKeyHash } = deserializeAddress(changeAddress);
      if (!pubKeyHash || pubKeyHash.toLowerCase() !== position.owner) throw new Error("Connected Lace account does not own this position");
      const [utxos, collateral] = await Promise.all([wallet.getUtxos(), wallet.getCollateral()]);
      if (!utxos?.length) throw new Error("Lace has no spendable UTxOs");
      if (!collateral?.length) throw new Error("Lace collateral is not configured. Create/set an ADA collateral UTxO in Lace, then retry.");

      setStatus(`BUILDING ${action.toUpperCase()} AGAINST LIVE SCRIPT UTxO…`);
      const response = await fetch("/api/preprod/perp/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          positionTxHash: position.txHash,
          changeAddress,
          walletUtxos: utxos,
          collateral: collateral[0],
          sizeDeltaUsd: action === "increase" ? increaseSizeUsd : action === "reduce" ? reduceSizeUsd : undefined,
          collateralDeltaUsd: action === "increase" ? increaseCollateralUsd : undefined,
        }),
      });
      const body = await response.json() as BuildResponse;
      if (!response.ok || !body.unsignedTx) throw new Error(body.error ?? `Unable to build ${action} transaction`);

      setStatus(`APPROVE ${action.toUpperCase()} IN LACE…`);
      const signedTx = await wallet.signTx(body.unsignedTx, true);
      setStatus(`SUBMITTING ${action.toUpperCase()} TO PREPROD…`);
      const submittedHash = (await wallet.submitTx(signedTx)).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(submittedHash)) throw new Error("Lace returned an invalid transaction hash");
      setTxHash(submittedHash);

      if (action === "close") {
        setStatus("CLOSE SUBMITTED — WAITING FOR CONFIRMATION…");
        await waitForConfirmation(submittedHash);
        setPosition(null);
        setPositionTxHash("");
        window.localStorage.removeItem("symbiotic.perp.currentTx");
        setStatus("POSITION CLOSED ON CARDANO PREPROD — COLLATERAL RETURNED");
      } else {
        setStatus(`${action.toUpperCase()} SUBMITTED — WAITING FOR CONTINUATION UTxO…`);
        const confirmed = await waitForPosition(submittedHash);
        setPosition(confirmed);
        setPositionTxHash(submittedHash);
        window.localStorage.setItem("symbiotic.perp.currentTx", submittedHash);
        setStatus(`${action.toUpperCase()} CONFIRMED — ${confirmed.positionUtxo}`);
      }
    } catch (error) {
      setStatus(`ERROR — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const smallButton = { padding: 8, border: "1px solid #333", background: "#0d0d0d", color: "#ddd", fontSize: 9, cursor: busy ? "wait" : "pointer" } as const;

  return (
    <aside style={{ position: "fixed", right: 18, bottom: 18, width: 370, maxHeight: "88vh", overflowY: "auto", zIndex: 50, border: "1px solid #262626", background: "rgba(5,5,5,.98)", boxShadow: "0 18px 60px rgba(0,0,0,.45)", padding: 16, fontFamily: "inherit" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div><div style={{ fontSize: 9, letterSpacing: ".16em", color: "#858585" }}>LIVE CARDANO PREPROD</div><strong style={{ fontSize: 16 }}>BTC-USD PERP</strong></div>
        <span style={{ fontSize: 9, color: "#b7ff5a" }}>LIFECYCLE V1</span>
      </div>

      <div style={{ borderTop: "1px solid #222", marginTop: 14, paddingTop: 12 }}>
        <div style={{ fontSize: 9, letterSpacing: ".12em", color: "#858585" }}>CHAIN POSITION</div>
        <input value={positionTxHash} onChange={(event) => setPositionTxHash(event.target.value.trim())} placeholder="position tx hash" style={{ width: "100%", marginTop: 6, padding: 8, background: "#0d0d0d", border: "1px solid #292929", color: "#f5f5f5", fontSize: 9 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 7 }}>
          <button type="button" disabled={busy} onClick={() => void refreshPosition()} style={smallButton}>REFRESH CHAIN STATE</button>
          <button type="button" disabled={busy} onClick={() => { setPositionTxHash(PREPROD_LIVE.perpetual.firstDemoPositionTx); void refreshPosition(PREPROD_LIVE.perpetual.firstDemoPositionTx); }} style={smallButton}>FIRST DEMO POSITION</button>
        </div>
        {position ? (
          <div style={{ marginTop: 9, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, fontSize: 9, color: "#777" }}>
            <span>SIDE<br /><b style={{ color: "#eee" }}>{position.side}</b></span>
            <span>SIZE<br /><b style={{ color: "#eee" }}>${position.sizeUsd.toLocaleString()}</b></span>
            <span>COLLATERAL<br /><b style={{ color: "#eee" }}>{position.collateralUsd.toFixed(2)} sUSD</b></span>
            <span>ENTRY<br /><b style={{ color: "#eee" }}>${position.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></span>
            <span>NONCE<br /><b style={{ color: "#eee" }}>{position.nonce}</b></span>
            <span>UTxO<br /><b style={{ color: "#b7ff5a" }}>{position.outputIndex}</b></span>
          </div>
        ) : <div style={{ marginTop: 8, fontSize: 9, color: "#666" }}>No live position loaded.</div>}
      </div>

      {position ? (
        <div style={{ borderTop: "1px solid #222", marginTop: 12, paddingTop: 12 }}>
          <div style={{ fontSize: 9, letterSpacing: ".12em", color: "#858585" }}>OWNER-SIGNED MANAGEMENT</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 8 }}>
            <label style={{ fontSize: 8, color: "#777" }}>INCREASE SIZE USD<input type="number" min="1" value={increaseSizeUsd} onChange={(event) => setIncreaseSizeUsd(Number(event.target.value))} style={{ width: "100%", marginTop: 4, padding: 7, background: "#0d0d0d", border: "1px solid #292929", color: "#eee" }} /></label>
            <label style={{ fontSize: 8, color: "#777" }}>ADD COLLATERAL<input type="number" min="0" value={increaseCollateralUsd} onChange={(event) => setIncreaseCollateralUsd(Number(event.target.value))} style={{ width: "100%", marginTop: 4, padding: 7, background: "#0d0d0d", border: "1px solid #292929", color: "#eee" }} /></label>
          </div>
          <button type="button" disabled={busy} onClick={() => void lifecycle("increase")} style={{ ...smallButton, width: "100%", marginTop: 7, color: "#b7ff5a" }}>INCREASE POSITION</button>
          <label style={{ display: "block", marginTop: 8, fontSize: 8, color: "#777" }}>REDUCE SIZE USD<input type="number" min="1" value={reduceSizeUsd} onChange={(event) => setReduceSizeUsd(Number(event.target.value))} style={{ width: "100%", marginTop: 4, padding: 7, background: "#0d0d0d", border: "1px solid #292929", color: "#eee" }} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 7 }}>
            <button type="button" disabled={busy} onClick={() => void lifecycle("reduce")} style={smallButton}>REDUCE POSITION</button>
            <button type="button" disabled={busy} onClick={() => void lifecycle("close")} style={{ ...smallButton, color: "#ff9e9e" }}>CLOSE + RETURN COLLATERAL</button>
          </div>
          <div style={{ marginTop: 7, fontSize: 8, lineHeight: 1.4, color: "#666" }}>Reduce keeps collateral locked under validator v0.15. Close returns the locked sUSD. Each transition increments the on-chain nonce.</div>
        </div>
      ) : null}

      <div style={{ borderTop: "1px solid #222", marginTop: 12, paddingTop: 12 }}>
        <div style={{ fontSize: 9, letterSpacing: ".12em", color: "#858585" }}>OPEN ANOTHER POSITION</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
          <button type="button" onClick={() => setSide("LONG")} style={{ padding: 8, border: "1px solid #333", background: side === "LONG" ? "#f1f1f1" : "#0d0d0d", color: side === "LONG" ? "#050505" : "#aaa" }}>LONG</button>
          <button type="button" onClick={() => setSide("SHORT")} style={{ padding: 8, border: "1px solid #333", background: side === "SHORT" ? "#f1f1f1" : "#0d0d0d", color: side === "SHORT" ? "#050505" : "#aaa" }}>SHORT</button>
        </div>
        <label style={{ display: "block", marginTop: 8, fontSize: 8, color: "#777" }}>NOTIONAL USD<input value={sizeUsd} onChange={(event) => setSizeUsd(Number(event.target.value))} type="number" min="10" max="10000" style={{ width: "100%", marginTop: 4, padding: 7, background: "#0d0d0d", border: "1px solid #292929", color: "#f5f5f5" }} /></label>
        <label style={{ display: "block", marginTop: 8, fontSize: 8, color: "#777" }}>LEVERAGE — {leverage}×<input value={leverage} onChange={(event) => setLeverage(Number(event.target.value))} type="range" min="1" max="20" style={{ width: "100%", marginTop: 6 }} /></label>
        <div style={{ marginTop: 7, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 9 }}><span style={{ color: "#777" }}>COLLATERAL<br /><b style={{ color: "#eee" }}>{collateralUsd.toFixed(2)} sUSD</b></span><span style={{ color: "#777" }}>LIVE INDEX<br /><b style={{ color: "#eee" }}>{oraclePrice ? `$${oraclePrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "ON SUBMIT"}</b></span></div>
        <button type="button" disabled={busy} onClick={() => void openPosition()} style={{ width: "100%", marginTop: 10, padding: 11, border: 0, background: busy ? "#333" : "#b7ff5a", color: "#050505", fontWeight: 800, letterSpacing: ".08em", cursor: busy ? "wait" : "pointer" }}>{busy ? "WORKING…" : `OPEN LIVE ${side}`}</button>
      </div>

      <div style={{ marginTop: 10, fontSize: 9, lineHeight: 1.5, color: status.startsWith("ERROR") ? "#ff8585" : "#8b8b8b", wordBreak: "break-word" }}>{status}</div>
      {txHash ? <a href={`https://preprod.cardanoscan.io/transaction/${txHash}`} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 8, fontSize: 10, color: "#b7ff5a", wordBreak: "break-all" }}>{txHash}</a> : null}
    </aside>
  );
}
