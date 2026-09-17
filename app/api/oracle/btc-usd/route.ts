import { NextResponse } from "next/server";
import { fetchBtcUsdOracleRound } from "@/lib/server-btc-oracle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await fetchBtcUsdOracleRound());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "BTC/USD oracle unavailable" },
      { status: 503 },
    );
  }
}
