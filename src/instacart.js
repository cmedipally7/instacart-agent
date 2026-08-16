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

  // Results render async after the SPA route change; a fixed short sleep
  // here was racing the page and reporting false "no results" for items
  // that genuinely exist. Wait for either an outcome to actually appear.
  await Promise.race([
    page.getByText(/^No results for/i).first().waitFor({ timeout: 8000 }),
    page.getByRole("button", { name: ADD_BUTTON_NAME }).first().waitFor({ timeout: 8000 }),
  ]).catch(() => {});
  await page.waitForTimeout(300);
}

// The real accessible name is "Add {qty} {unit} {product name}" (e.g.
// "Add 1 ct Northern Catch Chunk Light Tuna in Water"), never literally
// "Add" — confirmed by inspecting the live page, since an exact-match
// selector silently matched nothing and reported false "no results" for
// every item without ever clicking anything.
const ADD_BUTTON_NAME = /^Add\b/;

// Adds the top matching result for `query` and sets its cart quantity.
// Returns a result record; never proceeds to checkout.
export async function searchAndAdd(page, { query, quantity = 1 }) {
  await inStoreSearch(page, query);

  // A "No results for X" page still shows unrelated suggested-item Add
  // buttons ("Related items") — treat that heading as authoritative rather
  // than grabbing one of those unrelated products.
  if (await page.getByText(/^No results for/i).count()) {
    return { query, added: false, reason: "no results" };
  }

  const addButton = page.getByRole("button", { name: ADD_BUTTON_NAME }).first();
  const exists = await addButton.count();
  if (!exists) {
    return { query, added: false, reason: "no results" };
  }

  const accessibleName = await addButton.evaluate((el) => el.getAttribute("aria-label") || el.textContent);
  const name = accessibleName.replace(/^Add\s+/i, "").trim() || query;

  await addButton.click();
  await page.waitForTimeout(500);

  for (let i = 1; i < quantity; i++) {
    const plus = page.getByRole("button", { name: /^(Increase quantity|\+)$/i }).first();
    if (await plus.count()) {
      await plus.click();
      await page.waitForTimeout(300);
    }
  }

  return { query, added: true, matchedName: name, quantity };
}
