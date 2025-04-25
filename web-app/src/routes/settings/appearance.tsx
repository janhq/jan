import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { ColorPickerAppBgColor } from '@/containers/ColorPickerAppBgColor'

import { ColorPickerAppMainView } from '@/containers/ColorPickerAppMainView'
import { CardSetting, CardSettingItem } from '@/containers/CardSetting'
import { useTranslation } from 'react-i18next'
import { ThemeSwitcher } from '@/containers/ThemeSwitcher'
import { FontSizeSwitcher } from '@/containers/FontSizeSwitcher'
import { ColorPickerAppPrimaryColor } from '@/containers/ColorPickerAppPrimaryColor'
import { useAppearance } from '@/hooks/useAppearance'
import { Button } from '@/components/ui/button'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.appearance as any)({
  component: Appareances,
})

function Appareances() {
  const { t } = useTranslation()
  const { resetAppearance } = useAppearance()

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* Appearance */}
            <CardSetting title="Appearance">
              <CardSettingItem
                title="Theme"
                description="Native appearance for consistent theming across OS UI elements"
                actions={<ThemeSwitcher />}
              />
              <CardSettingItem
                title="Font Size"
                description="Adjust the size of text across the app"
                actions={<FontSizeSwitcher />}
              />
            </CardSetting>

            {/* Custom color */}
            <CardSetting title="Custom color">
              <CardSettingItem
                title="Window Background"
                description="Choose the App window color"
                actions={<ColorPickerAppBgColor />}
              />
              <CardSettingItem
                title="App Main View"
                description="Sets the background color for the main content area"
                actions={<ColorPickerAppMainView />}
              />
              <CardSettingItem
                title="Primary"
                description="Controls the primary color used for components"
                actions={<ColorPickerAppPrimaryColor />}
              />
              <CardSettingItem
                title="Reset to Default"
                description="Reset all colors to their default values"
                actions={
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => resetAppearance()}
                  >
                    {t('common.reset')}
                  </Button>
                }
              />
            </CardSetting>
          </div>
        </div>
      </div>
    </div>
  )
}
