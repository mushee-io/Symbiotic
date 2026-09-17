# Symbiotic-MM — Cardano Preprod

This service is the funded market-making / operator runtime for Symbiotic on Cardano Preprod.

## Security boundary

- Never commit the MM mnemonic or signing material.
- `mm/.secrets/` and `mm/.env` are ignored.
- The human Lace wallet remains separate from the MM hot wallet.
- The human/deployer wallet is stored only as a public `addr_test1...` address.
- Mainnet is out of scope. This package is pinned to Preprod / CIP-30 network id `0`.
- Live deployment requires an explicit one-time `CONFIRM_PREPROD_DEPLOY=YES` environment variable.

## 1. Install

```bash
cd mm
npm install
```

On Windows PowerShell where `.ps1` execution is disabled, use `npm.cmd` instead of `npm`.

## 2. Generate the dedicated MM wallet locally

```bash
npm run wallet:generate
```

The script prints only the public `addr_test1...` address. It writes the 24-word mnemonic to `.secrets/mm.mnemonic` locally. Back that file up securely and never paste it into GitHub.

## 3. Create a Preprod Blockfrost project

Create a project scoped to Cardano Preprod and copy its project id.

## 4. Configure local `.env`

Copy `.env.example` to `.env`, then set the Blockfrost project id and the locally generated MM mnemonic. Do not commit `.env`.

## 5. Fund and inspect the MM wallet

For the five reference scripts, keep roughly 100 tADA available initially. The deployment planner calculates the current minimum reserve from Preprod protocol parameters and refuses to deploy if the wallet is underfunded.

```bash
npm run wallet:inspect
```

## 6. Canonical sUSD

The live demo collateral is recorded in `config/preprod-assets.json`. The mint command is now guarded against accidental repeat minting.

```bash
npm run mint:susd
```

Do not run the mint command again after the canonical asset exists. The deployment preflight also requires the MM wallet to hold exactly the recorded canonical base-unit supply.

## 7. Plan the five-validator deployment

```bash
npm run deploy:plan
```

This command submits **no transaction**. It:

1. rebuilds the Aiken blueprint using pinned Aiken `v1.1.22`;
2. requires its SHA-256 digest to match the CI-tested v0.15 blueprint;
3. verifies the canonical sUSD balance exactly;
4. derives the Governor payment-key hash from the Lace deployer address;
5. derives Guardian / Oracle / Keeper / Settlement / Solver from the MM wallet for this demo generation;
6. applies validator parameters in their exact Aiken order;
7. derives all five applied Plutus V3 hashes and `addr_test1...` contract addresses;
8. fetches current Preprod protocol parameters and calculates conservative reference-script reserves;
9. writes the public plan to `.secrets/preprod-validator-plan.json`.

Validators:

- Collateral
- Perpetual
- Options
- Notional
- Registry

For the initial live demo the Lace wallet is Governor and the separate MM wallet is Guardian plus automated operator roles. This is real execution, but it is **not** yet the independent multi-operator topology required by the final V11 evidence gate.

## 8. Deploy the five reference scripts

Only after reviewing `deploy:plan`:

PowerShell:

```powershell
$env:CONFIRM_PREPROD_DEPLOY="YES"
npm.cmd run deploy:validators
Remove-Item Env:CONFIRM_PREPROD_DEPLOY
```

The deployment is sequential and resumable. Each confirmed script produces a real Preprod transaction hash and a reference UTxO (`txHash#0`). Previously deployed reference UTxOs are excluded from later coin selection so they are not accidentally consumed.

The local public receipt is written to:

```text
.secrets/preprod-validator-deployment.json
```

A deployment is only called complete when all five reference-script transactions have confirmed.

## 9. Start bootstrap MM

```bash
npm start
```

The current bootstrap runtime verifies the funded Preprod wallet and emits deterministic BTC-USD bid/ask quotes. After validator deployment, the next integration phase is signed oracle rounds + real collateral/position UTxOs + MM quote execution through Perpetual, Options, and Notional.
