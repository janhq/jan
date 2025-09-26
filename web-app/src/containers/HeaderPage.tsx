import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'
import { IconLayoutSidebar, IconMessage, IconClock } from '@tabler/icons-react'
import { ReactNode } from '@tanstack/react-router'
import { useRouter } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'

type HeaderPageProps = {
  children?: ReactNode
}
const HeaderPage = ({ children }: HeaderPageProps) => {
  const { open, setLeftPanel } = useLeftPanel()
  const router = useRouter()
  const currentPath = router.state.location.pathname

  const isTemporaryChatPage = currentPath === route.temporaryChat
  const isHomePage = currentPath === route.home

  const handleChatToggle = () => {
    if (isTemporaryChatPage) {
      router.navigate({ to: route.home })
    } else if (isHomePage) {
      router.navigate({ to: route.temporaryChat })
    }
  }

  return (
    <div
      className={cn(
        'h-10 pl-18 text-main-view-fg flex items-center shrink-0 border-b border-main-view-fg/5',
        IS_MACOS && !open ? 'pl-18' : 'pl-4',
        children === undefined && 'border-none'
      )}
    >
      <div className="flex items-center w-full gap-2">
        {!open && (
          <button
            className="size-5 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out data-[state=open]:bg-main-view-fg/10"
            onClick={() => setLeftPanel(!open)}
          >
            <IconLayoutSidebar
              size={18}
              className="text-main-view-fg relative z-20"
            />
          </button>
        )}
        {children}

        {/* Temporary Chat Toggle - Only show on home or temporary chat pages if feature is enabled */}
        {PlatformFeatures[PlatformFeature.TEMPORARY_CHAT] && (isHomePage || isTemporaryChatPage) && (
          <div className="ml-auto">
            <button
              className="size-8 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
              onClick={handleChatToggle}
              title={isTemporaryChatPage ? 'Switch to Regular Chat' : 'Start Temporary Chat'}
            >
              {isTemporaryChatPage ? (
                <IconMessage
                  size={18}
                  className="text-main-view-fg"
                />
              ) : (
                <IconClock
                  size={18}
                  className="text-main-view-fg"
                />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default HeaderPage
