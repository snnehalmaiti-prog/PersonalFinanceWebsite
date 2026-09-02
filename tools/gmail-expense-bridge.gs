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
 * Bank/card alerts are forwarded to kosha120392@gmail.com (the READING inbox).
 * Install this script THERE. Your Kosha LOGIN is a DIFFERENT account,
 * maitisnnehal@gmail.com, so the script files rows to the login account by
 * setting OWNER_EMAIL to it (see CONFIG). The reading account and the login
 * account are not the same here — that is why OWNER_EMAIL must be filled in.
 *
 * ── One-time setup ─────────────────────────────────────────────────────────
 * 1. In kosha120392@gmail.com (the READING inbox), LABEL your forwarded alerts.
 *    Gmail → Settings → Filters and Blocked Addresses → Create a new filter that
 *    matches your bank/card alerts (by from:, or subject keywords like
 *    "debited"/"spent"), tick "Apply the label" → create a label named
 *    "Expenses". Because this reads by that label, it works no matter which
 *    account forwarded the mail and ignores everything else. (Tip: also tick
 *    "Also apply to matching conversations" to label existing ones.)
 * 2. Open https://script.google.com  signed in as kosha120392@gmail.com (the
 *    READING inbox). New project, paste this file.
 * 3. Fill in the CONFIG block below:
 *      FUNCTION_URL   your project's function URL
 *      INBOUND_SECRET the INBOUND_EMAIL_SECRET you set on the Edge Function
 *      OWNER_EMAIL    your Kosha LOGIN, "maitisnnehal@gmail.com" — different from
 *                     this reading account, so it MUST be set (already filled in).
 *      SEARCH_QUERY   leave as 'label:Expenses' to read the label from step 1
 * 4. Run `installTrigger` once (authorise it when prompted). It schedules
 *    `syncExpenses` to run every 30 minutes.
 * 5. Optional: run `syncExpenses` once by hand to backfill and verify.
 *
 * Nothing here stores your data anywhere except the Kosha inbox row it creates;
 * processed emails are marked with a Gmail label so they are never sent twice.
 * ============================================================================
 */

var CONFIG = {
  // Live Kosha Edge Function URL. The function is deployed under the name
  // `smart-handler` (not `email-inbox`), so the path ends in /smart-handler.
  FUNCTION_URL: "https://jotirmhoohsquqvungrm.supabase.co/functions/v1/smart-handler",

  // The INBOUND_EMAIL_SECRET set on the Edge Function (Supabase → Edge
  // Functions → Secrets). Must match exactly.
  INBOUND_SECRET: "6641219bbb2c7ff830c40f1aa75e2399aa1d35d2b7e6f03f",

  // Your Kosha LOGIN email, for attribution. This script runs in the READING
  // account (kosha120392@gmail.com) but files rows to your LOGIN account, so
  // this MUST be set to the login address — they are different accounts here.
  OWNER_EMAIL: "maitisnnehal@gmail.com",

  // Which emails to read. We select by a Gmail LABEL you apply to your
  // forwarded alerts (see setup step 1) rather than by keywords, so it works no
  // matter which account forwarded them and ignores all unrelated mail. The
  // "already-sent" label exclusion is added automatically below.
  //   Keyword alternative (no label needed):
  //     'newer_than:30d (subject:(debited OR spent OR "you paid" OR purchase) '
  //       + 'OR "has been debited" OR "was debited")'
  SEARCH_QUERY: 'label:Expenses',

  // Applied to every processed thread so it is never re-sent.
  PROCESSED_LABEL: "Kosha/Sent",

  // Safety cap per run, so a first backfill can't hit the 6-minute limit.
  MAX_PER_RUN: 60,

  // Skip anything that looks like money IN — expenses only.
  INCOME_RE: /\b(credited|refund|deposit|salary|cashback|received|reversal)\b/i,

  // ── Monitoring ─────────────────────────────────────────────────────────────
  // Where to send alerts / the daily heartbeat. Set to the address you actually
  // read — the script runs in the kosha120392 reader inbox, so alerts go to your
  // main login instead. Leave "" to use the account the script runs in.
  ALERT_EMAIL: "maitisnnehal@gmail.com",
  // Email you immediately whenever a run has failures (a POST was rejected).
  ALERT_ON_FAILURE: true,
  // Email you ONE summary per day even when all is well, so silence never hides
  // a broken trigger. Set false to only ever hear about failures.
  DAILY_HEARTBEAT: true,
};

