import type { NextConfig } from 'next';

const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@ara/worker'],
  // The dev-tools badge occludes content in visual-QA captures; it stays off
  // in dev so screenshots reflect the real product surface.
  devIndicators: false
} as const satisfies NextConfig;

export default nextConfig;
