/**
 * User Profile Menu Container
 * Dropdown menu with user profile and logout options
 */

import { useState, useRef, useEffect } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { IconUser, IconLogout } from '@tabler/icons-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useAuth } from '@/hooks/useAuth'
import { toast } from 'sonner'
import { useSmallScreen } from '@/hooks/useMediaQuery'

export const UserProfileMenu = () => {
  const { t } = useTranslation()
  const { user, isLoading, logout } = useAuth()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [panelWidth, setPanelWidth] = useState<number>(192)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const isSmallScreen = useSmallScreen()

  useEffect(() => {
    const updateWidth = () => {
      // Find the left panel element
      const leftPanel = document.querySelector('aside[ref]') ||
                        document.querySelector('aside') ||
                        dropdownRef.current?.closest('aside')
      if (leftPanel) {
        setPanelWidth(leftPanel.getBoundingClientRect().width)
      }
    }

    updateWidth()
    window.addEventListener('resize', updateWidth)

    // Also observe for panel resize
    const observer = new ResizeObserver(updateWidth)
    const leftPanel = document.querySelector('aside')
    if (leftPanel) {
      observer.observe(leftPanel)
    }

    return () => {
      window.removeEventListener('resize', updateWidth)
      observer.disconnect()
    }
  }, [])

  const handleLogout = async () => {
    if (isLoggingOut) return

    try {
      setIsLoggingOut(true)
      await logout()
      toast.success(t('common:loggedOut'))
    } catch (error) {
      console.error('Failed to logout:', error)
      toast.error(t('common:logoutFailed'))
    } finally {
      setIsLoggingOut(false)
    }
  }

  if (isLoading || !user) {
    return null
  }

  const getInitials = (name: string) => {
    const parts = name.split(' ')
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    }
    return name.slice(0, 2).toUpperCase()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div ref={dropdownRef} className="flex items-center gap-1.5 cursor-pointer hover:bg-left-panel-fg/10 py-1 px-1 rounded">
          <Avatar className="h-[18px] w-[18px]">
            {user.picture && (
              <AvatarImage src={user.picture} alt={user.name} />
            )}
            <AvatarFallback className="text-[10px]">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <span className="font-medium text-left-panel-fg/90">{user.name}</span>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        style={{ width: `${panelWidth}px` }}
        alignOffset={isSmallScreen ? -4 : 0}
      >
        <DropdownMenuLabel>
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{user.name}</p>
            <p className="text-xs leading-none text-muted-foreground">
              {user.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2">
          <IconUser size={16} />
          <span>{t('common:profile')}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="gap-2 text-destructive focus:text-destructive"
        >
          <IconLogout size={16} />
          <span>
            {isLoggingOut ? t('common:loggingOut') : t('common:logout')}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
