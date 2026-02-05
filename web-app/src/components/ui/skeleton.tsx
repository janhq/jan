import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('bg-main-view-fg/10', className)}
      {...props}
    />
  )
}

export { Skeleton }
