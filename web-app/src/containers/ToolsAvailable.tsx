import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { useAppState } from '@/hooks/useAppState'
import { useThreads } from '@/hooks/useThreads'
import { useToolAvailable } from '@/hooks/useToolAvailable'

import { DropdownMenuSeparator } from '@radix-ui/react-dropdown-menu'

import { IconTool } from '@tabler/icons-react'
import { useEffect } from 'react'

interface ToolsAvailableProps {
  initialMessage?: boolean
  onOpenChange?: (isOpen: boolean) => void
}

const ToolsAvailable = ({ initialMessage = false }: ToolsAvailableProps) => {
  const tools = useAppState((state) => state.tools)

  const { getCurrentThread } = useThreads()
  const {
    isToolDisabled,
    setToolDisabledForThread,
    setDefaultDisabledTools,
    initializeThreadTools,
    getDefaultDisabledTools,
  } = useToolAvailable()

  const currentThread = getCurrentThread()

  // Separate effect for thread initialization - only when we have tools and a new thread
  useEffect(() => {
    if (tools.length > 0 && currentThread?.id) {
      initializeThreadTools(currentThread.id, tools)
    }
  }, [currentThread?.id, tools, initializeThreadTools])

  const handleToolToggle = (
    serverName: string,
    toolName: string,
    checked: boolean
  ) => {
    if (initialMessage) {
      // Update default tools for new threads/index page
      const currentDefaults = getDefaultDisabledTools()
      const toolKey = `${serverName}::${toolName}`
      if (checked) {
        setDefaultDisabledTools(
          currentDefaults.filter((key) => key !== toolKey)
        )
      } else {
        setDefaultDisabledTools([...currentDefaults, toolKey])
      }
    } else if (currentThread?.id) {
      // Update tools for specific thread
      setToolDisabledForThread(currentThread.id, serverName, toolName, checked)
    }
  }

  const isToolChecked = (serverName: string, toolName: string): boolean => {
    if (initialMessage) {
      // Use default tools for index page
      const toolKey = `${serverName}::${toolName}`
      return !getDefaultDisabledTools().includes(toolKey)
    } else if (currentThread?.id) {
      // Use thread-specific tools
      return !isToolDisabled(currentThread.id, serverName, toolName)
    }
    return false
  }

  const handleDisableAllServerTools = (
    serverName: string,
    disable: boolean
  ) => {
    const allToolsByServer = getToolsByServer()
    const serverTools = allToolsByServer[serverName] || []
    serverTools.forEach((tool) => {
      handleToolToggle(tool.server, tool.name, !disable)
    })
  }

  const areAllServerToolsEnabled = (serverName: string): boolean => {
    const allToolsByServer = getToolsByServer()
    const serverTools = allToolsByServer[serverName] || []
    return serverTools.every((tool) => isToolChecked(tool.server, tool.name))
  }

  const getToolsByServer = () => {
    const toolsByServer = tools.reduce(
      (acc, tool) => {
        if (!acc[tool.server]) {
          acc[tool.server] = []
        }
        acc[tool.server].push(tool)
        return acc
      },
      {} as Record<string, typeof tools>
    )

    return toolsByServer
  }

  const toolsByServer = getToolsByServer()

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <div className="flex gap-2">
          <IconTool size={18} className="text-main-view-fg/50" />
          <span>Available Tools</span>
        </div>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent sideOffset={4} className="w-40">
          {Object.entries(toolsByServer).map(([serverName, serverTools]) => (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <div className="flex gap-2">
                  <span>{serverName}</span>
                </div>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent sideOffset={4} className="w-60">
                  <DropdownMenuLabel>
                    <div className="w-full flex justify-between items-center">
                      <span>All Tools</span>
                      <Switch
                        checked={areAllServerToolsEnabled(serverName)}
                        onCheckedChange={(checked) =>
                          handleDisableAllServerTools(serverName, !checked)
                        }
                      />
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <div className="max-h-56 overflow-y-auto">
                    {serverTools.map((tool) => {
                      const isChecked = isToolChecked(tool.server, tool.name)
                      return (
                        <DropdownMenuItem
                          onClick={(e) => {
                            handleToolToggle(tool.server, tool.name, !isChecked)
                            e.preventDefault()
                          }}
                          onSelect={(e) => {
                            handleToolToggle(tool.server, tool.name, !isChecked)
                            e.preventDefault()
                          }}
                        >
                          <div className="flex justify-end items-center w-full gap-4">
                            <div className="w-full">
                              <span className="line-clamp-1">{tool.name}</span>
                              {tool.description && (
                                <span
                                  className="text-xs text-main-view-fg/70 mt-1 line-clamp-1"
                                  title={tool.description}
                                >
                                  {tool.description}
                                </span>
                              )}
                            </div>
                            <Switch
                              checked={isChecked}
                              onCheckedChange={(checked) => {
                                console.log('checked', checked)
                                handleToolToggle(
                                  tool.server,
                                  tool.name,
                                  checked
                                )
                              }}
                              onClick={(e) => {
                                e.stopPropagation()
                              }}
                            />
                          </div>
                        </DropdownMenuItem>
                      )
                    })}
                  </div>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  )
}

export default ToolsAvailable
