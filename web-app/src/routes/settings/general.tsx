import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Card, CardItem } from '@/containers/Card'
import LanguageSwitcher from '@/containers/LanguageSwitcher'
import { useTranslation } from 'react-i18next'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { factoryReset, getJanDataFolder } from '@/services/app'
import { IconFolder } from '@tabler/icons-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.general as any)({
  component: General,
})

function General() {
  const { t } = useTranslation()
  const { spellCheckChatInput, setSpellCheckChatInput } = useGeneralSetting()
  const [janDataFolder, setJanDataFolder] = useState<string | undefined>()

  useEffect(() => {
    const fetchDataFolder = async () => {
      const path = await getJanDataFolder()
      setJanDataFolder(path)
    }

    fetchDataFolder()
  }, [])

  const resetApp = async () => {
    // TODO: Loading indicator
    await factoryReset()
  }

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* General */}
            <Card title={t('common.general')}>
              <CardItem
                title="App Version"
                actions={
                  <>
                    <span className="text-main-view-fg/80">v{VERSION}</span>
                  </>
                }
              />
              <CardItem
                title={t('settings.general.autoDownload', {
                  ns: 'settings',
                })}
                actions={<Switch />}
              />
              <CardItem
                title={t('common.language')}
                actions={<LanguageSwitcher />}
              />
            </Card>

            {/* Data folder */}
            <Card title={t('common.dataFolder')}>
              <CardItem
                title={t('settings.dataFolder.appData', {
                  ns: 'settings',
                })}
                align="start"
                description={
                  <>
                    <span>
                      {t('settings.dataFolder.appDataDesc', {
                        ns: 'settings',
                      })}
                    </span>
                    <span
                      title={janDataFolder}
                      className="bg-main-view-fg/10 text-xs mt-1 px-1 py-0.5 rounded-sm text-main-view-fg/80 line-clamp-1"
                    >
                      {janDataFolder}
                    </span>
                  </>
                }
                actions={
                  <Button
                    variant="link"
                    size="sm"
                    className="hover:no-underline"
                    onClick={async () => {
                      const selectedPath = await open({
                        multiple: false,
                        directory: true,
                        defaultPath: janDataFolder,
                      })
                      if (selectedPath === janDataFolder) return
                      if (selectedPath !== null) {
                        setJanDataFolder(selectedPath)
                        // TODO: we need function to move everything into new folder selectedPath
                        // eg like this
                        // await window.core?.api?.moveDataFolder(selectedPath)
                      }
                    }}
                  >
                    <div className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out">
                      <IconFolder size={18} className="text-main-view-fg/50" />
                    </div>
                  </Button>
                }
              />
              <CardItem
                title={t('settings.dataFolder.appLogs', {
                  ns: 'settings',
                })}
                description={t('settings.dataFolder.appLogsDesc', {
                  ns: 'settings',
                })}
                actions={<></>}
              />
            </Card>

            {/* Other */}
            <Card title={t('common.others')}>
              <CardItem
                title={t('settings.others.spellCheck', {
                  ns: 'settings',
                })}
                description={t('settings.others.spellCheckDesc', {
                  ns: 'settings',
                })}
                actions={
                  <Switch
                    checked={spellCheckChatInput}
                    onCheckedChange={(e) => setSpellCheckChatInput(e)}
                  />
                }
              />
              <CardItem
                title={t('settings.others.resetFactory', {
                  ns: 'settings',
                })}
                description={t('settings.others.resetFactoryDesc', {
                  ns: 'settings',
                })}
                actions={
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="destructive" size="sm">
                        {t('common.reset')}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Factory Reset</DialogTitle>
                        <DialogDescription>
                          Are you sure you want to reset the app to factory
                          settings? This action is irreversible and recommended
                          only if the application is corrupted.
                        </DialogDescription>
                        <DialogFooter className="mt-2 flex items-center">
                          <DialogClose asChild>
                            <Button
                              variant="link"
                              size="sm"
                              className="hover:no-underline"
                            >
                              Cancel
                            </Button>
                          </DialogClose>
                          <DialogClose asChild>
                            <Button
                              variant="destructive"
                              onClick={() => resetApp()}
                            >
                              Reset
                            </Button>
                          </DialogClose>
                        </DialogFooter>
                      </DialogHeader>
                    </DialogContent>
                  </Dialog>
                }
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
