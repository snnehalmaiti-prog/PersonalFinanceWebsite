# PF Dashboard — Executive Summary

**A client-side personal finance dashboard** (vanilla JS on GitHub Pages) that unifies investments and expenses into one INR-normalised view. Investment data is read from per-user **Google Sheets**; authentication, the settings sync row, and the expense ledger live in **Supabase** (Row-Level Security per user). All calculations run in the browser.

## What it does

| Area | Capability |
|------|------------|
| **Authentication** | Email sign up / sign in, password reset, auto token refresh, route guards. |
| **Investments — Overview** | Net worth across four asset classes (Mutual Funds, Stocks/ETF, Fixed Income, Commodity): Invested, Current, Unrealized & Realized return, Return %, day change, and portfolio XIRR. |
| **Mutual Funds** | Per-fund holdings (units, NAV, P&L, XIRR), open/closed & portfolio toggles, allocation by market-cap or portfolio; unpriced funds valued at cost. |
| **Stocks / ETF** | Independent India & US holdings tables, USD→INR conversion, per-(portfolio × instrument) FIFO, market-cap split. |
| **Fixed Income** | FD, Savings/Corpus, and EPF/PPF valued with the correct compounding model; allocation by sub-category or portfolio. |
| **Commodity** | Physical gold/silver valued at the live gold rate plus a configurable India retail premium %. |
| **Charts** | Portfolio / Category / Region split, benchmark comparison, Growth of ₹100, account value over time, monthly investment by category, rolling CAGR. |
| **Expense manager** | Accounts, categories & sub-categories, payment methods; expense/budget/income records with budget-split; reusable templates; recurring auto-posting; CSV bulk import with validation; monthly analytics. |
| **Settings & sync** | Google-Sheet connections & mappings, gold premium, NAV/ISIN refresh, theme; settings sync across devices via `user_settings` (merge-by-id, tombstones). The GitHub token stays local-only. |

## Key calculation logic (one-liners)

- **Holdings / cost basis** — FIFO lot matching; average cost = remaining invested ÷ remaining units; `split`/`bonus` add units at zero cost.
- **Realized P&L** — proceeds clamped to FIFO-matched units (over-sell cannot fabricate profit).
- **Current value** — MF: units × latest NAV (unpriced → cost); SE: units × LTP (× USD/INR for US); Commodity: grams × gold rate × premium.
- **Fixed Income** — FD: `Invested × (1 + rate/4)^quarters`; Corpus/Savings: `(1 + rate/12)^months`; EPF/PPF: deposits + un-withdrawn interest (FIFO withdrawals). Period counts are month-end clamped.
- **XIRR** — solves `Σ amount/(1+r)^(days/365.25) = 0` via Newton–Raphson with an auto-growing bisection fallback.
- **Reconciliation** — Portfolio Split and Category Split are anchored to the Overview's current-value totals, so all three always agree.

## Architecture at a glance

`Google Sheets + pricing APIs + Supabase` → parsed & cached in `localStorage` → **FIFO & valuation** → per-class `_ov` aggregation (`Total = MF + SE + FI + Commodity`, gated by portfolio filter & FI-exclusion) → **Overview cards, holdings tables, charts, and the expense manager**.

---
*See `FUNCTIONAL_REQUIREMENTS.md` for the full requirement-by-requirement specification and detailed calculation reference.*
