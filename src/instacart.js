import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME_URL = "https://www.instacart.com";
const PROFILE_DIR = process.env.INSTACART_AGENT_PROFILE_DIR ?? join(homedir(), ".instacart-agent-chrome-profile");

let contextPromise = null;

// Launches (and reuses) a single visible Chrome window owned by this agent,
// using your real system Chrome install with a persistent profile — no
// manual Chrome launch, no remote-debugging flags, no "quit your browser
// first" step, and no headless/stealth automation. The profile persists on
// disk, so you only log into Instacart once; every later run reuses it.
export async function launchBrowser() {
  if (!contextPromise) {
    contextPromise = chromium.launchPersistentContext(PROFILE_DIR, {
      channel: "chrome",
      headless: false,
      viewport: null,
    });
  }
  const context = await contextPromise;
  let page = context.pages().find((p) => p.url().startsWith(HOME_URL)) ?? context.pages()[0];
  if (!page) page = await context.newPage();
  if (!page.url().startsWith(HOME_URL)) {
    await page.goto(HOME_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
  return { page };
}

export async function closeBrowser() {
  if (!contextPromise) return;
  const context = await contextPromise;
  contextPromise = null;
  await context.close().catch(() => {});
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

// Leaves the window on the actual cart list instead of whatever the last
// search happened to be, so whoever looks at the browser after a run sees
// what was added, not a stray product page.
export async function openCart(page) {
  const cartButton = page.getByRole("button", { name: /View Cart/i }).first();
  if (await cartButton.count()) {
    await cartButton.click();
    await page.waitForTimeout(800);
  }
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
