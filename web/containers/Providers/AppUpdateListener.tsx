/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fragment, PropsWithChildren, useEffect } from 'react'

import { useSetAtom } from 'jotai'

import { appDownloadProgress } from './Jotai'

const AppUpdateListener = ({ children }: PropsWithChildren) => {
  const setProgress = useSetAtom(appDownloadProgress)

  useEffect(() => {
    if (window && window.electronAPI) {
      window.electronAPI.onAppUpdateDownloadUpdate(
        (_event: string, progress: any) => {
          setProgress(progress.percent)
          console.debug('app update progress:', progress.percent)
        }
      )

      window.electronAPI.onAppUpdateDownloadError(
        (_event: string, callback: any) => {
          console.error('Download error', callback)
          setProgress(-1)
        }
      )

      window.electronAPI.onAppUpdateDownloadSuccess(() => {
        setProgress(-1)
      })
    }
    return () => {}
  }, [setProgress])

  return <Fragment>{children}</Fragment>
}

export default AppUpdateListener
