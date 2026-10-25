import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { CARD_LOGOS, getCardLogo, searchCardLogos, prepareRegistryLogo } from "../lib/card-logos.ts";
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
  assert.equal(draft.qrValue, `  ${payload}  `);
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

  // The next edit must use the new active key, and stale keys must not corrupt storage.
  const beforeStaleSave = JSON.stringify(getRawVaultSchema());
  await assert.rejects(saveVaultData(updatedData, rightUnlock.key), /key has changed/);
  assert.equal(JSON.stringify(getRawVaultSchema()), beforeStaleSave);
  await saveVaultData({ ...updatedData, items: updatedData.items.slice(0, 1) }, changed.newKey);
  const afterEdit = await unlockVault("9999");
  assert.ok("data" in afterEdit);
  assert.equal(afterEdit.data.items.length, 1);
});

function mockLocalStorage() {
  const entries = new Map();
  globalThis.localStorage = {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: key => entries.delete(key),
  };
  return entries;
}

test("PIN: 0000 is protected; explicit removal keeps items in device mode", async () => {
  mockLocalStorage();
  const { createNewVault, changeVaultPasscode, unlockVault, DEFAULT_DEVICE_PIN } = await import("../lib/vault-storage.ts");
  const initial = await createNewVault();
  const data = { ...initial.data, items: [{ id: "mine", type: "custom", title: "Keep me" }] };
  const protectedVault = await changeVaultPasscode(initial.key, "0000", data);
  assert.equal(protectedVault.schema.hasPasscode, true);
  await assert.rejects(changeVaultPasscode(protectedVault.newKey, "123", data), /4 to 8 digits/);
  await assert.rejects(changeVaultPasscode(protectedVault.newKey, "abcd", data), /4 to 8 digits/);
  await assert.rejects(changeVaultPasscode(protectedVault.newKey, "123456789", data), /4 to 8 digits/);
  const removed = await changeVaultPasscode(protectedVault.newKey, DEFAULT_DEVICE_PIN, data, false);
  assert.equal(removed.schema.hasPasscode, false);
  const opened = await unlockVault(DEFAULT_DEVICE_PIN);
  assert.ok("data" in opened);
  assert.equal(opened.data.items[0].title, "Keep me");
});

test("Storage: failed writes and corrupt startup never destroy the existing vault", async () => {
  const entries = mockLocalStorage();
  const { createNewVault, saveVaultData, VAULT_STORAGE_KEY } = await import("../lib/vault-storage.ts");
  const initial = await createNewVault("1234", true);
  const before = entries.get(VAULT_STORAGE_KEY);
  localStorage.setItem = () => { throw new Error("Storage quota exceeded"); };
  await assert.rejects(saveVaultData(initial.data, initial.key), /quota/);
  assert.equal(entries.get(VAULT_STORAGE_KEY), before);
  entries.set(VAULT_STORAGE_KEY, "broken-json");
  await assert.rejects(createNewVault(), /already exists/);
  assert.equal(entries.get(VAULT_STORAGE_KEY), "broken-json");
});

test("Reset: legacy cards do not reappear after clearing the vault", async () => {
  const entries = mockLocalStorage();
  const { resetLocalVault, VAULT_STORAGE_KEY, LEGACY_STORAGE_KEY } = await import("../lib/vault-storage.ts");
  entries.set(VAULT_STORAGE_KEY, "vault");
  entries.set(LEGACY_STORAGE_KEY, "old cards");
  entries.set("unrelated", "keep");
  resetLocalVault();
  assert.equal(entries.has(VAULT_STORAGE_KEY), false);
  assert.equal(entries.has(LEGACY_STORAGE_KEY), false);
  assert.equal(entries.get("unrelated"), "keep");
});

