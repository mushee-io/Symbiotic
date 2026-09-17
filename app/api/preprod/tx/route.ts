import { KoiosProvider } from "@meshsdk/core";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const provider = new KoiosProvider("preprod");

export async function GET(request: Request) {
  try {
    const txHash = new URL(request.url).searchParams.get("txHash")?.trim().toLowerCase() ?? "";
    if (!/^[0-9a-f]{64}$/.test(txHash)) return NextResponse.json({ error: "Invalid transaction hash" }, { status: 400 });
    const info = await provider.fetchTxInfo(txHash);
    return NextResponse.json({ network: "preprod", txHash, confirmed: Boolean(info?.block), block: info?.block ?? null, fees: info?.fees ?? null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Transaction not visible yet", confirmed: false }, { status: 404 });
  }
}
