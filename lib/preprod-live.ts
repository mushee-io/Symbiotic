export const PREPROD_LIVE = {
  network: "preprod" as const,
  cip30NetworkId: 0,
  networkMagic: 1,
  market: "BTC-USD",
  priceScale: 1_000_000n,
  sUsd: {
    unit: "558015db095bf61d0fd364b484ebddedf16f8d193a884a1c7b9e62f673555344",
    decimals: 6,
  },
  seededDemoWallet: {
    address: "addr_test1qpdpatsf32h957mct8y7z6465fzt9nqdkdt0augpctd0z49galkv70u6sczqpxje3nuuy9kw9ts83uqtxjhk2v5pdyfqp72c6j",
    paymentKeyHash: "5a1eae098aae5a7b7859c9e16abaa244b2cc0db356fef101c2daf154",
  },
  perpetual: {
    scriptHash: "ec96a9e8107297fa37252671e8475355942b7ac8898552a2dc81abde",
    scriptAddress: "addr_test1wrkfd20gzpef073hy5n8r6z82d2eg2m6ezyc254zmjq6hhshp5t3t",
    referenceUtxo: "2f9d91e9971e845e83df270514c6ba5c552579e43de38a828ab6ebdf4af8cf76#0",
  },
} as const;

export function usdToBaseUnits(value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error("USD value must be positive");
  return BigInt(Math.round(value * 1_000_000));
}

export function priceToDatumUnits(value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error("Oracle price must be positive");
  return BigInt(Math.round(value * Number(PREPROD_LIVE.priceScale)));
}
