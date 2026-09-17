import { createHash } from "node:crypto";

export type OracleObservation = {
  source: "coinbase" | "kraken" | "gemini";
  price: number;
  observedAt: string;
  latencyMs: number;
};

export type OracleRound = {
  market: "BTC-USD";
  price: number;
  attestedAtMs: number;
  attestedAt: string;
  sourceCount: number;
  maxDeviationBps: number;
  observations: OracleObservation[];
  failedSources: Array<{ source: string; error: string }>;
  roundId: string;
};

type OracleSource = {
  name: OracleObservation["source"];
  url: string;
  parse: (payload: unknown) => number;
};

const sources: OracleSource[] = [
  {
    name: "coinbase",
    url: "https://api.coinbase.com/v2/prices/BTC-USD/spot",
    parse(payload) {
      const amount = (payload as { data?: { amount?: string } })?.data?.amount;
      return Number(amount);
    },
  },
  {
    name: "kraken",
    url: "https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
    parse(payload) {
      const result = (payload as { result?: Record<string, { c?: string[] }> })?.result;
      const ticker = result ? Object.values(result)[0] : undefined;
      return Number(ticker?.c?.[0]);
    },
  },
  {
    name: "gemini",
    url: "https://api.gemini.com/v1/pubticker/btcusd",
    parse(payload) {
      return Number((payload as { last?: string })?.last);
    },
  },
];

function assertPrice(source: string, price: number) {
  if (!Number.isFinite(price) || price <= 0) throw new Error(`${source} returned an invalid BTC/USD price`);
  return price;
}

function median(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

async function fetchSource(source: OracleSource, timeoutMs: number): Promise<OracleObservation> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "Symbiotic-MM/0.3",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload: unknown = await response.json();
    const price = assertPrice(source.name, source.parse(payload));
    return {
      source: source.name,
      price,
      observedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBtcUsdOracleRound(input?: {
  minSources?: number;
  maxDeviationBps?: number;
  timeoutMs?: number;
  now?: () => number;
}): Promise<OracleRound> {
  const minSources = input?.minSources ?? 2;
  const allowedDeviationBps = input?.maxDeviationBps ?? 75;
  const timeoutMs = input?.timeoutMs ?? 4_000;
  if (!Number.isInteger(minSources) || minSources < 2 || minSources > sources.length) throw new Error("oracle minSources must be 2 or 3");
  if (!Number.isFinite(allowedDeviationBps) || allowedDeviationBps <= 0 || allowedDeviationBps > 500) {
    throw new Error("oracle maxDeviationBps must be between 0 and 500");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000) throw new Error("oracle timeoutMs must be 500-30000");

  const settled = await Promise.allSettled(sources.map((source) => fetchSource(source, timeoutMs)));
  const observations: OracleObservation[] = [];
  const failedSources: Array<{ source: string; error: string }> = [];

  settled.forEach((result, index) => {
    const source = sources[index]!;
    if (result.status === "fulfilled") observations.push(result.value);
    else failedSources.push({ source: source.name, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  });

  if (observations.length < minSources) {
    throw new Error(`BTC/USD oracle quorum failed: ${observations.length}/${minSources} required sources succeeded`);
  }

  const price = median(observations.map((observation) => observation.price));
  const maxObservedDeviationBps = Math.max(
    ...observations.map((observation) => Math.abs(observation.price - price) / price * 10_000),
  );
  if (maxObservedDeviationBps > allowedDeviationBps) {
    throw new Error(
      `BTC/USD oracle deviation ${maxObservedDeviationBps.toFixed(2)} bps exceeds ${allowedDeviationBps} bps`,
    );
  }

  const attestedAtMs = input?.now?.() ?? Date.now();
  const canonical = JSON.stringify({
    market: "BTC-USD",
    price,
    attestedAtMs,
    observations: [...observations]
      .sort((a, b) => a.source.localeCompare(b.source))
      .map(({ source, price: sourcePrice }) => ({ source, price: sourcePrice })),
  });

  return {
    market: "BTC-USD",
    price,
    attestedAtMs,
    attestedAt: new Date(attestedAtMs).toISOString(),
    sourceCount: observations.length,
    maxDeviationBps: maxObservedDeviationBps,
    observations,
    failedSources,
    roundId: createHash("sha256").update(canonical).digest("hex"),
  };
}
