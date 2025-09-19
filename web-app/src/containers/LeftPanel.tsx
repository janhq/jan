import { Link, useRouterState } from '@tanstack/react-router'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'
import {
  IconLayoutSidebar,
  IconDots,
  IconCirclePlusFilled,
  IconSettingsFilled,
  IconStar,
  IconMessageFilled,
  IconAppsFilled,
  IconX,
  IconSearch,
  IconClipboardSmileFilled,
} from '@tabler/icons-react'
import { route } from '@/constants/routes'
import ThreadList from './ThreadList'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import { AuthLoginButton } from '@/containers/auth/AuthLoginButton'
import { UserProfileMenu } from '@/containers/auth/UserProfileMenu'
import { useAuth } from '@/hooks/useAuth'

import { useThreads } from '@/hooks/useThreads'

import { useTranslation } from '@/i18n/react-i18next-compat'
import { useMemo, useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { DownloadManagement } from '@/containers/DownloadManegement'
import { useSmallScreen } from '@/hooks/useMediaQuery'
import { useClickOutside } from '@/hooks/useClickOutside'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { DeleteAllThreadsDialog } from '@/containers/dialogs'

const mainMenus = [
  {
    title: 'common:newChat',
    icon: IconCirclePlusFilled,
    route: route.home,
    isEnabled: true,
  },
  {
    title: 'common:assistants',
    icon: IconClipboardSmileFilled,
    route: route.assistant,
    isEnabled: PlatformFeatures[PlatformFeature.ASSISTANTS],
  },
  {
    title: 'common:hub',
    icon: IconAppsFilled,
    route: route.hub.index,
    isEnabled: PlatformFeatures[PlatformFeature.MODEL_HUB],
  },
  {
    title: 'common:settings',
    icon: IconSettingsFilled,
    route: route.settings.general,
    isEnabled: true,
  },
  {
    title: 'common:authentication',
    icon: null,
    route: null,
    isEnabled: PlatformFeatures[PlatformFeature.AUTHENTICATION],
  },
]

const LeftPanel = () => {
  const open = useLeftPanel((state) => state.open)
  const setLeftPanel = useLeftPanel((state) => state.setLeftPanel)
  const { t } = useTranslation()
  const [searchTerm, setSearchTerm] = useState('')
  const { isAuthenticated } = useAuth()

  const isSmallScreen = useSmallScreen()
  const prevScreenSizeRef = useRef<boolean | null>(null)
  const isInitialMountRef = useRef(true)
  const panelRef = useRef<HTMLElement>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const searchContainerMacRef = useRef<HTMLDivElement>(null)

  // Determine if we're in a resizable context (large screen with panel open)
  const isResizableContext = !isSmallScreen && open

  // Use click outside hook for panel with debugging
  useClickOutside(
    () => {
      if (isSmallScreen && open) {
        setLeftPanel(false)
      }
    },
    null,
    [
      panelRef.current,
      searchContainerRef.current,
      searchContainerMacRef.current,
    ]
  )

  // Auto-collapse panel only when window is resized
  useEffect(() => {
    const handleResize = () => {
      const currentIsSmallScreen = window.innerWidth <= 768

      // Skip on initial mount
      if (isInitialMountRef.current) {
        isInitialMountRef.current = false
        prevScreenSizeRef.current = currentIsSmallScreen
        return
      }

      // Only trigger if the screen size actually changed
      if (
        prevScreenSizeRef.current !== null &&
        prevScreenSizeRef.current !== currentIsSmallScreen
      ) {
        if (currentIsSmallScreen && open) {
          setLeftPanel(false)
        } else if(!open) {
          setLeftPanel(true)
        }
        prevScreenSizeRef.current = currentIsSmallScreen
      }
    }

    // Add resize listener
    window.addEventListener('resize', handleResize)

    // Initialize the previous screen size on mount
    if (isInitialMountRef.current) {
      prevScreenSizeRef.current = window.innerWidth <= 768
      isInitialMountRef.current = false
    }

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [setLeftPanel])

  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })

  const deleteAllThreads = useThreads((state) => state.deleteAllThreads)
  const unstarAllThreads = useThreads((state) => state.unstarAllThreads)
  const getFilteredThreads = useThreads((state) => state.getFilteredThreads)
  const threads = useThreads((state) => state.threads)

  const filteredThreads = useMemo(() => {
    return getFilteredThreads(searchTerm)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getFilteredThreads, searchTerm, threads])

  // Memoize categorized threads based on filteredThreads
  const favoritedThreads = useMemo(() => {
    return filteredThreads.filter((t) => t.isFavorite)
  }, [filteredThreads])

  const unFavoritedThreads = useMemo(() => {
    return filteredThreads.filter((t) => !t.isFavorite)
  }, [filteredThreads])

  // Disable body scroll when panel is open on small screens
  useEffect(() => {
    if (isSmallScreen && open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [isSmallScreen, open])

  const { downloads, localDownloadingModels } = useDownloadStore()

  return (
    <>
      {/* Backdrop overlay for small screens */}
      {isSmallScreen && open && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur z-30"
          onClick={(e) => {
            // Don't close if clicking on search container or if currently searching
            if (
              searchContainerRef.current?.contains(e.target as Node) ||
              searchContainerMacRef.current?.contains(e.target as Node)
            ) {
              return
            }
            setLeftPanel(false)
          }}
        />
      )}
      <aside
        ref={panelRef}
        className={cn(
          'text-left-panel-fg overflow-hidden',
          // Resizable context: full height and width, no margins
          isResizableContext && 'h-full w-full',
          // Small screen context: fixed positioning and styling
          isSmallScreen &&
            'fixed h-[calc(100%-16px)] bg-app z-50 rounded-sm border border-left-panel-fg/10 m-2 px-1 w-48',
          // Default context: original styling
          !isResizableContext &&
            !isSmallScreen &&
            'w-48 shrink-0 rounded-lg m-1.5 mr-0',
          // Visibility controls
          open
            ? 'opacity-100 visibility-visible'
            : 'w-0 absolute -top-100 -left-100 visibility-hidden'
        )}
      >
        <div className="relative h-10">
          <button
            className="absolute top-1/2 right-0 -translate-y-1/2 z-20"
            onClick={() => setLeftPanel(!open)}
          >
            <div className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-left-panel-fg/10 transition-all duration-200 ease-in-out data-[state=open]:bg-left-panel-fg/10">
              <IconLayoutSidebar size={18} className="text-left-panel-fg" />
            </div>
          </button>
          {!IS_MACOS && (
            <div
              ref={searchContainerRef}
              className={cn(
                'relative top-1.5 mb-4 mt-1 z-50',
                isResizableContext
                  ? 'mx-2 w-[calc(100%-48px)]'
                  : 'mx-1 w-[calc(100%-32px)]'
              )}
              data-ignore-outside-clicks
            >
              <IconSearch className="absolute size-4 top-1/2 left-2 -translate-y-1/2 text-left-panel-fg/50" />
              <input
                type="text"
                placeholder={t('common:search')}
                className="w-full pl-7 pr-8 py-1 bg-left-panel-fg/10 rounded-sm text-left-panel-fg focus:outline-none focus:ring-1 focus:ring-left-panel-fg/10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-left-panel-fg/70 hover:text-left-panel-fg"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation() // prevent bubbling
                    setSearchTerm('')
                  }}
                >
                  <IconX size={14} />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col justify-between overflow-hidden mt-0 !h-[calc(100%-42px)]">
          <div
            className={cn(
              'flex flex-col',
              Object.keys(downloads).length > 0 || localDownloadingModels.size > 0
                ? 'h-[calc(100%-200px)]'
                : 'h-[calc(100%-140px)]'
            )}
          >
            {IS_MACOS && (
              <div
                ref={searchContainerMacRef}
                className={cn(
                  'relative mb-4 mt-1',
                  isResizableContext ? 'mx-2' : 'mx-1'
                )}
                data-ignore-outside-clicks
              >
                <IconSearch className="absolute size-4 top-1/2 left-2 -translate-y-1/2 text-left-panel-fg/50" />
                <input
                  type="text"
                  placeholder={t('common:search')}
                  className="w-full pl-7 pr-8 py-1 bg-left-panel-fg/10 rounded-sm text-left-panel-fg focus:outline-none focus:ring-1 focus:ring-left-panel-fg/10"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                {searchTerm && (
                  <button
                    data-ignore-outside-clicks
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-left-panel-fg/70 hover:text-left-panel-fg"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation() // prevent bubbling
                      setSearchTerm('')
                    }}
                  >
                    <IconX size={14} />
                  </button>
                )}
              </div>
            )}
            <div className="flex flex-col w-full overflow-y-auto overflow-x-hidden">
              <div className="h-full w-full overflow-y-auto">
                {favoritedThreads.length > 0 && (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <span className="block text-xs text-left-panel-fg/50 px-1 font-semibold sticky top-0">
                        {t('common:favorites')}
                      </span>
                      <div className="relative">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="size-6 flex cursor-pointer items-center justify-center rounded hover:bg-left-panel-fg/10 transition-all duration-200 ease-in-out data-[state=open]:bg-left-panel-fg/10">
                              <IconDots
                                size={18}
                                className="text-left-panel-fg/60"
                              />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent side="bottom" align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                unstarAllThreads()
                                toast.success(
                                  t('common:toast.allThreadsUnfavorited.title'),
                                  {
                                    id: 'unfav-all-threads',
                                    description: t(
                                      'common:toast.allThreadsUnfavorited.description'
                                    ),
                                  }
                                )
                              }}
                            >
                              <IconStar size={16} />
                              <span>{t('common:unstarAll')}</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <div className="flex flex-col mb-4">
                      <ThreadList
                        threads={favoritedThreads}
                        isFavoriteSection={true}
                      />
                      {favoritedThreads.length === 0 && (
                        <p className="text-xs text-left-panel-fg/50 px-1 font-semibold">
                          {t('chat.status.empty', { ns: 'chat' })}
                        </p>
                      )}
                    </div>
                  </>
                )}

                {unFavoritedThreads.length > 0 && (
                  <div className="flex items-center justify-between mb-2">
                    <span className="block text-xs text-left-panel-fg/50 px-1 font-semibold">
                      {t('common:recents')}
                    </span>
                    <div className="relative">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="size-6 flex cursor-pointer items-center justify-center rounded hover:bg-left-panel-fg/10 transition-all duration-200 ease-in-out data-[state=open]:bg-left-panel-fg/10"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                            }}
                          >
                            <IconDots
                              size={18}
                              className="text-left-panel-fg/60"
                            />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="bottom" align="end">
                          <DeleteAllThreadsDialog onDeleteAll={deleteAllThreads} />
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                )}

                {filteredThreads.length === 0 && searchTerm.length > 0 && (
                  <div className="px-1 mt-2">
                    <div className="flex items-center gap-1 text-left-panel-fg/80">
                      <IconSearch size={18} />
                      <h6 className="font-medium text-base">
                        {t('common:noResultsFound')}
                      </h6>
                    </div>
                    <p className="text-left-panel-fg/60 mt-1 text-xs leading-relaxed">
                      {t('common:noResultsFoundDesc')}
                    </p>
                  </div>
                )}

                {Object.keys(threads).length === 0 && !searchTerm && (
                  <>
                    <div className="px-1 mt-2">
                      <div className="flex items-center gap-1 text-left-panel-fg/80">
                        <IconMessageFilled size={18} />
                        <h6 className="font-medium text-base">
                          {t('common:noThreadsYet')}
                        </h6>
                      </div>
                      <p className="text-left-panel-fg/60 mt-1 text-xs leading-relaxed">
                        {t('common:noThreadsYetDesc')}
                      </p>
                    </div>
                  </>
                )}

                <div className="flex flex-col">
                  <ThreadList threads={unFavoritedThreads} />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-1 shrink-0 py-1 mt-2">
            {mainMenus.map((menu) => {
              if (!menu.isEnabled) {
                return null
              }

              // Handle authentication menu specially
              if (menu.title === 'common:authentication') {
                return (
                  <div key={menu.title}>
                    {isAuthenticated ? (
                      <UserProfileMenu />
                    ) : (
                      <AuthLoginButton />
                    )}
                  </div>
                )
              }

              // Regular menu items must have route and icon
              if (!menu.route || !menu.icon) return null

              const isActive =
                currentPath.includes(route.settings.index) &&
                menu.route.includes(route.settings.index)
              return (
                <Link
                  key={menu.title}
                  to={menu.route}
                  onClick={() => isSmallScreen && setLeftPanel(false)}
                  data-test-id={`menu-${menu.title}`}
                  className={cn(
                    'flex items-center gap-1.5 cursor-pointer hover:bg-left-panel-fg/10 py-1 px-1 rounded',
                    isActive
                      ? 'bg-left-panel-fg/10'
                      : '[&.active]:bg-left-panel-fg/10'
                  )}
                >
                  <menu.icon size={18} className="text-left-panel-fg/70" />
                  <span className="font-medium text-left-panel-fg/90">
                    {t(menu.title)}
                  </span>
                </Link>
              )
            })}
            <DownloadManagement />
          </div>
        </div>
      </aside>
    </>
  )
}

export default LeftPanel
