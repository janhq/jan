import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'
import {
  IconLayoutSidebar,
} from '@tabler/icons-react'
import { ReactNode, memo } from 'react'
import { Button } from "@/components/ui/button"
import { DownloadManagement } from '@/containers/DownloadManegement'
import { useTitlebarLayout } from '@/stores/titlebar-layout-store'

type HeaderPageProps = {
  children?: ReactNode
}
const HeaderPage = memo(function HeaderPage({ children }: HeaderPageProps) {
  const { open, setLeftPanel } = useLeftPanel()
  // Collapsed, this header owns the top-left strip — indent past left-anchored Linux
  // window controls (size-8 each at left-4); macOS uses the pl-24 class below.
  const leftButtons = useTitlebarLayout((s) => s.layout.left.length)
  const linuxControlsPad =
    !IS_MACOS && !open && leftButtons > 0 ? leftButtons * 32 + 24 : undefined

  return (
    <div
      className={cn(
        'h-15 flex items-center shrink-0',
        (IS_MACOS && !open) ? 'pl-24' : ' pl-4',
        children === undefined && 'border-none'
      )}
      style={linuxControlsPad ? { paddingLeft: linuxControlsPad } : undefined}
    >
      <div
        className={cn(
          'flex items-center w-full gap-1',
        )}
      >
        {!open && (
          <>
            <DownloadManagement />
            <Button
              variant="ghost"
              size="icon-sm"
              className='rounded-full relative z-50'
              onClick={() => setLeftPanel(!open)}
              aria-label="Toggle sidebar"
            >
              <IconLayoutSidebar
                className="text-muted-foreground relative size-4.5"
              />
            </Button>
          </>
        )}
        <div
          className={cn(
            'flex-1 min-w-0'
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
})

export default HeaderPage
