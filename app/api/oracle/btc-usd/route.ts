import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Observation = { source: string; price: number };

const TIMEOUT_MS = 4_000;
const MAX_DEVIATION_BPS = 75;

async function withTimeout<T>(label: string, fn: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function coinbase(): Promise<Observation> {
  return withTimeout("coinbase", async (signal) => {
    const response = await fetch("https://api.exchange.coinbase.com/products/BTC-USD/ticker", { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { price?: string };
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) throw new Error("invalid price");
    return { source: "coinbase", price };
  });
}

async function kraken(): Promise<Observation> {
  return withTimeout("kraken", async (signal) => {
    const response = await fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD", { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { error?: string[]; result?: Record<string, { c?: string[] }> };
    if (body.error?.length) throw new Error(body.error.join(", "));
    const ticker = Object.values(body.result ?? {})[0];
    const price = Number(ticker?.c?.[0]);
    if (!Number.isFinite(price) || price <= 0) throw new Error("invalid price");
    return { source: "kraken", price };
  });
}

async function gemini(): Promise<Observation> {
  return withTimeout("gemini", async (signal) => {
    const response = await fetch("https://api.gemini.com/v1/pubticker/btcusd", { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { last?: string };
    const price = Number(body.last);
    if (!Number.isFinite(price) || price <= 0) throw new Error("invalid price");
    return { source: "gemini", price };
  });
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export async function GET() {
  const settled = await Promise.allSettled([coinbase(), kraken(), gemini()]);
  const observations = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failures = settled.flatMap((result, index) => result.status === "rejected"
    ? [{ source: ["coinbase", "kraken", "gemini"][index], error: String(result.reason) }]
    : []);

  if (observations.length < 2) {
    return NextResponse.json({ error: "BTC/USD oracle quorum unavailable", observations, failures }, { status: 503 });
  }

  const price = median(observations.map((observation) => observation.price));
  const maxDeviationBps = Math.max(...observations.map((observation) => Math.abs(observation.price - price) / price * 10_000));
  if (maxDeviationBps > MAX_DEVIATION_BPS) {
    return NextResponse.json({ error: "BTC/USD oracle sources disagree", price, maxDeviationBps, observations, failures }, { status: 503 });
  }

  const generatedAt = new Date().toISOString();
  const roundId = createHash("sha256")
    .update(JSON.stringify({ market: "BTC-USD", observations: [...observations].sort((a, b) => a.source.localeCompare(b.source)), generatedAt }))
    .digest("hex");

  return NextResponse.json({
    market: "BTC-USD",
    price,
    sourceCount: observations.length,
    maxDeviationBps,
    observations,
    failures,
    generatedAt,
    roundId,
  });
}
