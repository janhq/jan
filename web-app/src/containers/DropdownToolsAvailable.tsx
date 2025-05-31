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

import React from 'react'

interface DropdownToolsAvailableProps {
  children: (isOpen: boolean, toolsCount: number) => React.ReactNode
  initialMessage?: boolean
}

export default function DropdownToolsAvailable({
  children,
}: DropdownToolsAvailableProps) {
  const [tools, setTools] = useState<MCPTool[]>([])
  const [loading, setLoading] = useState(true)

  const [isOpen, setIsOpen] = useState(false)
  const { getCurrentThread } = useThreads()

  const currentThread = getCurrentThread()
  const threadId = currentThread?.id || '*'

  useEffect(() => {
    const fetchTools = async () => {
      try {
        setLoading(true)
        const availableTools = await getTools()
        setTools(availableTools)
      } catch (error) {
        console.error('Failed to fetch tools:', error)
        setTools([])
      } finally {
        setLoading(false)
      }
    }

    // Always fetch tools, even without a threadId (for index page)
    fetchTools()
  }, [threadId])

  const renderTrigger = () => children(isOpen, tools.length)

  if (loading) {
    return (
      <DropdownMenu onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>{renderTrigger()}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-64">
          <DropdownMenuItem disabled>Loading tools...</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

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

      <DropdownMenuContent align="start" className="max-w-64">
        <DropdownMenuLabel className="flex items-center gap-2">
          Available Tools
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <div className="max-h-64 overflow-y-auto">
          {tools.map((tool) => {
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
                      <Switch checked={true} />
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
