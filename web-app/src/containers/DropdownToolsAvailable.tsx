import { useEffect, useState, memo, useMemo } from 'react'

import type { MCPPrompt } from '@janhq/core'
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

import PromptInputDialog from '@/containers/dialogs/PromptInputDialog'
import { Switch } from '@/components/ui/switch'

import type { Attachment } from '@/types/attachment'
import { useThreads } from '@/hooks/useThreads'
import {
  useChatAttachments,
  NEW_THREAD_ATTACHMENT_KEY,
} from '@/hooks/useChatAttachments'
import { useToolAvailable } from '@/hooks/useToolAvailable'

import React from 'react'
import { useAppState } from '@/hooks/useAppState'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'
import { useServiceHub } from '@/hooks/useServiceHub'

interface DropdownToolsAvailableProps {
  children: (isOpen: boolean, toolsCount: number) => React.ReactNode
  onOpenChange?: (isOpen: boolean) => void
}

export default memo(function DropdownToolsAvailable({
  children,
  onOpenChange,
}: DropdownToolsAvailableProps) {
  const allTools = useAppState((state) => state.tools)
  const allPrompts = useAppState((state) => state.mcpPrompts)
  // Filter out Jan Browser MCP tools
  const tools = allTools.filter((tool) => tool.server !== 'Jan Browser MCP')
  const prompts = allPrompts.filter((p) => p.server !== 'Jan Browser MCP')
   const [selectedPrompt, setSelectedPrompt] = useState<MCPPrompt | null>(null)
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)
  const setAttachmentsForThread = useChatAttachments(
    (state) => state.setAttachments
  )
  const serviceHub = useServiceHub()
  const [isOpen, setIsOpen] = useState(false)
  const { t } = useTranslation()

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    onOpenChange?.(open)
  }

  const { isToolDisabled, setToolDisabled, getDisabledTools } =
    useToolAvailable()

  const mimeToExtension = (mimeType?: string, uri?: string): string => {
    if (mimeType) {
      const map: Record<string, string> = {
        'text/plain': 'txt',
        'text/markdown': 'md',
        'text/html': 'html',
        'text/csv': 'csv',
        'application/json': 'json',
        'application/pdf': 'pdf',
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/gif': 'gif',
        'image/svg+xml': 'svg',
        'application/javascript': 'js',
        'text/javascript': 'js',
        'application/typescript': 'ts',
        'text/typescript': 'ts',
        'application/xml': 'xml',
        'text/xml': 'xml',
        'application/zip': 'zip',
      }
      const ext = map[mimeType]
      if (ext) return ext
      // Fallback: last segment after '/'
      const parts = mimeType.split('/')
      if (parts.length === 2 && parts[1]) return parts[1].split('+')[0]
    }
    // Infer from URI
    if (uri) {
      const lastDot = uri.lastIndexOf('.')
      if (lastDot >= 0 && lastDot < uri.length - 1) {
        return uri.slice(lastDot + 1).split(/[?#]/)[0]
      }
    }
    return 'txt'
  }

  const handlePromptSubmit = async (
    prompt: MCPPrompt,
    args: Record<string, string>
  ) => {
    try {
      const result = await serviceHub
        .mcp()
        .getPrompt(prompt.server, prompt.name, args)

      const attachmentsKey = currentThreadId ?? NEW_THREAD_ATTACHMENT_KEY
      const newAttachments: Attachment[] = []

      for (const msg of result.messages) {
        const content = msg.content
        const ext = mimeToExtension(
          'mimeType' in content ? (content as any).mimeType : undefined,
          'uri' in content ? (content as any).uri : undefined,
        )
        const fileName = `${prompt.name}.${ext}`

        if (content.type === 'text') {
          const lineCount = content.text.split('\n').length
          newAttachments.push({
            name: fileName,
            type: 'document',
            fileType: ext,
            mimeType: 'text/plain',
            inlineContent: content.text,
            parseMode: 'inline', // tell the pipeline this is inline content, not a disk file
            processed: true, // processed: true and injectionMode: inline flags content as pre-processed
            // so the pipeline skips file ingestion
            injectionMode: 'inline',
            lineCount,
          })
        } else if (content.type === 'image') {
          newAttachments.push({
            name: fileName,
            type: 'image',
            base64: content.data,
            mimeType: content.mimeType,
            dataUrl: `data:${content.mimeType};base64,${content.data}`,
            size: Math.floor((content.data.length * 3) / 4),
          })
        } else if (content.type === 'resource') {
          const text = content.resource.text || ''
          const lineCount = text.split('\n').length
          newAttachments.push({
            name: fileName,
            type: 'document',
            fileType: ext,
            mimeType: content.resource.mimeType || 'application/octet-stream',
            inlineContent: text,
            parseMode: 'inline',
            processed: true,
            injectionMode: 'inline',
            lineCount,
          })
        } else if (content.type === 'resource_link') {
          newAttachments.push({
            name: fileName,
            type: 'document',
            fileType: ext,
            mimeType: content.mimeType || 'application/octet-stream',
            inlineContent: content.uri,
            parseMode: 'inline',
            processed: true,
            injectionMode: 'inline',
          })
        }
      }

      if (newAttachments.length > 0) {
        setAttachmentsForThread(attachmentsKey, (prev) => [
          ...prev,
          ...newAttachments,
        ])
      }

    } catch (err) {
      console.error('Failed to get prompt: ', err)
    }
  }

  const currentThreadId = useThreads((state) => state.currentThreadId)

  const handleToolToggle = (
    serverName: string,
    toolName: string,
    checked: boolean
  ) => {
    setToolDisabled(serverName, toolName, checked)
  }

  const isToolChecked = (serverName: string, toolName: string): boolean => {
    return !isToolDisabled(serverName, toolName)
  }

  // Build a list of servers with their tools and prompts
  const servers = useMemo(() => {
    const map: Record<string, { tools: typeof tools, prompts: MCPPrompt[] }> = {}
    for (const tool of tools) {
      if (!map[tool.server]) {
        map[tool.server] = { tools: [], prompts: [] }
      }
      map[tool.server].tools.push(tool)
    }
    for (const prompt of prompts) {
      if (!map[prompt.server]) {
        map[prompt.server] = { tools: [], prompts: [] }
      }
      map[prompt.server].prompts.push(prompt)
    }
    return map
  }, [tools, prompts])

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
    const disabledToolKeys = getDisabledTools()
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

  // Show "no featurs available" only if both tools and prompts are empty
  if (tools.length === 0 && prompts.length === 0) {
    return (
      <DropDrawer open={isOpen} onOpenChange={handleOpenChange}>
        <DropDrawerTrigger asChild>{renderTrigger()}</DropDrawerTrigger>
        <DropDrawerContent align="start" className="max-w-64">
          <DropDrawerItem disabled>
            {t('common:noFeaturesAvailable')}
          </DropDrawerItem>
        </DropDrawerContent>
      </DropDrawer>
    )
  }

  return (
    <>
      <DropDrawer open={isOpen} onOpenChange={handleOpenChange}>
        <DropDrawerTrigger asChild>{renderTrigger()}</DropDrawerTrigger>
        <DropDrawerContent
          side="top"
          align="start"
          className="overflow-hidden!"
          onClick={(e) => e.stopPropagation()}
        >
          <DropDrawerLabel className="flex items-center gap-2 sticky -top-1 z-10 px-4 pl-2 py-1">
            Available Connectors
          </DropDrawerLabel>
          <DropDrawerSeparator />
          <div className="max-h-64 overflow-y-auto">
            <DropDrawerGroup>
              {Object.entries(servers).map(([serverName, { tools: serverTools, prompts: serverPrompts }]) => (
                <DropDrawerSub
                  id={`server-${serverName}`}
                  key={serverName}
                >
                  <DropDrawerSubTrigger className="py-2 hover:backdrop-blur-2xl rounded-sm px-2 mx-auto w-full">
                    <div className="flex items-center justify-between w-full">
                      <span className="text-sm">
                        {serverName}
                      </span>
                      {/* Display the number of tools and prompts for each server */}
                      <div className="flex gap-1 items-center mr-1">
                        {serverTools.length > 0 && (
                          <span className="border inline-flex items-center px-1 rounded-sm text-muted-foreground text-xs">
                            {/* Only count tools that are enabled */}
                            {serverTools.filter((tool) => isToolChecked(tool.server, tool.name)).length}{' '}
                            {serverTools.length === 1 ? 'tool' : 'tools'}
                          </span>
                        )}
                        {serverPrompts.length > 0 && (
                          <span className="border inline-flex items-center px-1 rounded-sm text-muted-foreground text-xs">
                            {serverPrompts.length}{' '}
                            {serverPrompts.length === 1 ? 'prompt' : 'prompts'}
                          </span>
                        )}
                      </div>
                    </div>
                  </DropDrawerSubTrigger>
                  <DropDrawerSubContent className="max-w-64 max-h-70 w-full overflow-hidden">
                    <DropDrawerGroup>
                      {/* Tools section */}
                        {serverTools.length > 1 && (
                          <div className="sticky top-0 z-10  border-b px-4 md:px-2 pr-2 py-1.5 flex items-center justify-between">
                            <span className="text-xs font-medium">
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
                      <div className="max-h-56 overflow-y-auto p-1">
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
                                  className="text-sm font-medium truncate block w-full"
                                  title={tool.name}
                                >
                                  {tool.name}
                                </span>

                                {tool.description && (
                                  <p
                                    className="text-xs text-muted-foreground mt-1 line-clamp-1"
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
                      {/* Prompts section */}
                      {serverPrompts.length > 0 && (
                        <>
                          {serverTools.length > 0 && <DropDrawerSeparator />}
                          <div className="border-b md:px-2 pr-2 px-4 py-1.5 sticky top-0 z-10">
                            <span className="font-medium text-xs">
                              {serverPrompts.length === 1 ? 'Prompt' : 'Prompts'}
                            </span>
                          </div>
                          <div className="p-1">
                            {serverPrompts.map((prompt) => (
                              <DropDrawerItem
                                key={prompt.name}
                                className="cursor-pointer first:mt-0 mt-1 py-1.5"
                                onClick={(e) => {
                                  e.preventDefault()
                                  setSelectedPrompt(prompt)
                                  setPromptDialogOpen(true)
                                  setIsOpen(false)
                                  onOpenChange?.(false)
                                }}
                                onSelect={(e) => e.preventDefault()}
                              >
                                <div className="flex flex-col items-start overflow-hidden w-full">
                                  <span
                                    className="block font-medium text-sm truncate w-full"
                                    title={prompt.name}
                                  >
                                    {prompt.name}
                                  </span>
                                  {prompt.description && (
                                    <p
                                      className="line-clamp-1 mt-1 text-muted-foreground text-xs"
                                      title={prompt.description}
                                    >
                                      {prompt.description}
                                    </p>
                                  )}
                                </div>
                              </DropDrawerItem>
                            ))}
                          </div>
                        </>
                      )}
                    </DropDrawerGroup>
                  </DropDrawerSubContent>
                </DropDrawerSub>
              ))}
            </DropDrawerGroup>
          </div>
        </DropDrawerContent>
      </DropDrawer>

      <PromptInputDialog
        prompt={selectedPrompt}
        open={promptDialogOpen}
        onOpenChange={(open) => {
          setPromptDialogOpen(open)
          if (!open) {
            setSelectedPrompt(null)
            // Also close the main flyout when the prompt dialog closes
            handleOpenChange(false)
          }
        }}
        onSubmit={handlePromptSubmit}
      />
    </>
  )
})
