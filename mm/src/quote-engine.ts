export type TwoSidedQuote = {
  market: string;
  indexPrice: number;
  bid: number;
  ask: number;
  spreadBps: number;
  notionalUsd: number;
  generatedAt: string;
};

export function buildTwoSidedQuote(input: {
  market: string;
  indexPrice: number;
  spreadBps: number;
  notionalUsd: number;
  now?: Date;
}): TwoSidedQuote {
  if (!Number.isFinite(input.indexPrice) || input.indexPrice <= 0) throw new Error("Invalid index price");
  if (!Number.isFinite(input.spreadBps) || input.spreadBps <= 0 || input.spreadBps > 500) throw new Error("Invalid spread");
  if (!Number.isFinite(input.notionalUsd) || input.notionalUsd <= 0) throw new Error("Invalid quote notional");
  const half = input.spreadBps / 20_000;
  const bid = input.indexPrice * (1 - half);
  const ask = input.indexPrice * (1 + half);
  if (!(bid < input.indexPrice && ask > input.indexPrice && bid < ask)) throw new Error("Invalid quote geometry");
  return {
    market: input.market,
    indexPrice: input.indexPrice,
    bid,
    ask,
    spreadBps: input.spreadBps,
    notionalUsd: input.notionalUsd,
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}
