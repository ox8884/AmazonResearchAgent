export function isPublicAppPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/u, '') || '/';
  if (normalized === '/') {
    return true;
  }
  return /^\/(ko|en)\/(login|showcase)$/u.test(normalized);
}

export function loginRedirectPath(pathname: string): string {
  const locale = pathname === '/en' || pathname.startsWith('/en/') ? 'en' : 'ko';
  return `/${locale}/login`;
}
