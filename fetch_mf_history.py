#!/usr/bin/env python3
"""
Builds mf_history.json: the full NAV history of every mutual fund in the user's
mapping, in ONE file.

Why this exists
---------------
Without it the dashboard asks api.mfapi.in for one fund at a time, from the
browser, on every cold load — eighteen requests for an eighteen-fund portfolio,
per user, per day, against a free community service. The stocks side has worked
the other way round for a while (fetch_stock_prices.py writes stock_history.json
and the browser makes one same-origin request); this is the same arrangement for
funds.

Which funds
-----------
From mfmapping.json, which the dashboard pushes to the repo whenever the Mutual
Fund Mapping sheet is synced — exactly how stocksetf_mapping.json feeds the stock
job. A fund the file has not caught up with yet is not a problem: the client
falls back to api.mfapi.in for anything missing from the bundle.

Sources
-------
api.mfapi.in is the primary source. Yahoo Finance is merged in as a gap-fill
(resolved per fund by ISIN): it supplies only the NAV dates mfapi is missing, so
the history keeps advancing even when mfapi lags AMFI or lacks a fund outright.
mfapi stays authoritative for the dates it does provide.

Format
------
    {"updated": "...", "mf_history": {"<schemeCode>": {"YYYY-MM-DD": nav, ...}}}

Dates as ISO keys and bare numbers for values, which is what stock_history.json
does — it keeps the file roughly half the size of a list of {date, nav} objects,
and the client indexes it by date anyway.
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    print("requests not installed. Run: pip install requests")
    sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
MAPPING_FILE = os.path.join(HERE, "mfmapping.json")
OUTPUT_FILE = os.path.join(HERE, "mf_history.json")
ISIN_MAP_FILE = os.path.join(HERE, "amfi_isin_map.json")

MFAPI_URL = "https://api.mfapi.in/mf/{code}"
TIMEOUT = 30
RETRIES = 3
# Courtesy pause between requests. This job runs once a day against a free
# service; there is no reason to hammer it.
PAUSE_S = 0.4

MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
          "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}


def scheme_codes_from_mapping():
    """Scheme codes out of the pushed mapping sheet, in sheet order, de-duplicated."""
    if not os.path.exists(MAPPING_FILE):
        print(f"No {MAPPING_FILE}; nothing to do. "
              "Sync the Mutual Fund Mapping sheet in the dashboard to create it.")
        return []
    with open(MAPPING_FILE) as f:
        rows = json.load(f)
    if not rows or len(rows) < 2:
        return []

    header = [str(c or "").strip().lower() for c in rows[0]]
    code_idx = next((i for i, h in enumerate(header) if "scheme code" in h), None)
    name_idx = next((i for i, h in enumerate(header) if "instrument name" in h), None)
    # An ISIN identifies the fund just as well, and it is what the pushed sheet
    # actually carries: the mapping arrives with the Stocks/ETF header
    # (Market Segment / Region / Identifier) rather than the Mutual Fund one, so
    # there is no Scheme Code column at all. Requiring one meant zero funds
    # found, a "nothing to do" exit, and a green workflow that had never once
    # produced this file. amfi_isin_map.json is already in the repo for exactly
    # this translation, so use it rather than depending on which header arrived.
    isin_idx = next((i for i, h in enumerate(header)
                     if "isin" in h or "identifier" in h), None)
    isin_map = {}
    if isin_idx is not None and os.path.exists(ISIN_MAP_FILE):
        try:
            with open(ISIN_MAP_FILE) as f:
                isin_map = (json.load(f) or {}).get("data") or {}
        except (ValueError, OSError) as e:
            print(f"WARNING: could not read {ISIN_MAP_FILE}: {e}")

    if code_idx is None and not isin_map:
        print(f"WARNING: {MAPPING_FILE} has no 'Scheme Code' column and no ISIN "
              f"map to fall back on; header was {header}")
        return []

    out, seen, unresolved = [], set(), []
    for row in rows[1:]:
        code = ""
        if code_idx is not None and code_idx < len(row):
            code = str(row[code_idx] or "").strip()
        # The ISIN is captured for every row (not only when the scheme code is
        # missing) because it doubles as the Yahoo Finance lookup key for the
        # gap-fill pass below.
        isin = ""
        if isin_idx is not None and isin_idx < len(row):
            isin = str(row[isin_idx] or "").strip().upper()
        if not code.isdigit() and isin:
            code = str(isin_map.get(isin) or "").strip()
            if not code.isdigit():
                unresolved.append(isin)
        # Scheme codes are numeric; anything else is a blank row or a stray note.
        if not code.isdigit() or code in seen:
            continue
        seen.add(code)
        name = str(row[name_idx] or "").strip() if name_idx is not None and name_idx < len(row) else ""
        out.append({"code": code, "name": name or code, "isin": isin})
    if unresolved:
        print(f"{len(unresolved)} identifier(s) had no scheme code in the ISIN map, "
              f"e.g. {unresolved[:3]}")
    return out


def parse_mfapi_date(s):
    """mfapi dates are dd-mm-yyyy. Returns an ISO date string, or None."""
    parts = str(s or "").split("-")
    if len(parts) != 3:
        return None
    d, m, y = parts
    # Defensive: mfapi is numeric, but a month name here would otherwise become a
    # silently wrong date rather than a skipped row.
    if not m.isdigit():
        m = MONTHS.get(m[:3].lower())
        if not m:
            return None
    try:
        return datetime(int(y), int(m), int(d)).strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def fetch_one(code, name):
    last_err = None
    for attempt in range(RETRIES):
        try:
            r = requests.get(MFAPI_URL.format(code=code), timeout=TIMEOUT)
            if r.status_code != 200:
                last_err = f"HTTP {r.status_code}"
            else:
                payload = r.json()
                series = {}
                for entry in payload.get("data") or []:
                    iso = parse_mfapi_date(entry.get("date"))
                    if not iso:
                        continue
                    try:
                        nav = float(entry.get("nav"))
                    except (TypeError, ValueError):
                        continue
                    if nav > 0:
                        series[iso] = nav
                if series:
                    return series, None
                last_err = "no usable NAV rows"
        except Exception as e:  # noqa: BLE001 - a bad fund must not fail the run
            last_err = str(e)
        if attempt < RETRIES - 1:
            time.sleep(1.5 * (attempt + 1))
    return None, last_err


# ── Gap-fill source: Yahoo Finance ─────────────────────────────────────────
# api.mfapi.in is the primary history source, but it can lag AMFI by days and
# occasionally lacks a fund entirely. When that happens the persistent history
# stalls — and if AMFI is also blocking the daily amfi_nav.json job, the only
# fresh point the client sees is the single Yahoo tail it appends in the browser,
# leaving the in-between days missing. So resolve each fund on Yahoo by its ISIN
# (the same identifier and endpoints fetch_amfi_nav.py already uses) and merge
# any NAV dates mfapi did not supply — extending the recent tail and, for a fund
# mfapi failed outright, supplying the whole series. mfapi stays authoritative
# for the dates it does provide; Yahoo only fills the holes.
YAHOO_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search"
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
YAHOO_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
    "Accept": "application/json,text/plain,*/*",
}


def _yahoo_symbol_for_isin(isin):
    # Ask for several matches, not one: Yahoo does not always rank the fund first
    # for an ISIN, and quotesCount=1 can hand back a row with no symbol. Prefer an
    # explicit mutual-fund hit, then any quote that carries a symbol. One empty
    # retry covers a transient blank response.
    for attempt in (1, 2):
        try:
            r = requests.get(YAHOO_SEARCH_URL,
                             params={"q": isin, "quotesCount": 10, "newsCount": 0},
                             headers=YAHOO_HEADERS, timeout=TIMEOUT)
            r.raise_for_status()
            quotes = r.json().get("quotes") or []
        except Exception:  # noqa: BLE001 - a bad lookup must not fail the run
            quotes = []
        for q in quotes:
            if q.get("quoteType") == "MUTUALFUND" and q.get("symbol"):
                return q["symbol"]
        for q in quotes:
            if q.get("symbol"):
                return q["symbol"]
        if attempt == 1:
            time.sleep(1)
    return None


def fetch_yahoo_history(isin):
    """Full daily NAV history for a fund from Yahoo, by ISIN. {iso: nav} or {}."""
    if not isin:
        return {}
    symbol = _yahoo_symbol_for_isin(isin)
    if not symbol:
        return {}
    try:
        r = requests.get(YAHOO_CHART_URL.format(symbol=symbol),
                         params={"range": "10y", "interval": "1d"},
                         headers=YAHOO_HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        result = ((r.json().get("chart") or {}).get("result") or [None])[0]
    except Exception:  # noqa: BLE001
        return {}
    if not result:
        return {}
    ts = result.get("timestamp") or []
    closes = (((result.get("indicators") or {}).get("quote") or [{}])[0]).get("close") or []
    series = {}
    for i in range(min(len(ts), len(closes))):
        c = closes[i]
        if c is None:
            continue
        try:
            nav = float(c)
        except (TypeError, ValueError):
            continue
        if nav > 0:
            iso = datetime.fromtimestamp(ts[i], tz=timezone.utc).strftime("%Y-%m-%d")
            series[iso] = nav
    return series


def main():
    schemes = scheme_codes_from_mapping()
    if not schemes:
        # Not an error: a repo whose owner has not synced a mapping yet simply has
        # no funds to bundle, and the client keeps using its per-fund fallback.
        print("No scheme codes found; leaving any existing mf_history.json alone.")
        return 0

    print(f"Fetching NAV history for {len(schemes)} scheme(s)…")
    history, failures = {}, []
    for i, s in enumerate(schemes):
        series, err = fetch_one(s["code"], s["name"])

        # Merge Yahoo's history over the mfapi result: mfapi keeps every date it
        # supplied; Yahoo adds only the dates mfapi is missing (recent tail while
        # mfapi lags, or the entire series when mfapi failed).
        yseries = fetch_yahoo_history(s.get("isin"))
        yahoo_added = 0
        if yseries:
            merged = dict(series or {})
            for iso, nav in yseries.items():
                if iso not in merged:
                    merged[iso] = nav
                    yahoo_added += 1
            if merged:
                series = merged

        if series:
            history[s["code"]] = series
            extra = f" (+{yahoo_added} from Yahoo)" if yahoo_added else ""
            note = " [mfapi failed: " + err + "]" if err and yahoo_added else ""
            print(f"  {s['name']} ({s['code']}): {len(series)} NAVs{extra}{note}")
        else:
            failures.append(f"{s['name']} ({s['code']}): {err}")
            print(f"  WARNING: {s['name']} ({s['code']}) failed: {err}")
        if i < len(schemes) - 1:
            time.sleep(PAUSE_S)

    if not history:
        # Writing an empty bundle would tell the client "no history exists" for
        # every fund, which is worse than having no bundle at all.
        print("ERROR: every scheme failed; refusing to overwrite mf_history.json")
        return 1

    # A fund that failed today keeps whatever it had, rather than vanishing from
    # the bundle and pushing that user back to per-fund requests.
    if failures and os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE) as f:
                previous = (json.load(f) or {}).get("mf_history") or {}
            kept = 0
            for code, series in previous.items():
                if code not in history and series:
                    history[code] = series
                    kept += 1
            if kept:
                print(f"Kept {kept} scheme(s) from the previous file after fetch failures")
        except Exception as e:  # noqa: BLE001
            print(f"Could not read previous {OUTPUT_FILE}: {e}")

    payload = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mf_history": history,
    }
    with open(OUTPUT_FILE, "w") as f:
        json.dump(payload, f, separators=(",", ":"))

    total = sum(len(v) for v in history.values())
    size_mb = os.path.getsize(OUTPUT_FILE) / 1048576
    print(f"\nWrote {OUTPUT_FILE}: {len(history)} scheme(s), {total} NAVs, {size_mb:.2f} MB")
    if failures:
        print(f"{len(failures)} scheme(s) failed this run:")
        for f_ in failures:
            print("  " + f_)
    return 0


if __name__ == "__main__":
    sys.exit(main())
