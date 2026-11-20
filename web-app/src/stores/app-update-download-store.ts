import { create } from 'zustand'

type AppUpdateDownload = {
  isDownloading: boolean
  downloadProgress: number
  downloadedBytes: number
  totalBytes: number
}

type AppUpdateDownloadState = AppUpdateDownload & {
  update: (partial: Partial<AppUpdateDownload>) => void
}

// App-update download progress, fed by the AppEvent download events.
// DownloadManagement is mounted in the sidebar or the header depending on
// whether the sidebar is open, so per-instance state was lost on every toggle.
export const useAppUpdateDownload = create<AppUpdateDownloadState>()((set) => ({
  isDownloading: false,
  downloadProgress: 0,
  downloadedBytes: 0,
  totalBytes: 0,
  update: (partial) => set(partial),
}))
