// ============================================================================
// email-inbox / smart-handler — Supabase Edge Function (single-file deploy)
// Receives a forwarded transaction email as JSON {from, owner, subject, text},
// parses amount + date (the only fields we rely on), stores the full body, and
// inserts one PENDING row into expense_email_inbox for the matching user.
// Deploy with Verify JWT OFF. Secret is read from INBOUND_EMAIL_SECRET.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INBOUND_SECRET = Deno.env.get("INBOUND_EMAIL_SECRET") || "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function extractEmail(raw: string): string {
  if (!raw) return "";
  const m = raw.match(/<([^>]+)>/) || raw.match(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/);
  const addr = m ? (m[1] || m[0]) : raw;
  return addr.trim().toLowerCase();
}

function parseAmount(text: string): number | null {
  if (!text) return null;
  const cur = text.match(/(?:₹|rs\.?|inr|usd|\$)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  const any = cur || text.match(/\b([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?)\b/);
  if (!any) return null;
  const n = Number(any[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseMerchant(text: string, subject: string): string {
  if (text) {
    const patterns = [
      /(?:towards|paid to|spent at|in favour of|to|at)\s+([A-Z0-9][A-Za-z0-9 &._'-]{2,40}?)(?=\s+on\b|\s+dated\b|\s+for\b|[,;@]|\.(?=\s|$)|\s*$)/,
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

function parseSource(text: string): string {
  if (!text) return "";
  let m = text.match(/\b(?:credit|debit)?\s*card\b[^0-9]{0,20}(\d{2,4})/i);
  if (m) return "Card **" + m[1].slice(-2);
  m = text.match(/\b(?:account|a\/c|acct)\b[^0-9]{0,15}(\d{2,4})/i);
  if (m) return "Account **" + m[1].slice(-2);
  return "";
}

function guessType(text: string): "expense" | "income" {
  return /\b(credited|received|refund|deposit|salary|cashback)\b/i.test(text || "")
    ? "income"
    : "expense";
}

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
  m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*,?\s+(\d{4})\b/);
  if (m && months[m[2].toLowerCase()]) {
    return `${m[3]}-${months[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  }
  m = text.match(/\b([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && months[m[1].toLowerCase()]) {
    return `${m[3]}-${months[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

// Strip forwarding headers and tracking URLs so we store only the real alert.
function cleanBody(s: string): string {
  if (!s) return "";
  return s
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
  const ownerAddr = extractEmail(email.owner) || fromAddr;
  if (!ownerAddr) return new Response("No sender", { status: 422 });

  let userId: string | null = null;
  for (let page = 1; page <= 20 && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return new Response("User lookup failed", { status: 500 });
    const hit = data.users.find((u) => (u.email || "").toLowerCase() === ownerAddr);
    if (hit) userId = hit.id;
    if (data.users.length < 200) break;
  }
  if (!userId) {
    return new Response(JSON.stringify({ ok: true, skipped: "unknown_sender" }), {
      status: 202, headers: { "content-type": "application/json" },
    });
  }

  const blob = `${email.subject}\n${email.text}`;
  const row = {
    user_id: userId,
    from_email: fromAddr,
    subject: email.subject.slice(0, 300),
    // Full readable body — the card shows it so the user reads merchant/account
    // off the email itself. Amount + date are the only parsed fields we rely on.
    body_snippet: cleanBody(email.text || "").slice(0, 4000),
    amount: parseAmount(blob),
    merchant: parseMerchant(email.text, email.subject),
    txn_date: parseDate(blob),
    suggested_type: guessType(blob),
    source_account: parseSource(blob),
    status: "pending",
  };

  const { error } = await admin.from("expense_email_inbox").insert(row);
  if (error) return new Response("Insert failed: " + error.message, { status: 500 });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { "content-type": "application/json" },
  });
});
