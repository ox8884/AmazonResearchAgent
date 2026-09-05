'use client';

import { getCopy, type Locale } from '@ara/shared';
import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';
import { localizedHref } from '../lib/locale';
import { LanguageSwitcher } from './language-switcher';

// Workflow spine: each phase groups the destinations that serve one stage of
// the research loop (판단 → 실행·운영 → AI 운영). Ordering is the loop itself.
const navPhases = [
  {
    key: 'navPhaseJudge' as const,
    items: [
      { path: '/dashboard', copyKey: 'navDashboard' as const },
      { path: '/candidates', copyKey: 'navCandidates' as const }
    ]
  },
  {
    key: 'navPhaseOperate' as const,
    items: [
      { path: '/runs', copyKey: 'navRuns' as const },
      { path: '/imports', copyKey: 'navImports' as const },
      { path: '/settings', copyKey: 'navSettings' as const }
    ]
  },
  {
    key: 'navPhaseAi' as const,
    items: [{ path: '/settings/ai', copyKey: 'navAiSettings' as const }]
  }
] as const;

type NavCopyKey = (typeof navPhases)[number]['items'][number]['copyKey'];

function isActivePath(pathname: string, path: string): boolean {
  const suffix = pathname.replace(/^\/(ko|en)(?=\/|$)/u, '') || '/';
  if (path === '/dashboard') {
    return suffix === '/' || suffix === '/dashboard';
  }
  // AI Settings is its own destination under the AI phase: `/settings/ai` must
  // mark only AI Settings active, not the generic `/settings` entry.
  if (path === '/settings/ai') {
    return suffix === '/settings/ai';
  }
  if (path === '/settings') {
    return suffix === '/settings' || (suffix.startsWith('/settings/') && suffix !== '/settings/ai');
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
  const currentPageLabel = (() => {
    const suffix = pathname.replace(/^\/(ko|en)(?=\/|$)/u, '') || '/';
    for (const phase of navPhases) {
      for (const item of phase.items) {
        if (isActivePath(pathname, item.path)) return copy[item.copyKey as NavCopyKey];
      }
    }
    return suffix;
  })();
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
            <p className="primary-nav__current-location" aria-hidden="true">
              {copy.navCurrentLocation.replace('{page}', currentPageLabel)}
            </p>
            <nav className="primary-nav" aria-label="Primary">
              {navPhases.map((phase) => (
                <div className="primary-nav__phase" key={phase.key}>
                  <p className="primary-nav__group-label">{copy[phase.key]}</p>
                  <ul className="primary-nav__list">
                    {phase.items.map((item) => {
                      const active = isActivePath(pathname, item.path);
                      return (
                        <li key={item.path}>
                          <a
                            href={localizedHref(locale, item.path)}
                            aria-current={active ? 'page' : undefined}
                            className={active ? 'is-active' : undefined}
                          >
                            {copy[item.copyKey as NavCopyKey]}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
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
