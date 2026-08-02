import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

/**
 * The browser-tab icon. The uploaded academy logo wins when one is set; the
 * branding endpoint is public (the logo is printed on every receipt), so this
 * server-side fetch needs no auth. Falls back to the bundled mark.
 */
export default async function Icon(): Promise<Response> {
  try {
    const res = await fetch(`${API_BASE}/financial/settings/logo`, { cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && type.startsWith("image/")) {
      return new Response(await res.arrayBuffer(), {
        headers: { "content-type": type, "cache-control": "no-cache" },
      });
    }
  } catch {
    // Backend unreachable — fall through to the bundled mark.
  }

  const svg = await readFile(join(process.cwd(), "public", "images", "logo.svg"));
  return new Response(new Blob([svg.toString()], { type: "image/svg+xml" }), {
    headers: { "content-type": "image/svg+xml", "cache-control": "no-cache" },
  });
}
