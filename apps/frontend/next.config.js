/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep `next build` and `next dev` in separate output directories: they
  // share the same working dir, and a production build writing into the live
  // `.next` of a running dev server makes every referenced chunk 404.
  distDir: process.env.NODE_ENV === "production" ? ".next-build" : ".next",
  images: { remotePatterns: [] },
  // Shrink the module graph per route: the heavy client libs are imported
  // wholesale today, which stretches both dev compiles and first-visit TTI.
  // Only packages the app actually imports — the Radix entries listed here
  // named dependencies no source file ever pulled in.
  experimental: {
    optimizePackageImports: ["recharts", "framer-motion", "lucide-react"],
  },
  async rewrites() {
    return [
      { source: "/api/auth/:path*", destination: `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/auth/:path*` },
      { source: "/api/:path*", destination: `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/:path*` },
    ];
  },
  async redirects() {
    return [
      { source: "/students", destination: "/hierarchy/student", permanent: true },
    ];
  },
};

module.exports = nextConfig;
