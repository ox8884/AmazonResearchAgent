import { getCopy, type Locale } from '@ara/shared';
import type { ReactNode } from 'react';
import { localizedHref } from '../lib/locale';
import { LanguageSwitcher } from './language-switcher';

export function AppShell({
  locale,
  children
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const copy = getCopy(locale);
  return (
    <>
      <a className="skip-link" href="#main-content">
        {copy.skipToContent}
      </a>
      <header className="app-header">
        <div className="app-header__inner">
          <a className="wordmark" href={localizedHref(locale)}>
            <span className="wordmark__mark" aria-hidden="true">AR</span>
            <span>{copy.appName}</span>
          </a>
          <nav className="primary-nav" aria-label="Primary">
            <a href={localizedHref(locale)}>{copy.navHome}</a>
            <a href={localizedHref(locale, '/imports')}>{copy.navImports}</a>
            <a href={localizedHref(locale, '/settings/ai')}>{copy.navAiSettings}</a>
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
    </>
  );
}
