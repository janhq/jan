import { useAppUpdater } from '@/hooks/useAppUpdater'

import { IconDownload } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'

import { useState, useEffect } from 'react'
import { useReleaseNotes } from '@/hooks/useReleaseNotes'
import { RenderMarkdown } from '../RenderMarkdown'
import { cn, isDev } from '@/lib/utils'
import { isNightly, isBeta } from '@/lib/version'
import { useTranslation } from '@/i18n/react-i18next-compat'

const DialogAppUpdater = () => {
  const { t } = useTranslation()
  const {
    updateState,
    downloadAndInstallUpdate,
    checkForUpdate,
    setRemindMeLater,
  } = useAppUpdater()
  const [showReleaseNotes, setShowReleaseNotes] = useState(false)

  const handleUpdate = () => {
    downloadAndInstallUpdate()
    setRemindMeLater(true)
  }

  const { release, fetchLatestRelease } = useReleaseNotes()

  useEffect(() => {
    if (!isDev()) {
      fetchLatestRelease(isBeta)
    }
  }, [fetchLatestRelease])

  // Check for updates when component mounts
  useEffect(() => {
    checkForUpdate()
  }, [checkForUpdate])

  const [appUpdateState, setAppUpdateState] = useState({
    remindMeLater: false,
    isUpdateAvailable: false,
  })

  useEffect(() => {
    setAppUpdateState({
      remindMeLater: updateState.remindMeLater,
      isUpdateAvailable: updateState.isUpdateAvailable,
    })
  }, [updateState])

  if (appUpdateState.remindMeLater) return null

  return (
    <>
      {appUpdateState.isUpdateAvailable && (
        <div
          className={cn(
            'fixed z-50 w-[400px] bottom-3 right-3 bg-main-view text-main-view-fg flex items-center justify-center border border-main-view-fg/10 rounded-lg shadow-md'
          )}
        >
          <div className="px-0 py-4">
            <div className="px-4">
              <div className="flex items-start gap-2">
                <IconDownload
                  size={20}
                  className="shrink-0 text-main-view-fg/60 mt-1"
                />
                <div>
                  <div className="text-base font-medium">
                    {t('updater:newVersion', {
                      version: updateState.updateInfo?.version,
                    })}
                  </div>
                  <div className="mt-1 text-main-view-fg/70 font-normal mb-2">
                    {t('updater:updateAvailable')}
                  </div>
                </div>
              </div>
            </div>

            {showReleaseNotes && (
              <div className="max-h-[500px] p-4 w-[400px] overflow-y-scroll  text-sm font-normal leading-relaxed">
                {isNightly && !isBeta ? (
                  <p className="text-sm font-normal">
                    {t('updater:nightlyBuild')}
                  </p>
                ) : (
                  <RenderMarkdown
                    components={{
                      a: ({ ...props }) => (
                        <a
                          {...props}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      ),
                      h2: ({ ...props }) => (
                        <h2 {...props} className="!text-xl !mt-0" />
                      ),
                    }}
                    content={release?.body}
                  />
                )}
              </div>
            )}

            <div className="pt-3 px-4">
              <div className="flex gap-x-4 w-full items-center justify-between">
                <Button
                  variant="link"
                  className="px-0 text-main-view-fg/70"
                  onClick={() => setShowReleaseNotes(!showReleaseNotes)}
                >
                  {showReleaseNotes
                    ? t('updater:hideReleaseNotes')
                    : t('updater:showReleaseNotes')}
                </Button>
                <div className="flex gap-x-5">
                  <Button
                    variant="link"
                    className="px-0 text-main-view-fg/70 remind-me-later"
                    onClick={() => setRemindMeLater(true)}
                  >
                    {t('updater:remindMeLater')}
                  </Button>
                  <Button
                    onClick={handleUpdate}
                    disabled={updateState.isDownloading}
                  >
                    {updateState.isDownloading
                      ? t('updater:downloading')
                      : t('updater:updateNow')}
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

export default DialogAppUpdater
