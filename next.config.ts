import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/sw.js", headers: [
      { key: "Content-Type", value: "application/javascript; charset=utf-8" },
      { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      { key: "Service-Worker-Allowed", value: "/" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ] }];
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
  },
};

export default nextConfig;
