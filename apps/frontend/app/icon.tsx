import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { schoolInitials, schoolMarkSvg } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side fetches need the absolute backend URL: NEXT_PUBLIC_API_URL is
// the browser-facing relative /api (proxied by next.config.js).
const API_BASE = process.env.BACKEND_API_URL ?? "http://127.0.0.1:3001/api";

/**
 * The browser-tab icon. The uploaded academy logo wins when one is set; the
 * branding endpoint is public (the logo is printed on every receipt), so this
 * server-side fetch needs no auth. Without a logo, the icon is the school
 * name's monogram (first two letters) built from the system settings.
 * Both fail -> bundled mark.
 */
async function schoolName(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/system-settings`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.json();
    const name = body?.data?.system_name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

export default async function Icon(): Promise<Response> {
  try {
    const res = await fetch(`${API_BASE}/financial/settings/logo`, { cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && type.startsWith("image/")) {
      return new Response(await res.arrayBuffer(), {
        headers: { "content-type": type, "cache-control": "no-store" },
      });
    }
  } catch {
    // Backend unreachable — fall through to the derived monogram.
  }

  const name = await schoolName();
  if (name) {
    const svg = schoolMarkSvg(name, 96);
    return new Response(new Blob([svg], { type: "image/svg+xml" }), {
      headers: { "content-type": "image/svg+xml", "cache-control": "no-store" },
    });
  }

  const svg = await readFile(join(process.cwd(), "public", "images", "logo.svg"));
  return new Response(new Blob([svg.toString()], { type: "image/svg+xml" }), {
    headers: { "content-type": "image/svg+xml", "cache-control": "no-store" },
  });
}