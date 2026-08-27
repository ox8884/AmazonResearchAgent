'use client';

import { getCopy, type Locale } from '@ara/shared';
import ky from 'ky';
import { useState, type FormEvent } from 'react';

export function AdminLoginForm({ locale }: { locale: Locale }) {
  const copy = getCopy(locale);
  const [failed, setFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setFailed(false);
    const form = event.currentTarget;
    const password = new FormData(form).get('password');
    try {
      await ky.post('/api/auth/login', {
        json: { password },
        credentials: 'same-origin'
      });
      window.location.assign(`/${locale}/settings/ai`);
    } catch (error) {
      if (error instanceof Error) {
        setFailed(true);
        setSubmitting(false);
        return;
      }
      throw error;
    }
  }

  return (
    <form className="upload-form" onSubmit={submit}>
      <div className="field-stack">
        <label htmlFor="admin-password">{copy.adminPassword}</label>
        <input
          id="admin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <button className="button button--primary" type="submit" disabled={submitting}>
        {copy.adminLogin}
      </button>
      {failed ? (
        <p className="notice notice--error" role="alert">{copy.invalidLogin}</p>
      ) : null}
    </form>
  );
}
