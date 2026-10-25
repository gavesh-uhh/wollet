/**
 * Best-effort parsing of text read from the front of a card.
 * Pure functions so the OCR result can be tested without a browser.
 */

import type { CreditCardItem, IdDocumentItem } from "./vault-types.ts";

export interface ScannedCard {
  kind: "payment" | "other";
  number: string;
  numberValid: boolean | null;
  holder: string;
  issuer: string;
  network: CreditCardItem["network"];
  cardType: CreditCardItem["cardType"];
  documentType: IdDocumentItem["documentType"];
  expiryMonth: string;
  expiryYear: string;
}

const CARD_NUMBER_LENGTHS = [16, 15, 19, 13, 14, 17, 18];

const EXPIRY_MONTHS: Record<string, string> = {
  JAN: "01",
  FEB: "02",
  MAR: "03",
  APR: "04",
  MAY: "05",
  JUN: "06",
  JUL: "07",
  AUG: "08",
  SEP: "09",
  SEPT: "09",
  OCT: "10",
  NOV: "11",
  DEC: "12",
};

const PAYMENT_WORDS = /\b(DEBIT|CREDIT|PREPAID|VISA|MASTERCARD|MAESTRO|AMEX|AMERICAN EXPRESS|DISCOVER|RUPAY|UNIONPAY|JCB|DINERS)\b/;
const PAYMENT_CONTEXT = /\b(BANK|VALID THRU|VALID THROUGH|VALID FROM)\b/;
const OTHER_CARD_WORDS = /\b(STUDENT|CAMPUS|UNIVERSIT[A-Z]*|COLLEGE|SCHOOL|ACADEMY|MEMBERSHIP|MEMBER|LIBRARY|CLUB|LOYALTY|EMPLOYEE|STAFF|FACULTY)\b/;

// Lines that are labels rather than the holder's name.
const LABEL_WORDS = new Set([
  "VISA", "MASTERCARD", "MAESTRO", "AMEX", "AMERICAN", "EXPRESS", "DISCOVER",
  "RUPAY", "UNIONPAY", "JCB", "DINERS", "CARD", "CARDS", "DEBIT", "CREDIT",
  "PREPAID", "BANK", "VALID", "THRU", "THROUGH", "FROM", "UNTIL", "MONTH",
  "YEAR", "CVV", "CVC", "PIN", "SECURITY", "CODE", "SIGNATURE", "AUTHORIZED",
  "AUTHORISED", "USER", "NAME", "HOLDER", "CARDHOLDER", "IF", "FOUND",
  "PLEASE", "RETURN", "CALL", "CONTACT", "PHONE", "EMAIL", "WWW", "HTTP",
  "HTTPS", "COM", "NET", "ORG", "PLATINUM", "GOLD", "CLASSIC", "WORLD",
  "BUSINESS", "REWARDS", "POINTS", "SINCE", "MEMBER", "MEMBERSHIP", "STUDENT",
  "STAFF", "FACULTY", "CAMPUS", "UNIVERSITY", "COLLEGE", "SCHOOL", "LIBRARY",
  "CLUB", "LOYALTY", "EMPLOYEE", "ID", "IDENTIFICATION", "NO", "NUMBER",
  "ACCOUNT", "BRANCH", "OFFICE", "DEPARTMENT", "ISSUED", "EXPIRES", "EXPIRY",
  "THE", "OF", "AND", "FOR",
]);

