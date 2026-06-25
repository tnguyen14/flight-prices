#!/usr/bin/env python3
"""CLI tool to search Google Flights using fast-flights v3 and output results as JSON.

Uses protobuf URL encoding + SSR HTML parsing instead of direct RPC calls.
More reliable than the RPC approach (search_swoop.py) since Google serves
flight data in the initial HTML render.
"""

import json
import sys
import time

import click
from fast_flights import FlightQuery, Passengers, create_filter
from fast_flights.exceptions import FlightsNotFound
from fast_flights.parser import parse
from primp import Client

STOPS_MAP = {
    "any": None,
    "nonstop": 0,
    "1stop": 1,
}

FLIGHTS_URL = "https://www.google.com/travel/flights"


def fetch_flights(query, max_retries=5):
    """Fetch and parse flights with retry on rate-limiting."""
    client = Client(impersonate="chrome", impersonate_os="macos", referer=True, cookie_store=True)

    for attempt in range(max_retries):
        res = client.get(FLIGHTS_URL, params=query.params())
        try:
            return parse(res.text)
        except (FlightsNotFound, RuntimeError, AttributeError):
            if attempt < max_retries - 1:
                delay = 5 * (attempt + 1)
                sys.stderr.write(f"No flights in response (rate-limited by Google), retrying in {delay}s... ({attempt + 1}/{max_retries})\n")
                time.sleep(delay)

    sys.stderr.write("No results after retries. Google may be rate-limiting this IP.\n")
    return None


def fmt_time(t) -> str:
    """Format (hour, minute) list as 'H:MM AM/PM'."""
    if not t:
        return "N/A"
    h = t[0] if t[0] is not None else 0
    m = t[1] if len(t) > 1 and t[1] is not None else 0
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


def time_to_minutes(time_str: str) -> int:
    """Convert 'H:MM AM/PM' to minutes since midnight for sorting."""
    import re
    m = re.match(r'(\d{1,2}):(\d{2})\s*(AM|PM)', time_str, re.IGNORECASE)
    if not m:
        return 0
    hours = int(m.group(1))
    minutes = int(m.group(2))
    period = m.group(3).upper()
    if period == "PM" and hours != 12:
        hours += 12
    if period == "AM" and hours == 12:
        hours = 0
    return hours * 60 + minutes


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
    """Search Google Flights and output results as JSON (fast-flights backend)."""
    flights = [FlightQuery(
        date=depart,
        from_airport=origin.upper(),
        to_airport=destination.upper(),
        max_stops=STOPS_MAP[stops],
    )]

    if return_date:
        flights.append(FlightQuery(
            date=return_date,
            from_airport=destination.upper(),
            to_airport=origin.upper(),
            max_stops=STOPS_MAP[stops],
        ))

    trip_type = "round-trip" if return_date else "one-way"

    query = create_filter(
        flights=flights,
        trip=trip_type,
        passengers=Passengers(adults=passengers),
        seat=cabin,
    )

    result = fetch_flights(query)
    if result is None:
        sys.stdout.write("[]\n")
        sys.exit(0)

    output = []
    for group in result:
        total_duration = sum(f.duration for f in group.flights)
        stops_count = len(group.flights) - 1

        output.append({
            "airline": ", ".join(group.airlines),
            "price": group.price,
            "currency": "USD",
            "departure": fmt_time(group.flights[0].departure.time),
            "arrival": fmt_time(group.flights[-1].arrival.time),
            "departure_date": fmt_date(group.flights[0].departure.date),
            "arrival_date": fmt_date(group.flights[-1].arrival.date),
            "duration_minutes": total_duration,
            "stops": stops_count,
            "legs": [
                {
                    "from": f.from_airport.code,
                    "to": f.to_airport.code,
                    "airline": group.airlines[0] if group.airlines else "Unknown",
                    "aircraft": f.plane_type or None,
                    "departure": fmt_time(f.departure.time),
                    "arrival": fmt_time(f.arrival.time),
                    "duration_minutes": f.duration,
                }
                for f in group.flights
            ],
            "carbon_emissions": {
                "grams": group.carbon.emission,
                "typical_grams": group.carbon.typical_on_route,
            } if group.carbon else None,
        })

    # Sort results
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
