import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { SearchInput } from "./types.js";
import { parseFlightResults } from "./parser.js";
import type { FlightResult } from "./types.js";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILE_DIR = join(homedir(), ".google-flights", "chromium-profile");
const GOOGLE_FLIGHTS_URL = "https://www.google.com/travel/flights";

export async function searchFlights(input: SearchInput): Promise<FlightResult[]> {
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
    await navigateToFlights(page);
    await fillSearchForm(page, input);
    await waitForResults(page);
    const results = await parseFlightResults(page);
    return results;
  } finally {
    await browser.close();
  }
}

async function navigateToFlights(page: Page): Promise<void> {
  await page.goto(GOOGLE_FLIGHTS_URL, { waitUntil: "networkidle", timeout: 30000 });

  // Dismiss cookie consent if present
  const consentButton = page.locator('button:has-text("Accept all")');
  if (await consentButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await consentButton.click();
    await page.waitForTimeout(1000);
  }
}

async function fillSearchForm(page: Page, input: SearchInput): Promise<void> {
  // Set trip type (round trip vs one way)
  if (!input.return) {
    const tripTypeButton = page.locator('[aria-label="Change ticket type"] button, .VfPpkd-aPP78e').first();
    if (await tripTypeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tripTypeButton.click();
      await page.locator('li:has-text("One way")').click();
      await page.waitForTimeout(500);
    }
  }

  // Fill origin
  const fromInput = page.locator('[aria-label="Where from?"], [placeholder="Where from?"]').first();
  await fromInput.click();
  await fromInput.fill("");
  await page.keyboard.type(input.from, { delay: 50 });
  await page.waitForTimeout(800);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);

  // Fill destination
  const toInput = page.locator('[aria-label="Where to?"], [placeholder="Where to?"]').first();
  await toInput.click();
  await page.keyboard.type(input.to, { delay: 50 });
  await page.waitForTimeout(800);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);

  // Set departure date
  await setDate(page, input.depart, "Departure");

  // Set return date if round trip
  if (input.return) {
    await setDate(page, input.return, "Return");
  }

  // Click search / Done
  const searchButton = page.locator('button:has-text("Search"), button:has-text("Done")').first();
  if (await searchButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await searchButton.click();
  } else {
    await page.keyboard.press("Enter");
  }
}

async function setDate(page: Page, dateStr: string, label: string): Promise<void> {
  const dateInput = page.locator(`[aria-label*="${label}"], [data-placeholder="${label}"]`).first();
  await dateInput.click();
  await page.waitForTimeout(500);

  // Clear and type the date
  await page.keyboard.press("Control+a");
  await page.keyboard.type(formatDateForInput(dateStr), { delay: 30 });
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
}

function formatDateForInput(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
}

async function waitForResults(page: Page): Promise<void> {
  // Wait for the results list to appear
  await page.waitForSelector('[role="list"] [role="listitem"], .pIav2d, [data-resultid]', {
    timeout: 30000,
  });
  // Give extra time for prices to load
  await page.waitForTimeout(2000);
}
