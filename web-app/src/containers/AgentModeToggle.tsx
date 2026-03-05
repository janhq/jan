import { memo, useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { IconRobot } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { useAgentMode } from '@/hooks/useAgentMode'
import { isOpenClawRunning } from '@/utils/openclaw'

type AgentModeToggleProps = {
  threadId: string
}

const AgentModeToggle = memo(function AgentModeToggle({
  threadId,
}: AgentModeToggleProps) {
  const [openClawAvailable, setOpenClawAvailable] = useState(false)
  const isAgent = useAgentMode((state) => state.isAgentMode(threadId))
  const toggleAgentMode = useAgentMode((state) => state.toggleAgentMode)

  useEffect(() => {
    isOpenClawRunning().then(setOpenClawAvailable)
  }, [threadId])

  const handleToggle = useCallback(() => {
    toggleAgentMode(threadId)
  }, [threadId, toggleAgentMode])

  if (!openClawAvailable) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'gap-1.5 text-xs font-medium',
            isAgent
              ? 'text-primary bg-primary/10 hover:bg-primary/15'
              : 'text-muted-foreground'
          )}
          onClick={handleToggle}
        >
          <IconRobot size={16} />
          Agent
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>
          {isAgent
            ? 'Agent mode active — messages route through OpenClaw'
            : 'Enable agent mode to use OpenClaw agent'}
        </p>
      </TooltipContent>
    </Tooltip>
  )
})

export default AgentModeToggle
