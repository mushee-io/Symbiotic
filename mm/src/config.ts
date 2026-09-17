import "dotenv/config";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export const config = {
  network: process.env.NETWORK ?? "preprod",
  networkId: Number(process.env.NETWORK_ID ?? "0"),
  blockfrostProjectId: required("BLOCKFROST_PROJECT_ID"),
  deployerAddress: required("DEPLOYER_ADDRESS"),
  mnemonic: required("MM_MNEMONIC"),
  susdTokenName: process.env.SUSD_TOKEN_NAME ?? "sUSD",
  susdDecimals: Number(process.env.SUSD_DECIMALS ?? "6"),
  susdInitialSupply: BigInt(process.env.SUSD_INITIAL_SUPPLY ?? "1000000"),
  market: process.env.BTC_USD_SYMBOL ?? "BTC-USD",
  spreadBps: Number(process.env.MM_SPREAD_BPS ?? "10"),
  quoteNotionalUsd: Number(process.env.MM_QUOTE_NOTIONAL_USD ?? "1000"),
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
