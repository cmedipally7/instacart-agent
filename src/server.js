#!/usr/bin/env node
import { createServer } from "node:http";
import { attach, goHome, listStores, openStore, searchAndAdd } from "./instacart.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 4545;
const CDP_URL = process.env.CDP_URL ?? "http://localhost:9222";
// Comma-separated list of origins allowed to call this agent, e.g. your
// hosted frontend's URL. "*" is intentionally not supported: this agent can
// add items to a real cart, so only known origins should be allowed to call it.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function withCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // Chrome's Private Network Access check: a page served over the public
  // internet calling a private/localhost server needs this explicit opt-in.
  res.setHeader("Access-Control-Allow-Private-Network", "true");
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  withCors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && req.url === "/stores") {
      const { browser, page } = await attach(CDP_URL);
      await goHome(page);
      const stores = await listStores(page);
      await browser.close();
      return sendJson(res, 200, { stores });
    }

    if (req.method === "POST" && req.url === "/add") {
      const { storeHref, items } = await readJsonBody(req);
      if (!storeHref || !Array.isArray(items) || items.length === 0) {
        return sendJson(res, 400, { error: "Expected { storeHref, items: [{ query, quantity }] }" });
      }

      const { browser, page } = await attach(CDP_URL);
      await openStore(page, storeHref);

      const results = [];
      for (const item of items) {
        try {
          results.push(await searchAndAdd(page, { query: item.query, quantity: item.quantity ?? 1 }));
        } catch (err) {
          results.push({ query: item.query, added: false, reason: err.message });
        }
      }
      await browser.close();
      return sendJson(res, 200, { results });
    }

    sendJson(res, 404, { error: "Not found. Try GET /stores or POST /add." });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Instacart agent listening on http://localhost:${PORT}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
  console.log(`Attaching to Chrome via ${CDP_URL} on each request.`);
});
