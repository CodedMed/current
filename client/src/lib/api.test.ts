import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DocumentUploadStage, SavedDocumentResult } from '../../../shared/copilot.ts';
import { ApiError, uploadCopilotDocument } from './api.ts';

function streamedResponse(content: string, bytesPerChunk = 7): Response {
  const bytes = new TextEncoder().encode(content);
  return new Response(new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += bytesPerChunk) controller.enqueue(bytes.slice(offset, offset + bytesPerChunk));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'application/x-ndjson' } });
}

test('document uploads accept a final saved event without a newline across split UTF-8 chunks', async (t) => {
  const result = { persisted: true, invoice: { id: 'saved-id', vendorDisplayName: 'Café Services' }, warnings: [] } as unknown as SavedDocumentResult;
  const stages: DocumentUploadStage[] = [];
  t.mock.method(globalThis, 'fetch', async () => streamedResponse(`\n${JSON.stringify({ stage: 'extracting' })}\r\n${JSON.stringify({ stage: 'saved', result })}`, 1));
  const actual = await uploadCopilotDocument(new File(['invoice'], 'invoice.pdf', { type: 'application/pdf' }), (stage) => stages.push(stage));
  assert.deepEqual(actual, result);
  assert.deepEqual(stages, ['uploading', 'extracting', 'saved']);
});

test('document upload preserves an error emitted after extraction instead of reporting a save', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => streamedResponse(`${JSON.stringify({ stage: 'extracting' })}\n${JSON.stringify({ stage: 'error', error: { code: 'DOCUMENT_EXTRACTION_FAILED', message: 'Invoice text could not be extracted.' } })}`));
  await assert.rejects(uploadCopilotDocument(new File(['invoice'], 'invoice.pdf', { type: 'application/pdf' })), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'DOCUMENT_EXTRACTION_FAILED');
    assert.equal(error.message, 'Invoice text could not be extracted.');
    return true;
  });
});

test('an incomplete document stream asks the user to check saved invoices before retrying', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => streamedResponse(`${JSON.stringify({ stage: 'scoring' })}\n`));
  await assert.rejects(uploadCopilotDocument(new File(['invoice'], 'invoice.pdf', { type: 'application/pdf' })), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'interrupted');
    assert.match(error.message, /Check your invoices before uploading again/);
    return true;
  });
});
