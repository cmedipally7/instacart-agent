# instacart-agent

Add a JSON list of grocery items to your Instacart cart, driven from a script instead of clicking through the site by hand.

```json
[
  { "query": "oat milk", "quantity": 2 },
  { "query": "eggs", "quantity": 1 }
]
```

```
node src/index.js items.json
```

The script lists the stores available for your delivery address and asks you to pick one, then searches and adds each item to that store's cart in Instacart's real, ordinary web UI.

## How it works

This does **not** use Instacart's API (there isn't a public one for this) and does **not** use any anti-bot-detection or fingerprint-spoofing tooling. It launches your real, installed Chrome — visibly, never headless — using [Playwright](https://playwright.dev/), and clicks around exactly like you would. The browser gets its own dedicated, persistent profile directory (`~/.instacart-agent-chrome-profile` by default) separate from your everyday Chrome profile, so it doesn't touch your regular browsing session, but it remembers your Instacart login across runs.

On purpose, this tool never touches:
- **Login** — you log into Instacart yourself, in the window it opens, the first time you run it.
- **Checkout** — it stops once items are in the cart. You review and pay yourself.

## Setup

1. `npm install`
2. `cp items.example.json items.json` and edit it.
3. `node src/index.js items.json`

A Chrome window opens automatically on first run. Log into Instacart there — that's the only manual step, and only needed once, since the profile persists on disk for every run after.

## Using it from a web app (local agent mode)

```
npm run serve
```

Starts an HTTP server on `localhost:4545` exposing the same search/add logic, so a frontend running in your own browser can call it (e.g. a "Connect Instacart" button). The first request opens the Chrome window (log in there if you haven't already); it then stays open and is reused for every later request. Meant to run on your own machine — never deployed as a shared/hosted service, since whoever can reach it can add to your cart.

By default this allows requests from `http://localhost:3000` (local dev) and the deployed `automated-health` frontend. To allow a different frontend origin, override with a comma-separated list:

```
ALLOWED_ORIGINS=http://localhost:3000,https://your-frontend.example.com npm run serve
```

`ALLOWED_ORIGINS` is a comma-separated allowlist of frontend origins permitted to call this agent (CORS + [Private Network Access](https://developer.chrome.com/blog/private-network-access-preflight) are both enforced — there's no wildcard `*` option, on purpose).

**`GET /stores`** → `{ "stores": [{ "href": "/store/aldi/storefront", "name": "ALDI" }, ...] }`

**`POST /add`** with body `{ "storeHref": "/store/aldi/storefront", "items": [{ "query": "oat milk", "quantity": 1 }] }` → `{ "results": [{ "query": "oat milk", "added": true, "matchedName": "...", "quantity": 1 }] }`

Note `quantity` here means *package count* (how many times to click "+" in the cart), not a cooking measurement — there's no way to ask Instacart for "500g of chicken," only "N packages of a matched product."

## Disclaimer

This is an unofficial, community tool with no affiliation to Instacart. Automating interactions with instacart.com may violate Instacart's Terms of Service — that's between you and them; use at your own risk and for your own personal shopping only. Product matching is a best-effort "click the top search result," not guaranteed to pick the exact item or price you intended, so **always review your cart before paying**. Instacart's site markup changes over time and may break the selectors this relies on.
