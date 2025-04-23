import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { ColorPickerAppBgColor } from '@/containers/ColorPickerAppBgColor'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useAppearance, fontSizeOptions, FontSize } from '@/hooks/useAppearance'
import { useTheme } from '@/hooks/useTheme'
import { ColorPickerAppMainView } from '@/containers/ColorPickerAppMainView'
import { CardSetting, CardSettingItem } from '@/containers/CardSetting'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.appearance as any)({
  component: Appareances,
})

function FontSizeSelector() {
  const { fontSize, setFontSize } = useAppearance()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1 px-2 py-1 rounded-sm bg-neutral-700 text-sm outline-none">
        <span>
          {fontSizeOptions.find(
            (item: { value: string; label: string }) => item.value === fontSize
          )?.label || 'Medium'}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-24 bg-neutral-950 text-neutral-300 border border-neutral-800"
      >
        {fontSizeOptions.map((item: { value: string; label: string }) => (
          <DropdownMenuItem
            key={item.value}
            className={cn(
              'cursor-pointer',
              fontSize === item.value && 'bg-neutral-700'
            )}
            onClick={() => setFontSize(item.value as FontSize)}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ThemeSwitcher() {
  const themeOptions = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'auto', label: 'Auto' },
  ]

  const { setTheme, activeTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1 px-2 py-1 rounded-sm bg-neutral-700 text-sm outline-none">
        <span>
          {themeOptions.find((item) => item.value === activeTheme)?.label ||
            'Auto'}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-24 bg-neutral-950 text-neutral-300 border border-neutral-800"
      >
        {themeOptions.map((item) => (
          <DropdownMenuItem
            key={item.value}
            className={cn(
              'cursor-pointer',
              activeTheme === item.value && 'bg-neutral-700'
            )}
            onClick={() => setTheme(item.value as 'auto' | 'light' | 'dark')}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Appareances() {
  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">Settings</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />

        <div className="p-4 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-2 w-full">
            {/* Appearance */}
            <CardSetting title="Appearance">
              <CardSettingItem
                title="Theme"
                description="Native appearance for consistent theming across OS UI elements"
                actions={<ThemeSwitcher />}
              />
              <CardSettingItem
                title="Font Size"
                actions={<FontSizeSelector />}
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
                actions={<></>}
              />
            </CardSetting>
          </div>
        </div>
      </div>
    </div>
  )
}
