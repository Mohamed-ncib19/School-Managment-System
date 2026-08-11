/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { remotePatterns: [] },
  // Shrink the module graph per route: the heavy client libs are imported
  // wholesale today, which stretches both dev compiles and first-visit TTI.
  experimental: {
    optimizePackageImports: ["recharts", "framer-motion", "lucide-react", "@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu", "@radix-ui/react-toast"],
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
