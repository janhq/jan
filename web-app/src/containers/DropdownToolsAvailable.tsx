import { useEffect, useState } from 'react'

import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerItem,
  DropDrawerSub,
  DropDrawerLabel,
  DropDrawerSubContent,
  DropDrawerSeparator,
  DropDrawerSubTrigger,
  DropDrawerTrigger,
  DropDrawerGroup,
} from '@/components/ui/dropdrawer'

import { Switch } from '@/components/ui/switch'

import { useThreads } from '@/hooks/useThreads'
import { useToolAvailable } from '@/hooks/useToolAvailable'

import React from 'react'
import { useAppState } from '@/hooks/useAppState'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'

interface DropdownToolsAvailableProps {
  children: (isOpen: boolean, toolsCount: number) => React.ReactNode
  initialMessage?: boolean
  onOpenChange?: (isOpen: boolean) => void
}

export default function DropdownToolsAvailable({
  children,
  initialMessage = false,
  onOpenChange,
}: DropdownToolsAvailableProps) {
  const allTools = useAppState((state) => state.tools)
  // Filter out Jan Browser MCP tools
  const tools = allTools.filter((tool) => tool.server !== 'Jan Browser MCP')
  const [isOpen, setIsOpen] = useState(false)
  const { t } = useTranslation()

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    onOpenChange?.(open)
  }
  const { getCurrentThread } = useThreads()
  const {
    isToolDisabled,
    setToolDisabledForThread,
    setDefaultDisabledTools,
    initializeThreadTools,
    getDisabledToolsForThread,
    getDefaultDisabledTools,
  } = useToolAvailable()

  const currentThread = getCurrentThread()

  // Separate effect for thread initialization - only when we have tools and a new thread
  useEffect(() => {
    if (tools.length > 0 && currentThread?.id) {
      initializeThreadTools(currentThread.id, tools)
    }
  }, [currentThread?.id, tools, initializeThreadTools])

  const handleToolToggle = (serverName: string, toolName: string, checked: boolean) => {
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

  const getEnabledToolsCount = (): number => {
    const disabledToolKeys = initialMessage
      ? getDefaultDisabledTools()
      : currentThread?.id
        ? getDisabledToolsForThread(currentThread.id)
        : []
    return tools.filter((tool) => {
      const toolKey = `${tool.server}::${tool.name}`
      return !disabledToolKeys.includes(toolKey)
    }).length
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

  const renderTrigger = () => children(isOpen, getEnabledToolsCount())

  if (tools.length === 0) {
    return (
      <DropDrawer onOpenChange={handleOpenChange}>
        <DropDrawerTrigger asChild>{renderTrigger()}</DropDrawerTrigger>
        <DropDrawerContent align="start" className="max-w-64">
          <DropDrawerItem disabled>
            {t('common:noToolsAvailable')}
          </DropDrawerItem>
        </DropDrawerContent>
      </DropDrawer>
    )
  }

  const toolsByServer = getToolsByServer()

  return (
    <DropDrawer onOpenChange={handleOpenChange}>
      <DropDrawerTrigger asChild>{renderTrigger()}</DropDrawerTrigger>
      <DropDrawerContent
        side="top"
        align="start"
<<<<<<< HEAD
        className="bg-main-view !overflow-hidden"
=======
        className="overflow-hidden!"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        onClick={(e) => e.stopPropagation()}
      >
        <DropDrawerLabel className="flex items-center gap-2 sticky -top-1 z-10 px-4 pl-2 py-1">
          Available Tools
        </DropDrawerLabel>
        <DropDrawerSeparator />
        <div className="max-h-64 overflow-y-auto">
          <DropDrawerGroup>
            {Object.entries(toolsByServer).map(([serverName, serverTools]) => (
              <DropDrawerSub
                id={`server-${serverName}`}
                key={serverName}
<<<<<<< HEAD
                title={serverName}
              >
                <DropDrawerSubTrigger className="py-2 hover:bg-main-view-fg/5 hover:backdrop-blur-2xl rounded-sm px-2 mx-auto w-full">
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm text-main-view-fg/80">
                      {serverName}
                    </span>
                    <span className="text-xs text-main-view-fg/50 inline-flex items-center mr-1 border border-main-view-fg/20 px-1 rounded-sm">
=======
              >
                <DropDrawerSubTrigger className="py-2 hover:backdrop-blur-2xl rounded-sm px-2 mx-auto w-full">
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm">
                      {serverName}
                    </span>
                    <span className="text-xs text-muted-foreground inline-flex items-center mr-1 border px-1 rounded-sm">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                      {
                        serverTools.filter((tool) => isToolChecked(tool.server, tool.name))
                          .length
                      }
                    </span>
                  </div>
                </DropDrawerSubTrigger>
                <DropDrawerSubContent className="max-w-64 max-h-70 w-full overflow-hidden">
                  <DropDrawerGroup>
                    {serverTools.length > 1 && (
<<<<<<< HEAD
                      <div className="sticky top-0 z-10 bg-main-view border-b border-main-view-fg/10 px-4 md:px-2 pr-2 py-1.5 flex items-center justify-between">
                        <span className="text-xs font-medium text-main-view-fg/70">
=======
                      <div className="sticky top-0 z-10  border-b px-4 md:px-2 pr-2 py-1.5 flex items-center justify-between">
                        <span className="text-xs font-medium">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                          All Tools
                        </span>
                        <div
                          className={cn(
                            'flex items-center gap-2',
                            serverTools.length > 5
                              ? 'mr-3 md:mr-1.5'
                              : 'mr-2 md:mr-0'
                          )}
                        >
                          <Switch
                            checked={areAllServerToolsEnabled(serverName)}
                            onCheckedChange={(checked) =>
                              handleDisableAllServerTools(serverName, !checked)
                            }
                          />
                        </div>
                      </div>
                    )}
<<<<<<< HEAD
                    <div className="max-h-56 overflow-y-auto">
=======
                    <div className="max-h-56 overflow-y-auto p-1">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                      {serverTools.map((tool) => {
                        const isChecked = isToolChecked(tool.server, tool.name)
                        return (
                          <DropDrawerItem
                            onClick={(e) => {
                              handleToolToggle(tool.server, tool.name, !isChecked)
                              e.preventDefault()
                            }}
                            onSelect={(e) => {
                              handleToolToggle(tool.server, tool.name, !isChecked)
                              e.preventDefault()
                            }}
                            key={`${tool.server}::${tool.name}`}
                            className="mt-1 first:mt-0 py-1.5"
                            icon={
                              <Switch
                                checked={isChecked}
                                onCheckedChange={(checked) => {
                                  console.log('checked', checked)
                                  handleToolToggle(tool.server, tool.name, checked)
                                }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                }}
                              />
                            }
                          >
                            <div className="overflow-hidden flex flex-col items-start w-full">
                              <span
<<<<<<< HEAD
                                className="text-sm font-medium text-main-view-fg truncate block w-full"
=======
                                className="text-sm font-medium truncate block w-full"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                                title={tool.name}
                              >
                                {tool.name}
                              </span>

                              {tool.description && (
                                <p
<<<<<<< HEAD
                                  className="text-xs text-main-view-fg/70 mt-1 line-clamp-1"
=======
                                  className="text-xs text-muted-foreground mt-1 line-clamp-1"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                                  title={tool.description}
                                >
                                  {tool.description}
                                </p>
                              )}
                            </div>
                          </DropDrawerItem>
                        )
                      })}
                    </div>
                  </DropDrawerGroup>
                </DropDrawerSubContent>
              </DropDrawerSub>
            ))}
          </DropDrawerGroup>
        </div>
      </DropDrawerContent>
    </DropDrawer>
  )
}
