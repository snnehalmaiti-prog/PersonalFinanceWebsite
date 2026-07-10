# Personal Finance Dashboard — Functional Requirements Document

**Product:** PF Dashboard (a.k.a. Wealthfolio)
**Type:** Client-side single-page web app (vanilla HTML/CSS/JS, no build step), hosted on GitHub Pages.
**Backend:** Supabase (auth + a `user_settings` row and Expense-manager tables) and Google Sheets (investment transaction data, read-only).
**Currency:** All values normalised to **INR (₹)**. US instruments are converted from USD.

---

## 1. Scope & Architecture

### 1.1 Pages
| Page | Purpose |
|------|---------|
| `index.html` | Marketing landing + auth modal (sign in / sign up / password reset). |
| `dashboard.html` | The application: Investments (Overview, Mutual Funds, Stocks/ETF, Fixed Income, Commodity) + Expense tab. |
| `settings.html` | Sheet connections, mappings, profile, preferences, and the Expense manager (Accounts, Categories, Payment methods, Templates, Recurring payments, Bulk import). |

### 1.2 Data sources
- **Google Sheets** (per-user configured URLs) provide investment transactions and instrument metadata. Data is fetched, parsed, and cached in `localStorage` (`wf-<prefix>-data`). Sheet *connection configs* live under `wf-<prefix>-sheets`.
- **Supabase**: authentication, a single `user_settings` row for cross-device settings sync, and Expense-manager tables (`expense_accounts`, `expense_categories`, `expense_payment_methods`, `expense_records`). Row-Level Security scopes every row to the signed-in user.

### 1.3 Sheet prefixes
| Prefix | Sheet | Key columns |
|--------|-------|-------------|
| `equity` | Mutual Fund transactions | Portfolio Name, Instrument Name, Transaction Type, Units, Price, Transaction Date |
| `stocksetf` | Stocks/ETF transactions | (same unit-based schema as equity) |
| `fd` | Fixed Income / Commodity | Portfolio, Bank, Instrument, Category, Sub Category, Type, Grams, Invested Amount, Maturity Date/Sell Date, Rate of Return |
| `fixedincome` | Legacy EPF-only (Amount column) | *optional / unused when EPF is kept in the `fd` sheet* |
| `mfmapping` | MF metadata | Instrument Name, Identifier/ISIN, Instrument Category, (Market Segment) |
| `stocksetfmapping` | Stocks/ETF metadata | Instrument Name, Identifier, Region, Instrument Category, Instrument Sub Category, Market Segment |

---

## 2. Authentication & User Management (FR-AUTH)

- **FR-AUTH-1 Sign up** — email + password (+ optional first/last name metadata) via Supabase. On success a session `{access_token, refresh_token, user, expires_at}` is stored in `localStorage` (`wf-sb-session`).
- **FR-AUTH-2 Sign in** — email/password; invalid credentials show an inline error.
- **FR-AUTH-3 Password reset** — "Forgot password" sends a recovery email; the emailed link returns to `index.html#access_token=…&type=recovery`, which shows a reset form. On submit, the password is updated, the session is populated (user + expiry via `refreshUser`), and the user is redirected to the dashboard.
- **FR-AUTH-4 Session validity** — `getValidToken()` refreshes the access token when it is within 60 s of expiry using the refresh token.
- **FR-AUTH-5 Route guard** — `settings.html` and `dashboard.html` redirect to the landing page if not authenticated (`requireAuth`). The guard is fail-closed.
- **FR-AUTH-6 Sign out** — clears the session and calls the Supabase logout endpoint.
- **FR-AUTH-7 Profile** — first/last name editable in Settings → Profile (stored in Supabase user metadata).

**Security constraints**
- The Supabase **anon key** is public by design (RLS-protected).
- The **GitHub Personal Access Token** (used to trigger data-refresh workflows) is stored **only in `localStorage`** and is **never** synced to the cloud (excluded from `SYNC_KEYS`).

