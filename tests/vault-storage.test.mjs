import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveKeyFromPasscode,
  encryptText,
  decryptText,
  createAuthVerification,
  verifyPasscodeWithAuth,
} from "../lib/crypto.ts";
import {
  createQrCardDraft,
  isSafeForQrSharing,
  createSafeSharePayload,
  parseScannedQr,
} from "../lib/qr-share.ts";

test("Web Crypto: encryption and decryption roundtrip", async () => {
  const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const key = await deriveKeyFromPasscode("1234", salt);

  const secretMessage = JSON.stringify({
    cardNumber: "4532123456789012",
    cvv: "987",
    accountHolder: "John Doe",
  });

  const { ciphertext, iv } = await encryptText(secretMessage, key);
  assert.notEqual(ciphertext, secretMessage);
  assert.ok(ciphertext.length > 20);

  const decrypted = await decryptText(ciphertext, iv, key);
  assert.equal(decrypted, secretMessage);
});

test("Web Crypto: wrong passcode fails verification", async () => {
  const salt = new Uint8Array([5, 6, 7, 8, 1, 2, 3, 4, 9, 10, 11, 12, 13, 14, 15, 16]);
  const correctKey = await deriveKeyFromPasscode("correct-pin-9999", salt);
  const wrongKey = await deriveKeyFromPasscode("wrong-pin-0000", salt);

  const auth = await createAuthVerification(correctKey);

  const isCorrect = await verifyPasscodeWithAuth(auth.authCipher, auth.authIv, correctKey);
  assert.equal(isCorrect, true);

  const isWrong = await verifyPasscodeWithAuth(auth.authCipher, auth.authIv, wrongKey);
  assert.equal(isWrong, false);
});

