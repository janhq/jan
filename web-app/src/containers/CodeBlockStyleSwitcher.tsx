// Available Shiki themes
// https://shiki.style/themes

const CODE_BLOCK_STYLES = [
  // Dark themes
  'andromeeda',
  'aurora-x',
  'ayu-dark',
  'catppuccin-frappe',
  'catppuccin-macchiato',
  'catppuccin-mocha',
  'dark-plus',
  'dracula',
  'dracula-soft',
  'everforest-dark',
  'github-dark',
  'github-dark-default',
  'github-dark-dimmed',
  'github-dark-high-contrast',
  'gruvbox-dark-hard',
  'gruvbox-dark-medium',
  'gruvbox-dark-soft',
  'houston',
  'kanagawa-dragon',
  'kanagawa-wave',
  'laserwave',
  'material-theme',
  'material-theme-darker',
  'material-theme-ocean',
  'material-theme-palenight',
  'min-dark',
  'monokai',
  'night-owl',
  'nord',
  'one-dark-pro',
  'plastic',
  'poimandres',
  'red',
  'rose-pine',
  'rose-pine-moon',
  'slack-dark',
  'slack-ochin',
  'solarized-dark',
  'synthwave-84',
  'tokyo-night',
  'vesper',
  'vitesse-black',
  'vitesse-dark',

  // Light themes
  'catppuccin-latte',
  'everforest-light',
  'github-light',
  'github-light-default',
  'github-light-high-contrast',
  'gruvbox-light-hard',
  'gruvbox-light-medium',
  'gruvbox-light-soft',
  'kanagawa-lotus',
  'light-plus',
  'material-theme-lighter',
  'min-light',
  'one-light',
  'rose-pine-dawn',
  'snazzy-light',
  'solarized-light',
  'vitesse-light',
]

import { useCodeblock } from '@/hooks/useCodeblock'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { IconSearch } from '@tabler/icons-react'
import { Input } from '@/components/ui/input'

