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
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import requests

AMFI_NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt"
# Same file, different host. When the www edge is serving anti-bot pages the
# portal edge is sometimes still handing out the real feed (and vice versa), so
# both are tried each round.
AMFI_NAV_URLS = [
    "https://www.amfiindia.com/spages/NAVAll.txt",
    "https://portal.amfiindia.com/spages/NAVAll.txt",
]
AMFI_HOME = "https://www.amfiindia.com/"
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


def _prime_session():
    """A browser-like session that has first visited AMFI's homepage.

    AMFI's anti-bot gate lets a request through far more often when it arrives
    with the cookies the site hands out on a normal page view — a plain
    requests.get for NAVAll.txt has none, which is a large part of why the
    header-only approach kept getting block pages. So open a Session, load the
    homepage to collect its cookies, and reuse them for the data request.
    """
    session = requests.Session()
    session.headers.update(REQUEST_HEADERS)
    try:
        session.get(AMFI_HOME, timeout=30)
    except requests.RequestException:
        pass
    return session


def fetch_scheme_code_to_nav():
    session = _prime_session()
    for attempt in range(1, MAX_ATTEMPTS + 1):
        for url in AMFI_NAV_URLS:
            try:
                response = session.get(url, timeout=30)
                response.raise_for_status()
                scheme_to_nav = _parse_nav(response.text)
            except requests.RequestException as exc:
                print(f"  attempt {attempt} {url}: {exc}", file=sys.stderr)
                continue
            if scheme_to_nav:
                print(f"  got {len(scheme_to_nav)} rows on attempt {attempt} from {url}")
                return scheme_to_nav
        if attempt < MAX_ATTEMPTS:
            delay = RETRY_DELAYS[min(attempt - 1, len(RETRY_DELAYS) - 1)]
            print(f"  attempt {attempt}: 0 rows (AMFI block page?), retrying in {delay}s",
                  file=sys.stderr)
            time.sleep(delay)
    return {}


# ── Fallback source: api.mfapi.in ──────────────────────────────────────────
# One of the two fallbacks queried in parallel when AMFI is blocked; per fund
# the newer NAV date wins (see main). api.mfapi.in is a
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
    """(ISIN, scheme code) for each held mutual fund.

    The scheme code (the key both api.mfapi.in and amfi_nav.json use) is taken
    from a "Scheme Code" column in mfmapping.json when the mapping sheet carries
    one — which removes any dependency on AMFI for resolution — and otherwise
    resolved from the ISIN through amfi_isin_map.json. Columns are located by
    header name rather than fixed position, so adding the Scheme Code column
    does not shift the ISIN read. The ISIN is still carried alongside because the
    Yahoo fallback keys on it, while the output file is always keyed by scheme
    code.
    """
    try:
        with open(MFAPI_HOLDINGS_FILE) as f:
            rows = json.load(f)
        with open(MFAPI_MAP_FILE) as f:
            isin_map = (json.load(f) or {}).get("data") or {}
    except (OSError, ValueError) as exc:
        print(f"  fallback: cannot read holdings/ISIN map ({exc})", file=sys.stderr)
        return []
    if not isinstance(rows, list) or len(rows) < 2:
        return []
    header = [str(c or "").strip().lower() for c in rows[0]]
    code_idx = next((i for i, h in enumerate(header) if "scheme code" in h), None)
    isin_idx = next((i for i, h in enumerate(header)
                     if "isin" in h or "identifier" in h), None)
    funds, seen = [], set()
    for row in rows[1:]:
        isin = ""
        if isin_idx is not None and isin_idx < len(row) and row[isin_idx]:
            isin = str(row[isin_idx]).strip().upper()
        code = ""
        # Prefer a scheme code carried directly in the mapping sheet; fall back
        # to the AMFI ISIN map only when the sheet has no code for this row.
        if code_idx is not None and code_idx < len(row) and row[code_idx]:
            c = str(row[code_idx]).strip()
            if c.isdigit():
                code = c
        if not code and isin:
            code = str(isin_map.get(isin) or "").strip()
        if code.isdigit() and code not in seen:
            seen.add(code)
            funds.append((isin, code))
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


