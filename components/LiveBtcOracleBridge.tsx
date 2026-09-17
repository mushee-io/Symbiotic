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

type Candle = {
  time: number;
  low: number;
  high: number;
  open: number;
  close: number;
  volume: number;
};

type CandlePayload = {
  candles?: Candle[];
  granularitySeconds?: number;
  generatedAt?: string;
  error?: string;
};

const ORACLE_POLL_MS = 2_000;
const CANDLE_REFRESH_MS = 15_000;
const WINDOW_CANDLES = 30;
const SVG_NS = "http://www.w3.org/2000/svg";

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

function styleChartOverlay() {
  const chart = document.querySelector(".chart") as HTMLElement | null;
  if (!chart) return null;

  chart.style.alignItems = "flex-start";
  chart.style.justifyContent = "flex-start";
  chart.style.padding = "0";
  chart.style.background = "#080808";

  const status = chart.querySelector("p") as HTMLElement | null;
  if (status) {
    status.style.position = "absolute";
    status.style.left = "20px";
    status.style.top = "14px";
    status.style.margin = "0";
    status.style.zIndex = "3";
  }

  const price = chart.querySelector("strong") as HTMLElement | null;
  if (price) {
    price.style.position = "absolute";
    price.style.left = "20px";
    price.style.top = "34px";
    price.style.margin = "0";
    price.style.fontSize = "32px";
    price.style.zIndex = "3";
    price.style.textShadow = "0 2px 12px #080808";
  }

  const small = chart.querySelector("small") as HTMLElement | null;
  if (small) {
    small.style.position = "absolute";
    small.style.left = "20px";
    small.style.bottom = "12px";
    small.style.zIndex = "3";
    small.style.margin = "0";
  }

  return chart;
}

