"use client";

import { useEffect, useState } from "react";

type OraclePayload = {
  price?: number;
  sourceCount?: number;
  generatedAt?: string;
};

export function LiveHomepageOracle({ compact = false }: { compact?: boolean }) {
  const [price, setPrice] = useState<number | null>(null);
  const [sources, setSources] = useState(0);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function refresh() {
      try {
        const response = await fetch(`/api/oracle/btc-usd?t=${Date.now()}`, {
          cache: "no-store",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        const payload = await response.json() as OraclePayload;
        if (cancelled) return;
        const nextPrice = Number(payload.price);
        const nextSources = Number(payload.sourceCount ?? 0);
        const generatedAt = payload.generatedAt ? new Date(payload.generatedAt).getTime() : 0;
        const fresh = generatedAt > 0 && Math.abs(Date.now() - generatedAt) <= 30_000;
        setPrice(response.ok && Number.isFinite(nextPrice) && nextPrice > 0 ? nextPrice : null);
        setSources(response.ok ? nextSources : 0);
        setOnline(response.ok && nextSources >= 2 && fresh);
      } catch {
        if (!cancelled) {
          setOnline(false);
          setSources(0);
        }
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  if (compact) {
    return (
      <span className="live-oracle-compact">
        <i className={online ? "status-dot status-dot-live" : "status-dot"} />
        {online ? `LIVE ${sources}/3` : "CHECKING"}
      </span>
    );
  }

  return (
    <span className="live-oracle-value">
      <strong>{price ? `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"}</strong>
      <small><i className={online ? "status-dot status-dot-live" : "status-dot"} />{online ? `${sources}/3 ORACLE` : "ORACLE CHECKING"}</small>
    </span>
  );
}
