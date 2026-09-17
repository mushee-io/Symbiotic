import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BlockfrostProvider,
  MeshTxBuilder,
  MeshWallet,
  deserializeAddress,
  resolveScriptHash,
  serializePlutusScript,
  type UTxO,
} from "@meshsdk/core";
import { applyParamsToScript } from "@meshsdk/core-csl";
import { config } from "./config.js";

const EXPECTED_BLUEPRINT_SHA256 = "bdb8eea4d9159c9026a66479f6389d5cad4fddf55f32957222855652b05e2855";
const EXPECTED_AIKEN_VERSION = "v1.1.22";
const REFERENCE_SAFETY_NUMERATOR = 125n;
const REFERENCE_SAFETY_DENOMINATOR = 100n;
const REFERENCE_OVERHEAD_BYTES = 320n;
const MIN_REFERENCE_LOVELACE = 5_000_000n;
const FEE_BUFFER_LOVELACE = 5_000_000n;

const validatorTitles = {
  collateral: "collateral.collateral.spend",
  perpetual: "perpetual.perpetual.spend",
  options: "options.options.spend",
  notional: "notional.notional.spend",
  registry: "registry.registry.spend",
} as const;

type ValidatorName = keyof typeof validatorTitles;
type BlueprintValidator = {
  title: string;
  compiledCode: string;
  parameters?: unknown[];
};
type Blueprint = {
  preamble?: { title?: string; compiler?: { name?: string; version?: string }; plutusVersion?: string };
  validators?: BlueprintValidator[];
};

type CanonicalAssetFile = {
  network: string;
  networkMagic: number;
  assets: {
    sUSD: {
      status: string;
      txHash: string;
      policyId: string;
      tokenName: string;
      tokenNameHex: string;
      assetUnit: string;
      decimals: number;
      wholeSupply: string;
      baseUnits: string;
      ownerAddress: string;
      canonicalForDemo: boolean;
    };
  };
};

export type AppliedValidator = {
  name: ValidatorName;
  title: string;
  parameterLabels: string[];
  parameterValues: Array<string | number>;
  compiledCodeSha256: string;
  appliedScriptSha256: string;
  scriptHash: string;
  scriptAddress: string;
  scriptBytes: number;
  referenceReserveLovelace: string;
  scriptCbor: string;
};

export type DeploymentPlan = {
  version: 1;
  network: "preprod";
  networkMagic: 1;
  cip30NetworkId: 0;
  blueprintSha256: string;
  aikenVersion: string;
  createdAt: string;
  mmAddress: string;
  deployerAddress: string;
  authorities: {
    governor: string;
    guardian: string;
    oracle: string;
    keeper: string;
    settlement: string;
    solver: string;
  };
  collateral: {
    unit: string;
    policyId: string;
    tokenNameHex: string;
    requiredBaseUnits: string;
    observedBaseUnits: string;
  };
  maintenanceBps: number;
  coinsPerUtxoByte: string;
  totalReferenceReserveLovelace: string;
  minimumWalletLovelace: string;
  observedWalletLovelace: string;
  planRoot: string;
  validators: AppliedValidator[];
};

export type DeploymentReceipt = {
  name: ValidatorName;
  title: string;
  scriptHash: string;
  scriptAddress: string;
  scriptBytes: number;
  referenceReserveLovelace: string;
  txHash: string;
  outputIndex: number;
  referenceUtxo: string;
  confirmedAt: string;
};

export type DeploymentManifest = {
  version: 1;
  status: "partial" | "complete";
  network: "preprod";
  networkMagic: 1;
  blueprintSha256: string;
  planRoot: string;
  mmAddress: string;
  deployerAddress: string;
  authorities: DeploymentPlan["authorities"];
  collateral: DeploymentPlan["collateral"];
  startedAt: string;
  completedAt?: string;
  validators: DeploymentReceipt[];
};

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function stablePlanRoot(plan: Omit<DeploymentPlan, "createdAt" | "planRoot" | "validators">, validators: AppliedValidator[]) {
  const canonical = JSON.stringify({
    ...plan,
    validators: validators.map(({ scriptCbor: _scriptCbor, ...validator }) => validator),
  });
  return sha256(canonical);
}

