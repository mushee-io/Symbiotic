import Link from "next/link";
import { LiveHomepageOracle } from "@/components/LiveHomepageOracle";
import { PREPROD_LIVE } from "@/lib/preprod-live";
import styles from "./home.module.css";

const riskModules = [
  ["INITIAL MARGIN", "Collateral required to open a leveraged position."],
  ["MAINTENANCE MARGIN", "Minimum equity required before liquidation becomes valid."],
  ["LIQUIDATION", "Validator-enforced close path bounded by oracle and keeper authority."],
  ["LEVERAGE", "Market-level leverage constraints with deterministic position math."],
  ["ORACLE GUARD", "Freshness, source quorum and deviation checks before execution."],
  ["FUNDING", "Bounded funding mechanics designed for explicit settlement evidence."],
  ["POSITION LIMITS", "Per-market and per-position risk constraints in protocol logic."],
  ["FAIL-CLOSED", "Missing evidence disables claims instead of inventing state."],
] as const;

const roadmap = [
  { label: "NOW", items: ["BTC-USD PERPETUALS", "CARDANO PREPROD", "POSITION UTxOs", "LIVE ORACLE", "MARKET MAKER"] },
  { label: "NEXT", items: ["MULTI-ASSET PERPS", "PORTFOLIO MARGIN", "ADVANCED ORDER TYPES", "LIQUIDITY ENGINE"] },
  { label: "LATER", items: ["OPTIONS SETTLEMENT", "PRIVATE NOTIONAL MARKETS", "INSTITUTIONAL APIs", "ADVANCED RISK"] },
] as const;

const referenceTx = PREPROD_LIVE.perpetual.referenceUtxo.split("#")[0];

