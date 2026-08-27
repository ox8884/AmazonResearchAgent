'use client';

import { getCopy, type Locale } from '@ara/shared';
import ky from 'ky';
import { adminCsrfHeaders } from '../lib/admin-csrf';

export function AdminLogoutButton({ locale }: { locale: Locale }) {
  const copy = getCopy(locale);
  return (
    <button
      className="button button--secondary"
      type="button"
      onClick={async () => {
        await ky.post('/api/auth/logout', {
          headers: adminCsrfHeaders(),
          credentials: 'same-origin'
        });
        window.location.assign(`/${locale}/login`);
      }}
    >
      {copy.adminLogout}
    </button>
  );
}
