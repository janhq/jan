import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'
import {
  IconLayoutSidebar,
} from '@tabler/icons-react'
import { ReactNode, memo } from 'react'
import { Button } from "@/components/ui/button"
import { DownloadManagement } from '@/containers/DownloadManegement'

type HeaderPageProps = {
  children?: ReactNode
}
const HeaderPage = memo(function HeaderPage({ children }: HeaderPageProps) {
  const { open, setLeftPanel } = useLeftPanel()

  return (
    <div
      className={cn(
        'h-15 flex items-center shrink-0',
        (IS_MACOS && !open) ? 'pl-24' : ' pl-4',
        children === undefined && 'border-none'
      )}
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
