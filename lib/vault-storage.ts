/**
 * Detailed & Flexible LocalStorage Vault Storage Manager
 * Uses AES-GCM 256-bit encryption with PBKDF2 key derivation.
 */

import {
  base64ToBytes,
  bytesToBase64,
  createAuthVerification,
  decryptText,
  deriveKeyFromPasscode,
  encryptText,
  getRandomBytes,
  verifyPasscodeWithAuth,
} from "./crypto.ts";
import type {
  CardPattern,
  EncryptedVaultStorageSchema,
  VaultData,
  WalletItem,
} from "./vault-types.ts";

export const VAULT_STORAGE_KEY = "payit_vault_v2";
export const LEGACY_STORAGE_KEY = "payit.cards.v1";
export const DEFAULT_DEVICE_PIN = "0000"; // Fallback passcode for seamless device-only mode

// Demo items seeded by an earlier build. Removed on unlock so existing vaults
// become clean without touching cards the user added themselves.
const LEGACY_SAMPLE_ITEM_IDS = new Set([
  "bank-primary-01",
  "card-everyday-02",
  "upi-personal-03",
  "id-passport-04",
]);

/**
 * Checks legacy cards and migrates them if available
 */
function getLegacyMigratedCards(): WalletItem[] | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const cards = JSON.parse(raw);
    if (!Array.isArray(cards) || cards.length === 0) return null;

    return cards.map((c: Record<string, string>, index: number): WalletItem => ({
      id: c.id || `migrated-card-${index}`,
      type: "credit_card",
      title: c.name || "Payment Card",
      bankOrIssuer: c.bank || "Personal Bank",
      cardholderName: (c.name || "Cardholder").toUpperCase(),
      cardNumber: c.last4 ? `••••••••••••${c.last4}` : "••••••••••••8888",
      expiryMonth: "12",
      expiryYear: "28",
      cvv: "•••",
      network: c.network === "Debit" ? "Visa" : "Mastercard",
      cardType: c.network === "Debit" ? "Debit" : "Credit",
      pattern: (c.pattern as CardPattern) || "orbit",
      colorTheme: c.theme || "graphite",
      isFavorite: index === 0,
      tags: ["Migrated"],
      notes: "Imported from your previous Wollet card list.",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
  } catch {
    return null;
  }
}

/**
 * Counts categories in item list
 */
export function calculateCategoryCounts(items: WalletItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.type] = (counts[item.type] || 0) + 1;
  }
  return counts;
}

/**
 * Initializes a new, empty encrypted vault with a passcode
 */
