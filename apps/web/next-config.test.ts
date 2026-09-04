import { describe, expect, it } from 'vitest';
import nextConfig from './next.config';

describe('browser security headers', () => {
  it('applies the hardened header set to every route', async () => {
    const rules = await nextConfig.headers();
    const headers = new Map(rules[0]?.headers.map(({ key, value }) => [key, value]));

    expect(rules[0]?.source).toBe('/:path*');
    expect(headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(headers.get('Permissions-Policy')).toContain('microphone=()');
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
  });
});

describe('root locale redirect', () => {
  it('redirects the root path to the Korean dashboard entry', async () => {
    const redirects = await nextConfig.redirects();

    expect(redirects).toEqual([{
      source: '/',
      destination: '/ko',
      permanent: false
    }]);
  });
});
