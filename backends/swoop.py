"""Swoop backend — uses Google's internal RPC endpoint directly."""

import sys

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


def search_flights(origin, destination, depart, return_date, passengers, cabin, stops, sort_by, **kwargs):
    """Search Google Flights via RPC and return list of result dicts."""
    try:
        results = search(
            origin,
            destination,
            depart,
            return_date=return_date,
            cabin=cabin,
            passengers=Passengers(adults=passengers),
            max_stops=stops,
            sort=SORT_MAP[sort_by],
            include_basic_economy=False,
        )
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        sys.exit(1)

    if not results.results:
        return []

    from backends._fmt import fmt_time_tuple, fmt_date_tuple

    output = []
    for trip in results.results:
        for leg in trip.legs:
            it = leg.itinerary
            if not it:
                continue

            segments = it.segments or []
            layovers = it.layovers or []
            first_seg = segments[0] if segments else None

            output.append({
                "airline": ", ".join(it.airline_names) if it.airline_names else (first_seg.airline_name if first_seg else "Unknown"),
                "flight_numbers": [f"{s.airline}{s.flight_number}" for s in segments if s.flight_number],
                "price": trip.price,
                "currency": trip.currency or results.currency or "USD",
                "departure": fmt_time_tuple(it.departure_time),
                "arrival": fmt_time_tuple(it.arrival_time),
                "departure_date": fmt_date_tuple(it.departure_date),
                "arrival_date": fmt_date_tuple(it.arrival_date),
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
                        "departure": fmt_time_tuple(s.departure_time),
                        "arrival": fmt_time_tuple(s.arrival_time),
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

    return output
