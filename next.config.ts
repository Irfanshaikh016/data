import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // nodejs-polars ships a native .node binary — it must not be bundled.
  serverExternalPackages: ["nodejs-polars"],
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
