#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { goHome, launchBrowser, listStores, openCart, openStore, searchAndAdd } from "./instacart.js";

function parseArgs(argv) {
  return { itemsFile: argv[0] };
}

async function promptChoice(question, options) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`));
  let answer;
  while (true) {
    const raw = await rl.question(`${question} `);
    const n = Number(raw.trim());
    if (Number.isInteger(n) && n >= 1 && n <= options.length) {
      answer = n - 1;
      break;
    }
    console.log(`Enter a number between 1 and ${options.length}.`);
  }
  rl.close();
  return answer;
}

async function main() {
  const { itemsFile } = parseArgs(process.argv.slice(2));
  if (!itemsFile) {
    console.error("Usage: instacart-cart <items.json>");
    process.exit(1);
  }

  const items = JSON.parse(await readFile(itemsFile, "utf8"));
  if (!Array.isArray(items) || items.length === 0) {
    console.error("items.json must be a non-empty array of { query, quantity }");
    process.exit(1);
  }

  console.log("Opening Chrome (first run creates a dedicated profile — log into Instacart there once)...");
  const { page } = await launchBrowser();

  await goHome(page);
  const stores = await listStores(page);
  if (stores.length === 0) {
    console.error("No stores found on the Instacart homepage. Is the delivery address set?");
    process.exit(1);
  }

  console.log("\nAvailable stores:");
  const choice = await promptChoice("Pick a store:", stores.map((s) => s.name));
  const store = stores[choice];
  console.log(`\nShopping at ${store.name} ...`);
  await openStore(page, store.href);

  const results = [];
  for (const item of items) {
    process.stdout.write(`Searching "${item.query}" x${item.quantity ?? 1} ... `);
    let result;
    try {
      result = await searchAndAdd(page, item);
    } catch (err) {
      result = { query: item.query, added: false, reason: err.message };
    }
    console.log(result.added ? `added "${result.matchedName}"` : `skipped (${result.reason})`);
    results.push(result);
  }

  await openCart(page);

  console.log("\nDone. Cart was NOT checked out — review and pay in the Chrome window yourself.");
  console.table(results.map((r) => ({ query: r.query, added: r.added, matched: r.matchedName ?? "", qty: r.quantity ?? "" })));

  // Left open on purpose so you can review the cart immediately — the
  // browser is a real, separate Chrome process and stays open after this.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
