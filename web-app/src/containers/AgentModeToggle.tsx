'use client'

import { useAgentMode, type AgentType, type AgentExecutionMode } from '@/hooks/useAgentMode'
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
  IconBrain,
  IconHandStop,
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

const executionModeOptions: {
  value: AgentExecutionMode
  label: string
  description: string
  icon: React.ReactNode
}[] = [
  {
    value: 'manual',
    label: 'Manual',
    description: 'Manually trigger OpenCode for coding tasks',
    icon: <IconHandStop size={16} />,
  },
  {
    value: 'orchestrator',
    label: 'Orchestrator',
    description: 'Auto-detect and delegate coding tasks',
    icon: <IconBrain size={16} />,
  },
]

export function AgentModeToggle({
  className = '',
  disabled = false,
}: AgentModeToggleProps) {
  const isAgentMode = useAgentMode((s) => s.isAgentMode)
  const currentAgent = useAgentMode((s) => s.currentAgent)
  const projectPath = useAgentMode((s) => s.projectPath)
  const executionMode = useAgentMode((s) => s.executionMode)
  const toggleAgentMode = useAgentMode((s) => s.toggleAgentMode)
  const setCurrentAgent = useAgentMode((s) => s.setCurrentAgent)
  const setProjectPath = useAgentMode((s) => s.setProjectPath)
  const setExecutionMode = useAgentMode((s) => s.setExecutionMode)

  const serviceHub = useServiceHub()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [tooltipOpen, setTooltipOpen] = useState(false)

  const handleSelectProject = useCallback(async (): Promise<string | null> => {
    if (isPlatformTauri()) {
      try {
        // Use service hub's dialog service to select a folder
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

  const handleToggle = useCallback(async () => {
    if (!isAgentMode && !projectPath && isPlatformTauri()) {
      // If enabling agent mode without a project, prompt to select one first
      const selectedPath = await handleSelectProject()
      // Only enable agent mode if a project was selected
      if (selectedPath) {
        toggleAgentMode()
      }
    } else {
      toggleAgentMode()
    }
  }, [isAgentMode, projectPath, toggleAgentMode, handleSelectProject])

  const currentAgentOption = agentOptions.find((o) => o.value === currentAgent)

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {/* Agent Mode Toggle Button */}
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
                      isAgentMode && 'bg-primary/10'
                    )}
                  >
                    <IconRobot
                      size={18}
                      className={cn(
                        'text-main-view-fg/50',
                        isAgentMode && 'text-primary'
                      )}
                    />
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Agent Mode
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={handleToggle}
                    className="flex items-center justify-between"
                  >
                    <span>{isAgentMode ? 'Disable Agent Mode' : 'Enable Agent Mode'}</span>
                    {isAgentMode && <IconCheck size={16} className="text-primary" />}
                  </DropdownMenuItem>

                  {isAgentMode && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        Execution Mode
                      </DropdownMenuLabel>
                      {executionModeOptions.map((opt) => (
                        <DropdownMenuItem
                          key={opt.value}
                          onClick={() => setExecutionMode(opt.value)}
                          className="flex items-center gap-2"
                        >
                          <span className={cn(
                            "text-muted-foreground",
                            executionMode === opt.value && opt.value === 'orchestrator' && "text-purple-500"
                          )}>{opt.icon}</span>
                          <div className="flex-1">
                            <div className="font-medium">{opt.label}</div>
                            <div className="text-xs text-muted-foreground">
                              {opt.description}
                            </div>
                          </div>
                          {executionMode === opt.value && (
                            <IconCheck size={16} className="text-primary" />
                          )}
                        </DropdownMenuItem>
                      ))}

                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        {executionMode === 'orchestrator' ? 'Default Agent' : 'Agent Type'}
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

                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        Project
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={handleSelectProject}
                        className="flex items-center gap-2"
                      >
                        <IconFolder size={16} className="text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          {projectPath ? (
                            <div className="truncate text-xs">{projectPath}</div>
                          ) : (
                            <span>Select project folder...</span>
                          )}
                        </div>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {isAgentMode
                ? `Agent Mode: ${executionMode === 'orchestrator' ? 'Orchestrator' : currentAgentOption?.label || 'Build'}`
                : 'Agent Mode (coding tasks)'}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

export default AgentModeToggle
