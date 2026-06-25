#!/usr/bin/env python3
"""CLI tool to search Google Flights using fast-flights and output results as JSON.

Alternative implementation to search_flights.py (swoop). Uses protobuf URL
encoding + SSR HTML parsing instead of direct RPC calls. May return more
results but with less metadata per flight.
"""

import json
import re
import sys
import time

import click
import fast_flights.core
from fast_flights import FlightData, Passengers, get_flights
from primp import Client


def _fetch_with_working_profile(params: dict):
    client = Client(impersonate="chrome", verify=False)
    res = client.get("https://www.google.com/travel/flights", params=params)
    assert res.status_code == 200, f"{res.status_code} Result: {res.text_markdown}"
    return res


fast_flights.core.fetch = _fetch_with_working_profile


STOPS_MAP = {
    "any": None,
    "nonstop": 0,
    "1stop": 1,
}


def parse_price(price_str: str) -> tuple[int | None, str]:
    """Parse price string like '$55' or '€120' into (amount, currency)."""
    if not price_str:
        return None, "USD"
    m = re.match(r'([£€$¥])?\s*([\d,]+)', price_str.strip())
    if not m:
        return None, "USD"
    symbol = m.group(1) or "$"
    amount = int(m.group(2).replace(",", ""))
    currency_map = {"$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY"}
    return amount, currency_map.get(symbol, "USD")


def parse_duration(duration_str: str) -> int:
    """Parse duration string like '1 hr 29 min' or '14 hr 5 min' into minutes."""
    if not duration_str:
        return 0
    total = 0
    hr_match = re.search(r'(\d+)\s*hr', duration_str)
    min_match = re.search(r'(\d+)\s*min', duration_str)
    if hr_match:
        total += int(hr_match.group(1)) * 60
    if min_match:
        total += int(min_match.group(1))
    return total


def parse_time(time_str: str) -> str:
    """Extract just the time portion like '10:15 AM' from strings like '10:15 AM on Wed, Jul 15'."""
    m = re.match(r'(\d{1,2}:\d{2}\s*[AP]M)', time_str.strip())
    return m.group(1) if m else time_str.strip()


def parse_stops(stops_val) -> int:
    """Parse stops value which may be int or string."""
    if isinstance(stops_val, int):
        return stops_val
    if isinstance(stops_val, str):
        if stops_val.lower() in ("nonstop", "unknown"):
            return 0
        m = re.search(r'(\d+)', stops_val)
        return int(m.group(1)) if m else 0
    return 0


def _time_to_minutes(time_str: str) -> int:
    """Convert '10:15 AM' to minutes since midnight for sorting."""
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
    flight_data = [FlightData(
        date=depart,
        from_airport=origin.upper(),
        to_airport=destination.upper(),
        max_stops=STOPS_MAP[stops],
    )]

    if return_date:
        flight_data.append(FlightData(
            date=return_date,
            from_airport=destination.upper(),
            to_airport=origin.upper(),
            max_stops=STOPS_MAP[stops],
        ))

    trip_type = "round-trip" if return_date else "one-way"

    max_retries = 5
    result = None
    for attempt in range(max_retries):
        try:
            result = get_flights(
                flight_data=flight_data,
                trip=trip_type,
                passengers=Passengers(adults=passengers),
                seat=cabin,
                max_stops=STOPS_MAP[stops],
            )
            break
        except RuntimeError:
            if attempt < max_retries - 1:
                delay = 5 * (attempt + 1)
                sys.stderr.write(f"No flights in response (rate-limited by Google), retrying in {delay}s... ({attempt + 1}/{max_retries})\n")
                time.sleep(delay)
        except Exception as e:
            sys.stderr.write(f"Error: {e}\n")
            sys.exit(1)

    if result is None:
        sys.stderr.write("No results after retries. Google may be rate-limiting this IP.\n")
        sys.stdout.write("[]\n")
        sys.exit(0)

    output = []
    for flight in result.flights:
        # Skip incomplete entries (rate-limited responses return price-only stubs)
        if not flight.name and not flight.departure:
            continue

        price_amount, currency = parse_price(flight.price)
        duration_minutes = parse_duration(flight.duration)
        departure_time = parse_time(flight.departure)
        arrival_time = parse_time(flight.arrival)
        stop_count = parse_stops(flight.stops)

        output.append({
            "airline": flight.name,
            "price": price_amount,
            "currency": currency,
            "departure": departure_time,
            "arrival": arrival_time,
            "duration_minutes": duration_minutes,
            "stops": stop_count,
            "is_best": flight.is_best,
            "delay": flight.delay,
            "arrival_time_ahead": flight.arrival_time_ahead or None,
        })

    # Warn if we got results but all were incomplete (rate-limited)
    if not output and result.flights:
        sys.stderr.write("Warning: Got price-only stubs (likely rate-limited by Google). Try again in a few minutes.\n")

    # Sort results
    if sort_by == "price":
        output.sort(key=lambda x: x["price"] if x["price"] is not None else float("inf"))
    elif sort_by == "duration":
        output.sort(key=lambda x: x["duration_minutes"])
    elif sort_by == "departure":
        output.sort(key=lambda x: _time_to_minutes(x["departure"]))
    elif sort_by == "arrival":
        output.sort(key=lambda x: _time_to_minutes(x["arrival"]))

    sys.stdout.write(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
