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

# AMFI serves a 200-OK HTML block page to requests without a browser-like
# User-Agent, so raise_for_status() passes but the body has no NAV rows.
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "text/plain,text/html;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.amfiindia.com/",
}

# AMFI serves the real file only INTERMITTENTLY and otherwise returns a 200-OK
# anti-bot page with no rows, so an empty parse is retried rather than treated
# as terminal — see fetch_amfi_nav.py for the full rationale.
MAX_ATTEMPTS = 8
RETRY_DELAYS = [5, 10, 20, 30, 45, 60, 60]  # seconds between attempts


def _parse_isin(text):
    isin_to_code = {}
    for line in text.splitlines():
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


def fetch_isin_to_scheme_code():
    for attempt in range(1, MAX_ATTEMPTS + 1):
        response = requests.get(AMFI_NAV_URL, headers=REQUEST_HEADERS, timeout=30)
        response.raise_for_status()
        isin_to_code = _parse_isin(response.text)
        if isin_to_code:
            if attempt > 1:
                print(f"  got {len(isin_to_code)} rows on attempt {attempt}")
            return isin_to_code
        if attempt < MAX_ATTEMPTS:
            delay = RETRY_DELAYS[min(attempt - 1, len(RETRY_DELAYS) - 1)]
            print(f"  attempt {attempt}: 0 rows (AMFI block page?), retrying in {delay}s",
                  file=sys.stderr)
            time.sleep(delay)
    return {}


def main():
    print("Fetching AMFI NAVAll.txt …")
    isin_to_code = fetch_isin_to_scheme_code()

    # A 200-OK block page or a changed feed format parses to zero mappings.
    # Never overwrite good data with an empty map — fail loudly so the
    # workflow surfaces the problem instead of quietly publishing "data": {}.
    if not isin_to_code:
        raise RuntimeError(
            "AMFI returned no ISIN rows (likely a block page or changed format); "
            "refusing to overwrite %s with empty data" % OUTPUT_FILE
        )

    payload = {"fetchedAt": int(time.time() * 1000), "data": isin_to_code}
    with open(OUTPUT_FILE, "w") as f:
        json.dump(payload, f, indent=2)

    print(f"Saved {len(isin_to_code)} ISIN -> Scheme Code mappings to {OUTPUT_FILE}")


if __name__ == "__main__":
    try:
        main()
    except (requests.RequestException, RuntimeError) as exc:
        print(f"Failed to fetch AMFI data: {exc}", file=sys.stderr)
        sys.exit(1)
