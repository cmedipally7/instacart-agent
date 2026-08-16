import { chromium } from "playwright-core";

const HOME_URL = "https://www.instacart.com";

// Uses a dedicated tab for Instacart rather than whichever tab happens to be
// first in the window — that's often the tab showing the calling app itself,
// and hijacking it mid-request would yank the page out from under the user.
export async function attach(cdpUrl) {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  let page = context.pages().find((p) => p.url().startsWith(HOME_URL));
  if (!page) page = await context.newPage();
  return { browser, page };
}

export async function goHome(page) {
  const url = new URL(page.url());
  if (url.origin + url.pathname !== HOME_URL + "/" && url.origin + url.pathname !== HOME_URL) {
    await page.goto(HOME_URL, { waitUntil: "domcontentloaded" });
  }
  await page.waitForTimeout(1000);
}

// Picks the most name-like line out of a store tile's text, since badges
// like "$15 OFF" or "No markups" often render before the store name.
function bestNameLine(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const candidates = lines.filter((l) => /[A-Za-z]{3,}/.test(l) && !/^\$|off$|no markups$|min$|mi$/i.test(l));
  return (candidates[0] ?? lines[0] ?? "").trim();
}

export async function listStores(page) {
  const links = page.locator('a[href*="/store/"][href*="/storefront"]');
  const count = await links.count();
  const seen = new Map();
  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    const href = await link.getAttribute("href");
    const name = bestNameLine(await link.innerText());
    if (name && href && !seen.has(href)) seen.set(href, name);
  }
  return [...seen.entries()].map(([href, name]) => ({ href, name }));
}

export async function hasAuthModal(page) {
  return (await page.locator('[class*="AuthModal"]').count()) > 0;
}

export async function openStore(page, href) {
  const url = href.startsWith("http") ? href : `${HOME_URL}${href}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
}

async function inStoreSearch(page, query) {
  if (await hasAuthModal(page)) {
    throw new Error("Instacart is showing a login/signup prompt. Log into Instacart in this Chrome window first, then re-run.");
  }
  const box = page.getByPlaceholder(/Search/i).first();
  await box.click();
  await box.fill("");
  await box.type(query, { delay: 20 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
}

// Adds the top matching result for `query` and sets its cart quantity.
// Returns a result record; never proceeds to checkout.
export async function searchAndAdd(page, { query, quantity = 1 }) {
  await inStoreSearch(page, query);

  const card = page
    .locator("main")
    .locator("div")
    .filter({ has: page.getByRole("button", { name: /^Add$/ }) })
    .first();

  const addButton = card.getByRole("button", { name: /^Add$/ }).first();
  const exists = await addButton.count();
  if (!exists) {
    return { query, added: false, reason: "no results" };
  }

  const nameLocator = card.locator("text=/.+/").first();
  const name = (await nameLocator.innerText().catch(() => query)).split("\n")[0];

  await addButton.click();
  await page.waitForTimeout(500);

  for (let i = 1; i < quantity; i++) {
    const plus = card.getByRole("button", { name: "+" }).first();
    if (await plus.count()) {
      await plus.click();
      await page.waitForTimeout(300);
    }
  }

  return { query, added: true, matchedName: name, quantity };
}
