import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '../../components/app-shell';
import { parseLocale } from '../../lib/locale';
import '../globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Amazon Research Agent',
    template: '%s · Amazon Research Agent'
  },
  description: 'Auditable Amazon opportunity research from Jungle Scout CSV exports.'
};

export function generateStaticParams() {
  return [{ locale: 'ko' }, { locale: 'en' }];
}

export default async function LocaleLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = parseLocale((await params).locale);
  return (
    <html lang={locale}>
      <body>
        <AppShell locale={locale}>{children}</AppShell>
      </body>
    </html>
  );
}
