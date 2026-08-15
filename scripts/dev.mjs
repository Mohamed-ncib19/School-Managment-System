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

run("backend", path.join(repo, "apps", "backend"), "pnpm", ["run", "start:dev"]);
run("frontend", path.join(repo, "apps", "frontend"), "pnpm", ["run", "dev"]);

if (noWarm) {
  console.log("[dev] --no-warm: skipping route pre-warm.");
} else {
  warm()
    .catch((error) => console.error(error.message))
    .finally(() => console.log("[dev] pre-warm finished; servers still running (Ctrl+C to stop)."));
}
