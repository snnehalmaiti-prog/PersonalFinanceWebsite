#!/usr/bin/env python3
"""Unit tests for fetch_mf_history.py — the parts that can silently produce a
wrong bundle rather than fail loudly.

Run directly, or via tests/run-all.js.
"""
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import fetch_mf_history as mfh  # noqa: E402

passed = failed = 0


def ok(cond, name, detail=None):
    global passed, failed
    if cond:
        passed += 1
        print("  PASS  " + name)
    else:
        failed += 1
        print("  FAIL  " + name + ("  -> " + repr(detail) if detail is not None else ""))


# ── date parsing ──────────────────────────────────────────────────────────────
# mfapi is dd-mm-yyyy. Getting this wrong does not raise; it produces a bundle of
# plausible-looking wrong dates, which is the worst kind of failure.
ok(mfh.parse_mfapi_date("01-12-2024") == "2024-12-01", "D1 dd-mm-yyyy is read as numeric",
   mfh.parse_mfapi_date("01-12-2024"))
ok(mfh.parse_mfapi_date("31-07-2026") == "2026-07-31", "D2 end of month",
   mfh.parse_mfapi_date("31-07-2026"))
# 01-12 is ambiguous if you read it the American way; 13 in the middle is not.
ok(mfh.parse_mfapi_date("05-13-2024") is None,
   "D3 a month of 13 is rejected rather than rolled over", mfh.parse_mfapi_date("05-13-2024"))
ok(mfh.parse_mfapi_date("01-Dec-2024") == "2024-12-01",
   "D4 a month NAME is still handled, since amfi uses that form",
   mfh.parse_mfapi_date("01-Dec-2024"))
ok(mfh.parse_mfapi_date("") is None, "D5 empty", mfh.parse_mfapi_date(""))
ok(mfh.parse_mfapi_date("not-a-date") is None, "D6 rubbish", mfh.parse_mfapi_date("not-a-date"))
ok(mfh.parse_mfapi_date("30-02-2024") is None,
   "D7 an impossible day is rejected, not rolled into March", mfh.parse_mfapi_date("30-02-2024"))


# ── which schemes to fetch ────────────────────────────────────────────────────
def with_mapping(rows):
    """Point the module at a temporary mapping file."""
    fd, path = tempfile.mkstemp(suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(rows, f)
    old = mfh.MAPPING_FILE
    mfh.MAPPING_FILE = path
    try:
        return mfh.scheme_codes_from_mapping()
    finally:
        mfh.MAPPING_FILE = old
        os.unlink(path)


HEADER = ["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"]

got = with_mapping([HEADER, ["Fund A", "Equity", "Flexi Cap", "100033", "INF1"]])
ok(got == [{"code": "100033", "name": "Fund A"}], "M1 a mapped fund is picked up", got)

got = with_mapping([HEADER,
                    ["Fund A", "Equity", "Flexi Cap", "100033", "INF1"],
                    ["Fund A dup", "Equity", "Flexi Cap", "100033", "INF1"]])
ok(len(got) == 1, "M2 the same scheme code twice is fetched once", got)

got = with_mapping([HEADER,
                    ["Fund A", "Equity", "Flexi Cap", "100033", "INF1"],
                    ["No code", "Equity", "Flexi Cap", "", "INF2"],
                    ["Not numeric", "Equity", "Flexi Cap", "TBD", "INF3"]])
ok([g["code"] for g in got] == ["100033"],
   "M3 rows with no code, or a non-numeric one, are skipped rather than fetched", got)

# Column order is not guaranteed — the sheet is user-edited.
REORDERED = ["Scheme Code", "Instrument Name", "ISIN"]
got = with_mapping([REORDERED, ["100033", "Fund A", "INF1"]])
ok(got == [{"code": "100033", "name": "Fund A"}],
   "M4 columns are found by name, not position", got)

got = with_mapping([["Instrument Name", "ISIN"], ["Fund A", "INF1"]])
ok(got == [], "M5 a mapping with no Scheme Code column yields nothing, quietly", got)

got = with_mapping([HEADER])
ok(got == [], "M6 a header-only mapping yields nothing", got)

# A missing file must be a no-op, not a crash: a fresh repo has no mapping yet.
old = mfh.MAPPING_FILE
mfh.MAPPING_FILE = os.path.join(tempfile.gettempdir(), "definitely-not-here-xyz.json")
try:
    got = mfh.scheme_codes_from_mapping()
    ok(got == [], "M7 a missing mapping file is a no-op", got)
finally:
    mfh.MAPPING_FILE = old

print("\nRESULT: %d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
