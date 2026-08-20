"""
Fetches AMFI's daily NAV file server-side and saves it as a static JSON file
the website can read directly (same-origin, no CORS involved).

This bypasses api.mfapi.in, which can lag AMFI's own publication by several
days. Run this periodically (e.g. via the GitHub Actions workflow) and commit
the updated amfi_nav.json so the Dashboard can read the latest official NAV
straight from AMFI.

Usage:
    python3 fetch_amfi_nav.py
"""

import json
import sys
import time
from datetime import datetime, timezone

import requests

AMFI_NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt"
OUTPUT_FILE = "amfi_nav.json"

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

# A browser-like User-Agent is not enough on its own: AMFI serves the real file
# only INTERMITTENTLY and otherwise returns a 200-OK anti-bot page with no rows.
# The proof is that the ISIN-map job hits the exact same URL and succeeds on the
# attempts this one gets a block page. So an empty parse is retried rather than
# treated as terminal — one of the attempts gets the real feed. Delays escalate
# and are capped; the job runs rarely, so a slow success beats a spurious wipe.
MAX_ATTEMPTS = 8
RETRY_DELAYS = [5, 10, 20, 30, 45, 60, 60]  # seconds between attempts


def _parse_nav(text):
    scheme_to_nav = {}
    for line in text.splitlines():
        parts = line.split(";")
        if len(parts) < 6:
            continue
        scheme_code, nav, date = parts[0].strip(), parts[4].strip(), parts[5].strip()
        if not scheme_code.isdigit():
            continue
        if not nav or not date:
            continue
        try:
            float(nav)
        except ValueError:
            continue
        scheme_to_nav[scheme_code] = {"date": date, "nav": nav}
    return scheme_to_nav


def fetch_scheme_code_to_nav():
    for attempt in range(1, MAX_ATTEMPTS + 1):
        response = requests.get(AMFI_NAV_URL, headers=REQUEST_HEADERS, timeout=30)
        response.raise_for_status()
        scheme_to_nav = _parse_nav(response.text)
        if scheme_to_nav:
            if attempt > 1:
                print(f"  got {len(scheme_to_nav)} rows on attempt {attempt}")
            return scheme_to_nav
        if attempt < MAX_ATTEMPTS:
            delay = RETRY_DELAYS[min(attempt - 1, len(RETRY_DELAYS) - 1)]
            print(f"  attempt {attempt}: 0 rows (AMFI block page?), retrying in {delay}s",
                  file=sys.stderr)
            time.sleep(delay)
    return {}


# ── Fallback source: api.mfapi.in ──────────────────────────────────────────
# When AMFI blocks the runner outright, fall back to api.mfapi.in — a
# programmatic mirror of the same AMFI NAV data, keyed by the identical scheme
# code, that (unlike AMFI's own site) is built to be called from servers. It is
# per-scheme, not bulk, so we fetch only the funds actually held — the ISINs in
# mfmapping.json, resolved to scheme codes through amfi_isin_map.json — and
# MERGE those fresh NAVs into whatever amfi_nav.json already holds. That keeps
# the broad snapshot intact while refreshing the handful of schemes the
# dashboard actually looks up, and it needs ~20 requests rather than 14,000.
MFAPI_LATEST_URL = "https://api.mfapi.in/mf/{code}/latest"
MFAPI_MAP_FILE = "amfi_isin_map.json"
MFAPI_HOLDINGS_FILE = "mfmapping.json"


def _held_funds():
    """(ISIN, scheme code) for each held mutual fund, via the ISIN map.

    The ISIN comes straight from mfmapping.json; the scheme code (the key both
    api.mfapi.in and amfi_nav.json use) is resolved through amfi_isin_map.json.
    Both are carried because the fallbacks key differently — mfapi by scheme
    code, Yahoo by ISIN — while the output file is always keyed by scheme code.
    """
    try:
        with open(MFAPI_HOLDINGS_FILE) as f:
            rows = json.load(f)
        with open(MFAPI_MAP_FILE) as f:
            isin_map = (json.load(f) or {}).get("data") or {}
    except (OSError, ValueError) as exc:
        print(f"  fallback: cannot read holdings/ISIN map ({exc})", file=sys.stderr)
        return []
    funds, seen = [], set()
    for row in rows[1:] if isinstance(rows, list) else []:
        isin = (row[6].strip().upper() if len(row) > 6 and row[6] else "")
        code = isin_map.get(isin)
        if code and code not in seen:
            seen.add(code)
            funds.append((isin, str(code)))
    return funds


def fetch_from_mfapi(codes):
    """Latest NAV per scheme code from api.mfapi.in. Skips any that fail."""
    out = {}
    for code in codes:
        try:
            r = requests.get(MFAPI_LATEST_URL.format(code=code),
                             headers=REQUEST_HEADERS, timeout=30)
            r.raise_for_status()
            body = r.json()
            row = (body.get("data") or [None])[0]
            nav = (row or {}).get("nav")
            date = (row or {}).get("date")
            if nav and date:
                float(nav)  # validate
                out[str(code)] = {"date": date, "nav": nav}
        except (requests.RequestException, ValueError, KeyError, IndexError) as exc:
            print(f"  fallback: scheme {code} failed ({exc})", file=sys.stderr)
    return out


