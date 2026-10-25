import test from "node:test";
import assert from "node:assert/strict";
import {
  detectCardNetwork,
  luhnValid,
  parseCardText,
} from "../lib/card-scan.ts";

test("Card scan: validates Luhn checksums", () => {
  assert.equal(luhnValid("4532 0151 1283 0366"), true);
  assert.equal(luhnValid("5555555555554444"), true);
  assert.equal(luhnValid("378282246310005"), true);
  assert.equal(luhnValid("4532015112830367"), false);
  assert.equal(luhnValid("0000000000000000"), false);
  assert.equal(luhnValid("1234"), false);
});

test("Card scan: detects card networks", () => {
  assert.equal(detectCardNetwork("4532015112830366"), "Visa");
  assert.equal(detectCardNetwork("5555555555554444"), "Mastercard");
  assert.equal(detectCardNetwork("378282246310005"), "Amex");
  assert.equal(detectCardNetwork("6011111111111117"), "Discover");
  assert.equal(detectCardNetwork("6521123456789012"), "RuPay");
  assert.equal(detectCardNetwork("9999999999999999"), "Other");
});

test("Card scan: reads a debit card", () => {
  const scanned = parseCardText(`HDFC BANK
DEBIT CARD
4532 0151 1283 0366
VALID THRU 09/28
RAHUL SHARMA
VISA`);

  assert.ok(scanned);
  assert.equal(scanned.kind, "payment");
  assert.equal(scanned.number, "4532015112830366");
  assert.equal(scanned.numberValid, true);
  assert.equal(scanned.network, "Visa");
  assert.equal(scanned.cardType, "Debit");
  assert.equal(scanned.holder, "RAHUL SHARMA");
  assert.equal(scanned.issuer, "HDFC BANK");
  assert.equal(scanned.expiryMonth, "09");
  assert.equal(scanned.expiryYear, "28");
});

test("Card scan: reads a credit card and month-name expiry", () => {
  const scanned = parseCardText(`CHASE
CREDIT CARD
5555 5555 5555 4444
VALID THRU SEP 2029
JANE Q PUBLIC
MASTERCARD`);

  assert.ok(scanned);
  assert.equal(scanned.kind, "payment");
  assert.equal(scanned.network, "Mastercard");
  assert.equal(scanned.cardType, "Credit");
  assert.equal(scanned.expiryMonth, "09");
  assert.equal(scanned.expiryYear, "29");
  assert.equal(scanned.holder, "JANE Q PUBLIC");
  assert.equal(scanned.issuer, "CHASE");
});

test("Card scan: repairs common OCR digit confusions", () => {
  const scanned = parseCardText(`HDFC BANK
DEBIT
4S32 O1S1 1283 O366
09/28
RAHUL SHARMA`);

  assert.ok(scanned);
  assert.equal(scanned.number, "4532015112830366");
  assert.equal(scanned.numberValid, true);
});

test("Card scan: keeps a failed checksum for the user to review", () => {
  const scanned = parseCardText(`VISA
DEBIT
4532 0151 1283 0367
09/28
JOHN DOE`);

  assert.ok(scanned);
  assert.equal(scanned.kind, "payment");
  assert.equal(scanned.number, "4532015112830367");
  assert.equal(scanned.numberValid, false);
});

test("Card scan: reads a campus card", () => {
  const scanned = parseCardText(`UNIVERSITY OF COLOMBO
STUDENT ID
2021/CS/1234
JOHN DOE
VALID THRU 08/27`);

  assert.ok(scanned);
  assert.equal(scanned.kind, "other");
  assert.equal(scanned.documentType, "Campus card");
  assert.equal(scanned.number, "2021/CS/1234");
  assert.equal(scanned.numberValid, null);
  assert.equal(scanned.holder, "JOHN DOE");
  assert.equal(scanned.issuer, "UNIVERSITY OF COLOMBO");
  assert.equal(scanned.expiryMonth, "08");
  assert.equal(scanned.expiryYear, "27");
});

test("Card scan: reads a membership card", () => {
  const scanned = parseCardText(`CITY LIBRARY
MEMBERSHIP CARD
NO. 883 421 990
VALID THRU 12/26
MARY ANN LEE`);

  assert.ok(scanned);
  assert.equal(scanned.kind, "other");
  assert.equal(scanned.documentType, "Membership");
  assert.equal(scanned.number, "883421990");
  assert.equal(scanned.issuer, "CITY LIBRARY");
  assert.equal(scanned.holder, "MARY ANN LEE");
});

test("Card scan: returns null for text that is not a card", () => {
  assert.equal(parseCardText(""), null);
  assert.equal(parseCardText("HELLO\nTHERE"), null);
});
