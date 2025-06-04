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
import { useAppUpdater } from '@/hooks/useAppUpdater'
import { useEffect, useState, useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import ChangeDataFolderLocation from '@/containers/dialogs/ChangeDataFolderLocation'

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
  IconCopy,
  IconCopyCheck,
} from '@tabler/icons-react'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { windowKey } from '@/constants/windows'
import { toast } from 'sonner'
import { isDev } from '@/lib/utils'
import { emit } from '@tauri-apps/api/event'
import { stopAllModels } from '@/services/models'
import { SystemEvent } from '@/types/events'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.general as any)({
  component: General,
})

const openFileTitle = (): string => {
  if (IS_MACOS) {
    return 'Show in Finder'
  } else if (IS_WINDOWS) {
    return 'Show in File Explorer'
  } else {
    return 'Open Containing Folder'
  }
}

function General() {
  const { t } = useTranslation()
  const { spellCheckChatInput, setSpellCheckChatInput } = useGeneralSetting()
  const { checkForUpdate } = useAppUpdater()
  const [janDataFolder, setJanDataFolder] = useState<string | undefined>()
  const [isCopied, setIsCopied] = useState(false)
  const [selectedNewPath, setSelectedNewPath] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)

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

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000) // Reset after 2 seconds
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
  }

  const handleDataFolderChange = async () => {
    const selectedPath = await open({
      multiple: false,
      directory: true,
      defaultPath: janDataFolder,
    })

    if (selectedPath === janDataFolder) return
    if (selectedPath !== null) {
      setSelectedNewPath(selectedPath)
      setIsDialogOpen(true)
    }
  }

  const confirmDataFolderChange = async () => {
    if (selectedNewPath) {
      try {
        await stopAllModels()
        emit(SystemEvent.KILL_SIDECAR)
        setTimeout(async () => {
          try {
            await relocateJanDataFolder(selectedNewPath)
            setJanDataFolder(selectedNewPath)
            // Only relaunch if relocation was successful
            window.core?.api?.relaunch()
            setSelectedNewPath(null)
            setIsDialogOpen(false)
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : 'Failed to relocate Jan data folder'
            )
          }
        }, 1000)
      } catch (error) {
        console.error('Failed to relocate data folder:', error)
        // Revert the data folder path on error
        const originalPath = await getJanDataFolder()
        setJanDataFolder(originalPath)

        toast.error(
          'Failed to relocate data folder. Please try again or choose a different location.'
        )
      }
    }
  }

  const handleCheckForUpdate = useCallback(async () => {
    setIsCheckingUpdate(true)
    try {
      if (isDev())
        return toast.info('You are running a development version of Jan!')
      const update = await checkForUpdate(true)
      if (!update) {
        toast.info('You are using the latest version of Jan!')
      }
      // If update is available, the AppUpdater dialog will automatically show
    } catch (error) {
      console.error('Failed to check for updates:', error)
      toast.error('Failed to check for updates. Please try again later.')
    } finally {
      setIsCheckingUpdate(false)
    }
  }, [setIsCheckingUpdate, checkForUpdate])

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
                  <span className="text-main-view-fg/80 font-medium">
                    v{VERSION}
                  </span>
                }
              />
              <CardItem
                title="Check for Updates"
                description="Check if a newer version of Jan is available"
                actions={
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0"
                    onClick={handleCheckForUpdate}
                    disabled={isCheckingUpdate}
                  >
                    <div className="cursor-pointer rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1">
                      {isCheckingUpdate ? 'Checking...' : 'Check for Updates'}
                    </div>
                  </Button>
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
                      &nbsp;
                    </span>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        title={janDataFolder}
                        className="bg-main-view-fg/10 text-xs px-1 py-0.5 rounded-sm text-main-view-fg/80"
                      >
                        {janDataFolder}
                      </span>
                      <button
                        onClick={() =>
                          janDataFolder && copyToClipboard(janDataFolder)
                        }
                        className="cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out p-1"
                        title={isCopied ? 'Copied!' : 'Copy path'}
                      >
                        {isCopied ? (
                          <div className="flex items-center gap-1">
                            <IconCopyCheck size={12} className="text-accent" />
                            <span className="text-xs leading-0">Copied</span>
                          </div>
                        ) : (
                          <IconCopy
                            size={12}
                            className="text-main-view-fg/50"
                          />
                        )}
                      </button>
                    </div>
                  </>
                }
                actions={
                  <>
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0"
                      title="App Data Folder"
                      onClick={handleDataFolderChange}
                    >
                      <div className="cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1">
                        <IconFolder
                          size={12}
                          className="text-main-view-fg/50"
                        />
                        <span>Change Location</span>
                      </div>
                    </Button>
                    {selectedNewPath && (
                      <ChangeDataFolderLocation
                        currentPath={janDataFolder || ''}
                        newPath={selectedNewPath}
                        onConfirm={confirmDataFolderChange}
                        open={isDialogOpen}
                        onOpenChange={(open) => {
                          setIsDialogOpen(open)
                          if (!open) {
                            setSelectedNewPath(null)
                          }
                        }}
                      >
                        <div />
                      </ChangeDataFolderLocation>
                    )}
                  </>
                }
              />
              <CardItem
                title={t('settings.dataFolder.appLogs', {
                  ns: 'settings',
                })}
                description="View detailed logs of the App"
                actions={
                  <div className="flex items-center gap-2">
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0"
                      onClick={handleOpenLogs}
                      title="App Logs"
                    >
                      <div className="cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1">
                        <IconLogs size={12} className="text-main-view-fg/50" />
                        <span>Open Logs</span>
                      </div>
                    </Button>
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0"
                      onClick={async () => {
                        if (janDataFolder) {
                          try {
                            const logsPath = `${janDataFolder}/logs`
                            await revealItemInDir(logsPath)
                          } catch (error) {
                            console.error(
                              'Failed to reveal logs folder:',
                              error
                            )
                          }
                        }
                      }}
                      title="Reveal logs folder in file explorer"
                    >
                      <div className="cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1">
                        <IconFolder
                          size={12}
                          className="text-main-view-fg/50"
                        />
                        <span>{openFileTitle()}</span>
                      </div>
                    </Button>
                  </div>
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
                    href="https://github.com/menloresearch/jan/releases"
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
                    href="https://github.com/menloresearch/jan"
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
                    href="https://github.com/menloresearch/jan/issues/new"
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
