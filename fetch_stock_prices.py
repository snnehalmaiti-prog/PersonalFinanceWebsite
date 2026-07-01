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

TICKERS_FILE = os.path.join(os.path.dirname(__file__), ".github", "stock_tickers.json")
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "stock_prices.json")
USD_INR_TICKER = "USDINR=X"
USD_INR_HISTORY_YEARS = 3


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

            if len(series) < 1:
                print(f"WARNING: No data for {ticker}")
                continue

            price = float(series.iloc[-1])
            prev_close = float(series.iloc[-2]) if len(series) >= 2 else price

            prices[name] = {
                "price": round(price, 4),
                "prev_close": round(prev_close, 4),
                "currency": currency,
            }
            print(f"  {ticker}: {price:.4f} (prev: {prev_close:.4f}) [{currency}]")

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


def main():
    if not os.path.exists(TICKERS_FILE):
        print(f"ERROR: Tickers config not found at {TICKERS_FILE}")
        sys.exit(1)

    with open(TICKERS_FILE) as f:
        tickers_config = json.load(f)

    print(f"Fetching prices for {len(tickers_config)} tickers…")
    prices = fetch_prices(tickers_config)

    usd_inr_history = fetch_usd_inr_history()

    output = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "prices": prices,
        "usd_inr_history": usd_inr_history,
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, separators=(",", ":"))

    print(f"\nWrote {OUTPUT_FILE} with {len(prices)} prices and {len(usd_inr_history)} USD/INR history entries.")


if __name__ == "__main__":
    main()
