import { createQueue } from '@ara/queue';
import { ImportOpportunityCsvJobPayloadSchema, type Locale } from '@ara/shared';
import type { PreparedUpload } from '../import-upload';
import { getServerDatabaseContext } from './database';


export class ImportEnqueueError extends Error {
  constructor(operation: string, cause?: unknown) {
    super(`Could not ${operation}.`, { cause });
    this.name = 'ImportEnqueueError';
  }
}


function storagePath(
  importRunId: string,
  index: number,
  sourceFileName: string,
  contentSha256: string
): string {
  return `${importRunId}/${index + 1}-${contentSha256.slice(0, 12)}-${sourceFileName}`;
}

export async function enqueueImport(
  prepared: PreparedUpload,
  locale: Locale
): Promise<string> {
  const { client, storageBucket: bucket } = getServerDatabaseContext();
  const { data: existing, error: existingError } = await client
    .from('import_runs')
    .select('id')
    .eq('submission_hash', prepared.submissionHash)
    .neq('status', 'failed')
    .maybeSingle();

  if (existingError) {
    throw new ImportEnqueueError('check for an existing import', existingError);
  }
  if (existing) {
    return existing.id;
  }

  const sourceFiles = prepared.files.map((file) => ({
    sourceFileName: file.sourceFileName,
    contentSha256: file.contentSha256
  }));
  const { data: importRun, error: insertError } = await client
    .from('import_runs')
    .insert({
      locale,
      submission_hash: prepared.submissionHash,
      file_count: prepared.files.length,
      source_files: sourceFiles
    })
    .select('id')
    .single();

  if (insertError || !importRun) {
    const { data: concurrent } = await client
      .from('import_runs')
      .select('id')
      .eq('submission_hash', prepared.submissionHash)
      .neq('status', 'failed')
      .maybeSingle();
    if (concurrent) {
      return concurrent.id;
    }
    throw new ImportEnqueueError('create the import run', insertError);
  }

  const fileReferences = prepared.files.map((file, index) => ({
    sourceFileName: file.sourceFileName,
    storagePath: storagePath(
      importRun.id,
      index,
      file.sourceFileName,
      file.contentSha256
    ),
    contentSha256: file.contentSha256
  }));

  try {
    for (const [index, file] of prepared.files.entries()) {
      const reference = fileReferences[index];
      if (!reference) {
        throw new ImportEnqueueError('resolve an upload reference');
      }
      const { error } = await client.storage
        .from(bucket)
        .upload(reference.storagePath, file.content, {
          contentType: file.mimeType,
          upsert: false
        });
      if (error) {
        throw new ImportEnqueueError(`upload ${file.sourceFileName}`, error);
      }
    }

    const payload = ImportOpportunityCsvJobPayloadSchema.parse({
      importRunId: importRun.id,
      storageBucket: bucket,
      files: fileReferences
    });
    const { error: updateError } = await client
      .from('import_runs')
      .update({ source_files: fileReferences })
      .eq('id', importRun.id);
    if (updateError) {
      throw new ImportEnqueueError('record private file references', updateError);
    }

    await createQueue(client).enqueueJob({
      type: 'IMPORT_OPPORTUNITY_CSV',
      payload,
      idempotencyKey: `import:${prepared.submissionHash}`
    });
    return importRun.id;
  } catch (error) {
    await client
      .from('import_runs')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Import enqueue failed'
      })
      .eq('id', importRun.id);
    throw error;
  }
}
