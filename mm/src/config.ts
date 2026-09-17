import "dotenv/config";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const parsedNetworkId = Number(process.env.NETWORK_ID ?? "0");
if (parsedNetworkId !== 0 && parsedNetworkId !== 1) throw new Error("NETWORK_ID must be 0 or 1");
const networkId: 0 | 1 = parsedNetworkId;

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
