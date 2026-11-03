import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Static export (out/) so `kernova studio` can serve Studio without a Next.js server
  output: 'export',
};

export default nextConfig;
