import { useState } from 'react'
import type { ThreadFolder } from '@/services/projects/types'

/** Home draft intent, not authorization. Route-local lifetime prevents a
 * completed conversation's project/assistant leaking into the next draft. */
export function useHomeScope() {
  const [folder, setFolder] = useState<string | null>(null)
  const [project, setProject] = useState<ThreadFolder | null>(null)
  return { folder, setFolder, project, setProject }
}