export async function createNewVault(
  passcode: string = DEFAULT_DEVICE_PIN,
  hasPasscode: boolean = false,
  customInitialItems?: WalletItem[]
): Promise<{ schema: EncryptedVaultStorageSchema; key: CryptoKey; data: VaultData }> {
  // An unreadable vault is not an empty wallet. Never overwrite it on startup.
  if (typeof localStorage !== "undefined" && localStorage.getItem(VAULT_STORAGE_KEY)) {
    throw new Error("A wallet already exists on this device. Unlock or reset it first.");
  }
  const saltBytes = getRandomBytes(16);
  const saltBase64 = bytesToBase64(saltBytes);

  const key = await deriveKeyFromPasscode(passcode, saltBytes);
  const auth = await createAuthVerification(key);

  const initialItems = customInitialItems || getLegacyMigratedCards() || [];

  const data: VaultData = {
    items: initialItems,
    customTags: ["Personal", "Work", "Salary", "Travel", "Online Shopping"],
    preferences: {
      displayMode: "cards",
      hideSensitiveByDefault: true,
      autoLockMinutes: hasPasscode ? 15 : 0,
      defaultCurrency: "USD",
    },
  };

  const jsonPayload = JSON.stringify(data);
  const { ciphertext, iv } = await encryptText(jsonPayload, key);

  const schema: EncryptedVaultStorageSchema = {
    version: 2,
    vaultId: crypto.randomUUID ? crypto.randomUUID() : `vault-${Date.now()}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    salt: saltBase64,
    authCipher: auth.authCipher,
    authIv: auth.authIv,
    payloadCipher: ciphertext,
    payloadIv: iv,
    hasPasscode,
    metadata: {
      itemCount: initialItems.length,
      categoryCounts: calculateCategoryCounts(initialItems),
      autoLockMinutes: data.preferences.autoLockMinutes,
      vaultName: "My Safe Wallet",
    },
  };

  if (typeof localStorage !== "undefined") {
    if (localStorage.getItem(VAULT_STORAGE_KEY)) {
      throw new Error("A wallet was created in another window. Reload to open it.");
    }
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(schema));
  }

  return { schema, key, data };
}

/**
 * Reads the raw encrypted schema from localStorage without decrypting
 */
export function getRawVaultSchema(): EncryptedVaultStorageSchema | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 2 && parsed.payloadCipher) {
      return parsed as EncryptedVaultStorageSchema;
    }
  } catch {
    // Corrupt or invalid JSON
  }
  return null;
}

/**
 * Attempts to unlock an existing vault with the given passcode
 */
export async function unlockVault(
  passcode: string
): Promise<{ key: CryptoKey; data: VaultData; schema: EncryptedVaultStorageSchema } | { error: string }> {
  const schema = getRawVaultSchema();
  if (!schema) {
    return { error: "No vault found on this device." };
  }

  try {
    const saltBytes = base64ToBytes(schema.salt);
    const key = await deriveKeyFromPasscode(passcode, saltBytes);

    const isVerified = await verifyPasscodeWithAuth(schema.authCipher, schema.authIv, key);
    if (!isVerified) {
      return { error: "Incorrect passcode or PIN. Please try again." };
    }

    const decryptedJson = await decryptText(schema.payloadCipher, schema.payloadIv, key);
    const data: VaultData = JSON.parse(decryptedJson);

    const items = data.items.filter((item) => !LEGACY_SAMPLE_ITEM_IDS.has(item.id));
    if (items.length !== data.items.length) {
      data.items = items;
      const updatedSchema = await saveVaultData(data, key).catch(() => schema);
      return { key, data, schema: updatedSchema };
    }

    return { key, data, schema };
  } catch (err: unknown) {
    return {
      error:
        (err instanceof Error && err.message) ||
        "Failed to decrypt vault. Passcode may be incorrect.",
    };
  }
}

/**
 * Saves updated vault data using the active encryption key
 */
export async function saveVaultData(
  data: VaultData,
  key: CryptoKey,
  updates?: { hasPasscode?: boolean; autoLockMinutes?: number; vaultName?: string }
): Promise<EncryptedVaultStorageSchema> {
  const schema = getRawVaultSchema();
  if (!schema) {
    throw new Error("No existing vault schema found to update.");
  }

  if (!(await verifyPasscodeWithAuth(schema.authCipher, schema.authIv, key))) {
    throw new Error("Your wallet key has changed. Reload and unlock before saving.");
  }

  const jsonPayload = JSON.stringify(data);
  const { ciphertext, iv } = await encryptText(jsonPayload, key);

  const updatedSchema: EncryptedVaultStorageSchema = {
    ...schema,
    updatedAt: Date.now(),
    payloadCipher: ciphertext,
    payloadIv: iv,
    hasPasscode: updates?.hasPasscode !== undefined ? updates.hasPasscode : schema.hasPasscode,
    metadata: {
      ...schema.metadata,
      itemCount: data.items.length,
      categoryCounts: calculateCategoryCounts(data.items),
      autoLockMinutes: updates?.autoLockMinutes !== undefined ? updates.autoLockMinutes : data.preferences.autoLockMinutes,
      vaultName: updates?.vaultName || schema.metadata.vaultName,
    },
  };

  if (typeof localStorage !== "undefined") {
    if (localStorage.getItem(VAULT_STORAGE_KEY) !== JSON.stringify(schema)) {
      throw new Error("Your wallet changed in another window. Reload before saving.");
    }
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(updatedSchema));
  }

  return updatedSchema;
}

/**
 * Changes the vault passcode, generating a fresh salt and re-encrypting the payload
 */
export async function changeVaultPasscode(
  currentKey: CryptoKey,
  newPasscode: string,
  vaultData: VaultData,
  hasPasscode: boolean = true
): Promise<{ newKey: CryptoKey; schema: EncryptedVaultStorageSchema }> {
  const schema = getRawVaultSchema();
  if (!schema) {
    throw new Error("Cannot change passcode: vault does not exist.");
  }
  if (hasPasscode && !/^\d{4,8}$/.test(newPasscode)) {
    throw new Error("Use a PIN with 4 to 8 digits.");
  }
  if (!hasPasscode && newPasscode !== DEFAULT_DEVICE_PIN) {
    throw new Error("Device mode requires the device key.");
  }
  if (!(await verifyPasscodeWithAuth(schema.authCipher, schema.authIv, currentKey))) {
    throw new Error("Your wallet key has changed. Reload and unlock before changing the PIN.");
  }

  const newSaltBytes = getRandomBytes(16);
  const newSaltBase64 = bytesToBase64(newSaltBytes);
  const newKey = await deriveKeyFromPasscode(newPasscode, newSaltBytes);
  const newAuth = await createAuthVerification(newKey);

  const jsonPayload = JSON.stringify(vaultData);
  const { ciphertext, iv } = await encryptText(jsonPayload, newKey);

  const updatedSchema: EncryptedVaultStorageSchema = {
    ...schema,
    salt: newSaltBase64,
    authCipher: newAuth.authCipher,
    authIv: newAuth.authIv,
    payloadCipher: ciphertext,
    payloadIv: iv,
    hasPasscode,
    updatedAt: Date.now(),
    metadata: {
      ...schema.metadata,
      itemCount: vaultData.items.length,
      categoryCounts: calculateCategoryCounts(vaultData.items),
      autoLockMinutes: vaultData.preferences.autoLockMinutes,
    },
  };

  if (typeof localStorage !== "undefined") {
    if (localStorage.getItem(VAULT_STORAGE_KEY) !== JSON.stringify(schema)) {
      throw new Error("Your wallet changed in another window. Reload before changing the PIN.");
    }
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(updatedSchema));
  }

  return { newKey, schema: updatedSchema };
}

/**
 * Exports vault as an encrypted backup JSON file string
 */
export function exportEncryptedVaultFile(): string {
  const schema = getRawVaultSchema();
  if (!schema) throw new Error("No vault to export.");
  return JSON.stringify(
    {
      app: "payit-wallet",
      format: "payit-encrypted-vault-backup",
      exportedAt: Date.now(),
      vault: schema,
    },
    null,
    2
  );
}

/**
 * Completely resets and clears the wallet
 */
export function resetLocalVault(): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(VAULT_STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
}
