'use client'

import {
  useAgentMode,
  type AgentType,
} from '@/hooks/useAgentMode'
import { useAgentWorkingDirectory } from '@/hooks/useAgentWorkingDirectory'
import { cn } from '@/lib/utils'
import { isPlatformTauri } from '@/lib/platform/utils'
import { useCallback, useState } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import {
  IconRobot,
  IconFolder,
  IconCheck,
  IconCode,
  IconFileSearch,
  IconListCheck,
  IconBox,
  IconTerminal,
  IconX,
} from '@tabler/icons-react'
import { useServiceHub } from '@/hooks/useServiceHub'

interface AgentModeToggleProps {
  className?: string
  disabled?: boolean
}

const agentOptions: {
  value: AgentType
  label: string
  description: string
  icon: React.ReactNode
}[] = [
  {
    value: 'build',
    label: 'Build',
    description: 'Full coding capabilities',
    icon: <IconCode size={16} />,
  },
  {
    value: 'plan',
    label: 'Plan',
    description: 'Read-only planning',
    icon: <IconListCheck size={16} />,
  },
  {
    value: 'explore',
    label: 'Explore',
    description: 'Search & explore code',
    icon: <IconFileSearch size={16} />,
  },
]

export function AgentModeToggle({
  className = '',
  disabled = false,
}: AgentModeToggleProps) {
  const currentAgent = useAgentMode((s) => s.currentAgent)
  const projectPath = useAgentMode((s) => s.projectPath)
  const workingDirectoryMode = useAgentMode((s) => s.workingDirectoryMode)
  const setCurrentAgent = useAgentMode((s) => s.setCurrentAgent)
  const setProjectPath = useAgentMode((s) => s.setProjectPath)
  const setWorkingDirectoryMode = useAgentMode((s) => s.setWorkingDirectoryMode)
  const clearProjectPath = useAgentMode((s) => s.clearProjectPath)

  const { getDataDirectory, getCurrentDirectory } = useAgentWorkingDirectory()
  const serviceHub = useServiceHub()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [tooltipOpen, setTooltipOpen] = useState(false)

  const handleSelectProject = useCallback(async (): Promise<string | null> => {
    if (isPlatformTauri()) {
      try {
        const dialogService = serviceHub.dialog()
        const selected = await dialogService.open({
          directory: true,
          multiple: false,
        })
        if (selected && typeof selected === 'string') {
          setProjectPath(selected)
          return selected
        }
      } catch (e) {
        console.error('Failed to open folder dialog:', e)
      }
    }
    return null
  }, [setProjectPath, serviceHub])

  const handleUseCurrentDir = useCallback(async () => {
    const dir = await getCurrentDirectory()
    if (dir) {
      setWorkingDirectoryMode('current')
    }
  }, [setWorkingDirectoryMode, getCurrentDirectory])

  const handleUseWorkspace = useCallback(async () => {
    const dir = await getDataDirectory()
    if (dir) {
      setWorkingDirectoryMode('workspace')
    }
  }, [setWorkingDirectoryMode, getDataDirectory])

  const handleClear = useCallback(() => {
    clearProjectPath()
  }, [clearProjectPath])

  const currentAgentOption = agentOptions.find((o) => o.value === currentAgent)
  const isAgentEnabled = projectPath !== null || workingDirectoryMode !== 'custom'

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {/* Agent Mode Toggle Button - Simplified to project selector */}
      <TooltipProvider>
        <Tooltip open={tooltipOpen && !dropdownOpen} onOpenChange={setTooltipOpen}>
          <TooltipTrigger asChild disabled={dropdownOpen}>
            <div
              onClick={(e) => {
                e.stopPropagation()
                setDropdownOpen(false)
              }}
            >
              <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                <DropdownMenuTrigger asChild disabled={disabled}>
                  <div
                    className={cn(
                      'h-7 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1 cursor-pointer',
                      dropdownOpen && 'bg-main-view-fg/10',
                      isAgentEnabled && 'bg-primary/10'
                    )}
                  >
                    <IconRobot
                      size={18}
                      className={cn(
                        'text-main-view-fg/50',
                        isAgentEnabled && 'text-primary'
                      )}
                    />
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Working Directory
                  </DropdownMenuLabel>

                  {/* Custom project folder */}
                  <DropdownMenuItem
                    onClick={handleSelectProject}
                    className="flex items-center gap-2"
                  >
                    <IconFolder size={16} className="text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs truncate">
                        {workingDirectoryMode === 'custom'
                          ? projectPath || 'Select project folder...'
                          : 'Custom project folder...'}
                      </span>
                    </div>
                    {workingDirectoryMode === 'custom' && (
                      <IconCheck size={14} className="text-primary" />
                    )}
                  </DropdownMenuItem>

                  {/* Use current directory */}
                  <DropdownMenuItem
                    onClick={handleUseCurrentDir}
                    className="flex items-center gap-2"
                    disabled={!isPlatformTauri()}
                  >
                    <IconTerminal size={16} className="text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs">Current Directory</span>
                      <p className="text-[10px] text-muted-foreground truncate">
                        Where Jan is running
                      </p>
                    </div>
                    {workingDirectoryMode === 'current' && (
                      <IconCheck size={14} className="text-primary" />
                    )}
                  </DropdownMenuItem>

                  {/* Use Jan workspace */}
                  <DropdownMenuItem
                    onClick={handleUseWorkspace}
                    className="flex items-center gap-2"
                    disabled={!isPlatformTauri()}
                  >
                    <IconBox size={16} className="text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs">Jan Workspace</span>
                      <p className="text-[10px] text-muted-foreground truncate">
                        Jan data directory
                      </p>
                    </div>
                    {workingDirectoryMode === 'workspace' && (
                      <IconCheck size={14} className="text-primary" />
                    )}
                  </DropdownMenuItem>

                  {/* Clear selection */}
                  {isAgentEnabled && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={handleClear}
                        className="flex items-center gap-2 text-destructive"
                      >
                        <IconX size={16} />
                        <span className="text-xs">Disable Agent</span>
                      </DropdownMenuItem>
                    </>
                  )}

                  {isAgentEnabled && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        Default Agent
                      </DropdownMenuLabel>
                      {agentOptions.map((opt) => (
                        <DropdownMenuItem
                          key={opt.value}
                          onClick={() => setCurrentAgent(opt.value)}
                          className="flex items-center gap-2"
                        >
                          <span className="text-muted-foreground">{opt.icon}</span>
                          <div className="flex-1">
                            <div className="font-medium">{opt.label}</div>
                            <div className="text-xs text-muted-foreground">
                              {opt.description}
                            </div>
                          </div>
                          {currentAgent === opt.value && (
                            <IconCheck size={16} className="text-primary" />
                          )}
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {isAgentEnabled
                ? `Agent: ${currentAgentOption?.label || 'Build'}`
                : 'Select a working directory to enable agent'}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

export default AgentModeToggle