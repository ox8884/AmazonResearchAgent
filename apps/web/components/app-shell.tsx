'use client';

import { getCopy, type Locale } from '@ara/shared';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { localizedHref } from '../lib/locale';
import { LanguageSwitcher } from './language-switcher';

const navItems = [
  { path: '/dashboard', key: 'navDashboard' },
  { path: '/candidates', key: 'navCandidates' },
  { path: '/runs', key: 'navRuns' },
  { path: '/imports', key: 'navImports' },
  { path: '/settings', key: 'navSettings' },
  { path: '/settings/ai', key: 'navAiSettings' }
] as const;

type NavCopyKey = (typeof navItems)[number]['key'];

function isActivePath(pathname: string, path: string): boolean {
  const suffix = pathname.replace(/^\/(ko|en)(?=\/|$)/u, '') || '/';
  if (path === '/dashboard') {
    return suffix === '/' || suffix === '/dashboard';
  }
  return suffix === path || suffix.startsWith(`${path}/`);
}

export function AppShell({
  locale,
  children
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const copy = getCopy(locale);
  const pathname = usePathname();
  return (
    <>
      <a className="skip-link" href="#main-content">
        {copy.skipToContent}
      </a>
      <div className="app-shell">
        <header className="app-header">
          <div className="app-header__inner">
            <a className="wordmark" href={localizedHref(locale)}>
              <span className="wordmark__mark" aria-hidden="true">AR</span>
              <span>{copy.appName}</span>
            </a>
            <nav className="primary-nav" aria-label="Primary">
              <p className="primary-nav__group-label">{copy.navResearchGroup}</p>
              <ul className="primary-nav__list">
                {navItems.map((item) => {
                  const active = isActivePath(pathname, item.path);
                  return (
                    <li key={item.path}>
                      <a
                        href={localizedHref(locale, item.path)}
                        aria-current={active ? 'page' : undefined}
                        className={active ? 'is-active' : undefined}
                      >
                        {copy[item.key as NavCopyKey]}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <LanguageSwitcher
              locale={locale}
              koreanLabel={copy.languageKorean}
              englishLabel={copy.languageEnglish}
            />
          </div>
        </header>
        <main className="page-shell" id="main-content">
          {children}
        </main>
      </div>
    </>
  );
}
