import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { ColorPickerAppBgColor } from '@/containers/ColorPickerAppBgColor'
import { ColorPickerAppMainView } from '@/containers/ColorPickerAppMainView'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ThemeSwitcher } from '@/containers/ThemeSwitcher'
import { FontSizeSwitcher } from '@/containers/FontSizeSwitcher'
import { ColorPickerAppPrimaryColor } from '@/containers/ColorPickerAppPrimaryColor'
import { ColorPickerAppAccentColor } from '@/containers/ColorPickerAppAccentColor'
import { ColorPickerAppDestructiveColor } from '@/containers/ColorPickerAppDestructiveColor'
import { useAppearance } from '@/hooks/useAppearance'
import { useCodeblock } from '@/hooks/useCodeblock'
import { Button } from '@/components/ui/button'
import CodeBlockStyleSwitcher from '@/containers/CodeBlockStyleSwitcher'
import { LineNumbersSwitcher } from '@/containers/LineNumbersSwitcher'
import { CodeBlockExample } from '@/containers/CodeBlockExample'
import { toast } from 'sonner'
import { ChatWidthSwitcher } from '@/containers/ChatWidthSwitcher'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.appearance as any)({
  component: Appareances,
})

function Appareances() {
  const { t } = useTranslation()
  const { resetAppearance } = useAppearance()
  const { resetCodeBlockStyle } = useCodeblock()

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common:settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full flex-col sm:flex-row">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* Appearance */}
            <Card title={t('settings:appearance.title')}>
              <CardItem
                title={t('settings:appearance.theme')}
                description={t('settings:appearance.themeDesc')}
                actions={<ThemeSwitcher />}
              />
              <CardItem
                title={t('settings:appearance.fontSize')}
                description={t('settings:appearance.fontSizeDesc')}
                actions={<FontSizeSwitcher />}
              />

              <CardItem
                title={t('settings:appearance.windowBackground')}
                description={t('settings:appearance.windowBackgroundDesc')}
                className="flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-y-2"
                actions={<ColorPickerAppBgColor />}
              />
              <CardItem
                title={t('settings:appearance.appMainView')}
                description={t('settings:appearance.appMainViewDesc')}
                className="flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-y-2"
                actions={<ColorPickerAppMainView />}
              />
              <CardItem
                title={t('settings:appearance.primary')}
                description={t('settings:appearance.primaryDesc')}
                className="flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-y-2"
                actions={<ColorPickerAppPrimaryColor />}
              />
              <CardItem
                title={t('settings:appearance.accent')}
                description={t('settings:appearance.accentDesc')}
                className="flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-y-2"
                actions={<ColorPickerAppAccentColor />}
              />
              <CardItem
                title={t('settings:appearance.destructive')}
                description={t('settings:appearance.destructiveDesc')}
                className="flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-y-2"
                actions={<ColorPickerAppDestructiveColor />}
              />
              <CardItem
                title={t('settings:appearance.resetToDefault')}
                description={t('settings:appearance.resetToDefaultDesc')}
                actions={
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      resetAppearance()
                      toast.success(
                        t('settings:appearance.resetAppearanceSuccess'),
                        {
                          id: 'reset-appearance',
                          description: t(
                            'settings:appearance.resetAppearanceSuccessDesc'
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

            {/* Chat Message */}
            <Card>
              <CardItem
                title={t('settings:appearance.chatWidth')}
                description={t('settings:appearance.chatWidthDesc')}
              />
              <ChatWidthSwitcher />
            </Card>

            {/* Codeblock */}
            <Card>
              <CardItem
                title={t('settings:appearance.codeBlockTitle')}
                description={t('settings:appearance.codeBlockDesc')}
                actions={<CodeBlockStyleSwitcher />}
              />
              <CodeBlockExample />
              <CardItem
                title={t('settings:appearance.showLineNumbers')}
                description={t('settings:appearance.showLineNumbersDesc')}
                actions={<LineNumbersSwitcher />}
              />
              <CardItem
                title={t('settings:appearance.resetCodeBlockStyle')}
                description={t('settings:appearance.resetCodeBlockStyleDesc')}
                actions={
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      resetCodeBlockStyle()
                      toast.success(
                        t('settings:appearance.resetCodeBlockSuccess'),
                        {
                          id: 'code-block-style',
                          description: t(
                            'settings:appearance.resetCodeBlockSuccessDesc'
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
