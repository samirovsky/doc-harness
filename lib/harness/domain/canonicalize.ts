import type { AnswerScalar, AnswerType } from "./contract";

/**
 * Converts a raw model value into the canonical form required by the scorer
 * (which compares with Object.is): raw JSON numbers, ISO YYYY-MM-DD dates,
 * lowercase text, JSON booleans, or null. Ambiguous values are rejected so the
 * pipeline can escalate instead of guessing.
 */
export type Canonical =
  | { ok: true; value: AnswerScalar }
  | { ok: false; reason: string };

const NULL_WORDS = new Set([
  "null",
  "n/a",
  "na",
  "unknown",
  "not available",
  "not applicable",
  "not supported",
  "unsupported",
  "insufficient evidence",
  "insufficient data",
  "cannot be determined",
  "not determinable",
  "not stated",
  "not specified",
]);

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const MULTIPLIERS: Record<string, number> = {
  k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, mm: 1e6, million: 1e6, millions: 1e6,
  bn: 1e9, billion: 1e9, billions: 1e9,
};

export function canonicalize(raw: unknown, type: AnswerType): Canonical {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === "string" && isNullWord(raw)) return { ok: true, value: null };
  switch (type) {
    case "number":
      return canonicalNumber(raw);
    case "date":
      return canonicalDate(raw);
    case "boolean":
      return canonicalBoolean(raw);
    case "text":
      return canonicalText(raw);
    default:
      return { ok: false, reason: `unsupported answer type ${String(type)}` };
  }
}

function isNullWord(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/[.!]+$/, "").replace(/^["']|["']$/g, "");
  return normalized === "" || NULL_WORDS.has(normalized);
}

/** Normalizes float noise and negative zero without truncating integers. */
export function cleanNumber(value: number): number {
  if (Object.is(value, -0)) return 0;
  if (Number.isInteger(value)) return value;
  const cleaned = Number(value.toPrecision(15));
  return Object.is(cleaned, -0) ? 0 : cleaned;
}

function canonicalNumber(raw: unknown): Canonical {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { ok: true, value: cleanNumber(raw) } : { ok: false, reason: "non-finite number" };
  }
  if (typeof raw !== "string") return { ok: false, reason: `expected a number, got ${typeof raw}` };

  let text = raw.normalize("NFKC").trim().toLowerCase().replace(/[\u2212\u2013\u2014]/g, "-");
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  // Thousands separators: commas, or non-breaking/narrow spaces (never plain spaces,
  // which would merge "Q3 2025" into one number).
  const matches = [...text.matchAll(/\d[\d,\u00a0\u202f]*(?:\.\d+)?/g)];
  if (matches.length !== 1) return { ok: false, reason: `expected exactly one number in "${raw}"` };

  const match = matches[0];
  const start = match.index ?? 0;
  const token = match[0].replace(/[\u00a0\u202f]/g, "").replace(/,+$/, "");
  if (token.includes(",") && !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(token)) {
    return { ok: false, reason: `ambiguous digit grouping in "${raw}"` };
  }
  const prefix = text.slice(0, start);
  const suffix = text.slice(start + match[0].length);
  if (/-\s*[$€£¥]?\s*$/.test(prefix)) negative = !negative;
  if (/\b(less|more|fewer|greater|over|under|between|range|from|to|above|below|at least|at most)\b/.test(prefix + suffix)) {
    return { ok: false, reason: `comparative or range expression in "${raw}"` };
  }

  let value = Number(token.replace(/,/g, ""));
  if (!Number.isFinite(value)) return { ok: false, reason: `not a number: "${raw}"` };
  const multiplier = MULTIPLIERS[suffix.trim().match(/^([a-z]+)\b/)?.[1] ?? ""];
  if (multiplier) value *= multiplier;

  return { ok: true, value: cleanNumber(negative ? -value : value) };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function validDate(year: number, month: number, day: number): boolean {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

function isoDate(year: number, month: number, day: number): Canonical {
  return validDate(year, month, day)
    ? { ok: true, value: `${year}-${pad(month)}-${pad(day)}` }
    : { ok: false, reason: `invalid calendar date ${year}-${month}-${day}` };
}

function canonicalDate(raw: unknown): Canonical {
  if (typeof raw !== "string") return { ok: false, reason: `expected a date string, got ${typeof raw}` };
  const text = raw.normalize("NFKC").trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();

  let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[t ].*)?$/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  match = text.match(/^(\d{1,2}) ([a-z]+) (\d{4})$/);
  if (match && MONTHS[match[2]]) return isoDate(Number(match[3]), MONTHS[match[2]], Number(match[1]));

  match = text.match(/^([a-z]+) (\d{1,2}) (\d{4})$/);
  if (match && MONTHS[match[1]]) return isoDate(Number(match[3]), MONTHS[match[1]], Number(match[2]));

  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first > 12 && second <= 12) return isoDate(Number(match[3]), second, first);
    if (second > 12 && first <= 12) return isoDate(Number(match[3]), first, second);
    return { ok: false, reason: `ambiguous day/month order in "${raw}"` };
  }
  return { ok: false, reason: `unrecognized date "${raw}"` };
}

const TRUE_WORDS = new Set(["true", "yes", "y"]);
const FALSE_WORDS = new Set(["false", "no", "n"]);

function canonicalBoolean(raw: unknown): Canonical {
  if (typeof raw === "boolean") return { ok: true, value: raw };
  if (typeof raw === "number" && (raw === 0 || raw === 1)) return { ok: true, value: raw === 1 };
  if (typeof raw !== "string") return { ok: false, reason: `expected a boolean, got ${typeof raw}` };
  const word = raw.trim().toLowerCase().replace(/[.!"']/g, "");
  if (TRUE_WORDS.has(word)) return { ok: true, value: true };
  if (FALSE_WORDS.has(word)) return { ok: true, value: false };
  return { ok: false, reason: `not a boolean: "${raw}"` };
}

function canonicalText(raw: unknown): Canonical {
  if (typeof raw === "number" || typeof raw === "boolean") return { ok: true, value: String(raw) };
  if (typeof raw !== "string") return { ok: false, reason: `expected text, got ${typeof raw}` };
  let text = raw.normalize("NFKC").trim();
  for (let i = 0; i < 3; i += 1) {
    const unquoted = text.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "").trim();
    const unpunctuated = unquoted.replace(/[.;:!,]+$/, "").trim();
    if (unpunctuated === text) break;
    text = unpunctuated;
  }
  text = text.replace(/\s+/g, " ").toLowerCase();
  return text ? { ok: true, value: text } : { ok: true, value: null };
}
