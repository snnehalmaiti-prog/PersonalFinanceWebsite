# Kosha — Hotmail → Pending Transactions bridge (read Hotmail directly)

Bank/card alerts are forwarded to **kosha12101@hotmail.com**. This bridge reads
that Hotmail inbox and POSTs each spend alert to the Kosha `smart-handler` Edge
Function, which parses it and inserts a PENDING row shown in the dashboard's
**Pending Transactions** tab.

Your Kosha login stays **maitisnnehal@gmail.com**, so every POST sets
`owner: "maitisnnehal@gmail.com"` — that is the attribution address the function
matches to file the row to your account. (The email's real sender is the bank.)

Two ways to run it. **Make.com is free; Power Automate's HTTP action is premium.**

---

## Option 1 — Make.com (free, recommended)

### One-time setup
1. Create a free account at https://www.make.com and click **Create a new scenario**.

2. **Module 1 — watch the inbox.** Add module **Email → Watch emails**.
   - Create an IMAP connection:
     - Host: `imap-mail.outlook.com`  Port: `993`  Security: **SSL/TLS**
     - Username: `kosha12101@hotmail.com`
     - Password: your Hotmail password, OR an **app password** if you have 2FA
       on (Microsoft account → Security → Advanced security → App passwords).
     - (In Hotmail, make sure **IMAP** is enabled: Settings → Mail → Sync email →
       POP and IMAP → let devices use IMAP.)
   - Folder: `INBOX`. Criteria: **Unseen** (unread) is simplest — the module then
     only picks up new mail. Max results: 20.

3. **Module 2 — filter to expenses only** (a Make *filter* on the connection
   between module 2 and 3, or a Router). Continue only when the email looks like
   money OUT and not money IN:
   - Condition: `Text content` (or Subject) **contains** any of
     `debited`, `spent`, `you paid`, `payment was made`, `UPI`
   - AND `Text content` **does not contain** any of
     `credited`, `refund`, `reversal`, `salary`, `cashback`

4. **Module 3 — POST to the function.** Add module **HTTP → Make a request**.
   - URL:
     `https://jotirmhoohsquqvungrm.supabase.co/functions/v1/smart-handler?secret=6641219bbb2c7ff830c40f1aa75e2399aa1d35d2b7e6f03f`
   - Method: **POST**
   - Headers: `Content-Type: application/json`
   - Body type: **Raw** / JSON. Body (map the `{{...}}` from Module 1's output):
     ```json
     {
       "from":    "{{Module1.Sender.Email address}}",
       "owner":   "maitisnnehal@gmail.com",
       "subject": "{{Module1.Subject}}",
       "text":    "{{Module1.Text content}}"
     }
     ```
   - Parse response: no.

5. **Schedule.** Bottom-left clock → run every **15 minutes** (free tier minimum),
   then toggle the scenario **ON**.

### Notes
- Idempotency is handled server-side: the function's dedup guard ignores a
  re-posted identical alert, so no duplicate cards even if Make re-reads a mail.
- If a POST returns 200 with `{"skipped":"unknown_sender"}`, the `owner` didn't
  match a Kosha user — check it is exactly your login email.

---

## Option 2 — Power Automate (needs a Premium license)

Same flow, Microsoft-native:
1. Trigger: **When a new email arrives (V3)** (Outlook.com), folder Inbox.
2. Condition: subject/body contains a debit keyword AND not an income keyword.
3. Action: **HTTP** (⚠ premium) → POST to the URL above with the JSON body:
   `{ "from": <From>, "owner": "maitisnnehal@gmail.com", "subject": <Subject>, "text": <Body> }`
The HTTP action requires a paid Power Automate plan, which is why Make.com is
recommended for a personal account.
