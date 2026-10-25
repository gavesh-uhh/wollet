/**
 * Safe QR Code Generator & Parser for PWA Wallet Sharing
 * Enforces strict safety rules: only Bank Accounts, payment handles,
 * and safe public credentials may be shared or scanned.
 *
 * Credit cards, CVVs, and private security notes are strictly protected
 * and blocked from QR broadcasting.
 */

import type { BankAccountItem, SafeSharePayload, UpiHandleItem, WalletItem } from "./vault-types.ts";

/**
 * Returns true if an item type is designated safe for QR code sharing.
 */
export function isSafeForQrSharing(item: WalletItem): boolean {
  if (item.type === "bank_account" || item.type === "upi_handle") {
    return true;
  }
  if (item.type === "id_document") {
    return true;
  }
  if (item.type === "custom") {
    // Only safe if none of the custom fields are marked isSecret
    return !(item.customFields || []).some(f => f.isSecret);
  }
  // Credit cards and secure notes are NEVER safe for QR sharing
  return false;
}

/**
 * Constructs a safe, sanitized payload to encode in the QR code.
 * Returns null if the item is sensitive (e.g. Credit Card).
 */
export function createSafeSharePayload(item: WalletItem): SafeSharePayload | null {
  if (!isSafeForQrSharing(item)) {
    return null;
  }

  if (item.type === "bank_account") {
    const bank = item as BankAccountItem;
    return {
      _payit: 1,
      kind: "bank_account",
      title: bank.title || bank.bankName,
      data: {
        bankName: bank.bankName,
        accountHolder: bank.accountHolder,
        accountNumber: bank.accountNumber,
        routingOrIfsc: bank.routingOrIfsc || "",
        swiftBic: bank.swiftBic || "",
        branchName: bank.branchName || "",
        accountType: bank.accountType || "Savings",
        currency: bank.currency || "USD",
        notes: bank.notes || "",
      },
      sharedAt: Date.now(),
    };
  }

  if (item.type === "upi_handle") {
    const upi = item as UpiHandleItem;
    return {
      _payit: 1,
      kind: "upi_handle",
      title: upi.title || upi.handle,
      data: {
        handle: upi.handle,
        accountHolderName: upi.accountHolderName,
        provider: upi.provider,
        notes: upi.notes || "",
      },
      sharedAt: Date.now(),
    };
  }

  if (item.type === "id_document") {
    return {
      _payit: 1,
      kind: "id_document",
      title: item.title,
      data: {
        documentType: item.documentType,
        documentNumber: item.documentNumber,
        fullName: item.fullName,
        issuingCountry: item.issuingCountry || "",
        expiryDate: item.expiryDate || "",
      },
      sharedAt: Date.now(),
    };
  }

  if (item.type === "custom") {
    const safeData: Record<string, string> = { subtitle: item.subtitle || "" };
    (item.customFields || []).forEach(f => {
      if (!f.isSecret) safeData[f.label] = f.value;
    });
    return {
      _payit: 1,
      kind: "custom_safe",
      title: item.title,
      data: safeData,
      sharedAt: Date.now(),
    };
  }

  return null;
}

/**
 * Encodes safe payload into a string for QR code generation.
 * Generates both direct JSON and URL-safe formats.
 */
export function stringifySharePayload(payload: SafeSharePayload, origin?: string): string {
  const json = JSON.stringify(payload);
  if (origin && typeof origin === "string" && origin.startsWith("http")) {
    return `${origin}/?import=${encodeURIComponent(json)}`;
  }
  return json;
}

/**
 * Result of parsing a scanned QR code
 */
export interface ScannedImportResult {
  valid: boolean;
  kind?: string;
  itemDraft?: Partial<WalletItem>;
  rawMessage?: string;
  error?: string;
}

/**
 * Parses scanned text from the QR scanner.
 * Supports:
 * 1. Native Wollet share JSON: {"_payit": 1, ...}
 * 2. Wollet share URLs: https://.../?import={...}
 * 3. Standard payment QR codes: upi://pay?pa=...&pn=...
 * 4. Generic text fallback
 */
