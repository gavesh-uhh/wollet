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
      `Name: ${b.accountHolder || b.title}`,
      `Bank: ${b.bankName}`,
      `A/C: ${b.accountNumber}`,
    ];
    if (b.branchName) lines.push(`Branch: ${b.branchName}`);
    if (b.routingOrIfsc) lines.push(`Routing/IFSC: ${b.routingOrIfsc}`);
    if (b.swiftBic) lines.push(`SWIFT: ${b.swiftBic}`);
    return lines.join("\n");
  }

  if (item.type === "upi_handle") {
    const u = item as UpiHandleItem;
    return [
      `Name: ${u.accountHolderName || u.title}`,
      `Payment ID: ${u.handle}`,
    ].join("\n");
  }

  if (item.type === "credit_card") {
    const c = item as CreditCardItem;
    const lines = [
      `Name: ${c.cardholderName || c.title}`,
      `Bank: ${c.bankOrIssuer}`,
      `Card: •••• ${c.cardNumber?.slice(-4) || "••••"}`,
    ];
    return lines.join("\n");
  }

  if (item.type === "id_document") {
    const d = item as IdDocumentItem;
    return [
      `Name: ${d.fullName}`,
      `Type: ${d.documentType}`,
      `Number: ${d.documentNumber}`,
    ].join("\n");
  }

  return [
    `Title: ${item.title}`,
    item.notes ? `Notes: ${item.notes}` : "",
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

  // Native share sheet is the only reliable share path inside an installed PWA.
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ text });
      notify("Shared successfully.");
      return;
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return; // User closed sheet
    }
  }

  if (await copyText(text)) {
    notify("Details copied. Paste them into any app.");
    return;
  }

  notify("Sharing isn't available in this browser.");
}

async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }

  // Fallback for PWAs without clipboard permission.
  if (typeof document === "undefined" || !document.body) return false;
  const active = document.activeElement;
  const area = document.createElement("textarea");
  area.value = text;
  area.readOnly = true;
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.width = "1px";
  area.style.height = "1px";
  area.style.opacity = "0";
  area.style.pointerEvents = "none";
  document.body.appendChild(area);
  area.focus({ preventScroll: true });
  area.select();
  area.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {}
  area.remove();
  const focusable = active as HTMLElement | null;
  focusable?.focus?.();
  return copied;
}
