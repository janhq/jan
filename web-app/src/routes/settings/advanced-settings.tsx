import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { Card, CardItem } from '@/containers/Card'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, AlertCircle } from 'lucide-react'
import { PlatformGuard } from '@/lib/platform/PlatformGuard'
import { PlatformFeature } from '@/lib/platform'
import {
    userSettingsService,
    type UserSettings,
    type MemoryConfig,
} from '@jan/extensions-web'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.advancedSettings as any)({
    component: AdvancedSettingsPage,
})

function AdvancedSettingsPage() {
    return (
        <PlatformGuard feature={PlatformFeature.AUTHENTICATION}>
            <AdvancedSettingsContent />
        </PlatformGuard>
    )
}

function AdvancedSettingsContent() {
    const { t } = useTranslation()
    const [settings, setSettings] = useState<UserSettings | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    // Load settings on mount
    useEffect(() => {
        loadSettings()
    }, [])

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

    const updateMemoryConfig = (updates: Partial<MemoryConfig>) => {
        if (!settings) return
        const newConfig = { ...settings.memory_config, ...updates }
        updateSettings({ memory_config: newConfig })
    }

    if (loading) {
        return (
            <div className="flex flex-col h-full pb-[calc(env(safe-area-inset-bottom)+env(safe-area-inset-top))]">
                <HeaderPage>
                    <h1 className="font-medium">{t('common:advancedSettings')}</h1>
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
                    <h1 className="font-medium">{t('common:advancedSettings')}</h1>
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
                <h1 className="font-medium">{t('common:advancedSettings')}</h1>
            </HeaderPage>
            <div className="flex h-full w-full flex-col sm:flex-row">
                <SettingsMenu />
                <div className="p-6 w-full h-[calc(100%-32px)] overflow-y-auto">
                    <div className="flex flex-col gap-8 w-full max-w-3xl">

                        {/* Memory Settings Section */}
                        <div className="flex flex-col gap-6">
                            <h2 className="text-xl font-normal">Memory Settings</h2>
                            <Card>
                                <CardItem
                                    title="Memory"
                                    description="Enable/disable memory"
                                    actions={
                                        <Switch
                                            checked={settings.memory_config.enabled}
                                            onCheckedChange={(checked) =>
                                                updateMemoryConfig({ enabled: checked })
                                            }
                                            disabled={saving}
                                        />
                                    }
                                />
                            </Card>
                        </div>

                        {/* Tools & Developer Section */}
                        <div className="flex flex-col gap-6">
                            <h2 className="text-xl font-normal">Tools & Developer</h2>
                            <Card>
                                <CardItem
                                    title="Enable MCP Tools"
                                    description="Allows agents to use tools like web search, memory retrieval, code execution"
                                    actions={
                                        <Switch
                                            checked={settings.enable_tools}
                                            onCheckedChange={(checked) =>
                                                updateSettings({ enable_tools: checked })
                                            }
                                            disabled={saving}
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
