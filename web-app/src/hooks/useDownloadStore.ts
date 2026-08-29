import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'

export interface DownloadProgressProps {
  id: string
  progress: number
  name: string
  current: number
  total: number
  paused?: boolean
  /** 实时下载速度(字节/秒),由事件桥按字节差估算 */
  speed?: number
  /**
   * downloading=进行中 retrying=重试中(字节停流,后端在退避重连;显示态,
   * 字节恢复自动回到 downloading) paused=已暂停(持久化,可恢复)
   * failed=失败(内存级,条目保留供重试;不入 localStorage —— 磁盘断点仍在,
   * 重启后重新下载即可续传)
   */
  status?: 'downloading' | 'retrying' | 'paused' | 'failed'
  /** 失败原因原文(后端错误串;磁盘空间不足为结构化前缀,UI 侧本地化) */
  error?: string
  /** 当前重试轮次(重试中状态显示用) */
  attempt?: number
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
    total?: number,
    speed?: number
  ) => void
  setPaused: (id: string, paused: boolean) => void
  /** 标记失败:条目保留(冻结在断点),等用户重试或移除 */
  markFailed: (id: string, error: string) => void
  /** 标记重试中:字节停流(退避/重连),速度归零,进度值不动 */
  markRetrying: (id: string, attempt?: number) => void
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

      updateProgress: (id, progress, name, current, total, speed) =>
        set((state) => ({
          downloads: {
            ...state.downloads,
            [id]: {
              ...state.downloads[id],
              name: name || state.downloads[id]?.name || '',
              progress,
              current: current || state.downloads[id]?.current || 0,
              total: total || state.downloads[id]?.total || 0,
              speed: speed ?? state.downloads[id]?.speed,
              // 新进度到达 = 下载又在跑了(重试成功会自然回到进行中)
              status: state.downloads[id]?.paused ? 'paused' : 'downloading',
              error: undefined,
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
              status: paused ? 'paused' : 'downloading',
              error: undefined,
            },
          },
        })),

      markFailed: (id, error) =>
        set((state) => {
          const existing = state.downloads[id]
          // 暂停中的条目不转失败:暂停走的也是取消路径,其"错误"是静默的
          if (existing?.paused) return state
          return {
            downloads: {
              ...state.downloads,
              [id]: {
                id,
                name: existing?.name || id,
                progress: existing?.progress || 0,
                current: existing?.current || 0,
                total: existing?.total || 0,
                paused: false,
                status: 'failed',
                error,
              },
            },
          }
        }),

      markRetrying: (id, attempt) =>
        set((state) => {
          const existing = state.downloads[id]
          // 暂停中的条目不转重试中(暂停优先)
          if (existing?.paused) return state
          return {
            downloads: {
              ...state.downloads,
              [id]: {
                ...existing,
                id,
                name: existing?.name || id,
                paused: false,
                status: 'retrying',
                speed: 0,
                attempt: attempt ?? existing?.attempt,
              },
            },
          }
        }),

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
      storage: createJSONStorage(() => backendStorage),
      skipHydration: true,
      partialize: (state) => {
        const downloads: { [id: string]: DownloadProgressProps } = {}
        const resumeParams: { [id: string]: DownloadResumeParams } = {}
        for (const [id, d] of Object.entries(state.downloads)) {
          // 进行中的下载也持久化:进程被关闭时任务不丢,重启后以"已暂停"
          // 形态恢复(见 onRehydrateStorage),点继续即从磁盘账本断点续传。
          // 失败条目是内存级的,不持久化(磁盘断点仍在,重新下载即可续传)。
          if (d.status === 'failed') continue
          downloads[id] = d
          if (state.resumeParams[id]) resumeParams[id] = state.resumeParams[id]
        }
        return { downloads, resumeParams }
      },
      onRehydrateStorage: () => (state) => {
        // 重启恢复:进程死掉的"进行中"任务不再在跑,统一转成已暂停,
        // 下载弹窗显示继续按钮;点击继续时后端从账本断点续传。
        if (!state?.downloads) return
        for (const d of Object.values(state.downloads)) {
          if (!d.paused) {
            d.paused = true
          }
          d.status = 'paused'
        }
      },
    }
  )
)
