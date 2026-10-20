import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Local HTTPS front door (scripts/dev.mjs) serves the dev server as https://localhost:3000.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default config;
