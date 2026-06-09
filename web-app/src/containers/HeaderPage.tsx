import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'
import { ReactNode, memo } from 'react'

type HeaderPageProps = {
  children?: ReactNode
}
const HeaderPage = memo(function HeaderPage({ children }: HeaderPageProps) {
  const { open } = useLeftPanel()

  return (
    <div
      className={cn(
        'flex h-[var(--app-titlebar-height)] items-center shrink-0',
        IS_MACOS && !open ? 'pl-[var(--app-titlebar-content-start)]' : 'pl-4',
        children === undefined && 'border-none'
      )}
    >
      <div className="flex items-center w-full gap-1">
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  )
})

export default HeaderPage
