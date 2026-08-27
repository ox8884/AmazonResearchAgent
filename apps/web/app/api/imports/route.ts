import { LocaleSchema } from '@ara/shared';
import { NextResponse } from 'next/server';
import { prepareUploadFiles, UploadValidationError } from '../../../lib/import-upload';
import { ServerConfigurationError } from '../../../lib/server/database';
import { enqueueImport, ImportEnqueueError } from '../../../lib/server/enqueue-import';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const localeResult = LocaleSchema.safeParse(formData.get('locale'));
    if (!localeResult.success) {
      return NextResponse.json({ error: 'invalid_upload' }, { status: 400 });
    }
    const files = formData
      .getAll('files')
      .filter((value): value is File => value instanceof File);
    const prepared = await prepareUploadFiles(files);
    const importRunId = await enqueueImport(prepared, localeResult.data);
    return NextResponse.json({ import_run_id: importRunId }, { status: 202 });
  } catch (error) {
    if (error instanceof UploadValidationError) {
      return NextResponse.json({ error: 'invalid_upload' }, { status: 400 });
    }
    if (
      error instanceof ImportEnqueueError ||
      error instanceof ServerConfigurationError
    ) {
      return NextResponse.json({ error: 'enqueue_unavailable' }, { status: 503 });
    }
    throw error;
  }
}
