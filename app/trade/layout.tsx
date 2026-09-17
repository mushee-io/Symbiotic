import type { ReactNode } from "react";
import { LivePerpLauncher } from "@/components/LivePerpLauncher";

export default function TradeLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <LivePerpLauncher />
    </>
  );
}