function repoPaths() {
  const mmRoot = process.cwd();
  const repoRoot = resolve(mmRoot, "..");
  const secretRoot = resolve(mmRoot, ".secrets");
  mkdirSync(secretRoot, { recursive: true });
  return {
    mmRoot,
    repoRoot,
    secretRoot,
    blueprint: resolve(repoRoot, "plutus.json"),
    assets: resolve(mmRoot, "config", "preprod-assets.json"),
    plan: resolve(secretRoot, "preprod-validator-plan.json"),
    manifest: resolve(secretRoot, "preprod-validator-deployment.json"),
  };
}

function runPinnedAikenBuild(repoRoot: string, mmRoot: string) {
  const binary = resolve(mmRoot, "node_modules", ".bin", process.platform === "win32" ? "aiken.cmd" : "aiken");
  if (!existsSync(binary)) {
    throw new Error(`Pinned Aiken binary missing at ${binary}; run npm install in mm first`);
  }
  console.log(`Building validator blueprint with pinned Aiken ${EXPECTED_AIKEN_VERSION}...`);
  const result = spawnSync(binary, ["build"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`aiken build failed with exit code ${result.status}`);
}

function loadAndVerifyBlueprint(path: string): Blueprint {
  const raw = readFileSync(path);
  const digest = sha256(raw);
  if (digest !== EXPECTED_BLUEPRINT_SHA256) {
    throw new Error(
      `Blueprint digest mismatch. Expected CI-tested ${EXPECTED_BLUEPRINT_SHA256}, got ${digest}. Refusing deployment.`,
    );
  }
  const blueprint = JSON.parse(raw.toString("utf8")) as Blueprint;
  const compiler = blueprint.preamble?.compiler?.version ?? "";
  if (!compiler.includes(EXPECTED_AIKEN_VERSION.replace(/^v/, ""))) {
    throw new Error(`Unexpected Aiken compiler in blueprint: ${compiler || "unknown"}`);
  }
  if ((blueprint.preamble?.plutusVersion ?? "").toLowerCase() !== "v3") {
    throw new Error(`Expected Plutus V3 blueprint, got ${blueprint.preamble?.plutusVersion ?? "unknown"}`);
  }
  return blueprint;
}

function loadCanonicalAsset(path: string): CanonicalAssetFile["assets"]["sUSD"] {
  const file = JSON.parse(readFileSync(path, "utf8")) as CanonicalAssetFile;
  if (file.network !== "preprod" || file.networkMagic !== 1) throw new Error("Canonical asset file is not Cardano Preprod");
  const asset = file.assets?.sUSD;
  if (!asset || asset.status !== "minted" || !asset.canonicalForDemo) throw new Error("Canonical sUSD is not recorded as minted");
  if (asset.policyId.length !== 56 || asset.assetUnit !== `${asset.policyId}${asset.tokenNameHex}`) {
    throw new Error("Canonical sUSD policy/unit is malformed");
  }
  return asset;
}

function findValidator(blueprint: Blueprint, title: string) {
  const validator = blueprint.validators?.find((candidate) => candidate.title === title);
  if (!validator) throw new Error(`Missing validator ${title} in verified blueprint`);
  if (!validator.compiledCode || validator.compiledCode.length < 100) throw new Error(`Compiled code missing for ${title}`);
  return validator;
}

function applyValidator(
  blueprint: Blueprint,
  name: ValidatorName,
  params: Array<string | number>,
  coinsPerUtxoByte: bigint,
): AppliedValidator {
  const title = validatorTitles[name];
  const validator = findValidator(blueprint, title);
  const expectedCount = validator.parameters?.length ?? 0;
  if (params.length !== expectedCount) {
    throw new Error(`${title} parameter count mismatch: expected ${expectedCount}, got ${params.length}`);
  }
  const scriptCbor = applyParamsToScript(validator.compiledCode, params);
  const scriptHash = resolveScriptHash(scriptCbor, "V3");
  const scriptAddress = serializePlutusScript({ code: scriptCbor, version: "V3" }, undefined, 0).address;
  if (!scriptAddress.startsWith("addr_test1")) throw new Error(`${title} resolved outside Cardano testnet`);
  const scriptBytes = Math.ceil(scriptCbor.length / 2);
  const estimated = ((BigInt(scriptBytes) + REFERENCE_OVERHEAD_BYTES) * coinsPerUtxoByte * REFERENCE_SAFETY_NUMERATOR) /
    REFERENCE_SAFETY_DENOMINATOR;
  const reserve = estimated > MIN_REFERENCE_LOVELACE ? estimated : MIN_REFERENCE_LOVELACE;
  const labels = (validator.parameters ?? []).map((parameter) => {
    const label = (parameter as { title?: string }).title;
    return label ?? "unknown";
  });
  return {
    name,
    title,
    parameterLabels: labels,
    parameterValues: params,
    compiledCodeSha256: sha256(validator.compiledCode),
    appliedScriptSha256: sha256(scriptCbor),
    scriptHash,
    scriptAddress,
    scriptBytes,
    referenceReserveLovelace: reserve.toString(),
    scriptCbor,
  };
}

function quantityOf(balance: Array<{ unit: string; quantity: string }>, unit: string) {
  return BigInt(balance.find((asset) => asset.unit === unit)?.quantity ?? "0");
}

export async function buildDeploymentPlan(): Promise<{ plan: DeploymentPlan; wallet: MeshWallet; provider: BlockfrostProvider }> {
  if (config.network !== "preprod" || config.networkId !== 0) throw new Error("Validator deployment is pinned to Cardano Preprod");
  const paths = repoPaths();
  runPinnedAikenBuild(paths.repoRoot, paths.mmRoot);
  const blueprint = loadAndVerifyBlueprint(paths.blueprint);
  const canonicalAsset = loadCanonicalAsset(paths.assets);

  const provider = new BlockfrostProvider(config.blockfrostProjectId);
  const wallet = new MeshWallet({
    networkId: config.networkId,
    fetcher: provider,
    submitter: provider,
    key: { type: "mnemonic", words: config.mnemonic.split(/\s+/) },
  });
  await wallet.init();
  const mmAddress = await wallet.getChangeAddress();
  if (!mmAddress.startsWith("addr_test1")) throw new Error("MM wallet is not on Cardano testnet");
  if (mmAddress !== canonicalAsset.ownerAddress) throw new Error("MM wallet does not match canonical sUSD owner address");

  const mmKeyHash = deserializeAddress(mmAddress).pubKeyHash;
  const governorKeyHash = deserializeAddress(config.deployerAddress).pubKeyHash;
  if (!mmKeyHash || !governorKeyHash) throw new Error("Unable to derive payment key hashes for deployment authorities");
  if (mmKeyHash === governorKeyHash) throw new Error("Governor and Guardian must be separate keys");

  const maintenanceBps = Number(process.env.PERP_MAINTENANCE_BPS ?? "500");
  if (!Number.isInteger(maintenanceBps) || maintenanceBps <= 0 || maintenanceBps > 5000) {
    throw new Error("PERP_MAINTENANCE_BPS must be an integer from 1 to 5000");
  }

  const protocol = await provider.fetchProtocolParameters();
  const coinsPerUtxoByte = BigInt(String((protocol as unknown as { coinsPerUTxOSize?: number | string }).coinsPerUTxOSize ?? 4310));
  if (coinsPerUtxoByte <= 0n) throw new Error("Provider returned invalid coins-per-UTxO-byte");

  const balance = (await wallet.getBalance()) as Array<{ unit: string; quantity: string }>;
  const observedSusd = quantityOf(balance, canonicalAsset.assetUnit);
  const requiredSusd = BigInt(canonicalAsset.baseUnits);
  if (observedSusd !== requiredSusd) {
    throw new Error(
      `Canonical sUSD supply check failed in MM wallet: expected ${requiredSusd}, observed ${observedSusd}. Refusing validator deployment.`,
    );
  }
  const lovelace = quantityOf(balance, "lovelace");

  const validators = [
    applyValidator(blueprint, "collateral", [canonicalAsset.policyId, canonicalAsset.tokenNameHex], coinsPerUtxoByte),
    applyValidator(
      blueprint,
      "perpetual",
      [mmKeyHash, mmKeyHash, maintenanceBps, canonicalAsset.policyId, canonicalAsset.tokenNameHex],
      coinsPerUtxoByte,
    ),
    applyValidator(blueprint, "options", [mmKeyHash, canonicalAsset.policyId, canonicalAsset.tokenNameHex], coinsPerUtxoByte),
    applyValidator(blueprint, "notional", [mmKeyHash], coinsPerUtxoByte),
    applyValidator(blueprint, "registry", [governorKeyHash, mmKeyHash], coinsPerUtxoByte),
  ];

  const totalReserve = validators.reduce((sum, validator) => sum + BigInt(validator.referenceReserveLovelace), 0n);
  const minimumWallet = totalReserve + FEE_BUFFER_LOVELACE;
  if (lovelace < minimumWallet) {
    throw new Error(
      `Insufficient tADA for five reference scripts. Need at least ${minimumWallet} lovelace, observed ${lovelace}.`,
    );
  }

  const planBase = {
    version: 1 as const,
    network: "preprod" as const,
    networkMagic: 1 as const,
    cip30NetworkId: 0 as const,
    blueprintSha256: EXPECTED_BLUEPRINT_SHA256,
    aikenVersion: EXPECTED_AIKEN_VERSION,
    mmAddress,
    deployerAddress: config.deployerAddress,
    authorities: {
      governor: governorKeyHash,
      guardian: mmKeyHash,
      oracle: mmKeyHash,
      keeper: mmKeyHash,
      settlement: mmKeyHash,
      solver: mmKeyHash,
    },
    collateral: {
      unit: canonicalAsset.assetUnit,
      policyId: canonicalAsset.policyId,
      tokenNameHex: canonicalAsset.tokenNameHex,
      requiredBaseUnits: canonicalAsset.baseUnits,
      observedBaseUnits: observedSusd.toString(),
    },
    maintenanceBps,
    coinsPerUtxoByte: coinsPerUtxoByte.toString(),
    totalReferenceReserveLovelace: totalReserve.toString(),
    minimumWalletLovelace: minimumWallet.toString(),
    observedWalletLovelace: lovelace.toString(),
  };
  const planRoot = stablePlanRoot(planBase, validators);
  const plan: DeploymentPlan = {
    ...planBase,
    createdAt: new Date().toISOString(),
    planRoot,
    validators,
  };
  const publicPlan = {
    ...plan,
    validators: plan.validators.map(({ scriptCbor: _scriptCbor, ...validator }) => validator),
  };
  writeFileSync(paths.plan, `${JSON.stringify(publicPlan, null, 2)}\n`, { mode: 0o600 });
  return { plan, wallet, provider };
}

function utxoRef(utxo: UTxO) {
  return `${utxo.input.txHash}#${utxo.input.outputIndex}`;
}

async function waitForOutputZero(provider: BlockfrostProvider, txHash: string, expectedAddress: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 48; attempt += 1) {
    try {
      const outputs = await provider.fetchUTxOs(txHash);
      const output = outputs.find((utxo) => utxo.input.outputIndex === 0);
      if (output) {
        if (output.output.address !== expectedAddress) {
          throw new Error(`Reference output #0 address mismatch for ${txHash}`);
        }
        return output;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5000));
  }
  throw new Error(`Timed out waiting for Preprod confirmation of ${txHash}: ${String(lastError ?? "output not found")}`);
}

