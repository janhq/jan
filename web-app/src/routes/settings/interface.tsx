import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ThemeSwitcher } from '@/containers/ThemeSwitcher'
import { FontSizeSwitcher } from '@/containers/FontSizeSwitcher'
import { AccentColorPicker } from '@/containers/AccentColorPicker'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.interface as any)({
  component: InterfaceSettings,
})

function InterfaceSettings() {
  const { t } = useTranslation()
  const { resetInterface } = useInterfaceSettings()

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className='font-medium text-base font-studio'>{t('common:settings')}</span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* Interface */}
            <Card title={t('settings:interface.title')}>
              <CardItem
                title={t('settings:interface.theme')}
                description={t('settings:interface.themeDesc')}
                actions={<ThemeSwitcher />}
              />
              <CardItem
                title={t('settings:interface.fontSize')}
                description={t('settings:interface.fontSizeDesc')}
                actions={<FontSizeSwitcher />}
              />
              <CardItem
                title="Accent color"
                description="Customize the accent color of the application."
                className="flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-y-2"
                actions={<AccentColorPicker />}
              />
              <CardItem
                title={t('settings:interface.resetToDefault')}
                description={t('settings:interface.resetToDefaultDesc')}
                actions={
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      resetInterface()
                      toast.success(
                        t('settings:interface.resetInterfaceSuccess'),
                        {
                          id: 'reset-interface',
                          description: t(
                            'settings:interface.resetInterfaceSuccessDesc'
                          ),
                        }
                      )
                    }}
                  >
                    {t('common:reset')}
                  </Button>
                }
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
