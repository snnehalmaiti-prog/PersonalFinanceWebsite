# Kosha — Getting Started Guide

A step-by-step guide for first-time users to set up Kosha and explore all its features.

---

## Table of Contents

1. [Creating Your Account](#1-creating-your-account)
2. [Initial Setup (Settings)](#2-initial-setup-settings)
3. [Dashboard — Overview](#3-dashboard--overview)
4. [Dashboard — Investments](#4-dashboard--investments)
5. [Dashboard — Expense Manager](#5-dashboard--expense-manager)
6. [Installing as a Mobile App (PWA)](#6-installing-as-a-mobile-app-pwa)
7. [FAQ / Troubleshooting](#7-faq--troubleshooting)

---

## 1. Creating Your Account

1. Open the Kosha landing page (`index.html`).
2. Click **Get Started Free** (or **Log in** if you already have an account).
3. In the sign-up form, enter your **First Name**, **Last Name**, **Email**, and **Password**, then submit.
4. Check your email for a verification link and confirm your account.
5. Once signed in you are redirected to the **Dashboard**.

> Returning users: if you are already logged in, the landing page automatically redirects you to the Dashboard.

---

## 2. Initial Setup (Settings)

Before the dashboard can show meaningful data you need to connect your data sources. Open **Settings** from the user menu (top-right) on the Dashboard.

### 2.1 Profile

| Field | What to do |
|---|---|
| First / Last Name | Verify or update your display name. |
| Email | Read-only — shows your login email. |
| Gold Premium % | Set the premium percentage applied when calculating physical gold value (default 0). |
| Refresh All Sheets | Click after connecting sheets (see below) to pull the latest data. |

### 2.2 Transaction Details — Connect Google Sheets

Kosha reads your investment transactions from Google Sheets. For each asset class you need to:

1. Create a Google Sheet with your transaction data (date, fund/stock name, units, amount, etc.).
2. **Publish** the sheet to the web: *File → Share → Publish to web → Entire Document → CSV → Publish*.
3. Copy the published URL.
4. In Settings → **Transaction Details**, paste the URL into the correct section:
   - **Mutual Fund** — one or more sheets containing MF buy/sell/SIP transactions.
   - **Stocks / ETF** — sheets with equity and ETF trade data.
   - **Fixed Income / Commodity** — sheets with FD, bond, gold, silver transactions.
5. You can add multiple sheets per asset class (e.g., one per broker or portfolio).
6. Click **Save**, then hit **Refresh All Sheets** on the Profile tab.

### 2.3 Mapping

Mapping sheets tell Kosha how to match your transaction names to market identifiers:

- **MF Mapping Sheet** — maps your fund names to AMFI scheme codes so NAVs can be fetched.
- **Stocks/ETF Mapping Sheet** — maps your stock/ETF names to ticker symbols for price lookup.

Publish these sheets the same way and paste their URLs here.

### 2.4 Expense Setup

Before using the Expense Manager, configure the following under Settings → **Expense**:

| Sub-section | Purpose |
|---|---|
| **Accounts** | Add your bank accounts, wallets, and credit cards (name, opening balance). |
| **Payment Methods** | Define how you pay — UPI, card, cash, net banking, etc. |
| **Categories** | Create spending/income categories (e.g., Food, Rent, Salary) and optional subcategories. |
| **Templates** | Save frequently used transactions as templates for one-click entry. |
| **Recurring Payments** | Set up auto-repeating entries (subscriptions, EMIs, SIPs). |
| **Liability** | Track loans or amounts owed. |
| **Bulk Import** | Upload a CSV file to import many transactions at once. |

### 2.5 GitHub Integration (Optional — Advanced)

If you self-host the NAV/price refresh scripts, configure:

- **Repository** — owner, name, branch of your GitHub repo.
- **Personal Access Token (PAT)** — a GitHub token with workflow permissions.
- **Trigger Refresh** — buttons to manually trigger the NAV Refresh or Price Refresh GitHub Actions workflows.

### 2.6 EPF Interest (Optional)

If you track your Employee Provident Fund, enter the EPF interest rate for each financial year so Kosha can compute accrued interest correctly.

---

## 3. Dashboard — Overview

The Overview tab is your financial command centre. After your sheets are connected and refreshed, you will see:

### Summary Cards

| Card | What it shows |
|---|---|
| Invested | Total amount you have put into all investments. |
| Current | Current market value of your portfolio. |
| Day Change | How much your portfolio moved today. |
| Unrealized P&L | Profit/loss on holdings you still own. |
| Return % | Overall percentage return. |
| Realized P&L | Profit/loss from holdings you have sold. |
| XIRR | Annualised return accounting for the timing of each cash flow. |

### Filters

- **Portfolio pills** — click to view a single portfolio or all.
- **Exclude dropdown** — hide Equity, Fixed Income/Commodity, or Savings/Investment from the view.

### Charts & Widgets

| Widget | Description |
|---|---|
| **Benchmark Comparison** | Compare your XIRR / CAGR against Nifty 50, Nifty Next 50, Midcap 150, and Nifty 500 over selectable periods. |
| **Portfolio Performance** | "Growth of ₹100" chart — your portfolio line vs a chosen index. |
| **Account Value** | Portfolio value over time with a month picker to zoom in. |
| **Portfolio Split** | Donut chart showing allocation by portfolio or by region. |
| **Category Split** | Allocation across Equity, Debt, Commodity, etc. |
| **Realized Profit Split** | Breakdown of booked gains by category. |
| **Gain Monthly** | Bar chart of monthly net-worth changes; click a bar to drill down. |
| **Cash Flow Monthly** | Investment and withdrawal flows per instrument; toggle idle-cash view. |
| **Income & Expenses Monthly** | Side-by-side bars for income vs spending each month. |
| **Expense by Category** | Pie chart of spending categories; click a slice to see subcategories. |

---

## 4. Dashboard — Investments

The Investments tab has three sub-tabs, one per asset class.

### 4.1 Mutual Fund

- **Portfolio summary cards** — invested, current value, P&L, XIRR per portfolio.
- **Allocation chart** — by portfolio or by market-cap / segment.
- **Holdings list** — every fund with units, NAV, current value, XIRR. Toggle between **Open** (active) and **Closed** (redeemed) holdings.

### 4.2 Stocks / ETF

- **Portfolio summary cards** — same metrics as MF.
- **Geography allocation** — India vs US split.
- **Market-cap split** — Large / Mid / Small cap breakdown.
- **India holdings table** — INR-denominated stocks and ETFs.
- **US holdings table** — USD holdings with live USD→INR conversion.
- **Open / Closed toggle** — switch between current and exited positions.

### 4.3 Fixed Income / Commodity

- **Portfolio summary cards** — invested, current, P&L.
- **Allocation chart** — by sub-category or by portfolio.
- **Interest-bearing split** — shows how much of your fixed-income portfolio earns interest.
- **Fixed Income holdings** — FDs, bonds, PPF, etc.
- **Debt ETF / Mutual Fund holdings** — debt-oriented funds.
- **Commodity holdings** — gold and silver quantities with live gold rate integration.

---

## 5. Dashboard — Expense Manager

The Expense tab has four sub-tabs.

### 5.1 Accounts

- **Balance tiles** — current balance of every configured account.
- **Spend breakdown** — spending totalled by account and by payment method in a matrix view.
- **Joint account settlement** — tracks payments to shared accounts and who owes whom.

### 5.2 Records

This is where you log day-to-day transactions.

- **Add a record** — click the **+** button. Fill in date, account, category, amount, payment method, and optional notes. Or pick a saved **template**.
- **Filter sidebar** — narrow the list by account, category, type (income/expense), payment method, or amount range.
- **Period picker** — view transactions for a specific month or custom range.
- **Bulk actions** — select multiple records to export or delete.
- **Edit / Delete** — click any record to modify or remove it.

### 5.3 Analytics

- **Pivot table** — cross-tabulate your transactions by any two dimensions (category × month, account × category, etc.).
- **Filter sidebar** — same filters as Records for consistent slicing.

### 5.4 Charts

| Chart | Description |
|---|---|
| **Monthly Income / Budget / Expense** | Three-line chart showing how actual spending compares to income and budget each month. |
| **Budget Variance Waterfall** | Waterfall chart highlighting which categories are over or under budget. |

---

## 6. Installing as a Mobile App (PWA)

Kosha is a Progressive Web App — you can install it on your phone or desktop for an app-like experience with offline support.

**On Android (Chrome):**
1. Open the site in Chrome.
2. Tap the **"Install"** or **"Add to Home screen"** banner (or use the browser menu → *Install app*).

**On iOS (Safari):**
1. Open the site in Safari.
2. Tap the **Share** button → **Add to Home Screen**.

**On Desktop (Chrome / Edge):**
1. Look for the install icon in the address bar and click it.

Once installed, Kosha opens in its own window and works offline for previously loaded data.

---

## 7. FAQ / Troubleshooting

**Q: My dashboard is empty after signing in.**
A: You need to connect your Google Sheets first. Go to Settings → Transaction Details, paste your published sheet URLs, save, then click Refresh All Sheets on the Profile tab.

**Q: NAV / stock prices are not updating.**
A: Price data is refreshed via GitHub Actions. Make sure GitHub Integration is configured in Settings with a valid PAT and correct repo details, then click the Trigger Refresh button.

**Q: I see "NaN" or missing values on some cards.**
A: This usually means a mapping is missing. Check Settings → Mapping and ensure every fund/stock in your transaction sheet has a corresponding entry in the mapping sheet.

**Q: Can I use Kosha without Google Sheets?**
A: The investment tracker requires Google Sheets as its data source. The Expense Manager works independently — you can add transactions manually or via CSV bulk import without any sheet setup.

**Q: Is my data safe?**
A: All data is stored in your personal Supabase account with Row-Level Security — only you can access your records. Transaction sheets are read from Google's public publish URLs; no Google account access is required.

**Q: How do I export my expense data?**
A: In Expense → Records, select the transactions you want, then use the **Export** action to download them.

---

*Happy tracking! If you run into issues, check the project repository for updates or open an issue.*
