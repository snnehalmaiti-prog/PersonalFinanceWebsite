-- Per-portfolio, per-sub-category values on each snapshot.
--
-- NET WORTH · MONTHLY charts market movement as a residual: the change in total
-- minus contributions, interest and idle cash. A residual has no parts, so a
-- "which sub-category moved this" question had nowhere to read from, and the
-- first attempt answered it by recomputing from today's sheets — a second
-- derivation, which disagreed with the recorded bar often enough to need an
-- "unattributed" line.
--
-- Recording the split makes the drill-down read the same row the bar came from,
-- so the parts sum to the whole by construction rather than by luck.
--
-- Shape: portfolio -> sub-category -> current value at that date.
--
--   {"Snnehal": {"Mutual Funds": 4521334.12, "Fixed Deposit": 2440000},
--    "Trisha":  {"Mutual Funds": 3688835.40}}
--
-- Per portfolio, with the household summed at read time rather than stored: it
-- is a third less data, and it makes "the portfolios sum to the household" true
-- by construction instead of something to verify.
--
-- Nullable, and it stays null on every row written before this existed. Those
-- months cannot be drilled into from records and must fall back to
-- recomputation — the card should say which of the two a month is, rather than
-- present them as the same thing.
--
-- Safe to re-run.
ALTER TABLE net_worth_snapshots
  ADD COLUMN IF NOT EXISTS by_subcategory jsonb;

COMMENT ON COLUMN net_worth_snapshots.by_subcategory IS
  'portfolio -> sub-category -> current value at this date. Null on rows '
  'written before the column existed. The household total is the sum across '
  'portfolios, never stored separately.';
