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

import { useThreads } from '@/hooks/useThreads'
import { useToolAvailable } from '@/hooks/useToolAvailable'

import React from 'react'
import { useAppState } from '@/hooks/useAppState'
import { useTranslation } from '@/i18n/react-i18next-compat'

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
  const { tools } = useAppState()
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

  const handleToolToggle = (toolName: string, checked: boolean) => {
    if (initialMessage) {
      // Update default tools for new threads/index page
      const currentDefaults = getDefaultDisabledTools()
      if (checked) {
        setDefaultDisabledTools(
          currentDefaults.filter((name) => name !== toolName)
        )
      } else {
        setDefaultDisabledTools([...currentDefaults, toolName])
      }
    } else if (currentThread?.id) {
      // Update tools for specific thread
      setToolDisabledForThread(currentThread.id, toolName, checked)
    }
  }

  const isToolChecked = (toolName: string): boolean => {
    if (initialMessage) {
      // Use default tools for index page
      return !getDefaultDisabledTools().includes(toolName)
    } else if (currentThread?.id) {
      // Use thread-specific tools
      return !isToolDisabled(currentThread.id, toolName)
    }
    return false
  }

  const getEnabledToolsCount = (): number => {
    const disabledTools = initialMessage
      ? getDefaultDisabledTools()
      : currentThread?.id
        ? getDisabledToolsForThread(currentThread.id)
        : []
    return tools.filter((tool) => !disabledTools.includes(tool.name)).length
  }

  const renderTrigger = () => children(isOpen, getEnabledToolsCount())

  if (tools.length === 0) {
    return (
      <DropdownMenu onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>{renderTrigger()}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-64">
          <DropdownMenuItem disabled>{t('common:noToolsAvailable')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>{renderTrigger()}</DropdownMenuTrigger>

      <DropdownMenuContent
        side="top"
        align="start"
        className="max-w-64 backdrop-blur-xl bg-main-view"
      >
        <DropdownMenuLabel className="flex items-center gap-2 sticky -top-1 z-10 px-4 pl-2 py-2 ">
          Available Tools
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-64 overflow-y-auto">
          {tools.map((tool) => {
            const isChecked = isToolChecked(tool.name)
            return (
              <div
                key={tool.name}
                className="py-2 hover:bg-main-view-fg/5 hover:backdrop-blur-2xl rounded-sm px-2 mx-auto w-full"
              >
                <div className="flex items-start justify-center gap-3">
                  <div className="flex items-start justify-between gap-4 w-full">
                    <div className="overflow-hidden w-full flex flex-col ">
                      <div className="truncate">
                        <span className="text-sm font-medium" title={tool.name}>
                          {tool.name}
                        </span>
                      </div>
                      {tool.description && (
                        <p className="text-xs text-main-view-fg/70 mt-1 line-clamp-2">
                          {tool.description}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 mx-auto">
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
