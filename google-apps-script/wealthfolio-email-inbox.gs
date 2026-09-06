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
 * Processed emails get a second label ("WF-Filed") so they are never sent
 * twice. Nothing is deleted from your Gmail.
 */

// ── CONFIG ────────────────────────────────────────────────────────────────
var FUNCTION_URL = "https://<project-ref>.functions.supabase.co/email-inbox";
var INBOUND_SECRET = "<the INBOUND_EMAIL_SECRET you set on the function>";
var SOURCE_LABEL = "Expenses";   // Gmail label your transaction emails carry
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

function processInbox() {
  var owner = Session.getActiveUser().getEmail(); // your WealthFolio login email
  var done = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);

  // Unprocessed messages: carry the source label, not yet the done label.
  var query = 'label:' + SOURCE_LABEL.replace(/\s+/g, "-") + ' -label:' + DONE_LABEL;
  var threads = GmailApp.search(query, 0, 25);

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
          return; // leave unlabelled so the next run retries it
        }
      } catch (e) {
        Logger.log("Error forwarding message: " + e);
        return;
      }
    });
    thread.addLabel(done); // mark the whole thread handled
  });
}
