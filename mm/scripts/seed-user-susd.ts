import { BlockfrostProvider, MeshTxBuilder, MeshWallet, type UTxO } from "@meshsdk/core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../src/config.js";

type AssetConfig = {
  network: string;
  networkMagic: number;
  assets: {
    sUSD: {
      assetUnit: string;
      decimals: number;
      ownerAddress: string;
      baseUnits: string;
      canonicalForDemo: boolean;
    };
  };
};

type DeploymentManifest = {
  status: "partial" | "complete";
  network: string;
  mmAddress: string;
  validators: Array<{ name: string; referenceUtxo: string }>;
};

type SeedReceipt = {
  status: "submitted" | "confirmed";
  network: "preprod";
  txHash: string;
  recipient: string;
  assetUnit: string;
  wholeTokens: string;
  baseUnits: string;
  submittedAt: string;
  confirmedAt?: string;
};

function utxoRef(utxo: UTxO) {
  return `${utxo.input.txHash}#${utxo.input.outputIndex}`;
}

function quantityInUtxos(utxos: UTxO[], unit: string) {
  return utxos.reduce((sum, utxo) => {
    const quantity = utxo.output.amount.find((asset) => asset.unit === unit)?.quantity ?? "0";
    return sum + BigInt(quantity);
  }, 0n);
}

async function waitForRecipientOutput(
  provider: BlockfrostProvider,
  txHash: string,
  recipient: string,
  assetUnit: string,
  expectedBaseUnits: bigint,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 48; attempt += 1) {
    try {
      const utxos = await provider.fetchUTxOs(txHash);
      const output = utxos.find((utxo) => {
        if (utxo.output.address !== recipient) return false;
        const quantity = BigInt(utxo.output.amount.find((asset) => asset.unit === assetUnit)?.quantity ?? "0");
        return quantity >= expectedBaseUnits;
      });
      if (output) return output;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5000));
  }
  throw new Error(`Timed out waiting for recipient sUSD output ${txHash}: ${String(lastError ?? "output not found")}`);
}

if (config.network !== "preprod" || config.networkId !== 0) throw new Error("User sUSD seeding is pinned to Cardano Preprod");
if (!config.deployerAddress.startsWith("addr_test1")) throw new Error("Recipient must be a Cardano testnet address");

const mmRoot = process.cwd();
const secretRoot = resolve(mmRoot, ".secrets");
mkdirSync(secretRoot, { recursive: true });
const manifestPath = resolve(secretRoot, "preprod-validator-deployment.json");
const receiptPath = resolve(secretRoot, "user-susd-seed.json");
const assetsPath = resolve(mmRoot, "config", "preprod-assets.json");

if (!existsSync(manifestPath)) throw new Error("Missing completed Preprod validator deployment manifest");
if (!existsSync(assetsPath)) throw new Error("Missing canonical Preprod asset config");
if (existsSync(receiptPath)) {
  const existing = JSON.parse(readFileSync(receiptPath, "utf8")) as SeedReceipt;
  throw new Error(`User sUSD seed already recorded as ${existing.status}: ${existing.txHash}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as DeploymentManifest;
if (manifest.status !== "complete" || manifest.network !== "preprod" || manifest.validators.length !== 5) {
  throw new Error("Five-validator Preprod deployment must be complete before seeding a user wallet");
}

const assetFile = JSON.parse(readFileSync(assetsPath, "utf8")) as AssetConfig;
const susd = assetFile.assets.sUSD;
if (assetFile.network !== "preprod" || assetFile.networkMagic !== 1 || !susd.canonicalForDemo) {
  throw new Error("Canonical sUSD config is not valid for Cardano Preprod");
}

const wholeTokensRaw = process.env.USER_SUSD_SEED_WHOLE ?? "10000";
if (!/^\d+$/.test(wholeTokensRaw)) throw new Error("USER_SUSD_SEED_WHOLE must be a positive whole number");
const wholeTokens = BigInt(wholeTokensRaw);
if (wholeTokens <= 0n || wholeTokens > 100_000n) throw new Error("USER_SUSD_SEED_WHOLE must be between 1 and 100000 for the demo");
const baseUnits = wholeTokens * (10n ** BigInt(susd.decimals));
if (baseUnits >= BigInt(susd.baseUnits)) throw new Error("User seed must be smaller than the canonical MM sUSD allocation");

const provider = new BlockfrostProvider(config.blockfrostProjectId);
const wallet = new MeshWallet({
  networkId: config.networkId,
  fetcher: provider,
  submitter: provider,
  key: { type: "mnemonic", words: config.mnemonic.split(/\s+/) },
});
await wallet.init();
const mmAddress = await wallet.getChangeAddress();
if (mmAddress !== manifest.mmAddress || mmAddress !== susd.ownerAddress) throw new Error("MM signer does not match deployed/canonical addresses");

const recipientExisting = await provider.fetchAddressUTxOs(config.deployerAddress);
const recipientExistingSusd = quantityInUtxos(recipientExisting, susd.assetUnit);
if (recipientExistingSusd > 0n) {
  throw new Error(`Recipient already holds ${recipientExistingSusd} sUSD base units; refusing an accidental duplicate seed`);
}

const protectedRefs = new Set(manifest.validators.map((validator) => validator.referenceUtxo));
const allUtxos = await provider.fetchAddressUTxOs(mmAddress);
const spendable = allUtxos.filter((utxo) => !protectedRefs.has(utxoRef(utxo)));
if (!spendable.length) throw new Error("No spendable MM UTxOs remain after protecting five reference-script UTxOs");
const spendableSusd = quantityInUtxos(spendable, susd.assetUnit);
if (spendableSusd < baseUnits) throw new Error(`Insufficient spendable sUSD: need ${baseUnits}, observed ${spendableSusd}`);

console.log(`Seeding ${wholeTokens} sUSD to Lace/DEPLOYER_ADDRESS on Cardano Preprod...`);
console.log(`Protected reference UTxOs: ${protectedRefs.size}`);

const unsignedTx = await new MeshTxBuilder({ fetcher: provider, submitter: provider })
  .txOut(config.deployerAddress, [
    { unit: "lovelace", quantity: "3000000" },
    { unit: susd.assetUnit, quantity: baseUnits.toString() },
  ])
  .changeAddress(mmAddress)
  .selectUtxosFrom(spendable)
  .complete();

const signedTx = await wallet.signTx(unsignedTx);
const txHash = await wallet.submitTx(signedTx);
const submittedAt = new Date().toISOString();
const submittedReceipt: SeedReceipt = {
  status: "submitted",
  network: "preprod",
  txHash,
  recipient: config.deployerAddress,
  assetUnit: susd.assetUnit,
  wholeTokens: wholeTokens.toString(),
  baseUnits: baseUnits.toString(),
  submittedAt,
};
writeFileSync(receiptPath, `${JSON.stringify(submittedReceipt, null, 2)}\n`, { mode: 0o600 });
console.log(`sUSD seed submitted: ${txHash}`);

const output = await waitForRecipientOutput(provider, txHash, config.deployerAddress, susd.assetUnit, baseUnits);
const confirmedReceipt: SeedReceipt = {
  ...submittedReceipt,
  status: "confirmed",
  confirmedAt: new Date().toISOString(),
};
writeFileSync(receiptPath, `${JSON.stringify(confirmedReceipt, null, 2)}\n`, { mode: 0o600 });
console.log(`sUSD seed confirmed at ${txHash}#${output.input.outputIndex}`);
console.log(JSON.stringify(confirmedReceipt, null, 2));
