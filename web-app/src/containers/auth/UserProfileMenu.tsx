/**
 * User Profile Menu Container
 * Dropdown menu with user profile and logout options
 */

import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { IconUser, IconLogout, IconChevronDown } from '@tabler/icons-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useAuth } from '@/hooks/useAuth'
import { toast } from 'sonner'

export const UserProfileMenu = () => {
  const { t } = useTranslation()
  const { user, isLoading, logout } = useAuth()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

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
        <Button
          variant="link"
          size="sm"
          className="w-full justify-between gap-2 px-2"
        >
          <div className="flex items-center gap-2">
            <Avatar className="h-6 w-6">
              {user.picture && (
                <AvatarImage src={user.picture} alt={user.name} />
              )}
              <AvatarFallback className="text-xs">
                {getInitials(user.name)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-sm">{user.name}</span>
          </div>
          <IconChevronDown size={14} className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-56">
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
