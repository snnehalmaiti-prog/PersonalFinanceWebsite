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


def _held_scheme_codes():
    """Scheme codes for the mutual funds in mfmapping.json, via the ISIN map."""
    try:
        with open(MFAPI_HOLDINGS_FILE) as f:
            rows = json.load(f)
        with open(MFAPI_MAP_FILE) as f:
            isin_map = (json.load(f) or {}).get("data") or {}
    except (OSError, ValueError) as exc:
        print(f"  fallback: cannot read holdings/ISIN map ({exc})", file=sys.stderr)
        return []
    codes, seen = [], set()
    for row in rows[1:] if isinstance(rows, list) else []:
        isin = (row[6].strip().upper() if len(row) > 6 and row[6] else "")
        code = isin_map.get(isin)
        if code and code not in seen:
            seen.add(code)
            codes.append(code)
    return codes


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

    # AMFI blocked every attempt. Try the mirror for the held funds only, and
    # merge onto the existing snapshot rather than shrinking it.
    print("  AMFI blocked; trying api.mfapi.in for held funds …", file=sys.stderr)
    codes = _held_scheme_codes()
    fresh = fetch_from_mfapi(codes) if codes else {}

    # Never overwrite good data with an empty map — if both AMFI and the mirror
    # come back empty, fail loudly instead of quietly publishing "data": {}.
    if not fresh:
        raise RuntimeError(
            "AMFI returned no NAV rows and the api.mfapi.in fallback also yielded "
            "nothing; refusing to overwrite %s with empty data" % OUTPUT_FILE
        )

    merged = _load_existing_data()
    merged.update(fresh)
    payload = {"fetchedAt": int(time.time() * 1000), "data": merged}
    with open(OUTPUT_FILE, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"Saved {len(merged)} scheme NAVs to {OUTPUT_FILE} "
          f"({len(fresh)} refreshed from api.mfapi.in, held funds only)")


if __name__ == "__main__":
    try:
        main()
    except (requests.RequestException, RuntimeError) as exc:
        print(f"Failed to fetch AMFI data: {exc}", file=sys.stderr)
        sys.exit(1)
