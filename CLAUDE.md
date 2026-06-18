# Flight Prices

CLI tool (`google-flights`) that scrapes Google Flights search results using Playwright + Chromium and outputs JSON.

## Stack

TypeScript, Commander (CLI parsing), Playwright (browser automation), tsx (dev runner).

## Running

- Dev mode: `npm run dev -- --from SFO --to LAX --depart 2026-07-01`
- Add `--headed` to see the browser visually for debugging
- Build: `npm run build`
- Prod: `npm start -- --from SFO --to LAX --depart 2026-07-01`

## Setup

```bash
npx playwright install chromium
npx playwright install-deps chromium  # installs system shared libraries (requires sudo)
```

For `--headed` mode on WSL2, requires an X server (e.g., X410 in VSock mode) and `export DISPLAY=:0`.