export function parseScannedQr(scannedText: string): ScannedImportResult {
  if (!scannedText || typeof scannedText !== "string") {
    return { valid: false, error: "Empty QR code." };
  }

  const trimmed = scannedText.trim();

  // 1. Try URL parsing
  let jsonString = trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const url = new URL(trimmed);
      const importParam = url.searchParams.get("import");
      if (importParam) {
        jsonString = decodeURIComponent(importParam);
      }
    } catch {
      // Continue with raw string
    }
  }

  // 2. Try JSON parsing
  try {
    const parsed = JSON.parse(jsonString);
    if (parsed && parsed._payit === 1) {
      if (parsed.kind === "bank_account" && parsed.data) {
        const itemDraft: BankAccountItem = {
          id: `scanned-bank-${Date.now()}`,
          type: "bank_account",
          title: parsed.title || parsed.data.bankName || "Shared Bank Account",
          bankName: parsed.data.bankName || "Unknown Bank",
          accountHolder: parsed.data.accountHolder || "Account Holder",
          accountNumber: parsed.data.accountNumber || "",
          routingOrIfsc: parsed.data.routingOrIfsc || "",
          swiftBic: parsed.data.swiftBic || "",
          branchName: parsed.data.branchName || "",
          accountType: parsed.data.accountType || "Savings",
          currency: parsed.data.currency || "USD",
          colorTheme: "ocean",
          isFavorite: false,
          tags: ["Scanned", "Received"],
          notes: parsed.data.notes || "Imported via Wollet QR scanner.",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        return { valid: true, kind: "Bank Account", itemDraft };
      }

      if (parsed.kind === "upi_handle" && parsed.data) {
        const itemDraft: UpiHandleItem = {
          id: `scanned-upi-${Date.now()}`,
          type: "upi_handle",
          title: parsed.title || parsed.data.handle || "Shared Payment Handle",
          handle: parsed.data.handle || "",
          accountHolderName: parsed.data.accountHolderName || "",
          provider: parsed.data.provider || "Payment",
          colorTheme: "emerald",
          isFavorite: false,
          tags: ["Scanned", "Received"],
          notes: parsed.data.notes || "Imported via Wollet QR scanner.",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        return { valid: true, kind: "Payment Handle", itemDraft };
      }

      if (parsed.kind === "id_document" && parsed.data) {
        const itemDraft = {
          id: `scanned-id-${Date.now()}`,
          type: "id_document" as const,
          title: parsed.title || "Scanned ID",
          documentType: parsed.data.documentType || "Other",
          documentNumber: parsed.data.documentNumber || "",
          fullName: parsed.data.fullName || "",
          issuingCountry: parsed.data.issuingCountry || "",
          expiryDate: parsed.data.expiryDate || "",
          colorTheme: "ruby",
          isFavorite: false,
          tags: ["Scanned"],
          notes: "Imported via Wollet QR scanner.",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        return { valid: true, kind: "ID Document", itemDraft };
      }
    }
  } catch {
    // Not JSON, continue to other formats
  }

  // 3. Try standard payment URI: upi://pay?pa=address@bank&pn=Name
  if (trimmed.startsWith("upi://pay")) {
    try {
      const url = new URL(trimmed);
      const pa = url.searchParams.get("pa");
      const pn = url.searchParams.get("pn") || "Payment Receiver";
      if (pa) {
        const itemDraft: UpiHandleItem = {
          id: `scanned-upi-${Date.now()}`,
          type: "upi_handle",
          title: `${pn} (${pa})`,
          handle: pa,
          accountHolderName: pn,
          provider: "Payment",
          colorTheme: "emerald",
          isFavorite: false,
          tags: ["Scanned", "Payment"],
          notes: "Imported from standard payment QR code.",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        return { valid: true, kind: "Payment Handle", itemDraft };
      }
    } catch {
      // Ignore
    }
  }

  // 4. Fallback for unrecognized QR codes
  return {
    valid: false,
    rawMessage: trimmed,
    error: "This QR code doesn’t contain a Wollet shareable account or payment handle.",
  };
}
