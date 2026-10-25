"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./icons";
import { centerCardCrop, recognizeCard, renderCardCanvas } from "../lib/card-ocr";
import { detectCardNetwork, parseCardText, type ScannedCard } from "../lib/card-scan";
import {
  createQrCardDraft,
  createSafeSharePayload,
  isSafeForQrSharing,
  parseScannedQr,
  stringifySharePayload,
} from "../lib/qr-share";
import { shareDetailsDirectly } from "../lib/share-formatter";
import {
  changeVaultPasscode,
  createNewVault,
  DEFAULT_DEVICE_PIN,
  exportEncryptedVaultFile,
  getRawVaultSchema,
  resetLocalVault,
  saveVaultData,
  unlockVault,
} from "../lib/vault-storage";
import type {
  BankAccountItem,
  CardPattern,
  CreditCardItem,
  EncryptedVaultStorageSchema,
  IdDocumentItem,
  QrCodeItem,
  UpiHandleItem,
  VaultData,
  WalletItem,
  WalletItemType,
} from "../lib/vault-types";

export const THEMES = [
  { id: "graphite", label: "Graphite" },
  { id: "ocean", label: "Ocean" },
  { id: "steel", label: "Steel" },
  { id: "silver", label: "Silver" },
  { id: "peach", label: "Peach" },
  { id: "sage", label: "Sage" },
  { id: "lilac", label: "Lilac" },
  { id: "cherry", label: "Cherry" },
  { id: "emerald", label: "Emerald" },
  { id: "indigo", label: "Indigo" },
  { id: "rose", label: "Rose" },
  { id: "sand", label: "Sand" },
];

export const PATTERNS = [
  "orbit",
  "wave",
  "plain",
  "grid",
  "stripes",
  "dots",
] as const;

function pickDifferent(current: string, options: readonly string[]) {
  const rest = options.filter((option) => option !== current);
  return rest[Math.floor(Math.random() * rest.length)] ?? current;
}

const SHARE_SWIPE_THRESHOLD = 88;
const SHARE_SWIPE_MAX = 124;

