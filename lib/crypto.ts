/**
 * Web Crypto API utilities for client-side AES-GCM (256-bit) encryption
 * and PBKDF2 key derivation. Works in both browser and modern Node environments.
 */

// Sentinel string encrypted to verify PIN/Passcode correctness quickly without storing it in plaintext
export const AUTH_VERIFICATION_SENTINEL = "payit-vault-v2-verified-integrity";

/**
 * Converts Uint8Array to Base64 string
 */
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts Base64 string to Uint8Array
 */
export function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Gets the subtle crypto object across browser and Node.js
 */
function getSubtleCrypto(): SubtleCrypto {
  if (typeof window !== "undefined" && window.crypto?.subtle) {
    return window.crypto.subtle;
  }
  if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  throw new Error("Web Crypto API (subtle) is not available in this environment.");
}

/**
 * Generates cryptographically secure random bytes
 */
export function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
    return bytes;
  }
  if (typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  throw new Error("getRandomValues is not available.");
}

/**
 * Derives an AES-GCM (256-bit) key from a passphrase/PIN using PBKDF2 with SHA-256 and 100,000 iterations.
 */
export async function deriveKeyFromPasscode(passcode: string, saltBytes: Uint8Array): Promise<CryptoKey> {
  const subtle = getSubtleCrypto();
  const encoder = new TextEncoder();
  const passcodeBuffer = encoder.encode(passcode);

  const baseKey = await subtle.importKey(
    "raw",
    passcodeBuffer,
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes as unknown as BufferSource,
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts arbitrary plaintext string using AES-GCM (256-bit) with a random 12-byte IV.
 * Returns Base64 ciphertext and Base64 IV.
 */
export async function encryptText(plaintext: string, key: CryptoKey): Promise<{ ciphertext: string; iv: string }> {
  const subtle = getSubtleCrypto();
  const ivBytes = getRandomBytes(12); // Standard recommended 96-bit IV for AES-GCM
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  const encryptedBuffer = await subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ivBytes as unknown as BufferSource,
    },
    key,
    data
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer)),
    iv: bytesToBase64(ivBytes),
  };
}

/**
 * Decrypts AES-GCM (256-bit) Base64 ciphertext using the given Base64 IV and CryptoKey.
 */
export async function decryptText(ciphertextBase64: string, ivBase64: string, key: CryptoKey): Promise<string> {
  const subtle = getSubtleCrypto();
  const ciphertextBytes = base64ToBytes(ciphertextBase64);
  const ivBytes = base64ToBytes(ivBase64);

  const decryptedBuffer = await subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ivBytes as unknown as BufferSource,
    },
    key,
    ciphertextBytes as unknown as BufferSource
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}

/**
 * Generates an encrypted auth verification token for checking if a PIN is correct.
 */
export async function createAuthVerification(key: CryptoKey): Promise<{ authCipher: string; authIv: string }> {
  const result = await encryptText(AUTH_VERIFICATION_SENTINEL, key);
  return {
    authCipher: result.ciphertext,
    authIv: result.iv,
  };
}

/**
 * Verifies whether the provided key successfully decrypts the auth verification token.
 */
export async function verifyPasscodeWithAuth(authCipher: string, authIv: string, key: CryptoKey): Promise<boolean> {
  try {
    const decrypted = await decryptText(authCipher, authIv, key);
    return decrypted === AUTH_VERIFICATION_SENTINEL;
  } catch {
    return false;
  }
}
