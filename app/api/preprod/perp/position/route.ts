import { KoiosProvider } from "@meshsdk/core";
import { NextResponse } from "next/server";
import { findPerpPosition, parsePerpDatumCbor, serialisePerpPosition } from "@/lib/preprod-perp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const provider = new KoiosProvider("preprod");

export async function GET(request: Request) {
  try {
    const txHash = new URL(request.url).searchParams.get("txHash")?.trim().toLowerCase() ?? "";
    if (!/^[0-9a-f]{64}$/.test(txHash)) {
      return NextResponse.json({ error: "A 64-character Preprod transaction hash is required" }, { status: 400 });
    }
    const outputs = await provider.fetchUTxOs(txHash);
    const position = findPerpPosition(outputs);
    if (!position || !position.output.plutusData) {
      return NextResponse.json({ error: "No live sUSD-backed Perpetual output found in this transaction" }, { status: 404 });
    }
    const datum = parsePerpDatumCbor(position.output.plutusData);
    return NextResponse.json({ network: "preprod", position: serialisePerpPosition(position, datum) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read Preprod position" }, { status: 502 });
  }
}
