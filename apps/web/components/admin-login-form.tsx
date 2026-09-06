'use client';

import { getCopy, type Locale } from '@ara/shared';
import ky from 'ky';
import { useEffect, useState, type FormEvent } from 'react';

export function AdminLoginForm({ locale }: { locale: Locale }) {
  const copy = getCopy(locale);
  const [failed, setFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [totpRequired, setTotpRequired] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void ky
      .get('/api/auth/login', { credentials: 'same-origin' })
      .json<{ totpRequired?: boolean }>()
      .then((body) => {
        if (!cancelled) {
          setTotpRequired(body.totpRequired !== false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTotpRequired(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setFailed(false);
    const form = event.currentTarget;
    const formData = new FormData(form);
    const password = formData.get('password');
    const totpValue = String(formData.get('totp') ?? '').trim();
    try {
      await ky.post('/api/auth/login', {
        json: totpValue.length > 0 ? { password, totp: totpValue } : { password },
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
        {totpRequired ? (
          <>
            <label htmlFor="admin-totp">{copy.adminTotp}</label>
            <input
              id="admin-totp"
              name="totp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              required
            />
            <p className="field-help">{copy.adminTotpHint}</p>
          </>
        ) : null}
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
