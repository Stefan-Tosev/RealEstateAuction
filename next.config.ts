import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev-tools button is fixed-position and overlaps the admin
  // sidebar footer, intercepting real clicks in both manual testing
  // and Playwright.
  devIndicators: false,
};

export default nextConfig;
