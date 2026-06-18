import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { SearchInput } from "./types.js";
import { parseFlightResults } from "./parser.js";
import type { FlightResult } from "./types.js";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILE_DIR = join(homedir(), ".google-flights", "chromium-profile");

function buildFlightsUrl(input: SearchInput): string {
  // Google Flights URL format:
  // /travel/flights/search?tfs=... uses protobuf encoding
  // Simpler approach: use the text search format
  // /travel/flights?q=flights+from+JFK+to+BOS+on+2026-07-01+one+way
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
  const debug = input.debug;
  const log = (msg: string) => { if (debug) process.stderr.write(`[form] ${msg}\n`); };

  // Set trip type (round trip vs one way)
  if (!input.return) {
    log("Setting trip type to One way...");
    const tripTypeButton = page.locator('[aria-label="Change ticket type"] button, .VfPpkd-aPP78e').first();
    const tripVisible = await tripTypeButton.isVisible({ timeout: 3000 }).catch(() => false);
    log(`Trip type button visible: ${tripVisible}`);
    if (tripVisible) {
      await tripTypeButton.click();
      await page.waitForTimeout(1000);

      // Dump the dropdown state
      const dropdownInfo = await page.evaluate(() => {
        const menus = document.querySelectorAll('[role="listbox"], [role="menu"], .VfPpkd-xl07Ob-XxIAqe');
        const results: string[] = [];
        menus.forEach((menu, mi) => {
          const rect = menu.getBoundingClientRect();
          const style = getComputedStyle(menu);
          results.push(`Menu[${mi}]: tag=${menu.tagName} class="${menu.className.slice(0, 80)}" visible=${style.display !== 'none' && style.visibility !== 'hidden' && rect.height > 0} rect=${JSON.stringify({w: rect.width, h: rect.height})}`);
          const items = menu.querySelectorAll('[role="option"], li');
          items.forEach((item, ii) => {
            const itemRect = item.getBoundingClientRect();
            const itemStyle = getComputedStyle(item);
            results.push(`  Item[${ii}]: text="${item.textContent?.trim()}" data-value="${item.getAttribute('data-value')}" visible=${itemStyle.display !== 'none' && itemStyle.visibility !== 'hidden' && itemRect.height > 0} selected=${item.getAttribute('aria-selected')}`);
          });
        });
        return results;
      });
      for (const line of dropdownInfo) log(line);

      // Try clicking via data-value
      const clicked = await page.evaluate(() => {
        const menus = document.querySelectorAll('[role="listbox"], [role="menu"], .VfPpkd-xl07Ob-XxIAqe');
        for (const menu of menus) {
          const style = getComputedStyle(menu);
          const rect = menu.getBoundingClientRect();
          if (style.display === 'none' || style.visibility === 'hidden' || rect.height === 0) continue;
          const item = menu.querySelector('[data-value="2"], li:nth-child(2)');
          if (item) {
            (item as HTMLElement).click();
            return `clicked: ${item.textContent?.trim()}`;
          }
        }
        return "no visible menu found";
      });
      log(`One way click result: ${clicked}`);
      await page.waitForTimeout(500);
    }
  }

  // Fill origin
  log("Filling origin...");
  const fromInput = page.locator('[aria-label="Where from?"], [placeholder="Where from?"]').first();
  const fromVisible = await fromInput.isVisible({ timeout: 3000 }).catch(() => false);
  log(`From input visible: ${fromVisible}`);
  if (fromVisible) {
    await fromInput.click();
    await fromInput.fill("");
    await page.keyboard.type(input.from, { delay: 50 });
    await page.waitForTimeout(800);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
  } else {
    log("Trying alternate from selectors...");
    const allInputs = await page.locator('input[type="text"], [role="combobox"]').all();
    log(`Found ${allInputs.length} text inputs/comboboxes`);
    for (let i = 0; i < allInputs.length; i++) {
      const aria = await allInputs[i].getAttribute("aria-label").catch(() => null);
      const ph = await allInputs[i].getAttribute("placeholder").catch(() => null);
      const val = await allInputs[i].inputValue().catch(() => null);
      log(`  input[${i}]: aria="${aria}" placeholder="${ph}" value="${val}"`);
    }
  }

  // Fill destination
  log("Filling destination...");
  const toInput = page.locator('[aria-label="Where to?"], [placeholder="Where to?"]').first();
  const toVisible = await toInput.isVisible({ timeout: 3000 }).catch(() => false);
  log(`To input visible: ${toVisible}`);
  if (toVisible) {
    await toInput.click();
    await page.keyboard.type(input.to, { delay: 50 });
    await page.waitForTimeout(800);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
  }

  // Set departure date
  log("Setting departure date...");
  await setDate(page, input.depart, "Departure", input.debug);

  // Set return date if round trip
  if (input.return) {
    log("Setting return date...");
    await setDate(page, input.return, "Return", input.debug);
  }

  // Click search / Done
  log("Looking for search button...");
  const searchButton = page.locator('button:has-text("Search"), button:has-text("Done")').first();
  const searchVisible = await searchButton.isVisible({ timeout: 3000 }).catch(() => false);
  log(`Search button visible: ${searchVisible}`);
  if (searchVisible) {
    await searchButton.click();
  } else {
    log("Pressing Enter as fallback...");
    await page.keyboard.press("Enter");
  }

  log(`Form submission complete. URL: ${page.url()}`);
}

async function setDate(page: Page, dateStr: string, label: string, debug = false): Promise<void> {
  const log = (msg: string) => { if (debug) process.stderr.write(`[date] ${msg}\n`); };

  const dateInput = page.locator(`[aria-label*="${label}"], [data-placeholder="${label}"]`).first();
  const visible = await dateInput.isVisible({ timeout: 3000 }).catch(() => false);
  log(`Date input for "${label}" visible: ${visible}`);

  if (!visible) {
    log("Dumping all aria-labels on page...");
    const labels = await page.evaluate(() => {
      const els = document.querySelectorAll("[aria-label]");
      return Array.from(els).slice(0, 30).map(e => ({
        tag: e.tagName,
        label: e.getAttribute("aria-label"),
        visible: (e as HTMLElement).checkVisibility?.() ?? true,
      }));
    });
    for (const l of labels) {
      log(`  <${l.tag}> aria-label="${l.label}" visible=${l.visible}`);
    }
    return;
  }

  await dateInput.click();
  await page.waitForTimeout(500);

  const formatted = formatDateForInput(dateStr);
  log(`Typing date: "${formatted}" (from ${dateStr})`);

  await page.keyboard.press("Control+a");
  await page.keyboard.type(formatted, { delay: 30 });
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);

  log(`Current URL after date entry: ${page.url()}`);
}

function formatDateForInput(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
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
  // Give extra time for prices to load
  await page.waitForTimeout(2000);
  log(`Results page URL: ${page.url()}`);
}