test("QR: original code images are encrypted and restored, even without decoded text", async () => {
  mockLocalStorage();
  const { createNewVault, unlockVault, getRawVaultSchema } = await import("../lib/vault-storage.ts");
  const image = "data:image/png;base64,originalCodePixels";
  const draft = createQrCardDraft("", image);
  assert.ok(draft);
  await createNewVault("1234", true, [{ ...draft, id: "qr-original" }]);
  assert.equal(JSON.stringify(getRawVaultSchema()).includes(image), false);
  const opened = await unlockVault("1234");
  assert.ok("data" in opened);
  assert.equal(opened.data.items[0].imageDataUrl, image);
  assert.equal(opened.data.items[0].qrValue, "");
});

test("QR imports decode percent signs exactly once", () => {
  const payload = { _payit: 1, kind: "upi_handle", title: "100% mine", data: { handle: "test@upi" } };
  const result = parseScannedQr(`https://example.com/?import=${encodeURIComponent(JSON.stringify(payload))}`);
  assert.equal(result.valid, true);
  assert.equal(result.itemDraft.title, "100% mine");
});

test("Card logos: only bundled or local PNG images are displayed", () => {
  assert.deepEqual(CARD_LOGOS.map(logo => logo.id), ["seylan", "boc", "chase"]);
  assert.equal(getCardLogo("seylan").src, "/logos/seylan.png");
  assert.equal(getCardLogo("data:image/png;base64,aGVsbG8=").name, "Custom logo");
  assert.equal(getCardLogo("https://tracking.example/logo.png"), null);
  assert.equal(getCardLogo("data:image/svg+xml;base64,PHN2Zz4="), null);
  assert.equal(getCardLogo("data:image/png;base64," + "a".repeat(250_000)), null);
  assert.equal(getCardLogo(undefined), null);
});

test("Card logos survive encrypted saves, edits, removal and reopening", async () => {
  mockLocalStorage();
  const { createNewVault, saveVaultData, unlockVault, getRawVaultSchema } = await import("../lib/vault-storage.ts");
  const custom = "data:image/png;base64,aGVsbG8=";
  const initial = await createNewVault("1234", true, [
    { id: "logo-card", type: "custom", title: "My bank", logo: "boc" },
    { id: "custom-card", type: "custom", title: "My logo", logo: custom },
  ]);
  assert.equal(JSON.stringify(getRawVaultSchema()).includes(custom), false);
  const reopened = await unlockVault("1234");
  assert.ok("data" in reopened);
  assert.equal(reopened.data.items[0].logo, "boc");
  assert.equal(reopened.data.items[1].logo, custom);
  await saveVaultData({ ...initial.data, items: initial.data.items.map(item => ({ ...item, logo: undefined })) }, initial.key);
  const removed = await unlockVault("1234");
  assert.ok("data" in removed);
  assert.equal(removed.data.items[0].logo, undefined);
  assert.equal(removed.data.items[1].logo, undefined);
});

test("Logo registry: broad local search and safe saved logo references", () => {
  const { entries } = JSON.parse(readFileSync(new URL("../public/logos/registry/index.json", import.meta.url), "utf8"));
  assert.ok(entries.length > 3000);
  assert.ok(searchCardLogos(entries, "spotify").some(entry => entry.name === "Spotify"));
  assert.ok(searchCardLogos(entries, "HSBC").some(entry => entry.name === "HSBC"));
  assert.ok(searchCardLogos(entries, "american express").some(entry => entry.name === "American Express"));
  assert.equal(searchCardLogos(CARD_LOGOS, "Bank of Ceylon")[0].id, "boc");
  assert.equal(searchCardLogos(entries, "thisbranddoesnotexist123456").length, 0);
  assert.equal(searchCardLogos(entries, "ශ්‍රී").length, 0);
  assert.equal(getCardLogo("registry:spotify#Spotify").src, "/logos/registry/spotify.svg");
  assert.equal(getCardLogo("registry:americanexpress#American%20Express").name, "American Express");
  assert.equal(getCardLogo("registry:../secrets#Example"), null);
  assert.equal(getCardLogo("registry:spotify#%invalid"), null);
  assert.equal(getCardLogo("registry:https://example.com#Example"), null);
});

