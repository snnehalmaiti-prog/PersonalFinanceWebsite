"""
End-to-end portfolio enrichment pipeline.

Step 1 -> Load transactions + mutual fund mapping sheets
Step 2 -> Match each instrument to its ISIN via the mapping sheet
Step 3 -> Fetch AMFI NAV file -> extract Scheme Code per ISIN
Step 4 -> Fetch complete historical NAV from mfapi.in per Scheme Code
Step 5 -> Enrich every transaction row with NAV on transaction date + latest NAV
Step 6 -> Calculate current portfolio value, P&L, and returns
Step 7 -> Save both output files and print a summary report

Usage:
    python3 enrich_portfolio.py
"""

import sys
import requests
import pandas as pd

INPUT_FILE = "Equity_Transactions.xlsx"
TRANSACTIONS_SHEET = "Transactions"
MAPPING_SHEET = "Mutual Fund Mapping"
TRANSACTIONS_HEADER_ROW = 4  # row 5 (1-based)
MAPPING_HEADER_ROW = 2  # row 3 (1-based)

ENRICHED_OUTPUT_FILE = "Enriched_Transactions.xlsx"
SUMMARY_OUTPUT_FILE = "Portfolio_Current_Value.xlsx"

AMFI_NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt"
MFAPI_URL = "https://api.mfapi.in/mf/{}"


# ---------------------------------------------------------------------------
# Step 1: Load input files
# ---------------------------------------------------------------------------
def load_inputs():
    transactions_df = pd.read_excel(INPUT_FILE, sheet_name=TRANSACTIONS_SHEET, header=TRANSACTIONS_HEADER_ROW)
    mapping_df = pd.read_excel(INPUT_FILE, sheet_name=MAPPING_SHEET, header=MAPPING_HEADER_ROW)

    transactions_df["Instrument Name"] = transactions_df["Instrument Name"].astype(str).str.strip()
    transactions_df["Transaction Type"] = transactions_df["Transaction Type"].astype(str).str.strip().str.lower()
    transactions_df["Units"] = pd.to_numeric(transactions_df["Units"], errors="coerce").fillna(0)
    transactions_df["Value"] = pd.to_numeric(transactions_df["Value"], errors="coerce").fillna(0)
    transactions_df["Transaction Date"] = pd.to_datetime(transactions_df["Transaction Date"], errors="coerce")

    return transactions_df, mapping_df


# ---------------------------------------------------------------------------
# Step 2: Instrument -> ISIN
# ---------------------------------------------------------------------------
def build_instrument_isin_map(mapping_df):
    mapping_df = mapping_df.dropna(subset=["Instrument Name", "Identifier"])
    return dict(zip(mapping_df["Instrument Name"].str.strip(), mapping_df["Identifier"].str.strip()))


# ---------------------------------------------------------------------------
# Step 3: ISIN -> Scheme Code via AMFI
# ---------------------------------------------------------------------------
def fetch_amfi_isin_to_scheme_code():
    response = requests.get(AMFI_NAV_URL, timeout=30)
    response.raise_for_status()

    isin_to_code = {}
    for line in response.text.splitlines():
        parts = line.split(";")
        if len(parts) < 6:
            continue
        scheme_code, isin_payout, isin_reinvest = parts[0].strip(), parts[1].strip(), parts[2].strip()
        if not scheme_code.isdigit():
            continue
        for isin in (isin_payout, isin_reinvest):
            if isin and isin.upper() != "NA":
                isin_to_code[isin] = scheme_code
    return isin_to_code


# ---------------------------------------------------------------------------
# Step 4: Scheme Code -> full historical NAV from mfapi.in
# ---------------------------------------------------------------------------
def fetch_nav_history(scheme_code):
    try:
        response = requests.get(MFAPI_URL.format(scheme_code), timeout=15)
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException:
        return None

    data = payload.get("data", [])
    if not data:
        return None

    nav_df = pd.DataFrame(data)
    nav_df["date"] = pd.to_datetime(nav_df["date"], format="%d-%m-%Y")
    nav_df["nav"] = pd.to_numeric(nav_df["nav"], errors="coerce")
    return nav_df.dropna(subset=["nav"]).sort_values("date").reset_index(drop=True)


def nav_on_or_before(nav_df, target_date):
    if nav_df is None or pd.isna(target_date):
        return None
    eligible = nav_df[nav_df["date"] <= target_date]
    if eligible.empty:
        return None
    return eligible.iloc[-1]["nav"]


def latest_nav(nav_df):
    if nav_df is None or nav_df.empty:
        return None
    return nav_df.iloc[-1]["nav"]


# ---------------------------------------------------------------------------
# Step 5: Enrich every transaction row
# ---------------------------------------------------------------------------
def enrich_transactions(transactions_df, instrument_to_isin, isin_to_scheme_code, nav_history_by_code):
    df = transactions_df.copy()

    def resolve_scheme_code(instrument):
        isin = instrument_to_isin.get(instrument)
        if not isin:
            return None
        return isin_to_scheme_code.get(isin)

    df["ISIN"] = df["Instrument Name"].map(instrument_to_isin)
    df["Scheme Code"] = df["Instrument Name"].map(resolve_scheme_code)

    nav_on_date_col = []
    latest_nav_col = []
    for _, row in df.iterrows():
        scheme_code = row["Scheme Code"]
        nav_df = nav_history_by_code.get(scheme_code)
        nav_on_date_col.append(nav_on_or_before(nav_df, row["Transaction Date"]))
        latest_nav_col.append(latest_nav(nav_df))

    df["NAV on Transaction Date"] = nav_on_date_col
    df["Latest NAV"] = latest_nav_col
    return df


