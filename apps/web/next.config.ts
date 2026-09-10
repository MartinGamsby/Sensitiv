import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // packages/shared and packages/db ship TypeScript source with no build step.
  transpilePackages: ["@sensitiv/shared", "@sensitiv/db"],
};

export default nextConfig;