// Function to format style names to be more readable
function formatStyleName(style: string): string {
  // Direct mappings for Shiki theme names
  const directMappings: Record<string, string> = {
    'andromeeda': 'Andromeeda',
    'aurora-x': 'Aurora X',
    'ayu-dark': 'Ayu Dark',
    'catppuccin-frappe': 'Catppuccin Frappé',
    'catppuccin-latte': 'Catppuccin Latte',
    'catppuccin-macchiato': 'Catppuccin Macchiato',
    'catppuccin-mocha': 'Catppuccin Mocha',
    'dark-plus': 'Dark Plus',
    'dracula': 'Dracula',
    'dracula-soft': 'Dracula Soft',
    'everforest-dark': 'Everforest Dark',
    'everforest-light': 'Everforest Light',
    'github-dark': 'GitHub Dark',
    'github-dark-default': 'GitHub Dark Default',
    'github-dark-dimmed': 'GitHub Dark Dimmed',
    'github-dark-high-contrast': 'GitHub Dark High Contrast',
    'github-light': 'GitHub Light',
    'github-light-default': 'GitHub Light Default',
    'github-light-high-contrast': 'GitHub Light High Contrast',
    'gruvbox-dark-hard': 'Gruvbox Dark Hard',
    'gruvbox-dark-medium': 'Gruvbox Dark Medium',
    'gruvbox-dark-soft': 'Gruvbox Dark Soft',
    'gruvbox-light-hard': 'Gruvbox Light Hard',
    'gruvbox-light-medium': 'Gruvbox Light Medium',
    'gruvbox-light-soft': 'Gruvbox Light Soft',
    'houston': 'Houston',
    'kanagawa-dragon': 'Kanagawa Dragon',
    'kanagawa-lotus': 'Kanagawa Lotus',
    'kanagawa-wave': 'Kanagawa Wave',
    'laserwave': 'LaserWave',
    'light-plus': 'Light Plus',
    'material-theme': 'Material Theme',
    'material-theme-darker': 'Material Theme Darker',
    'material-theme-lighter': 'Material Theme Lighter',
    'material-theme-ocean': 'Material Theme Ocean',
    'material-theme-palenight': 'Material Theme Palenight',
    'min-dark': 'Min Dark',
    'min-light': 'Min Light',
    'monokai': 'Monokai',
    'night-owl': 'Night Owl',
    'nord': 'Nord',
    'one-dark-pro': 'One Dark Pro',
    'one-light': 'One Light',
    'plastic': 'Plastic',
    'poimandres': 'Poimandres',
    'red': 'Red',
    'rose-pine': 'Rosé Pine',
    'rose-pine-dawn': 'Rosé Pine Dawn',
    'rose-pine-moon': 'Rosé Pine Moon',
    'slack-dark': 'Slack Dark',
    'slack-ochin': 'Slack Ochin',
    'snazzy-light': 'Snazzy Light',
    'solarized-dark': 'Solarized Dark',
    'solarized-light': 'Solarized Light',
    'synthwave-84': "Synthwave '84",
    'tokyo-night': 'Tokyo Night',
    'vesper': 'Vesper',
    'vitesse-black': 'Vitesse Black',
    'vitesse-dark': 'Vitesse Dark',
    'vitesse-light': 'Vitesse Light',
  }

  // Check for direct mappings first
  if (directMappings[style]) {
    return directMappings[style]
  }

  // Fallback: capitalize each word
  return style
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export default function CodeBlockStyleSwitcher() {
  const { codeBlockStyle, setCodeBlockStyle } = useCodeblock()
  const [searchQuery, setSearchQuery] = useState('')

  const changeCodeBlockStyle = (style: string) => {
    setCodeBlockStyle(style)
  }

  // Extract styles by category (44 dark themes, 17 light themes)
  const darkThemes = CODE_BLOCK_STYLES.slice(0, 44)
  const lightThemes = CODE_BLOCK_STYLES.slice(44)

  // Filter styles based on search query
  const filteredDarkThemes = darkThemes.filter((style) =>
    formatStyleName(style).toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredLightThemes = lightThemes.filter((style) =>
    formatStyleName(style).toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <span
          title="Edit Code Block Style"
          className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none text-main-view-fg font-medium"
        >
          {formatStyleName(codeBlockStyle || 'github-light')}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64 max-h-80 overflow-y-auto"
      >
        {/* Search input */}
        <div className="px-2 py-2 sticky -top-1 bg-main-view z-10">
          <div className="relative">
            <IconSearch className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4" />
            <Input
              type="text"
              placeholder="Search styles..."
              value={searchQuery}
              onClick={(e) => {
                e.stopPropagation()
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
              }}
              onChange={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setSearchQuery(e.target.value)
              }}
              className="w-full pl-8 pr-2"
              autoFocus
            />
          </div>
        </div>

        {/* Dark themes */}
        {filteredDarkThemes.length > 0 && (
          <>
            <DropdownMenuLabel className="font-medium text-xs px-2 pt-2 text-main-view-fg/60">
              Dark Themes
            </DropdownMenuLabel>
            {filteredDarkThemes.map((style) => (
              <DropdownMenuItem
                key={style}
                className={cn(
                  'cursor-pointer my-0.5',
                  codeBlockStyle === style && 'bg-main-view-fg/5'
                )}
                onClick={() => changeCodeBlockStyle(style)}
              >
                {formatStyleName(style)}
              </DropdownMenuItem>
            ))}
          </>
        )}

        {/* Light themes */}
        {filteredLightThemes.length > 0 && (
          <>
            <DropdownMenuLabel className="font-medium text-xs px-2 pt-2 text-main-view-fg/60">
              Light Themes
            </DropdownMenuLabel>
            {filteredLightThemes.map((style) => (
              <DropdownMenuItem
                key={style}
                className={cn(
                  'cursor-pointer my-0.5',
                  codeBlockStyle === style && 'bg-main-view-fg/5'
                )}
                onClick={() => changeCodeBlockStyle(style)}
              >
                {formatStyleName(style)}
              </DropdownMenuItem>
            ))}
          </>
        )}

        {/* No results message */}
        {filteredDarkThemes.length === 0 && filteredLightThemes.length === 0 && (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">
            No styles found
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
