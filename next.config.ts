import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // nodejs-polars ships a native .node binary — it must not be bundled.
  serverExternalPackages: ["nodejs-polars"],
};

export default nextConfig;
