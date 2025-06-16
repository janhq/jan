import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { ColorPickerAppBgColor } from '@/containers/ColorPickerAppBgColor'
import { ColorPickerAppMainView } from '@/containers/ColorPickerAppMainView'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from 'react-i18next'
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
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* Appearance */}
            <Card title="Appearance">
              <CardItem
                title="Theme"
                description="Native appearance for consistent theming across OS UI elements"
                actions={<ThemeSwitcher />}
              />
              <CardItem
                title="Font Size"
                description="Adjust the size of text across the app"
                actions={<FontSizeSwitcher />}
              />

              <CardItem
                title="Window Background"
                description="Choose the App window color"
                actions={<ColorPickerAppBgColor />}
              />
              <CardItem
                title="App Main View"
                description="Sets the background color for the main content area"
                actions={<ColorPickerAppMainView />}
              />
              <CardItem
                title="Primary"
                description="Controls the primary color used for components"
                actions={<ColorPickerAppPrimaryColor />}
              />
              <CardItem
                title="Accent"
                description="Controls the accent color used for highlights"
                actions={<ColorPickerAppAccentColor />}
              />
              <CardItem
                title="Destructive"
                description="Controls the color used for destructive actions"
                actions={<ColorPickerAppDestructiveColor />}
              />
              <CardItem
                title="Reset to Default"
                description="Reset all colors to their default values"
                actions={
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      resetAppearance()
                      toast.success('Appearance Reset', {
                        id: 'reset-appearance',
                        description:
                          'Your appearance settings have been restored to default.',
                      })
                    }}
                  >
                    {t('common.reset')}
                  </Button>
                }
              />
            </Card>

            {/* Chat Message */}
            <Card>
              <CardItem
                title="Chat Width"
                description="Choose the width of the chat area to customize your conversation view."
              />
              <ChatWidthSwitcher />
            </Card>

            {/* Codeblock */}
            <Card>
              <CardItem
                title="Code Block"
                description="Choose the style for code block syntax highlighting"
                actions={<CodeBlockStyleSwitcher />}
              />
              <CodeBlockExample />
              <CardItem
                title="Show Line Numbers"
                description="Toggle line numbers in code blocks"
                actions={<LineNumbersSwitcher />}
              />
              <CardItem
                title="Reset Code Block Style"
                description="Reset code block style to default"
                actions={
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      resetCodeBlockStyle()
                      toast.success('Code Block Reset', {
                        id: 'code-block-style',
                        description:
                          'Your Code Block style settings have been restored to default.',
                      })
                    }}
                  >
                    {t('common.reset')}
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
