import { describe, expect, it } from 'vitest';
import { ipIsAllowed, parseAdminAllowedIps } from './login-guard';

describe('admin IP allowlist', () => {
  it('accepts exact IPs and Tailscale CGNAT CIDR ranges', () => {
    const allowed = parseAdminAllowedIps(
      '70.142.59.190, 100.64.0.0/10, fd7a:115c:a1e0::/48'
    );
    expect(ipIsAllowed('70.142.59.190', allowed)).toBe(true);
    expect(ipIsAllowed('100.76.34.50', allowed)).toBe(true);
    expect(ipIsAllowed('100.111.111.106', allowed)).toBe(true);
    expect(ipIsAllowed('8.8.8.8', allowed)).toBe(false);
    expect(ipIsAllowed('fd7a:115c:a1e0::c733:2233', allowed)).toBe(true);
    expect(ipIsAllowed('2001:db8::1', allowed)).toBe(false);
  });
});
