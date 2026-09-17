"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

type OraclePayload = {
  market?: string;
  price?: number;
  sourceCount?: number;
  generatedAt?: string;
  error?: string;
};

const POLL_MS = 5_000;

function setReactNumberInput(labelNeedle: string, value: number) {
  const labels = Array.from(document.querySelectorAll("label"));
  const label = labels.find((node) => node.textContent?.toUpperCase().includes(labelNeedle.toUpperCase()));
  const input = label?.querySelector("input[type='number']") as HTMLInputElement | null;
  if (!input) return;

  const current = Number(input.value);
  if (Number.isFinite(current) && Math.abs(current - value) < 0.005) return;

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) return;
  setter.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function updateVisibleTicker(payload: OraclePayload) {
  const price = Number(payload.price);
  if (!Number.isFinite(price) || price <= 0) return;

  const chartPrice = document.querySelector(".chart strong");
  if (chartPrice) {
    chartPrice.textContent = `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  const chartStatus = document.querySelector(".chart p");
  if (chartStatus) {
    const sources = Number(payload.sourceCount ?? 0);
    chartStatus.textContent = `LIVE BTC/USD ORACLE • ${sources}/3 SOURCES`;
  }

  setReactNumberInput("MARK PRICE", price);
  setReactNumberInput("INDEX PRICE", price);
  setReactNumberInput("REFERENCE SPOT", price);

  const orderType = document.querySelector(".ticket select") as HTMLSelectElement | null;
  if (orderType?.value === "MARKET") {
    setReactNumberInput("ENTRY / LIMIT PRICE", price);
  }
}

export function LiveBtcOracleBridge() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/trade") return;

    let cancelled = false;
    let controller: AbortController | undefined;

    async function refresh() {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(`/api/oracle/btc-usd?t=${Date.now()}`, {
          cache: "no-store",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        const payload = await response.json() as OraclePayload;
        if (!cancelled && response.ok) updateVisibleTicker(payload);
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("[trade-oracle] live BTC/USD refresh failed", error);
        }
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [pathname]);

  return null;
}