# ── Second fallback: Yahoo Finance ─────────────────────────────────────────
# When AMFI blocks AND api.mfapi.in cannot supply a held fund, resolve the fund
# on Yahoo BY ITS ISIN — the same identifier already in mfmapping.json — via
# Yahoo's search endpoint, then read the latest NAV from the chart endpoint.
# Plain HTTP (no yfinance) so this workflow keeps installing only `requests`.
# Output is keyed by AMFI scheme code, like every other source, so the merge
# and the dashboard's ISIN→code→NAV lookup are unaffected.
YAHOO_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search"
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
YAHOO_HEADERS = {
    "User-Agent": REQUEST_HEADERS["User-Agent"],
    "Accept": "application/json,text/plain,*/*",
}


def _yahoo_symbol_for_isin(isin):
    # Ask for several matches, not one: Yahoo does not always rank the fund
    # first for an ISIN, and quotesCount=1 then hands back a row with no symbol
    # (or the wrong instrument) — which is how a fund as common as Parag Parikh
    # Flexi Cap came back "no symbol". Prefer an explicit mutual-fund hit, then
    # any quote that carries a symbol. One empty retry covers a transient blank
    # response under the burst of per-fund lookups.
    for attempt in (1, 2):
        r = requests.get(YAHOO_SEARCH_URL,
                         params={"q": isin, "quotesCount": 10, "newsCount": 0},
                         headers=YAHOO_HEADERS, timeout=30)
        r.raise_for_status()
        quotes = r.json().get("quotes") or []
        for q in quotes:
            if q.get("quoteType") == "MUTUALFUND" and q.get("symbol"):
                return q["symbol"]
        for q in quotes:
            if q.get("symbol"):
                return q["symbol"]
        if attempt == 1:
            time.sleep(1)
    return None


def _yahoo_latest_nav(symbol):
    r = requests.get(YAHOO_CHART_URL.format(symbol=symbol),
                     params={"range": "1mo", "interval": "1d"},
                     headers=YAHOO_HEADERS, timeout=30)
    r.raise_for_status()
    result = ((r.json().get("chart") or {}).get("result") or [None])[0]
    if not result:
        return None
    ts = result.get("timestamp") or []
    closes = (((result.get("indicators") or {}).get("quote") or [{}])[0]).get("close") or []
    # Walk back to the most recent non-null close — a fund's latest published NAV.
    for i in range(len(closes) - 1, -1, -1):
        if closes[i] is not None and i < len(ts):
            date = datetime.fromtimestamp(ts[i], tz=timezone.utc).strftime("%d-%m-%Y")
            return {"date": date, "nav": f"{float(closes[i]):.5f}"}
    return None


def fetch_from_yahoo(funds):
    """Latest NAV for each (isin, code) from Yahoo. Keyed by scheme code."""
    out = {}
    for isin, code in funds:
        try:
            symbol = _yahoo_symbol_for_isin(isin)
            if not symbol:
                print(f"  yahoo: no symbol for {isin}", file=sys.stderr)
                continue
            nav = _yahoo_latest_nav(symbol)
            if nav:
                out[str(code)] = nav
        except (requests.RequestException, ValueError, KeyError, IndexError) as exc:
            print(f"  yahoo: {isin} failed ({exc})", file=sys.stderr)
    return out


def _load_existing_data():
    try:
        with open(OUTPUT_FILE) as f:
            return (json.load(f) or {}).get("data") or {}
    except (OSError, ValueError):
        return {}


def main():
    print("Fetching AMFI NAVAll.txt …")
    scheme_to_nav = fetch_scheme_code_to_nav()

    if scheme_to_nav:
        payload = {"fetchedAt": int(time.time() * 1000), "data": scheme_to_nav}
        with open(OUTPUT_FILE, "w") as f:
            json.dump(payload, f, indent=2)
        print(f"Saved {len(scheme_to_nav)} scheme NAVs to {OUTPUT_FILE}")
        return

    # AMFI blocked every attempt. Fall back for the held funds only and merge
    # onto the existing snapshot rather than shrinking it. Two fallbacks, in
    # order: api.mfapi.in first, then Yahoo Finance for anything mfapi missed.
    funds = _held_funds()

    print("  AMFI blocked; 1st fallback — api.mfapi.in for held funds …",
          file=sys.stderr)
    fresh = fetch_from_mfapi([code for _, code in funds]) if funds else {}
    mfapi_n = len(fresh)

    missing = [(isin, code) for isin, code in funds if code not in fresh]
    yahoo_n = 0
    if missing:
        print(f"  api.mfapi.in supplied {mfapi_n}; 2nd fallback — Yahoo Finance "
              f"for {len(missing)} remaining …", file=sys.stderr)
        yahoo = fetch_from_yahoo(missing)
        yahoo_n = len(yahoo)
        fresh.update(yahoo)

    # Never overwrite good data with an empty map — if AMFI, api.mfapi.in AND
    # Yahoo all come back empty, fail loudly instead of publishing "data": {}.
    if not fresh:
        raise RuntimeError(
            "AMFI returned no NAV rows and both fallbacks (api.mfapi.in, Yahoo "
            "Finance) yielded nothing; refusing to overwrite %s with empty data"
            % OUTPUT_FILE
        )

    merged = _load_existing_data()
    merged.update(fresh)
    payload = {"fetchedAt": int(time.time() * 1000), "data": merged}
    with open(OUTPUT_FILE, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"Saved {len(merged)} scheme NAVs to {OUTPUT_FILE} "
          f"(held funds refreshed: {mfapi_n} via api.mfapi.in, "
          f"{yahoo_n} via Yahoo Finance)")


if __name__ == "__main__":
    try:
        main()
    except (requests.RequestException, RuntimeError) as exc:
        print(f"Failed to fetch AMFI data: {exc}", file=sys.stderr)
        sys.exit(1)
