import {
  getCopy,
  ImportRunStatusSchema,
  type ImportRunStatus,
  type Locale
} from '@ara/shared';
import type { ReactNode } from 'react';

export function ButtonLink({
  href,
  children,
  variant = 'primary'
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <a className={`button button--${variant}`} href={href}>
      {children}
    </a>
  );
}

export function StatusBadge({
  status,
  label
}: {
  status: ImportRunStatus;
  label: string;
}) {
  return <span className={`status status--${status}`}>{label}</span>;
}

export function LocalizedStatusBadge({
  status,
  locale
}: {
  status: string;
  locale: Locale;
}) {
  const parsedStatus = ImportRunStatusSchema.parse(status);
  const copy = getCopy(locale);
  const label = {
    queued: copy.importQueued,
    processing: copy.importProcessing,
    completed: copy.importCompleted,
    failed: copy.importFailed
  }[parsedStatus];
  return <StatusBadge status={parsedStatus} label={label} />;
}

export function MetricCard({
  label,
  value,
  note
}: {
  label: string;
  value: number | string;
  note?: string;
}) {
  return (
    <article className="metric-card">
      <p className="metric-card__label">{label}</p>
      <p className="metric-card__value">{value}</p>
      {note ? <p className="metric-card__note">{note}</p> : null}
    </article>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty-state">{children}</p>;
}

export function localeDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}
