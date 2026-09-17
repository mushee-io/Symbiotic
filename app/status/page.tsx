import Link from "next/link";
import { deploymentManifestFromEnv } from "@/lib/deployment";
import { evaluateReleaseGate } from "@/lib/release-gate";
import styles from "./status.module.css";

export const dynamic = "force-dynamic";

function flag(value: string | undefined) {
  return value === "true" || value === "1";
}

export default function StatusPage() {
  const manifest = deploymentManifestFromEnv(process.env);
  const readiness = evaluateReleaseGate({
    manifest,
    allowMainnet: flag(process.env.SYMBIOTIC_ALLOW_MAINNET),
    evidence: {
      protocolTestsPassed: flag(process.env.SYMBIOTIC_PROTOCOL_TESTS_PASSED),
      executionTestsPassed: flag(process.env.SYMBIOTIC_EXECUTION_TESTS_PASSED),
      hardeningTestsPassed: flag(process.env.SYMBIOTIC_HARDENING_TESTS_PASSED),
      aikenCheckPassed: flag(process.env.SYMBIOTIC_AIKEN_CHECK_PASSED),
      blueprintVerified: flag(process.env.SYMBIOTIC_BLUEPRINT_VERIFIED),
      validatorArtifactsPinned: flag(process.env.SYMBIOTIC_VALIDATOR_ARTIFACTS_PINNED),
      validatorDeploymentsBound: flag(process.env.SYMBIOTIC_VALIDATOR_DEPLOYMENTS_BOUND),
      e2eLifecyclePassed: flag(process.env.SYMBIOTIC_E2E_LIFECYCLE_PASSED),
      releaseProvenanceVerified: flag(process.env.SYMBIOTIC_RELEASE_PROVENANCE_VERIFIED),
      operatorPolicyVerified: flag(process.env.SYMBIOTIC_OPERATOR_POLICY_VERIFIED),
      incidentRecoveryConfigured: flag(process.env.SYMBIOTIC_INCIDENT_RECOVERY_CONFIGURED),
      preprodSoakPassed: flag(process.env.SYMBIOTIC_PREPROD_SOAK_PASSED),
      stateTransitionBindingPassed: flag(process.env.SYMBIOTIC_STATE_TRANSITION_BINDING_PASSED),
      oracleRoundIntegrityPassed: flag(process.env.SYMBIOTIC_ORACLE_ROUND_INTEGRITY_PASSED),
      executionLeaseControlsPassed: flag(process.env.SYMBIOTIC_EXECUTION_LEASE_CONTROLS_PASSED),
      exposureControlsPassed: flag(process.env.SYMBIOTIC_EXPOSURE_CONTROLS_PASSED),
      canaryRollbackConfigured: flag(process.env.SYMBIOTIC_CANARY_ROLLBACK_CONFIGURED),
      canaryRollbackDrillPassed: flag(process.env.SYMBIOTIC_CANARY_ROLLBACK_DRILL_PASSED),
      solvencyConservationPassed: flag(process.env.SYMBIOTIC_SOLVENCY_CONSERVATION_PASSED),
      fundingIntegrityPassed: flag(process.env.SYMBIOTIC_FUNDING_INTEGRITY_PASSED),
      optionsSettlementConservationPassed: flag(process.env.SYMBIOTIC_OPTIONS_SETTLEMENT_CONSERVATION_PASSED),
      notionalAuctionFairnessPassed: flag(process.env.SYMBIOTIC_NOTIONAL_AUCTION_FAIRNESS_PASSED),
      chaosRecoveryPassed: flag(process.env.SYMBIOTIC_CHAOS_RECOVERY_PASSED),
      releaseCertificateVerified: flag(process.env.SYMBIOTIC_RELEASE_CERTIFICATE_VERIFIED),
      parameterSchemaPinned: flag(process.env.SYMBIOTIC_PARAMETER_SCHEMA_PINNED),
      parameterizedDeploymentVerified: flag(process.env.SYMBIOTIC_PARAMETERIZED_DEPLOYMENT_VERIFIED),
      referenceScriptsConfirmed: flag(process.env.SYMBIOTIC_REFERENCE_SCRIPTS_CONFIRMED),
      chainConfirmationProofsVerified: flag(process.env.SYMBIOTIC_CHAIN_CONFIRMATIONS_V2_VERIFIED),
      liveFundingConfirmed: flag(process.env.SYMBIOTIC_LIVE_FUNDING_CONFIRMED),
      liveOptionsSettlementConfirmed: flag(process.env.SYMBIOTIC_LIVE_OPTIONS_CONFIRMED),
      liveNotionalSettlementConfirmed: flag(process.env.SYMBIOTIC_LIVE_NOTIONAL_CONFIRMED),
      preprodReleaseAttestationVerified: flag(process.env.SYMBIOTIC_PREPROD_ATTESTATION_VERIFIED),
      deploymentEpochChainVerified: flag(process.env.SYMBIOTIC_DEPLOYMENT_EPOCH_CHAIN_VERIFIED),
      protocolRegistryCheckpointVerified: flag(process.env.SYMBIOTIC_REGISTRY_CHECKPOINT_VERIFIED),
      stableFinalityVerified: flag(process.env.SYMBIOTIC_STABLE_FINALITY_VERIFIED),
      oracleFundingAnchorVerified: flag(process.env.SYMBIOTIC_ORACLE_FUNDING_ANCHOR_VERIFIED),
      crossProductReconciliationVerified: flag(process.env.SYMBIOTIC_CROSS_PRODUCT_RECONCILIATION_VERIFIED),
      releaseLifecycleVerified: flag(process.env.SYMBIOTIC_RELEASE_LIFECYCLE_VERIFIED),
      deepPreprodReleaseVerified: flag(process.env.SYMBIOTIC_DEEP_PREPROD_RELEASE_VERIFIED),
      dependencyAuditReviewed: flag(process.env.SYMBIOTIC_DEPENDENCY_AUDIT_REVIEWED),
      securityContactConfigured: Boolean(process.env.SYMBIOTIC_SECURITY_CONTACT?.trim()),
      emergencyRunbookConfigured: Boolean(process.env.SYMBIOTIC_EMERGENCY_RUNBOOK_URL?.trim()),
    },
  });

  const readyCount = readiness.checks.filter((check) => check.ready).length;

  return (
    <main className={styles.page}>
      <header className={styles.nav}>
        <Link className={styles.brand} href="/"><span>S</span><b>SYMBIOTIC</b></Link>
        <nav className={styles.navLinks}><Link href="/">PROTOCOL</Link><Link href="/trade">TERMINAL</Link></nav>
        <span className={styles.network}>CARDANO / PREPROD</span>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>SYMBIOTIC / RELEASE EVIDENCE GATE / V7</span>
          <h1>{readiness.ready ? "RELEASE\nREADY" : "FAIL\nCLOSED"}</h1>
          <p>This page is the protocol release-evidence gate. It does not measure whether the trading UI or market-maker process is currently running. A check becomes READY only when the corresponding deployment evidence or release attestation is connected to this web environment.</p>
        </div>
        <div className={styles.heroSide}>
          <div className={styles.score}>{readyCount}<span> / {readiness.checks.length}</span></div>
          <small>CONNECTED RELEASE CHECKS</small>
          {!readiness.ready ? <div className={styles.warning}>FAIL-CLOSED IS INTENTIONAL. UNCONNECTED OR UNVERIFIED EVIDENCE IS NEVER PROMOTED TO READY.</div> : null}
        </div>
      </section>

      <section className={styles.checks}>
        <div className={styles.checksHead}><h2>RELEASE EVIDENCE</h2><p>NETWORK: {readiness.network.toUpperCase()}</p></div>
        <div className={styles.table}>
          {readiness.checks.map((check) => (
            <div className={styles.row} key={check.id}>
              <div className={styles.id}>{check.id}</div>
              <div className={`${styles.status} ${check.ready ? styles.ready : styles.missing}`}>{check.ready ? "● READY" : "× NOT ATTESTED"}</div>
              <div className={styles.detail}>{check.detail}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className={styles.footer}><span>SYMBIOTIC / CARDANO DERIVATIVES INFRASTRUCTURE</span><span>{readiness.ready ? "RELEASE READY" : "RELEASE CERTIFICATE NOT COMPLETE"}</span></footer>
    </main>
  );
}
