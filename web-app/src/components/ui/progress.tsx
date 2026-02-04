import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'

import { cn } from '@/lib/utils'

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
<<<<<<< HEAD
        'bg-accent/30 relative h-2 w-full overflow-hidden rounded-full',
=======
        'bg-secondary relative h-2 w-full overflow-hidden rounded-full',
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
<<<<<<< HEAD
        className="bg-accent h-full w-full flex-1 transition-all"
=======
        className="bg-primary h-full w-full flex-1 transition-all"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
