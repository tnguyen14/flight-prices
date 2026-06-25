#!/usr/bin/env python3
"""CLI tool to search Google Flights and output structured JSON results."""

import json
import sys

import click

from libraries._fmt import time_to_minutes

STOPS_MAP = {
    "any": None,
    "nonstop": 0,
    "1stop": 1,
}


@click.command()
@click.option("--library", required=True, type=click.Choice(["swoop", "fast"]), help="Library to use for fetching flights")
@click.option("--from", "origin", required=True, help="Origin airport IATA code (e.g., SFO)")
@click.option("--to", "destination", required=True, help="Destination airport IATA code (e.g., NRT)")
@click.option("--depart", required=True, help="Departure date (YYYY-MM-DD)")
@click.option("--return", "return_date", default=None, help="Return date (YYYY-MM-DD); omit for one-way")
@click.option("--passengers", default=1, type=int, help="Number of adult passengers")
@click.option("--class", "cabin", default="economy", type=click.Choice(["economy", "premium-economy", "business", "first"]))
@click.option("--stops", default="any", type=click.Choice(["any", "nonstop", "1stop"]))
@click.option("--sort", "sort_by", default="departure", type=click.Choice(["price", "departure", "arrival", "duration", "none"]))
@click.option("--debug", is_flag=True, help="Print debug info to stderr")
def main(library, origin, destination, depart, return_date, passengers, cabin, stops, sort_by, debug):
    """Search Google Flights and output results as JSON."""
    if library == "swoop":
        from libraries.swoop import search_flights
    else:
        from libraries.fast import search_flights

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

    sys.stdout.write(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
