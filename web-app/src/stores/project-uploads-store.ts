import { create } from 'zustand'
import type { Attachment } from '@/types/attachment'

export type ProjectUploadProgress = {
  current: number
  total: number
  currentFileName?: string
}

type IngestFn = (
  projectId: string,
  attachment: Attachment,
) => Promise<{ id?: string }>

type IngestHandlers = {
  onSuccess: () => void
  onError: (error: unknown, fileName?: string) => void
}

interface ProjectUploadsState {
  progress: Record<string, ProjectUploadProgress>
  // Monotonic counter per project that increments after every successful
  // ingestion. Consumers watch this to refresh their file list whenever a
  // file finishes in the background — including while they were unmounted.
  completedTick: Record<string, number>
  isIngesting: (projectId: string) => boolean
  ingest: (
    projectId: string,
    attachments: Attachment[],
    ingestFn: IngestFn,
    handlers: IngestHandlers,
  ) => Promise<void>
}

export const useProjectUploads = create<ProjectUploadsState>((set, get) => ({
  progress: {},
  completedTick: {},
  isIngesting: (projectId) => !!get().progress[projectId],
  ingest: async (projectId, attachments, ingestFn, handlers) => {
    const total = attachments.length
    if (total === 0) return
    if (get().progress[projectId]) return

    set((s) => ({
      progress: {
        ...s.progress,
        [projectId]: {
          current: 0,
          total,
          currentFileName: attachments[0]?.name,
        },
      },
    }))

    let currentFileName: string | undefined
    try {
      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i]
        currentFileName = att.name

        set((s) => {
          const existing = s.progress[projectId]
          if (!existing) return s
          return {
            progress: {
              ...s.progress,
              [projectId]: {
                ...existing,
                current: i,
                currentFileName: att.name,
              },
            },
          }
        })

        const result = await ingestFn(projectId, att)
        if (!result.id) throw new Error('Failed to ingest file')

        set((s) => {
          const existing = s.progress[projectId]
          const nextTick = (s.completedTick[projectId] ?? 0) + 1
          return {
            progress: existing
              ? {
                  ...s.progress,
                  [projectId]: { ...existing, current: i + 1 },
                }
              : s.progress,
            completedTick: { ...s.completedTick, [projectId]: nextTick },
          }
        })
      }
      handlers.onSuccess()
    } catch (error) {
      handlers.onError(error, currentFileName)
    } finally {
      set((s) => {
        const next = { ...s.progress }
        delete next[projectId]
        return { progress: next }
      })
    }
  },
}))
