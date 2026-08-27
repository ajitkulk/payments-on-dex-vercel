# payments-on-dex-vercel

A **serverless, Vercel-native** build of the XRPL Permissioned DEX demo. Same
three-persona flow (XLS-70 Credentials, XLS-80 Permissioned Domains, XLS-81
Permissioned DEX offers on XRPL devnet) as the original
[`payments-on-dex`](https://github.com/ajitkulk/payments-on-dex), re-architected
so it runs on Vercel with **no long-running server and no server-side disk**.

Runs against `wss://s.devnet.rippletest.net:51233`. No mainnet keys.

## What changed vs. the original

The original is a stateful Express server that persists `state.json` to disk and
holds a live XRPL websocket. Vercel functions are stateless, ephemeral, and have
a read-only filesystem, so three things were changed:

1. **State moved to the client.** The browser holds the full demo state (wallet
   seeds, domain id, tx hashes) in `localStorage` and sends it with every
   request. Each API endpoint is a pure function: it takes the state in, does the
   XRPL work, and returns the new state. No `state.json`, no server memory.
2. **Express runs as a single serverless function.** `api/index.js` exports the
   Express app; `vercel.json` rewrites every `/api/*` request to it. The XRPL
   client connects per invocation instead of holding a socket open.
3. **Longer function timeout.** `maxDuration: 60` covers multi-step calls like
   funding three wallets or issuing three credentials via `submitAndWait`.

> ⚠️ Devnet wallet seeds live in the browser's `localStorage`. These are
> throwaway devnet accounts — never reuse this pattern with real keys.

## Layout

```
payments-on-dex-vercel/
├── api/
│   ├── index.js          Vercel serverless entry — exports the Express app
│   └── _lib/             (underscore = not a route)
│       ├── app.js        Express app: stateless /api routes
│       ├── state.js      DEFAULT_STATE, normalize, log helpers
│       └── xrpl-helpers.js
├── src/                  Vite + React frontend (client-held state)
│   ├── App.jsx
│   ├── PersonaColumn.jsx
│   ├── api.js
│   └── defaultState.js   state shape + localStorage load/save
├── index.html
├── dev-api.js            local-only Express listener (never deployed)
├── vite.config.js
├── vercel.json
└── package.json          single package: frontend + api deps
```

## Run locally

```sh
npm install
```

Two terminals (mirrors the deployed split — static frontend + /api):

```sh
# terminal 1 — dev API on http://localhost:4000
npm run dev:api

# terminal 2 — frontend on http://localhost:5173 (proxies /api → :4000)
npm run dev
```

Open <http://localhost:5173>, click **Fund wallets**, then work down each column.
State persists in `localStorage`, so a page reload keeps your progress. **Reset
state** clears it.

Alternatively, `vercel dev` runs the whole thing exactly as production (static +
serverless functions) on one port.

## Deploy to Vercel

1. Push this project to a new GitHub repo.
2. In Vercel, **Add New → Project** and import that repo.
3. Framework preset auto-detects **Vite**. Leave build settings at their
   defaults — `vercel.json` supplies the `/api` rewrite and function timeout.
4. No environment variables required (devnet + public faucet).
5. Deploy. The frontend is served statically and `/api/*` runs as a serverless
   function.

## Notes

- `submitAndWait` means each step takes a few seconds; the button shows a busy
  state while a multi-step call is in flight.
- This is a demo: no auth, no rate limiting, no input validation beyond what
  XRPL enforces.
