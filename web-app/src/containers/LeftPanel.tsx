import { Link, useRouterState, useNavigate } from '@tanstack/react-router'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { useThreadSelection } from '@/hooks/useThreadSelection'
import { cn } from '@/lib/utils'
import {
  IconLayoutSidebar,
  IconDots,
  IconCirclePlus,
  IconSettings,
  IconStar,
  IconFolderPlus,
  IconMessage,
  IconApps,
  IconX,
  IconSearch,
  IconPencil,
  IconTrash,
  IconChecklist,
} from '@tabler/icons-react'
import { route } from '@/constants/routes'
import ThreadList from './ThreadList'
import { BulkThreadActionsToolbar } from './BulkThreadActionsToolbar'
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
import { useThreadManagement } from '@/hooks/useThreadManagement'

import { useTranslation } from '@/i18n/react-i18next-compat'
import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { DownloadManagement } from '@/containers/DownloadManegement'
import { useSmallScreen } from '@/hooks/useMediaQuery'
import { useClickOutside } from '@/hooks/useClickOutside'

import { DeleteAllThreadsDialog } from '@/containers/dialogs'
import AddProjectDialog from '@/containers/dialogs/AddProjectDialog'
import { DeleteProjectDialog } from '@/containers/dialogs/DeleteProjectDialog'
import { Button } from '@/components/ui/button'
import { ProjectIcon } from '@/components/ProjectIcon'

const mainMenus = [
  {
    title: 'common:newChat',
    icon: IconCirclePlus,
    route: route.home,
    isEnabled: true,
  },
  {
    title: 'common:projects.title',
    icon: IconFolderPlus,
    route: route.project,
    isEnabled:
      PlatformFeatures[PlatformFeature.PROJECTS] && !(IS_IOS || IS_ANDROID),
  },
]

const secondaryMenus = [
  {
    title: 'common:hub',
    icon: IconApps,
    route: route.hub.index,
    isEnabled: PlatformFeatures[PlatformFeature.MODEL_HUB],
  },
  {
    title: 'common:settings',
    icon: IconSettings,
    route: route.settings.general,
    isEnabled: true,
  },
]

