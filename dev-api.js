// Local dev API server. Runs the same Express app that Vercel serves as a
// serverless function (api/index.js), on a plain HTTP port so `vite` can proxy
// /api to it during development.
//
// It lives at the project root (not under /api) on purpose: any *.js directly
// inside /api is turned into its own serverless function by Vercel, and this
// long-running listener must never be deployed. To emulate production locally
// instead, run `vercel dev`.
import app from "./api/_lib/app.js";
import { disconnect } from "./api/_lib/xrpl-helpers.js";

const PORT = process.env.PORT || 4000;

process.on("SIGINT", async () => {
  await disconnect();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`[payments-on-dex-vercel] dev API listening on http://localhost:${PORT}`);
});
