import { BlockfrostProvider } from "@meshsdk/core";
import { AddressType, MeshCardanoHeadlessWallet } from "@meshsdk/wallet";
import { config } from "../src/config.js";

const provider = new BlockfrostProvider(config.blockfrostProjectId);
const wallet = await MeshCardanoHeadlessWallet.fromMnemonic({
  networkId: config.networkId,
  walletAddressType: AddressType.Enterprise,
  fetcher: provider,
  submitter: provider,
  mnemonic: config.mnemonic.split(/\s+/),
});

const address = await wallet.getChangeAddressBech32();
if (!address.startsWith("addr_test1")) throw new Error("MM wallet is not a Cardano testnet address");
const utxos = await wallet.getUtxosMesh();
const balance = await wallet.getBalanceMesh();

console.log(JSON.stringify({ network: config.network, address, utxoCount: utxos.length, balance }, null, 2));
