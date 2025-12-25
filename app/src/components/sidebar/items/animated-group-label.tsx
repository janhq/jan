import { SidebarGroupLabel } from '@/components/ui/sidebar'
import { useStaggeredFadeIn } from '@/hooks/useStaggeredFadeIn'

export function AnimatedGroupLabel({
  children,
  index,
}: {
  children: React.ReactNode
  index: number
}) {
  const animation = useStaggeredFadeIn(index)
  return (
    <SidebarGroupLabel
      className={`text-muted-foreground flex w-full items-center justify-between pr-0 ${animation.className}`}
      style={animation.style}
    >
      {children}
    </SidebarGroupLabel>
  )
}
