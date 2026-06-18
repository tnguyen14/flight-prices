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
  log("Excluding basic economy via Bags filter (require 1 carry-on)...");

  // The "Bags" button is a standard clickable button in the filter bar
  const bagsButton = page.locator('button[aria-label*="Bags"]').first();
  const visible = await bagsButton.isVisible({ timeout: 5000 }).catch(() => false);
  log(`Bags button visible: ${visible}`);

  if (!visible) {
    log("Bags button not found");
    return;
  }

  await bagsButton.click();
  await page.waitForTimeout(1000);

  // Dump what appeared in the bags popup
  const popupContent = await page.evaluate(() => {
    const all = document.querySelectorAll("*");
    return Array.from(all)
      .filter(el => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.height > 0 && rect.height < 50;
      })
      .filter(el => {
        const text = el.textContent?.trim().toLowerCase() || "";
        return text.includes("carry") || text.includes("checked") || text.includes("bag");
      })
      .filter(el => el.children.length === 0 || el.tagName === "BUTTON")
      .slice(0, 15)
      .map(el => ({
        tag: el.tagName,
        text: el.textContent?.trim().slice(0, 50),
        ariaLabel: el.getAttribute("aria-label"),
        role: el.getAttribute("role"),
      }));
  });
  log(`Bags popup elements: ${JSON.stringify(popupContent, null, 2)}`);

  // Look for carry-on bag increment button
  const carryOnInc = page.locator('button[aria-label*="carry-on" i][aria-label*="increase" i], button[aria-label*="more carry-on" i], button[aria-label*="Add a carry-on" i]').first();
  const incVisible = await carryOnInc.isVisible({ timeout: 3000 }).catch(() => false);
  log(`Carry-on increment button visible: ${incVisible}`);

  if (incVisible) {
    await carryOnInc.click();
    await page.waitForTimeout(500);
    log("Clicked carry-on increment");
  } else {
    // Try finding any increment/plus button near carry-on text
    const allButtons = await page.evaluate(() => {
      const buttons = document.querySelectorAll("button");
      return Array.from(buttons)
        .filter(b => b.getBoundingClientRect().height > 0)
        .filter(b => {
          const label = b.getAttribute("aria-label") || "";
          return /carry|bag/i.test(label);
        })
        .map(b => ({
          text: b.textContent?.trim().slice(0, 30),
          ariaLabel: b.getAttribute("aria-label"),
        }));
    });
    log(`Bag-related buttons: ${JSON.stringify(allButtons)}`);
  }

  // Close the popup
  const closeBtn = page.locator('button:has-text("Done"), button:has-text("Close"), button[aria-label="Close"]').first();
  if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await closeBtn.click();
  } else {
    await page.keyboard.press("Escape");
  }
  await page.waitForTimeout(2000);
  log("Bags filter applied");
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
