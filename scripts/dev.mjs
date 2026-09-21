/**
 * Single-command dev stack: boots backend + frontend in parallel, then
 * pre-warms the frontend routes in the background so the first browser visit
 * is instant. Logs are tee'd to stdout and appended to ./logs/*.log.
 *
 * CLI: pnpm dev [--no-warm]
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { warm } from "./prewarm.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logDir = path.join(repo, "logs");
fs.mkdirSync(logDir, { recursive: true });

const noWarm = process.argv.includes("--no-warm");
const children = new Set();
let stopping = false;

function run(name, cwd, cmd, args) {
  let logFile = null;
  try {
    logFile = fs.createWriteStream(path.join(logDir, `${name}.log`), { flags: "a" });
    logFile.on("error", () => {
      logFile = null;
    });
  } catch {
    logFile = null;
  }
  const child = spawn(cmd, args, {
    cwd,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      FORCE_COLOR: "1",
      // Cap the heap so a runaway dev process can't starve the machine
      // (a webpack dev server once ballooned past 3.7 GB with 1.3 GB free
      // RAM left). Turbo dev stays well under 3 GB.
      NODE_OPTIONS: process.env.NODE_OPTIONS
        ? `${process.env.NODE_OPTIONS} --max-old-space-size=3072`
        : "--max-old-space-size=3072",
    },
  });
  children.add(child);

  const pipe = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (logFile) logFile.write(text);
  };
  child.stdout.on("data", pipe);
  child.stderr.on("data", pipe);

  child.on("exit", (code, signal) => {
    if (logFile) logFile.end();
    children.delete(child);
    console.log(`[dev] ${name} exited (${signal ?? code}). Stopping the stack.`);
    shutdown();
  });
  return child;
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(0), 750);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const BACKEND_PORT = Number(process.env.PORT_BACKEND ?? 3001);
const FRONTEND_PORT = Number(process.env.PORT_FRONTEND ?? 3000);
const backendHealth = process.env.BACKEND_URL ?? `http://127.0.0.1:${BACKEND_PORT}/api/health`;

/**
 * Free the app ports before booting.
 *
 * A previous session that wasn't shut down cleanly (killed terminal, crashed
 * parent, detached run) leaves an orphaned dev stack holding :3000/:3001. The
 * next `pnpm dev` then dies with EADDRINUSE after the health probe has already
 * answered from the *stale* backend — a confusing mix of a "working" pre-warm
 * and an immediate crash.
 *
 * Stale NODE processes on our ports are killed (they are ours); anything else
 * (another app, another service) is left alone and aborts the start with a
 * clear message instead of a stack trace.
 */
async function freePorts() {
  const ports = [FRONTEND_PORT, BACKEND_PORT];
  for (const port of ports) {
    const pids = await pidsOnPort(port);
    for (const pid of pids) {
      const proc = await procInfo(pid);
      if (!proc) continue;
      if (proc.image === "node.exe") {
        console.log(`[dev] port ${port}: killing stale node process (pid ${pid}) from a previous run…`);
        await killTree(pid);
      } else {
        console.error(
          `[dev] port ${port} is held by a non-node process (${proc.image}, pid ${pid}). ` +
            `Close it or set PORT_FRONTEND/PORT_BACKEND, then re-run pnpm dev.`,
        );
        process.exit(1);
        return;
      }
    }
  }
}

function execCapture(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => (out += c.toString()));
    child.stderr.on("data", (c) => (out += c.toString()));
    child.on("exit", () => resolve(out));
    child.on("error", () => resolve(""));
  });
}

async function pidsOnPort(port) {
  const out = await execCapture("netstat", ["-ano"]);
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes(`:${port} `) || !/LISTENING/i.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    const pid = Number(parts[parts.length - 1]);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

async function procInfo(pid) {
  // The filter value contains spaces: through shell:true the quotes must be
  // part of the argument itself or tasklist mangles the filter.
  const out = await execCapture("tasklist", ["/FI", `"PID eq ${pid}"`, "/FO", "CSV", "/NH"]);
  // CSV row: "image.exe","<pid>",... — the image name is the first quoted field.
  const image = out.split("\"")[1];
  return image ? { image: image.toLowerCase() } : null;
}

async function killTree(pid) {
  if (process.platform === "win32") {
    await execCapture("taskkill", ["/PID", String(pid), "/T", "/F"]);
  } else {
    await execCapture("kill", ["-9", String(pid)]);
  }
}

await freePorts();

run("backend", path.join(repo, "apps", "backend"), "pnpm", ["run", "start:dev"]);
run("frontend", path.join(repo, "apps", "frontend"), "pnpm", ["run", "dev"]);

/**
 * Poll the backend until it accepts requests. Nest takes on the order of a
 * minute to boot; without this gate the pre-warm (and every page it loads)
 * punches the Next proxy while nothing is listening on :3001 and floods the
 * console with ECONNREFUSED noise on every single start.
 */
async function waitForBackend(timeoutMs = 240_000) {
  const startedAt = Date.now();
  for (;;) {
    try {
      const res = await fetch(backendHealth, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return true;
    } catch {
      /* not up yet — keep polling */
    }
    if (Date.now() - startedAt > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

if (noWarm) {
  console.log("[dev] --no-warm: skipping route pre-warm.");
} else {
  const waitedSince = Date.now();
  console.log("[dev] waiting for the backend to accept requests before pre-warming…");
  waitForBackend()
    .then((up) => {
      if (!up) {
        console.error(`[dev] backend still unreachable after 240s (${backendHealth}) — pre-warm skipped.`);
        return;
      }
      console.log(`[dev] backend up after ${Math.round((Date.now() - waitedSince) / 1000)}s — pre-warming routes…`);
      return warm();
    })
    .catch((error) => console.error(error.message))
    .finally(() => console.log("[dev] pre-warm finished; servers still running (Ctrl+C to stop)."));
}
