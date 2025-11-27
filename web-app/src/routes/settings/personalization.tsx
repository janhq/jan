import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { Card, CardItem } from '@/containers/Card'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, AlertCircle, ChevronDown } from 'lucide-react'
import { PlatformGuard } from '@/lib/platform/PlatformGuard'
import { PlatformFeature } from '@/lib/platform'
import {
  userSettingsService,
  type UserSettings,
  type ProfileSettings,
} from '@jan/extensions-web'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.personalization as any)({
  component: PersonalizationPage,
})

function PersonalizationPage() {
  return (
    <PlatformGuard feature={PlatformFeature.AUTHENTICATION}>
      <PersonalizationContent />
    </PlatformGuard>
  )
}

function PersonalizationContent() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null)

  // Load settings on mount
  useEffect(() => {
    loadSettings()
  }, [])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeout) {
        clearTimeout(saveTimeout)
      }
    }
  }, [saveTimeout])

  const loadSettings = async () => {
    try {
      setLoading(true)
      const data = await userSettingsService.getUserSettings()
      setSettings(data)
    } catch (error) {
      console.error('Failed to load user settings:', error)
      toast.error('Failed to load user settings')
    } finally {
      setLoading(false)
    }
  }

  const updateSettings = async (updates: Partial<UserSettings>) => {
    if (!settings) return

    try {
      setSaving(true)
      const updated = await userSettingsService.updateUserSettings(updates)
      setSettings(updated)
      toast.success('Settings saved successfully')
    } catch (error) {
      console.error('Failed to update settings:', error)
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const updateProfileSettings = (updates: Partial<ProfileSettings>) => {
    if (!settings) return
    const newProfile = { ...settings.profile_settings, ...updates }
    
    // Update local state immediately for responsive UI
    setSettings({ ...settings, profile_settings: newProfile })
    
    // Clear existing timeout
    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }
    
    // Debounce the API call
    const timeout = setTimeout(() => {
      updateSettings({ profile_settings: newProfile })
    }, 1000) // Wait 1 second after user stops typing
    
    setSaveTimeout(timeout)
  }



  if (loading) {
    return (
      <div className="flex flex-col h-full pb-[calc(env(safe-area-inset-bottom)+env(safe-area-inset-top))]">
        <HeaderPage>
          <h1 className="font-medium">{t('common:personalization')}</h1>
        </HeaderPage>
        <div className="flex h-full w-full flex-col sm:flex-row">
          <SettingsMenu />
          <div className="p-4 w-full h-[calc(100%-32px)] flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="flex flex-col h-full pb-[calc(env(safe-area-inset-bottom)+env(safe-area-inset-top))]">
        <HeaderPage>
          <h1 className="font-medium">{t('common:personalization')}</h1>
        </HeaderPage>
        <div className="flex h-full w-full flex-col sm:flex-row">
          <SettingsMenu />
          <div className="p-4 w-full h-[calc(100%-32px)] flex items-center justify-center">
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertCircle className="h-5 w-5" />
              <span>Failed to load settings</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full pb-[calc(env(safe-area-inset-bottom)+env(safe-area-inset-top))]">
      <HeaderPage>
        <h1 className="font-medium">{t('common:personalization')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full flex-col sm:flex-row">
        <SettingsMenu />
        <div className="p-6 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col gap-8 w-full max-w-3xl">

            {/* Personalization Section */}
            <div className="flex flex-col gap-6">
              <h2 className="text-xl font-normal">Personalization</h2>
              <Card>
                <CardItem
                  title="Base style and tone"
                  description="Set the style and tone of how Jan responds to you. This doesn't impact Jan's capabilities."
                  actions={
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          disabled={saving}
                          className="flex h-10 w-40 items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span>{settings.profile_settings.base_style}</span>
                          <ChevronDown className="h-4 w-4 opacity-50" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onClick={() => updateProfileSettings({ base_style: 'Concise' })}
                        >
                          Concise
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => updateProfileSettings({ base_style: 'Friendly' })}
                        >
                          Friendly
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => updateProfileSettings({ base_style: 'Professional' })}
                        >
                          Professional
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  }
                />
                <CardItem
                  title="Custom instructions"
                  description="Additional behavior, style, and tone preferences"
                  column={true}
                  actions={
                    <Input
                      value={settings.profile_settings.custom_instructions}
                      onChange={(e) =>
                        updateProfileSettings({
                          custom_instructions: e.target.value,
                        })
                      }
                      placeholder="Additional behavior, style, and tone preferences"
                      disabled={saving}
                      className="w-full h-10 px-4 py-3 mt-1.5"
                    />
                  }
                />
              </Card>
            </div>

            {/* About you Section */}
            <div className="flex flex-col gap-6">
              <h2 className="text-xl font-normal">About you</h2>
              <Card>
                <CardItem
                  title="Nickname"
                  description="What should Jan call you?"
                  column={true}
                  actions={
                    <Input
                      value={settings.profile_settings.nick_name}
                      onChange={(e) =>
                        updateProfileSettings({ nick_name: e.target.value })
                      }
                      placeholder="What should Jan call you?"
                      disabled={saving}
                      className="w-full h-10 px-4 py-3 mt-1.5"
                    />
                  }
                />
                <CardItem
                  title="Occupation"
                  description="Your professional role or occupation"
                  column={true}
                  actions={
                    <Input
                      value={settings.profile_settings.occupation}
                      onChange={(e) =>
                        updateProfileSettings({ occupation: e.target.value })
                      }
                      placeholder="Gastroenterologist"
                      disabled={saving}
                      className="w-full h-10 px-4 py-3 mt-1.5"
                    />
                  }
                />
                <CardItem
                  title="More about you"
                  description="Interests, values, or preferences to keep in mind"
                  column={true}
                  actions={
                    <Input
                      value={settings.profile_settings.more_about_you}
                      onChange={(e) =>
                        updateProfileSettings({ more_about_you: e.target.value })
                      }
                      placeholder="Interests, values, or preferences to keep in mind"
                      disabled={saving}
                      className="w-full h-10 px-4 py-3 mt-1.5"
                    />
                  }
                />
              </Card>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
