import { BlockfrostProvider, MeshWallet } from "@meshsdk/core";
import { config } from "./config.js";
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

const utxos = await wallet.getUtxos();
if (!utxos.length) throw new Error("Symbiotic-MM wallet is unfunded");

console.log(JSON.stringify({
  service: "Symbiotic-MM",
  network: config.network,
  market: config.market,
  address,
  utxoCount: utxos.length,
  deployerAddress: config.deployerAddress,
  mode: "PREPROD_BOOTSTRAP",
}, null, 2));

const bootstrapIndexPrice = Number(process.env.BOOTSTRAP_INDEX_PRICE ?? "60000");
const quote = buildTwoSidedQuote({
  market: config.market,
  indexPrice: bootstrapIndexPrice,
  spreadBps: config.spreadBps,
  notionalUsd: config.quoteNotionalUsd,
});

console.log("Initial deterministic quote (not yet submitted on-chain):");
console.log(JSON.stringify(quote, null, 2));
console.log("Next runtime step: replace bootstrap index with signed Symbiotic oracle rounds, then submit quotes through the deployed Perpetual/Options/Notional validators.");
