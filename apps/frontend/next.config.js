const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep `next build` and `next dev` in separate output directories: they
  // share the same working dir, and a production build writing into the live
  // `.next` of a running dev server makes every referenced chunk 404.
  // NEXT_DIST_DIR lets a second dev instance use its own cache dir instead of
  // fighting the primary server over `.next`.
  distDir:
    process.env.NEXT_DIST_DIR ??
    (process.env.NODE_ENV === "production" ? ".next-build" : ".next"),
  images: { remotePatterns: [] },
  // Shrink the module graph per route: the heavy client libs are imported
  // wholesale today, which stretches both dev compiles and first-visit TTI.
  // Only packages the app actually imports — the Radix entries listed here
  // named dependencies no source file ever pulled in.
  experimental: {
    optimizePackageImports: ["recharts", "framer-motion", "lucide-react"],
    // Excalidraw statically depends on @excalidraw/mermaid-to-excalidraw,
    // which drags in the whole mermaid graph (~185 MB of chunks) into every
    // route compile even though it is only lazy-loaded on "insert mermaid".
    // Resolve it to a stub: mermaid paste degrades to plain-text paste.
    turbo: {
      resolveAlias: {
        "@excalidraw/mermaid-to-excalidraw": "./lib/excalidraw/mermaid-stub.ts",
      },
    },
  },
  webpack(config) {
    config.resolve.alias["@excalidraw/mermaid-to-excalidraw"] = path.join(__dirname, "lib/excalidraw/mermaid-stub.ts");
    return config;
  },
  async rewrites() {
    // The frontend proxies /api to the backend on the same machine. Because
    // the browser only ever talks to the Next origin, the session cookie is
    // set for the host the user actually browsed (localhost, 127.0.0.1, an
    // office LAN IP...) — which is exactly the host the middleware sees on
    // every navigation. Direct cross-origin calls would scope the cookie to
    // the API host and the post-login /dashboard navigation would bounce
    // straight back to /login. BACKEND_API_URL is a server-side setting; the
    // backend mounts every route under the `api` prefix.
    const backend = process.env.BACKEND_API_URL ?? "http://127.0.0.1:3001/api";
    return [{ source: "/api/:path*", destination: `${backend}/:path*` }];
  },
  async redirects() {
    return [
      { source: "/students", destination: "/hierarchy/student", permanent: true },
    ];
  },
};

module.exports = nextConfig;
