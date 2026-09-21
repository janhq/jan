import type { CoworkAttachedFile } from '@/types/coworkSession'

/**
 * Attached documents reach the agent as files in its workspace, not as
 * retrieval results: the file picker hands us a path outside every root the
 * file tools may read, so the file is copied in, and a binary format gets an
 * extracted-text sibling because `read` refuses non-UTF-8 content.
 */
export type AttachmentImportDeps = {
  /** Text extracted from the document, or '' when no parser can read it. */
  parse: (path: string, fileType?: string) => Promise<string>
  /** The workspace copy, or null when it could not be made. */
  importFile: (
    path: string,
    text?: string
  ) => Promise<{ path: string; textPath: string | null } | null>
}

/**
 * Import every file not already in the workspace. A file that fails to import
 * is kept as it was, so the wire text can tell the agent rather than have it
 * hunt for a path that does not exist.
 */
export async function importAttachedFiles(
  files: CoworkAttachedFile[],
  deps: AttachmentImportDeps
): Promise<CoworkAttachedFile[]> {
  const out: CoworkAttachedFile[] = []
  for (const file of files) {
    if (file.workspacePath) {
      out.push(file)
      continue
    }
    const text = await deps.parse(file.path, file.fileType).catch(() => '')
    const imported = await deps.importFile(file.path, text || undefined)
    if (!imported) {
      out.push(file)
      continue
    }
    const next: CoworkAttachedFile = { ...file, workspacePath: imported.path }
    if (imported.textPath) next.textPath = imported.textPath
    out.push(next)
  }
  return out
}

/** The question as the model sees it: the text, then where each attachment is. */
export function withAttachedFiles(
  text: string,
  files: CoworkAttachedFile[] | undefined
): string {
  if (!files?.length) return text
  const lines = files.map((f) => {
    if (!f.workspacePath) {
      return `- ${f.name}: could not be copied into the workspace`
    }
    const extracted = f.textPath ? ` (extracted text: ${f.textPath})` : ''
    return `- ${f.name}: ${f.workspacePath}${extracted}`
  })
  return [
    text,
    '',
    'The user attached these files, copied into your workspace. Read the',
    'extracted text where one is listed; the original is beside it for tools',
    'that need the file itself.',
    ...lines,
  ].join('\n')
}
