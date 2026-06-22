"""
Fetches AMFI's ISIN -> Scheme Code map server-side and saves it as a static
JSON file the website can read directly (same-origin, no CORS involved).

Run this periodically (e.g. before checking your portfolio) and commit the
updated amfi_isin_map.json so the Dashboard's "Total Current Value" and
"Current Value Over Time" chart can resolve instruments to NAV data.

Usage:
    python3 fetch_amfi_isin_map.py
"""

import json
import sys
import time

import requests

AMFI_NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt"
OUTPUT_FILE = "amfi_isin_map.json"


def fetch_isin_to_scheme_code():
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
                isin_to_code[isin.upper()] = scheme_code
    return isin_to_code


def main():
    print("Fetching AMFI NAVAll.txt …")
    isin_to_code = fetch_isin_to_scheme_code()

    payload = {"fetchedAt": int(time.time() * 1000), "data": isin_to_code}
    with open(OUTPUT_FILE, "w") as f:
        json.dump(payload, f, indent=2)

    print(f"Saved {len(isin_to_code)} ISIN -> Scheme Code mappings to {OUTPUT_FILE}")


if __name__ == "__main__":
    try:
        main()
    except requests.RequestException as exc:
        print(f"Failed to fetch AMFI data: {exc}", file=sys.stderr)
        sys.exit(1)
