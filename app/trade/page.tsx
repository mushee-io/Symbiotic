"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { WalletButton } from "@/components/WalletButton";
import { LivePerpLauncher } from "@/components/LivePerpLauncher";
import {
  calculateFundingPayment,
  calculateFundingRate,
  calculatePerp,
  calculateTradingFee,
  validatePerpOrder,
  type PerpOrderType,
  type PerpSide,
} from "@/lib/perps";
import {
  optionBreakEven,
  priceEuropeanOption,
  requiredWriterCollateral,
  type OptionKind,
} from "@/lib/options";
import { createIntentCommitment, randomNonce, randomSalt, type HiddenIntent } from "@/lib/notional";
import { evaluatePortfolioRisk } from "@/lib/risk";

type View = "PERPETUALS" | "OPTIONS" | "NOTIONAL";

const money = (value: number) => Number.isFinite(value)
  ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  : "—";

const navLabel: Record<View, string> = {
  PERPETUALS: "PERPETUALS",
  OPTIONS: "OPTIONS",
  NOTIONAL: "NOTIONAL MARKET",
};

export default function TradePage() {
  const [view, setView] = useState<View>("PERPETUALS");
  const [side, setSide] = useState<PerpSide>("LONG");
  const [orderType, setOrderType] = useState<PerpOrderType>("MARKET");
  const [entry, setEntry] = useState(60_000);
  const [mark, setMark] = useState(60_000);
  const [indexPrice, setIndexPrice] = useState(59_950);
  const [size, setSize] = useState(1_000);
  const [leverage, setLeverage] = useState(5);
  const [triggerPrice, setTriggerPrice] = useState(58_000);
  const [accountCollateral] = useState(3_000);

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
        triggerPrice: orderType === "STOP_MARKET" || orderType === "TAKE_PROFIT" ? triggerPrice : undefined,
      });
      return "VALID";
    } catch (error) {
      return error instanceof Error ? error.message : "INVALID ORDER";
    }
  }, [side, orderType, size, leverage, entry, triggerPrice]);

  const portfolio = useMemo(() => {
    try {
      return evaluatePortfolioRisk({
        collateralUsd: accountCollateral,
        positions: [{ id: "preview", market: "BTC-USD", side, entryPrice: entry, markPrice: mark, sizeUsd: size, leverage }],
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
    maxSlippageBps: 50,
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

  function chooseOrderMode(mode: "MARKET" | "LIMIT" | "TRIGGER") {
    if (mode === "MARKET") setOrderType("MARKET");
    if (mode === "LIMIT") setOrderType("LIMIT");
    if (mode === "TRIGGER") setOrderType("STOP_MARKET");
  }

  const triggerMode = orderType === "STOP_MARKET" || orderType === "TAKE_PROFIT";

  return (
    <main className="terminal-app">
      <header className="terminal-nav">
        <Link className="terminal-brand" href="/" aria-label="Symbiotic home">
          <span>S</span><b>SYMBIOTIC</b>
        </Link>
        <nav>
          {(Object.keys(navLabel) as View[]).map((item) => (
            <button key={item} className={view === item ? "is-active" : ""} onClick={() => setView(item)}>{navLabel[item]}</button>
          ))}
          <a href="https://github.com/mushee-io/Symbiotic" target="_blank" rel="noreferrer">GITHUB</a>
        </nav>
        <div className="terminal-nav-actions">
          <span className="technical-badge"><i className="status-dot status-dot-live" />PREPROD</span>
          <WalletButton />
        </div>
      </header>

      {view === "PERPETUALS" ? (
        <>
          <section className="market-tape">
            <div className="market-identity">
              <span className="mono-label">PERPETUAL / CARDANO</span>
              <strong>BTC-USD PERP</strong>
            </div>
            <div><span>MARK</span><b>{money(mark)}</b></div>
            <div><span>INDEX</span><b>{money(indexPrice)}</b></div>
            <div><span>24H</span><b>—</b></div>
            <div><span>8H FUNDING</span><b>{(fundingRate * 100).toFixed(4)}%</b></div>
            <div><span>OPEN INTEREST</span><b>—</b></div>
            <div><span>ORACLE</span><b className="live-text"><i className="status-dot status-dot-live" />LIVE</b></div>
          </section>

          <section className="terminal-core">
            <div className="chart-column">
              <div className="panel-tabs">
                <div><button className="is-active">CHART</button><button>DEPTH</button><button>MARKET INFO</button></div>
                <div className="intervals"><button className="is-active">1m</button><button>5m</button><button>15m</button><button>1H</button><button>4H</button><button>1D</button></div>
              </div>
              <div className="chart">
                <p>FETCHING LIVE BTC/USD MARKET STATE…</p>
                <strong>{money(mark)}</strong>
                <small>Coinbase candles + multi-source quorum index</small>
              </div>
              <div className="chart-foot">
                <span><b>SETTLEMENT</b>CARDANO PREPROD</span>
                <span><b>POSITION MODEL</b>UTxO + INLINE DATUM</span>
                <span><b>MAX LEVERAGE</b>20×</span>
                <span><b>VALIDATION</b>{orderValidation}</span>
              </div>
            </div>

            <aside className="orderbook-column">
              <div className="panel-title"><span>ORDER BOOK</span><small>BTC-USD</small></div>
              <div className="book-head"><span>PRICE</span><span>SIZE</span><span>TOTAL</span></div>
              <div className="book-empty book-asks"><span>—</span><small>Venue depth is not indexed in this web deployment.</small></div>
              <div className="book-spread"><span>MARK</span><b>{money(mark)}</b></div>
              <div className="book-empty book-bids"><span>—</span><small>No synthetic orders are displayed.</small></div>
              <div className="recent-trades">
                <div className="panel-title"><span>RECENT TRADES</span><small>ONCHAIN</small></div>
                <div className="intentional-empty">—<small>Transaction-indexed fills will appear here.</small></div>
              </div>
            </aside>

            <aside className="order-entry ticket">
              <div className="panel-title"><span>ORDER ENTRY</span><small>{orderType.replace("_", " ")}</small></div>
              <div className="order-mode-switch">
                <button className={orderType === "MARKET" ? "is-active" : ""} onClick={() => chooseOrderMode("MARKET")}>MARKET</button>
                <button className={orderType === "LIMIT" ? "is-active" : ""} onClick={() => chooseOrderMode("LIMIT")}>LIMIT</button>
                <button className={triggerMode ? "is-active" : ""} onClick={() => chooseOrderMode("TRIGGER")}>TRIGGER</button>
              </div>

              {orderType === "LIMIT" ? (
                <label className="trade-field"><span>LIMIT PRICE</span><input type="number" min="1" value={entry} onChange={(e) => setEntry(Number(e.target.value))} /></label>
              ) : null}

              {triggerMode ? (
                <>
                  <div className="sub-mode-switch">
                    <button className={orderType === "STOP_MARKET" ? "is-active" : ""} onClick={() => setOrderType("STOP_MARKET")}>STOP</button>
                    <button className={orderType === "TAKE_PROFIT" ? "is-active" : ""} onClick={() => setOrderType("TAKE_PROFIT")}>TAKE PROFIT</button>
                  </div>
                  <label className="trade-field"><span>TRIGGER PRICE</span><input type="number" min="1" value={triggerPrice} onChange={(e) => setTriggerPrice(Number(e.target.value))} /></label>
                </>
              ) : null}

              <div className="bridge-inputs" aria-hidden="true">
                <label>MARK PRICE<input type="number" value={mark} onChange={(e) => setMark(Number(e.target.value))} /></label>
                <label>INDEX PRICE<input type="number" value={indexPrice} onChange={(e) => setIndexPrice(Number(e.target.value))} /></label>
                <label>ENTRY / LIMIT PRICE<input type="number" value={entry} onChange={(e) => setEntry(Number(e.target.value))} /></label>
                <select value={orderType} onChange={(e) => setOrderType(e.target.value as PerpOrderType)}><option>MARKET</option><option>LIMIT</option><option>STOP_MARKET</option><option>TAKE_PROFIT</option></select>
              </div>

              <LivePerpLauncher
                side={side}
                sizeUsd={size}
                leverage={leverage}
                orderType={orderType}
                onSideChange={setSide}
                onSizeUsdChange={setSize}
                onLeverageChange={setLeverage}
              />

              <div className="risk-readout">
                <span><b>INITIAL MARGIN</b>{perp ? money(perp.initialMargin) : "—"}</span>
                <span><b>EST. LIQUIDATION</b>{perp ? money(perp.liquidationPrice) : "—"}</span>
                <span><b>TAKER FEE</b>{money(takerFee)}</span>
                <span><b>FUNDING CASHFLOW</b>{money(fundingPayment)}</span>
                <span><b>PORTFOLIO HEALTH</b>{portfolio ? (Number.isFinite(portfolio.healthFactor) ? portfolio.healthFactor.toFixed(2) : "∞") : "—"}</span>
              </div>
            </aside>
          </section>

          <section className="terminal-ledger">
            <div className="ledger-tabs">
              <button className="is-active">POSITIONS</button><button>OPEN ORDERS</button><button>ORDER HISTORY</button><button>TRADES</button><button>FUNDING</button><button>TRANSACTIONS</button>
            </div>
            <div className="ledger-head"><span>MARKET</span><span>SIDE</span><span>SIZE</span><span>ENTRY</span><span>MARK</span><span>LIQ. PRICE</span><span>PNL</span><span>ACTION</span></div>
            <div className="ledger-empty"><b>POSITION INDEXER NOT CONNECTED TO THIS WEB VIEW</b><span>Live position creation settles on Cardano Preprod. This table intentionally does not invent portfolio state.</span></div>
          </section>
        </>
      ) : null}

      {view === "OPTIONS" ? (
        <section className="product-terminal">
          <div className="product-main">
            <div className="product-kicker">OPTIONS / EUROPEAN / ORACLE SETTLED</div>
            <h1>PRICE THE PAYOFF.<br /><span>SETTLE THE STATE.</span></h1>
            <div className="product-metrics">
              <div><span>REFERENCE SPOT</span><b>{money(spot)}</b></div>
              <div><span>STRIKE</span><b>{money(strike)}</b></div>
              <div><span>BREAK EVEN</span><b>{money(breakEven)}</b></div>
              <div><span>MODEL PREMIUM</span><b>{option ? money(option.price) : "—"}</b></div>
            </div>
            <div className="greeks-grid">
              <span>DELTA<b>{option?.delta.toFixed(4) ?? "—"}</b></span>
              <span>GAMMA<b>{option?.gamma.toFixed(6) ?? "—"}</b></span>
              <span>VEGA<b>{option?.vega.toFixed(4) ?? "—"}</b></span>
              <span>THETA / DAY<b>{option?.theta.toFixed(4) ?? "—"}</b></span>
            </div>
          </div>
          <aside className="product-ticket ticket">
            <span className="mono-label">OPTION TICKET / MODEL PREVIEW</span>
            <div className="side-switch"><button className={kind === "CALL" ? "is-active" : ""} onClick={() => setKind("CALL")}>CALL</button><button className={kind === "PUT" ? "is-active" : ""} onClick={() => setKind("PUT")}>PUT</button></div>
            <label className="trade-field"><span>REFERENCE SPOT</span><input type="number" value={spot} onChange={(e) => setSpot(Number(e.target.value))} /></label>
            <label className="trade-field"><span>STRIKE</span><input type="number" value={strike} onChange={(e) => setStrike(Number(e.target.value))} /></label>
            <label className="trade-field"><span>CONTRACTS</span><input type="number" min="1" value={contracts} onChange={(e) => setContracts(Number(e.target.value))} /></label>
            <label className="trade-field"><span>DAYS TO EXPIRY</span><input type="number" min="1" value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
            <label className="trade-field"><span>VOLATILITY</span><input type="number" min="0.01" step="0.01" value={vol} onChange={(e) => setVol(Number(e.target.value))} /></label>
            <div className="execution-summary"><div><span>WRITER COLLATERAL</span><b>{writerCollateral ? `${writerCollateral.amount.toLocaleString()} ${writerCollateral.asset}` : "—"}</b></div><div><span>BUYER MAX LOSS</span><b>{option ? money(option.price * contracts) : "—"}</b></div></div>
            <div className="execution-warning">OPTIONS CONTRACT LOGIC EXISTS, BUT THIS WEB DEPLOYMENT DOES NOT CLAIM A LIVE SETTLEMENT PATH UNTIL THE RELEASE EVIDENCE IS CONNECTED.</div>
          </aside>
        </section>
      ) : null}

      {view === "NOTIONAL" ? (
        <section className="product-terminal">
          <div className="product-main notional-main">
            <div className="product-kicker">NOTIONAL MARKET / PRIVATE PRE-TRADE INTENT</div>
            <h1>HIDE THE INTENT.<br /><span>BOUND THE EXECUTION.</span></h1>
            <p>Commit market, direction, size, limit, expiry, chain, slippage and a one-time nonce locally. Public Cardano settlement remains explicit.</p>
            <div className="notional-flow"><span>01 / COMPOSE</span><span>02 / SALT + COMMIT</span><span>03 / SOLVER COMPETITION</span><span>04 / SETTLE BOUNDS</span></div>
          </div>
          <aside className="product-ticket ticket">
            <span className="mono-label">LOCAL PRIVATE INTENT V1</span>
            <label className="trade-field"><span>NETWORK</span><input value={intent.chainId} onChange={(e) => setIntent({ ...intent, chainId: e.target.value })} /></label>
            <label className="trade-field"><span>MARKET</span><input value={intent.market} onChange={(e) => setIntent({ ...intent, market: e.target.value })} /></label>
            <div className="side-switch"><button className={intent.side === "BUY" ? "is-active" : ""} onClick={() => setIntent({ ...intent, side: "BUY" })}>BUY</button><button className={intent.side === "SELL" ? "is-active" : ""} onClick={() => setIntent({ ...intent, side: "SELL" })}>SELL</button></div>
            <label className="trade-field"><span>HIDDEN SIZE</span><input value={intent.size} onChange={(e) => setIntent({ ...intent, size: e.target.value })} /></label>
            <label className="trade-field"><span>HIDDEN LIMIT</span><input value={intent.limitPrice} onChange={(e) => setIntent({ ...intent, limitPrice: e.target.value })} /></label>
            <label className="trade-field"><span>MAX SLIPPAGE BPS</span><input type="number" min="0" max="2000" value={intent.maxSlippageBps} onChange={(e) => setIntent({ ...intent, maxSlippageBps: Number(e.target.value) })} /></label>
            <label className="trade-field"><span>EXPIRY</span><input value={intent.expiry} onChange={(e) => setIntent({ ...intent, expiry: e.target.value })} /></label>
            <label className="trade-field"><span>NONCE</span><input value={intent.nonce} readOnly /></label>
            <div className="notional-actions"><button onClick={rotateNonce}>ROTATE NONCE</button><button className="primary-action" onClick={prepareCommitment}>GENERATE COMMITMENT</button></div>
            {intentError ? <p className="terminal-error">{intentError}</p> : null}
            {commitment ? <div className="commitment-box"><span>PUBLIC COMMITMENT</span><code>{commitment}</code><span>LOCAL SECRET SALT — DO NOT PUBLISH</span><code className="muted">{secretSalt}</code></div> : null}
          </aside>
        </section>
      ) : null}

      <footer className="terminal-footer"><span>SYMBIOTIC / CARDANO DERIVATIVES INFRASTRUCTURE</span><span>NETWORK: PREPROD ●</span></footer>
    </main>
  );
}
