import { chromium, type Page } from "playwright";
import { SearchInput } from "./types.js";
import { parseFlightResults } from "./parser.js";
import type { FlightResult } from "./types.js";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILE_DIR = join(homedir(), ".google-flights", "chromium-profile");

function buildFlightsUrl(input: SearchInput): string {
  const parts = [
    "flights",
    `from ${input.from}`,
    `to ${input.to}`,
    `on ${input.depart}`,
  ];
  if (input.return) {
    parts.push(`return ${input.return}`);
  } else {
    parts.push("one way");
  }
  const q = parts.join(" ");
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

export async function searchFlights(input: SearchInput): Promise<FlightResult[]> {
  const debug = input.debug;
  const log = (msg: string) => { if (debug) process.stderr.write(`[scraper] ${msg}\n`); };

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !input.headed,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
    viewport: { width: 1280, height: 900 },
  });

  try {
    const page = await browser.newPage();
    const url = buildFlightsUrl(input);
    log(`Navigating to: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await waitForResults(page, debug);
    if (debug) await page.waitForTimeout(10000);
    const results = await parseFlightResults(page, debug);
    return results;
  } finally {
    await browser.close();
  }
}

async function waitForResults(page: Page, debug = false): Promise<void> {
  const log = (msg: string) => { if (debug) process.stderr.write(`[wait] ${msg}\n`); };
  log(`Waiting for results... URL: ${page.url()}`);

  try {
    await page.waitForSelector('[role="list"] [role="listitem"], .pIav2d, [data-resultid]', {
      timeout: 30000,
    });
  } catch {
    log("Primary selector timed out, trying broader selectors...");
    await page.waitForSelector('.yR1fYc, .Rk10dc, ul li', { timeout: 10000 }).catch(() => {
      log("Broad selector also timed out");
    });
  }
  await page.waitForTimeout(2000);
  log(`Results page URL: ${page.url()}`);
}
