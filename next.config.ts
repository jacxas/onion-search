import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["fetch-socks", "socks", "undici"],
};

export default nextConfig;
