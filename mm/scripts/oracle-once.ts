import { config } from "../src/config.js";
import { fetchBtcUsdOracleRound } from "../src/oracle.js";

const round = await fetchBtcUsdOracleRound({
  minSources: config.oracleMinSources,
  maxDeviationBps: config.oracleMaxDeviationBps,
  timeoutMs: config.oracleTimeoutMs,
});

console.log(JSON.stringify(round, null, 2));
