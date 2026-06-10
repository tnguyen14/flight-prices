import type { Page } from "playwright";
import type { FlightResult, FlightLeg } from "./types.js";

export async function parseFlightResults(page: Page): Promise<FlightResult[]> {
  // Google Flights renders results in list items within the results container
  // The structure changes frequently, so we use multiple selector strategies
  const resultElements = await page.locator(
    '[role="list"] [role="listitem"], li[data-resultid], .pIav2d'
  ).all();

  if (resultElements.length === 0) {
    // Try alternate selector for newer layouts
    const altResults = await page.locator(".yR1fYc, .Rk10dc").all();
    if (altResults.length === 0) {
      process.stderr.write("Warning: No flight results found on page\n");
      return [];
    }
    return parseAlternateLayout(page);
  }

  const results: FlightResult[] = [];

  for (const el of resultElements) {
    try {
      const result = await parseFlightCard(el);
      if (result) {
        results.push(result);
      }
    } catch {
      // Skip unparseable cards
      continue;
    }
  }

  return results;
}

async function parseFlightCard(el: any): Promise<FlightResult | null> {
  const text = await el.innerText();
  if (!text || text.trim().length < 10) return null;

  const lines = text.split("\n").map((l: string) => l.trim()).filter(Boolean);

  const price = extractPrice(lines);
  const times = extractTimes(lines);
  const duration = extractDuration(lines);
  const stops = extractStops(lines);
  const airline = extractAirline(lines);

  if (!times.departure && !airline) return null;

  return {
    airline: airline || "Unknown",
    price: price?.amount ?? null,
    currency: price?.currency ?? "USD",
    departure: times.departure || "",
    arrival: times.arrival || "",
    duration_minutes: duration || 0,
    stops: stops,
    legs: buildLegs(lines, times, airline),
  };
}

function extractPrice(lines: string[]): { amount: number; currency: string } | null {
  for (const line of lines) {
    const match = line.match(/\$\s*([\d,]+)/);
    if (match) {
      return { amount: parseInt(match[1].replace(/,/g, ""), 10), currency: "USD" };
    }
    const euroMatch = line.match(/€\s*([\d,]+)/);
    if (euroMatch) {
      return { amount: parseInt(euroMatch[1].replace(/,/g, ""), 10), currency: "EUR" };
    }
  }
  return null;
}

function extractTimes(lines: string[]): { departure: string; arrival: string } {
  for (const line of lines) {
    // Match patterns like "5:30 PM – 11:45 AM" or "17:30 – 23:45"
    const match = line.match(
      /(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[–\-—]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i
    );
    if (match) {
      return { departure: match[1].trim(), arrival: match[2].trim() };
    }
  }
  return { departure: "", arrival: "" };
}

function extractDuration(lines: string[]): number | null {
  for (const line of lines) {
    // Match "11 hr 15 min" or "2h 30m" or "11 hr"
    const match = line.match(/(\d+)\s*(?:hr|h)\s*(?:(\d+)\s*(?:min|m))?/i);
    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = match[2] ? parseInt(match[2], 10) : 0;
      return hours * 60 + minutes;
    }
  }
  return null;
}

function extractStops(lines: string[]): number {
  for (const line of lines) {
    if (/nonstop/i.test(line)) return 0;
    const match = line.match(/(\d+)\s*stop/i);
    if (match) return parseInt(match[1], 10);
  }
  return 0;
}

function extractAirline(lines: string[]): string | null {
  // Airlines are typically one of the first non-time, non-price lines
  const knownPatterns = /nonstop|stop|\d+\s*hr|\$|€|departure|arrival|select/i;
  const timePattern = /^\d{1,2}:\d{2}/;

  for (const line of lines) {
    if (
      line.length > 2 &&
      line.length < 40 &&
      !knownPatterns.test(line) &&
      !timePattern.test(line)
    ) {
      return line;
    }
  }
  return null;
}

function buildLegs(
  lines: string[],
  times: { departure: string; arrival: string },
  airline: string | null
): FlightLeg[] {
  // For now, build a single leg from available info
  // Multi-leg parsing would require deeper DOM inspection
  return [
    {
      from: "",
      to: "",
      airline: airline || "Unknown",
      flight_number: null,
      departure: times.departure,
      arrival: times.arrival,
    },
  ];
}

async function parseAlternateLayout(page: Page): Promise<FlightResult[]> {
  // Fallback: extract all visible text from result cards using a broader selector
  const cards = await page.locator(".yR1fYc, .Rk10dc, [jsname]").all();
  const results: FlightResult[] = [];

  for (const card of cards) {
    try {
      const result = await parseFlightCard(card);
      if (result) results.push(result);
    } catch {
      continue;
    }
  }

  return results;
}
