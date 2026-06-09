import { createFileRoute } from '@tanstack/react-router'
import { invoke } from '@tauri-apps/api/core'
import {
  enable as enableAutostart,
  disable as disableAutostart,
  isEnabled as isAutostartEnabled,
} from '@tauri-apps/plugin-autostart'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useToolApproval } from '@/hooks/useToolApproval'
import { useThreadNotifications } from '@/hooks/useThreadNotifications'
import { useAppUpdater } from '@/hooks/useAppUpdater'
import { useEffect, useState, useCallback } from 'react'
import ChangeDataFolderLocation from '@/containers/dialogs/ChangeDataFolderLocation'
import { FactoryResetDialog } from '@/containers/dialogs'
import { useServiceHub } from '@/hooks/useServiceHub'
import {
  IconBrandDiscord,
  IconBrandGithub,
  IconExternalLink,
  IconFolder,
  IconLogs,
  IconCopy,
  IconCopyCheck,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { isDev } from '@/lib/utils'
import { SystemEvent } from '@/types/events'
import { Input } from '@/components/ui/input'
import { useHardware } from '@/hooks/useHardware'
import LanguageSwitcher from '@/containers/LanguageSwitcher'
import { isRootDir } from '@/utils/path'
import { useAnalytic } from '@/hooks/useAnalytic'
import posthog from 'posthog-js'
const TOKEN_VALIDATION_TIMEOUT_MS = 10_000
const ATOMIC_CLI_COMMAND = 'atomic-chat-cli'

function formatAtomicCliDisplayPath(path: string): string {
  if (/[/\\]jan\.exe$/i.test(path)) {
    return path.replace(/jan\.exe$/i, 'atomic-chat-cli.exe')
  }
  return path.replace(/[/\\]jan$/, (segment) =>
    segment.replace(/jan$/, ATOMIC_CLI_COMMAND)
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.general as any)({
  component: General,
})

function General() {
  const { t } = useTranslation()
  const {
    spellCheckChatInput,
    setSpellCheckChatInput,
    huggingfaceToken,
    setHuggingfaceToken,
    preloadModelOnStartup,
    setPreloadModelOnStartup,
    reasoningBudget,
    setReasoningBudget,
  } = useGeneralSetting()
  const allowAllMCPPermissions = useToolApproval(
    (state) => state.allowAllMCPPermissions
  )
  const setAllowAllMCPPermissions = useToolApproval(
    (state) => state.setAllowAllMCPPermissions
  )
  const notificationsGloballyEnabled = useThreadNotifications(
    (state) => state.globallyEnabled !== false
  )
  const setNotificationsGloballyEnabled = useThreadNotifications(
    (state) => state.setGloballyEnabled
  )
  const serviceHub = useServiceHub()
  const { setProductAnalytic, productAnalytic } = useAnalytic()

  const openFileTitle = (): string => {
    if (IS_MACOS) {
      return t('settings:general.showInFinder')
    } else if (IS_WINDOWS) {
      return t('settings:general.showInFileExplorer')
    } else {
      return t('settings:general.openContainingFolder')
    }
  }
  const { checkForUpdate } = useAppUpdater()
  const { pausePolling } = useHardware()
  const [janDataFolder, setJanDataFolder] = useState<string | undefined>()
  const [isCopied, setIsCopied] = useState(false)
  const [selectedNewPath, setSelectedNewPath] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [isValidatingToken, setIsValidatingToken] = useState(false)
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null)
  const [cliPath, setCliPath] = useState<string | null>(null)
  const [isCliLoading, setIsCliLoading] = useState(false)
  const [autostartEnabled, setAutostartEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    const fetchDataFolder = async () => {
      const path = await serviceHub.app().getJanDataFolder()
      setJanDataFolder(path)
    }

    fetchDataFolder()
  }, [serviceHub])

  useEffect(() => {
    if (!IS_TAURI) return
    invoke<{ installed: boolean; path: string | null }>(
      'check_jan_cli_installed'
    )
      .then((s) => {
        setCliInstalled(s.installed)
        setCliPath(s.path)
      })
      .catch(() => setCliInstalled(false))
  }, [])

  useEffect(() => {
    if (!IS_TAURI) return
    isAutostartEnabled()
      .then(setAutostartEnabled)
      .catch(() => setAutostartEnabled(false))
  }, [])

  const handleToggleAutostart = useCallback(
    async (next: boolean) => {
      try {
        if (next) {
          await enableAutostart()
        } else {
          await disableAutostart()
        }
        setAutostartEnabled(await isAutostartEnabled())
      } catch (error) {
        console.error('Failed to toggle launch at startup:', error)
        toast.error(t('settings:general.launchAtStartupError'))
        setAutostartEnabled(await isAutostartEnabled().catch(() => !next))
      }
    },
    [t]
  )

  const handleInstallCli = async () => {
    setIsCliLoading(true)
    try {
      const s = await invoke<{ installed: boolean; path: string | null }>(
        'install_jan_cli'
      )
      setCliInstalled(s.installed)
      setCliPath(s.path)
      toast.success(
        t('settings:general.atomicBotCliInstalledToast', {
          path: s.path ? formatAtomicCliDisplayPath(s.path) : ATOMIC_CLI_COMMAND,
        })
      )
    } catch (e) {
      toast.error('Install failed', { description: String(e) })
    } finally {
      setIsCliLoading(false)
    }
  }

  const handleUninstallCli = async () => {
    setIsCliLoading(true)
    try {
      await invoke('uninstall_jan_cli')
      setCliInstalled(false)
      setCliPath(null)
      toast.success('Atomic Bot CLI uninstalled')
    } catch (e) {
      toast.error('Uninstall failed', { description: String(e) })
    } finally {
      setIsCliLoading(false)
    }
  }

  const resetApp = async () => {
    // Prevent resetting if data folder is root directory
    if (isRootDir(janDataFolder ?? '/')) {
      toast.error(t('settings:general.couldNotResetRootDirectory'))
      return
    }
    pausePolling()
    // TODO: Loading indicator
    await serviceHub.app().factoryReset()
  }

  const handleOpenLogs = async () => {
    try {
      await serviceHub.window().openLogsWindow()
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
    const selectedPath = await serviceHub.dialog().open({
      multiple: false,
      directory: true,
      defaultPath: janDataFolder,
    })

    if (selectedPath === janDataFolder) return
    if (selectedPath !== null) {
      setSelectedNewPath(selectedPath as string)
      setIsDialogOpen(true)
    }
  }

  const confirmDataFolderChange = async () => {
    if (selectedNewPath) {
      try {
        await serviceHub.models().stopAllModels()
        serviceHub.events().emit(SystemEvent.KILL_SIDECAR)
        setTimeout(async () => {
          try {
            // Prevent relocating to root directory (e.g., C:\ or D:\ on Windows, / on Unix)
            if (isRootDir(selectedNewPath))
              throw new Error(t('settings:general.couldNotRelocateToRoot'))
            await serviceHub.app().relocateJanDataFolder(selectedNewPath)
            setJanDataFolder(selectedNewPath)
            // Only relaunch if relocation was successful
            window.core?.api?.relaunch()
            setSelectedNewPath(null)
            setIsDialogOpen(false)
          } catch (error) {
            console.error(error)
            toast.error(
              error instanceof Error
                ? error.message
                : t('settings:general.failedToRelocateDataFolder')
            )
          }
        }, 1000)
      } catch (error) {
        console.error('Failed to relocate data folder:', error)
        // Revert the data folder path on error
        const originalPath = await serviceHub.app().getJanDataFolder()
        setJanDataFolder(originalPath)

        toast.error(t('settings:general.failedToRelocateDataFolderDesc'))
      }
    }
  }

  const handleCheckForUpdate = useCallback(async () => {
    setIsCheckingUpdate(true)
    try {
      if (isDev()) return toast.info(t('settings:general.devVersion'))
      const update = await checkForUpdate(true)
      if (!update) {
        toast.info(t('settings:general.noUpdateAvailable'))
      }
    } catch (error) {
      console.error('Failed to check for updates:', error)
      toast.error(t('settings:general.updateError'))
    } finally {
      setIsCheckingUpdate(false)
    }
  }, [t, checkForUpdate])

  const handleOpenContactLink = useCallback(
    async (target: string) => {
      try {
        await serviceHub.opener().open(target)
      } catch (error) {
        console.error('Failed to open contact link:', error)
        window.open(target, '_blank')
      }
    },
    [serviceHub]
  )

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* General */}
            <Card title={t('common:general')}>
              <CardItem
                title={t('settings:general.appVersion')}
                actions={
                  <span className="text-foreground font-medium">
                    v{VERSION}
                  </span>
                }
              />
              {!AUTO_UPDATER_DISABLED && (
                <CardItem
                  title={t('settings:general.checkForUpdates')}
                  description={t('settings:general.checkForUpdatesDesc')}
                  className="items-center flex-row gap-y-2"
                  actions={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleCheckForUpdate}
                      disabled={isCheckingUpdate}
                    >
                      {isCheckingUpdate
                        ? t('settings:general.checkingForUpdates')
                        : t('settings:general.checkForUpdates')}
                    </Button>
                  }
                />
              )}
              <CardItem
                title={t('common:language')}
                actions={<LanguageSwitcher />}
              />
              {IS_TAURI && (
                <CardItem
                  title={t('settings:general.launchAtStartup')}
                  description={t('settings:general.launchAtStartupDesc')}
                  actions={
                    <Switch
                      checked={autostartEnabled ?? false}
                      disabled={autostartEnabled === null}
                      onCheckedChange={handleToggleAutostart}
                    />
                  }
                />
              )}
            </Card>

            <Card title="Contact Us">
              <CardItem
                title="Email"
                description="Reach Atomic Chat support by email."
                actions={
                  <a
                    href="mailto:support@atomic.chat"
                    onClick={(event) => {
                      event.preventDefault()
                      void handleOpenContactLink('mailto:support@atomic.chat')
                    }}
                    className="text-foreground font-medium hover:underline"
                  >
                    support@atomic.chat
                  </a>
                }
              />
              <CardItem
                title="X"
                description="Follow Atomic Chat on X."
                actions={
                  <a
                    href="https://x.com/atomic_chat_hq"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => {
                      event.preventDefault()
                      void handleOpenContactLink('https://x.com/atomic_chat_hq')
                    }}
                    className="text-foreground font-medium hover:underline"
                  >
                    @atomic_chat_hq
                  </a>
                }
              />
              <CardItem
                title="GitHub"
                description="View the Atomic Chat repository on GitHub."
                actions={
                  <a
                    href="https://github.com/AtomicBot-ai/Atomic-Chat"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => {
                      event.preventDefault()
                      void handleOpenContactLink(
                        'https://github.com/AtomicBot-ai/Atomic-Chat'
                      )
                    }}
                    className="text-foreground font-medium hover:underline"
                  >
                    AtomicBot-ai/Atomic-Chat
                  </a>
                }
              />
            </Card>

            {/* Chat behavior */}
            <Card title={t('settings:chatBehavior.title')}>
              <CardItem
                title={t('settings:chatBehavior.autoApproveTools')}
                description={t('settings:chatBehavior.autoApproveToolsDesc')}
                actions={
                  <Switch
                    checked={allowAllMCPPermissions}
                    onCheckedChange={setAllowAllMCPPermissions}
                  />
                }
              />
              <CardItem
                title={t('settings:chatBehavior.desktopNotifications')}
                description={t(
                  'settings:chatBehavior.desktopNotificationsDesc'
                )}
                actions={
                  <Switch
                    checked={notificationsGloballyEnabled}
                    onCheckedChange={setNotificationsGloballyEnabled}
                  />
                }
              />
            </Card>

            {/* Privacy / Analytics */}
            <Card
              header={
                <div className="flex items-center justify-between mb-4">
                  <h1 className="font-medium text-foreground text-base">
                    {t('settings:privacy.analytics')}
                  </h1>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={productAnalytic}
                      onCheckedChange={(state) => {
                        if (state) {
                          posthog.opt_in_capturing()
                        } else {
                          posthog.opt_out_capturing()
                        }
                        setProductAnalytic(state)
                      }}
                    />
                  </div>
                </div>
              }
            >
              <CardItem
                title={t('settings:privacy.helpUsImprove')}
                description={<p>{t('settings:privacy.helpUsImproveDesc')}</p>}
                align="start"
              />
            </Card>

            {/* Data folder - Desktop only */}
            <Card title={t('common:dataFolder')}>
              <CardItem
                title={t('settings:dataFolder.appData', {
                  ns: 'settings',
                })}
                align="start"
                className="items-start flex-row gap-2"
                description={
                  <>
                    <span>
                      {t('settings:dataFolder.appDataDesc', {
                        ns: 'settings',
                      })}
                      &nbsp;
                    </span>
                    <div className="flex items-center gap-2 mt-1 ">
                      <div className="truncate">
                        <span
                          title={janDataFolder}
                          className="bg-secondary text-xs p-1 rounded-sm"
                        >
                          {janDataFolder}
                        </span>
                      </div>
                      <button
                        onClick={() =>
                          janDataFolder && copyToClipboard(janDataFolder)
                        }
                        className="cursor-pointer flex items-center justify-center rounded-sm bg-secondary transition-all duration-200 ease-in-out p-1"
                        title={
                          isCopied
                            ? t('settings:general.copied')
                            : t('settings:general.copyPath')
                        }
                      >
                        {isCopied ? (
                          <div className="flex items-center gap-1">
                            <IconCopyCheck
                              size={14}
                              className="text-green-500 dark:text-green-600"
                            />
                            <span className="text-xs leading-0">
                              {t('settings:general.copied')}
                            </span>
                          </div>
                        ) : (
                          <IconCopy
                            size={14}
                            className="text-muted-foreground"
                          />
                        )}
                      </button>
                    </div>
                  </>
                }
                actions={
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      title={t('settings:dataFolder.appData')}
                      onClick={handleDataFolderChange}
                    >
                      <IconFolder size={12} className="text-muted-foreground" />
                      <span>{t('settings:general.changeLocation')}</span>
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
                title={t('settings:dataFolder.appLogs', {
                  ns: 'settings',
                })}
                description={t('settings:dataFolder.appLogsDesc')}
                className="items-start flex-row gap-y-2"
                actions={
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="p-0"
                      onClick={async () => {
                        if (janDataFolder) {
                          try {
                            const logsPath = `${janDataFolder}/logs`
                            await serviceHub.opener().revealItemInDir(logsPath)
                          } catch (error) {
                            console.error(
                              'Failed to reveal logs folder:',
                              error
                            )
                          }
                        }
                      }}
                      title={t('settings:general.revealLogs')}
                    >
                      <IconFolder size={12} className="text-muted-foreground" />
                      <span>{openFileTitle()}</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleOpenLogs}
                      title={t('settings:dataFolder.appLogs')}
                    >
                      <IconLogs size={12} className="text-muted-foreground" />
                      <span>{t('settings:general.openLogs')}</span>
                    </Button>
                  </div>
                }
              />
            </Card>

            {/* Advanced - Desktop only */}
            <Card title="Advanced">
              {IS_TAURI && (
                <CardItem
                  title={t('settings:general.atomicBotCliTitle')}
                  description={
                    cliInstalled && cliPath
                      ? t('settings:general.atomicBotCliInstalled', {
                          path: formatAtomicCliDisplayPath(cliPath),
                        })
                      : t('settings:general.atomicBotCliNotInstalled')
                  }
                  actions={
                    cliInstalled ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleUninstallCli}
                        disabled={isCliLoading || cliInstalled === null}
                      >
                        {isCliLoading ? 'Uninstalling…' : 'Uninstall'}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleInstallCli}
                        disabled={isCliLoading || cliInstalled === null}
                      >
                        {isCliLoading ? 'Installing…' : 'Install'}
                      </Button>
                    )
                  }
                />
              )}
              <CardItem
                title={t('settings:others.resetFactory', {
                  ns: 'settings',
                })}
                description={t('settings:others.resetFactoryDesc', {
                  ns: 'settings',
                })}
                actions={
                  <FactoryResetDialog onReset={resetApp}>
                    <Button variant="destructive" size="sm">
                      {t('common:reset')}
                    </Button>
                  </FactoryResetDialog>
                }
              />
            </Card>

            {/* Other */}
            <Card title={t('common:others')}>
              <CardItem
                title={t('settings:others.spellCheck', {
                  ns: 'settings',
                })}
                description={t('settings:others.spellCheckDesc', {
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
                title="Preload last used model on startup"
                description="Start the local inference server with your last model when the app opens."
                actions={
                  <Switch
                    checked={preloadModelOnStartup}
                    onCheckedChange={setPreloadModelOnStartup}
                  />
                }
              />
              <CardItem
                title="Reasoning budget (local models)"
                description="Limits thinking tokens for llama.cpp / MLX. Off disables reasoning entirely."
                actions={
                  <select
                    className="border-input bg-background rounded-md border px-2 py-1 text-sm"
                    value={reasoningBudget}
                    onChange={(e) =>
                      setReasoningBudget(
                        e.target.value as typeof reasoningBudget
                      )
                    }
                  >
                    <option value="off">Off</option>
                    <option value="low">Low (256)</option>
                    <option value="medium">Medium (1024)</option>
                    <option value="high">High (4096)</option>
                    <option value="unlimited">Unlimited</option>
                  </select>
                }
              />
              <CardItem
                title={t('settings:general.huggingfaceToken', {
                  ns: 'settings',
                })}
                description={t('settings:general.huggingfaceTokenDesc', {
                  ns: 'settings',
                })}
                actions={
                  <div className="flex items-center gap-2">
                    <Input
                      id="hf-token"
                      value={huggingfaceToken || ''}
                      onChange={(e) => setHuggingfaceToken(e.target.value)}
                      placeholder={'hf_xxx_xxx'}
                      required
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isValidatingToken}
                      onClick={async () => {
                        const token = (huggingfaceToken || '').trim()
                        if (!token) {
                          toast.error(
                            'Please enter a Hugging Face token to validate'
                          )
                          return
                        }
                        setIsValidatingToken(true)
                        const controller = new AbortController()
                        const timeoutId = setTimeout(
                          () => controller.abort(),
                          TOKEN_VALIDATION_TIMEOUT_MS
                        )
                        try {
                          const resp = await fetch(
                            'https://huggingface.co/api/whoami-v2',
                            {
                              headers: { Authorization: `Bearer ${token}` },
                              signal: controller.signal,
                            }
                          )
                          if (resp.ok) {
                            const data = await resp.json()
                            toast.success('Token is valid', {
                              description: data?.name
                                ? `Signed in as ${data.name}`
                                : 'Your Hugging Face token is valid.',
                            })
                          } else {
                            toast.error('Token invalid', {
                              description:
                                'The provided Hugging Face token is invalid. Please check your token and try again.',
                            })
                          }
                        } catch (e) {
                          const name = (e as { name?: string })?.name
                          if (name === 'AbortError') {
                            toast.error('Validation timed out', {
                              description:
                                'The validation request timed out. Please check your network connection and try again.',
                            })
                          } else {
                            toast.error('Validation failed', {
                              description:
                                'A network error occurred while validating the token. Please check your internet connection.',
                            })
                          }
                        } finally {
                          clearTimeout(timeoutId)
                          setIsValidatingToken(false)
                        }
                      }}
                    >
                      Verify
                    </Button>
                  </div>
                }
              />
            </Card>

            {/* Resources — закомментировано */}
            {false && (
              <Card title={t('settings:general.resources')}>
                <CardItem
                  title={t('settings:general.documentation')}
                  description={t('settings:general.documentationDesc')}
                  actions={
                    <a
                      href="https://jan.ai/docs"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('settings:general.viewDocs')}</span>
                        <IconExternalLink size={14} />
                      </div>
                    </a>
                  }
                />
                <CardItem
                  title={t('settings:general.releaseNotes')}
                  description={t('settings:general.releaseNotesDesc')}
                  actions={
                    <a
                      href="https://github.com/AtomicBot-ai/Atomic-Chat/releases"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('settings:general.viewReleases')}</span>
                        <IconExternalLink size={14} />
                      </div>
                    </a>
                  }
                />
              </Card>
            )}

            {/* Community — закомментировано */}
            {false && (
              <Card title={t('settings:general.community')}>
                <CardItem
                  title={t('settings:general.github')}
                  description={t('settings:general.githubDesc')}
                  actions={
                    <a
                      href="https://github.com/AtomicBot-ai/Atomic-Chat"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <IconBrandGithub
                        size={18}
                        className="text-muted-foreground"
                      />
                    </a>
                  }
                />
                <CardItem
                  title={t('settings:general.discord')}
                  description={t('settings:general.discordDesc')}
                  actions={
                    <a
                      href="https://discord.com/invite/FTk2MvZwJH"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <IconBrandDiscord
                        size={18}
                        className="text-muted-foreground"
                      />
                    </a>
                  }
                />
              </Card>
            )}

            {/* Support — закомментировано */}
            {false && (
              <Card title={t('settings:general.support')}>
                <CardItem
                  title={t('settings:general.reportAnIssue')}
                  description={t('settings:general.reportAnIssueDesc')}
                  actions={
                    <a
                      href="https://github.com/AtomicBot-ai/Atomic-Chat/issues/new"
                      target="_blank"
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('settings:general.reportIssue')}</span>
                        <IconExternalLink size={14} />
                      </div>
                    </a>
                  }
                />
              </Card>
            )}

            {/* Credits — закомментировано */}
            {false && (
              <Card title={t('settings:general.credits')}>
                <CardItem
                  align="start"
                  description={
                    <div className="text-muted-foreground -mt-2">
                      <p>{t('settings:general.creditsDesc1')}</p>
                      <p className="mt-2">
                        {t('settings:general.creditsDesc2')}
                      </p>
                    </div>
                  }
                />
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
