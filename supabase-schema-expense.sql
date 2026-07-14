-- ============================================================================
-- Expense Manager schema — run in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query). Safe to re-run: IF NOT EXISTS guards.
-- ============================================================================

-- Accounts (Cash, Bank, Credit Card, Wallet, …). Every record belongs to one.
CREATE TABLE IF NOT EXISTS expense_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  type text DEFAULT 'cash',            -- cash | bank | card | wallet | other
  initial_balance numeric DEFAULT 0,
  currency text DEFAULT 'INR',
  icon text DEFAULT '💳',
  color text DEFAULT '#3B82F6',
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Categories & subcategories. A subcategory has parent_id = its category's id;
-- a top-level category has parent_id = NULL. type = expense | income.
CREATE TABLE IF NOT EXISTS expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  parent_id uuid REFERENCES expense_categories(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'expense', -- expense | income
  icon text DEFAULT '🏷️',
  color text DEFAULT '#6B7280',
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Payment methods (UPI, Cash, Debit card, Credit card, Netbanking, …). Flat list.
CREATE TABLE IF NOT EXISTS expense_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  icon text DEFAULT '💳',
  color text DEFAULT '#6366F1',
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Budget envelopes: a spending limit per period over one or more categories.
CREATE TABLE IF NOT EXISTS expense_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  limit_amount numeric NOT NULL DEFAULT 0,
  period text NOT NULL DEFAULT 'monthly', -- weekly | monthly | yearly
  category_ids jsonb DEFAULT '[]'::jsonb,
  start_date date,
  color text DEFAULT '#10B981',
  created_at timestamptz DEFAULT now()
);

-- Individual transactions. type drives balance direction and category filtering.
CREATE TABLE IF NOT EXISTS expense_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  txn_date date NOT NULL,
  amount numeric NOT NULL,
  type text NOT NULL DEFAULT 'expense', -- expense | income
  account_id uuid REFERENCES expense_accounts(id) ON DELETE SET NULL,
  category_id uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
  subcategory_id uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
  payment_method_id uuid REFERENCES expense_payment_methods(id) ON DELETE SET NULL,
  note text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_records_user_date ON expense_records(user_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_expense_categories_user_parent ON expense_categories(user_id, parent_id);

-- ── Row Level Security: each user sees only their own rows ──────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expense_accounts','expense_categories','expense_payment_methods','expense_budgets','expense_records']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "own_select" ON %I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "own_insert" ON %I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "own_update" ON %I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "own_delete" ON %I;', t);
    EXECUTE format('CREATE POLICY "own_select" ON %I FOR SELECT USING (auth.uid() = user_id);', t);
    EXECUTE format('CREATE POLICY "own_insert" ON %I FOR INSERT WITH CHECK (auth.uid() = user_id);', t);
    EXECUTE format('CREATE POLICY "own_update" ON %I FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);', t);
    EXECUTE format('CREATE POLICY "own_delete" ON %I FOR DELETE USING (auth.uid() = user_id);', t);
  END LOOP;
END $$;
