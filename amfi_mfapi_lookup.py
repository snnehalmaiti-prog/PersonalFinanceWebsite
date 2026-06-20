"""
For each unique instrument in the Transactions sheet:
  1. Look up its ISIN in the Mutual Fund Mapping sheet (Instrument Name -> Identifier)
  2. Look up the ISIN in AMFI's NAVAll.txt to find the Scheme Code
  3. Fetch full fund metadata for that Scheme Code from mfapi.in

Usage:
    python3 amfi_mfapi_lookup.py
"""

import sys
import requests
import pandas as pd

WORKBOOK_PATH = "Equity_Transactions.xlsx"
TRANSACTIONS_SHEET = "Transactions"
MAPPING_SHEET = "Mutual Fund Mapping"
TRANSACTIONS_HEADER_ROW = 0  # 0-based pandas header index; use 4 if header is on row 5
MAPPING_HEADER_ROW = 0

AMFI_NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt"
MFAPI_URL = "https://api.mfapi.in/mf/{}"


def fetch_amfi_isin_to_scheme_code():
    """Parse AMFI's NAVAll.txt into a dict mapping ISIN -> Scheme Code.

    Each non-header data line looks like:
    Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
    Both ISIN columns are mapped to the same scheme code since either may
    appear in the mapping sheet depending on the plan held.
    """
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


def fetch_mfapi_metadata(scheme_code):
    try:
        response = requests.get(MFAPI_URL.format(scheme_code), timeout=15)
        response.raise_for_status()
        payload = response.json()
        return payload.get("meta", {})
    except requests.RequestException:
        return None


def build_instrument_isin_map(mapping_df):
    mapping_df = mapping_df.dropna(subset=["Instrument Name", "Identifier"])
    return dict(zip(mapping_df["Instrument Name"].str.strip(), mapping_df["Identifier"].str.strip()))


def main():
    transactions_df = pd.read_excel(WORKBOOK_PATH, sheet_name=TRANSACTIONS_SHEET, header=TRANSACTIONS_HEADER_ROW)
    mapping_df = pd.read_excel(WORKBOOK_PATH, sheet_name=MAPPING_SHEET, header=MAPPING_HEADER_ROW)

    instrument_to_isin = build_instrument_isin_map(mapping_df)
    instruments = sorted(transactions_df["Instrument Name"].dropna().str.strip().unique())

    print("Fetching AMFI NAVAll.txt …")
    isin_to_scheme_code = fetch_amfi_isin_to_scheme_code()

    rows = []
    for instrument in instruments:
        isin = instrument_to_isin.get(instrument)
        if not isin:
            rows.append({"Instrument Name": instrument, "ISIN": None, "Scheme Code": None,
                         "Fund House": None, "Scheme Name": None, "Scheme Category": None,
                         "Status": "No ISIN mapping found"})
            continue

        scheme_code = isin_to_scheme_code.get(isin)
        if not scheme_code:
            rows.append({"Instrument Name": instrument, "ISIN": isin, "Scheme Code": None,
                         "Fund House": None, "Scheme Name": None, "Scheme Category": None,
                         "Status": "ISIN not found in AMFI NAVAll.txt"})
            continue

        meta = fetch_mfapi_metadata(scheme_code)
        if not meta:
            rows.append({"Instrument Name": instrument, "ISIN": isin, "Scheme Code": scheme_code,
                         "Fund House": None, "Scheme Name": None, "Scheme Category": None,
                         "Status": "mfapi.in lookup failed"})
            continue

        rows.append({
            "Instrument Name": instrument,
            "ISIN": isin,
            "Scheme Code": scheme_code,
            "Fund House": meta.get("fund_house"),
            "Scheme Name": meta.get("scheme_name"),
            "Scheme Category": meta.get("scheme_category"),
            "Status": "OK",
        })

    result_df = pd.DataFrame(rows)
    pd.set_option("display.max_colwidth", 60)
    print(result_df.to_string(index=False))

    unresolved = result_df[result_df["Status"] != "OK"]
    if len(unresolved):
        print(f"\n{len(unresolved)} of {len(result_df)} instrument(s) could not be fully resolved:")
        print(unresolved[["Instrument Name", "Status"]].to_string(index=False))

    return result_df


if __name__ == "__main__":
    try:
        main()
    except FileNotFoundError:
        print(f"Could not find {WORKBOOK_PATH}. Update WORKBOOK_PATH at the top of this script.", file=sys.stderr)
        sys.exit(1)
