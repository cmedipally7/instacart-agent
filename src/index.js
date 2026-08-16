#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { attach, goHome, listStores, openStore, searchAndAdd } from "./instacart.js";

function parseArgs(argv) {
  const args = { cdp: "http://localhost:9222" };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cdp") args.cdp = argv[++i];
    else positional.push(argv[i]);
  }
  args.itemsFile = positional[0];
  return args;
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
  const { cdp, itemsFile } = parseArgs(process.argv.slice(2));
  if (!itemsFile) {
    console.error("Usage: instacart-cart <items.json> [--cdp http://localhost:9222]");
    process.exit(1);
  }

  const items = JSON.parse(await readFile(itemsFile, "utf8"));
  if (!Array.isArray(items) || items.length === 0) {
    console.error("items.json must be a non-empty array of { query, quantity }");
    process.exit(1);
  }

  console.log(`Connecting to Chrome at ${cdp} ...`);
  console.log("(Start Chrome with --remote-debugging-port=9222 and be logged into Instacart first.)");
  const { browser, page } = await attach(cdp);

  await goHome(page);
  const stores = await listStores(page);
  if (stores.length === 0) {
    console.error("No stores found on the Instacart homepage. Is the delivery address set?");
    await browser.close();
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
    const result = await searchAndAdd(page, item);
    console.log(result.added ? `added "${result.matchedName}"` : `skipped (${result.reason})`);
    results.push(result);
  }

  console.log("\nDone. Cart was NOT checked out — review and pay in Chrome yourself.");
  console.table(results.map((r) => ({ query: r.query, added: r.added, matched: r.matchedName ?? "", qty: r.quantity ?? "" })));

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
