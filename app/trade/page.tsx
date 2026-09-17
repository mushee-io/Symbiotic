"use client";

import { useMemo, useState } from "react";
import { WalletButton } from "@/components/WalletButton";
import {
  calculateFundingPayment,
  calculateFundingRate,
  calculatePerp,
  calculateTradingFee,
  validatePerpOrder,
  type PerpOrderType,
  type PerpSide
} from "@/lib/perps";
import {
  optionBreakEven,
  priceEuropeanOption,
  requiredWriterCollateral,
  type OptionKind
} from "@/lib/options";
import { createIntentCommitment, randomNonce, randomSalt, type HiddenIntent } from "@/lib/notional";
import { evaluatePortfolioRisk } from "@/lib/risk";

type View = "PERPETUALS" | "OPTIONS" | "NOTIONAL";
const money = (value: number) => Number.isFinite(value) ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—";

export default function Home() {
  const [view, setView] = useState<View>("PERPETUALS");
  const [side, setSide] = useState<PerpSide>("LONG");
  const [orderType, setOrderType] = useState<PerpOrderType>("MARKET");
  const [entry, setEntry] = useState(60_000);
  const [mark, setMark] = useState(60_000);
  const [indexPrice, setIndexPrice] = useState(59_950);
  const [size, setSize] = useState(1_000);
  const [leverage, setLeverage] = useState(5);
  const [triggerPrice, setTriggerPrice] = useState(58_000);
  const [accountCollateral, setAccountCollateral] = useState(3_000);

  const perp = useMemo(() => {
    try { return calculatePerp({ side, entryPrice: entry, markPrice: mark, sizeUsd: size, leverage }); }
    catch { return null; }
  }, [side, entry, mark, size, leverage]);

  const fundingRate = useMemo(() => {
    try { return calculateFundingRate({ markPrice: mark, indexPrice }); }
    catch { return 0; }
  }, [mark, indexPrice]);

  const fundingPayment = useMemo(() => {
    try { return calculateFundingPayment({ side, positionNotionalUsd: size, fundingRate }); }
    catch { return 0; }
  }, [side, size, fundingRate]);

  const takerFee = useMemo(() => {
    try { return calculateTradingFee(size, "TAKER"); }
    catch { return 0; }
  }, [size]);

  const orderValidation = useMemo(() => {
    try {
      validatePerpOrder({
        market: "BTC-USD",
        side,
        type: orderType,
        sizeUsd: size,
        leverage,
        limitPrice: orderType === "LIMIT" ? entry : undefined,
        triggerPrice: orderType === "STOP_MARKET" || orderType === "TAKE_PROFIT" ? triggerPrice : undefined
      });
      return "VALID PREVIEW";
    } catch (error) {
      return error instanceof Error ? error.message : "INVALID ORDER";
    }
  }, [side, orderType, size, leverage, entry, triggerPrice]);

  const portfolio = useMemo(() => {
    try {
      return evaluatePortfolioRisk({
        collateralUsd: accountCollateral,
        positions: [{ id: "preview", market: "BTC-USD", side, entryPrice: entry, markPrice: mark, sizeUsd: size, leverage }]
      });
    } catch { return null; }
  }, [accountCollateral, side, entry, mark, size, leverage]);

  const [kind, setKind] = useState<OptionKind>("CALL");
  const [spot, setSpot] = useState(60_000);
  const [strike, setStrike] = useState(65_000);
  const [days, setDays] = useState(30);
  const [vol, setVol] = useState(0.65);
  const [contracts, setContracts] = useState(1);

  const option = useMemo(() => {
    try { return priceEuropeanOption({ kind, spot, strike, daysToExpiry: days, volatility: vol }); }
    catch { return null; }
  }, [kind, spot, strike, days, vol]);

  const writerCollateral = useMemo(() => {
    try { return requiredWriterCollateral({ kind, strike, contracts }); }
    catch { return null; }
  }, [kind, strike, contracts]);

  const breakEven = useMemo(() => {
    try { return option ? optionBreakEven(kind, strike, option.price) : 0; }
    catch { return 0; }
  }, [kind, strike, option]);

  const [intent, setIntent] = useState<HiddenIntent>({
    market: "BTC-USD",
    side: "BUY",
    size: "1.00",
    limitPrice: "60000",
    expiry: "2026-10-01T12:00:00Z",
    nonce: "0123456789abcdef0123456789abcdef",
    chainId: "cardano-preprod",
    maxSlippageBps: 50
  });
  const [commitment, setCommitment] = useState("");
  const [secretSalt, setSecretSalt] = useState("");
  const [intentError, setIntentError] = useState("");

  async function prepareCommitment() {
    try {
      setIntentError("");
      const salt = randomSalt();
      const hash = await createIntentCommitment(intent, salt);
      setSecretSalt(salt);
      setCommitment(hash);
    } catch (error) {
      setIntentError(error instanceof Error ? error.message : "Unable to create commitment");
    }
  }

  function rotateNonce() {
    setIntent({ ...intent, nonce: randomNonce() });
    setCommitment("");
    setSecretSalt("");
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span>S</span>SYMBIOTIC</div>
        <nav>
          {(["PERPETUALS", "OPTIONS", "NOTIONAL"] as View[]).map((item) => (
            <button key={item} className={view === item ? "nav-active" : ""} onClick={() => setView(item)}>{item === "NOTIONAL" ? "NOTIONAL MARKET" : item}</button>
          ))}
          <a href="/status" style={{ color: "#818181", padding: "10px 12px", fontSize: 10, letterSpacing: ".1em", textDecoration: "none" }}>STATUS</a>
        </nav>
        <WalletButton />
      </header>

      {view === "PERPETUALS" ? (
        <section className="terminal">
          <div className="workspace">
            <div className="market-header"><div><p>PERPETUAL / EXECUTION FOUNDATION V3</p><h1>BTC-USD PERP</h1></div><div className="chips"><span>CARDANO</span><span>PREPROD TARGET</span><span>{orderType}</span></div></div>
            <div className="chart"><p>ORACLE QUORUM + CIP-30 EXECUTION LAYER IMPLEMENTED</p><strong>{money(mark)}</strong><small>Local preview values are never treated as authoritative chain state.</small></div>
            <div className="metrics">
              <div><span>NOTIONAL</span><b>{money(size)}</b></div>
              <div><span>INITIAL MARGIN</span><b>{perp ? money(perp.initialMargin) : "—"}</b></div>
              <div><span>LIQUIDATION</span><b>{perp ? money(perp.liquidationPrice) : "—"}</b></div>
              <div><span>8H FUNDING</span><b>{(fundingRate * 100).toFixed(4)}%</b></div>
            </div>
            <div className="position-table"><div className="row head"><span>SIDE</span><span>PNL</span><span>HEALTH</span><span>TAKER FEE</span><span>STATE</span></div><div className="row"><span>{side}</span><span>{perp ? money(perp.unrealizedPnl) : "—"}</span><span>{portfolio ? (Number.isFinite(portfolio.healthFactor) ? portfolio.healthFactor.toFixed(2) : "∞") : "—"}</span><span>{money(takerFee)}</span><span className="acid">{orderValidation}</span></div></div>
          </div>
          <aside className="ticket">
            <p className="label">ADVANCED PERPETUAL TICKET</p>
            <div className="toggle"><button className={side === "LONG" ? "selected" : ""} onClick={() => setSide("LONG")}>LONG</button><button className={side === "SHORT" ? "selected" : ""} onClick={() => setSide("SHORT")}>SHORT</button></div>
            <label>ORDER TYPE<select value={orderType} onChange={(e) => setOrderType(e.target.value as PerpOrderType)}><option>MARKET</option><option>LIMIT</option><option>STOP_MARKET</option><option>TAKE_PROFIT</option></select></label>
            <label>ENTRY / LIMIT PRICE<input type="number" min="1" value={entry} onChange={(e) => setEntry(Number(e.target.value))} /></label>
            <label>MARK PRICE<input type="number" min="1" value={mark} onChange={(e) => setMark(Number(e.target.value))} /></label>
            <label>INDEX PRICE<input type="number" min="1" value={indexPrice} onChange={(e) => setIndexPrice(Number(e.target.value))} /></label>
            {(orderType === "STOP_MARKET" || orderType === "TAKE_PROFIT") ? <label>TRIGGER PRICE<input type="number" min="1" value={triggerPrice} onChange={(e) => setTriggerPrice(Number(e.target.value))} /></label> : null}
            <label>SIZE USD<input type="number" min="1" value={size} onChange={(e) => setSize(Number(e.target.value))} /></label>
            <label>ACCOUNT COLLATERAL<input type="number" min="0" value={accountCollateral} onChange={(e) => setAccountCollateral(Number(e.target.value))} /></label>
            <label>LEVERAGE <b>{leverage}×</b><input type="range" min="1" max="20" value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} /></label>
            <div className="summary"><span>Funding cashflow<b>{money(fundingPayment)}</b></span><span>Portfolio equity<b>{portfolio ? money(portfolio.equityUsd) : "—"}</b></span><span>Available collateral<b>{portfolio ? money(portfolio.availableCollateralUsd) : "—"}</b></span><span>Liquidation buffer<b>{portfolio ? money(portfolio.liquidationBufferUsd) : "—"}</b></span></div>
            <button className="disabled" disabled>VALIDATORS NOT DEPLOYED</button>
            <p className="fine">CIP-30 signing, backend assembly, oracle quorum, indexer state and keeper authorization are implemented. Trading remains fail-closed until the required Cardano validators are deployed and readiness turns green.</p>
          </aside>
        </section>
      ) : null}

      {view === "OPTIONS" ? (
        <section className="terminal">
          <div className="workspace">
            <div className="market-header"><div><p>OPTIONS / QUORUM-SETTLED EUROPEAN V1</p><h1>BTC OPTIONS</h1></div><div className="chips"><span>CALLS</span><span>PUTS</span><span>EXPIRY ONLY</span></div></div>
            <div className="metrics"><div><span>REFERENCE SPOT</span><b>{money(spot)}</b></div><div><span>STRIKE</span><b>{money(strike)}</b></div><div><span>BREAK EVEN</span><b>{money(breakEven)}</b></div><div><span>MODEL PREMIUM</span><b>{option ? money(option.price) : "—"}</b></div></div>
            <div className="option-hero"><p>MODEL OUTPUT / SETTLEMENT REQUIRES ORACLE QUORUM</p><strong>{option ? money(option.price) : "—"}</strong><div className="greeks"><span>DELTA<b>{option?.delta.toFixed(4) ?? "—"}</b></span><span>GAMMA<b>{option?.gamma.toFixed(6) ?? "—"}</b></span><span>VEGA<b>{option?.vega.toFixed(4) ?? "—"}</b></span><span>THETA/D<b>{option?.theta.toFixed(4) ?? "—"}</b></span></div></div>
          </div>
          <aside className="ticket">
            <p className="label">OPTION TICKET</p>
            <div className="toggle"><button className={kind === "CALL" ? "selected" : ""} onClick={() => setKind("CALL")}>CALL</button><button className={kind === "PUT" ? "selected" : ""} onClick={() => setKind("PUT")}>PUT</button></div>
            <label>REFERENCE SPOT<input type="number" value={spot} onChange={(e) => setSpot(Number(e.target.value))} /></label>
            <label>STRIKE<input type="number" value={strike} onChange={(e) => setStrike(Number(e.target.value))} /></label>
            <label>CONTRACTS<input type="number" min="1" value={contracts} onChange={(e) => setContracts(Number(e.target.value))} /></label>
            <label>DAYS TO EXPIRY<input type="number" min="1" value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
            <label>VOLATILITY<input type="number" min="0.01" step="0.01" value={vol} onChange={(e) => setVol(Number(e.target.value))} /></label>
            <div className="summary"><span>Writer collateral asset<b>{writerCollateral?.asset ?? "—"}</b></span><span>Writer collateral amount<b>{writerCollateral ? writerCollateral.amount.toLocaleString() : "—"}</b></span><span>Buyer max loss<b>{option ? money(option.price * contracts) : "—"}</b></span></div>
            <button className="disabled" disabled>OPTIONS VALIDATOR NOT DEPLOYED</button>
          </aside>
        </section>
      ) : null}

      {view === "NOTIONAL" ? (
        <section className="notional">
          <div className="notional-copy"><p className="label">NOTIONAL MARKET / PRIVATE PRE-TRADE INTENT</p><h1>HIDE THE INTENT.<br /><span>BOUND THE EXECUTION.</span></h1><p>Notional commits market, direction, size, limit, expiry, chain, slippage and a one-time nonce. Reveal verification and replay controls are implemented; normal Cardano L1 settlement remains public.</p><div className="steps"><span>01 / Compose locally</span><span>02 / Salt + commit</span><span>03 / Match private intent</span><span>04 / Consume nonce + settle bounds</span></div></div>
          <aside className="ticket private">
            <p className="label">LOCAL PRIVATE INTENT V1</p>
            <label>NETWORK<input value={intent.chainId} onChange={(e) => setIntent({ ...intent, chainId: e.target.value })} /></label>
            <label>MARKET<input value={intent.market} onChange={(e) => setIntent({ ...intent, market: e.target.value })} /></label>
            <div className="toggle"><button className={intent.side === "BUY" ? "selected" : ""} onClick={() => setIntent({ ...intent, side: "BUY" })}>BUY</button><button className={intent.side === "SELL" ? "selected" : ""} onClick={() => setIntent({ ...intent, side: "SELL" })}>SELL</button></div>
            <label>HIDDEN SIZE<input value={intent.size} onChange={(e) => setIntent({ ...intent, size: e.target.value })} /></label>
            <label>HIDDEN LIMIT PRICE<input value={intent.limitPrice} onChange={(e) => setIntent({ ...intent, limitPrice: e.target.value })} /></label>
            <label>MAX SLIPPAGE BPS<input type="number" min="0" max="2000" value={intent.maxSlippageBps} onChange={(e) => setIntent({ ...intent, maxSlippageBps: Number(e.target.value) })} /></label>
            <label>EXPIRY<input value={intent.expiry} onChange={(e) => setIntent({ ...intent, expiry: e.target.value })} /></label>
            <label>NONCE<input value={intent.nonce} readOnly /></label>
            <button className="action" onClick={rotateNonce}>ROTATE NONCE</button>
            <button className="action" onClick={prepareCommitment}>GENERATE COMMITMENT</button>
            {intentError ? <p className="error">{intentError}</p> : null}
            {commitment ? <div className="commit"><span>PUBLIC COMMITMENT</span><code>{commitment}</code><span>LOCAL SECRET SALT — DO NOT PUBLISH</span><code className="muted">{secretSalt}</code></div> : null}
            <p className="fine">Pre-trade concealment only. The readiness gate does not claim confidential L1 settlement.</p>
          </aside>
        </section>
      ) : null}

      <footer><span>SYMBIOTIC / CARDANO DERIVATIVES</span><span>MILESTONES 11–15 / FAIL CLOSED</span></footer>
    </main>
  );
}
