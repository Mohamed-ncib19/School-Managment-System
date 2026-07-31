/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { remotePatterns: [] },
  async rewrites() {
    return [
      { source: "/api/auth/:path*", destination: `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/auth/:path*` },
      { source: "/api/:path*", destination: `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/:path*` },
    ];
  },
};

module.exports = nextConfig;
