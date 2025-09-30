import { useMemo, useCallback } from 'react'
import { IconWorld } from '@tabler/icons-react'
import { MCPToolComponentProps } from '@janhq/core'

export const WebSearchButton = ({
  tools,
  isToolEnabled,
  onToolToggle,
}: MCPToolComponentProps) => {
  const webSearchTools = useMemo(
    () => tools.filter((tool) => tool.name === 'google_search' || tool.name === 'scrape'),
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
      className={`h-7 px-2 py-1 flex items-center justify-center rounded-md transition-all duration-200 ease-in-out gap-1 cursor-pointer ml-0.5 ${
        isEnabled
          ? 'bg-primary text-primary-fg hover:bg-primary/90'
          : 'bg-transparent text-main-view-fg/70 hover:bg-main-view-fg/5'
      }`}
      title={isEnabled ? 'Disable Web Search' : 'Enable Web Search'}
    >
      <IconWorld
        size={16}
        className={isEnabled ? 'text-primary-fg' : 'text-main-view-fg/70'}
      />
      <span className={`text-sm font-medium ${isEnabled ? 'text-primary-fg' : ''}`}>Search</span>
    </button>
  )
}