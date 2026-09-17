import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BlockfrostProvider, ForgeScript, MeshTxBuilder, MeshWallet, resolveScriptHash, stringToHex } from "@meshsdk/core";
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
if (!address.startsWith("addr_test1")) throw new Error("MM wallet is not on Cardano testnet");
const utxos = await wallet.getUtxos();
if (!utxos.length) throw new Error("MM wallet has no UTxOs; fund it with Preprod tADA first");

const forgingScript = ForgeScript.withOneSignature(address);
const policyId = resolveScriptHash(forgingScript);
const tokenNameHex = stringToHex(config.susdTokenName);
const assetUnit = `${policyId}${tokenNameHex}`;
const baseUnits = config.susdInitialSupply * 10n ** BigInt(config.susdDecimals);

const markerDir = resolve(process.cwd(), ".secrets");
const markerPath = resolve(markerDir, "susd.mint.json");
await mkdir(markerDir, { recursive: true, mode: 0o700 });
try {
  await access(markerPath);
  throw new Error(`Refusing to mint ${config.susdTokenName} again: local mint marker already exists at ${markerPath}`);
} catch (error) {
  if (error instanceof Error && error.message.startsWith("Refusing to mint")) throw error;
}

const balance = await wallet.getBalance();
const existing = balance.find((asset) => asset.unit === assetUnit);
if (existing && BigInt(existing.quantity) > 0n) {
  throw new Error(`Refusing to mint ${config.susdTokenName} again: wallet already holds ${existing.quantity} base units of ${assetUnit}`);
}

const unsignedTx = await new MeshTxBuilder({ fetcher: provider })
  .mint(baseUnits.toString(), policyId, tokenNameHex)
  .mintingScript(forgingScript)
  .changeAddress(address)
  .selectUtxosFrom(utxos)
  .complete();

const signedTx = await wallet.signTx(unsignedTx);
const txHash = await wallet.submitTx(signedTx);

const receipt = {
  network: config.network,
  txHash,
  policyId,
  tokenName: config.susdTokenName,
  tokenNameHex,
  assetUnit,
  decimals: config.susdDecimals,
  wholeSupply: config.susdInitialSupply.toString(),
  baseUnits: baseUnits.toString(),
  ownerAddress: address,
};

await writeFile(markerPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(receipt, null, 2));
