import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Avoid blocking hydration on the development-only React debug WebSocket.
  experimental: { reactDebugChannel: false },
};
export default config;
