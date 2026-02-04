import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'
<<<<<<< HEAD
import { useMobileScreen, useSmallScreen } from '@/hooks/useMediaQuery'
import {
  IconLayoutSidebar,
  IconMessage,
  IconMessageFilled,
} from '@tabler/icons-react'
import { ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import { TEMPORARY_CHAT_QUERY_ID } from '@/constants/chat'
=======
import {
  IconLayoutSidebar,
} from '@tabler/icons-react'
import { ReactNode } from 'react'
import { Button } from "@/components/ui/button"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

type HeaderPageProps = {
  children?: ReactNode
}
const HeaderPage = ({ children }: HeaderPageProps) => {
  const { open, setLeftPanel } = useLeftPanel()
<<<<<<< HEAD
  const isMobile = useMobileScreen()
  const isSmallScreen = useSmallScreen()
  const router = useRouter()
  const currentPath = router.state.location.pathname

  const isHomePage = currentPath === route.home

  // Parse temporary chat flag from URL search params directly to avoid invariant errors
  const searchString = window.location.search
  const urlSearchParams = new URLSearchParams(searchString)
  const isTemporaryChat =
    isHomePage && urlSearchParams.get(TEMPORARY_CHAT_QUERY_ID) === 'true'

  const handleChatToggle = () => {
    console.log('Chat toggle clicked!', {
      isTemporaryChat,
      isHomePage,
      currentPath,
    })
    if (isHomePage) {
      if (isTemporaryChat) {
        console.log('Switching to regular chat')
        router.navigate({ to: route.home, search: {} })
      } else {
        console.log('Switching to temporary chat')
        router.navigate({
          to: route.home,
          search: { [TEMPORARY_CHAT_QUERY_ID]: true },
        })
      }
    }
  }
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

  return (
    <div
      className={cn(
<<<<<<< HEAD
        'h-10 text-main-view-fg flex items-center shrink-0 border-b border-main-view-fg/5',
        // Mobile-first responsive padding
        isMobile ? 'px-3' : 'px-4',
        // macOS-specific padding when panel is closed
        (IS_MACOS && isSmallScreen) || (IS_MACOS && !open) ? 'pl-20' : '',
=======
        'h-15 flex items-center shrink-0',
        (IS_MACOS && !open) ? 'pl-22' : ' pl-4',
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        children === undefined && 'border-none'
      )}
    >
      <div
        className={cn(
<<<<<<< HEAD
          'flex items-center w-full',
          // Adjust gap based on screen size
          isMobile ? 'gap-2' : 'gap-3'
        )}
      >
        {!open && (
          <button
            className={cn(
              'cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out data-[state=open]:bg-main-view-fg/10',
              // Larger touch target on mobile
              isMobile ? 'size-8 min-w-8' : 'size-5'
            )}
=======
          'flex items-center w-full gap-2',
        )}
      >
        {!open && (
          <Button
            variant="ghost"
            size="icon-sm"
            className='rounded-full'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            onClick={() => setLeftPanel(!open)}
            aria-label="Toggle sidebar"
          >
            <IconLayoutSidebar
<<<<<<< HEAD
              size={18}
              className="text-main-view-fg relative z-20"
            />
          </button>
        )}
        <div
          className={cn(
            'flex-1 min-w-0', // Allow content to shrink on small screens
            isMobile && 'overflow-hidden'
=======
              className="text-muted-foreground relative size-4.5"
            />
          </Button>
        )}
        <div
          className={cn(
            'flex-1 min-w-0'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          )}
        >
          {children}
        </div>
<<<<<<< HEAD

        {/* Temporary Chat Toggle - Only show on home page if feature is enabled */}
        {PlatformFeatures[PlatformFeature.TEMPORARY_CHAT] && isHomePage && (
          <div className="ml-auto">
            <button
              className="size-8 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out relative z-20"
              onClick={handleChatToggle}
              title={
                isTemporaryChat
                  ? 'Switch to Regular Chat'
                  : 'Start Temporary Chat'
              }
            >
              {isTemporaryChat ? (
                <IconMessageFilled size={18} className="text-main-view-fg" />
              ) : (
                <IconMessage size={18} className="text-main-view-fg" />
              )}
            </button>
          </div>
        )}
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      </div>
    </div>
  )
}

export default HeaderPage
