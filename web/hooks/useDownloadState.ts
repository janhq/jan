import { DownloadState2, DownloadStatus, DownloadType2 } from '@janhq/core'
import { atom } from 'jotai'

export const downloadStateListAtom = atom<DownloadState2[]>([])

export const addDownloadModelStateAtom = atom(
  null,
  (_get, set, modelId: string) => {
    const state: DownloadState2 = {
      id: modelId,
      title: modelId,
      type: DownloadType2.Model,
      status: DownloadStatus.Downloading,
      children: [
        {
          id: modelId,
          time: {
            elapsed: 0,
            remaining: 0,
          },
          size: {
            total: 0,
            transferred: 0,
          },
          status: DownloadStatus.Downloading,
        },
      ],
    }
    set(downloadStateListAtom, (old) => [...old, state])
  }
)
