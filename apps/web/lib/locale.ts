import { LocaleSchema, type Locale } from '@ara/shared';
import { notFound } from 'next/navigation';

export function parseLocale(value: string): Locale {
  const result = LocaleSchema.safeParse(value);
  if (!result.success) notFound();
  return result.data;
}

export function localizedHref(locale: Locale, path = ''): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `/${locale}${suffix === '/' ? '' : suffix}`;
}
