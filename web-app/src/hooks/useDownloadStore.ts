import { create } from 'zustand'

export interface DownloadProgressProps {
  id: string
  progress: number
  name: string
  current: number
  total: number
}

// Zustand store for thinking block state
export type DownloadState = {
  downloads: { [id: string]: DownloadProgressProps }
  localDownloadingModels: Set<string>
  removeDownload: (id: string) => void
  updateProgress: (
    id: string,
    progress: number,
    name?: string,
    current?: number,
    total?: number
  ) => void
  addLocalDownloadingModel: (modelId: string) => void
  removeLocalDownloadingModel: (modelId: string) => void
}

/**
 * This store is used to manage the download progress of files.
 */
export const useDownloadStore = create<DownloadState>((set) => ({
  downloads: {},
  localDownloadingModels: new Set(),
  removeDownload: (id: string) =>
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _, ...rest } = state.downloads
      return { downloads: rest }
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
}))