test("QR Safety: Credit Cards are strictly blocked from QR sharing", () => {
  const creditCard = {
    id: "cc-1",
    type: "credit_card",
    title: "Visa Gold",
    bankOrIssuer: "Chase",
    cardholderName: "Jane Doe",
    cardNumber: "4111222233334444",
    expiryMonth: "10",
    expiryYear: "28",
    cvv: "123",
    network: "Visa",
    cardType: "Credit",
    pattern: "orbit",
    colorTheme: "graphite",
    isFavorite: false,
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  assert.equal(isSafeForQrSharing(creditCard), false);
  assert.equal(createSafeSharePayload(creditCard), null);
});

test("QR Safety: Bank Accounts are permitted and accurately formatted", () => {
  const bankAccount = {
    id: "ba-1",
    type: "bank_account",
    title: "Seylan Bank Savings",
    bankName: "Seylan Bank",
    accountHolder: "Kasun Perera",
    accountNumber: "0123456789",
    routingOrIfsc: "SEYLLKLX",
    swiftBic: "SEYLLKLX",
    accountType: "Savings",
    currency: "LKR",
    colorTheme: "ocean",
    isFavorite: true,
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  assert.equal(isSafeForQrSharing(bankAccount), true);
  const payload = createSafeSharePayload(bankAccount);
  assert.ok(payload);
  assert.equal(payload._payit, 1);
  assert.equal(payload.kind, "bank_account");
  assert.equal(payload.data.accountNumber, "0123456789");
  assert.equal(payload.data.bankName, "Seylan Bank");

  // Verify parser reconstructs the item
  const parsed = parseScannedQr(JSON.stringify(payload));
  assert.equal(parsed.valid, true);
  assert.equal(parsed.kind, "Bank Account");
  assert.equal(parsed.itemDraft?.accountNumber, "0123456789");
  assert.equal(parsed.itemDraft?.bankName, "Seylan Bank");
});

test("QR Parser: parses Wollet URL with ?import query param", () => {
  const upiItem = {
    id: "upi-1",
    type: "upi_handle",
    title: "Kasun UPI",
    handle: "kasun@okaxis",
    accountHolderName: "Kasun Perera",
    provider: "UPI / GPay",
    colorTheme: "emerald",
    isFavorite: false,
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const payload = createSafeSharePayload(upiItem);
  assert.ok(payload);
  const url = `https://payit.app/?import=${encodeURIComponent(JSON.stringify(payload))}`;

  const parsed = parseScannedQr(url);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.kind, "Payment Handle");
  assert.equal(parsed.itemDraft?.handle, "kasun@okaxis");
});

test("QR Parser: handles standard payment links", () => {
  const standardUpi = "upi://pay?pa=store@upi&pn=SuperStore&cu=INR";
  const parsed = parseScannedQr(standardUpi);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.kind, "Payment Handle");
  assert.equal(parsed.itemDraft?.handle, "store@upi");
  assert.equal(parsed.itemDraft?.accountHolderName, "SuperStore");
});

test("QR Cards: arbitrary payloads are saved verbatim", () => {
  const payload = "WIFI:T:WPA;S:Cafe Guest;P:p@ss&word;;";
  const draft = createQrCardDraft(`  ${payload}  `);
  assert.ok(draft);
  assert.equal(draft.type, "qr_code");
  assert.equal(draft.title, "Scanned QR");
  assert.equal(draft.qrValue, payload);
  assert.equal(createQrCardDraft("   "), null);
});


test("Vault Storage: new vaults start empty", async () => {
  const mockStorage = new Map();
  globalThis.localStorage = {
    getItem: (k) => mockStorage.get(k) || null,
    setItem: (k, v) => mockStorage.set(k, String(v)),
    removeItem: (k) => mockStorage.delete(k),
    clear: () => mockStorage.clear(),
  };

  const { createNewVault } = await import("../lib/vault-storage.ts");
  const created = await createNewVault("1357", false);
  assert.equal(created.data.items.length, 0);
});


test("Vault Storage: QR card content is encrypted and restored", async () => {
  const mockStorage = new Map();
  globalThis.localStorage = {
    getItem: (k) => mockStorage.get(k) || null,
    setItem: (k, v) => mockStorage.set(k, String(v)),
    removeItem: (k) => mockStorage.delete(k),
    clear: () => mockStorage.clear(),
  };

  const { createNewVault, getRawVaultSchema, unlockVault } = await import(
    "../lib/vault-storage.ts"
  );
  const qrValue = "https://example.com/ticket?id=123&seat=A1";
  const draft = createQrCardDraft(qrValue);
  assert.ok(draft);
  await createNewVault("1122", false, [
    {
      ...draft,
      id: "qr-1",
      colorTheme: "silver",
      isFavorite: false,
      tags: [],
      createdAt: 0,
      updatedAt: 0,
    },
  ]);

  assert.equal(JSON.stringify(getRawVaultSchema()).includes(qrValue), false);

  const unlocked = await unlockVault("1122");
  assert.ok("data" in unlocked);
  assert.equal(unlocked.data.items[0].qrValue, qrValue);
});


test("Vault Storage: drops earlier demo items but keeps user items", async () => {
  const mockStorage = new Map();
  globalThis.localStorage = {
    getItem: (k) => mockStorage.get(k) || null,
    setItem: (k, v) => mockStorage.set(k, String(v)),
    removeItem: (k) => mockStorage.delete(k),
    clear: () => mockStorage.clear(),
  };

  const { createNewVault, unlockVault } = await import("../lib/vault-storage.ts");
  const demo = {
    id: "bank-primary-01",
    type: "custom",
    title: "Old demo",
    colorTheme: "ocean",
    isFavorite: false,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  };
  const mine = {
    id: "mine-1",
    type: "custom",
    title: "My own item",
    colorTheme: "ocean",
    isFavorite: false,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  };

  await createNewVault("2468", false, [demo, mine]);
  const unlocked = await unlockVault("2468");
  assert.ok("data" in unlocked);
  assert.deepEqual(unlocked.data.items.map((item) => item.id), ["mine-1"]);
});


test("Vault Storage: create, save, unlock cycle", async () => {
  // Simple localStorage mock for node environment
  const mockStorage = new Map();
  globalThis.localStorage = {
    getItem: (k) => mockStorage.get(k) || null,
    setItem: (k, v) => mockStorage.set(k, String(v)),
    removeItem: (k) => mockStorage.delete(k),
    clear: () => mockStorage.clear(),
  };

  const { createNewVault, unlockVault, saveVaultData, changeVaultPasscode, getRawVaultSchema } = await import("../lib/vault-storage.ts");

  // 1. Create a vault protected by PIN 8421 with test items
  const testSampleItems = [
    {
      id: "bank-1",
      type: "bank_account",
      title: "Seylan Primary",
      bankName: "Seylan",
      accountHolder: "Alex Morgan",
      accountNumber: "008920194821",
      accountType: "Savings",
      currency: "LKR",
      colorTheme: "ocean",
      isFavorite: true,
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];
  const created = await createNewVault("8421", true, testSampleItems);
  assert.equal(created.schema.hasPasscode, true);
  assert.ok(created.schema.payloadCipher);
  assert.ok(created.schema.authCipher);

  // 2. Verify raw schema in storage is ciphertext
  const raw = getRawVaultSchema();
  assert.ok(raw);
  assert.equal(raw.version, 2);
  // Ensure sensitive data is NOT stored in plaintext
  const rawString = JSON.stringify(raw);
  assert.equal(rawString.includes("Alex Morgan"), false);
  assert.equal(rawString.includes("008920194821"), false);

  // 3. Unlock with wrong PIN fails
  const wrongUnlock = await unlockVault("0000");
  assert.ok("error" in wrongUnlock);

  // 4. Unlock with correct PIN succeeds
  const rightUnlock = await unlockVault("8421");
  assert.ok("data" in rightUnlock);
  assert.equal(rightUnlock.data.items.length, 1);
  assert.equal(rightUnlock.data.items[0].accountHolder, "Alex Morgan");

  // 5. Add a new item and save
  const updatedData = {
    ...rightUnlock.data,
    items: [
      ...rightUnlock.data.items,
      {
        id: "custom-key-1",
        type: "custom",
        title: "Office Keycard",
        subtitle: "Floor 4 Access",
        colorTheme: "steel",
        isFavorite: true,
        tags: ["Work"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
  };
  await saveVaultData(updatedData, rightUnlock.key);

  // Re-unlock and verify new item persisted
  const reUnlock = await unlockVault("8421");
  assert.ok("data" in reUnlock);
  assert.equal(reUnlock.data.items.length, 2);
  assert.equal(reUnlock.data.items[1].title, "Office Keycard");

  // 6. Change PIN to 9999
  const changed = await changeVaultPasscode(rightUnlock.key, "9999", reUnlock.data);
  assert.ok(changed.newKey);

  // Old PIN 8421 should now fail
  const oldPinAttempt = await unlockVault("8421");
  assert.ok("error" in oldPinAttempt);

  // New PIN 9999 should succeed
  const newPinAttempt = await unlockVault("9999");
  assert.ok("data" in newPinAttempt);
  assert.equal(newPinAttempt.data.items.length, 2);
});
