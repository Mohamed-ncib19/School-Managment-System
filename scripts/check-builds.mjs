import { existsSync } from "node:fs";
import { resolve } from "node:path";

const SWC_CORE_PATTERNS = [
  "node_modules/@swc/core/swc/swc.darwin-arm64.node",
  "node_modules/@swc/core/swc/swc.darwin-x64.node",
  "node_modules/@swc/core/swc/swc.linux-arm64.node",
  "node_modules/@swc/core/swc/swc.linux-x64.node",
  "node_modules/@swc/core/swc/swc.win32-arm64.node",
  "node_modules/@swc/core/swc/swc.win32-x64.node",
];

const root = resolve(import.meta.dirname, "..");
const hasBuiltBinary = SWC_CORE_PATTERNS.some((p) =>
  existsSync(resolve(root, p)),
);

if (!hasBuiltBinary) {
  console.log(
    "\n⚠  pnpm 10 blocked the @swc/core build script.\n" +
      "   Run the command below and press <space> on @swc/core, then <enter>:\n\n" +
      "   pnpm approve-builds\n",
  );
}
