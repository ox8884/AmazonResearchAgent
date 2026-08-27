'use client';

import type { Locale } from '@ara/shared';
import { usePathname } from 'next/navigation';

export function LanguageSwitcher({
  locale,
  koreanLabel,
  englishLabel
}: {
  locale: Locale;
  koreanLabel: string;
  englishLabel: string;
}) {
  const pathname = usePathname();
  const suffix = pathname.replace(/^\/(ko|en)(?=\/|$)/u, '') || '';

  return (
    <nav className="language-switcher" aria-label="Language">
      <a
        href={`/ko${suffix}`}
        hrefLang="ko"
        lang="ko"
        aria-current={locale === 'ko' ? 'page' : undefined}
      >
        {koreanLabel}
      </a>
      <span aria-hidden="true">/</span>
      <a
        href={`/en${suffix}`}
        hrefLang="en"
        lang="en"
        aria-current={locale === 'en' ? 'page' : undefined}
      >
        {englishLabel}
      </a>
    </nav>
  );
}
