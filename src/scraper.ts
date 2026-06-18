import { chromium, type Page } from "playwright";
import { SearchInput } from "./types.js";
import { parseFlightResults } from "./parser.js";
import type { FlightResult } from "./types.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { appendFileSync, writeFileSync } from "node:fs";

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
  if (debug) writeFileSync("debug-scraper.log", "");
  const log = (msg: string) => { if (debug) appendFileSync("debug-scraper.log", `[scraper] ${msg}\n`); };

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
    if (input.noBasicEconomy) {
      await excludeBasicEconomy(page, debug);
    }
    if (debug) await page.waitForTimeout(10000);
    const results = await parseFlightResults(page, debug);
    return results;
  } finally {
    await browser.close();
  }
}

async function excludeBasicEconomy(page: Page, debug = false): Promise<void> {
  const log = (msg: string) => { if (debug) appendFileSync("debug-scraper.log", `[filter] ${msg}\n`); };
  log("Excluding basic economy via class dropdown...");

  // From joshtkraus/google-flights-scraper: the combobox has a span inside
  // with aria-label="Change seating class." — click THAT, not the combobox div
  const seatSpan = page.locator('span[aria-label="Change seating class."], span[aria-label="Change seating class"]');
  const spanVisible = await seatSpan.isVisible({ timeout: 3000 }).catch(() => false);
  log(`span[aria-label="Change seating class."] visible: ${spanVisible}`);

  if (!spanVisible) {
    // Try finding it via the combobox parent
    const combobox = page.locator('[role="combobox"]:has-text("Economy")').first();
    const cbVisible = await combobox.isVisible({ timeout: 3000 }).catch(() => false);
    log(`Combobox visible: ${cbVisible}`);
    if (cbVisible) {
      // Try clicking the combobox's child span/button elements
      const innerClicked = await page.evaluate(() => {
        const cb = Array.from(document.querySelectorAll('[role="combobox"]'))
          .find(el => el.textContent?.includes("Economy"));
        if (!cb) return "combobox not found";
        // Try every child element
        const children = cb.querySelectorAll("span, div, i, svg");
        for (const child of children) {
          if ((child as HTMLElement).getBoundingClientRect().height > 0) {
            (child as HTMLElement).click();
            return `clicked child: ${child.tagName}.${child.className?.toString().slice(0, 30)}`;
          }
        }
        return "no clickable children";
      });
      log(`Inner click result: ${innerClicked}`);
      await page.waitForTimeout(1000);
    }
  } else {
    await seatSpan.click();
    await page.waitForTimeout(1000);
    log("Clicked seat class span");
  }

  // Check if dropdown opened — look for visible options
  const options = await page.evaluate(() => {
    const items = document.querySelectorAll('[role="option"], li[data-value], [role="listbox"] li');
    return Array.from(items)
      .filter(el => (el as HTMLElement).getBoundingClientRect().height > 0)
      .map(el => ({
        text: el.textContent?.trim().slice(0, 50),
        dataValue: el.getAttribute("data-value"),
        ariaSelected: el.getAttribute("aria-selected"),
      }));
  });
  log(`Visible options after click: ${JSON.stringify(options)}`);

  if (options.length > 0) {
    // Look for "Economy" without "Basic" or "Economy (exclude Basic)"
    const selected = await page.evaluate(() => {
      const items = document.querySelectorAll('[role="option"], li[data-value], [role="listbox"] li');
      for (const item of items) {
        if ((item as HTMLElement).getBoundingClientRect().height === 0) continue;
        const text = item.textContent?.trim() || "";
        if (/^Economy$/i.test(text) || /economy(?!.*basic)/i.test(text)) {
          (item as HTMLElement).click();
          return `selected: "${text}"`;
        }
      }
      return null;
    });
    log(`Selection result: ${selected || "no match"}`);
    await page.waitForTimeout(2000);
  } else {
    log("Dropdown did not open");
  }
}

async function waitForResults(page: Page, debug = false): Promise<void> {
  const log = (msg: string) => { if (debug) appendFileSync("debug-scraper.log", `[wait] ${msg}\n`); };
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
