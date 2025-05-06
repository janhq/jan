import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { t } from 'i18next'
import { CardSetting, CardSettingItem } from '@/containers/CardSetting'
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { useMCPServers, MCPServerConfig } from '@/hooks/useMCPServers'
import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
  const [serverName, setServerName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState<string[]>([''])
  const [envKeys, setEnvKeys] = useState<string[]>([''])
  const [envValues, setEnvValues] = useState<string[]>([''])

  const resetForm = () => {
    setServerName('')
    setCommand('')
    setArgs([''])
    setEnvKeys([''])
    setEnvValues([''])
    setEditingKey(null)
  }

  const handleOpenDialog = (serverKey?: string) => {
    if (serverKey) {
      // Edit mode
      const config = mcpServers[serverKey]
      setServerName(serverKey)
      setCommand(config.command)
      setArgs(config.args.length > 0 ? config.args : [''])

      // Convert env object to arrays of keys and values
      const keys = Object.keys(config.env)
      const values = keys.map((key) => config.env[key])

      setEnvKeys(keys.length > 0 ? keys : [''])
      setEnvValues(values.length > 0 ? values : [''])
      setEditingKey(serverKey)
    } else {
      // Add mode
      resetForm()
    }
    setOpen(true)
  }

  const handleAddArg = () => {
    setArgs([...args, ''])
  }

  const handleRemoveArg = (index: number) => {
    const newArgs = [...args]
    newArgs.splice(index, 1)
    setArgs(newArgs.length > 0 ? newArgs : [''])
  }

  const handleArgChange = (index: number, value: string) => {
    const newArgs = [...args]
    newArgs[index] = value
    setArgs(newArgs)
  }

  const handleAddEnv = () => {
    setEnvKeys([...envKeys, ''])
    setEnvValues([...envValues, ''])
  }

  const handleRemoveEnv = (index: number) => {
    const newKeys = [...envKeys]
    const newValues = [...envValues]
    newKeys.splice(index, 1)
    newValues.splice(index, 1)
    setEnvKeys(newKeys.length > 0 ? newKeys : [''])
    setEnvValues(newValues.length > 0 ? newValues : [''])
  }

  const handleEnvKeyChange = (index: number, value: string) => {
    const newKeys = [...envKeys]
    newKeys[index] = value
    setEnvKeys(newKeys)
  }

  const handleEnvValueChange = (index: number, value: string) => {
    const newValues = [...envValues]
    newValues[index] = value
    setEnvValues(newValues)
  }

  const handleSave = () => {
    // Convert env arrays to object
    const envObj: Record<string, string> = {}
    envKeys.forEach((key, index) => {
      if (key.trim() !== '') {
        envObj[key] = envValues[index] || ''
      }
    })

    // Filter out empty args
    const filteredArgs = args.filter((arg) => arg.trim() !== '')

    const config: MCPServerConfig = {
      command,
      args: filteredArgs,
      env: envObj,
    }

    if (editingKey) {
      // Edit existing server
      editServer(editingKey, config)

      // If server name changed, delete old one and add new one
      if (editingKey !== serverName && serverName.trim() !== '') {
        deleteServer(editingKey)
        addServer(serverName, config)
      }
    } else {
      // Add new server
      if (serverName.trim() !== '') {
        addServer(serverName, config)
      }
    }

    setOpen(false)
    resetForm()
  }

  const handleEdit = (serverKey: string) => {
    handleOpenDialog(serverKey)
  }

  const handleDelete = (serverKey: string) => {
    deleteServer(serverKey)
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
                <div className="flex items-center justify-between mb-4">
                  <h1 className="text-main-view-fg font-medium text-base">
                    MCP Servers
                  </h1>
                  <div className="flex items-center gap-2">
                    <div
                      className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                      onClick={() => handleOpenDialog()}
                    >
                      <IconPlus size={18} className="text-main-view-fg/50" />
                    </div>
                  </div>
                </div>
              }
            >
              {Object.keys(mcpServers).length === 0 ? (
                <div className="py-4 text-center font-medium text-main-view-fg/50">
                  No MCP servers found
                </div>
              ) : (
                Object.entries(mcpServers).map(([key, config]) => (
                  <CardSettingItem
                    key={key}
                    title={
                      <div className="flex items-center gap-x-2">
                        <h1 className="text-main-view-fg font-medium text-base">
                          {key}
                        </h1>
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
                      <div className="flex items-center gap-2">
                        <div
                          className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                          onClick={() => handleEdit(key)}
                        >
                          <IconPencil
                            size={18}
                            className="text-main-view-fg/50"
                          />
                        </div>
                        <div
                          className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                          onClick={() => handleDelete(key)}
                        >
                          <IconTrash
                            size={18}
                            className="text-main-view-fg/50"
                          />
                        </div>
                      </div>
                    }
                  />
                ))
              )}
            </CardSetting>
          </div>
        </div>
      </div>
      {/* Dialog for adding/editing MCP servers */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingKey ? 'Edit MCP Server' : 'Add MCP Server'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm mb-2 inline-block">Server Name</label>
              <Input
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                placeholder="Enter server name"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm mb-2 inline-block">Command</label>
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Enter command (uvx or npx)"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm">Arguments</label>
                <div
                  className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                  onClick={handleAddArg}
                >
                  <IconPlus size={18} className="text-main-view-fg/60" />
                </div>
              </div>

              {args.map((arg, index) => (
                <div key={`arg-${index}`} className="flex items-center gap-2">
                  <Input
                    value={arg}
                    onChange={(e) => handleArgChange(index, e.target.value)}
                    placeholder={`Argument ${index + 1}`}
                  />
                  {args.length > 1 && (
                    <div
                      className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                      onClick={() => handleRemoveArg(index)}
                    >
                      <IconTrash size={18} className="text-destructive" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm">Environment Variables</label>
                <div
                  className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                  onClick={handleAddEnv}
                >
                  <IconPlus size={18} className="text-main-view-fg/60" />
                </div>
              </div>

              {envKeys.map((key, index) => (
                <div key={`env-${index}`} className="flex items-center gap-2">
                  <Input
                    value={key}
                    onChange={(e) => handleEnvKeyChange(index, e.target.value)}
                    placeholder="Key"
                    className="flex-1"
                  />
                  <Input
                    value={envValues[index] || ''}
                    onChange={(e) =>
                      handleEnvValueChange(index, e.target.value)
                    }
                    placeholder="Value"
                    className="flex-1"
                  />
                  {envKeys.length > 1 && (
                    <div
                      className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                      onClick={() => handleRemoveEnv(index)}
                    >
                      <IconTrash size={18} className="text-destructive" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button onClick={handleSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
