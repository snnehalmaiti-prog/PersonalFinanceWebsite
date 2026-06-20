import pandas as pd

INPUT_FILE = "Equity_Transactions.xlsx"


def compute_current_invested_amount(df):
    df = df.copy()
    df["Transaction Type"] = df["Transaction Type"].astype(str).str.strip().str.lower()
    df["Units"] = pd.to_numeric(df["Units"], errors="coerce").fillna(0)
    df["Value"] = pd.to_numeric(df["Value"], errors="coerce").fillna(0)

    buys = df[df["Transaction Type"] == "buy"]
    sells = df[df["Transaction Type"] == "sell"]

    buy_summary = buys.groupby("Instrument Name").agg(
        **{"Total Buy Units": ("Units", "sum"), "Total Buy Value": ("Value", "sum")}
    )
    sell_summary = sells.groupby("Instrument Name").agg(
        **{"Total Sell Units": ("Units", "sum")}
    )

    instruments = df["Instrument Name"].dropna().unique()
    summary = pd.DataFrame(index=instruments)
    summary = summary.join(buy_summary).join(sell_summary)
    summary[["Total Buy Units", "Total Buy Value", "Total Sell Units"]] = summary[
        ["Total Buy Units", "Total Buy Value", "Total Sell Units"]
    ].fillna(0)

    summary["Remaining Units"] = summary["Total Buy Units"] - summary["Total Sell Units"]
    # Avoid div-by-zero for instruments with no buys; avg price is undefined (0) in that case.
    summary["Avg Buy Price"] = (summary["Total Buy Value"] / summary["Total Buy Units"]).where(
        summary["Total Buy Units"] > 0, 0
    )
    # Sold more than bought -> no remaining position, invested amount floors at 0.
    summary["Remaining Units"] = summary["Remaining Units"].clip(lower=0)
    summary["Current Invested Amount"] = summary["Remaining Units"] * summary["Avg Buy Price"]

    summary = summary.reset_index().rename(columns={"index": "Instrument Name"})
    return summary[
        [
            "Instrument Name",
            "Total Buy Units",
            "Total Buy Value",
            "Total Sell Units",
            "Remaining Units",
            "Avg Buy Price",
            "Current Invested Amount",
        ]
    ]


def main():
    df = pd.read_excel(INPUT_FILE, header=4)
    summary = compute_current_invested_amount(df)

    pd.set_option("display.float_format", lambda v: f"{v:,.2f}")
    print(summary.to_string(index=False))

    grand_total = summary["Current Invested Amount"].sum()
    print(f"\nGrand total Current Invested Amount: {grand_total:,.2f}")


if __name__ == "__main__":
    main()
