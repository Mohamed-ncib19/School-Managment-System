/**
 * Warms the Next.js dev server so the first browser visit doesn't pay the
 * route-compile cost (~10-15s on a cold start). Fetches the main routes with a
 * redirect-following request; cookies are not sent, so protected routes just
 * 307-redirect to /login — the compile still happens.
 *
 * CLI: node scripts/prewarm.mjs [port] [--routes a,b,c]
 */

const DEFAULT_PORT = 3000;
const DEFAULT_ROUTES = [
  "/login",
  "/dashboard",
  "/financial",
  "/financial/payments",
  "/financial/analytics",
  "/financial/professors",
  "/financial/reports",
  "/financial/transactions",
  "/financial/settings",
  "/students",
  "/hierarchy",
];
const READY_TIMEOUT_MS = 120_000;
const PER_ROUTE_TIMEOUT_MS = 60_000;

function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, routes: DEFAULT_ROUTES };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (/^\d+$/.test(arg)) args.port = Number(arg);
    else if (arg === "--routes" && argv[i + 1]) args.routes = argv[i + 1].split(",");
  }
  return args;
}

async function waitForServer(port, timeoutMs) {
  const url = `http://localhost:${port}/login`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status) {
        console.log(`[prewarm] server ready (${res.status} on ${url})`);
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`[prewarm] server did not become ready within ${timeoutMs}ms`);
}

export async function warm(port = DEFAULT_PORT, routes = DEFAULT_ROUTES) {
  await waitForServer(port, READY_TIMEOUT_MS);
  const results = [];
  for (const route of routes) {
    const url = `http://localhost:${port}${route}`;
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_ROUTE_TIMEOUT_MS);
    try {
      const res = await fetch(url, { redirect: "follow", signal: controller.signal });
      const ms = Date.now() - started;
      results.push(`${res.status} ${route} (${ms}ms)`);
      console.log(`[prewarm] ${res.status} ${route} in ${ms}ms`);
    } catch (error) {
      results.push(`ERR ${route} (${error.message})`);
      console.log(`[prewarm] ERR ${route}: ${error.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  console.log(`[prewarm] done — ${results.length} routes warmed`);
  return results;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/").split("/").pop() ?? "");
if (isMain) {
  const { port, routes } = parseArgs(process.argv.slice(2));
  try {
    await warm(port, routes);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
