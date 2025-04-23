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
        <div className="flex h-full w-48 shrink-0 px-1.5 pt-3 border-r border-neutral-800">
          <SettingsMenu />
        </div>
        <div className="p-4 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 w-full">
            {/* Data folder */}
            <div className="bg-neutral-800/40 p-4 rounded-lg text-neutral-300 w-full">
              <h1 className="font-medium text-base mb-4">Appearance</h1>
              <div className="flex justify-between items-center mt-2 border-b border-neutral-800 pb-3 last:border-none last:pb-0 gap-8">
                <div className="space-y-1">
                  <h1 className="font-medium">Theme</h1>
                  <p className="text-neutral-400 leading-normal">
                    Native appearance for consistent theming across OS UI
                    elements
                  </p>
                </div>
                <div className="shrink-0">
                  <ThemeSwitcher />
                </div>
              </div>
              <div className="flex justify-between items-center mt-2 border-b border-neutral-800 pb-3 last:border-none last:pb-0 gap-8">
                <div className="space-y-1">
                  <h1 className="font-medium">Font Size</h1>
                  <p className="text-neutral-400 leading-normal">
                    Scaling the size of text in the app
                  </p>
                </div>
                <div className="shrink-0">
                  <FontSizeSelector />
                </div>
              </div>
            </div>

            <div className="bg-neutral-800/40 p-4 rounded-lg text-neutral-300 w-full">
              <h1 className="font-medium text-base mb-4">Custom color</h1>
              <div className="flex justify-between items-center mt-2 border-b border-neutral-800 pb-3 last:border-none last:pb-0 gap-8">
                <div className="space-y-1">
                  <h1 className="font-medium">Window Background</h1>
                  <p className="text-neutral-400 leading-normal">
                    Choose the App window color
                  </p>
                </div>
                <div className="shrink-0">
                  <ColorPickerAppBgColor />
                </div>
              </div>
              <div className="flex justify-between items-center mt-2 border-b border-neutral-800 pb-3 last:border-none last:pb-0 gap-8">
                <div className="space-y-1">
                  <h1 className="font-medium">App Main View</h1>
                  <p className="text-neutral-400 leading-normal">
                    Sets the background color for the main content area
                  </p>
                </div>
                {/* <div className="shrink-0">
                  <ColorPicker />
                </div> */}
              </div>
              <div className="flex justify-between items-center mt-2 border-b border-neutral-800 pb-3 last:border-none last:pb-0 gap-8">
                <div className="space-y-1">
                  <h1 className="font-medium">Primary</h1>
                  <p className="text-neutral-400 leading-normal">
                    Controls the primary color used for components
                  </p>
                </div>
                {/* <div className="shrink-0">
                  <ColorPicker />
                </div> */}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