export interface WalletDisplayCard {
  id: string;
  name: string;
  bank: string;
  last4: string;
  theme: string;
  pattern: string;
  network: string;
  type: WalletItemType;
  raw: WalletItem;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [closing, setClosing] = useState(false);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    timer.current = setTimeout(
      onClose,
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180
    );
  }, [onClose]);

  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.showModal();
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.body.style.overflow = before;
      opener?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`sheet ${closing ? "closing" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) requestClose();
      }}
    >
      <div className="sheet-inner">
        <div
          className="sheet-head"
          onPointerDown={(e) => {
            if (e.pointerType === "touch")
              touch.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerUp={(e) => {
            const start = touch.current;
            touch.current = null;
            if (
              start &&
              e.clientY - start.y > 45 &&
              Math.abs(e.clientX - start.x) < 50
            )
              requestClose();
          }}
        >
          <span className="sheet-handle" aria-hidden="true" />
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close"
            onClick={requestClose}
          >
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function WalletCard({
  card,
  compact = false,
}: {
  card: WalletDisplayCard;
  compact?: boolean;
}) {
  return (
    <div
      className={`wallet-card theme-${card.theme} pattern-${card.pattern} ${
        compact ? "compact" : ""
      }`}
    >
      <div className="card-art" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="card-top">
        <span className="bank-name">
          {card.bank}
          <span className="bank-dot">.</span>
        </span>
        <span className="card-type">{card.network}</span>
      </div>
      <div className="card-bottom">
        <div>
          <span className="card-name">{card.name}</span>
          <span className="card-number">
            {card.type === "qr_code" ? (
              "Tap to view QR"
            ) : (
              <>•••• &nbsp;{card.last4 || "••••"}</>
            )}
          </span>
        </div>
        {card.type === "qr_code" ? (
          <Icon name="qr" size={28} />
        ) : (
          <Icon name="contactless" size={28} />
        )}
      </div>
    </div>
  );
}

function itemToDisplayCard(item: WalletItem): WalletDisplayCard {
  if (item.type === "credit_card") {
    const c = item as CreditCardItem;
    return {
      id: c.id,
      name: c.cardholderName || c.title || "Cardholder",
      bank: c.bankOrIssuer || "Card",
      last4: c.cardNumber ? c.cardNumber.slice(-4) : "",
      theme: c.colorTheme || "graphite",
      pattern: c.pattern || "orbit",
      network: c.cardType || "Debit",
      type: "credit_card",
      raw: item,
    };
  }
  if (item.type === "id_document") {
    const d = item as IdDocumentItem;
    return {
      id: d.id,
      name: d.fullName || d.title || "Card",
      bank: d.issuer || d.documentType || "Other card",
      last4: d.documentNumber ? d.documentNumber.slice(-4) : "",
      theme: d.colorTheme || "silver",
      pattern: d.pattern || "plain",
      network: d.documentType || "Other",
      type: "id_document",
      raw: item,
    };
  }
  if (item.type === "qr_code") {
    const q = item as QrCodeItem;
    return {
      id: q.id,
      name: q.title || "QR code",
      bank: "Saved QR",
      last4: "",
      theme: q.colorTheme || "silver",
      pattern: q.pattern || "plain",
      network: "QR",
      type: "qr_code",
      raw: item,
    };
  }
  if (item.type === "bank_account") {
    const b = item as BankAccountItem;
    return {
      id: b.id,
      name: b.accountHolder || b.title || "Account Holder",
      bank: b.bankName || "Bank",
      last4: b.accountNumber ? b.accountNumber.slice(-4) : "",
      theme: b.colorTheme || "ocean",
      pattern: b.pattern || "wave",
      network: b.accountType || "Bank",
      type: "bank_account",
      raw: item,
    };
  }
  if (item.type === "upi_handle") {
    const u = item as UpiHandleItem;
    return {
      id: u.id,
      name: u.accountHolderName || u.title || "Handle",
      bank: u.provider || "Payment",
      last4: u.handle.length > 8 ? u.handle.slice(-6) : u.handle,
      theme: u.colorTheme || "steel",
      pattern: u.pattern || "orbit",
      network: "Payment",
      type: "upi_handle",
      raw: item,
    };
  }
  return {
    id: item.id,
    name: item.title,
    bank: "Other",
    last4: "",
    theme: item.colorTheme || "silver",
    pattern: item.pattern || "plain",
    network: item.type === "secure_note" ? "Note" : "Item",
    type: item.type,
    raw: item,
  };
}

export default function Wallet() {
  const [ready, setReady] = useState(() => getRawVaultSchema()?.hasPasscode ?? false);
  const [locked, setLocked] = useState(() => getRawVaultSchema()?.hasPasscode ?? false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      return !localStorage.getItem("payit_onboarded_v2");
    } catch {
      return true;
    }
  });
  const [page, setPage] = useState<"wallet" | "settings">("wallet");
  const [modal, setModal] = useState<
    "add" | "card" | "customize" | "edit" | "share" | "scan" | "cardscan" | "import" | "qrview" | null
  >(null);

  const [schema, setSchema] = useState<EncryptedVaultStorageSchema | null>(() => getRawVaultSchema());
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  const [vaultData, setVaultData] = useState<VaultData | null>(null);

  const [selected, setSelected] = useState<string>("");
  const [filter, setFilter] = useState<"all" | "cards" | "bank" | "upi">("all");
  const [toast, setToast] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [isRevealed, setIsRevealed] = useState(false);

  const [scannedDraft, setScannedDraft] = useState<Partial<WalletItem> | null>(null);
  const [cardScanDraft, setCardScanDraft] = useState<ScannedCard | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  const suppressCardClick = useRef(false);
  const cardGesture = useRef<{ x: number; y: number; axis: "x" | "y" | null } | null>(null);
  const swipeXRef = useRef(0);
  const [swipeX, setSwipeX] = useState(0);

  const notify = useCallback((msg: string) => setToast(msg), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  // Load vault on mount
  useEffect(() => {
    const raw = getRawVaultSchema();
    if (!raw) {
      createNewVault(DEFAULT_DEVICE_PIN, false)
        .then(({ schema, key, data }) => {
          setSchema(schema);
          setVaultKey(key);
          setVaultData(data);
          if (data.items.length > 0) setSelected(data.items[0].id);
          setLocked(false);
          setReady(true);
        })
        .catch(() => setReady(true));
    } else {
      if (!raw.hasPasscode) {
        unlockVault(DEFAULT_DEVICE_PIN)
          .then((res) => {
            if ("data" in res) {
              setSchema(res.schema);
              setVaultKey(res.key);
              setVaultData(res.data);
              if (res.data.items.length > 0) setSelected(res.data.items[0].id);
              setLocked(false);
            } else {
              setLocked(true);
            }
            setReady(true);
          })
          .catch(() => {
            setLocked(true);
            setReady(true);
          });
      }
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const onInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onInstall);

    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get("import")) {
        const parsed = parseScannedQr(window.location.href);
        if (parsed.valid && parsed.itemDraft) {
          // One-time deep-link import from the URL on mount.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setScannedDraft(parsed.itemDraft);
          setModal("import");
        }
      }
    } catch {}

    return () => {
      window.removeEventListener("beforeinstallprompt", onInstall);
    };
  }, []);

  // Unlock action
  const handleUnlock = async () => {
    if (!pinInput) {
      setPinError("Enter your passcode.");
      return;
    }
    setPinError("");
    try {
      const res = await unlockVault(pinInput);
      if ("error" in res) {
        setPinError(res.error);
        setPinInput("");
      } else {
        setVaultKey(res.key);
        setVaultData(res.data);
        setSchema(res.schema);
        if (res.data.items.length > 0) setSelected(res.data.items[0].id);
        setLocked(false);
        setPinInput("");
        notify("Vault unlocked.");
      }
    } catch {
      setPinError("Could not unlock vault.");
    }
  };

  const handleLock = () => {
    setVaultKey(null);
    setVaultData(null);
    setLocked(true);
    setPinInput("");
    setPinError("");
  };

  const saveItems = async (items: WalletItem[]) => {
    if (!vaultData || !vaultKey) return;
    const updatedData: VaultData = { ...vaultData, items };
    setVaultData(updatedData);
    try {
      const s = await saveVaultData(updatedData, vaultKey);
      setSchema(s);
    } catch (e: unknown) {
      notify("Save error: " + (e instanceof Error ? e.message : "Unknown error"));
    }
  };

  const openAddSheet = () => {
    setCardScanDraft(null);
    setModal("add");
  };

  const cards: WalletDisplayCard[] = (vaultData?.items || []).map(itemToDisplayCard);
  const current = cards.find((c) => c.id === selected) || cards[0];

  const updateSwipe = (next: number) => {
    swipeXRef.current = next;
    setSwipeX(next);
  };

  const shareCardDetails = (card: WalletDisplayCard) => {
    navigator.vibrate?.(18);
    void shareDetailsDirectly(card.raw, notify);
  };

  const beginCardSwipe = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    cardGesture.current = { x: e.clientX, y: e.clientY, axis: null };
    suppressCardClick.current = false;
    updateSwipe(0);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const moveCardSwipe = (e: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = cardGesture.current;
    if (!gesture) return;
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    if (!gesture.axis) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      gesture.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (gesture.axis !== "x") return;
    e.preventDefault();
    const distance = Math.abs(dx);
    const next =
      distance <= SHARE_SWIPE_MAX
        ? dx
        : Math.sign(dx) * (SHARE_SWIPE_MAX + (distance - SHARE_SWIPE_MAX) * 0.25);
    if (
      Math.abs(next) >= SHARE_SWIPE_THRESHOLD &&
      Math.abs(swipeXRef.current) < SHARE_SWIPE_THRESHOLD
    ) {
      navigator.vibrate?.(8);
    }
    updateSwipe(next);
  };

  const endCardSwipe = () => {
    const gesture = cardGesture.current;
    cardGesture.current = null;
    if (!gesture) return;
    const dx = swipeXRef.current;
    updateSwipe(0);
    if (gesture.axis !== "x" || Math.abs(dx) <= 6) return;
    suppressCardClick.current = true;
    setTimeout(() => {
      suppressCardClick.current = false;
    }, 220);
    if (Math.abs(dx) >= SHARE_SWIPE_THRESHOLD && current) {
      if (current.type === "qr_code") {
        setModal("qrview");
      } else {
        shareCardDetails(current);
      }
    }
  };

  const cancelCardSwipe = () => {
    cardGesture.current = null;
    updateSwipe(0);
  };

  const copyPrimaryValue = async (raw: WalletItem) => {
    let text = "";
    let label = "Details";
    if (raw.type === "credit_card") {
      text = (raw as CreditCardItem).cardNumber;
      label = "Card Number";
    } else if (raw.type === "id_document") {
      text = (raw as IdDocumentItem).documentNumber;
      label = "Card Number";
    } else if (raw.type === "qr_code") {
      text = (raw as QrCodeItem).qrValue;
      label = "QR content";
    } else if (raw.type === "bank_account") {
      text = (raw as BankAccountItem).accountNumber;
      label = "Account Number";
    } else if (raw.type === "upi_handle") {
      text = (raw as UpiHandleItem).handle;
      label = "Payment ID";
    }
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(25);
      notify(`Copied ${label} to clipboard.`);
    } catch {
      notify(`Copy: ${text}`);
    }
  };

  const filteredCards = cards.filter((c) => {
    if (filter === "all") return true;
    if (filter === "cards") return c.type === "credit_card" || c.type === "id_document" || c.type === "qr_code";
    if (filter === "bank") return c.type === "bank_account";
    if (filter === "upi") return c.type === "upi_handle";
    return true;
  });

  if (!ready) {
    return (
      <div className="lock-view">
        <div className="loading-dot" />
        <p style={{ marginTop: 12, color: "#888" }}>Opening your wallet…</p>
      </div>
    );
  }

  if (locked) {
    return (
      <div className="app-shell">
        <div className="main-shell">
          <main className="main-content">
            <div className="lock-view">
              <div className="lock-avatar">
                <Icon name="lock" size={26} />
              </div>
              <h1>Wollet Locked</h1>
              <p>Enter your PIN to open your wallet.</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleUnlock();
                }}
                style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}
              >
                <input
                  type="password"
                  autoFocus
                  inputMode="numeric"
                  className="pin-field"
                  placeholder="••••"
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value);
                    setPinError("");
                  }}
                />
                {pinError && <p style={{ color: "#ef4444", fontSize: 12, marginBottom: 12 }}>{pinError}</p>}
                <button
                  type="submit"
                  className="primary-button"
                  style={{ width: "100%", maxWidth: 220 }}
                  disabled={!pinInput}
                >
                  Unlock Vault
                </button>
              </form>
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (showOnboarding) {
    return (
      <div className="app-shell">
        <div className="main-shell">
          <main className="main-content">
            <div className="onboarding-wrap">
              <div className="onboarding-header">
                <div className="onboarding-logo">
                  <Icon name="wallet" size={26} />
                </div>
                <h1>Welcome to Wollet</h1>
                <p>A simple place to keep your cards, accounts, and everyday details together.</p>

                <div className="onboarding-features">
                  <div className="onboarding-feature-card">
                    <div className="onboarding-feature-icon">
                      <Icon name="shield" size={19} />
                    </div>
                    <div className="onboarding-feature-text">
                      <strong>Just yours</strong>
                      <p>
                        Everything you add stays on this device. No sign-up, and no
                        one else can see it.
                      </p>
                    </div>
                  </div>

                  <div className="onboarding-feature-card">
                    <div className="onboarding-feature-icon">
                      <Icon name="qr" size={19} />
                    </div>
                    <div className="onboarding-feature-text">
                      <strong>Share only what you choose</strong>
                      <p>
                        Send account or payment details with a QR code. The rest
                        stays private.
                      </p>
                    </div>
                  </div>

                  <div className="onboarding-feature-card">
                    <div className="onboarding-feature-icon">
                      <Icon name="card" size={19} />
                    </div>
                    <div className="onboarding-feature-text">
                      <strong>All in one place</strong>
                      <p>
                        Cards, accounts, IDs, and notes live together, ready
                        whenever you need them.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="onboarding-actions">
                <button
                  className="primary-button full"
                  onClick={() => {
                    if (typeof localStorage !== "undefined") {
                      localStorage.setItem("payit_onboarded_v2", "true");
                    }
                    setShowOnboarding(false);
                  }}
                >
                  Start my wallet
                </button>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="main-shell">
        <main className="main-content">
          {/* Header */}
          <header className="app-header">
            <div className="app-heading">
              {page !== "wallet" && (
                <button
                  className="back-nav-btn"
                  aria-label="Back to wallet"
                  onClick={() => setPage("wallet")}
                >
                  <Icon name="back" size={20} />
                </button>
              )}
              <h1>{page === "wallet" ? "Wollet" : "Settings"}</h1>
            </div>
            {page === "wallet" && (
              <div className="header-actions">
                <button
                  className="header-button"
                  aria-label="Scan QR Code"
                  title="Scan QR Code"
                  onClick={() => setModal("scan")}
                >
                  <Icon name="scan" size={21} />
                </button>
                <button
                  className="header-button"
                  aria-label="Settings"
                  title="Settings"
                  onClick={() => setPage("settings")}
                >
                  <Icon name="settings" size={21} />
                </button>
                <button
                  className="header-button"
                  aria-label="Add item"
                  title="Add item"
                  onClick={openAddSheet}
                >
                  <Icon name="plus" size={23} />
                </button>
              </div>
            )}
          </header>

          <div key={page} className="screen">
            {page === "wallet" && (
              <>
                {/* Authentic Stacked Cards Column */}
                <section className="wallet-column" aria-label="Your cards">
                  {cards.length ? (
                    <div
                      className="card-stack"
                      aria-label="Swipe a card sideways to share its details"
                      style={{
                        height: `calc(var(--card-height, 220px) + ${
                          52 * Math.min(Math.max(cards.length - 1, 0), 2)
                        }px)`,
                      }}
                    >
                      {[
                        ...cards.filter((c) => c.id !== current?.id).slice(0, 2).reverse(),
                        ...(current ? [current] : []),
                      ].map((c, index, all) => {
                        const isSelected = c.id === current?.id;
                        const isQrCard = c.type === "qr_code";
                        const shareReady =
                          isSelected && Math.abs(swipeX) >= SHARE_SWIPE_THRESHOLD;
                        return (
                          <button
                            key={c.id}
                            className={`stack-card ${isSelected ? "selected" : ""} ${
                              isSelected && swipeX !== 0 ? "dragging" : ""
                            }`}
                            style={{
                              top: index * 52,
                              zIndex: index + 1,
                              transform: `scale(${1 - (all.length - 1 - index) * 0.025})`,
                            }}
                            aria-label={`${c.name}, ${c.bank}${
                              isSelected ? ", selected" : ", select card"
                            }`}
                            onPointerDown={isSelected ? beginCardSwipe : undefined}
                            onPointerMove={isSelected ? moveCardSwipe : undefined}
                            onPointerUp={isSelected ? endCardSwipe : undefined}
                            onPointerCancel={isSelected ? cancelCardSwipe : undefined}
                            onLostPointerCapture={isSelected ? cancelCardSwipe : undefined}
                            onClick={() => {
                              if (suppressCardClick.current) {
                                suppressCardClick.current = false;
                                return;
                              }
                              if (isSelected) {
                                setIsRevealed(false);
                                setModal(isQrCard ? "qrview" : "card");
                              } else {
                                setSelected(c.id);
                              }
                            }}
                          >
                            {isSelected && (
                              <div
                                className={`card-share-underlay ${shareReady ? "ready" : ""}`}
                                style={{ opacity: Math.min(1, Math.abs(swipeX) / 28) }}
                                aria-hidden="true"
                              >
                                <span
                                  className={`card-share-action ${
                                    swipeX > 0 ? "on-left" : "on-right"
                                  }`}
                                >
                                  <span className="share-orb">
                                    <Icon name={isQrCard ? "qr" : "share"} size={19} />
                                  </span>
                                  <span className="share-word">
                                    {shareReady ? "Release" : isQrCard ? "View" : "Share"}
                                  </span>
                                </span>
                              </div>
                            )}
                            <div
                              className="card-slide"
                              style={
                                isSelected
                                  ? { transform: `translate3d(${swipeX}px, 0, 0)` }
                                  : undefined
                              }
                            >
                              <WalletCard card={c} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <button className="empty-card" onClick={openAddSheet}>
                      <Icon name="plus" size={28} />
                      <span>Add a card or account</span>
                    </button>
                  )}

                  {cards.length > 1 && (
                    <div className="card-picker" aria-label="Choose a card">
                      {cards.map((c) => (
                        <button
                          key={c.id}
                          className={c.id === current?.id ? "active" : ""}
                          aria-label={`Select ${c.name}`}
                          aria-pressed={c.id === current?.id}
                          onClick={() => setSelected(c.id)}
                        >
                          <span className={`theme-dot theme-${c.theme}`} />
                          <span>{c.name}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {current && (
                    <div className="card-tools">
                      <button
                        className="text-button"
                        onClick={() => setModal("customize")}
                      >
                        <Icon name="palette" size={13} />
                        Customize style
                      </button>
                    </div>
                  )}

                  {/* Clean Action Row */}
                  <div className="action-row">
                    {current && current.type === "qr_code" ? (
                      <>
                        <button className="primary-button" onClick={() => setModal("qrview")}>
                          <Icon name="qr" size={19} />
                          View QR
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() => copyPrimaryValue(current.raw)}
                        >
                          <Icon name="copy" size={19} />
                          Copy QR
                        </button>
                      </>
                    ) : current && isSafeForQrSharing(current.raw) ? (
                      <>
                        <button className="primary-button" onClick={() => setModal("share")}>
                          <Icon name="qr" size={19} />
                          Share QR
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() => copyPrimaryValue(current.raw)}
                        >
                          <Icon name="copy" size={19} />
                          Copy Info
                        </button>
                      </>
                    ) : current ? (
                      <>
                        <button
                          className="primary-button"
                          onClick={() => copyPrimaryValue(current.raw)}
                        >
                          <Icon name="copy" size={19} />
                          Copy Number
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() => {
                            setIsRevealed(false);
                            setModal("card");
                          }}
                        >
                          <Icon name="eye" size={19} />
                          Details
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="primary-button" onClick={openAddSheet}>
                          <Icon name="plus" size={19} />
                          Add Card
                        </button>
                        <button className="secondary-button" onClick={() => setModal("scan")}>
                          <Icon name="scan" size={19} />
                          Scan QR
                        </button>
                      </>
                    )}
                  </div>
                </section>

                {/* Clean Library Section */}
                <section className="recent-section">
                  <div className="section-label">
                    <h2>Library</h2>
                    <div className="segmented">
                      {(["all", "cards", "bank", "upi"] as const).map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          className={filter === tab ? "chosen" : ""}
                          onClick={() => setFilter(tab)}
                        >
                          {tab === "all"
                            ? "All"
                            : tab === "cards"
                            ? "Cards"
                            : tab === "bank"
                            ? "Bank"
                            : "Payments"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="activity-list">
                    {!filteredCards.length ? (
                      <p className="activity-empty-line">No items in this category.</p>
                    ) : (
                      filteredCards.map((c) => (
                        <button
                          key={c.id}
                          className="activity-row"
                          onClick={() => {
                            setSelected(c.id);
                            setIsRevealed(false);
                            setModal(c.type === "qr_code" ? "qrview" : "card");
                          }}
                        >
                          <span className={`transaction-icon theme-${c.theme}`}>
                            <Icon
                              name={
                                c.type === "credit_card"
                                  ? "card"
                                  : c.type === "bank_account"
                                  ? "bank"
                                  : c.type === "upi_handle"
                                  ? "lightning"
                                  : c.type === "qr_code"
                                  ? "qr"
                                  : "fileText"
                              }
                              size={18}
                            />
                          </span>
                          <span className="transaction-info">
                            <strong>{c.name}</strong>
                            <small>
                              {c.bank} · {c.last4 ? `•••• ${c.last4}` : c.network}
                            </small>
                          </span>
                          <span className="row-badge">{c.network}</span>
                          <Icon name="chevron" size={14} />
                        </button>
                      ))
                    )}
                  </div>
                </section>
              </>
            )}

            {page === "settings" && (
              <section className="settings-page">
                <div className="settings-group">
                  <h2>Security</h2>
                  <div className="setting-row">
                    <span className="setting-icon">
                      <Icon name="lock" />
                    </span>
                    <div>
                      <strong>Passcode Protection</strong>
                      <p>
                        {schema?.hasPasscode
                          ? "Your vault is protected by a master PIN."
                          : "Device mode active. Set a master PIN for extra protection."}
                      </p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => {
                        const newPin = prompt("Enter new 4-8 digit master PIN:");
                        if (newPin && newPin.length >= 4 && vaultKey && vaultData) {
                          changeVaultPasscode(vaultKey, newPin, vaultData).then(
                            ({ schema: s }) => {
                              setSchema(s);
                              notify("Master PIN updated.");
                            }
                          );
                        }
                      }}
                    >
                      {schema?.hasPasscode ? "Change" : "Set PIN"}
                    </button>
                  </div>
                  {schema?.hasPasscode && (
                    <button className="setting-row" onClick={handleLock}>
                      <span className="setting-icon">
                        <Icon name="lock" />
                      </span>
                      <div>
                        <strong>Lock Vault Now</strong>
                        <p>Lock your cards and require PIN on next access.</p>
                      </div>
                      <Icon name="chevron" size={18} />
                    </button>
                  )}
                </div>

                <div className="settings-group">
                  <h2>Encrypted Storage</h2>
                  <div className="setting-row">
                    <span className="setting-icon">
                      <Icon name="shield" />
                    </span>
                    <div>
                      <strong>AES-256-GCM Storage</strong>
                      <p>
                        {cards.length} items stored encrypted in your local browser vault.
                      </p>
                    </div>
                  </div>
                  <button
                    className="setting-row"
                    onClick={() => {
                      const content = exportEncryptedVaultFile();
                      const blob = new Blob([content], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `wollet-vault-${new Date().toISOString().slice(0, 10)}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                      notify("Encrypted backup downloaded.");
                    }}
                  >
                    <span className="setting-icon">
                      <Icon name="download" />
                    </span>
                    <div>
                      <strong>Export Encrypted Backup</strong>
                      <p>Save a secure snapshot of your cards to a file.</p>
                    </div>
                    <Icon name="chevron" size={18} />
                  </button>
                </div>

                <div className="settings-group">
                  <h2>App</h2>
                  <button
                    className="setting-row"
                    onClick={() => {
                      setShowOnboarding(true);
                    }}
                  >
                    <span className="setting-icon">
                      <Icon name="info" />
                    </span>
                    <div>
                      <strong>About Wollet & Features</strong>
                      <p>View the security overview and guide.</p>
                    </div>
                    <Icon name="chevron" size={18} />
                  </button>
                  {installPrompt && (
                    <button
                      className="setting-row"
                      onClick={async () => {
                        await installPrompt.prompt();
                      }}
                    >
                      <span className="setting-icon">
                        <Icon name="download" />
                      </span>
                      <div>
                        <strong>Add to Home Screen</strong>
                      </div>
                      <Icon name="chevron" size={18} />
                    </button>
                  )}
                  <button
                    className="setting-row"
                    style={{ color: "#ef4444" }}
                    onClick={() => {
                      if (
                        confirm(
                          "Are you sure you want to permanently clear all local encrypted cards on this device?"
                        )
                      ) {
                        resetLocalVault();
                        window.location.reload();
                      }
                    }}
                  >
                    <span className="setting-icon">
                      <Icon name="trash" />
                    </span>
                    <div>
                      <strong style={{ color: "#ef4444" }}>Reset Vault</strong>
                      <p>Delete all cards and keys stored in this browser.</p>
                    </div>
                  </button>
                </div>

                <p className="settings-foot">Wollet Encrypted Vault 2.0</p>
              </section>
            )}
          </div>
        </main>
      </div>

      {toast && (
        <div className="toast" role="status">
          <Icon name="info" size={18} />
          {toast}
        </div>
      )}

      {/* MODALS */}
      {modal === "card" && current && (
        <CardDetailsSheet
          card={current}
          isRevealed={isRevealed}
          onToggleReveal={() => setIsRevealed(!isRevealed)}
          onCustomize={() => setModal("customize")}
          onEdit={() => setModal("edit")}
          onShare={() => setModal("share")}
          onShareDetails={() => shareCardDetails(current)}
          onDelete={() => {
            const next = (vaultData?.items || []).filter((i) => i.id !== current.id);
            saveItems(next);
            setModal(null);
            notify("Item removed from wallet.");
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal === "qrview" && current?.type === "qr_code" && (
        <QrCardSheet
          card={current}
          onCopy={() => copyPrimaryValue(current.raw)}
          onDelete={() => {
            const next = (vaultData?.items || []).filter((i) => i.id !== current.id);
            saveItems(next);
            setModal(null);
            notify("QR card removed from wallet.");
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal === "customize" && current && (
        <CardStyleSheet
          card={current}
          onClose={() => setModal(null)}
          onSave={(theme, pattern) => {
            const items = vaultData?.items || [];
            saveItems(
              items.map((i) =>
                i.id === current.id
                  ? { ...i, colorTheme: theme, pattern, updatedAt: Date.now() }
                  : i
              )
            );
            setModal(null);
            notify("Card style updated.");
          }}
        />
      )}

      {(modal === "add" || modal === "edit") && (
        <CardEditorSheet
          card={modal === "edit" ? current : undefined}
          scan={modal === "add" ? cardScanDraft : null}
          onScan={modal === "add" ? () => setModal("cardscan") : undefined}
          onClose={() => {
            setCardScanDraft(null);
            setModal(null);
          }}
          onSave={(savedItem) => {
            const items = vaultData?.items || [];
            const next =
              modal === "edit"
                ? items.map((i) => (i.id === savedItem.id ? savedItem : i))
                : [savedItem, ...items];
            saveItems(next);
            setSelected(savedItem.id);
            setCardScanDraft(null);
            setModal(null);
            notify(modal === "edit" ? "Card updated." : "Item saved & encrypted.");
          }}
        />
      )}

      {modal === "cardscan" && (
        <CardScanSheet
          onResult={(scan) => {
            setCardScanDraft(scan);
            setModal("add");
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal === "share" && current && (
        <ShareQrSheet
          card={current}
          notify={notify}
          onClose={() => setModal(null)}
        />
      )}

      {modal === "scan" && (
        <ScanQrSheet
          onResult={(res) => {
            const parsed = parseScannedQr(res);
            const draft =
              parsed.valid && parsed.itemDraft
                ? parsed.itemDraft
                : createQrCardDraft(res);
            if (!draft) {
              notify(parsed.error || "Unrecognized QR code.");
              return;
            }
            setScannedDraft(draft);
            setModal("import");
          }}
          onError={(err) => notify(err)}
          onClose={() => setModal(null)}
        />
      )}

      {modal === "import" && scannedDraft && (
        <ImportItemSheet
          draft={scannedDraft}
          onSave={(item) => {
            const items = vaultData?.items || [];
            saveItems([item, ...items]);
            setSelected(item.id);
            setScannedDraft(null);
            setModal(null);
            notify("Scanned item saved to wallet!");
          }}
          onClose={() => {
            setScannedDraft(null);
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// CARD DETAILS MODAL
// ============================================================================
function CardDetailsSheet({
  card,
  isRevealed,
  onToggleReveal,
  onCustomize,
  onEdit,
  onShare,
  onShareDetails,
  onDelete,
  onClose,
}: {
  card: WalletDisplayCard;
  isRevealed: boolean;
  onToggleReveal: () => void;
  onCustomize: () => void;
  onEdit: () => void;
  onShare: () => void;
  onShareDetails: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const raw = card.raw;
  const isBank = raw.type === "bank_account";
  const isCard = raw.type === "credit_card";
  const isUpi = raw.type === "upi_handle";
  const isDocument = raw.type === "id_document";

  const bank = isBank ? (raw as BankAccountItem) : null;
  const cc = isCard ? (raw as CreditCardItem) : null;
  const upi = isUpi ? (raw as UpiHandleItem) : null;
  const document = isDocument ? (raw as IdDocumentItem) : null;

  return (
    <Sheet title="Card details" onClose={onClose}>
      <WalletCard card={card} compact />

      <div className="detail-list">
        <div>
          <span>Name</span>
          <strong>{card.name}</strong>
        </div>
        <div>
          <span>{isDocument ? "Issuer" : "Label"}</span>
          <strong>{card.bank}</strong>
        </div>

        {cc && (
          <>
            <div>
              <span>Card number</span>
              <strong>
                {isRevealed
                  ? cc.cardNumber
                  : `•••• •••• •••• ${cc.cardNumber.slice(-4) || "••••"}`}
              </strong>
            </div>
            <div>
              <span>Expiration</span>
              <strong>
                {cc.expiryMonth}/{cc.expiryYear}
              </strong>
            </div>
            <div>
              <span>CVV</span>
              <strong>{isRevealed ? cc.cvv : "•••"}</strong>
            </div>
          </>
        )}

        {bank && (
          <>
            <div>
              <span>Account number</span>
              <strong>
                {isRevealed
                  ? bank.accountNumber
                  : `•••• ${bank.accountNumber.slice(-4)}`}
              </strong>
            </div>
            {bank.branchName && (
              <div>
                <span>Branch</span>
                <strong>{bank.branchName}</strong>
              </div>
            )}
            {bank.routingOrIfsc && (
              <div>
                <span>Routing / IFSC</span>
                <strong>{bank.routingOrIfsc}</strong>
              </div>
            )}
            {bank.swiftBic && (
              <div>
                <span>SWIFT</span>
                <strong>{bank.swiftBic}</strong>
              </div>
            )}
          </>
        )}

        {upi && (
          <div>
            <span>Payment ID</span>
            <strong>{upi.handle}</strong>
          </div>
        )}

        {document && (
          <>
            <div>
              <span>Type</span>
              <strong>{document.documentType}</strong>
            </div>
            <div>
              <span>Card number</span>
              <strong>
                {isRevealed
                  ? document.documentNumber
                  : `•••• ${document.documentNumber.slice(-4) || "••••"}`}
              </strong>
            </div>
            {document.expiryDate && (
              <div>
                <span>Expiry</span>
                <strong>{document.expiryDate}</strong>
              </div>
            )}
          </>
        )}
      </div>

      <button className="secondary-button full" onClick={onToggleReveal}>
        <Icon name={isRevealed ? "eyeOff" : "eye"} size={17} />
        {isRevealed ? "Mask details" : isCard ? "Reveal numbers & CVV" : "Reveal details"}
      </button>

      <button className="secondary-button full" onClick={onShareDetails}>
        <Icon name="share" size={18} />
        Share details
      </button>

      {isSafeForQrSharing(raw) ? (
        <button className="primary-button full" onClick={onShare}>
          <Icon name="qr" size={18} />
          Share Safe QR
        </button>
      ) : (
        <p className="notice" style={{ marginTop: 12 }}>
          <Icon name="info" />
          This is a personal card. Full card numbers and CVVs are encrypted locally and cannot be broadcast over QR.
        </p>
      )}

      <button className="secondary-button full" onClick={onCustomize}>
        <Icon name="palette" size={18} />
        Customize card style
      </button>

      <button className="secondary-button full" onClick={onEdit}>
        <Icon name="card" size={18} />
        Edit card details
      </button>

      <button
        className="danger-button full"
        onClick={() => {
          if (confirm("Remove this card from your wallet?")) {
            onDelete();
          }
        }}
      >
        <Icon name="trash" size={16} />
        Remove card
      </button>
    </Sheet>
  );
}

// ============================================================================
// CARD STYLE PICKER
// ============================================================================
function StyleControls({
  theme,
  pattern,
  onTheme,
  onPattern,
}: {
  theme: string;
  pattern: string;
  onTheme: (theme: string) => void;
  onPattern: (pattern: CardPattern) => void;
}) {
  const shuffle = () => {
    onTheme(pickDifferent(theme, THEMES.map((t) => t.id)));
    onPattern(pickDifferent(pattern, PATTERNS) as CardPattern);
  };

  return (
    <>
      <div className="editor-section">
        <div className="style-head">
          <span className="field-label">Color</span>
          <button
            type="button"
            className="text-button style-shuffle"
            onClick={shuffle}
          >
            <Icon name="shuffle" size={14} />
            Shuffle
          </button>
        </div>
        <div className="swatches">
          {THEMES.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`swatch theme-${t.id} ${theme === t.id ? "chosen" : ""}`}
              title={t.label}
              aria-label={t.label}
              aria-pressed={theme === t.id}
              onClick={() => onTheme(t.id)}
            >
              {theme === t.id && <Icon name="check" size={18} />}
            </button>
          ))}
        </div>
      </div>

      <div className="editor-section">
        <span className="field-label">Texture</span>
        <div className="texture-grid">
          {PATTERNS.map((p) => (
            <button
              type="button"
              key={p}
              className={pattern === p ? "chosen" : ""}
              aria-pressed={pattern === p}
              onClick={() => onPattern(p)}
            >
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function CardStyleSheet({
  card,
  onClose,
  onSave,
}: {
  card: WalletDisplayCard;
  onClose: () => void;
  onSave: (theme: string, pattern: CardPattern) => void;
}) {
  const [theme, setTheme] = useState(card.theme);
  const [pattern, setPattern] = useState<CardPattern>(card.pattern as CardPattern);
  const preview: WalletDisplayCard = { ...card, theme, pattern };

  return (
    <Sheet title="Card style" onClose={onClose}>
      <WalletCard card={preview} compact />
      <StyleControls
        theme={theme}
        pattern={pattern}
        onTheme={setTheme}
        onPattern={setPattern}
      />
      <button
        className="primary-button full"
        onClick={() => onSave(theme, pattern)}
      >
        <Icon name="check" size={18} />
        Apply style
      </button>
    </Sheet>
  );
}

// ============================================================================
// CARD EDITOR MODAL (ADD / EDIT)
// ============================================================================
function CardEditorSheet({
  card,
  scan,
  onScan,
  onClose,
  onSave,
}: {
  card?: WalletDisplayCard;
  scan?: ScannedCard | null;
  onScan?: () => void;
  onClose: () => void;
  onSave: (item: WalletItem) => void;
}) {
  const existingRaw = card?.raw;
  const existingCard = existingRaw?.type === "credit_card" ? (existingRaw as CreditCardItem) : null;
  const existingDocument =
    existingRaw?.type === "id_document" ? (existingRaw as IdDocumentItem) : null;
  const existingBank =
    existingRaw?.type === "bank_account" ? (existingRaw as BankAccountItem) : null;
  const scannedType = scan ? (scan.kind === "other" ? "id_document" : "credit_card") : null;
  const [type, setType] = useState<WalletItemType>(
    existingRaw?.type || scannedType || "bank_account"
  );
  const [name, setName] = useState(card?.name || scan?.holder || scan?.issuer || "");
  const [bank, setBank] = useState(card?.bank || scan?.issuer || "");
  const [number, setNumber] = useState(
    existingCard?.cardNumber ||
      (existingRaw?.type === "bank_account"
        ? (existingRaw as BankAccountItem).accountNumber
        : existingRaw?.type === "upi_handle"
        ? (existingRaw as UpiHandleItem).handle
        : existingDocument?.documentNumber) ||
      scan?.number ||
      ""
  );
  const [theme, setTheme] = useState(
    card?.theme || (scan ? "graphite" : "ocean")
  );
  const [pattern, setPattern] = useState(
    card?.pattern || (scan?.kind === "other" ? "plain" : "orbit")
  );
  const [network, setNetwork] = useState(
    card?.network ||
      existingCard?.cardType ||
      existingDocument?.documentType ||
      (scan
        ? scan.kind === "other"
          ? scan.documentType
          : scan.cardType
        : "Savings")
  );

  // Auxiliary fields
  const [expMonth, setExpMonth] = useState(existingCard?.expiryMonth || scan?.expiryMonth || "");
  const [expYear, setExpYear] = useState(existingCard?.expiryYear || scan?.expiryYear || "");
  const [cvv, setCvv] = useState(existingCard?.cvv || "");
  const [routing, setRouting] = useState(existingBank?.routingOrIfsc || "");
  const [branch, setBranch] = useState(existingBank?.branchName || "");
  const [expiryDate, setExpiryDate] = useState(
    existingDocument?.expiryDate ||
      (scan?.kind === "other" && scan.expiryMonth
        ? `${scan.expiryMonth}/${scan.expiryYear}`
        : "")
  );
  const [numberUnverified, setNumberUnverified] = useState(scan?.numberValid === false);

  const previewCard: WalletDisplayCard = {
    id: card?.id || "preview",
    name: name || "Card Name",
    bank:
      bank ||
      (type === "credit_card"
        ? "Card"
        : type === "upi_handle"
        ? "Payment"
        : type === "id_document"
        ? "Other card"
        : "Bank"),
    last4: number ? number.slice(-4) : "••••",
    theme,
    pattern,
    network,
    type,
    raw: {} as WalletItem,
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = card?.id || `item-${Date.now()}`;
    const base: Record<string, unknown> = {
      ...(existingRaw || {}),
      id,
      type,
      title: name.trim() || bank.trim() || "Other card",
      colorTheme: theme,
      pattern,
      isFavorite: existingRaw?.isFavorite || false,
      tags: existingRaw?.tags || [],
      createdAt: existingRaw?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    if (type === "bank_account") {
      base.bankName = bank.trim();
      base.accountHolder = name.trim();
      base.accountNumber = number.trim();
      base.accountType = network;
      base.currency = "USD";
      base.routingOrIfsc = routing.trim();
      base.branchName = branch.trim();
    } else if (type === "credit_card") {
      base.bankOrIssuer = bank.trim();
      base.cardholderName = name.trim().toUpperCase();
      base.cardNumber = number.replace(/[\s-]/g, "");
      base.expiryMonth = expMonth;
      base.expiryYear = expYear;
      base.cvv = cvv;
      base.network = detectCardNetwork(number);
      base.cardType = network;
    } else if (type === "id_document") {
      base.documentType = network;
      base.documentNumber = number.trim();
      base.fullName = name.trim();
      base.issuer = bank.trim() || undefined;
      base.expiryDate = expiryDate.trim() || undefined;
    } else if (type === "upi_handle") {
      base.provider = bank.trim() || "Payment";
      base.accountHolderName = name.trim();
      base.handle = number.trim();
    }

    onSave(base as unknown as WalletItem);
  };

  return (
    <Sheet title={card ? "Edit card" : "Add to wallet"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <WalletCard card={previewCard} compact />

        {!card && onScan && (
          <button type="button" className="scan-invite" onClick={onScan}>
            <span className="scan-invite-icon">
              <Icon name="camera" size={20} />
            </span>
            <span>
              <strong>Scan a card</strong>
              <small>Fill it in from your camera or a photo</small>
            </span>
            <Icon name="chevron" size={16} />
          </button>
        )}

        {scan && (
          <p className={`notice scan-notice ${numberUnverified ? "scan-warning" : ""}`}>
            <Icon name="info" />
            {numberUnverified
              ? "Check the card number: it did not pass the checksum. OCR can misread a digit."
              : "Scanned on this device. Check each field before saving."}
          </p>
        )}

        {!card && (
          <div className="editor-section">
            <span className="field-label">Type</span>
            <div className="segmented">
              {[
                { id: "bank_account", label: "Bank" },
                { id: "credit_card", label: "Card" },
                { id: "upi_handle", label: "Payment" },
                { id: "id_document", label: "Other card" },
              ].map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className={type === t.id ? "chosen" : ""}
                  onClick={() => {
                    setType(t.id as WalletItemType);
                    setNetwork(
                      t.id === "bank_account"
                        ? "Savings"
                        : t.id === "credit_card"
                        ? "Debit"
                        : t.id === "id_document"
                        ? "Other"
                        : "Payment"
                    );
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {!card && (
          <StyleControls
            theme={theme}
            pattern={pattern}
            onTheme={setTheme}
            onPattern={setPattern}
          />
        )}

        <label>
          {type === "credit_card"
            ? "Cardholder name"
            : type === "bank_account"
            ? "Account holder name"
            : type === "id_document"
            ? "Name on card"
            : "Name / Label"}
          <input
            required
            maxLength={32}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="form-grid">
          <label>
            {type === "credit_card"
              ? "Bank or issuer"
              : type === "bank_account"
              ? "Bank name"
              : type === "id_document"
              ? "Issuer / organization"
              : "Payment app"}
            <input
              required={type !== "id_document"}
              maxLength={30}
              value={bank}
              onChange={(e) => setBank(e.target.value)}
            />
          </label>
          <label>
            Type
            <select value={network} onChange={(e) => setNetwork(e.target.value)}>
              {type === "bank_account" ? (
                <>
                  <option>Savings</option>
                  <option>Checking</option>
                  <option>Current</option>
                  <option>Account</option>
                </>
              ) : type === "credit_card" ? (
                <>
                  <option>Debit</option>
                  <option>Credit</option>
                  <option>Prepaid</option>
                </>
              ) : type === "id_document" ? (
                <>
                  <option>Campus card</option>
                  <option>Membership</option>
                  <option>Other</option>
                </>
              ) : (
                <option>Payment</option>
              )}
            </select>
          </label>
        </div>

        <label>
          {type === "credit_card"
            ? "Card number (encrypted)"
            : type === "bank_account"
            ? "Account number"
            : type === "id_document"
            ? "Card / member number"
            : "Payment ID / Handle"}
          <input
            required
            inputMode={type === "credit_card" ? "numeric" : undefined}
            autoComplete="off"
            value={number}
            onChange={(e) => {
              setNumber(e.target.value);
              setNumberUnverified(false);
            }}
          />
        </label>

        {type === "credit_card" && (
          <div className="form-grid">
            <label>
              Expiry (MM / YY)
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  inputMode="numeric"
                  maxLength={2}
                  value={expMonth}
                  onChange={(e) => setExpMonth(e.target.value)}
                />
                <input
                  inputMode="numeric"
                  maxLength={2}
                  value={expYear}
                  onChange={(e) => setExpYear(e.target.value)}
                />
              </div>
            </label>
            <label>
              CVV
              <input
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={cvv}
                onChange={(e) => setCvv(e.target.value)}
              />
            </label>
          </div>
        )}

        {type === "id_document" && (
          <label>
            Expiry <span className="optional">optional</span>
            <input
              placeholder="MM / YY"
              maxLength={12}
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </label>
        )}

        {type === "bank_account" && (
          <div className="form-grid">
            <label>
              Branch <span className="optional">optional</span>
              <input
                placeholder="e.g. Colombo"
                maxLength={40}
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </label>
            <label>
              Routing / IFSC <span className="optional">optional</span>
              <input
                placeholder="e.g. SAMPLE01"
                value={routing}
                onChange={(e) => setRouting(e.target.value)}
              />
            </label>
          </div>
        )}

        <button type="submit" className="primary-button full" style={{ marginTop: 22 }}>
          Save to wallet <Icon name="check" size={18} />
        </button>
      </form>
    </Sheet>
  );
}

// ============================================================================
// SAVED QR CARD
// ============================================================================
function QrCodeImage({
  value,
  size = 240,
  alt = "QR code",
}: {
  value: string;
  size?: number;
  alt?: string;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    import("qrcode")
      .then((m) =>
        m.default.toDataURL(value, {
          width: size * 2,
          margin: 1,
          color: { dark: "#0a0a0a", light: "#ffffff" },
          errorCorrectionLevel: "M",
        })
      )
      .then((dataUrl) => {
        if (active) setUrl(dataUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [value, size]);

  if (failed) {
    return <p className="qr-caption">This QR code is too large to display.</p>;
  }
  if (!url) return <div className="loading-dot" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- QR is a generated data URL.
    <img src={url} alt={alt} width={size} height={size} />
  );
}

function QrCardSheet({
  card,
  onCopy,
  onDelete,
  onClose,
}: {
  card: WalletDisplayCard;
  onCopy: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const qr = card.raw as QrCodeItem;

  return (
    <Sheet title={card.name} onClose={onClose}>
      <div className="qr-modal-box">
        <div className="qr-frame qr-card-frame">
          <QrCodeImage value={qr.qrValue} size={260} alt={`${card.name} QR code`} />
        </div>
        <p className="qr-caption">This QR code is stored on this device only.</p>
        <button className="primary-button full" onClick={onCopy}>
          <Icon name="copy" size={17} /> Copy QR content
        </button>
        <button
          className="danger-button full"
          onClick={() => {
            if (confirm("Remove this QR card from your wallet?")) onDelete();
          }}
        >
          <Icon name="trash" size={16} />
          Remove card
        </button>
      </div>
    </Sheet>
  );
}

// ============================================================================
// SAFE QR SHARE MODAL
// ============================================================================
function ShareQrSheet({
  card,
  notify,
  onClose,
}: {
  card: WalletDisplayCard;
  notify: (msg: string) => void;
  onClose: () => void;
}) {
  const [qrUrl, setQrUrl] = useState("");
  const raw = card.raw;
  const isSafe = isSafeForQrSharing(raw);

  useEffect(() => {
    let active = true;
    if (!isSafe) return;
    const payload = createSafeSharePayload(raw);
    if (!payload) return;

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const encoded = stringifySharePayload(payload, origin);

    import("qrcode")
      .then((m) =>
        m.default.toDataURL(encoded, {
          width: 400,
          margin: 1,
          color: { dark: "#0a0a0a", light: "#ffffff" },
          errorCorrectionLevel: "M",
        })
      )
      .then((url) => {
        if (active) setQrUrl(url);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [raw, isSafe]);

  const bank = raw.type === "bank_account" ? (raw as BankAccountItem) : null;
  const upi = raw.type === "upi_handle" ? (raw as UpiHandleItem) : null;

  if (!isSafe) {
    return (
      <Sheet title="Shielded from QR" onClose={onClose}>
        <div className="qr-modal-box">
          <p className="notice" style={{ margin: "20px 0" }}>
            <Icon name="info" />
            Credit cards and secret credentials are never broadcast over QR. QR sharing is strictly limited to safe bank accounts and payment handles.
          </p>
          <button className="primary-button full" onClick={onClose}>
            Understood
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Share via QR" onClose={onClose}>
      <div className="qr-modal-box">
        <span className="safe-qr-tag">
          <Icon name="shield" size={12} />
          Safe Transfer Info
        </span>

        <div className="qr-frame">
          {qrUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- QR is a generated data URL.
            <img src={qrUrl} alt="Safe QR" width={190} height={190} />
          ) : (
            <div className="loading-dot" />
          )}
        </div>

        <p className="qr-caption">
          Other people with Wollet can scan this to save your details.
        </p>

        {bank && (
          <div className="detail-list" style={{ width: "100%", margin: "10px 0 16px" }}>
            <div>
              <span>Bank</span>
              <strong>{bank.bankName}</strong>
            </div>
            <div>
              <span>Account</span>
              <strong>{bank.accountNumber}</strong>
            </div>
            <div>
              <span>Holder</span>
              <strong>{bank.accountHolder}</strong>
            </div>
            {bank.branchName && (
              <div>
                <span>Branch</span>
                <strong>{bank.branchName}</strong>
              </div>
            )}
          </div>
        )}

        {upi && (
          <div className="detail-list" style={{ width: "100%", margin: "10px 0 16px" }}>
            <div>
              <span>Payment ID</span>
              <strong>{upi.handle}</strong>
            </div>
            <div>
              <span>Holder</span>
              <strong>{upi.accountHolderName}</strong>
            </div>
          </div>
        )}

        <button
          className="primary-button full"
          onClick={() => {
            void shareDetailsDirectly(raw, notify);
          }}
        >
          <Icon name="share" size={17} /> Share details
        </button>

        {qrUrl && (
          <a
            className="secondary-button full"
            href={qrUrl}
            download={`wollet-${card.bank.toLowerCase().replace(/\s+/g, "-")}-qr.png`}
          >
            <Icon name="download" size={17} /> Save QR Image
          </a>
        )}
      </div>
    </Sheet>
  );
}

// ============================================================================
// SCAN QR SHEET
// ============================================================================
function ScanQrSheet({
  onResult,
  onError,
  onClose,
}: {
  onResult: (res: string) => void;
  onError: (err: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let active = true;
    let frameId = 0;
    let last = 0;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera unavailable. You can upload a photo of the QR code instead.");
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 640 } },
          audio: false,
        });

        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const jsQR = (await import("jsqr")).default;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        const tick = (now: number) => {
          if (!active) return;
          const v = videoRef.current;
          if (v && ctx && v.readyState >= 2 && now - last > 180) {
            last = now;
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, canvas.width, canvas.height);
            if (code && code.data) {
              onResult(code.data);
              return;
            }
          }
          frameId = requestAnimationFrame(tick);
        };
        frameId = requestAnimationFrame(tick);
      } catch (e: unknown) {
        if (active) {
          onError(
            (e instanceof Error && e.message) ||
              "Camera unavailable. You can upload an image."
          );
        }
      }
    })();

    return () => {
      active = false;
      cancelAnimationFrame(frameId);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult, onError]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const jsQR = (await import("jsqr")).default;
        const code = jsQR(data.data, canvas.width, canvas.height);
        if (code && code.data) {
          onResult(code.data);
        } else {
          onError("No QR code found in photo.");
        }
      };
      img.src = URL.createObjectURL(file);
    } catch {
      onError("Failed to read image.");
    }
  };

  return (
    <Sheet title="Scan QR" onClose={onClose}>
      <div className="scanner-container">
        <video ref={videoRef} playsInline muted />
        <div className="scanner-target" />
      </div>

      <input
        type="file"
        ref={fileRef}
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFile}
      />

      <button className="primary-button full" onClick={() => fileRef.current?.click()}>
        <Icon name="upload" size={17} /> Scan from Photo Library
      </button>

      <button className="secondary-button full" onClick={onClose} style={{ marginTop: 8 }}>
        Cancel
      </button>
    </Sheet>
  );
}

// ============================================================================
// CARD SCANNER
// ============================================================================
function scanStatusLabel(status: string): string {
  if (status.includes("core")) return "Preparing scanner…";
  if (status.includes("language")) return "Loading text model…";
  if (status.includes("initializ")) return "Starting scanner…";
  if (status.includes("recognizing")) return "Reading card…";
  return "Reading card…";
}

function CardScanSheet({
  onResult,
  onClose,
}: {
  onResult: (scan: ScannedCard) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let active = true;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera unavailable. Use a photo of the card instead.");
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch (e: unknown) {
        if (active) {
          setError(
            e instanceof Error && e.message
              ? e.message
              : "Camera unavailable. Use a photo of the card instead."
          );
        }
      }
    })();

    return () => {
      active = false;
      abortRef.current?.abort();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const analyze = async (canvas: HTMLCanvasElement) => {
    setBusy(true);
    setError("");
    setStatus("Preparing scanner…");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const text = await recognizeCard(
        canvas,
        (event) => setStatus(scanStatusLabel(event.status)),
        controller.signal
      );
      const scan = parseCardText(text);
      if (!scan) {
        if (!controller.signal.aborted) {
          setError("Couldn't read that card. Try again with more light and less glare.");
        }
        return;
      }
      onResult(scan);
    } catch {
      if (!controller.signal.aborted) {
        setError("Could not read that card. Try again or use another photo.");
      }
    } finally {
      abortRef.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const canvas = renderCardCanvas(
      video,
      video.videoWidth,
      video.videoHeight,
      centerCardCrop(video.videoWidth, video.videoHeight)
    );
    void analyze(canvas);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Could not open that photo."));
        image.src = url;
      });
      const canvas = renderCardCanvas(image, image.naturalWidth, image.naturalHeight);
      await analyze(canvas);
    } catch {
      setError("Could not open that photo. Try a different image.");
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  return (
    <Sheet title="Scan a card" onClose={onClose}>
      <div className="card-scan-container">
        <video ref={videoRef} playsInline muted />
        <div className="card-scan-guide" aria-hidden="true" />
        {!cameraReady && (
          <div className="card-scan-placeholder">
            <Icon name="camera" size={25} />
            <span>{error ? "Use a photo of the card below" : "Starting camera…"}</span>
          </div>
        )}
        {busy && (
          <div className="card-scan-busy" role="status" aria-live="polite">
            <span className="loading-dot" />
            <strong>{status || "Reading card…"}</strong>
            <small>Everything stays on this device.</small>
          </div>
        )}
      </div>

      <p className="scan-privacy">
        <Icon name="shield" size={13} />
        Scans run on this device. Photos are never uploaded or saved.
      </p>

      {error && (
        <p className="scan-error" role="alert">
          {error}
        </p>
      )}

      <input
        type="file"
        ref={fileRef}
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFile}
      />

      <button
        className="primary-button full"
        onClick={capture}
        disabled={!cameraReady || busy}
      >
        <Icon name="camera" size={18} />
        {busy ? "Reading card…" : "Capture card"}
      </button>

      <button
        className="secondary-button full"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        style={{ marginTop: 8 }}
      >
        <Icon name="upload" size={17} /> Use a photo instead
      </button>
    </Sheet>
  );
}

// ============================================================================
// IMPORT SCANNED ITEM MODAL
// ============================================================================
function ImportItemSheet({
  draft,
  onSave,
  onClose,
}: {
  draft: Partial<WalletItem>;
  onSave: (item: WalletItem) => void;
  onClose: () => void;
}) {
  const [theme, setTheme] = useState("ocean");
  const bank = draft.type === "bank_account" ? (draft as Partial<BankAccountItem>) : null;
  const upi = draft.type === "upi_handle" ? (draft as Partial<UpiHandleItem>) : null;
  const qr = draft.type === "qr_code" ? (draft as Partial<QrCodeItem>) : null;
  const [title, setTitle] = useState(qr?.title || "Scanned QR");

  return (
    <Sheet title="Save to wallet" onClose={onClose}>
      {qr ? (
        <>
          <div className="qr-frame qr-card-frame">
            <QrCodeImage value={qr.qrValue || ""} size={230} alt="Scanned QR" />
          </div>
          <label>
            Name
            <input
              required
              maxLength={32}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <p className="scan-privacy">
            <Icon name="shield" size={13} />
            Saved encrypted on this device.
          </p>
        </>
      ) : (
        <div className="detail-list">
          <div>
            <span>Type</span>
            <strong>{draft.type === "bank_account" ? "Bank account" : "Payment handle"}</strong>
          </div>
          {bank && (
            <>
              <div>
                <span>Bank</span>
                <strong>{bank.bankName}</strong>
              </div>
              <div>
                <span>Account</span>
                <strong>{bank.accountNumber}</strong>
              </div>
              <div>
                <span>Holder</span>
                <strong>{bank.accountHolder}</strong>
              </div>
              {bank.branchName && (
                <div>
                  <span>Branch</span>
                  <strong>{bank.branchName}</strong>
                </div>
              )}
            </>
          )}
          {upi && (
            <>
              <div>
                <span>Payment ID</span>
                <strong>{upi.handle}</strong>
              </div>
              <div>
                <span>Holder</span>
                <strong>{upi.accountHolderName}</strong>
              </div>
            </>
          )}
        </div>
      )}

      <div className="editor-section" style={{ margin: "16px 0" }}>
        <span className="field-label">Card Theme</span>
        <div className="swatches">
          {THEMES.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`swatch theme-${t.id} ${theme === t.id ? "chosen" : ""}`}
              onClick={() => setTheme(t.id)}
            >
              {theme === t.id && <Icon name="check" size={18} />}
            </button>
          ))}
        </div>
      </div>

      <button
        className="primary-button full"
        onClick={() => {
          onSave({
            ...draft,
            ...(qr ? { title: title.trim() || "Scanned QR" } : {}),
            id: `item-${Date.now()}`,
            colorTheme: theme,
            isFavorite: false,
            tags: ["Scanned"],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          } as WalletItem);
        }}
      >
        Save to wallet <Icon name="check" size={18} />
      </button>
    </Sheet>
  );
}
