import { Fragment, useEffect } from 'react'

import { AppUpdateInfo } from '@janhq/core'
import { useSetAtom } from 'jotai'

import {
  appDownloadProgressAtom,
  appUpdateAvailableAtom,
  updateVersionErrorAtom,
  appUpdateNotAvailableAtom,
} from '@/helpers/atoms/App.atom'

const AppUpdateListener = () => {
  const setProgress = useSetAtom(appDownloadProgressAtom)
  const setUpdateVersionError = useSetAtom(updateVersionErrorAtom)
  const setAppUpdateAvailable = useSetAtom(appUpdateAvailableAtom)
  const setAppUpdateNotvailable = useSetAtom(appUpdateNotAvailableAtom)

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

      window.electronAPI.onAppUpdateAvailable(() => {
        setAppUpdateAvailable(true)
      })

      window.electronAPI.onAppUpdateNotAvailable(() => {
        setAppUpdateAvailable(false)
        setAppUpdateNotvailable(true)
      })
    }
  }, [setProgress, setUpdateVersionError, setAppUpdateAvailable])

  return <Fragment></Fragment>
}

export default AppUpdateListener
