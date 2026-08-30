/**
 * Kosha — Gmail → Pending Transactions bridge (Google Apps Script)
 * ============================================================================
 * Reads spend/debit alert emails from the Gmail account this script runs in and
 * pushes each one to the Kosha `email-inbox` Supabase Edge Function, which
 * parses it and inserts a PENDING row into `expense_email_inbox`. Those rows
 * show up in the dashboard's "Pending Transactions" tab, where you categorise
 * each into a real expense record.
 *
 * This is the "trusted bridge that runs AS the user" the Edge Function's own
 * comments describe: it sets `owner` to your Kosha login email so the row is
 * filed to your account (the email's real sender is the bank, not you).
 *
 * EXPENSES ONLY: emails that look like income (credited / refund / salary /
 * cashback / deposit) are skipped, so only money-out alerts become pending
 * transactions.
 *
 * ── The mail flow ──────────────────────────────────────────────────────────
 * Bank/card alerts arrive at snnehalmaiti@gmail.com and are AUTO-FORWARDED to
 * maitisnnehal@gmail.com. Install this script in maitisnnehal@gmail.com — the
 * inbox that RECEIVES the forwarded alerts, which is also your Kosha login — so
 * it reads them there and files them to your account. Because the script runs
 * in the same Gmail you log into Kosha with, OWNER_EMAIL can stay "".
 *
 * ── One-time setup ─────────────────────────────────────────────────────────
 * 1. Open https://script.google.com  signed in as maitisnnehal@gmail.com (the
 *    forwarding destination + your Kosha login). New project, paste this file.
 * 2. Fill in the CONFIG block below:
 *      FUNCTION_URL   your project's function URL
 *      INBOUND_SECRET the INBOUND_EMAIL_SECRET you set on the Edge Function
 *      OWNER_EMAIL    leave "" — the active account (maitisnnehal@gmail.com) is
 *                     your Kosha login, which is exactly the attribution address
 *                     the Edge Function needs. Only set it if you ever run this
 *                     script from a DIFFERENT Gmail than you log into Kosha with.
 *      SEARCH_QUERY   the Gmail search that selects your bank/card alerts
 * 3. Run `installTrigger` once (authorise it when prompted). It schedules
 *    `syncExpenses` to run every 15 minutes.
 * 4. Optional: run `syncExpenses` once by hand to backfill and verify.
 *
 * Nothing here stores your data anywhere except the Kosha inbox row it creates;
 * processed emails are marked with a Gmail label so they are never sent twice.
 * ============================================================================
 */

var CONFIG = {
  // https://<project-ref>.functions.supabase.co/email-inbox
  FUNCTION_URL: "https://jotirmhoohsquqvungrm.functions.supabase.co/email-inbox",

  // The shared secret you set with:  supabase secrets set INBOUND_EMAIL_SECRET=...
  INBOUND_SECRET: "PUT-YOUR-INBOUND-EMAIL-SECRET-HERE",

  // Your Kosha LOGIN email, for attribution. Leave "" to use this Gmail
  // account's own address (correct when they are the same).
  OWNER_EMAIL: "",

  // Which emails are transaction alerts. Tune to your banks/cards. The label
  // exclusion (added automatically below) keeps already-sent mail out.
  //   Tips: add senders with  from:(alerts@yourbank.com OR cards@yourbank.com)
  SEARCH_QUERY:
    'newer_than:30d ' +
    '(subject:(debited OR spent OR "you paid" OR purchase OR transaction OR "debit alert") ' +
    'OR "has been debited" OR "spent on your" OR "was debited") ' +
    '-subject:(credited OR statement OR OTP OR e-statement OR newsletter)',

  // Applied to every processed thread so it is never re-sent.
  PROCESSED_LABEL: "Kosha/Sent",

  // Safety cap per run, so a first backfill can't hit the 6-minute limit.
  MAX_PER_RUN: 60,

  // Skip anything that looks like money IN — expenses only.
  INCOME_RE: /\b(credited|refund|deposit|salary|cashback|received|reversal)\b/i,
};

/** Schedule syncExpenses to run every 15 minutes. Run this ONCE. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "syncExpenses") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncExpenses").timeBased().everyMinutes(15).create();
  Logger.log("Trigger installed: syncExpenses every 15 minutes.");
}

/** Main pass: find new alert emails and push each to the Edge Function. */
function syncExpenses() {
  if (!CONFIG.FUNCTION_URL || CONFIG.INBOUND_SECRET.indexOf("PUT-YOUR") === 0) {
    throw new Error("Fill in FUNCTION_URL and INBOUND_SECRET in CONFIG first.");
  }
  var owner = CONFIG.OWNER_EMAIL || Session.getActiveUser().getEmail() || "";
  var label = getOrCreateLabel_(CONFIG.PROCESSED_LABEL);
  var query = CONFIG.SEARCH_QUERY + ' -label:"' + CONFIG.PROCESSED_LABEL + '"';

  var threads = GmailApp.search(query, 0, 100);
  var sent = 0, skipped = 0, failed = 0;

  for (var i = 0; i < threads.length && sent < CONFIG.MAX_PER_RUN; i++) {
    var thread = threads[i];
    var msgs = thread.getMessages();
    var anySent = false;
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      var subject = msg.getSubject() || "";
      var body = msg.getPlainBody() || "";
      var blob = subject + "\n" + body;

      // Expenses only: drop money-in alerts.
      if (CONFIG.INCOME_RE.test(blob)) { skipped++; continue; }

      var ok = postEmail_({
        from: msg.getFrom() || "",
        owner: owner,
        subject: subject,
        text: body.slice(0, 8000),
      });
      if (ok) { sent++; anySent = true; } else { failed++; }
      if (sent >= CONFIG.MAX_PER_RUN) break;
    }
    // Mark the whole thread processed once we've handled its messages, so the
    // next run's -label: exclusion skips it. (Bank alerts are one-per-thread.)
    if (anySent || msgs.length) thread.addLabel(label);
  }

  Logger.log("syncExpenses: sent=%s skipped(income)=%s failed=%s owner=%s",
    sent, skipped, failed, owner);
}

/** POST one email to the Edge Function. Returns true on 2xx. */
function postEmail_(payload) {
  try {
    var res = UrlFetchApp.fetch(
      CONFIG.FUNCTION_URL + "?secret=" + encodeURIComponent(CONFIG.INBOUND_SECRET),
      {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      }
    );
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return true;
    Logger.log("post failed (HTTP %s): %s", code, res.getContentText().slice(0, 200));
    return false;
  } catch (e) {
    Logger.log("post error: %s", e);
    return false;
  }
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
