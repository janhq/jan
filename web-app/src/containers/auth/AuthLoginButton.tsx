/**
 * Auth Login Button with Dropdown Menu
 * Shows available authentication providers in a dropdown menu
 */

import { useState } from 'react'
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

export const AuthLoginButton = () => {
  const { t } = useTranslation()
  const { getAllProviders, loginWithProvider } = useAuth()
  const [isLoading, setIsLoading] = useState(false)

  const enabledProviders = getAllProviders()

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
          disabled={isLoading}
          className="flex items-center gap-1.5 cursor-pointer hover:bg-left-panel-fg/10 py-1 px-1 rounded w-full"
        >
          <IconLogin size={18} className="text-left-panel-fg/70" />
          <span className="font-medium text-left-panel-fg/90">{t('common:login')}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-48">
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