---

## 3. Portfolio Selector & Exclusion Toggles (FR-SEL)

- **FR-SEL-1 Portfolio filter** — a global selector (`wf-selected-portfolio`) scopes every computation to a single portfolio or `all`. Portfolio names are discovered from the transaction sheets.
- **FR-SEL-2 Exclude Fixed Income** (`wf-exclude-fixedincome`) — when on, Fixed Income **and Commodity** are removed from Overview totals, category cards, and the split charts (commodity is stored in the Fixed Income/Commodity sheet and follows this toggle).
- **FR-SEL-3 Exclude Savings/Investment** (`wf-exclude-savings-investment`) — excludes "Investment Corpus" and "Savings Account" sub-categories from FD invested/current sums.

---

## 4. Investment Overview (FR-OV)

The Overview aggregates four asset classes into a single `_ov` accumulator: **MF, Stocks/ETF (SE), Fixed Income (FI), Commodity**. Each class contributes `Invested`, `Current`, `Unrealized`, `Realized`.

- **FR-OV-1 Total Invested** = `mfInvested + seInvested + fiInvested + commInvested` (FI & commodity gated by the FI toggle).
- **FR-OV-2 Total Current** = `mfCurrent + seCurrent + fiCurrent + commCurrent` (same gating). This is the authoritative "net worth" figure the split charts reconcile to.
- **FR-OV-3 Unrealized Return** = `Total Current − Total Invested`; **Return %** = `Unrealized / Invested × 100` (guarded against divide-by-zero).
- **FR-OV-4 Realized Return** = sum of per-class realized profit.
- **FR-OV-5 Day Change** = MF day change + SE day change + commodity day change.
- **FR-OV-6 XIRR** — a single portfolio XIRR from all buy/sell cash flows + a terminal "sell everything today at current value" flow.
- **FR-OV-7 Category cards** — one card per asset class showing Invested, Current, Unrealized, Realized, Return %. The header total always equals the sum of the cards.

---

## 5. Mutual Funds Module (FR-MF)

- **FR-MF-1 Holdings list** — one row per held fund: units, avg NAV, current NAV, invested, current, P&L, P&L %, day change, XIRR. Instruments are resolved to an AMFI **Scheme Code** via the mapping sheet's ISIN, and NAV history is fetched from `api.mfapi.in` (cached; concurrent fetches de-duplicated).
- **FR-MF-2 Open/Closed toggle** — show open positions (remaining units ≥ ε) or fully-closed positions.
- **FR-MF-3 Portfolio toggle** — All / per-portfolio.
- **FR-MF-4 Sortable columns**, **subtotal footer**, and **fold/unfold** (lists with >3 rows collapse to just the subtotal behind a "Show N instruments" pill).
- **FR-MF-5 Allocation panel** — by market-cap segment or by portfolio.
- **FR-MF-6 Unpriced funds** — a held fund whose NAV can't be resolved is valued **at cost** (nets to ₹0 P&L) so it never appears as a phantom loss.
- **FR-MF-7 Corporate actions** — `split`/`bonus` transaction types add units at zero cost across holdings, Overview, and charts consistently.

---

## 6. Stocks / ETF Module (FR-SE)

- **FR-SE-1 Region split** — India and US holdings render as **independent** tables (each with its own Open/Closed, Portfolio, and sort state).
- **FR-SE-2 Per-instrument row** — instrument, invested, current, P&L · Return, day change; ETF badge from mapping category.
- **FR-SE-3 USD→INR** — US instruments are converted to INR; historical buy prices use the USD/INR rate on the buy date (`usd_inr_history`), current values use today's rate.
- **FR-SE-4 Per-(portfolio × instrument) FIFO** — holdings are built per portfolio so the same instrument held by two portfolios never mixes lots.
- **FR-SE-5 Market-Cap Split** — a bar of Large/Mid/Small-cap exposure for direct equity, driven by the mapping's category/segment/sub-category text; supports an "amount vs %" and a Portfolio toggle.
- **FR-SE-6 Fold/subtotal/sort** — same as MF.

