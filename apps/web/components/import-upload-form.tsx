'use client';

import { getCopy, type Locale } from '@ara/shared';
import ky from 'ky';
import { useId, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { MAX_FILE_BYTES, MAX_FILE_COUNT } from '../lib/import-upload-limits';
import { StatusBadge } from './ui';

const ImportResponseSchema = z.object({
  import_run_id: z.uuid()
});

type SubmissionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'uploading' }
  | { readonly kind: 'queued'; readonly importRunId: string }
  | { readonly kind: 'error' };

export function ImportUploadForm({ locale }: { locale: Locale }) {
  const copy = getCopy(locale);
  const inputId = useId();
  const [files, setFiles] = useState<readonly File[]>([]);
  const [submission, setSubmission] = useState<SubmissionState>({ kind: 'idle' });
  const [validationError, setValidationError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (files.length === 0 || validationError || submission.kind === 'uploading') {
      return;
    }

    setSubmission({ kind: 'uploading' });
    const body = new FormData();
    body.set('locale', locale);
    for (const file of files) {
      body.append('files', file);
    }

    try {
      const result = ImportResponseSchema.parse(
        await ky.post('/api/imports', { body }).json<unknown>()
      );
      setSubmission({ kind: 'queued', importRunId: result.import_run_id });
    } catch (error) {
      if (error instanceof Error) {
        setSubmission({ kind: 'error' });
        return;
      }
      throw error;
    }
  }

  return (
    <form className="upload-form" onSubmit={submit}>
      <div className="field-stack">
        <label htmlFor={inputId}>{copy.uploadTitle}</label>
        <input
          id={inputId}
          type="file"
          name="files"
          accept=".csv,text/csv"
          multiple
          required
          aria-invalid={validationError ? true : undefined}
          aria-describedby={`${inputId}-help${validationError ? ` ${inputId}-error` : ''}`}
          onChange={(event) => {
            const selectedFiles = Array.from(event.currentTarget.files ?? []);
            let nextError: string | null = null;
            if (selectedFiles.length > MAX_FILE_COUNT) {
              nextError = copy.uploadTooMany;
            } else if (selectedFiles.some((file) => file.size > MAX_FILE_BYTES)) {
              nextError = copy.uploadTooLarge;
            } else if (
              selectedFiles.some(
                (file) =>
                  file.size === 0 ||
                  !file.name.toLocaleLowerCase('en-US').endsWith('.csv')
              )
            ) {
              nextError = copy.uploadInvalidFile;
            }
            setFiles(selectedFiles);
            setValidationError(nextError);
            setSubmission({ kind: 'idle' });
          }}
        />
        <p className="field-help" id={`${inputId}-help`}>{copy.uploadHelp}</p>
      </div>

      {validationError ? (
        <p className="notice notice--error" id={`${inputId}-error`} role="alert">
          {validationError}
        </p>
      ) : null}

      {files.length > 0 && !validationError ? (
        <section aria-labelledby={`${inputId}-files`}>
          <h2 className="form-section-title" id={`${inputId}-files`}>{copy.selectedFiles}</h2>
          <ul className="selected-files">
            {files.map((file) => (
              <li key={`${file.name}:${file.size}:${file.lastModified}`}>
                <span>{file.name}</span>
                <span>{(file.size / 1024).toFixed(1)} KB</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="privacy-note">{copy.privacyNote}</p>
      <button
        className="button button--primary"
        type="submit"
        disabled={
          files.length === 0 ||
          validationError !== null ||
          submission.kind === 'uploading'
        }
      >
        {submission.kind === 'uploading' ? copy.uploadingFiles : copy.startImport}
      </button>

      <div className="import-result" aria-live="polite">
        {submission.kind === 'queued' ? (
          <>
            <StatusBadge status="queued" label={copy.importQueued} />
            <p>{copy.uploadSuccess}</p>
            <p className="import-id">
              <span>{copy.importIdLabel}</span>
              <code>{submission.importRunId}</code>
            </p>
          </>
        ) : null}
        {submission.kind === 'error' ? (
          <p className="notice notice--error" role="alert">{copy.uploadError}</p>
        ) : null}
      </div>
    </form>
  );
}
