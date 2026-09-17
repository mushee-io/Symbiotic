import { config } from "./config.js";
import { PreprodMmExecutionAdapter, type MmExecutionRisk } from "./execution-adapter.js";
import { fetchBtcUsdOracleRound } from "./oracle.js";
import { buildTwoSidedQuote } from "./quote-engine.js";

const TRANSIENT_UTXO_RETRY_MS = 5_000;

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isTransientUtxoRace(error: unknown) {
  return errorText(error).includes("BadInputsUTxO");
}

function riskConfig(): MmExecutionRisk {
  return {
    leverage: config.leverage,
    maxLegNotionalUsd: config.maxLegNotionalUsd,
    maxGrossNotionalUsd: config.maxGrossNotionalUsd,
    maxQuoteAgeMs: config.maxQuoteAgeMs,
    maxOracleAgeMs: config.maxOracleAgeMs,
    maxQuoteOracleDeviationBps: config.maxQuoteOracleDeviationBps,
  };
}

function assertLiveAuthorized() {
  if (config.executionMode !== "live") return false;
  if (config.liveConfirmation !== "YES") {
    throw new Error('Live Preprod MM execution requires CONFIRM_MM_PREPROD="YES"');
  }
  return true;
}

async function freshQuote() {
  const oracle = await fetchBtcUsdOracleRound({
    minSources: config.oracleMinSources,
    maxDeviationBps: config.oracleMaxDeviationBps,
    timeoutMs: config.oracleTimeoutMs,
  });
  const quote = buildTwoSidedQuote({
    market: config.market,
    indexPrice: oracle.price,
    spreadBps: config.spreadBps,
    notionalUsd: config.quoteNotionalUsd,
  });
  return { oracle, quote };
}

export async function runMmCycle(adapter?: PreprodMmExecutionAdapter) {
  const execution = adapter ?? await PreprodMmExecutionAdapter.create();
  const live = assertLiveAuthorized();
  const { oracle, quote } = await freshQuote();
  const reconciliation = await execution.reconcileState();
  const state = reconciliation.state;

  if (!state || state.status === "closed") {
    if (!live) {
      return {
        mode: "dry-run" as const,
        action: "WOULD_OPEN_QUOTE_PAIR" as const,
        oracle,
        quote,
        risk: riskConfig(),
        wallet: await execution.walletSnapshot().then((snapshot) => ({
          spendableUtxos: snapshot.spendable.length,
          sUsdBaseUnits: snapshot.susd.toString(),
          lovelace: snapshot.lovelace.toString(),
        })),
      };
    }
    const opened = await execution.openQuotePair({ quote, oracle, risk: riskConfig() });
    return { mode: "live" as const, action: "OPENED_QUOTE_PAIR" as const, oracle, quote, ...opened };
  }

  const entryMid = state.legs.reduce((sum, leg) => sum + leg.entryPrice, 0) / state.legs.length;
  const driftBps = Math.abs(oracle.price - entryMid) / entryMid * 10_000;
  const ageMs = Date.now() - new Date(state.openedAt).getTime();
  const mustReprice = driftBps >= config.repriceBps || ageMs >= config.maxPairAgeMs;

  if (!mustReprice) {
    return {
      mode: live ? "live" as const : "dry-run" as const,
      action: "HOLD_QUOTE_PAIR" as const,
      oracle,
      quote,
      pairId: state.pairId,
      liveLegs: reconciliation.liveLegs,
      driftBps,
      ageMs,
    };
  }

  if (!live) {
    return {
      mode: "dry-run" as const,
      action: "WOULD_REPRICE_QUOTE_PAIR" as const,
      oracle,
      quote,
      pairId: state.pairId,
      driftBps,
      ageMs,
    };
  }

  const closed = await execution.closeManagedPair();
  return {
    mode: "live" as const,
    action: "CLOSED_FOR_REPRICE" as const,
    pairId: closed.pairId,
    oracle,
    quote,
    driftBps,
    ageMs,
    note: "Pair closed safely. The next cycle fetches a fresh oracle round before opening replacement legs.",
  };
}

export async function runMmForever() {
  const adapter = await PreprodMmExecutionAdapter.create();
  console.log(`Symbiotic-MM loop started on Preprod in ${config.executionMode} mode.`);
  console.log(`Cycle interval: ${config.loopIntervalMs}ms; reprice threshold: ${config.repriceBps}bps.`);

  let stopped = false;
  const stop = () => { stopped = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  while (!stopped) {
    let transientUtxoRace = false;
    try {
      const result = await runMmCycle(adapter);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      if (isTransientUtxoRace(error)) {
        transientUtxoRace = true;
        console.warn(`[MM RETRY] Preprod UTxO state is still catching up after the previous transaction. Refreshing oracle and wallet state in ${TRANSIENT_UTXO_RETRY_MS}ms.`);
      } else {
        console.error(`[MM FAIL-CLOSED] ${errorText(error)}`);
      }
    }
    if (stopped) break;
    if (transientUtxoRace) {
      await sleep(TRANSIENT_UTXO_RETRY_MS);
      continue;
    }
    await sleep(config.loopIntervalMs);
  }
  console.log("Symbiotic-MM loop stopped. Existing on-chain positions were left unchanged.");
}
