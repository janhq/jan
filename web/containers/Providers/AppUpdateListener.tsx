/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fragment, PropsWithChildren, useEffect } from 'react'

import { useSetAtom } from 'jotai'

import { appDownloadProgress, updateVersionError } from './Jotai'

const AppUpdateListener = ({ children }: PropsWithChildren) => {
  const setProgress = useSetAtom(appDownloadProgress)
  const setUpdateVersionError = useSetAtom(updateVersionError)

  useEffect(() => {
    if (window && window.electronAPI) {
      window.electronAPI.onAppUpdateDownloadUpdate(
        (_event: string, progress: any) => {
          setProgress(progress.percent)
          console.debug('app update progress:', progress.percent)
        }
      )

      window.electronAPI.onAppUpdateDownloadError(
        (_event: string, error: any) => {
          console.error('Download error: ', error)
          setProgress(-1)

          // Can not install update
          // Prompt user to download the update manually
          setUpdateVersionError(error.failedToInstallVersion)
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
