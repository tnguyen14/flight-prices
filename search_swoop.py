#!/usr/bin/env python3
"""CLI tool to search Google Flights using swoop and output results as JSON."""

import json
import sys
import time

import click
from swoop import (
    Passengers,
    search,
    SORT_CHEAPEST,
    SORT_DEPARTURE_TIME,
    SORT_ARRIVAL_TIME,
    SORT_DURATION,
    SORT_TOP,
)

SORT_MAP = {
    "price": SORT_CHEAPEST,
    "departure": SORT_DEPARTURE_TIME,
    "arrival": SORT_ARRIVAL_TIME,
    "duration": SORT_DURATION,
    "none": SORT_TOP,
}

STOPS_MAP = {
    "any": None,
    "nonstop": 0,
    "1stop": 1,
}


def fmt_time(t: tuple[int, int]) -> str:
    """Format (hour, minute) tuple as 'H:MM AM/PM'."""
    h, m = t
    if h == 0:
        return f"12:{m:02d} AM"
    elif h < 12:
        return f"{h}:{m:02d} AM"
    elif h == 12:
        return f"12:{m:02d} PM"
    else:
        return f"{h - 12}:{m:02d} PM"


def fmt_date(d: tuple[int, int, int]) -> str:
    """Format (year, month, day) tuple as 'YYYY-MM-DD'."""
    return f"{d[0]:04d}-{d[1]:02d}-{d[2]:02d}"


@click.command()
@click.option("--from", "origin", required=True, help="Origin airport IATA code (e.g., SFO)")
@click.option("--to", "destination", required=True, help="Destination airport IATA code (e.g., NRT)")
@click.option("--depart", required=True, help="Departure date (YYYY-MM-DD)")
@click.option("--return", "return_date", default=None, help="Return date (YYYY-MM-DD); omit for one-way")
@click.option("--passengers", default=1, type=int, help="Number of adult passengers")
@click.option("--class", "cabin", default="economy", type=click.Choice(["economy", "premium-economy", "business", "first"]))
@click.option("--stops", default="any", type=click.Choice(["any", "nonstop", "1stop"]))
@click.option("--sort", "sort_by", default="departure", type=click.Choice(["price", "departure", "arrival", "duration", "none"]))
def main(origin, destination, depart, return_date, passengers, cabin, stops, sort_by):
    """Search Google Flights and output results as JSON."""
    max_retries = 5
    results = None
    for attempt in range(max_retries):
        try:
            results = search(
                origin.upper(),
                destination.upper(),
                depart,
                return_date=return_date,
                cabin=cabin,
                passengers=Passengers(adults=passengers),
                max_stops=STOPS_MAP[stops],
                sort=SORT_MAP[sort_by],
                include_basic_economy=False,
            )
        except Exception as e:
            sys.stderr.write(f"Error: {e}\n")
            sys.exit(1)

        if results.results:
            break
        if attempt < max_retries - 1:
            delay = 5 * (attempt + 1)
            sys.stderr.write(f"Empty response (rate-limited by Google), retrying in {delay}s... ({attempt + 1}/{max_retries})\n")
            time.sleep(delay)

    if not results.results:
        sys.stderr.write("No results after retries. Google may be rate-limiting this IP.\n")
        sys.stderr.write("Tip: try search_fast.py which uses a different (more reliable) approach.\n")

    output = []
    for trip in results.results:
        for leg in trip.legs:
            it = leg.itinerary
            if not it:
                continue

            segments = it.segments or []
            layovers = it.layovers or []

            first_seg = segments[0] if segments else None
            last_seg = segments[-1] if segments else None

            output.append({
                "airline": ", ".join(it.airline_names) if it.airline_names else (first_seg.airline_name if first_seg else "Unknown"),
                "flight_numbers": [f"{s.airline}{s.flight_number}" for s in segments if s.flight_number],
                "price": trip.price,
                "currency": trip.currency or results.currency or "USD",
                "departure": fmt_time(it.departure_time),
                "arrival": fmt_time(it.arrival_time),
                "departure_date": fmt_date(it.departure_date),
                "arrival_date": fmt_date(it.arrival_date),
                "duration_minutes": it.travel_time,
                "stops": it.stop_count if it.stop_count is not None else len(layovers),
                "layovers": [
                    {
                        "airport": lv.departure_airport_code,
                        "duration_minutes": lv.minutes,
                        "overnight": lv.is_overnight,
                    }
                    for lv in layovers
                ],
                "legs": [
                    {
                        "from": s.departure_airport_code,
                        "to": s.arrival_airport_code,
                        "airline": s.airline_name or s.airline,
                        "flight_number": f"{s.airline}{s.flight_number}" if s.flight_number else None,
                        "aircraft": s.aircraft or None,
                        "departure": fmt_time(s.departure_time),
                        "arrival": fmt_time(s.arrival_time),
                        "duration_minutes": s.travel_time,
                        "legroom": s.legroom or None,
                    }
                    for s in segments
                ],
                "carbon_emissions": {
                    "grams": it.carbon_emissions.this_flight_grams,
                    "typical_grams": it.carbon_emissions.typical_for_route_grams,
                    "difference_percent": it.carbon_emissions.difference_percent,
                } if it.carbon_emissions else None,
            })

    sys.stdout.write(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
