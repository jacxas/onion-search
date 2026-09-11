import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["fetch-socks", "socks", "undici", "pg"],
};

export default nextConfig;
