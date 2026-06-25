"""Fast-flights backend — protobuf URL encoding + SSR HTML parsing."""

import sys

from fast_flights import FlightQuery, Passengers, create_filter
from fast_flights.exceptions import FlightsNotFound
from fast_flights.parser import parse
from primp import Client

FLIGHTS_URL = "https://www.google.com/travel/flights"


def _fetch(query, debug=False):
    """Fetch and parse flights from Google. Returns (result, error_hint)."""
    client = Client(impersonate="chrome", impersonate_os="macos", referer=True, cookie_store=True)

    res = client.get(FLIGHTS_URL, params=query.params())

    if debug:
        sys.stderr.write(f"[debug] status={res.status_code} length={len(res.text)}\n")
        if 'consent.google' in res.text:
            sys.stderr.write(f"[debug] consent page detected\n")
        if 'ds:1' in res.text:
            sys.stderr.write(f"[debug] flight data script tag found\n")

    if "consent.google" in res.text or "Before you continue" in res.text:
        sys.stderr.write("Google consent page detected. Setting consent cookie...\n")
        client.get("https://consent.google.com/save?continue=https://www.google.com/&gl=US&m=0&pc=trv&x=5&src=2&hl=en&bl=gws_20240101-0&set_eom=true")
        res = client.get(FLIGHTS_URL, params=query.params())

    has_flight_data = 'ds:1' in res.text

    try:
        return parse(res.text), None
    except (FlightsNotFound, RuntimeError, AttributeError) as e:
        if debug:
            sys.stderr.write(f"[debug] parse failed: {type(e).__name__}: {str(e)[:100]}\n")
        if not has_flight_data:
            return None, "Google did not return flight data. This may be a temporary block — try again shortly."
        return None, None


def search_flights(origin, destination, depart, return_date, passengers, cabin, stops, sort_by, debug=False, **kwargs):
    """Search Google Flights via SSR HTML and return list of result dicts."""
    flights = [FlightQuery(
        date=depart,
        from_airport=origin,
        to_airport=destination,
        max_stops=stops,
    )]

    if return_date:
        flights.append(FlightQuery(
            date=return_date,
            from_airport=destination,
            to_airport=origin,
            max_stops=stops,
        ))

    trip_type = "round-trip" if return_date else "one-way"

    query = create_filter(
        flights=flights,
        trip=trip_type,
        passengers=Passengers(adults=passengers),
        seat=cabin,
    )

    result, error_hint = _fetch(query, debug=debug)
    if result is None:
        if error_hint:
            sys.stderr.write(f"{error_hint}\n")
        return []

    from libraries._fmt import fmt_time_list, fmt_date_list

    output = []
    for group in result:
        total_duration = sum(f.duration for f in group.flights)
        stops_count = len(group.flights) - 1

        output.append({
            "airline": ", ".join(group.airlines),
            "price": group.price,
            "currency": "USD",
            "departure": fmt_time_list(group.flights[0].departure.time),
            "arrival": fmt_time_list(group.flights[-1].arrival.time),
            "departure_date": fmt_date_list(group.flights[0].departure.date),
            "arrival_date": fmt_date_list(group.flights[-1].arrival.date),
            "duration_minutes": total_duration,
            "stops": stops_count,
            "legs": [
                {
                    "from": f.from_airport.code,
                    "to": f.to_airport.code,
                    "airline": group.airlines[0] if group.airlines else "Unknown",
                    "aircraft": f.plane_type or None,
                    "departure": fmt_time_list(f.departure.time),
                    "arrival": fmt_time_list(f.arrival.time),
                    "duration_minutes": f.duration,
                }
                for f in group.flights
            ],
            "carbon_emissions": {
                "grams": group.carbon.emission,
                "typical_grams": group.carbon.typical_on_route,
            } if group.carbon else None,
        })

    return output
