/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse must run as a native Node.js require, not bundled by webpack
  // (Next.js 14 uses the experimental key; Next.js 15 uses serverExternalPackages)
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse"],
  },
};

module.exports = nextConfig;