---

## 7. Fixed Income Module (FR-FI)

Reads the `fd` sheet. Sub-categories are handled distinctly:

- **FR-FI-1 Fixed Deposit** — Current = `Invested × (1 + rate/4)^quarters`, where `quarters` = full elapsed quarters from start to min(today, maturity). (Banks credit quarterly.)
- **FR-FI-2 Investment Corpus / Savings Account** — Current = `Invested × (1 + rate/12)^months` (monthly compounding); deduped to the latest transaction per Portfolio/Bank/Instrument.
- **FR-FI-3 Provident Fund / EPF / PPF** — deposit + interest + withdrawal rows are accumulated per instrument: `invested` = remaining deposit lots (FIFO after withdrawals); `current` = invested + un-withdrawn interest; realized = interest proportional to withdrawn principal.
- **FR-FI-4 Holdings table** — Instrument, Sub-Cat, Invested, Current, Unrealized, Return %; IDLE badge for non-interest-bearing; portfolio toggle; fold/subtotal/sort.
- **FR-FI-5 Allocation** — by sub-category or portfolio.

---

## 8. Commodity Module (FR-CM)

Physical gold/silver held in the `fd` sheet (Sub Category = gold/silver, Grams column).

- **FR-CM-1 Current value** = `grams × current gold rate (₹/g)`. The gold rate is fetched keyless from a currency-API CDN and multiplied by a user-configurable **India retail premium %** (import duty + GST).
- **FR-CM-2 Historical valuation** — buy/sell dates use the gold rate on that date (same premium applied to buy and current, so premium isn't a phantom gain).
- **FR-CM-3 Holdings table** — Instrument, Sub-Cat, rate, grams, invested, current, day change, return %, with a subtotal + fold.
- **FR-CM-4 XIRR** — commodity buys are negative cash flows on the transaction date; a terminal current-value flow closes it.

---

## 9. Charts & Analytics (FR-CH)

- **FR-CH-1 Benchmark Comparison** — portfolio vs a selectable index (Nifty 50 / Next 50 / etc.). Only **equity** (MF + Stocks/ETF + commodity) is considered; Fixed Income is excluded.
- **FR-CH-2 Growth of ₹100** — indexed portfolio NAV vs the index since inception; the selected index updates the comparison line.
- **FR-CH-3 Account Value Over Time** — absolute portfolio value timeline (includes all classes when no exclusion is active).
- **FR-CH-4 Portfolio Split** — invested/current split by portfolio, with per-portfolio category chips (Equity/Fixed Income/Commodity). Toggle to **Region Split** (India/US).
- **FR-CH-5 Category Split** — split by asset class (Equity / Fixed Income / Commodity), anchored to the Overview current values so the total always matches Portfolio Split. Commodity-category MF/ETF are reclassified from Equity into Commodity.
- **FR-CH-6 Monthly Investment by Category** — bar chart of monthly inflows (and net = inflow − outflow) grouped by instrument category, with year / all-time toggles.
- **FR-CH-7 Rolling Returns / CAGR** — min / median / max CAGR over all rolling windows of N years.

---

## 10. Calculation Logic Reference (FR-CALC)

### 10.1 FIFO lot matching
Transactions are date-ordered (ties broken by input order). Buys push `{units, price}` lots; sells consume the **oldest** lots first.
- **Remaining units / invested cost** = sum of un-consumed lots (`Σ units × price`).
- **Average cost** = remaining invested ÷ remaining units.
- `split`/`bonus` are treated as buys at **price 0**.

### 10.2 Realized return
For each sell, cost of sold units = FIFO-matched lot cost; **proceeds are clamped to matched units** (`matchedUnits × sellPrice`) so selling more than was ever bought cannot fabricate zero-cost profit. Realized P&L = proceeds − matched cost.

### 10.3 Current value
- MF: `remaining units × latest NAV` (unpriced → at cost).
- SE: `remaining units × latest price` (× today's USD/INR for US).
- FI: per sub-category formula (§7).
- Commodity: `grams × gold rate × premium`.

### 10.4 XIRR (`calculateXIRR`)
Solves `Σ amount / (1 + r)^t = 0`, where `t = days / 365.25`.
- **Newton–Raphson** first (with derivative); falls back to **bisection** on `[-0.999999, high]`.
- The upper bracket **auto-grows** (doubles) until it brackets the root, so extreme returns still resolve instead of showing "—".
- Cash-flow sign convention: buys negative, sells/terminal value positive.

### 10.5 CAGR & rolling returns
- Point-to-point CAGR = `(end/start)^(1/years) − 1`, `years = ms / (365.25 d)`.
- Rolling: every window of N years across the monthly value series; only finite CAGR > −100 % is kept. **Median** averages the two central values for even-length sets.

### 10.6 Compounding period counts
`countElapsedMonths` / `countElapsedQuarters` count **full** periods from the original start date, with the day clamped to the target month's length (so Jan 31 + 1 month = Feb 28, not Mar 3, and no forward drift).

### 10.7 USD→INR
- Historical: `usd_inr_history[buyDate]` (fallback 84).
- Current: today's `__USD_INR__` rate from `stock_prices.json`.

### 10.8 Gold pricing
- Spot ₹/g = `XAU_INR / 31.1035` from a keyless currency-API CDN.
- Retail value = spot × `(1 + premium% / 100)`.
- Day change = today's ₹/g − yesterday's ₹/g (raw delta cached pre-premium; premium applied on read).

### 10.9 Number parsing
`parseNumber` strips ₹, commas, spaces, and handles parenthesised negatives / blank / NaN → 0. `parsePercentRate` normalises "8%", "8", "0.08" consistently.

---

## 11. Expense Manager (FR-EXP)

Backed by Supabase tables (per-user, RLS).

### 11.1 Master data
- **Accounts** (`expense_accounts`) — name, type (cash/bank/card/wallet/other), opening balance, contributing-account flag.
- **Categories** (`expense_categories`) — expense/income/budget, parent → sub-category drill-down; budget categories link to an account.
- **Payment methods** (`expense_payment_methods`) — name, credit-card flag.
- First-run seeding creates a default account, a BudgetBakers-style taxonomy, and default payment methods.

### 11.2 Records (`expense_records`)
- **Types**: `expense`, `budget`, `income`.
- Fields: amount, account, category/sub-category, payment method (expense only), date-time (expense) or month (budget/income), note, labels.
- **FR-EXP-REC-1** Amount required (> 0) for records; payment method required for expenses; category required.
- **FR-EXP-REC-2** Add / edit / delete (single + bulk, with error surfacing on failure).
- **FR-EXP-REC-3** "Add record to <date>" pre-fills the chosen date in the visible picker.

### 11.3 Budget split
For a **budget** record on a joint (non-contributing) account, the amount is split across contributing accounts. Default split distributes equally and **sums to 100 %** (editable first row; the rest auto-calculate; last row absorbs rounding). Save is rejected unless the split totals 100 %. The split is stored in `labels` as `{budget_split}`.

### 11.4 Templates
- Reusable record shortcuts (name + a record payload). Stored in `localStorage` (`wf-expense-templates`) and synced to Supabase `user_settings.expense_templates`.
- **FR-EXP-TPL-1** Create/edit/delete via a modal in Settings (or the dashboard record modal); pickable from "Select template" when adding a record.
- **FR-EXP-TPL-2** Amount is optional for a template.

### 11.5 Recurring payments
- Scheduled records (rent, subscriptions, EMIs). Stored in `localStorage` (`wf-recurring-payments`) + synced to `user_settings.recurring_payments`.
- Fields: name, type, amount, **Start Date**, **Frequency** (daily/weekly/monthly/quarterly/yearly), **Installments** (blank = unlimited), End date, account, category/sub, payment method, note.
- **FR-EXP-RP-1 Auto-post** — on Expense-tab open / Settings load, for every recurring payment whose due date ≤ today (local IST date), an `expense_record` is inserted and the schedule advances by its frequency (month-end clamped). Posting stops after `Installments` posts or past the End date.
- **FR-EXP-RP-2 First installment** posts on the Start Date itself.
- **FR-EXP-RP-3 Idempotency** — the processor is re-entrancy-guarded, loads cloud state first, and **skips due-dates already present in the DB** (records labelled `[recurring, id, dueIso]`), so a payment is never posted twice even across devices or after a failed cloud save.
- **FR-EXP-RP-4 Edit** preserves the posted-installment counter.

### 11.6 Bulk CSV import
- Columns: `Date, Type, Amount, Account, Category, Subcategory, Payment Method, Labels, Note`.
- **FR-EXP-CSV-1 Validation pass** — parses, range-validates dates (rejects impossible dates like `2026-13-45`), classifies rows, and lists missing accounts/categories/sub-categories/payment methods before importing.
- **FR-EXP-CSV-2 Date format** — ISO `YYYY-MM-DD` preferred; ambiguous `dd/mm` defaults to **DD/MM** (₹/IST app). `txn_at` is anchored at local midday so it stays on the same calendar day as `txn_date`.
- **FR-EXP-CSV-3 Auto-create** — optionally creates missing categories/sub-categories.
- **FR-EXP-CSV-4 Progress + report** — progress bar and a per-row error report.

### 11.7 Expense analytics
- Monthly totals by category/sub-category, spend vs budget, joint-account payment calculator, month navigation, and multi-select filters (checkbox lists) mirrored between Records and Analytics tabs.

---

## 12. Settings & Preferences (FR-SET)

- **FR-SET-1 Sheet connections** — connect/relink Google Sheets per prefix; header-row configuration; diagnostics on sync.
- **FR-SET-2 Mappings** — MF and Stocks/ETF mapping sheets; push `stocksetf_mapping.json` to GitHub after mapping sync.
- **FR-SET-3 Gold premium %** — user-configurable retail premium (`wf-gold-premium-pct`).
- **FR-SET-4 NAV/ISIN refresh** — triggers GitHub Action workflows (AMFI NAV + ISIN map) via a stored PAT; reflects real dispatch status.
- **FR-SET-5 Theme** — light/dark toggle, applied across both themes.

---

## 13. Data Sync & Storage (FR-SYNC)

- **FR-SYNC-1** Settings in `SYNC_KEYS` (sheet configs, GitHub owner/repo/branch, expense templates, recurring payments) sync to a single `user_settings` row; each key maps to a jsonb/text column.
- **FR-SYNC-2 Merge-by-id** — templates and recurring lists carry `updated_at`; deletes become tombstones. On save, the local list is merged with the freshest cloud copy by id (last-writer-wins), so concurrent multi-device/multi-surface edits don't clobber each other and deletes propagate. Tombstones prune after 180 days.
- **FR-SYNC-3** The GitHub token is never in `SYNC_KEYS`.

**Required DB columns** (one-time migrations):
```sql
alter table user_settings add column if not exists expense_templates jsonb;
alter table user_settings add column if not exists recurring_payments jsonb;
```

---

## 14. Non-Functional Notes

- **Client-only compute** — all calculations run in the browser; no server-side math.
- **Caching** — sheet data, NAV history, stock prices, and gold prices are cached in `localStorage` with age limits.
- **Resilience** — every network call is wrapped so a failure degrades gracefully (e.g., unpriced holdings valued at cost; charts fall back to invested).
- **Timezone** — recurring/import date logic uses the device's **local date** (IST-safe), not UTC.
- **Cache-busting** — JS/CSS are versioned via `?v=` query strings, bumped on every change.

---

*This document reflects the implemented behaviour of the application as of the current branch.*
