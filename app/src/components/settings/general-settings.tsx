import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerItem,
  DropDrawerTrigger,
} from '@/components/ui/dropdrawer'
import { useAuth } from '@/stores/auth-store'
import { getInitialsAvatar } from '@/lib/utils'
import { useTheme } from '@/components/themes/theme-provider'
import { ChevronsUpDown, CircleCheck, Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '../ui/button'
import { useRef } from 'react'
import { THEME } from '@/constants'

export function GeneralSettings() {
  const user = useAuth((state) => state.user)
  const { theme, setTheme } = useTheme()
  const buttonRef = useRef<HTMLButtonElement>(null)

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    if (!buttonRef.current || !document.startViewTransition) {
      setTheme(newTheme)
      return
    }

    const { top, left, width, height } =
      buttonRef.current.getBoundingClientRect()
    const x = left + width / 2
    const y = top + height / 2
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    )

    const transition = document.startViewTransition(() => {
      setTheme(newTheme)
    })

    transition.ready.then(() => {
      const clipPath = [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${endRadius}px at ${x}px ${y}px)`,
      ]

      document.documentElement.animate(
        {
          clipPath: clipPath,
        },
        {
          duration: 500,
          easing: 'ease-in-out',
          pseudoElement: '::view-transition-new(root)',
        }
      )
    })
  }

  const getThemeDisplay = () => {
    switch (theme) {
      case THEME.LIGHT:
        return 'Light'
      case THEME.DARK:
        return 'Dark'
      case THEME.SYSTEM:
        return 'System'
      default:
        return 'System'
    }
  }

  const getThemeIcon = () => {
    switch (theme) {
      case THEME.LIGHT:
        return <Sun className="size-4 text-muted-foreground" />
      case THEME.DARK:
        return <Moon className="size-4 text-muted-foreground" />
      case THEME.SYSTEM:
        return <Monitor className="size-4 text-muted-foreground" />
      default:
        return <Monitor className="size-4 text-muted-foreground" />
    }
  }

  return (
    <div>
      <p className="text-base font-semibold mb-4 font-studio">Account</p>
      {/* Profile Section */}
      <div className="flex items-center gap-4 mb-6 bg-muted/50 p-4 rounded-lg">
        <Avatar className="size-12">
          <AvatarImage src={user?.avatar} alt={user?.name} />
          <AvatarFallback className="bg-primary text-background text-xl font-semibold">
            {getInitialsAvatar(user?.name || '')}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 ">
          <h4 className="font-medium text-lg">{user?.name}</h4>
          <p className="text-xs text-muted-foreground">{user?.email}</p>
        </div>
      </div>

      {/* Appearance Section */}
      <p className="text-base font-semibold mb-4 font-studio">Appearance</p>
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-sm">Color mode</p>
        </div>
        <DropDrawer>
          <DropDrawerTrigger asChild>
            <Button
              ref={buttonRef}
              variant="outline"
              className="justify-between rounded-xl min-w-40"
            >
              <div className="flex items-center gap-2">
                {getThemeIcon()}
                <span className="text-sm text-muted-foreground">
                  {getThemeDisplay()}
                </span>
              </div>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
            </Button>
          </DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem
              onSelect={() => handleThemeChange(THEME.LIGHT)}
              icon={
                theme === THEME.LIGHT ? (
                  <CircleCheck className="size-4 text-primary" />
                ) : null
              }
            >
              <div className="flex items-center gap-2">
                <Sun className="size-4 text-muted-foreground" />
                <span>Light</span>
              </div>
            </DropDrawerItem>
            <DropDrawerItem
              onSelect={() => handleThemeChange(THEME.DARK)}
              icon={
                theme === THEME.DARK ? (
                  <CircleCheck className="size-4 text-primary" />
                ) : null
              }
            >
              <div className="flex items-center gap-2">
                <Moon className="size-4 text-muted-foreground" />
                <span>Dark</span>
              </div>
            </DropDrawerItem>
            <DropDrawerItem
              onSelect={() => handleThemeChange(THEME.SYSTEM)}
              icon={
                theme === THEME.SYSTEM ? (
                  <CircleCheck className="size-4 text-primary" />
                ) : null
              }
            >
              <div className="flex items-center gap-2">
                <Monitor className="size-4 text-muted-foreground" />
                <span>System</span>
              </div>
            </DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      </div>
    </div>
  )
}