test("Logo registry: selecting a brand caches its artwork for offline use", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const writes = [];
  try {
    globalThis.fetch = async src => {
      assert.equal(src, "/logos/registry/spotify.svg");
      return new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } });
    };
    globalThis.caches = { open: async name => {
      assert.equal(name, "wollet-selected-logos-v1");
      return { put: async (src, response) => writes.push([src, await response.text()]) };
    } };
    await prepareRegistryLogo("registry:spotify#Spotify");
    assert.deepEqual(writes, [["/logos/registry/spotify.svg", "<svg/>"]]);
    await assert.rejects(prepareRegistryLogo("https://outside.test/logo.svg"), /from the registry/);
    globalThis.fetch = async () => { throw new Error("Offline"); };
    await assert.rejects(prepareRegistryLogo("registry:spotify#Spotify"), /offline/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

function serviceWorkerHarness() {
  const handlers = new Map();
  const cached = new Map();
  let online = true;
  const key = request => new URL(typeof request === "string" ? request : request.url, "https://wallet.test").href;
  const fetcher = async request => {
    if (!online) throw new Error("Offline");
    return new Response(key(request) === "https://wallet.test/"
      ? '<html><script src="/_next/static/app.js"></script><link href="/_next/static/app.css" rel="stylesheet"></html>'
      : "static asset");
  };
  const cache = {
    match: async request => cached.get(key(request))?.clone(),
    put: async (request, response) => cached.set(key(request), response),
    add: async request => cached.set(key(request), await fetcher(request)),
    addAll: async requests => { await Promise.all(requests.map(cache.add)); },
  };
  runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    self: { location: { origin: "https://wallet.test" }, addEventListener: (type, fn) => handlers.set(type, fn), skipWaiting: async () => {} },
    caches: { open: async () => cache, match: cache.match },
    fetch: fetcher, URL,
  });
  return { cached, handlers, offline: () => { online = false; }, async dispatch(type, fields = {}) {
    let completion;
    handlers.get(type)({ ...fields, waitUntil: promise => { completion = promise; }, respondWith: promise => { completion = promise; } });
    return await completion;
  } };
}

test("Offline: installation caches the wallet and its initial scripts and styles", async () => {
  const worker = serviceWorkerHarness();
  await worker.dispatch("install");
  assert.equal(worker.cached.has("https://wallet.test/_next/static/app.js"), true);
  assert.equal(worker.cached.has("https://wallet.test/_next/static/app.css"), true);
  worker.offline();
  const response = await worker.dispatch("fetch", { request: { method: "GET", mode: "navigate", url: "https://wallet.test/" } });
  assert.match(await response.text(), /<html>/);
});

test("Offline: share URLs and external resources are never cached", async () => {
  const worker = serviceWorkerHarness();
  await worker.dispatch("install");
  await worker.dispatch("fetch", { request: { method: "GET", mode: "navigate", url: "https://wallet.test/?import=private-details" } });
  await worker.dispatch("message", { data: { type: "CACHE_WALLET_ASSETS", urls: [
    "https://wallet.test/?import=private-details", "https://external.test/script.js",
    "https://wallet.test/_next/static/qr.js", "https://wallet.test/ocr/worker.min.js",
  ] } });
  assert.equal(worker.cached.has("https://wallet.test/?import=private-details"), false);
  assert.equal(worker.cached.has("https://external.test/script.js"), false);
  assert.equal(worker.cached.has("https://wallet.test/_next/static/qr.js"), true);
  worker.offline();
  const response = await worker.dispatch("fetch", { request: { method: "GET", mode: "cors", url: "https://wallet.test/ocr/worker.min.js" } });
  assert.equal(await response.text(), "static asset");
});
