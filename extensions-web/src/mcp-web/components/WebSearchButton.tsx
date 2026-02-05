import { useMemo, useCallback } from 'react'
import { IconWorld } from '@tabler/icons-react'
import { MCPToolComponentProps } from '@janhq/core'

// List of tool names considered as web search tools
const WEB_SEARCH_TOOL_NAMES = ['google_search', 'scrape'];

export const WebSearchButton = ({
  tools,
  isToolEnabled,
  onToolToggle,
}: MCPToolComponentProps) => {
  const webSearchTools = useMemo(
    () => tools.filter((tool) => WEB_SEARCH_TOOL_NAMES.includes(tool.name)),
    [tools]
  )

  // Early return if no web search tools available
  if (webSearchTools.length === 0) {
    return null
  }

  // Check if all web search tools are enabled
  const isEnabled = useMemo(
    () => webSearchTools.every((tool) => isToolEnabled(tool.name)),
    [webSearchTools, isToolEnabled]
  )

  const handleToggle = useCallback(() => {
    // Toggle all web search tools at once
    const newState = !isEnabled
    webSearchTools.forEach((tool) => {
      onToolToggle(tool.name, newState)
    })
  }, [isEnabled, webSearchTools, onToolToggle])

  return (
    <button
      onClick={handleToggle}
      className={`h-7 px-2 py-1 flex items-center justify-center rounded-md transition-all duration-200 ease-in-out gap-1 cursor-pointer ml-0.5 border-0 ${
        isEnabled
          ? 'bg-accent/20 text-accent'
          : 'bg-transparent text-main-view-fg/70 hover:bg-main-view-fg/5'
      }`}
      title={isEnabled ? 'Disable Web Search' : 'Enable Web Search'}
    >
      <IconWorld
        size={16}
        className={isEnabled ? 'text-accent' : 'text-main-view-fg/70'}
      />
      <span className={`text-sm font-medium ${isEnabled ? 'text-accent' : ''}`}>Search</span>
    </button>
  )
}
