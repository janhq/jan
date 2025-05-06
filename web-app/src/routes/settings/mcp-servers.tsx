import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { t } from 'i18next'
import { CardSetting, CardSettingItem } from '@/containers/CardSetting'
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.mcp_servers as any)({
  component: MCPServers,
})

function MCPServers() {
  const { fetchMCPServers, mcpServers, addServer, editServer, deleteServer } =
    useMCPServers()

  useEffect(() => {
    fetchMCPServers()
  }, [fetchMCPServers])

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

  const handleSaveServer = (name: string, config: MCPServerConfig) => {
    if (editingKey) {
      // Edit existing server
      editServer(editingKey, config)

      // If server name changed, delete old one and add new one
      if (editingKey !== name) {
        deleteServer(editingKey)
        addServer(name, config)
      }
    } else {
      // Add new server
      addServer(name, config)
    }
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
    }
  }

  const handleOpenJsonEditor = (serverKey?: string) => {
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

  const handleSaveJson = (
    data: MCPServerConfig | Record<string, MCPServerConfig>
  ) => {
    if (jsonServerName) {
      // Save single server
      editServer(jsonServerName, data as MCPServerConfig)
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

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            <CardSetting
              header={
                <div className="flex flex-col">
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
            />
            {Object.keys(mcpServers).length === 0 ? (
              <div className="py-4 text-center font-medium text-main-view-fg/50">
                No MCP servers found
              </div>
            ) : (
              Object.entries(mcpServers).map(([key, config]) => (
                <CardSetting>
                  <CardSettingItem
                    key={key}
                    title={
                      <div className="flex items-center gap-x-2">
                        <h1 className="text-main-view-fg text-base">{key}</h1>
                      </div>
                    }
                    description={
                      <div className="text-sm text-main-view-fg/70">
                        <div>Command: {config.command}</div>
                        <div className="my-1">
                          Args: {config.args.join(', ')}
                        </div>
                        {Object.keys(config.env).length > 0 && (
                          <div>
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
                      </div>
                    }
                  />
                </CardSetting>
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
