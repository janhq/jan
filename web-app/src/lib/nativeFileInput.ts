import { APICallError } from 'ai'
import type { Attachment } from '@/types/attachment'

/**
 * Providers whose requests go through the OpenAI Responses API, which reads a
 * PDF itself (its text and its page images). There a PDF is sent to the model
 * as it is, rather than parsed into text or indexed for retrieval.
 */
const NATIVE_PDF_PROVIDERS = new Set(['openai', 'azure'])

export const supportsNativePdf = (providerName: string | undefined): boolean =>
  providerName !== undefined && NATIVE_PDF_PROVIDERS.has(providerName)

export const PDF_MEDIA_TYPE = 'application/pdf'

export const isPdfAttachment = (
  attachment: Pick<Attachment, 'type' | 'name' | 'fileType'>
): boolean =>
  attachment.type === 'document' &&
  (attachment.fileType?.toLowerCase() === 'pdf' ||
    attachment.name.toLowerCase().endsWith('.pdf'))

/**
 * Whether `attachment` goes to the model as it is rather than parsed into text
 * or indexed for retrieval. Project files are shared by threads on any model,
 * so they stay indexed.
 */
export const isSentAsIs = (
  attachment: Pick<Attachment, 'type' | 'name' | 'fileType'>,
  providerName: string | undefined,
  projectId?: string
): boolean =>
  !projectId && supportsNativePdf(providerName) && isPdfAttachment(attachment)

/** Error codes the API returns when it cannot read an attached file. */
const FILE_REJECTION_CODES = new Set(['invalid_file', 'unsupported_file'])

/**
 * Whether the API refused a file attached to the request (for example a
 * corrupted PDF), as opposed to any other failure.
 */
export function isAttachedFileRejection(error: unknown): boolean {
  if (!APICallError.isInstance(error) || error.statusCode !== 400) return false
  const code = (error.data as { error?: { code?: unknown } } | undefined)?.error
    ?.code
  return typeof code === 'string' && FILE_REJECTION_CODES.has(code)
}
