import test from "node:test";
import assert from "node:assert/strict";
import { formatShareText, shareDetailsDirectly } from "../lib/share-formatter.ts";

async function withShareGlobals({ share, clipboard }, fn) {
  if (share) Object.defineProperty(navigator, "share", { value: share, configurable: true });
  else delete navigator.share;
  if (clipboard) Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
  else delete navigator.clipboard;
  try {
    await fn();
  } finally {
    delete navigator.share;
    delete navigator.clipboard;
  }
}

const creditCard = {
  id: "cc-1",
  type: "credit_card",
  title: "Visa Gold",
  isFavorite: false,
  tags: [],
  colorTheme: "graphite",
  createdAt: 0,
  updatedAt: 0,
  cardholderName: "Jane Doe",
  cardNumber: "4111222233334444",
  expiryMonth: "10",
  expiryYear: "28",
  cvv: "987",
  bankOrIssuer: "Chase",
  network: "Visa",
  cardType: "Credit",
  pattern: "orbit",
};

const bankAccount = {
  id: "bank-1",
  type: "bank_account",
  title: "Salary",
  isFavorite: false,
  tags: [],
  colorTheme: "ocean",
  createdAt: 0,
  updatedAt: 0,
  accountHolder: "Jane Doe",
  bankName: "Seylan",
  accountNumber: "0012345678",
  routingOrIfsc: "SEYLLKLX",
  swiftBic: "BCEYLKLX",
  branchName: "Colombo",
  accountType: "Savings",
  currency: "LKR",
  notes: "Rent",
};

test("Share text never exposes full credit card numbers or CVV", () => {
  const text = formatShareText(creditCard);
  assert.match(text, /Card: •••• 4444/);
  assert.ok(!text.includes("4111222233334444"));
  assert.ok(!text.includes("987"));
});

test("Share text includes only the fields needed for a bank transfer", () => {
  const text = formatShareText(bankAccount);
  assert.equal(
    text,
    [
      "Name: Jane Doe",
      "Bank: Seylan",
      "A/C: 0012345678",
      "Branch: Colombo",
      "Routing/IFSC: SEYLLKLX",
      "SWIFT: BCEYLKLX",
    ].join("\n")
  );
  for (const hidden of ["LKR", "Savings", "Rent"]) {
    assert.ok(!text.includes(hidden), `should not share ${hidden}`);
  }
});

test("Share text keeps payment details short", () => {
  const text = formatShareText({
    id: "upi-1",
    type: "upi_handle",
    title: "Personal",
    isFavorite: false,
    tags: [],
    colorTheme: "steel",
    createdAt: 0,
    updatedAt: 0,
    handle: "jane@okaxis",
    accountHolderName: "Jane Doe",
    provider: "Payment app",
    notes: "Rent",
  });
  assert.equal(text, "Name: Jane Doe\nPayment ID: jane@okaxis");
});

test("Share uses the native sheet when available", async () => {
  let shared;
  const messages = [];
  await withShareGlobals(
    { share: async (data) => { shared = data; } },
    () => shareDetailsDirectly(bankAccount, (msg) => messages.push(msg))
  );
  assert.deepEqual(shared, { text: formatShareText(bankAccount) });
  assert.deepEqual(messages, ["Shared successfully."]);
});

test("Share does nothing when the native sheet is cancelled", async () => {
  const abort = new Error("cancelled");
  abort.name = "AbortError";
  const messages = [];
  await withShareGlobals(
    { share: async () => { throw abort; } },
    () => shareDetailsDirectly(bankAccount, (msg) => messages.push(msg))
  );
  assert.deepEqual(messages, []);
});

test("Share falls back to copying when the native sheet fails", async () => {
  let copied = "";
  const messages = [];
  await withShareGlobals(
    {
      share: async () => { throw new Error("not available"); },
      clipboard: { writeText: async (text) => { copied = text; } },
    },
    () => shareDetailsDirectly(bankAccount, (msg) => messages.push(msg))
  );
  assert.equal(copied, formatShareText(bankAccount));
  assert.deepEqual(messages, ["Details copied. Paste them into any app."]);
});

test("Share copies without clipboard permission", async () => {
  let area;
  const originalDocument = globalThis.document;
  globalThis.document = {
    body: { appendChild() {} },
    activeElement: null,
    createElement() {
      area = {
        value: "",
        readOnly: false,
        style: {},
        focus() {},
        select() {},
        setSelectionRange() {},
        remove() {},
      };
      return area;
    },
    execCommand: (command) => {
      assert.equal(command, "copy");
      assert.equal(area.value, formatShareText(bankAccount));
      return true;
    },
  };
  const messages = [];
  try {
    await withShareGlobals(
      { clipboard: { writeText: async () => { throw new Error("denied"); } } },
      () => shareDetailsDirectly(bankAccount, (msg) => messages.push(msg))
    );
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
  assert.deepEqual(messages, ["Details copied. Paste them into any app."]);
});
