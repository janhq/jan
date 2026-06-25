import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

export interface DownloadProgressProps {
  id: string
  progress: number
  name: string
  current: number
  total: number
  paused?: boolean
}

// Params needed to re-issue a paused download's pull on resume.
export interface DownloadResumeParams {
  modelPath: string
  mmprojPath?: string
  hfToken?: string
}

// Zustand store for thinking block state
export type DownloadState = {
  downloads: { [id: string]: DownloadProgressProps }
  localDownloadingModels: Set<string>
  resumeParams: { [id: string]: DownloadResumeParams }
  removeDownload: (id: string) => void
  updateProgress: (
    id: string,
    progress: number,
    name?: string,
    current?: number,
    total?: number
  ) => void
  setPaused: (id: string, paused: boolean) => void
  setResumeParams: (id: string, params: DownloadResumeParams) => void
  addLocalDownloadingModel: (modelId: string) => void
  removeLocalDownloadingModel: (modelId: string) => void
}

/**
 * This store is used to manage the download progress of files.
 * Only paused downloads are persisted so they (and their resume params)
 * survive an app restart; in-flight downloads die with the process.
 */
export const useDownloadStore = create<DownloadState>()(
  persist(
    (set) => ({
      downloads: {},
      localDownloadingModels: new Set(),
      resumeParams: {},
      removeDownload: (id: string) =>
        set((state) => {
          /* eslint-disable @typescript-eslint/no-unused-vars */
          const { [id]: _, ...rest } = state.downloads
          const { [id]: __, ...restParams } = state.resumeParams
          /* eslint-enable @typescript-eslint/no-unused-vars */
          return { downloads: rest, resumeParams: restParams }
        }),

      updateProgress: (id, progress, name, current, total) =>
        set((state) => ({
          downloads: {
            ...state.downloads,
            [id]: {
              ...state.downloads[id],
              name: name || state.downloads[id]?.name || '',
              progress,
              current: current || state.downloads[id]?.current || 0,
              total: total || state.downloads[id]?.total || 0,
            },
          },
        })),

      setPaused: (id, paused) =>
        set((state) => ({
          downloads: {
            ...state.downloads,
            [id]: {
              id,
              name: state.downloads[id]?.name || id,
              progress: state.downloads[id]?.progress || 0,
              current: state.downloads[id]?.current || 0,
              total: state.downloads[id]?.total || 0,
              paused,
            },
          },
        })),

      setResumeParams: (id, params) =>
        set((state) => ({
          resumeParams: { ...state.resumeParams, [id]: params },
        })),

      addLocalDownloadingModel: (modelId: string) =>
        set((state) => ({
          localDownloadingModels: new Set(state.localDownloadingModels).add(
            modelId
          ),
        })),

      removeLocalDownloadingModel: (modelId: string) =>
        set((state) => {
          const newSet = new Set(state.localDownloadingModels)
          newSet.delete(modelId)
          return { localDownloadingModels: newSet }
        }),
    }),
    {
      name: localStorageKey.pausedDownloads,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        const downloads: { [id: string]: DownloadProgressProps } = {}
        const resumeParams: { [id: string]: DownloadResumeParams } = {}
        for (const [id, d] of Object.entries(state.downloads)) {
          if (!d.paused) continue
          downloads[id] = d
          if (state.resumeParams[id]) resumeParams[id] = state.resumeParams[id]
        }
        return { downloads, resumeParams }
      },
    }
  )
)