# ---------------------------------------------------------------------------
# Step 6: Current portfolio value, P&L, returns
# ---------------------------------------------------------------------------
def build_portfolio_summary(enriched_df):
    buys = enriched_df[enriched_df["Transaction Type"] == "buy"]
    sells = enriched_df[enriched_df["Transaction Type"] == "sell"]

    buy_summary = buys.groupby("Instrument Name").agg(
        **{"Total Buy Units": ("Units", "sum"), "Total Buy Value": ("Value", "sum")}
    )
    sell_summary = sells.groupby("Instrument Name").agg(**{"Total Sell Units": ("Units", "sum")})
    latest_nav_summary = enriched_df.groupby("Instrument Name").agg(**{"Latest NAV": ("Latest NAV", "last")})

    instruments = enriched_df["Instrument Name"].dropna().unique()
    summary = pd.DataFrame(index=instruments)
    summary = summary.join(buy_summary).join(sell_summary).join(latest_nav_summary)
    summary[["Total Buy Units", "Total Buy Value", "Total Sell Units"]] = summary[
        ["Total Buy Units", "Total Buy Value", "Total Sell Units"]
    ].fillna(0)

    summary["Remaining Units"] = (summary["Total Buy Units"] - summary["Total Sell Units"]).clip(lower=0)
    summary["Avg Buy Price"] = (summary["Total Buy Value"] / summary["Total Buy Units"]).where(
        summary["Total Buy Units"] > 0, 0
    )
    summary["Current Invested Amount"] = summary["Remaining Units"] * summary["Avg Buy Price"]
    summary["Current Value"] = summary["Remaining Units"] * summary["Latest NAV"].fillna(0)
    summary["Unrealized P&L"] = summary["Current Value"] - summary["Current Invested Amount"]
    summary["Return %"] = (summary["Unrealized P&L"] / summary["Current Invested Amount"].replace(0, pd.NA)) * 100

    summary = summary.reset_index().rename(columns={"index": "Instrument Name"})
    return summary[
        [
            "Instrument Name",
            "Total Buy Units",
            "Total Sell Units",
            "Remaining Units",
            "Avg Buy Price",
            "Latest NAV",
            "Current Invested Amount",
            "Current Value",
            "Unrealized P&L",
            "Return %",
        ]
    ]


# ---------------------------------------------------------------------------
# Step 7: Save outputs and print report
# ---------------------------------------------------------------------------
def main():
    print("Step 1/7: Loading transactions and mapping sheets …")
    transactions_df, mapping_df = load_inputs()

    print("Step 2/7: Matching instruments to ISIN …")
    instrument_to_isin = build_instrument_isin_map(mapping_df)

    print("Step 3/7: Fetching AMFI NAVAll.txt for Scheme Codes …")
    isin_to_scheme_code = fetch_amfi_isin_to_scheme_code()

    print("Step 4/7: Fetching historical NAV from mfapi.in …")
    scheme_codes = sorted(
        {isin_to_scheme_code[isin] for isin in instrument_to_isin.values() if isin in isin_to_scheme_code}
    )
    nav_history_by_code = {}
    for code in scheme_codes:
        nav_history_by_code[code] = fetch_nav_history(code)

    print("Step 5/7: Enriching transaction rows with NAV …")
    enriched_df = enrich_transactions(transactions_df, instrument_to_isin, isin_to_scheme_code, nav_history_by_code)

    print("Step 6/7: Calculating current value, P&L and returns …")
    summary_df = build_portfolio_summary(enriched_df)

    print("Step 7/7: Saving output files …")
    enriched_df.to_excel(ENRICHED_OUTPUT_FILE, index=False)
    summary_df.to_excel(SUMMARY_OUTPUT_FILE, index=False)

    pd.set_option("display.float_format", lambda v: f"{v:,.2f}")
    pd.set_option("display.max_colwidth", 60)
    print(f"\nSaved {ENRICHED_OUTPUT_FILE} ({len(enriched_df)} rows)")
    print(f"Saved {SUMMARY_OUTPUT_FILE} ({len(summary_df)} instruments)\n")

    print(summary_df.to_string(index=False))

    grand_invested = summary_df["Current Invested Amount"].sum()
    grand_value = summary_df["Current Value"].sum()
    grand_pnl = grand_value - grand_invested
    grand_return_pct = (grand_pnl / grand_invested * 100) if grand_invested else 0

    print("\n--- Portfolio Summary ---")
    print(f"Total Invested Amount : {grand_invested:,.2f}")
    print(f"Total Current Value   : {grand_value:,.2f}")
    print(f"Unrealized P&L         : {grand_pnl:,.2f}")
    print(f"Return %               : {grand_return_pct:,.2f}%")

    unresolved = enriched_df[enriched_df["Scheme Code"].isna()]["Instrument Name"].dropna().unique()
    if len(unresolved):
        print(f"\n{len(unresolved)} instrument(s) could not be resolved to a Scheme Code:")
        for name in unresolved:
            print(f"  - {name}")


if __name__ == "__main__":
    try:
        main()
    except FileNotFoundError:
        print(f"Could not find {INPUT_FILE}. Update INPUT_FILE at the top of this script.", file=sys.stderr)
        sys.exit(1)
