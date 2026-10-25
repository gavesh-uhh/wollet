"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CARD_LOGOS, getCardLogo, prepareRegistryLogo, readCardLogo, searchCardLogos, type LogoRegistryEntry } from "../lib/card-logos";
import Icon from "./icons";

export function CardLogo({ value }: { value?: string }) {
  const logo = getCardLogo(value);
  if (!logo) return null;
  return <span className="card-logo-mark">
    {/* eslint-disable-next-line @next/next/no-img-element -- Bundled or local data URL; works offline. */}
    <img src={logo.src} alt={`${logo.name} logo`} draggable={false} />
  </span>;
}

export function LogoPicker({ value, onChange, onBusyChange }: {
  value: string;
  onChange: (value: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const requestId = useRef({ id: 0 });
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [registry, setRegistry] = useState<LogoRegistryEntry[]>([]);
  const [registryState, setRegistryState] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(24);
  const selected = getCardLogo(value);
  const results = useMemo(() => searchCardLogos([...CARD_LOGOS, ...registry], query), [registry, query]);
  const visible = results.slice(0, limit);
  useEffect(() => {
    const requests = requestId.current;
    return () => { requests.id++; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/logos/registry/index.json", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Registry unavailable");
      const data = await response.json();
      if (data.version !== 1 || !Array.isArray(data.entries)) throw new Error("Invalid registry");
      const entries = data.entries.filter((entry: LogoRegistryEntry) => typeof entry.id === "string" &&
        typeof entry.name === "string" && getCardLogo(entry.id)?.kind === "registry");
      if (!controller.signal.aborted) { setRegistry(entries); setRegistryState("ready"); }
    }).catch(() => { if (!controller.signal.aborted) setRegistryState("error"); });
    return () => { controller.abort(); };
  }, [retry]);
  const pick = (next: string) => {
    requestId.current.id++;
    setReading(false);
    onBusyChange?.(false);
    setError("");
    onChange(next);
  };
  const selectRegistry = async (next: string) => {
    const id = ++requestId.current.id;
    setReading(true);
    onBusyChange?.(true);
    setError("");
    try {
      await prepareRegistryLogo(next);
      if (requestId.current.id === id) onChange(next);
    } catch (error: unknown) {
      if (requestId.current.id === id) setError(error instanceof Error ? error.message : "Could not load this logo.");
    } finally {
      if (requestId.current.id === id) { setReading(false); onBusyChange?.(false); }
    }
  };
  return <div className="logo-picker">
    <label className="registry-search">Search the logo registry
      <input type="search" placeholder="Bank, app, brand…" value={query} onChange={event => {
        setQuery(event.target.value); setLimit(24);
      }} />
    </label>
    {selected && <div className="registry-selection"><CardLogo value={value} /><span>{selected.name}</span>
      <button type="button" aria-label="Remove card logo" onClick={() => pick("")}><Icon name="close" size={15} /></button>
    </div>}
    <p className="registry-count" role="status">{query ? `${results.length.toLocaleString()} ${results.length === 1 ? "match" : "matches"}` : `${results.length.toLocaleString()} logos to choose from`}{reading ? " · Preparing logo…" : ""}</p>
    <div className="registry-results" aria-label="Logo registry results">
    <div className="logo-grid" aria-label="Card logo">
      {!query &&
      <button type="button" className={`logo-option ${!value ? "chosen" : ""}`} aria-pressed={!value} onClick={() => pick("")}>
        <span className="logo-option-art logo-empty"><Icon name="card" size={25} /></span>
        <span>No logo</span>
      </button>}
      {visible.map(logo => <button type="button" key={logo.id}
        className={`logo-option ${value === logo.id ? "chosen" : ""}`} aria-pressed={value === logo.id}
        onClick={() => logo.id.startsWith("registry:") ? void selectRegistry(logo.id) : pick(logo.id)}>
        <span className="logo-option-art"><CardLogo value={logo.id} /></span>
        <span>{logo.name}</span>
      </button>)}
    </div>
    {results.length > limit && <button type="button" className="registry-more" onClick={() => setLimit(count => count + 24)}>Show more logos</button>}
    </div>
    {registryState === "loading" && <p className="registry-count" role="status">Loading the registry…</p>}
    {registryState === "error" && <div className="registry-empty"><p>The registry couldn’t load. Your saved logo and uploads still work.</p>
      <button type="button" onClick={() => { setRegistryState("loading"); setRetry(count => count + 1); }}>Try again</button></div>}
    {registryState === "ready" && results.length === 0 && <div className="registry-empty"><p>No logo found for “{query}”. Try a different name, or use your own image below.</p></div>}
    <span className="registry-credit">Brand registry · Simple Icons</span>
    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/avif" hidden onChange={async event => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      const id = ++requestId.current.id;
      setReading(true);
      onBusyChange?.(true);
      setError("");
      try {
        const logo = await readCardLogo(file);
        if (requestId.current.id === id) onChange(logo);
      } catch (error: unknown) {
        if (requestId.current.id === id) setError(error instanceof Error ? error.message : "Could not load the logo.");
      } finally {
        if (requestId.current.id === id) { setReading(false); onBusyChange?.(false); }
      }
    }} />
    <button type="button" className="logo-upload" disabled={reading} onClick={() => fileRef.current?.click()}>
      <Icon name="upload" size={17} /><span>{reading ? "Preparing logo…" : "Use your own logo"}</span>
      <small>From your photos</small>
    </button>
    {error && <p className="scan-error" role="alert">{error}</p>}
  </div>;
}
