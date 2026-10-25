/**
 * Formats wallet item details for direct sharing (WhatsApp, Messages, Telegram, etc.)
 */

import type {
  BankAccountItem,
  CreditCardItem,
  IdDocumentItem,
  UpiHandleItem,
  WalletItem,
} from "./vault-types.ts";

export function formatShareText(item: WalletItem): string {
  if (item.type === "bank_account") {
    const b = item as BankAccountItem;
    const lines = [
      "Bank Details",
      `Name - ${b.accountHolder || b.title}`,
      `Bank - ${b.bankName}`,
      `Account Number - ${b.accountNumber}`,
    ];
    if (b.branchName) lines.push(`Branch - ${b.branchName}`);
    if (b.routingOrIfsc) lines.push(`Routing/IFSC - ${b.routingOrIfsc}`);
    if (b.swiftBic) lines.push(`SWIFT - ${b.swiftBic}`);
    if (b.accountType && b.accountType !== "Other") lines.push(`Account Type - ${b.accountType}`);
    if (b.currency) lines.push(`Currency - ${b.currency}`);
    if (b.notes) lines.push(`Notes - ${b.notes}`);
    return lines.join("\n");
  }

  if (item.type === "upi_handle") {
    const u = item as UpiHandleItem;
    const lines = [
      "Payment Details",
      `Name - ${u.accountHolderName || u.title}`,
      `Payment ID - ${u.handle}`,
      `Payment App - ${u.provider || "Payment"}`,
    ];
    if (u.notes) lines.push(`Notes - ${u.notes}`);
    return lines.join("\n");
  }

  if (item.type === "credit_card") {
    const c = item as CreditCardItem;
    const lines = [
      "Card Details",
      `Name - ${c.cardholderName || c.title}`,
      `Bank - ${c.bankOrIssuer}`,
      `Card - ${c.cardType} (${c.network})`,
      `Number - ${c.cardNumber ? `•••• •••• •••• ${c.cardNumber.slice(-4)}` : "••••"}`,
    ];
    return lines.join("\n");
  }

  if (item.type === "id_document") {
    const d = item as IdDocumentItem;
    const lines = [
      "ID Details",
      `Name - ${d.fullName}`,
      `Type - ${d.documentType}`,
      `Number - ${d.documentNumber}`,
    ];
    if (d.issuingCountry) lines.push(`Country - ${d.issuingCountry}`);
    return lines.join("\n");
  }

  return [
    "Details",
    `Title - ${item.title}`,
    item.notes ? `Notes - ${item.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Triggers direct sharing to WhatsApp or Web Share API
 */
export async function shareDetailsDirectly(
  item: WalletItem,
  notify: (msg: string) => void
): Promise<void> {
  const text = formatShareText(item);

  // 1. Try native Web Share API on mobile (supports direct WhatsApp, Messages, etc.)
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({
        title: item.title,
        text,
      });
      notify("Shared successfully.");
      return;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return; // User closed sheet
    }
  }

  // 2. Direct WhatsApp URL fallback
  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  const opened = window.open(waUrl, "_blank");
  if (opened) {
    opened.opener = null;
    notify("Opening WhatsApp...");
    return;
  }

  // 3. Fallback: Copy to clipboard
  try {
    await navigator.clipboard.writeText(text);
    notify("Copied to clipboard! Ready to paste in WhatsApp.");
  } catch {
    notify("Sharing isn't available in this browser.");
  }
}
