import type { Metadata } from "next";
import { LiveBtcOracleBridge } from "@/components/LiveBtcOracleBridge";
import "./globals.css";

export const metadata: Metadata = {
  title: "Symbiotic — Cardano Derivatives",
  description: "Perpetual markets, options, private pre-trade intent, and fail-closed Cardano execution infrastructure."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><LiveBtcOracleBridge />{children}</body></html>;
}
