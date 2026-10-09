import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pin the workspace root: this app lives in a subfolder of a larger repo.
  turbopack: { root: __dirname },
};

export default nextConfig;
