import type { Page } from "playwright";
import type { FlightResult, FlightLeg } from "./types.js";
import { writeFileSync } from "node:fs";

export async function parseFlightResults(page: Page, debug = false): Promise<FlightResult[]> {
  const resultElements = await page.locator(
    '[role="list"] [role="listitem"], li[data-resultid], .pIav2d'
  ).all();

  if (debug) {
    let debugLog = `=== DEBUG: Found ${resultElements.length} elements with primary selector ===\n`;
    for (let i = 0; i < resultElements.length; i++) {
      const text = await resultElements[i].innerText().catch(() => "(error reading text)");
      debugLog += `\n--- Element ${i} ---\n${text}\n`;
    }
    writeFileSync("debug-parser.log", debugLog);
    process.stderr.write("Debug output written to debug-parser.log\n");
  }

  if (resultElements.length === 0) {
    process.stderr.write("Warning: No flight results found on page\n");
    return [];
  }

  const results: FlightResult[] = [];

  for (const el of resultElements) {
    try {
      const text = await el.innerText();
      if (!text || text.trim().length < 10) continue;

      const lines = text.split("\n").map((l: string) => l.trim()).filter(Boolean);

      // Skip expanded/duplicate elements — they have very long first lines
      // Compact elements have short time strings like "12:59 PM" as line 0
      if (lines[0] && lines[0].length > 20) continue;

      const result = parseCompactCard(lines);
      if (result) results.push(result);
    } catch {
      continue;
    }
  }

  return results;
}

function parseCompactCard(lines: string[]): FlightResult | null {
  // Expected format:
  // 0: departure time (e.g., "12:59 PM")
  // 1: "–"
  // 2: arrival time (e.g., "2:22 PM" or "12:10 AM+1")
  // 3: airline (e.g., "JetBlue" or "DeltaOperated by Republic Airways Delta Connection")
  // 4: duration (e.g., "1 hr 23 min")
  // 5: route (e.g., "JFK–BOS")
  // 6: stops (e.g., "Nonstop" or "1 stop")
  // 7: CO2 (e.g., "65 kg CO2e")
  // 8: emissions % (e.g., "-16% emissions")
  // 9-10: numbers
  // 11: price (e.g., "$134")

  if (lines.length < 8) return null;

  const departure = lines[0];
  if (!/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(departure)) return null;

  const arrival = lines[2]?.replace(/\+\d+$/, "") || "";
  const airlineRaw = lines[3] || "Unknown";
  const airline = airlineRaw.replace(/Operated by.*$/, "").trim();
  const duration = parseDuration(lines[4]);
  const route = lines[5] || "";
  const stops = parseStops(lines[6]);
  const price = findPrice(lines);

  const [from, to] = route.split(/[–\-—]/).map(s => s.trim());

  return {
    airline,
    price: price?.amount ?? null,
    currency: price?.currency ?? "USD",
    departure,
    arrival,
    duration_minutes: duration,
    stops,
    legs: [{
      from: from || "",
      to: to || "",
      airline,
      flight_number: null,
      departure,
      arrival,
    }],
  };
}

function parseDuration(line: string | undefined): number {
  if (!line) return 0;
  const match = line.match(/(\d+)\s*(?:hr|h)\s*(?:(\d+)\s*(?:min|m))?/i);
  if (!match) return 0;
  return parseInt(match[1], 10) * 60 + (match[2] ? parseInt(match[2], 10) : 0);
}

function parseStops(line: string | undefined): number {
  if (!line) return 0;
  if (/nonstop/i.test(line)) return 0;
  const match = line.match(/(\d+)\s*stop/i);
  return match ? parseInt(match[1], 10) : 0;
}

function findPrice(lines: string[]): { amount: number; currency: string } | null {
  for (const line of lines) {
    const match = line.match(/^\$\s*([\d,]+)$/);
    if (match) {
      return { amount: parseInt(match[1].replace(/,/g, ""), 10), currency: "USD" };
    }
    const euroMatch = line.match(/^€\s*([\d,]+)$/);
    if (euroMatch) {
      return { amount: parseInt(euroMatch[1].replace(/,/g, ""), 10), currency: "EUR" };
    }
  }
  return null;
}
