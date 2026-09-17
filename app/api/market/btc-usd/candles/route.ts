import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CoinbaseCandle = [number, number, number, number, number, number];

export async function GET() {
  const response = await fetch("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60", {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    return NextResponse.json({ error: `Coinbase candles HTTP ${response.status}` }, { status: 503 });
  }

  const raw = await response.json() as CoinbaseCandle[];
  const candles = raw
    .filter((row) => Array.isArray(row) && row.length >= 6)
    .map(([time, low, high, open, close, volume]) => ({
      time,
      low,
      high,
      open,
      close,
      volume,
    }))
    .filter((candle) => [candle.time, candle.low, candle.high, candle.open, candle.close, candle.volume].every(Number.isFinite))
    .sort((a, b) => a.time - b.time)
    .slice(-90);

  if (candles.length < 2) {
    return NextResponse.json({ error: "BTC/USD candle history unavailable" }, { status: 503 });
  }

  return NextResponse.json({
    market: "BTC-USD",
    granularitySeconds: 60,
    source: "coinbase",
    candles,
    generatedAt: new Date().toISOString(),
  });
}
