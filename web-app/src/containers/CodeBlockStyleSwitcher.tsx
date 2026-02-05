// Available styles from react-syntax-highlighter/prism
// https://github.com/react-syntax-highlighter/react-syntax-highlighter/blob/master/AVAILABLE_STYLES_PRISM.MD

const CODE_BLOCK_STYLES = [
  // Dark themes
  'a11y-dark',
  'atom-dark',
  'darcula',
  'dark',
  'dracula',
  'duotone-dark',
  'gruvbox-dark',
  'material-dark',
  'material-oceanic',
  'night-owl',
  'nord',
  'okaidia',
  'one-dark',
  'shades-of-purple',
  'solarized-dark-atom',
  'synthwave84',
  'twilight',
  'vsc-dark-plus',
  'xonokai',

  // Light themes
  'coldark-cold',
  'coy',
  'coy-without-shadows',
  'duotone-light',
  'ghcolors',
  'gruvbox-light',
  'material-light',
  'one-light',
  'prism',
  'solarizedlight',
  'vs',

  // Special themes
  'cb',
  'coldark-dark',
  'duotone-earth',
  'duotone-forest',
  'duotone-sea',
  'duotone-space',
  'funky',
  'holi-theme',
  'hopscotch',
  'lucario',
  'pojoaque',
  'tomorrow',
  'z-touch',
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
  // Special cases for abbreviations and specific terms
  const specialCases: Record<string, string> = {
    a11y: 'Accessibility',
    cb: 'CB',
    vsc: 'VSCode',
    vs: 'Visual Studio',
    ghcolors: 'GitHub Colors',
  }

  // Direct mappings for compound names that need special formatting
  const directMappings: Record<string, string> = {
    'solarized-dark-atom': 'Solarized Dark (Atom)',
    'solarizedlight': 'Solarized Light',
    'coy-without-shadows': 'Coy (Without Shadows)',
    'gruvbox-dark': 'Gruvbox Dark',
    'gruvbox-light': 'Gruvbox Light',
    'material-dark': 'Material Dark',
    'material-light': 'Material Light',
    'material-oceanic': 'Material Oceanic',
    'night-owl': 'Night Owl',
    'one-dark': 'One Dark',
    'one-light': 'One Light',
    'shades-of-purple': 'Shades of Purple',
    'coldark-cold': 'Coldark Cold',
    'coldark-dark': 'Coldark Dark',
    'holi-theme': 'Holi Theme',
    'synthwave84': 'Synthwave 84',
    'vsc-dark-plus': 'VSCode Dark+',
    'atom-dark': 'Atom Dark',
    'duotone-dark': 'Duotone Dark',
    'duotone-earth': 'Duotone Earth',
    'duotone-forest': 'Duotone Forest',
    'duotone-light': 'Duotone Light',
    'duotone-sea': 'Duotone Sea',
    'duotone-space': 'Duotone Space',
  }

  // Check for direct mappings first
  if (directMappings[style]) {
    return directMappings[style]
  }

  // Process other styles
  return style
    .split('-')
    .map((part) => {
      // Check for special cases
      if (specialCases[part]) {
        return specialCases[part]
      }

      // Handle duotone prefix (fallback for any not in directMappings)
      if (part.startsWith('duotone')) {
        return 'Duotone ' + part.replace('duotone', '')
      }

      // Capitalize first letter of each word
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')
}

export default function CodeBlockStyleSwitcher() {
  const { codeBlockStyle, setCodeBlockStyle } = useCodeblock()
  const [searchQuery, setSearchQuery] = useState('')

  const changeCodeBlockStyle = (style: string) => {
    setCodeBlockStyle(style)
  }

  // Extract styles by category
  const darkThemes = CODE_BLOCK_STYLES.slice(1, 20)
  const lightThemes = CODE_BLOCK_STYLES.slice(22, 33)
  const specialThemes = CODE_BLOCK_STYLES.slice(35)

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
          {formatStyleName(codeBlockStyle || 'one-light')}
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
