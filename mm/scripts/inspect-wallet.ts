import { BlockfrostProvider, MeshWallet } from "@meshsdk/core";
import { config } from "../src/config.js";

const provider = new BlockfrostProvider(config.blockfrostProjectId);
const wallet = new MeshWallet({
  networkId: config.networkId,
  fetcher: provider,
  submitter: provider,
  key: { type: "mnemonic", words: config.mnemonic.split(/\s+/) },
});
await wallet.init();

const address = await wallet.getChangeAddress();
if (!address.startsWith("addr_test1")) throw new Error("MM wallet is not a Cardano testnet address");
const utxos = await wallet.getUtxos();
const balance = await wallet.getBalance();

console.log(JSON.stringify({ network: config.network, address, utxoCount: utxos.length, balance }, null, 2));
