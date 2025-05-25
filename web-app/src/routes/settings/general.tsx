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
import {
  factoryReset,
  getJanDataFolder,
  relocateJanDataFolder,
} from '@/services/app'
import {
  IconBrandDiscord,
  IconBrandGithub,
  IconExternalLink,
  IconFolder,
  IconLogs,
} from '@tabler/icons-react'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { windowKey } from '@/constants/windows'

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

  const handleOpenLogs = async () => {
    try {
      // Check if logs window already exists
      const existingWindow = await WebviewWindow.getByLabel(
        windowKey.logsAppWindow
      )

      if (existingWindow) {
        // If window exists, focus it
        await existingWindow.setFocus()
        console.log('Focused existing logs window')
      } else {
        // Create a new logs window using Tauri v2 WebviewWindow API
        const logsWindow = new WebviewWindow(windowKey.logsAppWindow, {
          url: route.appLogs,
          title: 'App Logs - Jan',
          width: 800,
          height: 600,
          resizable: true,
          center: true,
        })

        // Listen for window creation
        logsWindow.once('tauri://created', () => {
          console.log('Logs window created')
        })

        // Listen for window errors
        logsWindow.once('tauri://error', (e) => {
          console.error('Error creating logs window:', e)
        })
      }
    } catch (error) {
      console.error('Failed to open logs window:', error)
    }
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
                  <span className="text-main-view-fg/80">v{VERSION}</span>
                }
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
                    title="App Data Folder"
                    onClick={async () => {
                      const selectedPath = await open({
                        multiple: false,
                        directory: true,
                        defaultPath: janDataFolder,
                      })
                      if (selectedPath === janDataFolder) return
                      if (selectedPath !== null) {
                        setJanDataFolder(selectedPath)
                        await relocateJanDataFolder(selectedPath)
                        window.core?.api?.relaunch()
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
                description="View detailed logs of the App"
                actions={
                  <Button
                    variant="link"
                    size="sm"
                    onClick={handleOpenLogs}
                    title="App Logs"
                  >
                    {/* Open Logs */}
                    <div className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out">
                      <IconLogs size={18} className="text-main-view-fg/50" />
                    </div>
                  </Button>
                }
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

            {/* Resources */}
            <Card title="Resources">
              <CardItem
                title="Documentation"
                description="Learn how to use Jan and explore its features"
                actions={
                  <a
                    href="https://jan.ai/docs"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div className="flex items-center gap-1">
                      <span>View Docs</span>
                      <IconExternalLink size={14} />
                    </div>
                  </a>
                }
              />
              <CardItem
                title="Release Notes"
                description="See what's new in the latest version"
                actions={
                  <a
                    href="https://github.com/janhq/jan/releases"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div className="flex items-center gap-1">
                      <span>View Releases</span>
                      <IconExternalLink size={14} />
                    </div>
                  </a>
                }
              />
            </Card>

            {/* Community */}
            <Card title="Community">
              <CardItem
                title="GitHub"
                description="Contribute to Jan's development"
                actions={
                  <a
                    href="https://github.com/janhq/jan"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out">
                      <IconBrandGithub
                        size={18}
                        className="text-main-view-fg/50"
                      />
                    </div>
                  </a>
                }
              />
              <CardItem
                title="Discord"
                description="Join our community for support and discussions"
                actions={
                  <a
                    href="https://discord.com/invite/FTk2MvZwJH"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out">
                      <IconBrandDiscord
                        size={18}
                        className="text-main-view-fg/50"
                      />
                    </div>
                  </a>
                }
              />
            </Card>

            {/* Support */}
            <Card title="Support">
              <CardItem
                title="Report an Issue"
                description="Found a bug? Let us know on GitHub"
                actions={
                  <a
                    href="https://github.com/janhq/jan/issues/new"
                    target="_blank"
                  >
                    <div className="flex items-center gap-1">
                      <span>Report Issue</span>
                      <IconExternalLink size={14} />
                    </div>
                  </a>
                }
              />
            </Card>

            {/* Credits */}
            <Card title="Credits">
              <CardItem
                align="start"
                description={
                  <div className="text-main-view-fg/70 -mt-2">
                    <p>
                      Jan is built with ❤️ by the Jan team and contributors from
                      around the world.
                    </p>
                    <p className="mt-2">
                      Special thanks to all our open-source dependencies and the
                      amazing AI community.
                    </p>
                  </div>
                }
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
