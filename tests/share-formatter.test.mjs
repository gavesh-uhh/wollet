import test from "node:test";
import assert from "node:assert/strict";
import { formatShareText } from "../lib/share-formatter.ts";

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
  assert.match(text, /•••• •••• •••• 4444/);
  assert.ok(!text.includes("4111222233334444"));
  assert.ok(!text.includes("987"));
});

test("Share text includes the fields needed for a bank transfer", () => {
  const text = formatShareText(bankAccount);
  for (const value of [
    "Jane Doe",
    "Seylan",
    "0012345678",
    "SEYLLKLX",
    "BCEYLKLX",
    "Colombo",
    "Savings",
    "LKR",
    "Rent",
  ]) {
    assert.ok(text.includes(value), `missing ${value}`);
  }
});

test("Share text includes the payment handle", () => {
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
  });
  assert.ok(text.includes("jane@okaxis"));
  assert.ok(text.includes("Jane Doe"));
  assert.ok(text.includes("Payment ID"));
  assert.ok(!text.includes("UPI"));
});
