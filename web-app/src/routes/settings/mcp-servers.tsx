import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Card, CardItem } from '@/containers/Card'
import {
  IconPencil,
  IconPlus,
  IconTrash,
  IconCodeCircle,
} from '@tabler/icons-react'
import {
  useMCPServers,
  MCPServerConfig,
  MCPSettings,
  DEFAULT_MCP_SETTINGS,
} from '@/hooks/useMCPServers'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import AddEditMCPServer from '@/containers/dialogs/AddEditMCPServer'
import DeleteMCPServerConfirm from '@/containers/dialogs/DeleteMCPServerConfirm'
import EditJsonMCPserver from '@/containers/dialogs/EditJsonMCPserver'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { twMerge } from 'tailwind-merge'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useToolApproval } from '@/hooks/useToolApproval'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useAppState } from '@/hooks/useAppState'
import { listen } from '@tauri-apps/api/event'
import { SystemEvent } from '@/types/events'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useModelProvider } from '@/hooks/useModelProvider'
import { McpRouterModelPicker } from '@/containers/McpRouterModelPicker'
import { isRouterModelSelectable } from '@/lib/mcp-router-model-filter'
import { normalizeAppError } from '@/utils/appError'
import { McpServerAuth } from '@/containers/McpServerAuth'
import { useMcpAuth, needsAuthDetail } from '@/hooks/useMcpAuth'


