#!/usr/bin/env python3
"""Upsert a small "live" subset of a market-data JSON file into Supabase.

Used by the Fetch/Update workflows so the dashboard can read fresh prices /
corporate actions directly from Supabase — no GitHub Pages deploy in the loop.
Only the fast-changing, small parts are published (the bulky *_history series
stay in the static JSON on Pages, which the client overlays these onto).

Env:
  SUPABASE_URL                e.g. https://xxxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY   service-role key (server-side only)

Usage: python publish_market_data.py stock_prices
Exits 0 (no-op) when the service-role key is absent, so the workflow never
fails just because the secret hasn't been configured yet.
"""
import json
import os
import sys
import urllib.request
import urllib.error

# key -> (source file, function selecting the small live payload from the file)
FEEDS = {
    "stock_prices": (
        "stock_prices.json",
        lambda d: {
            "prices": d.get("prices", {}),
            "corporate_actions": d.get("corporate_actions", {}),
            "updated": d.get("updated"),
        },
    ),
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in FEEDS:
        print(f"Usage: {sys.argv[0]} <{'|'.join(FEEDS)}>")
        sys.exit(2)
    key = sys.argv[1]
    src_file, select = FEEDS[key]

    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not service_key:
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipping Supabase publish.")
        return

    with open(src_file) as f:
        full = json.load(f)
    payload = [{"key": key, "data": select(full), "updated_at": full.get("updated")}]
    body = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        f"{url}/rest/v1/market_data?on_conflict=key",
        data=body,
        method="POST",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"Published '{key}' to Supabase (HTTP {resp.status}, {len(body)} bytes).")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:500]
        print(f"ERROR publishing '{key}' to Supabase: HTTP {e.code} — {detail}")
        sys.exit(1)


if __name__ == "__main__":
    main()
