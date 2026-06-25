#!/usr/bin/env python3
"""CLI tool to search Google Flights and output structured JSON results."""

import json
import sys

import click

from google_flights._fmt import time_to_minutes

STOPS_MAP = {
    "0": 0,
    "1": 1,
    "2": 2,
    "any": None,
}


def fmt_duration(minutes):
    """Format minutes as 'Xh Ym'."""
    if not minutes:
        return "—"
    h, m = divmod(minutes, 60)
    if h and m:
        return f"{h}h {m}m"
    elif h:
        return f"{h}h"
    else:
        return f"{m}m"


def build_route(flight):
    """Build route string like 'SFO→LAX→NRT' from legs."""
    legs = flight.get("legs", [])
    if not legs:
        return ""
    codes = [legs[0]["from"]]
    for leg in legs:
        codes.append(leg["to"])
    return "→".join(codes)


def print_table(results):
    """Print results as a formatted table."""
    rows = []
    for r in results:
        stops = r["stops"]
        stops_str = "nonstop" if stops == 0 else f"{stops} stop{'s' if stops > 1 else ''}"
        rows.append((
            r["airline"],
            f"${r['price']}" if r["price"] is not None else "—",
            r["departure"],
            r["arrival"],
            fmt_duration(r["duration_minutes"]),
            stops_str,
            build_route(r),
        ))

    headers = ("Airline", "Price", "Depart", "Arrive", "Duration", "Stops", "Route")

    widths = [len(h) for h in headers]
    for row in rows:
        for i, val in enumerate(row):
            widths[i] = max(widths[i], len(val))

    def fmt_row(row):
        parts = []
        for i, val in enumerate(row):
            if i == 1:  # Price: right-align
                parts.append(val.rjust(widths[i]))
            else:
                parts.append(val.ljust(widths[i]))
        return "  ".join(parts)

    print(fmt_row(headers))
    print("  ".join("─" * w for w in widths))
    for row in rows:
        print(fmt_row(row))


@click.command()
@click.option("--library", required=True, type=click.Choice(["swoop", "fast"]), help="Library to use for fetching flights")
@click.option("--from", "origin", required=True, help="Origin airport IATA code (e.g., SFO)")
@click.option("--to", "destination", required=True, help="Destination airport IATA code (e.g., NRT)")
@click.option("--depart", required=True, help="Departure date (YYYY-MM-DD)")
@click.option("--return", "return_date", default=None, help="Return date (YYYY-MM-DD); omit for one-way")
@click.option("--passengers", default=1, type=int, help="Number of adult passengers")
@click.option("--class", "cabin", default="economy", type=click.Choice(["economy", "premium-economy", "business", "first"]))
@click.option("--stops", default="0", type=click.Choice(["0", "1", "2", "any"]), help="Max stops (default: 0 = nonstop)")
@click.option("--sort", "sort_by", default="departure", type=click.Choice(["price", "departure", "arrival", "duration", "none"]))
@click.option("--json", "output_json", is_flag=True, help="Output as JSON instead of table")
@click.option("--debug", is_flag=True, help="Print debug info to stderr")
def main(library, origin, destination, depart, return_date, passengers, cabin, stops, sort_by, output_json, debug):
    """Search Google Flights and output results."""
    if library == "swoop":
        from google_flights.swoop import search_flights
    else:
        from google_flights.fast import search_flights

    output = search_flights(
        origin=origin.upper(),
        destination=destination.upper(),
        depart=depart,
        return_date=return_date,
        passengers=passengers,
        cabin=cabin,
        stops=STOPS_MAP[stops],
        sort_by=sort_by,
        debug=debug,
    )

    if not output:
        sys.stderr.write("No results found.\n")
        if output_json:
            sys.stdout.write("[]\n")
        sys.exit(0)

    if sort_by == "price":
        output.sort(key=lambda x: x["price"] if x["price"] is not None else float("inf"))
    elif sort_by == "duration":
        output.sort(key=lambda x: x["duration_minutes"])
    elif sort_by == "departure":
        output.sort(key=lambda x: time_to_minutes(x["departure"]))
    elif sort_by == "arrival":
        output.sort(key=lambda x: time_to_minutes(x["arrival"]))

    if output_json:
        sys.stdout.write(json.dumps(output, indent=2) + "\n")
    else:
        print_table(output)


if __name__ == "__main__":
    main()
