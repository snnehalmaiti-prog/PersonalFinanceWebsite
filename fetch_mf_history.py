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
    try:
        code_idx = next(i for i, h in enumerate(header) if "scheme code" in h)
    except StopIteration:
        print(f"WARNING: {MAPPING_FILE} has no 'Scheme Code' column; header was {header}")
        return []
    name_idx = next((i for i, h in enumerate(header) if "instrument name" in h), None)

    out, seen = [], set()
    for row in rows[1:]:
        if code_idx >= len(row):
            continue
        code = str(row[code_idx] or "").strip()
        # Scheme codes are numeric; anything else is a blank row or a stray note.
        if not code.isdigit() or code in seen:
            continue
        seen.add(code)
        name = str(row[name_idx] or "").strip() if name_idx is not None and name_idx < len(row) else ""
        out.append({"code": code, "name": name or code})
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
        if series:
            history[s["code"]] = series
            print(f"  {s['name']} ({s['code']}): {len(series)} NAVs")
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
