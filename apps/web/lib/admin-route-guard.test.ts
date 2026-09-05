import { describe, expect, it } from 'vitest';
import { isPublicAppPath, loginRedirectPath } from './admin-route-guard';

describe('admin route guard paths', () => {
  it('keeps only login and showcase public under each locale', () => {
    expect(isPublicAppPath('/')).toBe(true);
    expect(isPublicAppPath('/ko/login')).toBe(true);
    expect(isPublicAppPath('/en/showcase/')).toBe(true);
    expect(isPublicAppPath('/ko')).toBe(false);
    expect(isPublicAppPath('/ko/dashboard')).toBe(false);
    expect(isPublicAppPath('/en/settings/ai')).toBe(false);
    expect(isPublicAppPath('/ko/login/extra')).toBe(false);
  });

  it('sends English paths to the English login and everything else to Korean', () => {
    expect(loginRedirectPath('/en/candidates')).toBe('/en/login');
    expect(loginRedirectPath('/ko/dashboard')).toBe('/ko/login');
    expect(loginRedirectPath('/')).toBe('/ko/login');
  });
});