function cleanLine(line: string): string {
  return line
    .replace(/[“”‘’]/g, "'")
    .replace(/[^A-Za-z0-9&.'\-/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

function normaliseNumericLine(line: string): string {
  return line
    .replace(/[OoQq]/g, "0")
    .replace(/[Il|!]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8")
    .replace(/[Zz]/g, "2")
    .replace(/[Gg]/g, "6");
}

export function luhnValid(value: string): boolean {
  const digits = digitsOnly(value);
  if (digits.length < 13 || digits.length > 19) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export function detectCardNetwork(cardNumber: string): CreditCardItem["network"] {
  const digits = digitsOnly(cardNumber);
  if (/^3[47]/.test(digits)) return "Amex";
  if (/^(5[1-5]|2(2[2-9][1-9]|2[3-9]\d|[3-6]\d{2}|7[01]\d|720))/.test(digits)) {
    return "Mastercard";
  }
  if (/^4/.test(digits)) return "Visa";
  if (/^652[12]/.test(digits)) return "RuPay";
  if (/^(6011|64[4-9]|65)/.test(digits)) return "Discover";
  if (/^(60|35[36])/.test(digits)) return "RuPay";
  return "Other";
}

function findCardNumber(lines: string[]): { value: string; valid: boolean } | null {
  let fallback = "";
  for (const line of lines) {
    const actualDigits = (line.match(/\d/g) || []).length;
    const run = digitsOnly(normaliseNumericLine(line));
    if (actualDigits < 8 || run.length < 13) continue;

    const hasSeparator = /[/\\]/.test(line);
    // "4111 1111 1111 1111 09/28" turns into an 18 digit run; drop the
    // trailing month and year before testing the checksum.
    if (hasSeparator && run.length > 13 && run.length <= 21) {
      for (const cut of [2, 4]) {
        const value = run.slice(0, run.length - cut);
        if (value.length >= 13 && value.length <= 19 && luhnValid(value)) {
          return { value, valid: true };
        }
      }
    }

    if (run.length >= 13 && run.length <= 19) {
      if (luhnValid(run)) return { value: run, valid: true };
      if (!fallback) fallback = run;
      continue;
    }

    for (const length of CARD_NUMBER_LENGTHS) {
      if (length > run.length) continue;
      const prefix = run.slice(0, length);
      if (luhnValid(prefix)) return { value: prefix, valid: true };
      const suffix = run.slice(-length);
      if (luhnValid(suffix)) return { value: suffix, valid: true };
    }
    if (!fallback) fallback = run.slice(0, 16);
  }
  return fallback ? { value: fallback, valid: false } : null;
}

function findExpiry(text: string): { month: string; year: string } | null {
  const numeric = text.match(
    /(?:^|\D)(0?[1-9]|1[0-2])\s*[/\\\-.]\s*(\d{2}|\d{4})(?!\d)/
  );
  if (numeric) {
    const year = numeric[2].length === 4 ? numeric[2].slice(-2) : numeric[2];
    return { month: numeric[1].padStart(2, "0"), year };
  }
  const named = text.match(
    /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s*[/\- ]?\s*(\d{2}|\d{4})(?!\d)/
  );
  if (named) {
    const year = named[2].length === 4 ? named[2].slice(-2) : named[2];
    return { month: EXPIRY_MONTHS[named[1]] ?? "", year };
  }
  return null;
}

function findHolder(lines: string[]): string {
  let candidate = "";
  for (const line of lines) {
    const words = line.split(" ").filter(Boolean);
    if (words.length < 2 || words.length > 4) continue;
    if (line.length < 5 || line.length > 40 || /\d/.test(line)) continue;
    if (!words.every((word) => /^[A-Z][A-Z'.-]{0,24}$/.test(word))) continue;
    if (words.some((word) => LABEL_WORDS.has(word.replace(/[.'-]/g, "")))) continue;
    candidate = line;
  }
  return candidate;
}

function findIssuer(lines: string[], holder: string): string {
  for (const line of lines) {
    if (line === holder) continue;
    if (line.length < 2 || line.length > 36) continue;
    if (/\d/.test(line)) continue;
    const words = line.split(" ").filter(Boolean);
    if (words.length > 6) continue;
    if (!/^[A-Z][A-Z&.'\- ]+$/.test(line)) continue;
    if (LABEL_WORDS.has(line)) continue;
    if (words.every((word) => LABEL_WORDS.has(word.replace(/[.'-]/g, "")))) continue;
    return line.replace(/[.,;:]+$/, "");
  }
  return "";
}

function findOtherNumber(
  lines: string[],
  expiry: { month: string; year: string } | null
): string {
  const expiryToken = expiry ? `${expiry.month}/${expiry.year}` : "";
  const scored: Array<{ value: string; score: number }> = [];
  const labelPattern = /\b(?:STUDENT|STAFF|FACULTY|MEMBER|MEMBERSHIP|CARD|ID|NO|NUMBER|LIBRARY|ACCOUNT)\b[:#.-]?\s*/g;

  lines.forEach((line, index) => {
    if (/\b(VALID|THRU|EXPIRES|EXPIRY|PHONE|CALL|CONTACT|WWW|EMAIL)\b/.test(line)) {
      return;
    }
    const isLabelled = /\b(?:STUDENT|STAFF|FACULTY|MEMBER|MEMBERSHIP|CARD|ID|NO|NUMBER|LIBRARY|ACCOUNT)\b/.test(
      line
    );
    let stripped = line.replace(labelPattern, " ").replace(/\s+/g, " ").trim();
    if (!stripped) return;

    // Join grouped digits such as "1234 5678 9012" before looking at tokens.
    const joined = stripped.replace(/\s+/g, "");
    if (/^\d[\d/-]{5,24}$/.test(joined)) {
      stripped = joined;
    }

    for (const rawToken of stripped.split(/\s+/)) {
      const token = rawToken.replace(/^[.,;:]+|[.,;:]+$/g, "");
      if (token.length < 4 || token.length > 25) continue;
      if (!/^[A-Z0-9][A-Z0-9./-]*$/.test(token)) continue;
      if (!/\d/.test(token)) continue;
      if (/^(19|20)\d{2}$/.test(token)) continue;
      if (/^\d{2}[\/.-]\d{2}$/.test(token) || token === expiryToken) continue;

      const digitCount = (token.match(/\d/g) || []).length;
      if (digitCount < 4) continue;
      let score = Math.min(digitCount, 12) / 12;
      if (isLabelled) score += 3;
      if (/[A-Z]/.test(token)) score += 1;
      score -= index * 0.01;
      scored.push({ value: token, score });
    }
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.value ?? "";
}

/**
 * Extracts what it can from OCR text. Returns null when nothing card-like was read.
 * The caller must still show every value for the user to confirm.
 */
export function parseCardText(raw: string): ScannedCard | null {
  const lines = raw
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map(cleanLine)
    .map((line) => line.toUpperCase())
    .filter((line) => line.length >= 2);

  if (!lines.length) return null;
  const text = lines.join("\n");
  if (text.replace(/[^A-Z0-9]/g, "").length < 4) return null;

  const expiry = findExpiry(text);
  const cardNumber = findCardNumber(lines);
  const holder = findHolder(lines);
  const issuer = findIssuer(lines, holder);
  const otherCard = OTHER_CARD_WORDS.test(text);
  const paymentWords = /\b(DEBIT|CREDIT|PREPAID)\b/.test(text);
  const payment =
    !(otherCard && !paymentWords) &&
    Boolean(cardNumber || PAYMENT_WORDS.test(text) || PAYMENT_CONTEXT.test(text));
  const number = payment
    ? cardNumber?.value ?? ""
    : cardNumber?.value || findOtherNumber(lines, expiry);

  if (!number && !expiry && !(holder && issuer)) return null;

  return {
    kind: payment ? "payment" : "other",
    number,
    numberValid: payment ? Boolean(cardNumber?.valid) : null,
    holder,
    issuer,
    network: payment ? detectCardNetwork(number) : "Other",
    cardType: /\bPREPAID\b/.test(text)
      ? "Prepaid"
      : /\bCREDIT\b/.test(text) && !/\bDEBIT\b/.test(text)
      ? "Credit"
      : "Debit",
    documentType: /\b(STUDENT|CAMPUS|UNIVERSIT[A-Z]*|COLLEGE|SCHOOL|ACADEMY)\b/.test(text)
      ? "Campus card"
      : /\b(MEMBER|MEMBERSHIP|LIBRARY|CLUB|LOYALTY|REWARD)\b/.test(text)
      ? "Membership"
      : "Other",
    expiryMonth: expiry?.month ?? "",
    expiryYear: expiry?.year ?? "",
  };
}
