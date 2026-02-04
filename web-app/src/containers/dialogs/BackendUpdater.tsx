import { useBackendUpdater } from '@/hooks/useBackendUpdater'

import { IconDownload } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { toast } from 'sonner'

const BackendUpdater = () => {
  const { t } = useTranslation()
  const { updateState, updateBackend, checkForUpdate, setRemindMeLater } =
    useBackendUpdater()

  const handleUpdate = async () => {
    try {
      await updateBackend()
      setRemindMeLater(true)
      toast.success(t('settings:backendUpdater.updateSuccess'))
    } catch (error) {
      console.error('Backend update failed:', error)
      toast.error(t('settings:backendUpdater.updateError'))
    }
  }

  // Check for updates when component mounts
  useEffect(() => {
    checkForUpdate()
  }, [checkForUpdate])

  const [backendUpdateState, setBackendUpdateState] = useState({
    remindMeLater: false,
    isUpdateAvailable: false,
  })

  useEffect(() => {
    setBackendUpdateState({
      remindMeLater: updateState.remindMeLater,
      isUpdateAvailable: updateState.isUpdateAvailable,
    })
  }, [updateState])

  // Don't show if user clicked remind me later
  if (backendUpdateState.remindMeLater) {
    console.log('BackendUpdater: Not showing notification due to:', {
      remindMeLater: backendUpdateState.remindMeLater,
    })
    return null
  }

  return (
    <>
      {backendUpdateState.isUpdateAvailable && (
        <div
          className={cn(
<<<<<<< HEAD
            'fixed z-50 min-w-[300px] bottom-3 right-3 bg-main-view text-main-view-fg flex items-center justify-center border border-main-view-fg/10 rounded-lg shadow-md'
          )}
        >
          <div className="px-0 py-4">
=======
            'fixed z-50 bottom-3 right-3 bg-background flex items-center border rounded-lg shadow-md'
          )}
        >
          <div className="px-2 py-4">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            <div className="px-4">
              <div className="flex items-start gap-2">
                <IconDownload
                  size={20}
<<<<<<< HEAD
                  className="shrink-0 text-main-view-fg/60 mt-1"
=======
                  className="shrink-0 text-muted-foreground mt-1"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                />
                <div>
                  <div className="text-base font-medium">
                    {t('settings:backendUpdater.newBackendVersion', {
                      version: updateState.updateInfo?.newVersion,
                    })}
                  </div>
<<<<<<< HEAD
                  <div className="mt-1 text-main-view-fg/70 font-normal mb-2">
=======
                  <div className="mt-1 text-muted-foreground font-normal mb-2">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                    {t('settings:backendUpdater.backendUpdateAvailable')}
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-3 px-4">
              <div className="flex gap-x-4 w-full items-center justify-end">
<<<<<<< HEAD
                <div className="flex gap-x-5">
                  <Button
                    variant="link"
                    className="px-0 text-main-view-fg/70 remind-me-later"
=======
                <div className="flex gap-x-2">
                  <Button
                    variant="ghost"
                    size="sm"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                    onClick={() => setRemindMeLater(true)}
                  >
                    {t('settings:backendUpdater.remindMeLater')}
                  </Button>
                  <Button
<<<<<<< HEAD
=======
                    size="sm"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                    onClick={handleUpdate}
                    disabled={updateState.isUpdating}
                  >
                    {updateState.isUpdating
                      ? t('settings:backendUpdater.updating')
                      : t('settings:backendUpdater.updateNow')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default BackendUpdater
