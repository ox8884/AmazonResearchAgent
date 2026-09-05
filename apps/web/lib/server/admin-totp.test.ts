import { describe, expect, it } from 'vitest';
import { configuredAdminTotpSecret, verifyAdminTotp } from './admin-totp';

const RFC6238_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RFC6238_UNIX = 1_111_111_109;

describe('admin TOTP', () => {
  it('accepts the RFC 6238 SHA-1 sample within the allowed window', () => {
    expect(
      verifyAdminTotp(RFC6238_SECRET, '081804', new Date(RFC6238_UNIX * 1000))
    ).toBe(true);
  });

  it('rejects a missing, short, or wrong code', () => {
    const now = new Date(RFC6238_UNIX * 1000);
    expect(verifyAdminTotp(RFC6238_SECRET, undefined, now)).toBe(false);
    expect(verifyAdminTotp(RFC6238_SECRET, '08180', now)).toBe(false);
    expect(verifyAdminTotp(RFC6238_SECRET, '000000', now)).toBe(false);
  });

  it('reads the configured secret only when present', () => {
    expect(configuredAdminTotpSecret({})).toBeUndefined();
    expect(configuredAdminTotpSecret({ ADMIN_TOTP_SECRET_BASE32: '  ' })).toBeUndefined();
    expect(configuredAdminTotpSecret({ ADMIN_TOTP_SECRET_BASE32: ' MFRGG  ' })).toBe('MFRGG');
  });
});
