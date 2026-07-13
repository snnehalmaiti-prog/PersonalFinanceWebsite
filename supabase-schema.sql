-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)

CREATE TABLE IF NOT EXISTS user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  equity_sheets jsonb,
  stocksetf_sheets jsonb,
  fd_sheets jsonb,
  mfmapping_sheets jsonb,
  stocksetfmapping_sheets jsonb,
  gh_owner text DEFAULT '',
  gh_repo text DEFAULT '',
  gh_branch text DEFAULT '',
  expense_templates jsonb,
  recurring_payments jsonb,
  updated_at timestamptz DEFAULT now()
);

-- Migration for existing databases created before expense_templates / recurring_payments
-- were synced. Without these columns the whole settings upsert fails (PGRST204) and
-- ALL settings sync silently stops once a template/recurring payment exists.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS expense_templates jsonb;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS recurring_payments jsonb;

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own settings"
  ON user_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
  ON user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON user_settings FOR UPDATE
  USING (auth.uid() = user_id);