function updateVisibleTicker(payload: OraclePayload) {
  const price = Number(payload.price);
  if (!Number.isFinite(price) || price <= 0) return;

  styleChartOverlay();

  const chartPrice = document.querySelector(".chart strong");
  if (chartPrice) {
    chartPrice.textContent = `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  const chartStatus = document.querySelector(".chart p");
  if (chartStatus) {
    const sources = Number(payload.sourceCount ?? 0);
    chartStatus.textContent = `LIVE BTC/USD • ${sources}/3 ORACLE SOURCES • 1M CANDLES • 2S TICK`;
  }

  const chartSmall = document.querySelector(".chart small");
  if (chartSmall) {
    chartSmall.textContent = `Live tick ${new Date().toLocaleTimeString()} • active candle updates every ~2s`;
  }

  setReactNumberInput("MARK PRICE", price);
  setReactNumberInput("INDEX PRICE", price);
  setReactNumberInput("REFERENCE SPOT", price);

  const orderType = document.querySelector(".ticket select") as HTMLSelectElement | null;
  if (orderType?.value === "MARKET") {
    setReactNumberInput("ENTRY / LIMIT PRICE", price);
  }
}

function svgEl<K extends keyof SVGElementTagNameMap>(name: K) {
  return document.createElementNS(SVG_NS, name);
}

function buildLiveCandles(rawCandles: Candle[], livePrice: number, nowMs: number) {
  const candles = rawCandles
    .map((candle) => ({ ...candle }))
    .sort((a, b) => a.time - b.time);

  if (candles.length === 0) return candles;

  const currentMinute = Math.floor(nowMs / 60_000) * 60;
  const last = candles[candles.length - 1]!;

  if (last.time < currentMinute) {
    const open = last.close;
    candles.push({
      time: currentMinute,
      open,
      high: Math.max(open, livePrice),
      low: Math.min(open, livePrice),
      close: livePrice,
      volume: 0,
    });
  } else {
    last.close = livePrice;
    last.high = Math.max(last.high, livePrice);
    last.low = Math.min(last.low, livePrice);
  }

  return candles.slice(-WINDOW_CANDLES);
}

function renderCandles(rawCandles: Candle[], livePrice: number) {
  const chart = styleChartOverlay();
  if (!chart || rawCandles.length < 2 || !Number.isFinite(livePrice) || livePrice <= 0) return;

  let svg = chart.querySelector("svg.live-btc-candles") as SVGSVGElement | null;
  if (!svg) {
    svg = svgEl("svg");
    svg.classList.add("live-btc-candles");
    svg.setAttribute("viewBox", "0 0 1000 320");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-label", "Live BTC USD one minute candlestick chart");
    svg.style.position = "absolute";
    svg.style.inset = "0";
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.zIndex = "1";
    svg.style.pointerEvents = "none";
    chart.prepend(svg);
  }

  const candles = buildLiveCandles(rawCandles, livePrice, Date.now());
  const minPrice = Math.min(...candles.map((candle) => candle.low));
  const maxPrice = Math.max(...candles.map((candle) => candle.high));
  const rawRange = Math.max(maxPrice - minPrice, 1);
  const pad = Math.max(rawRange * 0.08, livePrice * 0.00035);
  const lo = minPrice - pad;
  const hi = maxPrice + pad;
  const range = hi - lo;

  const width = 1000;
  const top = 18;
  const bottom = 298;
  const plotHeight = bottom - top;
  const step = width / candles.length;
  const bodyWidth = Math.max(5, step * 0.58);
  const y = (price: number) => top + ((hi - price) / range) * plotHeight;

  svg.replaceChildren();

  for (let i = 0; i <= 4; i += 1) {
    const gy = top + (plotHeight / 4) * i;
    const line = svgEl("line");
    line.setAttribute("x1", "0");
    line.setAttribute("x2", String(width));
    line.setAttribute("y1", String(gy));
    line.setAttribute("y2", String(gy));
    line.setAttribute("stroke", "#1f1f1f");
    line.setAttribute("stroke-width", "1");
    svg.append(line);
  }

  candles.forEach((candle, index) => {
    const x = index * step + step / 2;
    const isLive = index === candles.length - 1;
    const up = candle.close >= candle.open;
    const color = up ? "#e8ff47" : "#ff6161";

    const wick = svgEl("line");
    wick.setAttribute("x1", String(x));
    wick.setAttribute("x2", String(x));
    wick.setAttribute("y1", String(y(candle.high)));
    wick.setAttribute("y2", String(y(candle.low)));
    wick.setAttribute("stroke", color);
    wick.setAttribute("stroke-width", isLive ? "2.5" : "1.25");
    wick.setAttribute("opacity", isLive ? "1" : ".82");
    svg!.append(wick);

    const openY = y(candle.open);
    const closeY = y(candle.close);
    const body = svgEl("rect");
    body.setAttribute("x", String(x - bodyWidth / 2));
    body.setAttribute("y", String(Math.min(openY, closeY)));
    body.setAttribute("width", String(bodyWidth));
    body.setAttribute("height", String(Math.max(isLive ? 3 : 2, Math.abs(openY - closeY))));
    body.setAttribute("fill", color);
    body.setAttribute("opacity", isLive ? "1" : ".78");
    svg!.append(body);

    if (isLive) {
      const halo = svgEl("rect");
      halo.setAttribute("x", String(x - bodyWidth / 2 - 3));
      halo.setAttribute("y", String(Math.min(openY, closeY) - 3));
      halo.setAttribute("width", String(bodyWidth + 6));
      halo.setAttribute("height", String(Math.max(9, Math.abs(openY - closeY) + 6)));
      halo.setAttribute("fill", "none");
      halo.setAttribute("stroke", color);
      halo.setAttribute("stroke-width", "1");
      halo.setAttribute("opacity", ".55");
      svg!.append(halo);
    }
  });

  const priceY = y(livePrice);
  const priceLine = svgEl("line");
  priceLine.setAttribute("x1", "0");
  priceLine.setAttribute("x2", String(width));
  priceLine.setAttribute("y1", String(priceY));
  priceLine.setAttribute("y2", String(priceY));
  priceLine.setAttribute("stroke", "#e8ff47");
  priceLine.setAttribute("stroke-width", "1.2");
  priceLine.setAttribute("stroke-dasharray", "7 7");
  priceLine.setAttribute("opacity", ".7");
  svg.append(priceLine);
}

export function LiveBtcOracleBridge() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/trade") return;

    let cancelled = false;
    let oracleController: AbortController | undefined;
    let candleController: AbortController | undefined;
    let cachedCandles: Candle[] = [];
    let lastCandleFetch = 0;

    async function refreshCandles(force = false) {
      const now = Date.now();
      if (!force && cachedCandles.length > 1 && now - lastCandleFetch < CANDLE_REFRESH_MS) return;

      candleController?.abort();
      candleController = new AbortController();
      const response = await fetch(`/api/market/btc-usd/candles?t=${now}`, {
        cache: "no-store",
        signal: candleController.signal,
        headers: { Accept: "application/json" },
      });
      const payload = await response.json() as CandlePayload;
      if (!cancelled && response.ok && Array.isArray(payload.candles)) {
        cachedCandles = payload.candles;
        lastCandleFetch = now;
      }
    }

    async function refreshTick() {
      oracleController?.abort();
      oracleController = new AbortController();

      try {
        await refreshCandles(cachedCandles.length === 0);
        const response = await fetch(`/api/oracle/btc-usd?t=${Date.now()}`, {
          cache: "no-store",
          signal: oracleController.signal,
          headers: { Accept: "application/json" },
        });
        const oracle = await response.json() as OraclePayload;
        if (cancelled || !response.ok) return;

        updateVisibleTicker(oracle);
        const livePrice = Number(oracle.price);
        if (cachedCandles.length > 1 && Number.isFinite(livePrice) && livePrice > 0) {
          renderCandles(cachedCandles, livePrice);
        }
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("[trade-market] live BTC/USD refresh failed", error);
        }
      }
    }

    void refreshTick();
    const timer = window.setInterval(() => void refreshTick(), ORACLE_POLL_MS);
    return () => {
      cancelled = true;
      oracleController?.abort();
      candleController?.abort();
      window.clearInterval(timer);
    };
  }, [pathname]);

  return null;
}
