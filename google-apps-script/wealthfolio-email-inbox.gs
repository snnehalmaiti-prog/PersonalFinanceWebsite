/**
 * WealthFolio — Gmail → Expense inbox bridge
 * ------------------------------------------------------------------
 * Runs inside YOUR Gmail account (Google Apps Script) and forwards
 * transaction emails to the `email-inbox` Supabase Edge Function, which parses
 * them into pending expenses in the WealthFolio Expense → Inbox tab.
 *
 * This is the "use Gmail as the mailbox" path: no domain, no MX records, no
 * inbound-email provider. Gmail can't call a webhook on its own, so this script
 * polls on a timer and does the POST.
 *
 * ── Setup ─────────────────────────────────────────────────────────────────
 * 1. In Gmail, make a filter that labels your bank/card/UPI alert emails with
 *    a label — e.g. "Expenses". (Settings → Filters → Create filter.)
 * 2. Go to https://script.google.com → New project → paste this file.
 * 3. Fill in the three CONFIG values below.
 * 4. Run `setup()` once (grant the Gmail permission it asks for). That installs
 *    a time trigger so `processInbox()` runs every 10 minutes.
 * 5. New labelled emails now show up in the WealthFolio Inbox tab within ~10m.
 *
 * Processed threads get a second label ("WF-Filed") as a visual marker only.
 * Duplicates are prevented on the SERVER (the Edge Function ignores re-posts of
 * the same email), not by that label — so an alert that Gmail groups into an
 * already-marked thread is still forwarded. Nothing is deleted from your Gmail.
 */

// ── CONFIG ────────────────────────────────────────────────────────────────
var FUNCTION_URL = "https://<project-ref>.functions.supabase.co/email-inbox";
var INBOUND_SECRET = "<the INBOUND_EMAIL_SECRET you set on the function>";
var SOURCE_LABEL = "Expenses";   // Gmail label your transaction emails carry
// The email the inbox rows are attributed to — MUST equal your WealthFolio login
// email. Leave "" to use the Google account this script runs under; set it
// explicitly when the mailbox that receives the alerts is a DIFFERENT account
// from your WealthFolio login (otherwise every email is skipped as
// "unknown_sender" and never reaches the Inbox).
var OWNER_EMAIL = "";
// ──────────────────────────────────────────────────────────────────────────

var DONE_LABEL = "WF-Filed";     // added after a message is forwarded

function setup() {
  // Remove any existing triggers for this function, then add a fresh one.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "processInbox") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("processInbox").timeBased().everyMinutes(10).create();
  // Make sure the done-label exists.
  if (!GmailApp.getUserLabelByName(DONE_LABEL)) GmailApp.createLabel(DONE_LABEL);
  Logger.log("Setup complete. processInbox() will run every 10 minutes.");
}

// How far back each run looks. Gmail labels are per-THREAD, and bank/UPI alerts
// share identical subjects ("You have done a UPI txn. Check details!"), so Gmail
// groups them into one conversation. A per-thread "done" label would therefore
// hide every later alert that lands in an already-handled thread — which is why
// new transactions silently stopped appearing. So we do NOT exclude by the done
// label; we sweep the last few days of labelled mail and POST every message.
//
// Re-posting is safe: the Edge Function upserts with ignoreDuplicates on a
// unique (user_id, dedupe_key), so an email that was already filed is a no-op.
// The window bounds how many messages a run re-POSTs (quota), and must comfortably
// exceed the trigger interval plus any pause; 3 days covers a long weekend of the
// script being disabled without missing mail.
var LOOKBACK = "newer_than:3d";

function processInbox() {
  // Attribution email: the explicit OWNER_EMAIL when set (mailbox account differs
  // from the WealthFolio login), else the account this script runs under.
  var owner = OWNER_EMAIL || Session.getActiveUser().getEmail();
  var done = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);

  // Recent labelled mail — NOT filtered by the done label (see LOOKBACK above).
  var query = 'label:' + SOURCE_LABEL.replace(/\s+/g, "-") + ' ' + LOOKBACK;
  var threads = GmailApp.search(query, 0, 50);

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      try {
        var payload = {
          owner: owner,
          from: msg.getFrom(),
          subject: msg.getSubject(),
          text: msg.getPlainBody(),
        };
        var res = UrlFetchApp.fetch(FUNCTION_URL + "?secret=" + encodeURIComponent(INBOUND_SECRET), {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        });
        var code = res.getResponseCode();
        if (code < 200 || code >= 300) {
          Logger.log("POST failed (" + code + "): " + res.getContentText());
          return;
        }
      } catch (e) {
        Logger.log("Error forwarding message: " + e);
        return;
      }
    });
    // A visual marker only — you can see at a glance which threads were swept.
    // It is deliberately NOT used to skip threads on the next run (see above).
    thread.addLabel(done);
  });
}
