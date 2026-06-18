# Flight Prices

CLI tool (`google-flights`) that searches Google Flights and outputs structured JSON results.

## Stack

Python 3.10+, Click (CLI parsing), with two backend implementations:
- **swoop-flights** (`search_swoop.py`) -- calls Google's internal RPC endpoints directly
- **fast-flights** (`search_fast.py`) -- protobuf URL encoding + SSR HTML parsing

## Running

```bash
# Activate venv
source .venv/bin/activate

# Primary (swoop) -- richer data: flight numbers, aircraft, legroom, carbon emissions, layovers
python search_swoop.py --from SFO --to NRT --depart 2026-08-15

# Alternative (fast-flights) -- more results, less metadata per flight
python search_fast.py --from SFO --to NRT --depart 2026-08-15

# Round-trip
python search_swoop.py --from JFK --to LHR --depart 2026-08-01 --return 2026-08-15

# With filters
python search_swoop.py --from SFO --to NRT --depart 2026-08-15 --stops nonstop --sort price --class business
```

## Options

Both scripts share the same CLI interface:

- `--from` / `--to`: Airport IATA codes (required)
- `--depart`: Departure date YYYY-MM-DD (required)
- `--return`: Return date for round-trip (optional)
- `--passengers`: Number of adults (default: 1)
- `--class`: economy | premium-economy | business | first
- `--stops`: any | nonstop | 1stop
- `--sort`: price | departure | arrival | duration | none

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install swoop-flights fast-flights click
```

## Backend Comparison

| | swoop (`search_swoop.py`) | fast-flights (`search_fast.py`) |
|---|---|---|
| Approach | Direct RPC to GetShoppingResults | Protobuf URL + SSR HTML parse |
| Data richness | Flight numbers, aircraft, legroom, carbon, layovers | Airline, price, times, duration, stops |
| Rate-limit behavior | Returns empty `[]` | Returns price-only stubs (filtered out with warning) |
| Basic economy | Excluded server-side | Included (no server-side filter) |
| Business/first class | Full metadata | Incomplete metadata (v2.2 parsing limitation) |

## Notes

- No browser or API key needed for either backend.
- Google may rate-limit after rapid successive calls; wait a few minutes between searches.
- The old Playwright-based scraper (TypeScript in src/) is preserved but superseded.
