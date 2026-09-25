import type { NextConfig } from "next";

const projectRoot = process.cwd();

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
  },
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
