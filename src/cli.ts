#!/usr/bin/env node

import { program } from "commander";
import { searchFlights } from "./scraper.js";
import type { CabinClass, StopFilter, SortOption, SearchInput } from "./types.js";

program
  .name("google-flights")
  .description("Search Google Flights and output results as JSON")
  .requiredOption("--from <code>", "Origin airport code (e.g., SFO)")
  .requiredOption("--to <code>", "Destination airport code (e.g., NRT)")
  .requiredOption("--depart <date>", "Departure date (YYYY-MM-DD)")
  .option("--return <date>", "Return date (YYYY-MM-DD); omit for one-way")
  .option("--passengers <n>", "Number of passengers", "1")
  .option("--class <class>", "Cabin class: economy|premium-economy|business|first", "economy")
  .option("--stops <filter>", "Stop filter: any|nonstop|1stop", "any")
  .option("--sort <by>", "Sort by: price|duration|departure|arrival", "price")
  .option("--headed", "Run browser in headed mode (visible) for debugging", false)
  .parse();

const opts = program.opts();

const input: SearchInput = {
  from: opts.from.toUpperCase(),
  to: opts.to.toUpperCase(),
  depart: opts.depart,
  return: opts.return,
  passengers: parseInt(opts.passengers, 10),
  class: opts.class as CabinClass,
  stops: opts.stops as StopFilter,
  sort: opts.sort as SortOption,
  headed: opts.headed,
};

async function main() {
  try {
    const results = await searchFlights(input);

    if (input.sort === "price") {
      results.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    } else if (input.sort === "duration") {
      results.sort((a, b) => a.duration_minutes - b.duration_minutes);
    }

    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(1);
  }
}

main();
