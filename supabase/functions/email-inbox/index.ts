// ============================================================================
// email-inbox — Supabase Edge Function
//
// Receives a forwarded transaction email from an inbound-email provider
// (SendGrid Inbound Parse, Mailgun routes, Cloudflare Email Workers, …),
// parses the amount / merchant / date out of it, resolves which signed-up user
// it belongs to, and inserts one PENDING row into `expense_email_inbox`.
//
// The Expense manager's "Inbox" tab then lists that row for the user to
// categorise. Categorising it writes a real expense_records row and flips this
// row to status='filed', which drops it out of the inbox view.
//
// ── Deploy ──────────────────────────────────────────────────────────────────
//   supabase functions deploy email-inbox --no-verify-jwt
//   supabase secrets set INBOUND_EMAIL_SECRET=<a-long-random-string>
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//
// ── Point your inbound-email provider at it ─────────────────────────────────
//   https://<project-ref>.functions.supabase.co/email-inbox?secret=<secret>
// The user forwards / auto-forwards their bank & card alert emails there; the
// sender address on the forwarded mail must match their WealthFolio login
// email so we can attribute the row to the right account.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INBOUND_SECRET = Deno.env.get("INBOUND_EMAIL_SECRET") || "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Extract a single email address from a "Name <addr@x>" style header ───────
function extractEmail(raw: string): string {
  if (!raw) return "";
  const m = raw.match(/<([^>]+)>/) || raw.match(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/);
  const addr = m ? (m[1] || m[0]) : raw;
  return addr.trim().toLowerCase();
}

// ── Best-effort amount parse. Handles ₹, Rs, INR, $, commas and decimals. ────
function parseAmount(text: string): number | null {
  if (!text) return null;
  // Prefer amounts that sit next to a currency marker.
  const cur = text.match(
    /(?:₹|rs\.?|inr|usd|\$)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
  );
  const any = cur || text.match(/\b([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?)\b/);
  if (!any) return null;
  const n = Number(any[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Guess the merchant / payee from common bank-alert phrasings, else subject.
function parseMerchant(text: string, subject: string): string {
  if (text) {
    const patterns = [
      /(?:at|to|towards|paid to|spent at|in favour of)\s+([A-Z0-9][A-Za-z0-9 &._'-]{2,40})/,
      // "…for BATA INDIA on Aug 30…" — stop before a trailing " on <date>" or
      // punctuation so we don't swallow the date into the merchant name.
      /\bfor\s+([A-Z0-9][A-Za-z0-9 &._'-]{2,40}?)(?=\s+on\b|\s+dated\b|[.,;]|\s*$)/,
      /(?:info|desc|narration)[:\-]\s*([A-Za-z0-9 &._'-]{2,40})/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1].trim().replace(/\s+/g, " ").slice(0, 60);
    }
  }
  return (subject || "").trim().slice(0, 80);
}

// ── Credited / received → income; otherwise expense. ─────────────────────────
function guessType(text: string): "expense" | "income" {
  return /\b(credited|received|refund|deposit|salary|cashback)\b/i.test(text || "")
    ? "income"
    : "expense";
}

// ── Find a yyyy-mm-dd / dd-mm-yyyy / dd Mon yyyy date, else null. ─────────────
function parseDate(text: string): string | null {
  if (!text) return null;
  let m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (m) {
    const yr = m[3].length === 2 ? "20" + m[3] : m[3];
    const dd = m[1].padStart(2, "0"), mo = m[2].padStart(2, "0");
    if (Number(mo) <= 12) return `${yr}-${mo}-${dd}`;
  }
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  // "30 Aug 2026" (day-first)
  m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})\b/);
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

// ── Pull the email fields out of whatever the provider POSTed. ───────────────
// Supports multipart/form-data (SendGrid, Mailgun) and JSON payloads.
//
// `owner` is an OPTIONAL explicit account email used for attribution. A
// provider that forwards raw mail leaves it blank and we attribute by sender.
// A trusted bridge that runs AS the user — e.g. the Gmail Apps Script — sets it
// to that user's login email, because there the sender is the bank, not them.
async function readEmail(req: Request): Promise<{
  from: string; owner: string; subject: string; text: string;
}> {
  const ctype = req.headers.get("content-type") || "";
  if (ctype.includes("application/json")) {
    const j = await req.json();
    return {
      from: j.from || j.sender || j.From || "",
      owner: j.owner || j.account_email || j.accountEmail || "",
      subject: j.subject || j.Subject || "",
      text: j.text || j["body-plain"] || j.plain || j.html || j.body || "",
    };
  }
  // form-data / urlencoded
  const form = await req.formData();
  const g = (k: string) => (form.get(k) ? String(form.get(k)) : "");
  return {
    from: g("from") || g("sender") || g("From"),
    owner: g("owner") || g("account_email"),
    subject: g("subject") || g("Subject"),
    text: g("text") || g("body-plain") || g("stripped-text") || g("html") || g("body-html"),
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  // Shared-secret gate: accept it as ?secret= or an x-inbound-secret header.
  const url = new URL(req.url);
  const supplied = url.searchParams.get("secret") ||
    req.headers.get("x-inbound-secret") || "";
  if (!INBOUND_SECRET || supplied !== INBOUND_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let email;
  try {
    email = await readEmail(req);
  } catch (_e) {
    return new Response("Bad payload", { status: 400 });
  }

  const fromAddr = extractEmail(email.from);
  // Attribution address: the explicit owner (trusted bridge) if given, else the
  // sender. The real sender is still stored in from_email for context.
  const ownerAddr = extractEmail(email.owner) || fromAddr;
  if (!ownerAddr) return new Response("No sender", { status: 422 });

  // Attribute the email to the WealthFolio user whose login address matches the
  // attribution address. Paginate defensively for larger user tables.
  let userId: string | null = null;
  for (let page = 1; page <= 20 && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return new Response("User lookup failed", { status: 500 });
    const hit = data.users.find(
      (u) => (u.email || "").toLowerCase() === ownerAddr,
    );
    if (hit) userId = hit.id;
    if (data.users.length < 200) break;
  }
  if (!userId) {
    // Not a known user — accept quietly so the provider doesn't retry forever.
    return new Response(JSON.stringify({ ok: true, skipped: "unknown_sender" }), {
      status: 202, headers: { "content-type": "application/json" },
    });
  }

  const blob = `${email.subject}\n${email.text}`;
  const row = {
    user_id: userId,
    from_email: fromAddr,
    subject: email.subject.slice(0, 300),
    body_snippet: (email.text || "").replace(/\s+/g, " ").trim().slice(0, 1000),
    amount: parseAmount(blob),
    merchant: parseMerchant(email.text, email.subject),
    txn_date: parseDate(blob),
    suggested_type: guessType(blob),
    status: "pending",
  };

  const { error } = await admin.from("expense_email_inbox").insert(row);
  if (error) return new Response("Insert failed: " + error.message, { status: 500 });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { "content-type": "application/json" },
  });
});
