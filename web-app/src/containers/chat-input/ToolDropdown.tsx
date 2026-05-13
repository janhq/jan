import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import DropdownToolsAvailable from '@/containers/DropdownToolsAvailable'
import { IconTool } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

export function ToolDropdown({
  tooltipShown,
  setTooltipShown,
  dropdownToolsAvailable,
  setDropdownToolsAvailable,
  initialMessage,
  toolsLabel,
}: {
  tooltipShown: 'tools' | 'assistants' | false
  setTooltipShown: (state: 'tools' | 'assistants' | false) => void
  dropdownToolsAvailable: boolean
  setDropdownToolsAvailable: (open: boolean) => void
  initialMessage?: boolean
  toolsLabel: string
}) {
  return (
    <Tooltip
      open={tooltipShown === 'tools'}
      onOpenChange={(newValue) =>
        newValue ? setTooltipShown('tools') : setTooltipShown(false)
      }
    >
      <TooltipTrigger asChild disabled={dropdownToolsAvailable}>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            setDropdownToolsAvailable(false)
            e.stopPropagation()
          }}
        >
          <DropdownToolsAvailable
            initialMessage={initialMessage}
            onOpenChange={(isOpen) => {
              setDropdownToolsAvailable(isOpen)
              if (isOpen) setTooltipShown(false)
            }}
          >
            {() => (
              <div
                className={cn(
                  'p-1 flex items-center justify-center rounded-sm transition-all duration-200 ease-in-out gap-1 cursor-pointer'
                )}
              >
                <IconTool size={18} className={cn('text-muted-foreground')} />
              </div>
            )}
          </DropdownToolsAvailable>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{toolsLabel}</p>
      </TooltipContent>
    </Tooltip>
  )
}
