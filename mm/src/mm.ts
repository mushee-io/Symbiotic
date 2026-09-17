import { BlockfrostProvider, MeshWallet, deserializeAddress } from "@meshsdk/core";
import { config } from "./config.js";
import { fetchBtcUsdOracleRound } from "./oracle.js";
import { buildTwoSidedQuote } from "./quote-engine.js";

const provider = new BlockfrostProvider(config.blockfrostProjectId);
const wallet = new MeshWallet({
  networkId: config.networkId,
  fetcher: provider,
  submitter: provider,
  key: { type: "mnemonic", words: config.mnemonic.split(/\s+/) },
});
await wallet.init();

const address = await wallet.getChangeAddress();
if (!address.startsWith("addr_test1")) throw new Error("Symbiotic-MM is not on Cardano testnet");
const authorityKeyHash = deserializeAddress(address).pubKeyHash;
if (!authorityKeyHash) throw new Error("Unable to derive MM/oracle payment key hash");

const utxos = await wallet.getUtxos();
if (!utxos.length) throw new Error("Symbiotic-MM wallet is unfunded");

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

console.log(JSON.stringify({
  service: "Symbiotic-MM",
  network: config.network,
  market: config.market,
  address,
  oracleAuthority: authorityKeyHash,
  utxoCount: utxos.length,
  deployerAddress: config.deployerAddress,
  mode: "PREPROD_LIVE_ORACLE",
  oracle,
  quote,
}, null, 2));

console.log("Live BTC/USD oracle quorum PASS. Quote is live-market-derived but still off-chain until the execution adapter submits a protocol transaction.");
