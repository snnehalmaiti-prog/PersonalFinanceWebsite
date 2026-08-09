-- Net-worth snapshots — paste this whole file into the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → Run). Nothing else needs to change.
--
-- Safe to run more than once: the table uses IF NOT EXISTS and each policy is
-- dropped before it is created, so a second run is a no-op rather than the
-- "policy already exists" error you get from re-running supabase-schema.sql.
--
-- This is the same content as the net_worth_snapshots block at the end of
-- supabase-schema.sql, which stays the full record of the schema.

-- A RECORD of what the portfolio was worth on a date, as opposed to the Account
-- Value chart, which is recomputed from the sheets on every load. That is the
-- point of the table: editing a 2019 transaction rewrites a derivation, but must
-- not rewrite a record.
--
-- One row per (user, local calendar date), upserted — opening the dashboard five
-- times in a day updates today's row rather than appending five.
--
-- equity/fixed_income/commodity are nullable because backfilled rows are
-- reconstructed from the single Account Value line, which has no category split;
-- writing zeros there would invent a portfolio that held nothing. meta.source
-- distinguishes 'live' (recorded) from 'backfill' (reconstructed).
CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  total         numeric NOT NULL,
  invested      numeric,
  equity        numeric,
  fixed_income  numeric,
  commodity     numeric,
  by_portfolio  jsonb,
  meta          jsonb,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, snapshot_date)
);

ALTER TABLE net_worth_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own snapshots select" ON net_worth_snapshots;
CREATE POLICY "own snapshots select"
  ON net_worth_snapshots FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own snapshots insert" ON net_worth_snapshots;
CREATE POLICY "own snapshots insert"
  ON net_worth_snapshots FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own snapshots update" ON net_worth_snapshots;
CREATE POLICY "own snapshots update"
  ON net_worth_snapshots FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- No DELETE policy: a record you can silently drop is not a record. Removing a
-- snapshot is a deliberate act, done from the SQL editor.

-- ── Check it worked ─────────────────────────────────────────────────────────
-- Expect three rows: SELECT, INSERT, UPDATE. If you get none, the CREATE above
-- did not run.
SELECT cmd, policyname
FROM pg_policies
WHERE tablename = 'net_worth_snapshots'
ORDER BY cmd;
