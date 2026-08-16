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

This does **not** use Instacart's API (there isn't a public one for this) and does **not** use any anti-bot-detection or fingerprint-spoofing tooling. It attaches Playwright to a Chrome window you already have open and logged into, over Chrome's [remote debugging protocol](https://chromedevtools.github.io/devtools-protocol/), and clicks around exactly like you would. Nothing runs headless, nothing hides that it's automated.

On purpose, this tool never touches:
- **Login** — you log into Instacart yourself, in your own browser, beforehand.
- **Checkout** — the script stops once items are in the cart. You review and pay yourself.

## Setup

1. Quit any running Chrome, then relaunch it with remote debugging enabled:
   ```
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
   ```
2. In that Chrome window, log into instacart.com normally and set your delivery address.
3. `npm install`
4. `cp items.example.json items.json` and edit it.
5. `node src/index.js items.json`

## Using it from a web app (local agent mode)

`npm run serve` starts an HTTP server on `localhost:4545` exposing the same search/add logic, so a frontend running in your own browser can call it (e.g. a "Connect Instacart" button). It's meant to run on your own machine, next to the same logged-in Chrome from Setup above — never deployed as a shared/hosted service, since whoever can reach it can add to your cart.

```
ALLOWED_ORIGINS=http://localhost:3000 npm run serve
```

`ALLOWED_ORIGINS` is a comma-separated allowlist of frontend origins permitted to call this agent (CORS + [Private Network Access](https://developer.chrome.com/blog/private-network-access-preflight) are both enforced — there's no wildcard `*` option, on purpose).

**`GET /stores`** → `{ "stores": [{ "href": "/store/aldi/storefront", "name": "ALDI" }, ...] }`

**`POST /add`** with body `{ "storeHref": "/store/aldi/storefront", "items": [{ "query": "oat milk", "quantity": 1 }] }` → `{ "results": [{ "query": "oat milk", "added": true, "matchedName": "...", "quantity": 1 }] }`

Note `quantity` here means *package count* (how many times to click "+" in the cart), not a cooking measurement — there's no way to ask Instacart for "500g of chicken," only "N packages of a matched product."

## Disclaimer

This is an unofficial, community tool with no affiliation to Instacart. Automating interactions with instacart.com may violate Instacart's Terms of Service — that's between you and them; use at your own risk and for your own personal shopping only. Product matching is a best-effort "click the top search result," not guaranteed to pick the exact item or price you intended, so **always review your cart before paying**. Instacart's site markup changes over time and may break the selectors this relies on.
