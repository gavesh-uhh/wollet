/**
 * Flexible types and schemas for Wollet Digital Wallet & Vault
 */

export type WalletItemType =
  | "credit_card"
  | "bank_account"
  | "upi_handle"
  | "id_document"
  | "qr_code"
  | "secure_note"
  | "custom";

export interface CustomField {
  id: string;
  label: string;
  value: string;
  isSecret: boolean;
}

export type CardPattern = "orbit" | "wave" | "plain" | "grid" | "stripes" | "dots";

export interface BaseWalletItem {
  id: string;
  type: WalletItemType;
  title: string;
  isFavorite: boolean;
  tags: string[];
  notes?: string;
  colorTheme: string; // e.g. "graphite", "ocean", "emerald", "rose", "sand", "steel", "peach", "lilac"
  pattern?: CardPattern;
  logo?: string; // Bundled bank logo ID or a local PNG, encrypted with the item
  createdAt: number;
  updatedAt: number;
  customFields?: CustomField[];
}

export interface CreditCardItem extends BaseWalletItem {
  type: "credit_card";
  cardholderName: string;
  cardNumber: string; // Full 16-19 digit card number, encrypted in localStorage
  expiryMonth: string; // MM e.g. "08"
  expiryYear: string; // YY or YYYY e.g. "28"
  cvv: string; // 3-4 digit CVV/CVC, encrypted in localStorage
  bankOrIssuer: string; // Issuer or label printed on the card
  network: "Visa" | "Mastercard" | "Amex" | "Discover" | "RuPay" | "Other";
  cardType: "Credit" | "Debit" | "Prepaid";
  pattern: CardPattern;
}

export interface BankAccountItem extends BaseWalletItem {
  type: "bank_account";
  accountHolder: string;
  bankName: string;
  accountNumber: string; // Full account number, encrypted in localStorage
  routingOrIfsc?: string; // Routing number, IFSC, Sort Code, or BSB
  swiftBic?: string; // International SWIFT / BIC code
  branchName?: string;
  accountType: "Savings" | "Checking" | "Current" | "Business" | "Deposit" | "Other";
  currency: string; // e.g. "USD", "LKR", "EUR", "GBP", "INR"
}

export interface UpiHandleItem extends BaseWalletItem {
  type: "upi_handle";
  handle: string; // e.g. "username@okaxis", "user@paypal", "$cashtag", "user@revolut"
  accountHolderName: string;
  provider: string; // Issuer, app, or label shown for this payment handle
}

export interface IdDocumentItem extends BaseWalletItem {
  type: "id_document";
  documentType:
    | "National ID"
    | "Passport"
    | "Driver's License"
    | "Tax ID / SSN"
    | "Campus card"
    | "Membership"
    | "Other";
  documentNumber: string;
  fullName: string;
  issuer?: string; // Organization printed on a non-bank card
  issuingCountry?: string;
  expiryDate?: string;
}

export interface QrCodeItem extends BaseWalletItem {
  type: "qr_code";
  qrValue: string; // Raw text encoded in the saved QR code
  imageDataUrl?: string; // Original code pixels, encrypted with the item
}

export interface SecureNoteItem extends BaseWalletItem {
  type: "secure_note";
  category: "General" | "WiFi" | "Credentials" | "Recovery Phrase" | "Code";
  secretContent: string;
}

export interface CustomWalletItem extends BaseWalletItem {
  type: "custom";
  subtitle?: string;
}

export type WalletItem =
  | CreditCardItem
  | BankAccountItem
  | UpiHandleItem
  | IdDocumentItem
  | QrCodeItem
  | SecureNoteItem
  | CustomWalletItem;

/**
 * Decrypted payload held in memory while the vault is unlocked
 */
export interface VaultData {
  items: WalletItem[];
  customTags: string[];
  preferences: {
    displayMode: "cards" | "list";
    hideSensitiveByDefault: boolean;
    autoLockMinutes: number; // 0 = never, 5, 15, 30, 60
    defaultCurrency: string;
  };
}

/**
 * On-disk encrypted schema saved in localStorage under 'payit_vault_v2'
 */
export interface EncryptedVaultStorageSchema {
  version: 2;
  vaultId: string;
  createdAt: number;
  updatedAt: number;
  salt: string; // Base64 PBKDF2 salt
  authCipher: string; // Base64 encrypted verification sentinel
  authIv: string; // Base64 IV for verification sentinel
  payloadCipher: string; // Base64 encrypted VaultData JSON
  payloadIv: string; // Base64 IV for payload
  hasPasscode: boolean; // Whether the user locked with a personal PIN/passphrase
  deviceKeyCipher?: string; // Optional device key wrapper if quick unlock is chosen
  metadata: {
    itemCount: number;
    categoryCounts: Record<string, number>;
    autoLockMinutes: number;
    lastBackupAt?: number;
    vaultName?: string;
  };
}

/**
 * Safe Share QR payload format
 * Strictly limited to SAFE shareable types (Bank Accounts, payment handles, etc.)
 * SENSITIVE CREDIT CARDS AND CVVs ARE STRICTLY EXCLUDED!
 */
export interface SafeSharePayload {
  _payit: 1; // Signature marker
  kind: "bank_account" | "upi_handle" | "id_document" | "custom_safe";
  title: string;
  data: Record<string, string | undefined>;
  sharedAt: number;
}
