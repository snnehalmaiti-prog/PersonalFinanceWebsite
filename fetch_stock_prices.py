#!/usr/bin/env python3
"""
Fetches stock prices for all configured tickers using yfinance and writes stock_prices.json.
Run by GitHub Actions on a schedule; the output file is committed to the repo so the
dashboard can fetch it as a same-origin static file (no CORS, no browser API keys).
"""

import json
import os
import sys
from datetime import datetime, timezone, timedelta

try:
    import yfinance as yf
except ImportError:
    print("yfinance not installed. Run: pip install yfinance")
    sys.exit(1)

MAPPING_FILE = os.path.join(os.path.dirname(__file__), "stocksetf_mapping.json")
TICKERS_FILE = os.path.join(os.path.dirname(__file__), ".github", "stock_tickers.json")  # fallback
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "stock_prices.json")
USD_INR_TICKER = "USDINR=X"
USD_INR_HISTORY_YEARS = 3

INDEX_TICKERS = [
    {"key": "NIFTY50",         "ticker": "^NSEI",               "label": "Nifty 50"},
    {"key": "NIFTYMIDCAP150",  "ticker": "NIFTYMIDCAP150.NS",   "label": "Nifty Midcap 150"},
    {"key": "NIFTYNEXT50",     "ticker": "^NSMIDCP",            "label": "Nifty Next 50"},
    {"key": "NIFTY500",        "ticker": "^CRSLDX",             "label": "Nifty 500"},
]


def load_tickers_from_mapping():
    """Derive ticker config from stocksetf_mapping.json (pushed by the dashboard on every sync)."""
    with open(MAPPING_FILE) as f:
        rows = json.load(f)
    if not rows or len(rows) < 2:
        return []
    header = [str(h).strip().lower() for h in rows[0]]
    instrument_idx  = next((i for i, h in enumerate(header) if h == "instrument name"), -1)
    region_idx      = next((i for i, h in enumerate(header) if h == "region"), -1)
    identifier_idx  = next((i for i, h in enumerate(header) if "identifier" in h), -1)
    if instrument_idx == -1 or region_idx == -1 or identifier_idx == -1:
        print("WARNING: stocksetf_mapping.json missing required columns (instrument name / region / identifier)")
        return []
    seen, tickers = set(), []
    for row in rows[1:]:
        def col(idx):
            return str(row[idx]).strip() if idx != -1 and idx < len(row) else ""
        name       = col(instrument_idx)
        region     = col(region_idx)
        identifier = col(identifier_idx)
        if not name or not region:
            continue
        if region == "US":
            price_key = identifier or name
            yf_ticker = price_key
            currency  = "USD"
        else:
            price_key = identifier or name   # use NSE symbol from Identifier column
            yf_ticker = price_key + ".NS"
            currency  = "INR"
        if price_key and price_key not in seen:
            seen.add(price_key)
            tickers.append({"name": price_key, "ticker": yf_ticker, "currency": currency})
    return tickers


def fetch_prices(tickers_config):
    """Fetch current price and previous close for each ticker."""
    prices = {}

    # Batch-download all tickers at once for efficiency
    all_tickers = [t["ticker"] for t in tickers_config] + [USD_INR_TICKER]
    # Use period="5d" to ensure we get at least two trading days
    try:
        raw = yf.download(
            all_tickers,
            period="5d",
            interval="1d",
            auto_adjust=True,
            progress=False,
            threads=True,
        )
        close = raw["Close"] if "Close" in raw else raw.get("Adj Close")
    except Exception as e:
        print(f"Batch download failed: {e}. Falling back to individual fetches.")
        close = None

    for entry in tickers_config:
        name = entry["name"]
        ticker = entry["ticker"]
        currency = entry["currency"]

        try:
            if close is not None and ticker in close.columns:
                series = close[ticker].dropna()
            else:
                # Individual fallback
                t = yf.Ticker(ticker)
                hist = t.history(period="5d", interval="1d", auto_adjust=True)
                series = hist["Close"].dropna()

            # If .NS returned no data, retry with .BO (BSE)
            if len(series) < 1 and ticker.endswith(".NS"):
                bo_ticker = ticker[:-3] + ".BO"
                try:
                    t2 = yf.Ticker(bo_ticker)
                    hist2 = t2.history(period="5d", interval="1d", auto_adjust=True)
                    series2 = hist2["Close"].dropna()
                    if len(series2) >= 1:
                        series = series2
                        print(f"  {ticker}: no data on NSE, falling back to {bo_ticker}")
                        ticker = bo_ticker
                except Exception:
                    pass

            if len(series) < 1:
                print(f"WARNING: No data for {ticker}")
                continue

            price = float(series.iloc[-1])
            prev_close = float(series.iloc[-2]) if len(series) >= 2 else price
            # Date of the latest bar — used by the anti-regression guard in main()
            # so a flaky run that returns the previous trading day can't overwrite
            # a newer price.
            try:
                bar_date = series.index[-1].strftime("%Y-%m-%d")
            except Exception:
                bar_date = None

            prices[name] = {
                "price": round(price, 4),
                "prev_close": round(prev_close, 4),
                "currency": currency,
                "date": bar_date,
            }
            print(f"  {ticker}: {price:.4f} (prev: {prev_close:.4f}) [{currency}] @ {bar_date}")

        except Exception as e:
            print(f"WARNING: Failed to fetch {ticker}: {e}")

    # USD/INR current rate
    try:
        if close is not None and USD_INR_TICKER in close.columns:
            series = close[USD_INR_TICKER].dropna()
        else:
            t = yf.Ticker(USD_INR_TICKER)
            hist = t.history(period="5d", interval="1d", auto_adjust=True)
            series = hist["Close"].dropna()

        if len(series) >= 1:
            usd_inr_price = float(series.iloc[-1])
            usd_inr_prev = float(series.iloc[-2]) if len(series) >= 2 else usd_inr_price
            prices["__USD_INR__"] = {
                "price": round(usd_inr_price, 4),
                "prev_close": round(usd_inr_prev, 4),
                "currency": "INR",
            }
            print(f"  USD/INR: {usd_inr_price:.4f}")
    except Exception as e:
        print(f"WARNING: Failed to fetch USD/INR rate: {e}")

    return prices


