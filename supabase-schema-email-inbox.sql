-- ============================================================================
-- Email → Expense inbox schema — run in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query). Safe to re-run: IF NOT EXISTS guards.
--
-- Pairs with the `email-inbox` Edge Function, which receives forwarded
-- transaction emails, parses the amount / merchant / date out of them, and
-- inserts one PENDING row here per email. The Expense manager's "Inbox" tab
-- lists the pending rows; categorising one files it as a real expense_records
-- row and flips its status to 'filed', which removes it from the inbox view.
-- ============================================================================

CREATE TABLE IF NOT EXISTS expense_email_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  received_at timestamptz DEFAULT now(),   -- when the email arrived
  from_email text DEFAULT '',              -- sender / envelope from
  subject text DEFAULT '',                 -- email subject line
  body_snippet text DEFAULT '',            -- trimmed plain-text body (for context)
  amount numeric,                          -- parsed amount (NULL if not found)
  merchant text DEFAULT '',                -- parsed merchant / payee guess
  txn_date date,                           -- parsed transaction date (NULL → email date)
  suggested_type text DEFAULT 'expense',   -- expense | income (best guess)
  status text NOT NULL DEFAULT 'pending',  -- pending | filed | dismissed
  record_id uuid REFERENCES expense_records(id) ON DELETE SET NULL, -- set once filed
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_email_inbox_user_status
  ON expense_email_inbox(user_id, status, received_at DESC);

-- ── Row Level Security: each user sees only their own rows ──────────────────
-- The Edge Function writes with the service-role key, which bypasses RLS, so it
-- can insert rows on a user's behalf. These policies govern the browser client,
-- which only ever reads / updates / deletes its own rows.
ALTER TABLE expense_email_inbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_select" ON expense_email_inbox;
DROP POLICY IF EXISTS "own_insert" ON expense_email_inbox;
DROP POLICY IF EXISTS "own_update" ON expense_email_inbox;
DROP POLICY IF EXISTS "own_delete" ON expense_email_inbox;
CREATE POLICY "own_select" ON expense_email_inbox FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own_insert" ON expense_email_inbox FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_update" ON expense_email_inbox FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_delete" ON expense_email_inbox FOR DELETE USING (auth.uid() = user_id);
