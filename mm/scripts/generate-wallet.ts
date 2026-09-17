import { mkdir, writeFile, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { generateMnemonic, MeshWallet } from "@meshsdk/core";

const secretDir = resolve(process.cwd(), ".secrets");
const mnemonicPath = resolve(secretDir, "mm.mnemonic");
const addressPath = resolve(secretDir, "mm.address");

await mkdir(secretDir, { recursive: true, mode: 0o700 });
const mnemonicPhrase = generateMnemonic(256).trim();
const words = mnemonicPhrase.split(/\s+/);
if (words.length < 12) throw new Error("Generated mnemonic is invalid");

const wallet = new MeshWallet({
  networkId: 0,
  key: { type: "mnemonic", words },
});
await wallet.init();
const address = await wallet.getChangeAddress();

if (!address.startsWith("addr_test1")) {
  throw new Error(`Refusing to create non-testnet MM wallet: ${address}`);
}

await writeFile(mnemonicPath, `${mnemonicPhrase}\n`, { mode: 0o600 });
await writeFile(addressPath, `${address}\n`, { mode: 0o600 });
await chmod(mnemonicPath, 0o600).catch(() => undefined);
await chmod(addressPath, 0o600).catch(() => undefined);

console.log("Symbiotic-MM Preprod wallet created locally.");
console.log(`MM address: ${address}`);
console.log(`Mnemonic saved to: ${mnemonicPath}`);
console.log("Do not commit, paste, or send the mnemonic anywhere. Fund only the public MM address with test ADA.");