def fetch_corporate_actions(tickers_config):
    """Fetch historical stock splits for each ticker via yfinance."""
    print("Fetching corporate actions (splits)…")
    actions = {}
    for entry in tickers_config:
        name = entry["name"]
        ticker = entry["ticker"]
        try:
            t = yf.Ticker(ticker)
            splits = t.splits
            if splits is None or len(splits) == 0:
                continue
            ticker_actions = []
            for ts, ratio in splits.items():
                date_str = ts.strftime("%Y-%m-%d") if hasattr(ts, "strftime") else str(ts)[:10]
                ticker_actions.append({"date": date_str, "type": "split", "ratio": round(float(ratio), 6)})
            if ticker_actions:
                actions[name] = ticker_actions
                print(f"  {ticker}: {len(ticker_actions)} split event(s)")
        except Exception as e:
            print(f"WARNING: Failed to fetch splits for {ticker}: {e}")
    return actions


def fetch_usd_inr_history(years=USD_INR_HISTORY_YEARS):
    """Fetch multi-year daily USD/INR history for historical invested-cost conversion."""
    print(f"Fetching {years}-year USD/INR history…")
    try:
        t = yf.Ticker(USD_INR_TICKER)
        hist = t.history(period=f"{years}y", interval="1d", auto_adjust=True)
        series = hist["Close"].dropna()
        history = {}
        for ts, val in series.items():
            # ts may be a Timestamp; convert to date string
            date_str = ts.strftime("%Y-%m-%d") if hasattr(ts, "strftime") else str(ts)[:10]
            history[date_str] = round(float(val), 4)
        print(f"  Got {len(history)} daily USD/INR rates")
        return history
    except Exception as e:
        print(f"WARNING: Failed to fetch USD/INR history: {e}")
        return {}


def fetch_index_history(years=10):
    """Fetch multi-year daily closing prices for benchmark indices."""
    print(f"Fetching {years}-year index history…")
    result = {}
    for idx in INDEX_TICKERS:
        try:
            t = yf.Ticker(idx["ticker"])
            hist = t.history(period=f"{years}y", interval="1d", auto_adjust=True)
            series = hist["Close"].dropna()
            history = {}
            for ts, val in series.items():
                date_str = ts.strftime("%Y-%m-%d") if hasattr(ts, "strftime") else str(ts)[:10]
                history[date_str] = round(float(val), 4)
            if len(history) < 30:
                print(f"  WARNING: {idx['ticker']}: only {len(history)} days — skipping (insufficient history)")
                continue
            result[idx["key"]] = {"label": idx["label"], "ticker": idx["ticker"], "prices": history}
            print(f"  {idx['ticker']}: {len(history)} days")
        except Exception as e:
            print(f"WARNING: Failed to fetch index {idx['ticker']}: {e}")
    return result


