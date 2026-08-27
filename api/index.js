// Vercel serverless entrypoint.
//
// vercel.json rewrites every /api/* request to this single function. The
// Express app defines the full /api/... routes, and Vercel preserves the
// original request URL, so the router matches exactly as it does in local dev.
import app from "./_lib/app.js";

export default app;
