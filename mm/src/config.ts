import "dotenv/config";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const parsedNetworkId = Number(process.env.NETWORK_ID ?? "0");
if (parsedNetworkId !== 0 && parsedNetworkId !== 1) throw new Error("NETWORK_ID must be 0 or 1");
const networkId: 0 | 1 = parsedNetworkId;

const executionModeRaw = (process.env.MM_EXECUTION_MODE ?? "dry-run").trim().toLowerCase();
if (executionModeRaw !== "dry-run" && executionModeRaw !== "live") throw new Error("MM_EXECUTION_MODE must be dry-run or live");
const executionMode: "dry-run" | "live" = executionModeRaw;

export const config = {
  network: process.env.NETWORK ?? "preprod",
  networkId,
  blockfrostProjectId: required("BLOCKFROST_PROJECT_ID"),
  deployerAddress: required("DEPLOYER_ADDRESS"),
  mnemonic: required("MM_MNEMONIC"),
  susdTokenName: process.env.SUSD_TOKEN_NAME ?? "sUSD",
  susdDecimals: Number(process.env.SUSD_DECIMALS ?? "6"),
  susdInitialSupply: BigInt(process.env.SUSD_INITIAL_SUPPLY ?? "1000000"),
  market: process.env.BTC_USD_SYMBOL ?? "BTC-USD",
  spreadBps: Number(process.env.MM_SPREAD_BPS ?? "10"),
  quoteNotionalUsd: Number(process.env.MM_QUOTE_NOTIONAL_USD ?? "1000"),
  oracleMinSources: Number(process.env.ORACLE_MIN_SOURCES ?? "2"),
  oracleMaxDeviationBps: Number(process.env.ORACLE_MAX_DEVIATION_BPS ?? "75"),
  oracleTimeoutMs: Number(process.env.ORACLE_TIMEOUT_MS ?? "4000"),
  executionMode,
  leverage: Number(process.env.MM_LEVERAGE ?? "5"),
  maxLegNotionalUsd: Number(process.env.MM_MAX_LEG_NOTIONAL_USD ?? "5000"),
  maxGrossNotionalUsd: Number(process.env.MM_MAX_GROSS_NOTIONAL_USD ?? "10000"),
  maxQuoteAgeMs: Number(process.env.MM_MAX_QUOTE_AGE_MS ?? "30000"),
  maxOracleAgeMs: Number(process.env.MM_MAX_ORACLE_AGE_MS ?? "30000"),
  maxQuoteOracleDeviationBps: Number(process.env.MM_MAX_QUOTE_ORACLE_DEVIATION_BPS ?? "5"),
  repriceBps: Number(process.env.MM_REPRICE_BPS ?? "20"),
  loopIntervalMs: Number(process.env.MM_LOOP_INTERVAL_MS ?? "30000"),
  maxPairAgeMs: Number(process.env.MM_MAX_PAIR_AGE_MS ?? "900000"),
  liveConfirmation: process.env.CONFIRM_MM_PREPROD ?? "",
};

if (config.network !== "preprod") throw new Error("Symbiotic-MM is pinned to Cardano Preprod");
if (config.networkId !== 0) throw new Error("CIP-30/Mesh testnet network id must be 0");
if (!config.blockfrostProjectId.startsWith("preprod")) throw new Error("BLOCKFROST_PROJECT_ID must be a Preprod project key");
if (!config.deployerAddress.startsWith("addr_test1")) throw new Error("DEPLOYER_ADDRESS must be a Cardano testnet address");
if (config.mnemonic.split(/\s+/).length < 12) throw new Error("MM_MNEMONIC is invalid");
if (!Number.isInteger(config.susdDecimals) || config.susdDecimals < 0 || config.susdDecimals > 12) throw new Error("Invalid sUSD decimals");
if (config.susdInitialSupply <= 0n) throw new Error("Invalid sUSD supply");
if (!Number.isFinite(config.spreadBps) || config.spreadBps <= 0 || config.spreadBps > 500) throw new Error("Invalid MM spread");
if (!Number.isFinite(config.quoteNotionalUsd) || config.quoteNotionalUsd <= 0) throw new Error("Invalid quote notional");
if (!Number.isInteger(config.oracleMinSources) || config.oracleMinSources < 2 || config.oracleMinSources > 3) {
  throw new Error("ORACLE_MIN_SOURCES must be 2 or 3");
}
if (!Number.isFinite(config.oracleMaxDeviationBps) || config.oracleMaxDeviationBps <= 0 || config.oracleMaxDeviationBps > 500) {
  throw new Error("ORACLE_MAX_DEVIATION_BPS must be > 0 and <= 500");
}
if (!Number.isInteger(config.oracleTimeoutMs) || config.oracleTimeoutMs < 500 || config.oracleTimeoutMs > 30_000) {
  throw new Error("ORACLE_TIMEOUT_MS must be between 500 and 30000");
}
if (!Number.isFinite(config.leverage) || config.leverage < 1 || config.leverage > 20) throw new Error("MM_LEVERAGE must be between 1 and 20");
if (!Number.isFinite(config.maxLegNotionalUsd) || config.maxLegNotionalUsd <= 0) throw new Error("Invalid MM_MAX_LEG_NOTIONAL_USD");
if (!Number.isFinite(config.maxGrossNotionalUsd) || config.maxGrossNotionalUsd < config.maxLegNotionalUsd * 2) throw new Error("MM_MAX_GROSS_NOTIONAL_USD must cover both quote legs");
if (!Number.isInteger(config.maxQuoteAgeMs) || config.maxQuoteAgeMs < 1_000 || config.maxQuoteAgeMs > 300_000) throw new Error("MM_MAX_QUOTE_AGE_MS must be 1000-300000");
if (!Number.isInteger(config.maxOracleAgeMs) || config.maxOracleAgeMs < 1_000 || config.maxOracleAgeMs > 300_000) throw new Error("MM_MAX_ORACLE_AGE_MS must be 1000-300000");
if (!Number.isFinite(config.maxQuoteOracleDeviationBps) || config.maxQuoteOracleDeviationBps <= 0 || config.maxQuoteOracleDeviationBps > 100) throw new Error("Invalid MM_MAX_QUOTE_ORACLE_DEVIATION_BPS");
if (!Number.isFinite(config.repriceBps) || config.repriceBps <= 0 || config.repriceBps > 500) throw new Error("Invalid MM_REPRICE_BPS");
if (!Number.isInteger(config.loopIntervalMs) || config.loopIntervalMs < 10_000 || config.loopIntervalMs > 3_600_000) throw new Error("MM_LOOP_INTERVAL_MS must be 10000-3600000");
if (!Number.isInteger(config.maxPairAgeMs) || config.maxPairAgeMs < 60_000 || config.maxPairAgeMs > 86_400_000) throw new Error("MM_MAX_PAIR_AGE_MS must be 60000-86400000");