export async function deployValidators(plan: DeploymentPlan, wallet: MeshWallet, provider: BlockfrostProvider) {
  if (process.env.CONFIRM_PREPROD_DEPLOY !== "YES") {
    throw new Error('Refusing live deployment. Set the one-time environment variable CONFIRM_PREPROD_DEPLOY="YES".');
  }
  const paths = repoPaths();
  let manifest: DeploymentManifest;
  if (existsSync(paths.manifest)) {
    manifest = JSON.parse(readFileSync(paths.manifest, "utf8")) as DeploymentManifest;
    if (manifest.network !== "preprod" || manifest.planRoot !== plan.planRoot || manifest.mmAddress !== plan.mmAddress) {
      throw new Error("Existing local deployment manifest does not match current verified deployment plan");
    }
  } else {
    manifest = {
      version: 1,
      status: "partial",
      network: "preprod",
      networkMagic: 1,
      blueprintSha256: plan.blueprintSha256,
      planRoot: plan.planRoot,
      mmAddress: plan.mmAddress,
      deployerAddress: plan.deployerAddress,
      authorities: plan.authorities,
      collateral: plan.collateral,
      startedAt: new Date().toISOString(),
      validators: [],
    };
  }

  for (const validator of plan.validators) {
    if (manifest.validators.some((entry) => entry.name === validator.name)) {
      console.log(`Skipping ${validator.name}: already recorded in local manifest`);
      continue;
    }

    const protectedRefs = new Set(manifest.validators.map((entry) => entry.referenceUtxo));
    const allUtxos = await provider.fetchAddressUTxOs(plan.mmAddress);
    const spendable = allUtxos.filter((utxo) => !protectedRefs.has(utxoRef(utxo)));
    if (!spendable.length) throw new Error(`No spendable UTxOs remain before deploying ${validator.name}`);

    console.log(`Deploying ${validator.name} reference script (${validator.scriptBytes} bytes)...`);
    const unsignedTx = await new MeshTxBuilder({ fetcher: provider, submitter: provider })
      .txOut(plan.mmAddress, [{ unit: "lovelace", quantity: validator.referenceReserveLovelace }])
      .txOutReferenceScript(validator.scriptCbor, "V3")
      .changeAddress(plan.mmAddress)
      .selectUtxosFrom(spendable)
      .complete();
    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);
    console.log(`${validator.name} submitted: ${txHash}`);
    await waitForOutputZero(provider, txHash, plan.mmAddress);

    const receipt: DeploymentReceipt = {
      name: validator.name,
      title: validator.title,
      scriptHash: validator.scriptHash,
      scriptAddress: validator.scriptAddress,
      scriptBytes: validator.scriptBytes,
      referenceReserveLovelace: validator.referenceReserveLovelace,
      txHash,
      outputIndex: 0,
      referenceUtxo: `${txHash}#0`,
      confirmedAt: new Date().toISOString(),
    };
    manifest.validators.push(receipt);
    writeFileSync(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    console.log(`${validator.name} confirmed at ${receipt.referenceUtxo}`);
  }

  if (manifest.validators.length !== plan.validators.length) {
    throw new Error(`Deployment incomplete: ${manifest.validators.length}/${plan.validators.length} validators recorded`);
  }
  manifest.status = "complete";
  manifest.completedAt = new Date().toISOString();
  writeFileSync(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}

export function publicPlan(plan: DeploymentPlan) {
  return {
    ...plan,
    walletAda: (Number(BigInt(plan.observedWalletLovelace)) / 1_000_000).toFixed(6),
    totalReferenceAda: (Number(BigInt(plan.totalReferenceReserveLovelace)) / 1_000_000).toFixed(6),
    minimumWalletAda: (Number(BigInt(plan.minimumWalletLovelace)) / 1_000_000).toFixed(6),
    validators: plan.validators.map(({ scriptCbor: _scriptCbor, ...validator }) => ({
      ...validator,
      referenceReserveAda: (Number(BigInt(validator.referenceReserveLovelace)) / 1_000_000).toFixed(6),
    })),
  };
}