const LeftPanel = () => {
  const open = useLeftPanel((state) => state.open)
  const setLeftPanel = useLeftPanel((state) => state.setLeftPanel)
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')
  const { isAuthenticated } = useAuth()
  const projectsEnabled = PlatformFeatures[PlatformFeature.PROJECTS]

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
        } else if (!open) {
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
  }, [setLeftPanel, open])

  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })

  const deleteAllThreads = useThreads((state) => state.deleteAllThreads)
  const unstarAllThreads = useThreads((state) => state.unstarAllThreads)
  const getFilteredThreads = useThreads((state) => state.getFilteredThreads)
  const threads = useThreads((state) => state.threads)
  const {
    isSelectionMode,
    toggleSelectionMode,
    clearSelection,
    selectAll,
    getSelectedCount,
  } = useThreadSelection()

  const { folders, addFolder, updateFolder, getFolderById } =
    useThreadManagement()

  const filteredThreads = useMemo(() => {
    return getFilteredThreads(searchTerm)
  }, [getFilteredThreads, searchTerm, threads])

  const handleToggleSelectionMode = useCallback(() => {
    toggleSelectionMode()
    if (!isSelectionMode) {
      toast.info(
        t('common:multiSelectMode.enabled', {
          defaultValue: 'Multi-select mode enabled',
        })
      )
    } else {
      clearSelection()
    }
  }, [isSelectionMode, toggleSelectionMode, clearSelection, t])

  const handleSelectAll = useCallback(() => {
    const allThreadIds = filteredThreads.map((t) => t.id)
    selectAll(allThreadIds)
    toast.success(
      t('common:multiSelectMode.allSelected', {
        count: allThreadIds.length,
        defaultValue: `Selected ${allThreadIds.length} threads`,
      })
    )
  }, [filteredThreads, selectAll, t])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'm' && isSelectionMode) {
        e.preventDefault()
        handleSelectAll()
      }
      if (e.key === 'Escape' && isSelectionMode) {
        e.preventDefault()
        toggleSelectionMode()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isSelectionMode, handleSelectAll, toggleSelectionMode])

  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [editingProjectKey, setEditingProjectKey] = useState<string | null>(
    null
  )
  const [deleteProjectConfirmOpen, setDeleteProjectConfirmOpen] =
    useState(false)
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(
    null
  )

  const filteredProjects = useMemo(() => {
    if (!searchTerm) return folders
    return folders.filter((folder) =>
      folder.name.toLowerCase().includes(searchTerm.toLowerCase())
    )
  }, [folders, searchTerm])

  // Memoize categorized threads based on filteredThreads
  const favoritedThreads = useMemo(() => {
    return filteredThreads.filter((t) => t.isFavorite)
  }, [filteredThreads])

  const unFavoritedThreads = useMemo(() => {
    return filteredThreads.filter((t) => !t.isFavorite && !t.metadata?.project)
  }, [filteredThreads])

  // Project handlers
  const handleProjectDelete = (id: string) => {
    setDeletingProjectId(id)
    setDeleteProjectConfirmOpen(true)
  }

  const handleProjectDeleteClose = () => {
    setDeleteProjectConfirmOpen(false)
    setDeletingProjectId(null)
  }

  const handleProjectSave = async (name: string) => {
    if (editingProjectKey) {
      await updateFolder(editingProjectKey, name)
    } else {
      const newProject = await addFolder(name)
      // Navigate to the newly created project
      navigate({
        to: '/project/$projectId',
        params: { projectId: newProject.id },
      })
    }
    setProjectDialogOpen(false)
    setEditingProjectKey(null)
  }

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

  return (
    <>
      {/* Backdrop overlay for small screens */}
      {isSmallScreen && open && !IS_IOS && !IS_ANDROID && (
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
            'fixed h-full pb-[calc(env(safe-area-inset-bottom)+env(safe-area-inset-top))] bg-main-view z-50 md:border border-left-panel-fg/10 px-1 w-full md:w-48',
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
            className={cn(
              'absolute top-1/2 -translate-y-1/2 z-20 right-0',
              (IS_MACOS && isSmallScreen) || (IS_MACOS && !open)
                ? 'pl-20 right-auto'
                : ''
            )}
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

        <div className="flex flex-col gap-y-1 overflow-hidden mt-0 h-[calc(100%-42px)]!">
          <div className="space-y-1 py-1">
            {IS_MACOS && (
              <div
                ref={searchContainerMacRef}
                className={cn('relative mb-2 mt-1 mx-1')}
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

            {mainMenus.map((menu) => {
              if (!menu.isEnabled) {
                return null
              }

              // Handle authentication menu specially
              if (menu.title === 'common:authentication') {
                return (
                  <div key={menu.title}>
                    <div className="mx-1 my-2 border-t border-left-panel-fg/5" />
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

              const isActive = (() => {
                // Settings routes
                if (menu.route.includes(route.settings.index)) {
                  return currentPath.includes(route.settings.index)
                }

                // Default exact match for other routes
                return currentPath === menu.route
              })()
              return (
                <Link
                  key={menu.title}
                  to={menu.route}
                  onClick={() => isSmallScreen && setLeftPanel(false)}
                  data-test-id={`menu-${menu.title}`}
                  activeOptions={{ exact: true }}
                  className={cn(
                    'flex items-center gap-1.5 cursor-pointer hover:bg-left-panel-fg/10 py-1 px-1 rounded',
                    isActive && 'bg-left-panel-fg/10'
                  )}
                >
                  <menu.icon size={18} className="text-left-panel-fg/70" />
                  <span className="font-medium text-left-panel-fg/90">
                    {t(menu.title)}
                  </span>
                </Link>
              )
            })}
          </div>

          {projectsEnabled &&
            filteredProjects.length > 0 &&
            !(IS_IOS || IS_ANDROID) && (
              <div className="space-y-1 py-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="block text-xs text-left-panel-fg/50 px-1 font-semibold">
                    {t('common:projects.title')}
                  </span>
                </div>
                <div className="flex flex-col max-h-[140px] overflow-y-scroll">
                  {filteredProjects
                    .slice()
                    .sort((a, b) => b.updated_at - a.updated_at)
                    .map((folder) => {
                      const ProjectItem = () => {
                        const [openDropdown, setOpenDropdown] = useState(false)
                        const isProjectActive =
                          currentPath === `/project/${folder.id}`

                        return (
                          <div key={folder.id} className="mb-1">
                            <div
                              className={cn(
                                'rounded hover:bg-left-panel-fg/10 flex items-center justify-between gap-2 px-1.5 group/project-list transition-all cursor-pointer',
                                isProjectActive && 'bg-left-panel-fg/10'
                              )}
                              onContextMenu={(e) => {
                                e.preventDefault()
                              }}
                            >
                              <Link
                                to="/project/$projectId"
                                params={{ projectId: folder.id }}
                                onClick={() =>
                                  isSmallScreen && setLeftPanel(false)
                                }
                                className="py-1 pr-2 truncate flex items-center gap-2 flex-1"
                              >
                                <ProjectIcon
                                  icon={folder.icon}
                                  color={folder.color}
                                  size="sm"
                                  className="shrink-0"
                                />
                                <span className="text-sm text-left-panel-fg/90 truncate">
                                  {folder.name}
                                </span>
                              </Link>
                              <div className="flex items-center">
                                <DropdownMenu
                                  open={openDropdown}
                                  onOpenChange={(open) => setOpenDropdown(open)}
                                >
                                  <DropdownMenuTrigger asChild>
                                    <IconDots
                                      size={14}
                                      className="text-left-panel-fg/60 shrink-0 cursor-pointer px-0.5 -mr-1 data-[state=open]:bg-left-panel-fg/10 rounded group-hover/project-list:data-[state=closed]:size-5 size-5 data-[state=closed]:size-0"
                                      onClick={(e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                      }}
                                    />
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent
                                    side="bottom"
                                    align="end"
                                  >
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setEditingProjectKey(folder.id)
                                        setProjectDialogOpen(true)
                                      }}
                                    >
                                      <IconPencil size={16} />
                                      <span>Edit</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleProjectDelete(folder.id)
                                      }}
                                    >
                                      <IconTrash size={16} />
                                      <span>Delete</span>
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          </div>
                        )
                      }

                      return <ProjectItem key={folder.id} />
                    })}
                </div>
              </div>
            )}

          <div className="flex flex-col h-full overflow-y-scroll w-[calc(100%+6px)]">
            <div className="flex flex-col w-full h-full overflow-y-auto overflow-x-hidden mb-3">
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
                    <div className="relative flex items-center gap-1">
                      {/* Multi-select Toggle Button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          'size-6 p-0 hover:bg-left-panel-fg/10',
                          isSelectionMode && 'bg-primary/10 text-primary'
                        )}
                        onClick={handleToggleSelectionMode}
                        title={
                          isSelectionMode
                            ? t('common:multiSelectMode.exit', {
                                defaultValue: 'Exit multi-select',
                              })
                            : t('common:multiSelectMode.enter', {
                                defaultValue: 'Select multiple',
                              })
                        }
                      >
                        <IconChecklist
                          size={18}
                          className={cn(
                            'transition-colors',
                            isSelectionMode
                              ? 'text-primary'
                              : 'text-left-panel-fg/60'
                          )}
                        />
                      </Button>

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
                          {isSelectionMode && getSelectedCount() === 0 && (
                            <DropdownMenuItem onClick={handleSelectAll}>
                              <IconChecklist size={16} />
                              <span>
                                {t('common:selectAll', {
                                  defaultValue: 'Select all',
                                })}
                              </span>
                            </DropdownMenuItem>
                          )}
                          <DeleteAllThreadsDialog
                            onDeleteAll={deleteAllThreads}
                          />
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                )}

                {filteredThreads.length === 0 && searchTerm.length > 0 && (
                  <div className="px-1 mt-2">
                    <span className="block text-xs text-left-panel-fg/50 px-1 font-semibold mb-2">
                      {t('common:recents')}
                    </span>

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

                {/* Show "No threads yet" when there are no threads at all OR when all threads are in projects */}
                {(Object.keys(threads).length === 0 ||
                  (Object.keys(threads).length > 0 &&
                    unFavoritedThreads.length === 0 &&
                    favoritedThreads.length === 0)) &&
                  !searchTerm && (
                    <>
                      <div className="px-1 mt-2">
                        <div className="flex items-center gap-1 text-left-panel-fg/80">
                          <IconMessage size={18} />
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

            {secondaryMenus.map((menu) => {
              if (!menu.isEnabled) {
                return null
              }

              // Regular menu items must have route and icon
              if (!menu.route || !menu.icon) return null

              const isActive = (() => {
                // Settings routes
                if (menu.route.includes(route.settings.index)) {
                  return currentPath.includes(route.settings.index)
                }

                // Default exact match for other routes
                return currentPath === menu.route
              })()
              return (
                <Link
                  key={menu.title}
                  to={menu.route}
                  onClick={() => isSmallScreen && setLeftPanel(false)}
                  data-test-id={`menu-${menu.title}`}
                  activeOptions={{ exact: true }}
                  className={cn(
                    'flex items-center gap-1.5 cursor-pointer hover:bg-left-panel-fg/10 py-1 my-0.5 px-1 rounded',
                    isActive && 'bg-left-panel-fg/10'
                  )}
                >
                  <menu.icon size={18} className="text-left-panel-fg/70" />
                  <span className="font-medium text-left-panel-fg/90">
                    {t(menu.title)}
                  </span>
                </Link>
              )
            })}

            {PlatformFeatures[PlatformFeature.AUTHENTICATION] && (
              <div className="space-y-1 shrink-0 py-1">
                <div>
                  <div className="mx-1 my-2 border-t border-left-panel-fg/5" />
                  {isAuthenticated ? <UserProfileMenu /> : <AuthLoginButton />}
                </div>
              </div>
            )}

            <DownloadManagement />
          </div>
        </div>
      </aside>

      {/* Project Dialogs */}
      {projectsEnabled && (
        <>
          <AddProjectDialog
            open={projectDialogOpen}
            onOpenChange={setProjectDialogOpen}
            editingKey={editingProjectKey}
            initialData={
              editingProjectKey ? getFolderById(editingProjectKey) : undefined
            }
            onSave={handleProjectSave}
          />
          <DeleteProjectDialog
            open={deleteProjectConfirmOpen}
            onOpenChange={handleProjectDeleteClose}
            projectId={deletingProjectId ?? undefined}
            projectName={
              deletingProjectId
                ? getFolderById(deletingProjectId)?.name
                : undefined
            }
          />
        </>
      )}

      {/* Bulk Thread Actions Toolbar */}
      <BulkThreadActionsToolbar />
    </>
  )
}

export default LeftPanel
