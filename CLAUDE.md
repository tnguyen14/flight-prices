# Flight Prices

CLI tool (`google-flights`) that searches Google Flights and outputs structured JSON results.

## Stack

Python 3.10+, swoop-flights (Google Flights RPC reverse-engineering), Click (CLI parsing).

## Running

```bash
# Activate venv
source .venv/bin/activate

# One-way search
python search_flights.py --from SFO --to NRT --depart 2026-08-15

# Round-trip
python search_flights.py --from JFK --to LHR --depart 2026-08-01 --return 2026-08-15

# With filters
python search_flights.py --from SFO --to NRT --depart 2026-08-15 --stops nonstop --sort price --class business
```

## Options

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
pip install swoop-flights click
```

## Notes

- Basic economy fares are excluded by default (main cabin only).
- swoop uses TLS fingerprint impersonation via primp -- no browser or API key needed.
- Google may rate-limit after rapid successive calls; swoop retries with exponential backoff.
- The old Playwright-based scraper (TypeScript in src/) is preserved but superseded by search_flights.py.