// Function to mask sensitive URL parameters
const maskSensitiveUrl = (url: string) => {
  if (!url) return url

  try {
    const urlObj = new URL(url)
    const params = urlObj.searchParams

    // List of sensitive parameter names (case-insensitive)
    const sensitiveParams = [
      'api_key',
      'apikey',
      'key',
      'token',
      'secret',
      'password',
      'pwd',
      'auth',
      'authorization',
      'bearer',
      'access_token',
      'refresh_token',
      'client_secret',
      'private_key',
      'signature',
      'hash',
    ]

    // Mask sensitive parameters
    sensitiveParams.forEach((paramName) => {
      // Check both exact match and case-insensitive match
      for (const [key] of params.entries()) {
        if (key.toLowerCase() === paramName.toLowerCase()) {
          params.set(key, '******')
        }
      }
    })

    // Reconstruct URL with masked parameters
    urlObj.search = params.toString()
    return urlObj.toString()
  } catch {
    // If URL parsing fails, just mask the entire query string after '?'
    const queryIndex = url.indexOf('?')
    if (queryIndex === -1) return url

    const baseUrl = url.substring(0, queryIndex + 1)
    return baseUrl + '******'
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.mcp_servers as any)({
  component: MCPServersDesktop,
})

function MCPServersDesktop() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const {
    mcpServers,
    settings,
    editServer,
    syncServers,
    getServerConfig,
    saveSettings,
  } = useMCPServers()
  const { allowAllMCPPermissions, setAllowAllMCPPermissions } =
    useToolApproval()

  const [open, setOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [currentConfig, setCurrentConfig] = useState<
    MCPServerConfig | undefined
  >(undefined)

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [serverToDelete, setServerToDelete] = useState<string | null>(null)

  // JSON editor dialog state
  const [jsonEditorOpen, setJsonEditorOpen] = useState(false)
  const [jsonServerName, setJsonServerName] = useState<string | null>(null)
  const [jsonEditorData, setJsonEditorData] = useState<
    | MCPServerConfig
    | Record<string, MCPServerConfig>
    | {
        mcpServers: Record<string, MCPServerConfig>
        mcpSettings?: MCPSettings
      }
    | undefined
  >(undefined)
  const [connectedServers, setConnectedServers] = useState<string[]>([])
  const [loadingServers, setLoadingServers] = useState<{
    [key: string]: boolean
  }>({})
  const {
    statuses: authStatuses,
    authorizing,
    consentUrls,
    refresh: refreshAuth,
    authorize,
    clearAuth,
  } = useMcpAuth(Object.keys(mcpServers))

  const refreshConnectedServers = useCallback(() => {
    serviceHub
      .mcp()
      .getConnectedServers()
      .then(setConnectedServers)
      .catch((error) =>
        console.error('Failed to refresh connected MCP servers:', error)
      )
  }, [serviceHub])
  const setErrorMessage = useAppState((state) => state.setErrorMessage)

  const [savingSettings, setSavingSettings] = useState(false)
  const settingsSavePending = useRef(false)
  const [timeoutDraft, setTimeoutDraft] = useState(String(settings.toolCallTimeoutSeconds))
  const [outputDraft, setOutputDraft] = useState(String(settings.maxToolOutputChars))

  useEffect(() => {
    setTimeoutDraft(String(settings.toolCallTimeoutSeconds))
    setOutputDraft(String(settings.maxToolOutputChars))
  }, [settings.toolCallTimeoutSeconds, settings.maxToolOutputChars])

  const handleSaveSettings = useCallback(async (partial: Partial<MCPSettings>) => {
    if (settingsSavePending.current) return
    settingsSavePending.current = true
    setSavingSettings(true)
    try {
      await saveSettings(partial)
    } catch (error) {
      setErrorMessage({
        message: normalizeAppError(error),
        subtitle: 'Failed to save MCP settings. Please retry.',
      })
    } finally {
      settingsSavePending.current = false
      setSavingSettings(false)
    }
  }, [saveSettings, setErrorMessage])

  const modelProviders = useModelProvider((state) => state.providers)

  const routerPickerDisabled =
    !settings.enableSmartToolRouting || !settings.useLightweightRouterModel

  useEffect(() => {
    if (
      !settings.useLightweightRouterModel ||
      !settings.routerModelProvider ||
      !settings.routerModelId
    ) {
      return
    }
    if (modelProviders.length === 0) return

    const provider = modelProviders.find(
      (p) => p.provider === settings.routerModelProvider && p.active
    )
    const model = provider?.models.find((m) => m.id === settings.routerModelId)

    if (
      !provider ||
      !model ||
      !isRouterModelSelectable(provider, model)
    ) {
      void handleSaveSettings({ routerModelProvider: '', routerModelId: '' })
    }
  }, [
    settings.useLightweightRouterModel,
    settings.routerModelProvider,
    settings.routerModelId,
    modelProviders,
    handleSaveSettings,
  ])

  const handleOpenDialog = (serverKey?: string) => {
    if (serverKey) {
      // Edit mode
      setCurrentConfig(mcpServers[serverKey])
      setEditingKey(serverKey)
    } else {
      // Add mode
      setCurrentConfig(undefined)
      setEditingKey(null)
    }
    setOpen(true)
  }

  const reconfigurationPending = useRef(false)

  // Reconfiguration is one transaction, not two guarded UI toggles. In
  // particular, capture active before disconnecting and never reconnect old
  // credentials as a speculative rollback after a transport/write failure.
  const reconfigureServers = async (
    nextServers: Record<string, MCPServerConfig>,
    affectedKeys: string[],
    nextSettings = useMCPServers.getState().settings
  ) => {
    const keys = [...new Set(affectedKeys)]
    if (reconfigurationPending.current || settingsSavePending.current ||
        pendingServers.current.size > 0) {
      const error = new Error('An MCP change is already in progress. Please retry.')
      setErrorMessage({ message: error.message, subtitle: t('mcp-servers:checkParams') })
      throw error
    }
    reconfigurationPending.current = true
    settingsSavePending.current = true
    setSavingSettings(true)
    const previous = useMCPServers.getState()
    let committed = false
    keys.forEach((key) => pendingServers.current.add(key))
    setLoadingServers((current) => ({
      ...current, ...Object.fromEntries(keys.map((key) => [key, true])),
    }))
    try {
      const liveServers = await serviceHub.mcp().getConnectedServers()
      for (const key of keys) {
        if (liveServers.includes(key)) {
          await serviceHub.mcp().deactivateMCPServer(key)
        }
      }
      useMCPServers.setState({ mcpServers: nextServers, settings: nextSettings })
      committed = true
      for (const key of keys) {
        const config = nextServers[key]
        if (config?.active) {
          await serviceHub.mcp().activateMCPServer(key, config)
        }
      }
      await syncServers()
    } catch (error) {
      // Roll back the saved preference only. Transport state is refreshed below;
      // a disconnected server must not be presented as reconnected by rollback.
      if (committed) {
        useMCPServers.setState({
          mcpServers: previous.mcpServers,
          settings: previous.settings,
        })
      }
      setErrorMessage({
        message: normalizeAppError(error),
        subtitle: t('mcp-servers:checkParams'),
      })
      throw error
    } finally {
      refreshConnectedServers()
      keys.forEach((key) => pendingServers.current.delete(key))
      setLoadingServers((current) => ({
        ...current, ...Object.fromEntries(keys.map((key) => [key, false])),
      }))
      reconfigurationPending.current = false
      settingsSavePending.current = false
      setSavingSettings(false)
    }
  }

  const handleSaveServer = async (name: string, config: MCPServerConfig) => {
    const servers = useMCPServers.getState().mcpServers
    // The form supplies the requested enabled preference, including false.
    const nextConfig = { ...config, active: config.active ?? (editingKey ? servers[editingKey]?.active ?? false : true) }
    const nextServers = editingKey
      ? Object.fromEntries(Object.entries(servers).map(([key, value]) =>
          key === editingKey ? [name, nextConfig] : [key, value]))
      : { ...servers, [name]: nextConfig }
    await reconfigureServers(nextServers, editingKey ? [editingKey, name] : [name])
  }

  const handleEdit = (serverKey: string) => {
    handleOpenDialog(serverKey)
  }

  const handleDeleteClick = (serverKey: string) => {
    setServerToDelete(serverKey)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!serverToDelete) return
    const nextServers = { ...useMCPServers.getState().mcpServers }
    delete nextServers[serverToDelete]
    await reconfigureServers(nextServers, [serverToDelete])
    toast.success(
      t('mcp-servers:deleteServer.success', { serverName: serverToDelete })
    )
    setServerToDelete(null)
  }

  const handleOpenJsonEditor = async (serverKey?: string) => {
    if (serverKey) {
      // Edit single server JSON
      setJsonServerName(serverKey)
      setJsonEditorData(mcpServers[serverKey])
    } else {
      // Edit all servers JSON
      setJsonServerName(null)
      setJsonEditorData({
        mcpServers,
        mcpSettings: settings,
      })
    }
    setJsonEditorOpen(true)
  }

  const handleSaveJson = async (
    data:
      | MCPServerConfig
      | Record<string, MCPServerConfig>
      | {
          mcpServers?: Record<string, MCPServerConfig>
          mcpSettings?: MCPSettings
        }
  ) => {
    const servers = useMCPServers.getState().mcpServers
    if (jsonServerName) {
      const config = data as MCPServerConfig
      await reconfigureServers({
        ...servers,
        [jsonServerName]: { ...config, active: Boolean(config.active) },
      }, [jsonServerName])
      return
    }
    const payload = data as {
      mcpServers?: Record<string, MCPServerConfig>
      mcpSettings?: MCPSettings
    }
    const wrapped = 'mcpServers' in data || 'mcpSettings' in data
    const nextServers = wrapped
      ? payload.mcpServers ?? {}
      : data as Record<string, MCPServerConfig>
    const nextSettings = wrapped && payload.mcpSettings
      ? { ...DEFAULT_MCP_SETTINGS, ...payload.mcpSettings }
      : useMCPServers.getState().settings
    await reconfigureServers(
      nextServers,
      [...Object.keys(servers), ...Object.keys(nextServers)],
      nextSettings
    )
  }

  /**
   * Run the interactive sign-in, then bring the server up if it is enabled: a
   * server that failed to connect for want of a token is still marked active,
   * so authorizing without reconnecting would leave it down until toggled.
   */
  const handleAuthorize = async (serverKey: string) => {
    try {
      await authorize(serverKey)
      toast.success(t('mcp-servers:auth.authorized', { serverName: serverKey }))
      if (mcpServers[serverKey]?.active) {
        toggleServer(serverKey, true)
      }
    } catch (error) {
      setErrorMessage({
        message: t('mcp-servers:auth.authorizeFailed', {
          serverName: serverKey,
        }),
        subtitle: normalizeAppError(error),
      })
    }
  }

  /**
   * Forget the tokens and drop the connection: the live transport still holds
   * the old bearer token, so leaving it up would keep working against
   * credentials the user just asked to forget.
   *
   * Disconnect only -- the server stays `active` in the config, so re-authorizing
   * brings it back without the user having to re-enable it. Matches the CLI's
   * `MCP_ACTION_CLEAR_AUTH`, which also clears and disconnects without touching
   * the flag.
   */
  const handleClearAuth = async (serverKey: string) => {
    try {
      const cleared = await clearAuth(serverKey)
      toast.success(
        cleared
          ? t('mcp-servers:auth.cleared', { serverName: serverKey })
          : t('mcp-servers:auth.nothingToClear', { serverName: serverKey })
      )
      if (cleared && connectedServers.includes(serverKey)) {
        await serviceHub.mcp().deactivateMCPServer(serverKey)
        refreshConnectedServers()
      }
    } catch (error) {
      setErrorMessage({
        message: t('mcp-servers:auth.clearFailed', { serverName: serverKey }),
        subtitle: normalizeAppError(error),
      })
    }
  }

  const pendingServers = useRef(new Set<string>())
  const toggleServer = async (serverKey: string, active: boolean) => {
    const config = getServerConfig(serverKey)
    if (!config || reconfigurationPending.current || pendingServers.current.has(serverKey)) return
    pendingServers.current.add(serverKey)
    setLoadingServers((prev) => ({ ...prev, [serverKey]: true }))
    let changedConfig: MCPServerConfig | undefined
    try {
      if (active) {
        await serviceHub.mcp().activateMCPServer(serverKey, { ...config, active })
      } else {
        await serviceHub.mcp().deactivateMCPServer(serverKey)
      }
      changedConfig = { ...config, active }
      editServer(serverKey, changedConfig)
      await syncServers()
      toast.success(t(active
        ? 'mcp-servers:serverStatusActive'
        : 'mcp-servers:serverStatusInactive', { serverKey }))
    } catch (error) {
      // Restore the persisted preference, not a guessed transport state. In
      // particular, never reconnect automatically on a failed disconnect save.
      if (changedConfig && getServerConfig(serverKey) === changedConfig) {
        editServer(serverKey, config)
      }
      const authDetail = needsAuthDetail(error)
      if (active && authDetail !== null) {
        void refreshAuth()
        setErrorMessage({
          message: t('mcp-servers:auth.needsAuth', { serverName: serverKey }),
          subtitle: t('mcp-servers:auth.needsAuthHint'),
        })
      } else {
        setErrorMessage({
          message: normalizeAppError(error),
          subtitle: t('mcp-servers:checkParams'),
        })
      }
    } finally {
      // The connection indicator is always sourced from the live service, even
      // when persistence fails after the transport has already changed.
      refreshConnectedServers()
      pendingServers.current.delete(serverKey)
      setLoadingServers((prev) => ({ ...prev, [serverKey]: false }))
    }
  }

  useEffect(() => {
    refreshConnectedServers()

    let unlisten: (() => void) | undefined
    const setupListener = async () => {
      unlisten = await listen(SystemEvent.MCP_UPDATE, () => {
        refreshConnectedServers()
      })
    }
    setupListener().catch((error) =>
      console.error('Failed to set up MCP update listener:', error)
    )

    return () => {
      unlisten?.()
    }
  }, [refreshConnectedServers])

  return (
    <Fragment>
      <div className="flex flex-col h-svh w-full">
        <HeaderPage>
          <div className={cn("flex items-center justify-between w-full mr-2 pr-3", !IS_MACOS && "pr-30")}>
            <span className='font-medium text-base font-studio'>{t('common:settings')}</span>
            <Button variant="outline" size="sm" onClick={() => handleOpenDialog()} className="relative z-50">
              <IconPlus size={18} className="text-muted-foreground" />
              {t('mcp-servers:addServer')}
            </Button>
          </div>
        </HeaderPage>
        <div className="flex h-[calc(100%-60px)]">
          <SettingsMenu />
          <div className="p-4 pt-0 w-full overflow-y-auto">
            <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
              <Card
                header={
                  <div className="flex flex-col mb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h1 className="text-foreground font-medium text-base font-studio">
                          {t('mcp-servers:title')}
                        </h1>
                        <div className="text-xs bg-secondary border text-muted-foreground rounded-full py-0.5 px-2">
                          <span>{t('mcp-servers:experimental')}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5">
                        <Button
                          onClick={() => handleOpenJsonEditor()}
                          title={t('mcp-servers:editAllJson')}
                          size="icon-xs"
                          variant="ghost"
                        >
                          <IconCodeCircle
                            size={18}
                            className="text-muted-foreground"
                          />
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm mt-1">
                      {t('mcp-servers:findMore')}{' '}
                      <a
                        href="https://mcp.so/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        mcp.so
                      </a>
                    </p>
                  </div>
                }
              >
                <CardItem
                  title={t('mcp-servers:allowPermissions')}
                  description={t('mcp-servers:allowPermissionsDesc')}
                  actions={
                    <div className="shrink-0 ml-4">
                      <Switch
                        checked={allowAllMCPPermissions}
                        onCheckedChange={setAllowAllMCPPermissions}
                      />
                    </div>
                  }
                />
                <CardItem
                  title={t('mcp-servers:runtimeSettings.toolCallTimeout')}
                  description={t(
                    'mcp-servers:runtimeSettings.toolCallTimeoutDesc'
                  )}
                  actions={
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={timeoutDraft}
                      disabled={savingSettings}
                      onChange={(event) =>
                        setTimeoutDraft(event.target.value)
                      }
                      onBlur={async () => {
                        const value = timeoutDraft === '' ? DEFAULT_MCP_SETTINGS.toolCallTimeoutSeconds : Number(timeoutDraft)
                        if (Number.isFinite(value) && value >= 1) {
                          await handleSaveSettings({ toolCallTimeoutSeconds: value })
                        }
                        setTimeoutDraft(String(useMCPServers.getState().settings.toolCallTimeoutSeconds))
                      }}
                      className="w-28"
                    />
                  }
                />
                <CardItem
                  title={t('mcp-servers:runtimeSettings.maxToolOutputChars')}
                  description={t(
                    'mcp-servers:runtimeSettings.maxToolOutputCharsDesc'
                  )}
                  actions={
                    <Input
                      type="number"
                      min={0}
                      step={1000}
                      value={outputDraft}
                      disabled={savingSettings}
                      onChange={(event) =>
                        setOutputDraft(event.target.value)
                      }
                      onBlur={async () => {
                        const value = outputDraft === '' ? DEFAULT_MCP_SETTINGS.maxToolOutputChars : Number(outputDraft)
                        if (Number.isFinite(value) && value >= 0) {
                          await handleSaveSettings({ maxToolOutputChars: value })
                        }
                        setOutputDraft(String(useMCPServers.getState().settings.maxToolOutputChars))
                      }}
                      className="w-28"
                    />
                  }
                />
                <CardItem
                  title={t('mcp-servers:runtimeSettings.smartToolRouting')}
                  description={t(
                    'mcp-servers:runtimeSettings.smartToolRoutingDesc'
                  )}
                  actions={
                    <div className="shrink-0 ml-4">
                      <Switch
                        checked={settings.enableSmartToolRouting}
                        disabled={savingSettings}
                        onCheckedChange={async (checked) => {
                          await handleSaveSettings(checked
                            ? { enableSmartToolRouting: true }
                            : {
                              enableSmartToolRouting: false,
                              useLightweightRouterModel: false,
                              routerModelProvider: '',
                              routerModelId: '',
                            })
                        }}
                      />
                    </div>
                  }
                />
                <CardItem
                  title={t('mcp-servers:runtimeSettings.useLightweightRouterModel')}
                  description={t(
                    'mcp-servers:runtimeSettings.useLightweightRouterModelDesc'
                  )}
                  actions={
                    <div className="shrink-0 ml-4">
                      <Switch
                        checked={settings.useLightweightRouterModel}
                        disabled={savingSettings || !settings.enableSmartToolRouting}
                        onCheckedChange={async (checked) => {
                          await handleSaveSettings(
                            checked
                              ? { useLightweightRouterModel: true }
                              : {
                                  useLightweightRouterModel: false,
                                  routerModelProvider: '',
                                  routerModelId: '',
                                }
                          )
                        }}
                      />
                    </div>
                  }
                />
                <CardItem
                  title={t('mcp-servers:runtimeSettings.routerModel')}
                  description={t('mcp-servers:runtimeSettings.routerModelDesc')}
                  actions={
                    <McpRouterModelPicker
                      ariaLabel={t('mcp-servers:runtimeSettings.routerModel')}
                      providers={modelProviders}
                      selectedProvider={settings.routerModelProvider}
                      selectedModelId={settings.routerModelId}
                      disabled={savingSettings || routerPickerDisabled}
                      onSelect={async (providerName, modelId) => {
                        await handleSaveSettings({
                          routerModelProvider: providerName,
                          routerModelId: modelId,
                        })
                      }}
                      placeholder={t(
                        'mcp-servers:runtimeSettings.selectRouterModelPlaceholder'
                      )}
                      searchPlaceholder={t(
                        'mcp-servers:runtimeSettings.routerModelSearchPlaceholder'
                      )}
                      emptyListMessage={t(
                        'mcp-servers:runtimeSettings.routerModelEmptyList'
                      )}
                      formatEmptySearch={(q) =>
                        t('mcp-servers:runtimeSettings.routerModelEmptySearch', {
                          query: q,
                        })
                      }
                    />
                  }
                />
              </Card>

              {Object.keys(mcpServers).length === 0 ? (
                <div className="py-4 text-center font-medium text-muted-foreground">
                  {t('mcp-servers:noServers')}
                </div>
              ) : (
                Object.entries(mcpServers).map(([key, config], index) => (
                  <Card key={`${key}-${index}`}>
                    <CardItem
                      align="start"
                      title={
                        <div className="flex items-center gap-x-2">
                          <div
                            className={twMerge(
                              'size-2 rounded-full',
                              connectedServers.includes(key)
                                ? 'bg-green-600 dark:bg-green-600'
                                : 'bg-secondary'
                            )}
                          />
                          <h1 className="text-foreground text-base capitalize font-studio">
                            {key}
                          </h1>
                          {config.official && (
                            <div className="flex items-center gap-1.5 px-2 py-0.5 text-xs bg-secondary border rounded-sm">
                              <img
                                src="/images/jan-logo.png"
                                alt="Jan"
                                className="w-3 h-3 object-contain"
                              />
                              <span>Official</span>
                            </div>
                          )}
                        </div>
                      }
                      descriptionOutside={
                        <div className="text-sm text-muted-foreground">
                          <div className="mb-1">
                            Transport:{' '}
                            <span className="uppercase">
                              {config.type || 'stdio'}
                            </span>
                          </div>

                          {config.type === 'stdio' || !config.type ? (
                            <>
                              <div>
                                {t('mcp-servers:command')}: {config.command}
                              </div>
                              <div className="my-1 break-all">
                                {t('mcp-servers:args')}:{' '}
                                {config?.args?.join(', ')}
                              </div>
                              {config.env &&
                                Object.keys(config.env).length > 0 && (
                                  <div className="break-all">
                                    {t('mcp-servers:env')}:{' '}
                                    {Object.entries(config.env)
                                      .map(([key]) => `${key}=******`)
                                      .join(', ')}
                                  </div>
                                )}
                              {config.official && (
                                <div className="mt-2 text-xs text-muted-foreground pt-2">
                                  <p className="mb-1">
                                    Requires Jan Browser Extension to be installed
                                    in your Chrome-based browser.
                                  </p>
                                  <a
                                    href="https://chromewebstore.google.com/detail/jan-browser-mcp/mkciifcjehgnpaigoiaakdgabbpfppal"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-500 hover:underline"
                                  >
                                    Install Extension →
                                  </a>
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              <div className="break-all">
                                URL: {maskSensitiveUrl(config.url || '')}
                              </div>
                              {config.headers &&
                                Object.keys(config.headers).length > 0 && (
                                  <div className="my-1 break-all">
                                    Headers:{' '}
                                    {Object.entries(config.headers)
                                      .map(([key]) => `${key}=******`)
                                      .join(', ')}
                                  </div>
                                )}
                              {config.timeout && (
                                <div>Timeout: {config.timeout}s</div>
                              )}
                              <McpServerAuth
                                status={authStatuses[key]}
                                authorizing={!!authorizing[key]}
                                consentUrl={consentUrls[key]}
                                onAuthorize={() => void handleAuthorize(key)}
                                onClearAuth={() => void handleClearAuth(key)}
                              />
                            </>
                          )}
                        </div>
                      }
                      actions={
                        <div className="flex items-center gap-0.5">
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => handleOpenJsonEditor(key)}
                            title={t('mcp-servers:editJson.title', {
                              serverName: key,
                            })}
                          >
                            <IconCodeCircle
                              size={18}
                              className="text-muted-foreground"
                            />
                          </Button>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => handleEdit(key)}
                            title={t('mcp-servers:editServer')}
                          >
                            <IconPencil
                              size={18}
                              className="text-muted-foreground"
                            />
                          </Button>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => handleDeleteClick(key)}
                            title={t('mcp-servers:deleteServer.title')}
                          >
                            <IconTrash
                              size={18}
                              className="text-muted-foreground"
                            />
                          </Button>
                          <div className="ml-2">
                            <Switch
                              checked={config.active}
                              loading={!!loadingServers[key]}
                              disabled={!!loadingServers[key]}
                              onCheckedChange={(checked) =>
                                toggleServer(key, checked)
                              }
                            />
                          </div>
                        </div>
                      }
                    />
                  </Card>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Use the AddEditMCPServer component */}
      <AddEditMCPServer
        open={open}
        onOpenChange={setOpen}
        editingKey={editingKey}
        initialData={currentConfig}
        onSave={handleSaveServer}
      />

      {/* Delete confirmation dialog */}
      <DeleteMCPServerConfirm
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        serverName={serverToDelete || ''}
        onConfirm={handleConfirmDelete}
      />

      {/* JSON editor dialog */}
      <EditJsonMCPserver
        open={jsonEditorOpen}
        onOpenChange={setJsonEditorOpen}
        serverName={jsonServerName}
        initialData={
          jsonEditorData ?? {
            mcpServers,
            mcpSettings: settings,
          }
        }
        onSave={handleSaveJson}
      />
    </Fragment>
  )
}