/** Schedule syncExpenses to run every 30 minutes. Run this ONCE. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "syncExpenses") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncExpenses").timeBased().everyMinutes(30).create();
  Logger.log("Trigger installed: syncExpenses every 30 minutes.");
}

/** Main pass: find new alert emails and push each to the Edge Function. */
function syncExpenses() {
  if (!CONFIG.FUNCTION_URL || CONFIG.INBOUND_SECRET.indexOf("PUT-YOUR") === 0) {
    throw new Error("Fill in FUNCTION_URL and INBOUND_SECRET in CONFIG first.");
  }
  var owner = CONFIG.OWNER_EMAIL || Session.getActiveUser().getEmail() || "";
  var label = getOrCreateLabel_(CONFIG.PROCESSED_LABEL);

  // Dedup at the MESSAGE level, not the thread level. Gmail threads messages by
  // subject, and every bank alert shares one subject ("A payment was made using
  // your Credit Card"), so they collapse into a single thread. A thread-label
  // exclusion would skip every alert after the first. Instead we remember each
  // sent message's own Gmail id and skip only those.
  var sentIds = loadSentIds_();
  var query = CONFIG.SEARCH_QUERY;               // no -label: exclusion
  var threads = GmailApp.search(query, 0, 100);
  var sent = 0, skipped = 0, failed = 0, seen = 0;

  for (var i = 0; i < threads.length && sent < CONFIG.MAX_PER_RUN; i++) {
    var thread = threads[i];
    var msgs = thread.getMessages();
    var anySent = false;
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      var id = msg.getId();
      if (sentIds[id]) { seen++; continue; }      // already pushed this message

      var subject = msg.getSubject() || "";
      var body = msg.getPlainBody() || "";
      var blob = subject + "\n" + body;

      // Expenses only: drop money-in alerts.
      if (CONFIG.INCOME_RE.test(blob)) { sentIds[id] = 1; skipped++; continue; }

      var ok = postEmail_({
        from: msg.getFrom() || "",
        owner: owner,
        subject: subject,
        text: body.slice(0, 8000),
      });
      if (ok) { sentIds[id] = 1; sent++; anySent = true; } else { failed++; }
      if (sent >= CONFIG.MAX_PER_RUN) break;
    }
    // Label the thread as a visual "handled" marker (not used for exclusion).
    if (anySent) thread.addLabel(label);
  }

  saveSentIds_(sentIds);
  var summary = Utilities.formatString(
    "sent=%s already=%s skipped(income)=%s failed=%s owner=%s",
    sent, seen, skipped, failed, owner);
  Logger.log("syncExpenses: " + summary);
  notify_(sent, failed, summary);
}

// ── Monitoring: surface failures and a once-a-day heartbeat by email ──────────
// A silent trigger (quota hit, auth revoked, deploy broke) is the worst failure
// because nothing tells you. This makes the pipeline speak up: an email the
// moment a POST fails, and one "still running" email a day even when quiet.
function notify_(sent, failed, summary) {
  try {
    var to = CONFIG.ALERT_EMAIL || Session.getActiveUser().getEmail();
    if (!to) return;
    var props = PropertiesService.getScriptProperties();

    if (failed > 0 && CONFIG.ALERT_ON_FAILURE) {
      MailApp.sendEmail(to, "⚠️ Kosha expense bridge: " + failed + " failed",
        "A syncExpenses run could not post " + failed + " alert(s) to Kosha.\n\n" +
        summary + "\n\nCheck the Apps Script execution log for the HTTP error " +
        "(often a changed secret or a redeployed function URL).");
    }

    if (CONFIG.DAILY_HEARTBEAT) {
      var today = Utilities.formatDate(new Date(),
        Session.getScriptTimeZone(), "yyyy-MM-dd");
      if (props.getProperty("koshaHeartbeatDate") !== today) {
        props.setProperty("koshaHeartbeatDate", today);
        MailApp.sendEmail(to, "✅ Kosha expense bridge — daily heartbeat",
          "The Gmail → Pending Transactions bridge ran today.\n\n" +
          "Most recent run: " + summary + "\n\n" +
          "You get this once a day so a silent/broken trigger can't hide. " +
          "Reply-to-self and ignore otherwise.");
      }
    }
  } catch (e) {
    Logger.log("notify_ error: %s", e);   // never let alerting break the sync
  }
}

// ── Remember which individual messages we've already pushed ──────────────────
// Stored as a JSON map of Gmail messageId -> 1 in Script Properties, capped so
// it can't grow without bound (oldest ids are dropped first).
var _SENT_KEY = "koshaSentMsgIds";
var _SENT_CAP = 800;

function loadSentIds_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(_SENT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}
function saveSentIds_(map) {
  var ids = Object.keys(map);
  if (ids.length > _SENT_CAP) {           // keep the most recent _SENT_CAP ids
    var trimmed = {};
    ids.slice(ids.length - _SENT_CAP).forEach(function (k) { trimmed[k] = 1; });
    map = trimmed;
  }
  PropertiesService.getScriptProperties().setProperty(_SENT_KEY, JSON.stringify(map));
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
