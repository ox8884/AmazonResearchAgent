import type { NextConfig } from 'next';

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  serverExternalPackages: ['@ara/worker']
} as const satisfies NextConfig;

export default nextConfig;
