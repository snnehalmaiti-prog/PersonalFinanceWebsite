# Email → Expense inbox

Turn transaction emails (bank debit alerts, card statements, UPI receipts) into
pending expenses you categorise with one tap. Categorised items are saved as
real records and disappear from the inbox.

## How it works

```
 bank / card alert email in your inbox
        │
        │  Path A: a Gmail Apps Script reads your labelled mail
        │  Path B: you forward it to an inbound-email provider
        ▼
 bridge / provider  ──POST──▶  Supabase Edge Function `email-inbox`
                                     │  parses amount, merchant, date
                                     │  matches you → your user account
                                     ▼
                          expense_email_inbox  (status = 'pending')
                                     │
                                     ▼
              Expense manager → "Inbox" tab lists pending items
                                     │  Categorise → pick category & save
                                     ▼
              expense_records row created; inbox row → status 'filed'
                                     (drops out of the list)
```

Everything the browser does is scoped by Supabase Row Level Security, so you
only ever see your own inbox rows.

## One-time setup

### 1. Create the table

Run [`supabase-schema-email-inbox.sql`](../supabase-schema-email-inbox.sql) in
the Supabase SQL Editor (Dashboard → SQL Editor → New query). Safe to re-run.

### 2. Deploy the Edge Function

```bash
supabase functions deploy email-inbox --no-verify-jwt
supabase secrets set INBOUND_EMAIL_SECRET=<a-long-random-string>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically. The
function needs the service-role key because it inserts rows on a user's behalf.

Its public URL is:

```
https://<project-ref>.functions.supabase.co/email-inbox?secret=<INBOUND_EMAIL_SECRET>
```

### 3. Choose how emails reach the function

You have two paths. **Pick one.**

#### Path A — Gmail as the mailbox (no domain needed) ⭐ simplest

Use a Google Apps Script that runs inside your own Gmail account, finds your
transaction emails, and POSTs them to the function. No domain, no MX records, no
inbound-email provider.

1. In Gmail, create a filter that applies a label (e.g. **Expenses**) to your
   bank / card / UPI alert emails. (Settings → Filters and Blocked Addresses →
   Create a new filter.)
2. Open <https://script.google.com> → **New project** → paste
   [`google-apps-script/wealthfolio-email-inbox.gs`](../google-apps-script/wealthfolio-email-inbox.gs).
3. Fill in `FUNCTION_URL`, `INBOUND_SECRET`, and `SOURCE_LABEL` at the top.
4. Run `setup()` once and grant the Gmail permission. It installs a trigger that
   runs every 10 minutes.

The script sends your Gmail address as the `owner` field, so the function
attributes each email to your account even though the *sender* is your bank.
Processed emails get a `WF-Filed` label so they're never sent twice; nothing is
deleted. **With this path you do not need step 4 below** — you're not forwarding,
the script reads your labelled mail directly.

#### Path B — an inbound-email provider (needs a domain)

Use any service that turns received email into an HTTP webhook:

- **SendGrid Inbound Parse** — set the POST URL to the function URL.
- **Mailgun Routes** — action `forward("<function URL>")`.
- **Cloudflare Email Workers** — `fetch()` the function URL with the parsed mail.

The function accepts both multipart/form-data (SendGrid, Mailgun) and JSON.

### 4. Forward your transaction emails there (Path B only)

Give the provider an address (e.g. `receipts@yourdomain.com`) and forward — or
set a Gmail/Outlook auto-forward filter for — your bank and card alert emails to
it.

> **Important:** the forwarded email's **sender address must be your WealthFolio
> login email**, because that is how the function decides which account the
> expense belongs to. Gmail/Outlook auto-forwarding preserves your address as
> the sender, so this works out of the box. Emails from an unknown sender are
> accepted and quietly ignored.

## Using it

1. Open **Expense → Inbox**. Pending items show the parsed amount, merchant,
   date and a badge count on the tab.
2. Tap **Categorise** on an item — the Add-record modal opens prefilled with the
   amount, date and description. Pick the category (and account / payment type),
   then **Add Record**.
3. The record is saved and the item leaves the inbox.
4. **Dismiss** removes an item without creating a record (e.g. a duplicate alert
   or a non-expense email).

## Parsing notes

The function is best-effort. It recognises ₹ / Rs / INR / $ amounts, common
"paid to / at / towards <merchant>" phrasings, and several date formats; missing
fields are left blank for you to fill in when categorising. "credited /
received / refund / salary / cashback" is guessed as income, everything else as
an expense. You always confirm the final values before the record is saved.
