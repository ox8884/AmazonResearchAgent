import { describe, expect, it } from 'vitest';
import {
  MAX_FILE_BYTES,
  MAX_TOTAL_FILE_BYTES,
  prepareUploadFiles
} from './import-upload';

function csvFile(name: string, content = 'Keyword,Niche Score\nspoon,8') {
  return new File([content], name, { type: 'text/csv' });
}

describe('prepareUploadFiles', () => {
  it('requires at least one and at most twenty files', async () => {
    await expect(prepareUploadFiles([])).rejects.toThrow('at least one');
    await expect(
      prepareUploadFiles(
        Array.from({ length: 21 }, (_, index) => csvFile(`${index}.csv`))
      )
    ).rejects.toThrow('at most 20');
  });

  it('accepts CSV MIME variants and rejects other extensions', async () => {
    const prepared = await prepareUploadFiles([
      csvFile('page-1.csv'),
      new File(['a,b'], 'page-2.csv', { type: 'application/vnd.ms-excel' })
    ]);

    expect(prepared.files).toHaveLength(2);
    await expect(
      prepareUploadFiles([new File(['a'], 'notes.txt', { type: 'text/csv' })])
    ).rejects.toThrow('CSV');
  });

  it('enforces the ten megabyte per-file limit', async () => {
    const oversized = new File(
      [new Uint8Array(MAX_FILE_BYTES + 1)],
      'large.csv',
      { type: 'text/csv' }
    );
    await expect(prepareUploadFiles([oversized])).rejects.toThrow('10 MB');
  });

  it('rejects a selection whose aggregate size exceeds the request limit', async () => {
    const files = Array.from({ length: 3 }, (_, index) =>
      new File(
        [new Uint8Array(Math.floor(MAX_TOTAL_FILE_BYTES / 2)).fill(97)],
        `${index}.csv`,
        { type: 'text/csv' }
      )
    );

    await expect(prepareUploadFiles(files)).rejects.toThrow('combined');
  });

  it('creates stable file and submission hashes independent of selection order', async () => {
    const a = csvFile('a.csv', 'a,b\n1,2');
    const b = csvFile('b.csv', 'a,b\n3,4');
    const first = await prepareUploadFiles([a, b]);
    const second = await prepareUploadFiles([b, a]);

    expect(first.submissionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.submissionHash).toBe(first.submissionHash);
    expect(first.files.map((file) => file.contentSha256)).toEqual(
      second.files.map((file) => file.contentSha256)
    );
  });

  it('hashes the uploaded bytes instead of a lossy decoded representation', async () => {
    const first = await prepareUploadFiles([
      new File([new Uint8Array([0xc3, 0x28])], 'first.csv', { type: 'text/csv' })
    ]);
    const second = await prepareUploadFiles([
      new File([new Uint8Array([0xef, 0xbf, 0xbd, 0x28])], 'second.csv', {
        type: 'text/csv'
      })
    ]);

    expect(first.files[0]?.contentSha256).not.toBe(second.files[0]?.contentSha256);
  });
});
