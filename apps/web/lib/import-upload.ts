import { createHash } from 'node:crypto';
import {
  MAX_FILE_BYTES,
  MAX_FILE_COUNT,
  MAX_TOTAL_FILE_BYTES
} from './import-upload-limits';

export { MAX_FILE_BYTES, MAX_FILE_COUNT, MAX_TOTAL_FILE_BYTES } from './import-upload-limits';

const CSV_MIME_TYPES = new Set([
  '',
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'text/plain',
  'application/octet-stream'
]);

export interface PreparedUploadFile {
  sourceFileName: string;
  contentSha256: string;
  content: ArrayBuffer;
  mimeType: string;
}

export interface PreparedUpload {
  files: PreparedUploadFile[];
  submissionHash: string;
}

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadValidationError';
  }
}

function sha256(value: string | ArrayBuffer): string {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : new Uint8Array(value))
    .digest('hex');
}

function validateFile(file: File): void {
  if (!file.name.toLocaleLowerCase('en-US').endsWith('.csv')) {
    throw new UploadValidationError(`${file.name} must be a CSV file.`);
  }
  if (!CSV_MIME_TYPES.has(file.type.toLocaleLowerCase('en-US'))) {
    throw new UploadValidationError(`${file.name} has an unsupported CSV MIME type.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new UploadValidationError(`${file.name} exceeds the 10 MB limit.`);
  }
  if (file.size === 0) {
    throw new UploadValidationError(`${file.name} is empty.`);
  }
  if (/[/\\\0]/u.test(file.name)) {
    throw new UploadValidationError(`${file.name} has an invalid file name.`);
  }
}

export async function prepareUploadFiles(files: File[]): Promise<PreparedUpload> {
  if (files.length === 0) {
    throw new UploadValidationError('Select at least one CSV file.');
  }
  if (files.length > MAX_FILE_COUNT) {
    throw new UploadValidationError('Select at most 20 CSV files.');
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_FILE_BYTES) {
    throw new UploadValidationError('Selected CSV files exceed the 20 MB combined limit.');
  }

  const prepared: PreparedUploadFile[] = [];
  for (const file of files) {
    validateFile(file);
    const content = await file.arrayBuffer();
    const text = new TextDecoder().decode(content);
    prepared.push({
        sourceFileName: file.name.normalize('NFC'),
        contentSha256: sha256(text),
        content,
        mimeType: file.type || 'text/csv'
      });
  }

  prepared.sort(
    (left, right) =>
      left.sourceFileName.localeCompare(right.sourceFileName, 'en') ||
      left.contentSha256.localeCompare(right.contentSha256, 'en')
  );

  const submissionHash = sha256(
    JSON.stringify(
      prepared.map(({ sourceFileName, contentSha256 }) => ({
        sourceFileName,
        contentSha256
      }))
    )
  );

  return { files: prepared, submissionHash };
}
