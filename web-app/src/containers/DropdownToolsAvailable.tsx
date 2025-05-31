import { useEffect, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { getTools } from '@/services/mcp'
import { MCPTool } from '@/types/completion'

import { useThreads } from '@/hooks/useThreads'
import { useToolAvailable } from '@/hooks/useToolAvailable'

import React from 'react'

interface DropdownToolsAvailableProps {
  children: (isOpen: boolean, toolsCount: number) => React.ReactNode
  initialMessage?: boolean
}

export default function DropdownToolsAvailable({
  children,
  initialMessage = false,
}: DropdownToolsAvailableProps) {
  const [tools, setTools] = useState<MCPTool[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const { getCurrentThread } = useThreads()
  const {
    isToolAvailable,
    setToolAvailableForThread,
    setDefaultAvailableTools,
    initializeThreadTools,
    getAvailableToolsForThread,
    getDefaultAvailableTools,
  } = useToolAvailable()

  const currentThread = getCurrentThread()

  useEffect(() => {
    const fetchTools = async () => {
      try {
        const availableTools = await getTools()
        setTools(availableTools)

        // If this is for the initial message (index page) and no defaults are set,
        // initialize with all tools as default
        if (
          initialMessage &&
          getDefaultAvailableTools().length === 0 &&
          availableTools.length > 0
        ) {
          setDefaultAvailableTools(availableTools.map((tool) => tool.name))
        }
      } catch (error) {
        console.error('Failed to fetch tools:', error)
        setTools([])
      }
    }

    // Only fetch tools once when component mounts
    fetchTools()
  }, [initialMessage, setDefaultAvailableTools, getDefaultAvailableTools])

  // Separate effect for thread initialization - only when we have tools and a new thread
  useEffect(() => {
    if (tools.length > 0 && currentThread?.id) {
      initializeThreadTools(currentThread.id, tools)
    }
  }, [currentThread?.id, tools, initializeThreadTools])

  const handleToolToggle = (toolName: string, checked: boolean) => {
    if (initialMessage) {
      // Update default tools for new threads/index page
      const currentDefaults = getDefaultAvailableTools()
      if (checked) {
        if (!currentDefaults.includes(toolName)) {
          setDefaultAvailableTools([...currentDefaults, toolName])
        }
      } else {
        setDefaultAvailableTools(
          currentDefaults.filter((name) => name !== toolName)
        )
      }
    } else if (currentThread?.id) {
      // Update tools for specific thread
      setToolAvailableForThread(currentThread.id, toolName, checked)
    }
  }

  const isToolChecked = (toolName: string): boolean => {
    if (initialMessage) {
      // Use default tools for index page
      return getDefaultAvailableTools().includes(toolName)
    } else if (currentThread?.id) {
      // Use thread-specific tools
      return isToolAvailable(currentThread.id, toolName)
    }
    return false
  }

  const getEnabledToolsCount = (): number => {
    if (initialMessage) {
      return getDefaultAvailableTools().length
    } else if (currentThread?.id) {
      return getAvailableToolsForThread(currentThread.id).length
    }
    return 0
  }

  const renderTrigger = () => children(isOpen, getEnabledToolsCount())

  if (tools.length === 0) {
    return (
      <DropdownMenu onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>{renderTrigger()}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-64">
          <DropdownMenuItem disabled>No tools available</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <DropdownMenu onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>{renderTrigger()}</DropdownMenuTrigger>

      <DropdownMenuContent
        side="top"
        align="start"
        className="max-w-64 max-h-64 "
      >
        <DropdownMenuLabel className="flex items-center gap-2 sticky -top-1 z-10 bg-main-view px-4 pl-2 py-2">
          Available Tools
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div>
          {tools.map((tool) => {
            const isChecked = isToolChecked(tool.name)
            return (
              <div
                key={tool.name}
                className="px-2 py-2 hover:bg-main-view-fg/5 rounded-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h4 className="text-sm font-medium truncate">
                          {tool.name}
                        </h4>
                        {tool.description && (
                          <p className="text-xs text-main-view-fg/70 mt-1 line-clamp-2">
                            {tool.description}
                          </p>
                        )}
                      </div>
                      <Switch
                        checked={isChecked}
                        onCheckedChange={(checked) =>
                          handleToolToggle(tool.name, checked)
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
