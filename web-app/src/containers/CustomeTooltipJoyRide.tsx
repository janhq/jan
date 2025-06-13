import { TooltipRenderProps } from 'react-joyride'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function CustomTooltipJoyRide(props: TooltipRenderProps) {
  const {
    backProps,
    closeProps,
    continuous,
    index,
    primaryProps,
    skipProps,
    step,
    tooltipProps,
  } = props

  return (
    <div
      className="bg-main-view p-4 rounded-xl max-w-[400px] text-main-view-fg relative select-none"
      {...tooltipProps}
    >
      {!step.hideCloseButton && (
        <div className="absolute size-4 top-1 right-2 cursor-pointer">
          <button className="text-right" {...closeProps}>
            &times;
          </button>
        </div>
      )}
      {step.title && <h4 className="text-base mb-2">{step.title}</h4>}
      <div className="text-sm text-main-view-fg/70 leading-relaxed">
        {step.content}
      </div>
      <div
        className={cn(
          'flex items-center justify-end mt-2',
          step.showSkipButton && 'justify-between'
        )}
      >
        {step.showSkipButton && (
          <Button
            variant="link"
            className="px-0 text-main-view-fg/70"
            {...skipProps}
          >
            {skipProps.title}
          </Button>
        )}
        <div className={cn('flex items-center justify-between gap-4')}>
          {index > 0 && (
            <Button
              variant="link"
              className="px-0 text-main-view-fg/70"
              {...backProps}
            >
              {backProps.title}
            </Button>
          )}
          {continuous && (
            <Button size="sm" {...primaryProps}>
              {primaryProps.title}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