def fetch_stock_history(tickers_config, years=10):
    """Fetch multi-year daily closing prices for each stock/ETF ticker."""
    print(f"Fetching {years}-year price history for {len(tickers_config)} stock/ETF ticker(s)…")
    result = {}
    for entry in tickers_config:
        name = entry["name"]
        ticker = entry["ticker"]
        currency = entry["currency"]
        try:
            t = yf.Ticker(ticker)
            hist = t.history(period=f"{years}y", interval="1d", auto_adjust=True)
            series = hist["Close"].dropna() if not hist.empty else None

            # Fallback to .BO if .NS returned nothing
            if (series is None or len(series) == 0) and ticker.endswith(".NS"):
                bo_ticker = ticker[:-3] + ".BO"
                try:
                    t2 = yf.Ticker(bo_ticker)
                    hist2 = t2.history(period=f"{years}y", interval="1d", auto_adjust=True)
                    series = hist2["Close"].dropna() if not hist2.empty else None
                    if series is not None and len(series) > 0:
                        print(f"  {ticker}: no history on NSE, fell back to {bo_ticker}")
                except Exception:
                    pass

            if series is None or len(series) == 0:
                print(f"  WARNING: No history for {ticker}")
                continue

            prices = {}
            for ts, val in series.items():
                date_str = ts.strftime("%Y-%m-%d") if hasattr(ts, "strftime") else str(ts)[:10]
                prices[date_str] = round(float(val), 4)

            result[name] = {"currency": currency, "prices": prices}
            print(f"  {ticker}: {len(prices)} days")
        except Exception as e:
            print(f"  WARNING: Failed to fetch history for {ticker}: {e}")
    return result


def main():
    if os.path.exists(MAPPING_FILE):
        print(f"Reading tickers from {MAPPING_FILE}")
        tickers_config = load_tickers_from_mapping()
        if not tickers_config:
            print("WARNING: No tickers derived from mapping file — falling back to stock_tickers.json")
            tickers_config = None
    else:
        tickers_config = None

    if tickers_config is None:
        if not os.path.exists(TICKERS_FILE):
            print(f"ERROR: Neither {MAPPING_FILE} nor {TICKERS_FILE} found.")
            sys.exit(1)
        print(f"Reading tickers from {TICKERS_FILE} (fallback)")
        with open(TICKERS_FILE) as f:
            tickers_config = json.load(f)

    print(f"Fetching prices for {len(tickers_config)} tickers…")
    prices = fetch_prices(tickers_config)

    # Anti-regression guard: yfinance's batch download intermittently returns the
    # PREVIOUS trading day's bar for a ticker, which would otherwise overwrite a
    # newer price with an older one. Compare each ticker's new bar date against
    # what's already in stock_prices.json and keep the existing (newer) value
    # when the new one is stale.
    try:
        with open(OUTPUT_FILE) as _pf:
            _old_prices = json.load(_pf).get("prices", {})
    except Exception:
        _old_prices = {}
    for _name, _new in list(prices.items()):
        _old = _old_prices.get(_name)
        if not _old:
            continue
        _nd, _od = _new.get("date"), _old.get("date")
        if _nd and _od and _nd < _od:
            print(f"  SKIP {_name}: fetched bar {_nd} is older than stored {_od} — keeping {_old.get('price')}")
            prices[_name] = _old

    usd_inr_history = fetch_usd_inr_history()
    index_history = fetch_index_history()
    stock_history = fetch_stock_history(tickers_config)

    # Reconcile the batch price against the per-ticker history. yfinance's batch
    # yf.download() sometimes returns a stale (previous trading day) bar, while the
    # per-ticker .history() call returns the latest — so when the history has a
    # FRESHER dated bar than the batch price, adopt it. This corrects/recovers a
    # ticker whose batch value regressed (e.g. HDFCBANK reverting to Friday's bar).
    for _name, _p in list(prices.items()):
        _sh = stock_history.get(_name)
        hp = _sh.get("prices") if isinstance(_sh, dict) else None
        if not hp:
            continue
        _hdates = sorted(hp.keys())
        _hlatest = _hdates[-1]
        if _p.get("date") and _hlatest <= _p["date"]:
            continue  # batch is same-day or newer — trust it
        _hprice = hp[_hlatest]
        _hprev = hp[_hdates[-2]] if len(_hdates) >= 2 else _hprice
        print(f"  RECONCILE {_name}: batch @ {_p.get('date')}={_p.get('price')} -> history @ {_hlatest}={_hprice}")
        prices[_name] = {"price": round(_hprice, 4), "prev_close": round(_hprev, 4),
                         "currency": _p.get("currency"), "date": _hlatest}

    corporate_actions = fetch_corporate_actions(tickers_config)

    output = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "prices": prices,
        "usd_inr_history": usd_inr_history,
        "index_history": index_history,
        "stock_history": stock_history,
        "corporate_actions": corporate_actions,
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, separators=(",", ":"))

    print(f"\nWrote {OUTPUT_FILE} with {len(prices)} prices, {len(usd_inr_history)} USD/INR history entries, {len(index_history)} index(es), {len(stock_history)} stock history series, and {len(corporate_actions)} ticker(s) with corporate actions.")


if __name__ == "__main__":
    main()
