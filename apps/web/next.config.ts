import type { NextConfig } from 'next';

const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@ara/worker'],
  // The dev-tools badge occludes content in visual-QA captures; it stays off
  // in dev so screenshots reflect the real product surface.
  devIndicators: false,
  async redirects() {
    return [{
      source: '/',
      destination: '/ko',
      permanent: false
    }];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'" },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' }
      ]
    }];
  }
} as const satisfies NextConfig;

export default nextConfig;
