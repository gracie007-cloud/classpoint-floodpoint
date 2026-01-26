// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Enable image optimization for external sources if needed
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
