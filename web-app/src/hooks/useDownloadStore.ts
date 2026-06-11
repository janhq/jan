import { create } from 'zustand'

export interface DownloadProgressProps {
  id: string
  progress: number
  name: string
  current: number
  total: number
}

// ATO-154: parameters needed to resume a paused model download from the
// global Download popover. The popover only knows the model id, not the HF
// paths/token, so the download-start choke point (`pullModelWithMetadata`)
// records them here. Only the resumable GGUF (`llamacpp`) path stores these;
// MLX (`mlx-community/*`) and backend-binary downloads are pause/resume-gated
// out and never populate this map.
export interface DownloadResumeParams {
  modelPath: string
  mmprojPath?: string
  hfToken?: string
  skipVerification?: boolean
}

// Zustand store for thinking block state
export type DownloadState = {
  downloads: { [id: string]: DownloadProgressProps }
  localDownloadingModels: Set<string>
  resumableDownloads: Set<string>
  // Maps a raw `quant.model_id` to the `model.model_name` of the Hub
  // card that initiated the download. Used as a defensive disambiguator
  // when the curated catalog accidentally emits the same `quant.model_id`
  // for files of identical name living in different HF repos
  // (e.g. `unsloth/Qwen3.5-4B-GGUF` and `unsloth/Qwen3.5-4B-MTP-GGUF`).
  // Without this map both Hub cards react to the same progress events
  // and look like they are both being downloaded. The catalog scraper
  // fixes the root cause; this map keeps the UI honest for clients on
  // an older cached catalog.
  downloadOriginByModelId: { [modelId: string]: string }
  // ATO-154: ids the user has paused (vs cancelled). A paused id keeps its
  // `downloads[id]` entry so the popover row survives, and makes the
  // stop/error listeners early-return instead of cleaning up.
  pausedDownloads: Set<string>
  // ATO-154: resume parameters keyed by model id (see DownloadResumeParams).
  resumeParams: { [modelId: string]: DownloadResumeParams }
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
  markResumableDownload: (modelId: string) => void
  clearResumableDownload: (modelId: string) => void
  markPausedDownload: (modelId: string) => void
  clearPausedDownload: (modelId: string) => void
  setResumeParams: (modelId: string, params: DownloadResumeParams) => void
  clearResumeParams: (modelId: string) => void
  setDownloadOrigin: (modelId: string, modelName: string) => void
  clearDownloadOrigin: (modelId: string) => void
}

/**
 * This store is used to manage the download progress of files.
 */
export const useDownloadStore = create<DownloadState>((set) => ({
  downloads: {},
  localDownloadingModels: new Set(),
  resumableDownloads: new Set(),
  pausedDownloads: new Set(),
  resumeParams: {},
  downloadOriginByModelId: {},
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

  markResumableDownload: (modelId: string) =>
    set((state) => ({
      resumableDownloads: new Set(state.resumableDownloads).add(modelId),
    })),

  clearResumableDownload: (modelId: string) =>
    set((state) => {
      const newSet = new Set(state.resumableDownloads)
      newSet.delete(modelId)
      return { resumableDownloads: newSet }
    }),

  markPausedDownload: (modelId: string) =>
    set((state) => ({
      pausedDownloads: new Set(state.pausedDownloads).add(modelId),
    })),

  clearPausedDownload: (modelId: string) =>
    set((state) => {
      const newSet = new Set(state.pausedDownloads)
      newSet.delete(modelId)
      return { pausedDownloads: newSet }
    }),

  setResumeParams: (modelId: string, params: DownloadResumeParams) =>
    set((state) => ({
      resumeParams: {
        ...state.resumeParams,
        [modelId]: params,
      },
    })),

  clearResumeParams: (modelId: string) =>
    set((state) => {
      if (!(modelId in state.resumeParams)) {
        return state
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [modelId]: _, ...rest } = state.resumeParams
      return { resumeParams: rest }
    }),

  setDownloadOrigin: (modelId: string, modelName: string) =>
    set((state) => ({
      downloadOriginByModelId: {
        ...state.downloadOriginByModelId,
        [modelId]: modelName,
      },
    })),

  clearDownloadOrigin: (modelId: string) =>
    set((state) => {
      if (!(modelId in state.downloadOriginByModelId)) {
        return state
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [modelId]: _, ...rest } = state.downloadOriginByModelId
      return { downloadOriginByModelId: rest }
    }),
}))