export default function HomePage() {
  return (
    <main className={styles.home}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Symbiotic home">
          <span>S</span><b>SYMBIOTIC</b>
        </Link>
        <nav className={styles.nav}>
          <a href="#markets">MARKETS</a>
          <a href="#architecture">ARCHITECTURE</a>
          <a href="#risk">RISK</a>
          <a href="#liquidity">LIQUIDITY</a>
          <a href="#proof">PROOF</a>
          <Link href="/status">STATUS</Link>
        </nav>
        <div className={styles.headerActions}>
          <span className={styles.network}><i />PREPROD</span>
          <Link className={styles.launchSmall} href="/trade">LAUNCH TERMINAL ↗</Link>
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>SYMBIOTIC / CARDANO / DERIVATIVES</p>
          <h1>PERPETUAL<br />MARKETS.<br /><em>SETTLED</em><br />ONCHAIN.</h1>
          <p className={styles.heroText}>A non-custodial perpetual trading protocol built around transparent position state, deterministic settlement and Cardano-native infrastructure.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primary} href="/trade">LAUNCH TERMINAL ↗</Link>
            <a className={styles.secondary} href="#architecture">EXPLORE PROTOCOL</a>
          </div>
          <div className={styles.heroMeta}>
            <span><i />CARDANO PREPROD</span>
            <span>BTC-USD PERP</span>
            <span>POSITION UTxO</span>
            <span>AIKEN V3</span>
          </div>
        </div>

        <div className={styles.heroDiagram} aria-label="Symbiotic transaction architecture">
          <div className={styles.diagramLabel}>LIVE EXECUTION PATH</div>
          <div className={styles.diagramRail} />
          {[
            ["01", "TRADER"],
            ["02", "ORDER"],
            ["03", "MARGIN ENGINE"],
            ["04", "ORACLE"],
            ["05", "VALIDATOR"],
            ["06", "POSITION UTxO"],
            ["07", "SETTLEMENT"],
          ].map(([num, label], index) => (
            <div className={styles.diagramNode} style={{ top: `${8 + index * 13}%` }} key={label}>
              <span>{num}</span><b>{label}</b><i />
            </div>
          ))}
          <div className={styles.diagramFoot}>WALLET → CARDANO → CONFIRMATION</div>
        </div>
      </section>

      <section className={styles.networkStrip} aria-label="Protocol network strip">
        <div><span>NETWORK</span><strong>PREPROD <i /></strong></div>
        <div><span>MARKET</span><strong>BTC-USD</strong></div>
        <div><span>ORACLE</span><LiveHomepageOracle compact /></div>
        <div><span>VALIDATOR</span><strong>{PREPROD_LIVE.perpetual.scriptHash.slice(0, 12)}…</strong></div>
        <div><span>SETTLEMENT</span><strong>CARDANO</strong></div>
      </section>

      <section className={styles.section} id="markets">
        <div className={styles.sectionIntro}>
          <span className={styles.sectionNumber}>01</span>
          <div><p>MARKETS</p><h2>TRADE THE MARKET.<br />KEEP THE PROOF.</h2></div>
        </div>
        <div className={styles.marketTable}>
          <div className={styles.marketHead}><span>MARKET</span><span>MARK</span><span>INDEX</span><span>24H</span><span>FUNDING</span><span>OPEN INTEREST</span><span>VOLUME</span><span>STATUS</span></div>
          <Link className={styles.marketRow} href="/trade">
            <span><b>BTC-USD</b><small>PERPETUAL</small></span>
            <LiveHomepageOracle />
            <span>LIVE ORACLE</span>
            <span>—</span>
            <span>CALCULATED</span>
            <span>—</span>
            <span>—</span>
            <span className={styles.liveStatus}><i />LIVE</span>
          </Link>
        </div>
      </section>

      <section className={`${styles.section} ${styles.architecture}`} id="architecture">
        <div className={styles.sectionIntro}>
          <span className={styles.sectionNumber}>02</span>
          <div><p>ARCHITECTURE</p><h2>EVERY POSITION<br />HAS STATE.</h2></div>
        </div>
        <div className={styles.flow}>
          {[
            ["WALLET", "CIP-30 witness"],
            ["ORDER INTENT", "side / size / leverage"],
            ["MARGIN", "collateral bound"],
            ["ORACLE", "quorum + freshness"],
            ["CARDANO TX", "deterministic outputs"],
            ["POSITION UTxO", "datum + collateral"],
            ["SETTLEMENT", "confirmed chain state"],
          ].map(([title, detail], index) => (
            <div className={styles.flowItem} key={title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <b>{title}</b>
              <small>{detail}</small>
            </div>
          ))}
        </div>
        <div className={styles.annotations}><span>UTxO INPUT</span><span>DATUM</span><span>REDEEMER</span><span>COLLATERAL</span><span>POSITION STATE</span><span>TX HASH</span></div>
      </section>

      <section className={styles.section} id="risk">
        <div className={styles.sectionIntro}>
          <span className={styles.sectionNumber}>03</span>
          <div><p>RISK ENGINE</p><h2>RISK IS CODE,<br />NOT A PROMISE.</h2></div>
        </div>
        <div className={styles.riskGrid}>
          {riskModules.map(([title, body], index) => (
            <div key={title}><span>{String(index + 1).padStart(2, "0")}</span><b>{title}</b><p>{body}</p></div>
          ))}
        </div>
      </section>

      <section className={`${styles.section} ${styles.liquidity}`} id="liquidity">
        <div className={styles.sectionIntro}>
          <span className={styles.sectionNumber}>04</span>
          <div><p>LIQUIDITY / MARKET MAKER</p><h2>NATIVE MARKET-MAKING<br />INFRASTRUCTURE.</h2></div>
        </div>
        <div className={styles.mmGrid}>
          <div className={styles.mmDiagram}>
            <div><span>PRICE FEED</span><b>BTC/USD QUORUM</b></div>
            <i />
            <div><span>INVENTORY ENGINE</span><b>LONG / SHORT STATE</b></div>
            <i />
            <div><span>RISK MODEL</span><b>NOTIONAL / COLLATERAL</b></div>
            <i />
            <div><span>QUOTE ENGINE</span><b>BID / ASK / SPREAD</b></div>
            <i />
            <div><span>SYMBIOTIC MARKET</span><b>CARDANO PREPROD</b></div>
          </div>
          <div className={styles.depthGraphic}>
            <p>MARKET INFRASTRUCTURE</p>
            <div className={styles.depthBars}>{[18,32,45,60,78,92,76,58,42,26].map((width, i) => <span key={i} style={{ width: `${width}%` }} />)}</div>
            <div className={styles.depthLegend}><span>BID</span><span>SPREAD</span><span>ASK</span></div>
            <p className={styles.mmCopy}>The market maker consumes live oracle rounds, applies inventory and risk constraints, builds two-sided quotes, settles positions to Cardano and reconciles chain state before requoting.</p>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.proof}`} id="proof">
        <div className={styles.sectionIntro}>
          <span className={styles.sectionNumber}>05</span>
          <div><p>LIVE PROOF</p><h2>DON&apos;T TRUST THE UI.<br />VERIFY THE CHAIN.</h2></div>
        </div>
        <div className={styles.proofGrid}>
          <div><span>NETWORK</span><b>CARDANO PREPROD</b></div>
          <div><span>MARKET</span><b>BTC-USD PERP</b></div>
          <div><span>VALIDATOR HASH</span><code>{PREPROD_LIVE.perpetual.scriptHash}</code></div>
          <div><span>REFERENCE UTxO</span><code>{PREPROD_LIVE.perpetual.referenceUtxo}</code></div>
          <div className={styles.proofWide}><span>VALIDATOR ADDRESS</span><code>{PREPROD_LIVE.perpetual.scriptAddress}</code></div>
          <div className={styles.proofWide}><span>STATUS</span><b className={styles.liveStatus}><i />DEPLOYED REFERENCE SCRIPT</b></div>
        </div>
        <a className={styles.explorerLink} href={`https://preprod.cardanoscan.io/transaction/${referenceTx}`} target="_blank" rel="noreferrer">VIEW REFERENCE TRANSACTION ↗</a>
      </section>

      <section className={`${styles.section} ${styles.roadmap}`}>
        <div className={styles.sectionIntro}>
          <span className={styles.sectionNumber}>06</span>
          <div><p>ROADMAP</p><h2>SHIP THE MARKET.<br />EXPAND THE ENGINE.</h2></div>
        </div>
        <div className={styles.roadmapGrid}>
          {roadmap.map((phase) => (
            <div key={phase.label}><strong>{phase.label}</strong>{phase.items.map((item) => <span key={item}>{item}</span>)}</div>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}><span>S</span><div><b>SYMBIOTIC</b><small>CARDANO DERIVATIVES INFRASTRUCTURE</small></div></div>
        <div className={styles.footerCols}>
          <div><b>PROTOCOL</b><a href="#markets">Markets</a><a href="#risk">Risk</a><a href="#liquidity">Liquidity</a><a href="#architecture">Architecture</a></div>
          <div><b>DEVELOPERS</b><a href="https://github.com/mushee-io/Symbiotic" target="_blank" rel="noreferrer">GitHub</a><Link href="/status">Status</Link><a href="#proof">Contracts</a></div>
          <div><b>PRODUCT</b><Link href="/trade">Terminal</Link><a href="#proof">Explorer</a><span>Portfolio —</span></div>
        </div>
        <div className={styles.footerBottom}><span>SYMBIOTIC / CARDANO</span><span>NETWORK: PREPROD <i /></span></div>
      </footer>
    </main>
  );
}
