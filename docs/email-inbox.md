# Email → Expense inbox

Turn transaction emails (bank debit alerts, card statements, UPI receipts) into
pending expenses you categorise with one tap. Categorised items are saved as
real records and disappear from the inbox.

## How it works

```
 bank / card alert email
        │  (you forward or auto-forward it)
        ▼
 inbound-email provider  ──POST──▶  Supabase Edge Function `email-inbox`
 (SendGrid / Mailgun / …)            │  parses amount, merchant, date
                                     │  matches sender → your user account
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

### 3. Point an inbound-email provider at that URL

Use any service that turns received email into an HTTP webhook:

- **SendGrid Inbound Parse** — set the POST URL to the function URL.
- **Mailgun Routes** — action `forward("<function URL>")`.
- **Cloudflare Email Workers** — `fetch()` the function URL with the parsed mail.

The function accepts both multipart/form-data (SendGrid, Mailgun) and JSON.

### 4. Forward your transaction emails there

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