# ── Fallback source: Yahoo Finance ─────────────────────────────────────────
# The other of the two fallbacks queried in parallel when AMFI is blocked; per
# fund the newer NAV date wins (see main). Resolve each held fund on Yahoo BY
# ITS ISIN — the same identifier already in mfmapping.json — via
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


def _nav_date_key(entry):
    """Sortable (y, m, d) for a fallback NAV entry, or None.

    Both fallbacks emit the date as DD-MM-YYYY (Yahoo via strftime, mfapi as it
    is served), so one parser covers both and lets the two be compared to pick
    the fresher NAV.
    """
    if not entry or not entry.get("date"):
        return None
    parts = str(entry["date"]).split("-")
    if len(parts) != 3:
        return None
    try:
        d, m, y = int(parts[0]), int(parts[1]), int(parts[2])
        return (y, m, d)
    except ValueError:
        return None


def main():
    print("Fetching AMFI NAVAll.txt …")
    scheme_to_nav = fetch_scheme_code_to_nav()

    if scheme_to_nav:
        payload = {"fetchedAt": int(time.time() * 1000), "source": "AMFI",
                   "data": scheme_to_nav}
        with open(OUTPUT_FILE, "w") as f:
            json.dump(payload, f, indent=2)
        print(f"Saved {len(scheme_to_nav)} scheme NAVs to {OUTPUT_FILE}")
        return

    # AMFI blocked every attempt. Fall back for the held funds only and merge
    # onto the existing snapshot rather than shrinking it. Query BOTH Yahoo
    # Finance and api.mfapi.in concurrently and, per fund, keep whichever
    # returned the NEWER NAV date — either source can lag the other on any given
    # day, so picking the freshest per fund beats a fixed source order.
    funds = _held_funds()

    yahoo, mfapi = {}, {}
    if funds:
        print("  AMFI blocked; querying Yahoo Finance and api.mfapi.in in "
              "parallel; newest NAV date wins per fund …", file=sys.stderr)
        with ThreadPoolExecutor(max_workers=2) as ex:
            fy = ex.submit(fetch_from_yahoo, funds)
            fm = ex.submit(fetch_from_mfapi, [code for _, code in funds])
            yahoo = fy.result() or {}
            mfapi = fm.result() or {}

    fresh, yahoo_n, mfapi_n = {}, 0, 0
    for _, code in funds:
        y, m = yahoo.get(code), mfapi.get(code)
        yk, mk = _nav_date_key(y), _nav_date_key(m)
        if yk is not None and (mk is None or yk > mk):
            # Yahoo strictly newer (mfapi missing or older).
            fresh[code] = y
            yahoo_n += 1
        elif mk is not None:
            # mfapi newer, or the two tie (mfapi mirrors AMFI's official NAV, so
            # it wins ties), or only mfapi has a value.
            fresh[code] = m
            mfapi_n += 1
        elif y:
            # Neither carried a parseable date but Yahoo returned something.
            fresh[code] = y
            yahoo_n += 1

    # Never overwrite good data with an empty map — if AMFI, Yahoo AND
    # api.mfapi.in all come back empty, fail loudly instead of publishing
    # "data": {}.
    if not fresh:
        raise RuntimeError(
            "AMFI returned no NAV rows and both fallbacks (Yahoo Finance, "
            "api.mfapi.in) yielded nothing; refusing to overwrite %s with empty "
            "data" % OUTPUT_FILE
        )

    # Name the source(s) that actually won for the held funds this run, for the
    # dashboard's NAV-Data badge. AMFI is skipped here (it was blocked).
    parts = []
    if yahoo_n:
        parts.append("Yahoo Finance")
    if mfapi_n:
        parts.append("mfapi.in")
    source = " + ".join(parts) if parts else "fallback"

    merged = _load_existing_data()
    merged.update(fresh)
    payload = {"fetchedAt": int(time.time() * 1000), "source": source,
               "data": merged}
    with open(OUTPUT_FILE, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"Saved {len(merged)} scheme NAVs to {OUTPUT_FILE} "
          f"(held funds by newest date: {yahoo_n} from Yahoo Finance, "
          f"{mfapi_n} from api.mfapi.in)")


if __name__ == "__main__":
    try:
        main()
    except (requests.RequestException, RuntimeError) as exc:
        print(f"Failed to fetch AMFI data: {exc}", file=sys.stderr)
        sys.exit(1)
