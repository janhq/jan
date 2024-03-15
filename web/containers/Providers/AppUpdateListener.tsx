import { Fragment, PropsWithChildren, useEffect } from 'react'

import { AppUpdateInfo } from '@janhq/core'
import { useSetAtom } from 'jotai'

import { appDownloadProgress, updateVersionError } from './Jotai'

const AppUpdateListener = ({ children }: PropsWithChildren) => {
  const setProgress = useSetAtom(appDownloadProgress)
  const setUpdateVersionError = useSetAtom(updateVersionError)

  useEffect(() => {
    if (window && window.electronAPI) {
      window.electronAPI.onAppUpdateDownloadUpdate(
        (_event: string, appUpdateInfo: AppUpdateInfo) => {
          setProgress(appUpdateInfo.percent)
          console.debug('app update progress:', appUpdateInfo.percent)
        }
      )

      window.electronAPI.onAppUpdateDownloadError(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  }, [setProgress, setUpdateVersionError])

  return <Fragment>{children}</Fragment>
}

export default AppUpdateListener
