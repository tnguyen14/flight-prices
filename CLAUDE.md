# Flight Prices

CLI tool that searches Google Flights and outputs structured JSON results.

## Stack

Python 3.10+, Click (CLI parsing), with two backend implementations:
- **swoop** — calls Google's internal RPC endpoints directly
- **fast** — protobuf URL encoding + SSR HTML parsing

## Running

```bash
# Activate venv
source .venv/bin/activate

# Using swoop backend -- richer data: flight numbers, aircraft, legroom, carbon emissions, layovers
python search.py --library swoop --from SFO --to NRT --depart 2026-08-15

# Using fast backend -- more results, less metadata per flight
python search.py --library fast --from SFO --to NRT --depart 2026-08-15

# Round-trip
python search.py --library swoop --from JFK --to LHR --depart 2026-08-01 --return 2026-08-15

# With filters
python search.py --library fast --from SFO --to NRT --depart 2026-08-15 --stops nonstop --sort price --class business

# Debug mode (fast backend only)
python search.py --library fast --from SFO --to NRT --depart 2026-08-15 --debug
```

## Options

- `--library`: swoop | fast (required)
- `--from` / `--to`: Airport IATA codes (required)
- `--depart`: Departure date YYYY-MM-DD (required)
- `--return`: Return date for round-trip (optional)
- `--passengers`: Number of adults (default: 1)
- `--class`: economy | premium-economy | business | first
- `--stops`: any | nonstop | 1stop
- `--sort`: price | departure | arrival | duration | none
- `--debug`: Print debug info to stderr

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install swoop-flights fast-flights click primp
```

## Backend Comparison

| | swoop | fast |
|---|---|---|
| Approach | Direct RPC to GetShoppingResults | Protobuf URL + SSR HTML parse |
| Data richness | Flight numbers, aircraft, legroom, carbon, layovers | Airline, price, times, duration, stops, aircraft |
| Reliability | RPC endpoint can return empty responses | More reliable (data in initial HTML render) |
| Basic economy | Excluded server-side | Included (no server-side filter) |

## Notes

- No browser or API key needed for either backend.
- Google only has flight schedules ~330 days out. Searching beyond that returns no results.
- The old Playwright-based scraper (TypeScript in src/) is preserved but superseded.
