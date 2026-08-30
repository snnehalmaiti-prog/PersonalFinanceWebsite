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
