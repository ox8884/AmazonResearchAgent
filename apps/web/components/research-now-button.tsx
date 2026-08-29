'use client';

import { getCopy, type Locale } from '@ara/shared';
import ky from 'ky';
import { useState } from 'react';
import { z } from 'zod';
import { adminCsrfHeaders } from '../lib/admin-csrf';

const ResearchNowResponseSchema = z.object({
  research_run_id: z.string().min(1)
});

export function ResearchNowButton({ locale }: { locale: Locale }) {
  const copy = getCopy(locale);
  const [status, setStatus] = useState<'idle' | 'queued' | 'error'>('idle');

  async function enqueue(mode: 'normal' | 'override-reserve'): Promise<void> {
    if (mode === 'override-reserve' && !window.confirm(copy.researchNowOverrideConfirm)) {
      return;
    }
    try {
      const payload = await ky
        .post('/api/research-now', {
          json: { mode },
          headers: adminCsrfHeaders(),
          credentials: 'same-origin'
        })
        .json<unknown>();
      ResearchNowResponseSchema.parse(payload);
      setStatus('queued');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="cluster">
      <button
        type="button"
        className="button button--primary"
        onClick={() => {
          void enqueue('normal');
        }}
      >
        {copy.researchNow}
      </button>
      <button
        type="button"
        className="button button--secondary"
        onClick={() => {
          void enqueue('override-reserve');
        }}
      >
        {copy.researchNowOverride}
      </button>
      {status === 'queued' ? (
        <p className="notice" role="status">
          {copy.researchNowQueued}
        </p>
      ) : null}
      {status === 'error' ? (
        <p className="notice notice--error" role="alert">
          {copy.researchNowError}
        </p>
      ) : null}
    </div>
  );
}
