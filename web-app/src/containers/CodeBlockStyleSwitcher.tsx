// Shiki theme switcher for code blocks
// Available themes: https://shiki.style/themes

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

// Function to format Shiki theme names to be more readable
function formatStyleName(style: string): string {
  // Direct mappings for Shiki theme names
  const directMappings: Record<string, string> = {
    'github-dark': 'GitHub Dark',
    'github-light': 'GitHub Light',
    'github-light-default': 'GitHub Light (Default)',
    'dark-plus': 'Dark+ (VS Code)',
    'light-plus': 'Light+ (VS Code)',
    'one-dark-pro': 'One Dark Pro',
    'material-theme': 'Material Theme',
    'material-theme-darker': 'Material Theme Darker',
    'material-theme-lighter': 'Material Theme Lighter',
    'material-theme-ocean': 'Material Theme Ocean',
    'material-theme-palenight': 'Material Theme Palenight',
    'night-owl': 'Night Owl',
    'tokyo-night': 'Tokyo Night',
    'tokyo-night-storm': 'Tokyo Night Storm',
    'tokyo-night-light': 'Tokyo Night Light',
    'slack-dark': 'Slack Dark',
    'slack-light': 'Slack Light',
    'slack-ochin': 'Slack Ochin',
    'solarized-dark': 'Solarized Dark',
    'solarized-light': 'Solarized Light',
    'vitesse-dark': 'Vitesse Dark',
    'vitesse-light': 'Vitesse Light',
    'catppuccin-mocha': 'Catppuccin Mocha',
    'catppuccin-macchiato': 'Catppuccin Macchiato',
    'catppuccin-latte': 'Catppuccin Latte',
    'ayu-dark': 'Ayu Dark',
    'ayu-light': 'Ayu Light',
    'min-light': 'Min Light',
    'min-dark': 'Min Dark',
    'synthwave-84': 'Synthwave 84',
    'rose-pine': 'Rosé Pine',
    'rose-pine-moon': 'Rosé Pine Moon',
    'rose-pine-dawn': 'Rosé Pine Dawn',
    'everforest-dark': 'Everforest Dark',
    'everforest-light': 'Everforest Light',
    'kanagawa-wave': 'Kanagawa Wave',
    'kanagawa-dragon': 'Kanagawa Dragon',
    'kanagawa-lotus': 'Kanagawa Lotus',
  }

  // Check for direct mappings first
  if (directMappings[style]) {
    return directMappings[style]
  }

  // Fallback: capitalize and format unknown themes
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

  // Extract styles by category based on valid Shiki bundled themes
  const darkThemes = [
    'github-dark',
    'dark-plus',
    'one-dark-pro',
    'monokai',
    'dracula',
    'nord',
    'tokyo-night',
    'material-theme-darker',
    'material-theme-ocean',
    'night-owl',
    'slack-dark',
    'slack-ochin',
    'solarized-dark',
    'vitesse-dark',
    'catppuccin-mocha',
    'catppuccin-macchiato',
    'ayu-dark',
    'synthwave-84',
    'houston',
    'min-dark',
  ]

  const lightThemes = [
    'github-light',
    'light-plus',
    'material-theme-lighter',
    'min-light',
    'solarized-light',
    'vitesse-light',
    'catppuccin-latte',
  ]

  const specialThemes = [
    'material-theme',
    'material-theme-palenight',
    'rose-pine',
    'rose-pine-moon',
    'rose-pine-dawn',
  ]

  // Filter styles based on search query
  const filteredDarkThemes = darkThemes.filter((style) =>
    formatStyleName(style).toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredLightThemes = lightThemes.filter((style) =>
    formatStyleName(style).toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredSpecialThemes = specialThemes.filter((style) =>
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

        {/* Special themes */}
        {filteredSpecialThemes.length > 0 && (
          <>
            <DropdownMenuLabel className="font-medium text-xs px-2 pt-2 text-main-view-fg/60">
              Special Themes
            </DropdownMenuLabel>
            {filteredSpecialThemes.map((style) => (
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
        {filteredDarkThemes.length === 0 &&
          filteredLightThemes.length === 0 &&
          filteredSpecialThemes.length === 0 && (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              No styles found
            </div>
          )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
