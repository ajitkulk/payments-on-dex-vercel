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
