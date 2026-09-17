import Link from "next/link";
import styles from "./home.module.css";

const products = [
  {
    eyebrow: "01 / PERPETUALS",
    title: "Trade leveraged markets.",
    body: "Cardano-native perpetual markets with collateral-backed margin, bounded funding, liquidation controls and fail-closed execution.",
    detail: "BTC-USD / PREPROD"
  },
  {
    eyebrow: "02 / OPTIONS",
    title: "Price and settle options.",
    body: "European calls and puts with collateralized writing, oracle-settled expiry and exact payout conservation.",
    detail: "CALLS / PUTS / EXPIRY"
  },
  {
    eyebrow: "03 / NOTIONAL MARKET",
    title: "Hide intent. Bound execution.",
    body: "Private pre-trade intent with committed solver competition, execution limits and public Cardano settlement receipts.",
    detail: "PRIVATE INTENT / PUBLIC SETTLEMENT"
  }
] as const;

export default function HomePage() {
  return (
    <main className={styles.home}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Symbiotic home">
          <span>S</span>
          SYMBIOTIC
        </Link>
        <nav className={styles.nav}>
          <a href="#products">PRODUCTS</a>
          <a href="#infrastructure">INFRASTRUCTURE</a>
          <Link href="/status">STATUS</Link>
        </nav>
        <Link className={styles.launchSmall} href="/trade">LAUNCH TERMINAL</Link>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroMeta}>
          <span>CARDANO</span>
          <span>PREPROD</span>
          <span>DERIVATIVES</span>
        </div>
        <h1>
          THE DERIVATIVES
          <br />
          <em>AND PROGRAMMABLE</em>
          <br />
          LIQUIDITY LAYER.
        </h1>
        <div className={styles.heroBottom}>
          <p>
            Perpetuals, options and private pre-trade intent built around a five-validator Cardano execution architecture.
            The protocol remains fail-closed until real Preprod deployment evidence is verified.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/trade">LAUNCH TERMINAL →</Link>
            <Link className={styles.secondary} href="/status">VIEW PROTOCOL STATUS</Link>
          </div>
        </div>
      </section>

      <section className={styles.networkStrip} aria-label="Network status">
        <div>
          <span>NETWORK</span>
          <strong>CARDANO PREPROD</strong>
        </div>
        <div>
          <span>TESTNET MAGIC</span>
          <strong>1</strong>
        </div>
        <div>
          <span>CIP-30 NETWORK</span>
          <strong>0</strong>
        </div>
        <div>
          <span>PROTOCOL MODE</span>
          <strong className={styles.acid}>FAIL-CLOSED</strong>
        </div>
      </section>

      <section className={styles.products} id="products">
        <div className={styles.sectionHeading}>
          <p>PRODUCT SURFACE</p>
          <h2>ONE VENUE.<br />THREE EXECUTION MODES.</h2>
        </div>
        <div className={styles.productGrid}>
          {products.map((product) => (
            <article className={styles.productCard} key={product.eyebrow}>
              <p>{product.eyebrow}</p>
              <h3>{product.title}</h3>
              <div className={styles.rule} />
              <span>{product.body}</span>
              <b>{product.detail}</b>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.infrastructure} id="infrastructure">
        <div>
          <p className={styles.kicker}>EXECUTION FOUNDATION</p>
          <h2>BUILT FOR THE CHAIN,<br /><em>NOT A MOCK TERMINAL.</em></h2>
        </div>
        <div className={styles.infrastructureGrid}>
          <span><b>05</b> Plutus V3 validators</span>
          <span><b>V11</b> testnet evidence verifier</span>
          <span><b>5,000</b> Aiken property successes</span>
          <span><b>00</b> live-fund authority in CI</span>
        </div>
      </section>

      <section className={styles.finalCta}>
        <p>THE INTERFACE IS READY. THE NEXT PHASE IS REAL CARDANO PREPROD EXECUTION.</p>
        <Link href="/trade">ENTER SYMBIOTIC TERMINAL →</Link>
      </section>

      <footer className={styles.footer}>
        <span>SYMBIOTIC / CARDANO DERIVATIVES</span>
        <span>PREPROD / V0.15.0</span>
      </footer>
    </main>
  );
}
