# Symbiotic-MM — Cardano Preprod

This service is the funded market-making / operator runtime for Symbiotic on Cardano Preprod.

## Security boundary

- Never commit the MM mnemonic or signing material.
- `mm/.secrets/` and `mm/.env` are ignored.
- The human Lace wallet remains separate from the MM hot wallet.
- The current deployer/human wallet is only stored as a public `addr_test1...` address.
- Mainnet is out of scope. This package is pinned to Preprod/testnet network id `0`.

## 1. Install

```bash
cd mm
npm install
```

## 2. Generate the dedicated MM wallet locally

```bash
npm run wallet:generate
```

The script prints only the public `addr_test1...` address. It writes the 24-word mnemonic to `.secrets/mm.mnemonic` locally. Back that file up securely and never paste it into GitHub.

## 3. Create a Preprod Blockfrost project

Create a project scoped to Cardano Preprod and copy the project id. It should begin with `preprod`.

## 4. Configure local `.env`

Copy `.env.example` to `.env`, then set:

```text
BLOCKFROST_PROJECT_ID=preprod...
MM_MNEMONIC=<the locally generated 24 words>
```

Do not commit `.env`.

## 5. Fund the MM wallet

Send Preprod tADA from the funded Lace deployer wallet or the official faucet to the public MM address. A starter target of 50–100 tADA is enough for the first rehearsal.

Verify:

```bash
npm run wallet:inspect
```

## 6. Mint real Preprod sUSD

```bash
npm run mint:susd
```

The mint command creates a real Cardano native asset using a signature policy controlled by the dedicated MM wallet. Default supply is 1,000,000 sUSD with 6 application-level decimals. Record the returned transaction hash, policy id, and asset unit.

## 7. Start bootstrap MM

```bash
npm start
```

The bootstrap runtime verifies the funded Preprod wallet and emits the first deterministic BTC-USD bid/ask quote. It deliberately does not submit quotes on-chain yet.

The next integration step is to replace the bootstrap index price with signed Symbiotic oracle rounds and route quote execution through the deployed Perpetual, Options, and Notional validators.
