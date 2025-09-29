/**
 * Auth Login Button with Dropdown Menu
 * Shows available authentication providers in a dropdown menu
 */

import { useState, useRef, useEffect } from 'react'
import { IconLogin, IconBrandGoogleFilled } from '@tabler/icons-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useAuth } from '@/hooks/useAuth'
import { toast } from 'sonner'
import type { ProviderType } from '@jan/extensions-web'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSmallScreen } from '@/hooks/useMediaQuery'

export const AuthLoginButton = () => {
  const { t } = useTranslation()
  const { getAllProviders, loginWithProvider } = useAuth()
  const [isLoading, setIsLoading] = useState(false)
  const [panelWidth, setPanelWidth] = useState<number>(192)
  const dropdownRef = useRef<HTMLButtonElement>(null)
  const isSmallScreen = useSmallScreen()

  const enabledProviders = getAllProviders()

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

  const handleProviderLogin = async (providerId: ProviderType) => {
    try {
      setIsLoading(true)
      await loginWithProvider(providerId)
    } catch (error) {
      console.error('Failed to login with provider:', error)
      toast.error(t('common:loginFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  const getProviderIcon = (iconName: string) => {
    switch (iconName) {
      case 'IconBrandGoogleFilled':
        return IconBrandGoogleFilled
      default:
        return IconLogin
    }
  }

  if (enabledProviders.length === 0) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          ref={dropdownRef}
          disabled={isLoading}
          className="flex items-center gap-1.5 cursor-pointer hover:bg-left-panel-fg/10 py-1 px-1 rounded w-full"
        >
          <IconLogin size={18} className="text-left-panel-fg/70" />
          <span className="font-medium text-left-panel-fg/90">{t('common:login')}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        style={{ width: `${panelWidth}px` }}
        alignOffset={isSmallScreen ? -4 : 0}
      >
        {enabledProviders.map((provider) => {
          const IconComponent = getProviderIcon(provider.icon)
          return (
            <DropdownMenuItem
              key={provider.id}
              onClick={() => handleProviderLogin(provider.id as ProviderType)}
              disabled={isLoading}
              className="gap-2"
            >
              <IconComponent size={16} />
              <span className="text-sm text-left-panel-fg/90">
                {t('common:loginWith', {
                  provider: provider.name,
                })}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
