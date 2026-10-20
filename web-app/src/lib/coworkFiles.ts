import type { CoworkAttachedFile, CoworkTurn } from '@/types/coworkSession'

/**
 * Every document the user attached across the session, in the order they were
 * attached and deduplicated by source path: the same file attached to two
 * questions is one file. Later turns win, so a copy imported on a re-ask
 * supersedes the record of the failed first attempt.
 */
export function sessionAttachments(
  turns: CoworkTurn[] | undefined
): CoworkAttachedFile[] {
  if (!turns?.length) return []
  const byPath = new Map<string, CoworkAttachedFile>()
  for (const turn of turns) {
    if (turn.role !== 'user' || !turn.files?.length) continue
    for (const file of turn.files) byPath.set(file.path, file)
  }
  return [...byPath.values()]
}
