import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { t } from 'i18next'
import { Card, CardItem } from '@/containers/Card'
import {
  IconPencil,
  IconPlus,
  IconTrash,
  IconCodeCircle,
} from '@tabler/icons-react'
import { useMCPServers, MCPServerConfig } from '@/hooks/useMCPServers'
import { useEffect, useState } from 'react'
import AddEditMCPServer from '@/containers/dialogs/AddEditMCPServer'
import DeleteMCPServerConfirm from '@/containers/dialogs/DeleteMCPServerConfirm'
import EditJsonMCPserver from '@/containers/dialogs/EditJsonMCPserver'
import { Switch } from '@/components/ui/switch'
import { twMerge } from 'tailwind-merge'
import { getConnectedServers } from '@/services/mcp'
import { useToolApproval } from '@/hooks/useToolApproval'
import { toast } from 'sonner'
import { invoke } from '@tauri-apps/api/core'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.mcp_servers as any)({
  component: MCPServers,
})

function MCPServers() {
  const {
    mcpServers,
    addServer,
    editServer,
    deleteServer,
    syncServers,
    syncServersAndRestart,
    getServerConfig,
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
    MCPServerConfig | Record<string, MCPServerConfig> | undefined
  >(undefined)
  const [connectedServers, setConnectedServers] = useState<string[]>([])
  const [loadingServers, setLoadingServers] = useState<{
    [key: string]: boolean
  }>({})

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

  const handleSaveServer = async (name: string, config: MCPServerConfig) => {
    try {
      await toggleServer(name, false)
    } catch (error) {
      console.error('Error deactivating server:', error)
    }
    if (editingKey) {
      // If server name changed, delete old one and add new one
      if (editingKey !== name) {
        deleteServer(editingKey)
        addServer(name, config)
      } else {
        editServer(editingKey, config)
      }
    } else {
      // Add new server
      addServer(name, config)
    }

    syncServers()
    await toggleServer(name, true)
  }

  const handleEdit = (serverKey: string) => {
    handleOpenDialog(serverKey)
  }

  const handleDeleteClick = (serverKey: string) => {
    setServerToDelete(serverKey)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = () => {
    if (serverToDelete) {
      deleteServer(serverToDelete)
      setServerToDelete(null)
      syncServersAndRestart()
    }
  }

  const handleOpenJsonEditor = async (serverKey?: string) => {
    if (serverKey) {
      // Edit single server JSON
      setJsonServerName(serverKey)
      setJsonEditorData(mcpServers[serverKey])
    } else {
      // Edit all servers JSON
      setJsonServerName(null)
      setJsonEditorData(mcpServers)
    }
    setJsonEditorOpen(true)
  }

  const handleSaveJson = async (
    data: MCPServerConfig | Record<string, MCPServerConfig>
  ) => {
    if (jsonServerName) {
      try {
        await toggleServer(jsonServerName, false)
      } catch (error) {
        console.error('Error deactivating server:', error)
      }
      // Save single server
      editServer(jsonServerName, data as MCPServerConfig)
      syncServers()
      toggleServer(jsonServerName, true)
    } else {
      // Save all servers
      // Clear existing servers first
      Object.keys(mcpServers).forEach((key) => {
        deleteServer(key)
      })

      // Add all servers from the JSON
      Object.entries(data as Record<string, MCPServerConfig>).forEach(
        ([key, config]) => {
          addServer(key, config)
        }
      )
    }
  }

  const toggleServer = (serverKey: string, active: boolean) => {
    if (serverKey) {
      setLoadingServers((prev) => ({ ...prev, [serverKey]: true }))
      const config = getServerConfig(serverKey)
      if (active && config) {
        invoke('activate_mcp_server', {
          name: serverKey,
          config: {
            ...(config ?? (mcpServers[serverKey] as MCPServerConfig)),
            active,
          },
        })
          .then(() => {
            // Save single server
            editServer(serverKey, {
              ...(config ?? (mcpServers[serverKey] as MCPServerConfig)),
              active,
            })
            syncServers()
            toast.success(
              `Server ${serverKey} is now ${active ? 'active' : 'inactive'}.`
            )
            getConnectedServers().then(setConnectedServers)
          })
          .catch((error) => {
            editServer(serverKey, {
              ...(config ?? (mcpServers[serverKey] as MCPServerConfig)),
              active: false,
            })
            toast.error(error, {
              description:
                'Please check the parameters according to the tutorial.',
            })
          })
          .finally(() => {
            setLoadingServers((prev) => ({ ...prev, [serverKey]: false }))
          })
      } else {
        editServer(serverKey, {
          ...(config ?? (mcpServers[serverKey] as MCPServerConfig)),
          active,
        })
        syncServers()
        invoke('deactivate_mcp_server', { name: serverKey }).finally(() => {
          getConnectedServers().then(setConnectedServers)
          setLoadingServers((prev) => ({ ...prev, [serverKey]: false }))
        })
      }
    }
  }

  useEffect(() => {
    getConnectedServers().then(setConnectedServers)

    const intervalId = setInterval(() => {
      getConnectedServers().then(setConnectedServers)
    }, 3000)

    return () => clearInterval(intervalId)
  }, [setConnectedServers])

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            <Card
              header={
                <div className="flex flex-col mb-4">
                  <div className="flex items-center justify-between">
                    <h1 className="text-main-view-fg font-medium text-base">
                      MCP Servers
                    </h1>
                    <div className="flex items-center gap-0.5">
                      <div
                        className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                        onClick={() => handleOpenJsonEditor()}
                        title="Edit All Servers JSON"
                      >
                        <IconCodeCircle
                          size={18}
                          className="text-main-view-fg/50"
                        />
                      </div>
                      <div
                        className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                        onClick={() => handleOpenDialog()}
                        title="Add Server"
                      >
                        <IconPlus size={18} className="text-main-view-fg/50" />
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-main-view-fg/70 mt-1">
                    Find more MCP servers at{' '}
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
                title="Allow All MCP Tool Permissions"
                description="When enabled, all MCP tool calls will be automatically
                      approved without showing permission dialogs."
                actions={
                  <div className="flex-shrink-0 ml-4">
                    <Switch
                      checked={allowAllMCPPermissions}
                      onCheckedChange={setAllowAllMCPPermissions}
                    />
                  </div>
                }
              />
            </Card>

            {Object.keys(mcpServers).length === 0 ? (
              <div className="py-4 text-center font-medium text-main-view-fg/50">
                No MCP servers found
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
                              ? 'bg-accent'
                              : 'bg-main-view-fg/50'
                          )}
                        />
                        <h1 className="text-main-view-fg text-base capitalize">
                          {key}
                        </h1>
                      </div>
                    }
                    description={
                      <div className="text-sm text-main-view-fg/70">
                        <div>Command: {config.command}</div>
                        <div className="my-1 break-all">
                          Args: {config?.args?.join(', ')}
                        </div>
                        {config.env && Object.keys(config.env).length > 0 && (
                          <div className="break-all">
                            Env:{' '}
                            {Object.entries(config.env)
                              .map(([key, value]) => `${key}=${value}`)
                              .join(', ')}
                          </div>
                        )}
                      </div>
                    }
                    actions={
                      <div className="flex items-center gap-0.5">
                        <div
                          className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                          onClick={() => handleOpenJsonEditor(key)}
                          title="Edit JSON"
                        >
                          <IconCodeCircle
                            size={18}
                            className="text-main-view-fg/50"
                          />
                        </div>
                        <div
                          className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                          onClick={() => handleEdit(key)}
                          title="Edit Server"
                        >
                          <IconPencil
                            size={18}
                            className="text-main-view-fg/50"
                          />
                        </div>
                        <div
                          className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                          onClick={() => handleDeleteClick(key)}
                          title="Delete Server"
                        >
                          <IconTrash
                            size={18}
                            className="text-main-view-fg/50"
                          />
                        </div>
                        <div className="ml-2">
                          <Switch
                            checked={config.active}
                            loading={!!loadingServers[key]}
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
          jsonEditorData as MCPServerConfig | Record<string, MCPServerConfig>
        }
        onSave={handleSaveJson}
      />
    </div>
  )
}
