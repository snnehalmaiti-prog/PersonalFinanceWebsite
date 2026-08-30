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
// Pure parsing helpers live in their own module so the same code is covered by
// the Node test suite (tools/parser-tests.mjs). Keep BOTH files in the deployed
// function — see parsers.mjs header for the two-file deploy note.
import {
  extractEmail, parseAmount, parseMerchant, parseSource, guessType, parseDate, cleanBody,
} from "./parsers.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INBOUND_SECRET = Deno.env.get("INBOUND_EMAIL_SECRET") || "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

  // Parse from the CLEANED body, not the raw email: forwarding headers and
  // tracking URLs carry stray numbers (times, ids) that otherwise get picked up
  // as the amount. Cleaning first leaves just the real alert text.
  const cleaned = cleanBody(email.text || "");
  const blob = `${email.subject}\n${cleaned}`;
  const row = {
    user_id: userId,
    from_email: fromAddr,
    subject: email.subject.slice(0, 300),
    body_snippet: cleaned.slice(0, 4000),
    amount: parseAmount(blob),
    merchant: parseMerchant(cleaned, email.subject),
    txn_date: parseDate(blob),
    suggested_type: guessType(blob),
    source_account: parseSource(blob),
    status: "pending",
    // Signature of this alert — a re-post of the identical email produces the
    // same key and is ignored by the unique (user_id, dedupe_key) index.
    dedupe_key: `${parseAmount(blob) ?? ""}|${parseDate(blob) ?? ""}|${cleaned.slice(0, 200)}`,
  };

  const { error } = await admin.from("expense_email_inbox")
    .upsert(row, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
  if (error) return new Response("Insert failed: " + error.message, { status: 500 });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { "content-type": "application/json" },
  });
});
