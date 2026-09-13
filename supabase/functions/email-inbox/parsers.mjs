// ============================================================================
// parsers.mjs — pure email-parsing helpers for the email-inbox Edge Function.
//
// Kept in a standalone module (no Deno/Supabase imports) so it is the SINGLE
// source of truth for parsing, importable by both:
//   • index.ts          — the deployed Edge Function (Deno imports this file)
//   • tools/parser-tests.mjs — the Node regression test suite
//
// When you add a new bank/card format, change the regex HERE and add a case to
// the test suite, then run `node tools/parser-tests.mjs` before redeploying.
//
// ── Deploying the function ───────────────────────────────────────────────────
// The function now has TWO files (index.ts + parsers.mjs). In the Supabase
// Edge Functions editor, create/paste BOTH files under the function, then
// Deploy. (If parsers.mjs is missing, the deploy fails loudly with an import
// error — a good, visible failure rather than a silent wrong parse.)
// ============================================================================

// Extract a single email address from a "Name <addr@x>" style header.
export function extractEmail(raw) {
  if (!raw) return "";
  const m = raw.match(/<([^>]+)>/) || raw.match(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/);
  const addr = m ? (m[1] || m[0]) : raw;
  return addr.trim().toLowerCase();
}

// Best-effort amount parse. Handles ₹, Rs, INR, $, commas and decimals.
export function parseAmount(text) {
  if (!text) return null;
  const cur = text.match(
    /(?:₹|rs\.?|inr|usd|\$)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
  );
  const any = cur || text.match(/\b([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?)\b/);
  if (!any) return null;
  const n = Number(any[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Guess the merchant / payee from common bank-alert phrasings, else subject.
export function parseMerchant(text, subject) {
  if (text) {
    const patterns = [
      // "…towards URBANCLAP on 05 Aug…", "…at BIGBAZAAR." — lazy match that stops
      // before a trailing " on/dated/for <date>", an "@" (UPI handle), or
      // punctuation, so the date/time never gets swallowed into the name.
      // Stop at " on/dated/for <date>", an "@" handle, a comma/semicolon, or a
      // sentence-ending period — but NOT a mid-word dot, so "NETFLIX.COM" stays.
      /(?:towards|paid to|spent at|in favour of|to|at)\s+([A-Z0-9][A-Za-z0-9 &._'-]{2,40}?)(?=\s+on\b|\s+dated\b|\s+for\b|[,;@]|\.(?=\s|$)|\s*$)/,
      // "…for BATA INDIA on Aug 30…"
      /\bfor\s+([A-Z0-9][A-Za-z0-9 &._'-]{2,40}?)(?=\s+on\b|\s+dated\b|[,;@]|\.(?=\s|$)|\s*$)/,
      /(?:info|desc|narration)[:\-]\s*([A-Za-z0-9 &._'-]{2,40})/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1].trim().replace(/\s+/g, " ").slice(0, 60);
    }
  }
  return (subject || "").trim().slice(0, 80);
}

// Which account / card the money came from, as "Account **37" / "Card **70".
// Banks mask all but the last few digits ("account 0037", "Credit Card ending
// 3370", "a/c XXXX1234"); we keep the last two for a short, safe note tag.
export function parseSource(text) {
  if (!text) return "";
  let m = text.match(/\b(?:credit|debit)?\s*card\b[^0-9]{0,20}(\d{2,4})/i);
  if (m) return "Card **" + m[1].slice(-2);
  m = text.match(/\b(?:account|a\/c|acct)\b[^0-9]{0,15}(\d{2,4})/i);
  if (m) return "Account **" + m[1].slice(-2);
  return "";
}

// Strip forwarding chrome (one or more "Forwarded message" header blocks) and
// click-tracking URLs, leaving just the real alert text for display/storage.
export function cleanBody(s) {
  if (!s) return "";
  return String(s)
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/-+\s*Forwarded message\s*-+/gi, " ")
    .replace(/From:[\s\S]*?To:\s*<[^>]*>/gi, " ")
    .replace(/^\s*(From|To|Date|Subject|Sent|Cc|Reply-To)\s*:.*$/gim, " ")
    .replace(/[<>]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// The UPI / bank transaction reference number, when the alert states one.
// Indian UPI alerts carry a unique reference — "UPI Ref No 123456789012",
// "UPI transaction reference number is 123…", "RRN: 123…", "Txn ID 123…". Two
// emails about the SAME payment share this number, so it is the strongest dedupe
// signal: keyed with the amount it collapses duplicate alerts for one payment
// while still telling genuinely different payments apart. Returns "" when the
// alert states no reference (then the caller falls back to a whole-body hash).
export function parseUpiRef(text) {
  if (!text) return "";
  const pats = [
    // "UPI Ref No 123…", "UPI transaction reference number is 123…", "UPI RRN 123…"
    /\bupi\s*(?:transaction\s*)?(?:ref(?:erence)?|rrn)\s*(?:no\.?|number|id|#)?\s*(?:is|[:=.#-])?\s*([A-Za-z0-9]{6,25})\b/i,
    // "RRN 123…" / "RRN: 123…"
    /\brrn\s*(?:no\.?|number|#)?\s*(?:is|[:=.#-])?\s*([0-9]{6,25})\b/i,
    // "Transaction ID 123…", "Txn Ref No 123…", "transaction reference 123…"
    /\b(?:transaction|txn)\s*(?:ref(?:erence)?\s*(?:no\.?|number)?|id|no\.?|number)\s*(?:is|[:=.#-])?\s*([A-Za-z0-9]{6,25})\b/i,
    // Generic "Reference No 123…" / "Ref #123…"
    /\bref(?:erence)?\s*(?:no\.?|number|#)\s*(?:is|[:=.#-])?\s*([A-Za-z0-9]{6,25})\b/i,
  ];
  for (const p of pats) {
    const m = text.match(p);
    // Require at least one digit: references are numeric-ish, so this rejects a
    // stray word ("reference number below") being read as the id.
    if (m && m[1] && /[0-9]/.test(m[1])) return m[1].toUpperCase();
  }
  return "";
}

// Credited / received → income; otherwise expense.
export function guessType(text) {
  return /\b(credited|received|refund|deposit|salary|cashback)\b/i.test(text || "")
    ? "income"
    : "expense";
}

// Find a yyyy-mm-dd / dd-mm-yyyy / dd Mon yyyy / Mon dd yyyy date, else null.
export function parseDate(text) {
  if (!text) return null;
  let m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (m) {
    const yr = m[3].length === 2 ? "20" + m[3] : m[3];
    const dd = m[1].padStart(2, "0"), mo = m[2].padStart(2, "0");
    if (Number(mo) <= 12) return `${yr}-${mo}-${dd}`;
  }
  const months = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  // "30 Aug 2026" / "05 Aug, 2026" (day-first, optional comma)
  m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*,?\s+(\d{4})\b/);
  if (m && months[m[2].toLowerCase()]) {
    return `${m[3]}-${months[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  }
  // "Aug 30, 2026" / "Aug 30 2026" (month-first, HDFC-style)
  m = text.match(/\b([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && months[m[1].toLowerCase()]) {
    return `${m[3]}-${months[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
  }
  return null;
}
