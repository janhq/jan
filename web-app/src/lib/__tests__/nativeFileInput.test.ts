import { describe, it, expect } from 'vitest'
import { APICallError } from 'ai'
import {
  isAttachedFileRejection,
  isPdfAttachment,
  isSentAsIs,
  supportsNativePdf,
} from '../nativeFileInput'

describe('supportsNativePdf', () => {
  // Both send requests through the Responses API, which reads PDFs itself.
  it('is true for the providers on the Responses API', () => {
    expect(supportsNativePdf('openai')).toBe(true)
    expect(supportsNativePdf('azure')).toBe(true)
  })

  it('is false for every other provider', () => {
    for (const name of ['llamacpp', 'anthropic', 'gemini', 'groq', 'custom', undefined]) {
      expect(supportsNativePdf(name)).toBe(false)
    }
  })
})

describe('isPdfAttachment', () => {
  it('recognises a PDF by its file type or its name', () => {
    expect(isPdfAttachment({ type: 'document', name: 'a', fileType: 'pdf' })).toBe(true)
    expect(isPdfAttachment({ type: 'document', name: 'Report.PDF' })).toBe(true)
  })

  it('leaves other documents and other attachments alone', () => {
    expect(isPdfAttachment({ type: 'document', name: 'notes.docx', fileType: 'docx' })).toBe(false)
    expect(isPdfAttachment({ type: 'image', name: 'scan.pdf' })).toBe(false)
  })
})

const apiError = (statusCode: number, body: unknown) =>
  new APICallError({
    message: (body as { error?: { message?: string } })?.error?.message ?? 'error',
    url: 'https://example.openai.azure.com/openai/v1/responses',
    requestBodyValues: {},
    statusCode,
    responseBody: JSON.stringify(body),
    data: body,
  })

describe('isAttachedFileRejection', () => {
  it('recognises the API refusing an attached file', () => {
    expect(
      isAttachedFileRejection(
        apiError(400, {
          error: {
            message:
              'The file you uploaded is badly formatted or corrupted. Please fix the file and try again.',
            type: 'invalid_request_error',
            param: 'input',
            code: 'invalid_file',
          },
        })
      )
    ).toBe(true)
  })

  it('ignores other request errors', () => {
    expect(
      isAttachedFileRejection(
        apiError(400, {
          error: {
            message: "Unsupported value: 'none' is not supported with this model.",
            param: 'reasoning.effort',
            code: 'unsupported_value',
          },
        })
      )
    ).toBe(false)
    expect(isAttachedFileRejection(apiError(429, { error: { code: 'rate_limit' } }))).toBe(false)
    expect(isAttachedFileRejection(new Error('network down'))).toBe(false)
  })
})

describe('isSentAsIs', () => {
  const pdf = { type: 'document' as const, name: 'report.pdf', fileType: 'pdf' }

  it('sends a PDF as it is to a Responses API model', () => {
    expect(isSentAsIs(pdf, 'azure')).toBe(true)
  })

  // Project files are shared by threads on any model, so they stay indexed.
  it('keeps project files, other files and other providers as before', () => {
    expect(isSentAsIs(pdf, 'azure', 'project-1')).toBe(false)
    expect(isSentAsIs({ ...pdf, name: 'a.docx', fileType: 'docx' }, 'azure')).toBe(false)
    expect(isSentAsIs(pdf, 'llamacpp')).toBe(false)
  })
})
