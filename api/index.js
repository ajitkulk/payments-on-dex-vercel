// Vercel serverless entrypoint.
//
// vercel.json rewrites every /api/* request to this single function. We export
// an explicit handler (rather than the raw Express app) so Vercel always has an
// unambiguous function to invoke, and so any module-load or runtime error is
// surfaced as JSON instead of a generic FUNCTION_INVOCATION_FAILED.
let appPromise;
function getApp() {
  // Lazily import so a load-time failure (e.g. a dependency that misbehaves in
  // the bundle) is catchable here instead of crashing the whole function.
  if (!appPromise) appPromise = import("./_lib/app.js").then((m) => m.default);
  return appPromise;
}

export default async function handler(req, res) {
  // Self-contained diagnostic that never imports xrpl, so it works even when
  // the app module fails to load. Reports the runtime Node version and the
  // resolved @scure/base version (to confirm whether overrides took effect).
  if ((req.url || "").startsWith("/api/_diag")) {
    let scureBase = null;
    try {
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      scureBase = require("@scure/base/package.json").version;
    } catch (e) {
      scureBase = `resolve-failed: ${e?.message}`;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ node: process.version, scureBase, commit: process.env.VERCEL_GIT_COMMIT_SHA || null }));
    return;
  }

  try {
    const app = await getApp();
    return app(req, res);
  } catch (err) {
    console.error("[api/index] fatal", err);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        error: err?.message || String(err),
        stack: (err?.stack || "").split("\n").slice(0, 12),
      }),
    );
  }
}
