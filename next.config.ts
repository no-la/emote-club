import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(",").map(host => host.trim()).filter(Boolean),
  // Avoid blocking hydration on the development-only React debug WebSocket.
  experimental: { reactDebugChannel: false },
};
export default config;
