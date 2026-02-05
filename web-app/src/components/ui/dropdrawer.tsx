/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import * as React from 'react'

import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { cn } from '@/lib/utils'
import { useSmallScreen } from '@/hooks/useMediaQuery'

const ANIMATION_CONFIG = {
  variants: {
    enter: (direction: 'forward' | 'backward') => ({
      x: direction === 'forward' ? '100%' : '-100%',
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: 'forward' | 'backward') => ({
      x: direction === 'forward' ? '-100%' : '100%',
      opacity: 0,
    }),
  },
  transition: {
    duration: 0.3,
    ease: [0.25, 0.1, 0.25, 1.0],
  },
} as const

const getMobileItemStyles = (
  isInsideGroup: boolean,
  inset?: boolean,
  variant?: string,
  disabled?: boolean
) => {
  return cn(
    'flex cursor-pointer items-center justify-between px-4 py-4 w-full gap-4',
    !isInsideGroup && 'bg-main-view-fg/50 mx-2 my-1.5 rounded-md',
    isInsideGroup && 'bg-transparent py-4',
    inset && 'pl-8',
    variant === 'destructive' && 'text-destructive',
    disabled && 'pointer-events-none opacity-50'
  )
}

const DropDrawerContext = React.createContext<{ isMobile: boolean }>({
  isMobile: false,
})

const useDropDrawerContext = () => {
  const context = React.useContext(DropDrawerContext)
  if (!context) {
    throw new Error(
      'DropDrawer components cannot be rendered outside the DropDrawer Context'
    )
  }
  return context
}

const useComponentSelection = () => {
  const { isMobile } = useDropDrawerContext()

  const selectComponent = <T, D>(mobileComponent: T, desktopComponent: D) => {
    return isMobile ? mobileComponent : desktopComponent
  }

  return { isMobile, selectComponent }
}

const useGroupDetection = () => {
  const isInGroup = React.useCallback(
    (element: HTMLElement | null): boolean => {
      if (!element) return false

      let parent = element.parentElement
      while (parent) {
        if (parent.hasAttribute('data-drop-drawer-group')) {
          return true
        }
        parent = parent.parentElement
      }
      return false
    },
    []
  )

  const useGroupState = () => {
    const { isMobile } = useComponentSelection()
    const itemRef = React.useRef<HTMLDivElement>(null)
    const [isInsideGroup, setIsInsideGroup] = React.useState(false)

    React.useEffect(() => {
      if (!isMobile) return

      const timer = setTimeout(() => {
        if (itemRef.current) {
          setIsInsideGroup(isInGroup(itemRef.current))
        }
      }, 0)

      return () => clearTimeout(timer)
    }, [isMobile])

    return { itemRef, isInsideGroup }
  }

  return { isInGroup, useGroupState }
}

type ConditionalComponentProps<T, D> = {
  children: React.ReactNode
  className?: string
} & (T | D)

const ConditionalComponent = <T, D>({
  mobileComponent,
  desktopComponent,
  children,
  ...props
}: {
  mobileComponent: React.ComponentType<any>
  desktopComponent: React.ComponentType<any>
  children: React.ReactNode
} & ConditionalComponentProps<T, D>) => {
  const { selectComponent } = useComponentSelection()
  const Component = selectComponent(mobileComponent, desktopComponent)

  return <Component {...props}>{children}</Component>
}

function DropDrawer({
  children,
  ...props
}:
  | React.ComponentProps<typeof Drawer>
  | React.ComponentProps<typeof DropdownMenu>) {
  const isMobile = useSmallScreen()

  return (
    <DropDrawerContext.Provider value={{ isMobile }}>
      <ConditionalComponent
        mobileComponent={Drawer}
        desktopComponent={DropdownMenu}
        data-slot="drop-drawer"
        {...props}
      >
        {children}
      </ConditionalComponent>
    </DropDrawerContext.Provider>
  )
}

function DropDrawerTrigger({
  className,
  children,
  ...props
}:
  | React.ComponentProps<typeof DrawerTrigger>
  | React.ComponentProps<typeof DropdownMenuTrigger>) {
  return (
    <ConditionalComponent
      mobileComponent={DrawerTrigger}
      desktopComponent={DropdownMenuTrigger}
      data-slot="drop-drawer-trigger"
      className={className}
      {...props}
    >
      {children}
    </ConditionalComponent>
  )
}

function DropDrawerContent({
  className,
  children,
  ...props
}:
  | React.ComponentProps<typeof DrawerContent>
  | React.ComponentProps<typeof DropdownMenuContent>) {
  const { isMobile } = useDropDrawerContext()
  const [activeSubmenu, setActiveSubmenu] = React.useState<string | null>(null)
  const [submenuTitle, setSubmenuTitle] = React.useState<string | null>(null)
  const [submenuStack, setSubmenuStack] = React.useState<
    { id: string; title: string }[]
  >([])
  // Add animation direction state
  const [animationDirection, setAnimationDirection] = React.useState<
    'forward' | 'backward'
  >('forward')

  // Create a ref to store submenu content by ID
  const submenuContentRef = React.useRef<Map<string, React.ReactNode[]>>(
    new Map()
  )

  // Function to navigate to a submenu
  const navigateToSubmenu = React.useCallback((id: string, title: string) => {
    // Set animation direction to forward when navigating to a submenu
    setAnimationDirection('forward')
    setActiveSubmenu(id)
    setSubmenuTitle(title)
    setSubmenuStack((prev) => [...prev, { id, title }])
  }, [])

  // Function to go back to previous menu
  const goBack = React.useCallback(() => {
    // Set animation direction to backward when going back
    setAnimationDirection('backward')

    if (submenuStack.length <= 1) {
      // If we're at the first level, go back to main menu
      setActiveSubmenu(null)
      setSubmenuTitle(null)
      setSubmenuStack([])
    } else {
      // Go back to previous submenu
      const newStack = [...submenuStack]
      newStack.pop() // Remove current
      const previous = newStack[newStack.length - 1]
      setActiveSubmenu(previous.id)
      setSubmenuTitle(previous.title)
      setSubmenuStack(newStack)
    }
  }, [submenuStack])

  // Function to register submenu content
  const registerSubmenuContent = React.useCallback(
    (id: string, content: React.ReactNode[]) => {
      submenuContentRef.current.set(id, content)
    },
    []
  )

  const extractSubmenuContent = React.useCallback(
    (elements: React.ReactNode, targetId: string): React.ReactNode[] => {
      const result: React.ReactNode[] = []

      const findSubmenuContent = (node: React.ReactNode) => {
        if (!React.isValidElement(node)) return

        const element = node as React.ReactElement
        const props = element.props as {
          'id'?: string
          'data-submenu-id'?: string
          'children'?: React.ReactNode
        }

        if (element.type === DropDrawerSub) {
          const elementId = props.id || props['data-submenu-id']

          if (elementId === targetId) {
            React.Children.forEach(props.children, (child) => {
              if (
                React.isValidElement(child) &&
                child.type === DropDrawerSubContent
              ) {
                const subContentProps = child.props as {
                  children?: React.ReactNode
                }
                React.Children.forEach(
                  subContentProps.children,
                  (contentChild) => {
                    result.push(contentChild)
                  }
                )
              }
            })
            return
          }
        }

        if (props.children) {
          React.Children.forEach(props.children, findSubmenuContent)
        }
      }

      React.Children.forEach(elements, findSubmenuContent)
      return result
    },
    []
  )

  // Get submenu content (always extract fresh to reflect state changes)
  const getSubmenuContent = React.useCallback(
    (id: string) => {
      // Always extract fresh content to ensure state changes are reflected
      const submenuContent = extractSubmenuContent(children, id)
      return submenuContent
    },
    [children, extractSubmenuContent]
  )

  if (isMobile) {
    return (
      <SubmenuContext.Provider
        value={{
          activeSubmenu,
          setActiveSubmenu: (id) => {
            if (id === null) {
              setActiveSubmenu(null)
              setSubmenuTitle(null)
              setSubmenuStack([])
            }
          },
          submenuTitle,
          setSubmenuTitle,
          navigateToSubmenu,
          registerSubmenuContent,
        }}
      >
        <DrawerContent
          data-slot="drop-drawer-content"
          className={cn(
            'max-h-[90vh] w-full overflow-hidden max-w-none',
            className
          )}
          {...props}
        >
          {activeSubmenu ? (
            <>
              <DrawerHeader>
                <div className="flex items-center gap-2">
                  <button
                    onClick={goBack}
                    className="hover:bg-muted/50 rounded-full "
                  >
                    <ChevronLeftIcon className="h-5 w-5 text-main-view-fg/50" />
                  </button>
                  <DrawerTitle className="text-main-view-fg/80 text-sm">
                    {submenuTitle || 'Submenu'}
                  </DrawerTitle>
                </div>
              </DrawerHeader>
              <div className="flex-1 relative overflow-hidden max-h-[70vh]">
                {/* Use AnimatePresence to handle exit animations */}
                <AnimatePresence
                  initial={false}
                  mode="wait"
                  custom={animationDirection}
                >
                  <motion.div
                    key={activeSubmenu || 'main'}
                    custom={animationDirection}
                    variants={ANIMATION_CONFIG.variants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={ANIMATION_CONFIG.transition as any}
                    className="pb-6 space-y-1.5 w-full h-full overflow-hidden"
                  >
                    {activeSubmenu
                      ? getSubmenuContent(activeSubmenu)
                      : children}
                  </motion.div>
                </AnimatePresence>
              </div>
            </>
          ) : (
            <>
              <DrawerHeader className="sr-only">
                <DrawerTitle>Menu</DrawerTitle>
              </DrawerHeader>
              <div className="overflow-hidden max-h-[70vh]">
                <AnimatePresence
                  initial={false}
                  mode="wait"
                  custom={animationDirection}
                >
                  <motion.div
                    key="main-menu"
                    custom={animationDirection}
                    variants={ANIMATION_CONFIG.variants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={ANIMATION_CONFIG.transition as any}
                    className="pb-6 space-y-1.5 w-full overflow-hidden"
                  >
                    {children}
                  </motion.div>
                </AnimatePresence>
              </div>
            </>
          )}
        </DrawerContent>
      </SubmenuContext.Provider>
    )
  }

  return (
    <SubmenuContext.Provider
      value={{
        activeSubmenu,
        setActiveSubmenu,
        submenuTitle,
        setSubmenuTitle,
        navigateToSubmenu,
        registerSubmenuContent,
      }}
    >
      <DropdownMenuContent
        data-slot="drop-drawer-content"
        sideOffset={4}
        className={cn(
          'max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[220px] overflow-hidden',
          className
        )}
        {...props}
      >
        {children}
      </DropdownMenuContent>
    </SubmenuContext.Provider>
  )
}

function DropDrawerItem({
  className,
  children,
  onSelect,
  onClick,
  icon,
  variant = 'default',
  inset,
  disabled,
  ...props
}: React.ComponentProps<typeof DropdownMenuItem> & {
  icon?: React.ReactNode
}) {
  const { isMobile } = useComponentSelection()
  const { useGroupState } = useGroupDetection()
  const { itemRef, isInsideGroup } = useGroupState()

  if (isMobile) {
    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return

      // If this item only has an icon (like a switch) and no other interactive content,
      // don't handle clicks on the main area - let the icon handle everything
      if (icon && !onClick && !onSelect) {
        return
      }

      // Check if the click came from the icon area (where the Switch is)
      const target = e.target as HTMLElement
      const iconContainer = (e.currentTarget as HTMLElement).querySelector(
        '[data-icon-container]'
      )

      if (iconContainer && iconContainer.contains(target)) {
        // Don't handle the click if it came from the icon area
        return
      }

      if (onClick) onClick(e)
      if (onSelect) onSelect(e as unknown as Event)
    }

    // Only wrap in DrawerClose if it's not a submenu item
    const content = (
      <div
        ref={itemRef}
        data-slot="drop-drawer-item"
        data-variant={variant}
        data-inset={inset}
        data-disabled={disabled}
        className={cn(
          getMobileItemStyles(isInsideGroup, inset, variant, disabled),
          className
        )}
        onClick={handleClick}
        aria-disabled={disabled}
        {...props}
      >
        <div className="flex items-center gap-2">{children}</div>
        {icon && (
          <div className="flex-shrink-0" data-icon-container>
            {icon}
          </div>
        )}
      </div>
    )

    // Check if this is inside a submenu
    const isInSubmenu =
      (props as Record<string, unknown>)['data-parent-submenu-id'] ||
      (props as Record<string, unknown>)['data-parent-submenu']

    if (isInSubmenu) {
      return content
    }

    return <DrawerClose asChild>{content}</DrawerClose>
  }

  return (
    <DropdownMenuItem
      data-slot="drop-drawer-item"
      data-variant={variant}
      data-inset={inset}
      className={className}
      onSelect={onSelect}
      onClick={onClick as React.MouseEventHandler<HTMLDivElement>}
      variant={variant}
      inset={inset}
      disabled={disabled}
      {...props}
    >
      <div className="flex w-full items-start justify-between gap-4">
        <div className="min-w-0 flex-1">{children}</div>
        {icon && <div className="flex-shrink-0">{icon}</div>}
      </div>
    </DropdownMenuItem>
  )
}

function DropDrawerSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuSeparator>) {
  const { isMobile } = useComponentSelection()

  if (isMobile) {
    return null
  }

  return (
    <DropdownMenuSeparator
      data-slot="drop-drawer-separator"
      className={className}
      {...props}
    />
  )
}

function DropDrawerLabel({
  className,
  children,
  ...props
}:
  | React.ComponentProps<typeof DropdownMenuLabel>
  | React.ComponentProps<typeof DrawerTitle>) {
  const { isMobile } = useComponentSelection()

  if (isMobile) {
    return (
      <DrawerHeader className="p-0">
        <DrawerTitle
          data-slot="drop-drawer-label"
          className={cn(
            'px-4 py-2 text-sm font-medium text-main-view-fg/60',
            className
          )}
          {...props}
        >
          {children}
        </DrawerTitle>
      </DrawerHeader>
    )
  }

  return (
    <DropdownMenuLabel
      data-slot="drop-drawer-label"
      className={className}
      {...props}
    >
      {children}
    </DropdownMenuLabel>
  )
}

function DropDrawerFooter({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DrawerFooter> | React.ComponentProps<'div'>) {
  const { isMobile } = useDropDrawerContext()

  if (isMobile) {
    return (
      <DrawerFooter
        data-slot="drop-drawer-footer"
        className={cn('p-4', className)}
        {...props}
      >
        {children}
      </DrawerFooter>
    )
  }

  // No direct equivalent in DropdownMenu, so we'll just render a div
  return (
    <div
      data-slot="drop-drawer-footer"
      className={cn('p-2', className)}
      {...props}
    >
      {children}
    </div>
  )
}

function DropDrawerGroup({
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  children: React.ReactNode
}) {
  const { isMobile } = useDropDrawerContext()

  // Add separators between children on mobile
  const childrenWithSeparators = React.useMemo(() => {
    if (!isMobile) return children

    const childArray = React.Children.toArray(children)

    // Filter out any existing separators
    const filteredChildren = childArray.filter(
      (child) =>
        React.isValidElement(child) && child.type !== DropDrawerSeparator
    )

    // Add separators between items
    return filteredChildren.flatMap((child, index) => {
      if (index === filteredChildren.length - 1) return [child]
      return [
        child,
        <div
          key={`separator-${index}`}
          className="bg-border h-px"
          aria-hidden="true"
        />,
      ]
    })
  }, [children, isMobile])

  if (isMobile) {
    return (
      <div
        data-drop-drawer-group
        data-slot="drop-drawer-group"
        role="group"
        className={cn(
          'bg-main-view-fg/2 border border-main-view-fg/4 mx-2 my-3 overflow-hidden rounded-xl',
          className
        )}
        {...props}
      >
        {childrenWithSeparators}
      </div>
    )
  }

  // On desktop, use a div with proper role and attributes
  return (
    <div
      data-drop-drawer-group
      data-slot="drop-drawer-group"
      role="group"
      className={className}
      {...props}
    >
      {children}
    </div>
  )
}

// Context for managing submenu state on mobile
interface SubmenuContextType {
  activeSubmenu: string | null
  setActiveSubmenu: (id: string | null) => void
  submenuTitle: string | null
  setSubmenuTitle: (title: string | null) => void
  navigateToSubmenu?: (id: string, title: string) => void
  registerSubmenuContent?: (id: string, content: React.ReactNode[]) => void
}

const SubmenuContext = React.createContext<SubmenuContextType>({
  activeSubmenu: null,
  setActiveSubmenu: () => {},
  submenuTitle: null,
  setSubmenuTitle: () => {},
  navigateToSubmenu: undefined,
  registerSubmenuContent: undefined,
})

// Submenu components
// Counter for generating simple numeric IDs
let submenuIdCounter = 0

function DropDrawerSub({
  children,
  id,
  title,
  ...props
}: React.ComponentProps<typeof DropdownMenuSub> & {
  id?: string
  title?: string
}) {
  const { isMobile } = useDropDrawerContext()
  const { registerSubmenuContent } = React.useContext(SubmenuContext)

  // Generate a simple numeric ID instead of using React.useId()
  const [generatedId] = React.useState(() => `submenu-${submenuIdCounter++}`)
  const submenuId = id || generatedId

  // Extract submenu content to register with parent
  React.useEffect(() => {
    if (!registerSubmenuContent) return

    // Find the SubContent within this Sub
    const contentItems: React.ReactNode[] = []
    React.Children.forEach(children, (child) => {
      if (React.isValidElement(child) && child.type === DropDrawerSubContent) {
        // Add all children of the SubContent to the result
        React.Children.forEach(
          (child.props as { children?: React.ReactNode }).children,
          (contentChild) => {
            contentItems.push(contentChild)
          }
        )
      }
    })

    // Register the content with the parent
    if (contentItems.length > 0) {
      registerSubmenuContent(submenuId, contentItems)
    }
  }, [children, registerSubmenuContent, submenuId])

  if (isMobile) {
    // For mobile, we'll use the context to manage submenu state
    // Process children to pass the submenu ID to the trigger and content
    const processedChildren = React.Children.map(children, (child) => {
      if (!React.isValidElement(child)) return child

      if (child.type === DropDrawerSubTrigger) {
        return React.cloneElement(
          child as React.ReactElement,
          {
            ...(child.props as object),
            'data-parent-submenu-id': submenuId,
            'data-submenu-id': submenuId,
            // Use only data attributes, not custom props
            'data-parent-submenu': submenuId,
            'data-submenu-title': title,
          } as React.HTMLAttributes<HTMLElement>
        )
      }

      if (child.type === DropDrawerSubContent) {
        return React.cloneElement(
          child as React.ReactElement,
          {
            ...(child.props as object),
            'data-parent-submenu-id': submenuId,
            'data-submenu-id': submenuId,
            // Use only data attributes, not custom props
            'data-parent-submenu': submenuId,
          } as React.HTMLAttributes<HTMLElement>
        )
      }

      return child
    })

    return (
      <div
        data-slot="drop-drawer-sub"
        data-submenu-id={submenuId}
        id={submenuId}
      >
        {processedChildren}
      </div>
    )
  }

  // For desktop, use the standard DropdownMenuSub
  return <DropdownMenuSub {...props}>{children}</DropdownMenuSub>
}

function DropDrawerSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuSubTrigger> & {
  icon?: React.ReactNode
}) {
  const { isMobile } = useComponentSelection()
  const { navigateToSubmenu } = React.useContext(SubmenuContext)
  const { useGroupState } = useGroupDetection()
  const { itemRef, isInsideGroup } = useGroupState()

  if (isMobile) {
    // Find the parent submenu ID
    const handleClick = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // Get the closest parent with data-submenu-id attribute
      const element = e.currentTarget as HTMLElement
      let submenuId: string | null = null

      // First check if the element itself has the data attribute
      if (element.closest('[data-submenu-id]')) {
        const closestElement = element.closest('[data-submenu-id]')
        const id = closestElement?.getAttribute('data-submenu-id')
        if (id) {
          submenuId = id
        }
      }

      // If not found, try props
      if (!submenuId) {
        submenuId =
          ((props as Record<string, unknown>)[
            'data-parent-submenu-id'
          ] as string) ||
          ((props as Record<string, unknown>)['data-parent-submenu'] as string)
      }

      if (!submenuId) {
        return
      }

      // Get the title - first try data attribute, then children, then fallback
      const dataTitle = (props as Record<string, unknown>)[
        'data-submenu-title'
      ] as string
      const title =
        dataTitle || (typeof children === 'string' ? children : 'Submenu')

      // Navigate to the submenu
      if (navigateToSubmenu) {
        navigateToSubmenu(submenuId, title)
      }
    }

    // Combine onClick handlers
    const combinedOnClick = (e: React.MouseEvent) => {
      // Call the original onClick if provided
      const typedProps = props as Record<string, unknown>
      if (typedProps.onClick) {
        const originalOnClick =
          typedProps.onClick as React.MouseEventHandler<HTMLDivElement>
        originalOnClick(e as React.MouseEvent<HTMLDivElement>)
      }

      // Call our navigation handler
      handleClick(e)
    }

    // Remove onClick from props to avoid duplicate handlers
    const { ...restProps } = props as Record<string, unknown>

    // Don't wrap in DrawerClose for submenu triggers
    return (
      <div
        ref={itemRef}
        data-slot="drop-drawer-sub-trigger"
        data-inset={inset}
        className={cn(getMobileItemStyles(isInsideGroup, inset), className)}
        onClick={combinedOnClick}
        {...restProps}
      >
        <div className="flex items-center gap-2 w-full">{children}</div>
        <ChevronRightIcon className="h-5 w-5 text-main-view-fg/50 " />
      </div>
    )
  }

  return (
    <DropdownMenuSubTrigger
      data-slot="drop-drawer-sub-trigger"
      data-inset={inset}
      className={className}
      inset={inset}
      {...props}
    >
      {children}
    </DropdownMenuSubTrigger>
  )
}

function DropDrawerSubContent({
  className,
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuSubContent>) {
  const { isMobile } = useDropDrawerContext()

  if (isMobile) {
    // For mobile, we don't render the content directly
    // It will be rendered by the DropDrawerContent component when active
    return null
  }

  return (
    <DropdownMenuSubContent
      data-slot="drop-drawer-sub-content"
      sideOffset={sideOffset}
      className={className}
      {...props}
    >
      {children}
    </DropdownMenuSubContent>
  )
}

export {
  DropDrawer,
  DropDrawerContent,
  DropDrawerFooter,
  DropDrawerGroup,
  DropDrawerItem,
  DropDrawerLabel,
  DropDrawerSeparator,
  DropDrawerSub,
  DropDrawerSubContent,
  DropDrawerSubTrigger,
  DropDrawerTrigger,
}
