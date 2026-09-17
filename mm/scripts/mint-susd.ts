import { BlockfrostProvider, ForgeScript, MeshTxBuilder, resolveScriptHash, stringToHex } from "@meshsdk/core";
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
if (!address.startsWith("addr_test1")) throw new Error("MM wallet is not on Cardano testnet");
const utxos = await wallet.getUtxosMesh();
if (!utxos.length) throw new Error("MM wallet has no UTxOs; fund it with Preprod tADA first");

const forgingScript = ForgeScript.withOneSignature(address);
const policyId = resolveScriptHash(forgingScript);
const tokenNameHex = stringToHex(config.susdTokenName);
const baseUnits = config.susdInitialSupply * 10n ** BigInt(config.susdDecimals);

const unsignedTx = await new MeshTxBuilder({ fetcher: provider })
  .mint(baseUnits.toString(), policyId, tokenNameHex)
  .mintingScript(forgingScript)
  .changeAddress(address)
  .selectUtxosFrom(utxos)
  .complete();

const signedTx = await wallet.signTx(unsignedTx);
const txHash = await wallet.submitTx(signedTx);

console.log(JSON.stringify({
  network: config.network,
  txHash,
  policyId,
  tokenName: config.susdTokenName,
  tokenNameHex,
  assetUnit: `${policyId}${tokenNameHex}`,
  decimals: config.susdDecimals,
  wholeSupply: config.susdInitialSupply.toString(),
  baseUnits: baseUnits.toString(),
  ownerAddress: address,
}, null, 2));
