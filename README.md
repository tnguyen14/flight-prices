# Flight Prices

CLI tool that searches Google Flights and outputs structured results.

## Usage

```bash
source .venv/bin/activate
python search.py --library fast --from BOS --to NYC --depart 2026-08-15 --sort price
```

## Options

| Option | Default | Description |
|---|---|---|
| `--library` | (required) | `swoop` or `fast` |
| `--from` | (required) | Origin airport/city code |
| `--to` | (required) | Destination airport/city code |
| `--depart` | (required) | Departure date (YYYY-MM-DD) |
| `--return` | | Return date for round-trip |
| `--passengers` | 1 | Number of adults |
| `--class` | economy | economy, premium-economy, business, first |
| `--stops` | 0 | Max stops: 0 (nonstop), 1, 2, or any |
| `--sort` | departure | price, departure, arrival, duration, none |
| `--json` | | Output as JSON instead of table |
| `--debug` | | Print debug info to stderr |

## Libraries

### `--library fast`

Uses [fast-flights](https://github.com/AWeirdDev/flights) (protobuf URL encoding + SSR HTML parsing).

- Fetches the Google Flights page and parses flight data from the server-rendered HTML
- Supports city/area codes (NYC, LON, TYO, etc.)
- More reliable — Google serves data in the initial page render
- Fewer results — only what Google shows on the first page load (no "show more")
- Includes basic economy fares (no way to filter them out)

### `--library swoop`

Uses [swoop-flights](https://github.com/punitarani/swoop) (direct RPC to Google's internal endpoint).

- Calls the same API endpoint that Google Flights uses internally to load results
- More results — gets the full result set
- Richer metadata — flight numbers, aircraft type, legroom, layover details, carbon emissions
- Excludes basic economy by default
- Only supports IATA airport codes (no city codes like NYC or LON)
- Less reliable — the RPC endpoint can return empty error responses

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install swoop-flights fast-flights click primp
```

## Notes

- No browser or API key needed.
- Google only has flight schedules ~11 months out. Searching beyond that returns no results.
- If you get "Google did not return flight data", the RPC endpoint is temporarily blocking requests — try again later or use the fast library.
