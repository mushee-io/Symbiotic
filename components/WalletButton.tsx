"use client";

import { useEffect, useMemo, useState } from "react";

type Cip30Api = {
  getNetworkId(): Promise<number>;
  getChangeAddress(): Promise<string>;
};

type Cip30Provider = {
  name?: string;
  enable(): Promise<Cip30Api>;
};

function isProvider(value: unknown): value is Cip30Provider {
  return Boolean(value && typeof value === "object" && "enable" in value && typeof (value as Cip30Provider).enable === "function");
}

export function WalletButton() {
  const [providers, setProviders] = useState<Array<[string, Cip30Provider]>>([]);
  const [selected, setSelected] = useState("");
  const [address, setAddress] = useState("");
  const [network, setNetwork] = useState<number | null>(null);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    // @meshsdk/core ships the canonical CIP-30 Window.cardano declaration.
    // Cast through unknown here so this lightweight header component can stay
    // provider-agnostic without redeclaring Window.cardano and conflicting with Mesh.
    const cardano = window.cardano as unknown as Record<string, unknown> | undefined;
    const entries = Object.entries(cardano ?? {}).filter((entry) => isProvider(entry[1])) as Array<[string, Cip30Provider]>;
    setProviders(entries);
    if (entries[0]) setSelected(entries[0][0]);
  }, []);

  const label = useMemo(() => {
    if (status === "connecting") return "CONNECTING…";
    if (address) return `${address.slice(0, 8)}…${address.slice(-6)}`;
    return "CONNECT WALLET";
  }, [address, status]);

  async function connect() {
    const provider = providers.find(([key]) => key === selected)?.[1];
    if (!provider) return setStatus("missing");
    try {
      setStatus("connecting");
      const api = await provider.enable();
      const [changeAddress, networkId] = await Promise.all([api.getChangeAddress(), api.getNetworkId()]);
      setAddress(changeAddress);
      setNetwork(networkId);
      setStatus("connected");
    } catch {
      setStatus("rejected");
    }
  }

  return (
    <div className="wallet-wrap">
      {!address && providers.length > 1 ? (
        <select aria-label="Cardano wallet" value={selected} onChange={(e) => setSelected(e.target.value)}>
          {providers.map(([key, provider]) => <option key={key} value={key}>{provider.name ?? key}</option>)}
        </select>
      ) : null}
      <button className="wallet-button" type="button" onClick={connect}>{label}</button>
      {address ? <span className="network-dot" title={network === 1 ? "Cardano mainnet" : `Cardano network ${network ?? "?"}`} /> : null}
      {status === "missing" ? <span className="micro-error">CIP-30 wallet not detected</span> : null}
      {status === "rejected" ? <span className="micro-error">Connection rejected</span> : null}
    </div>
  );
}
