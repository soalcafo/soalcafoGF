import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Points next-intl at our request config (locale + messages per request).
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // argon2 is a native module; keep it external to the server bundle.
  serverExternalPackages: ["argon2"],
  experimental: {
    // Server Actions are the primary write path in this app.
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default withNextIntl(nextConfig);
