import { useInterfaceSettings, useBlurSupport } from '@/hooks/useInterfaceSettings'
import { cn } from '@/lib/utils'
import { RgbaColor, RgbaColorPicker } from 'react-colorful'
import { IconColorPicker } from '@tabler/icons-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useTheme } from '@/hooks/useTheme'

export function ColorPickerAppBgColor() {
  const { appBgColor, setAppBgColor } = useInterfaceSettings()
  const { isDark } = useTheme()
  const { t } = useTranslation()
  const showAlphaSlider = useBlurSupport()

  // Helper to get alpha value based on blur support
  const getAlpha = (defaultAlpha: number) => {
    return showAlphaSlider ? defaultAlpha : 1
  }

  const predefineAppBgColor: RgbaColor[] = [
    isDark
      ? {
          r: 25,
          g: 25,
          b: 25,
          a: getAlpha(0.4),
        }
      : {
          r: 255,
          g: 255,
          b: 255,
          a: getAlpha(0.4),
        },
    {
      r: 70,
      g: 79,
      b: 229,
      a: getAlpha(0.5),
    },
    {
      r: 238,
      g: 130,
      b: 238,
      a: getAlpha(0.5),
    },

    {
      r: 255,
      g: 99,
      b: 71,
      a: getAlpha(0.5),
    },
    {
      r: 255,
      g: 165,
      b: 0,
      a: getAlpha(0.5),
    },
  ]

  // Check if a color is the default color (considering both dark and light themes)
  const isColorDefault = (color: RgbaColor): boolean => {
    const isDarkDefault = color.r === 25 && color.g === 25 && color.b === 25
    const isLightDefault = color.r === 255 && color.g === 255 && color.b === 255
    // Accept both 0.4 and 1 as valid default alpha values (handles blur detection timing)
    const hasDefaultAlpha = Math.abs(color.a - 0.4) < 0.01 || Math.abs(color.a - 1) < 0.01
    return (isDarkDefault || isLightDefault) && hasDefaultAlpha
  }

  return (
    <div className="flex items-center gap-1.5">
      {predefineAppBgColor.map((item, i) => {
        const isSelected =
          (item.r === appBgColor.r &&
            item.g === appBgColor.g &&
            item.b === appBgColor.b &&
            Math.abs(item.a - appBgColor.a) < 0.01) ||
          (isColorDefault(appBgColor) && isColorDefault(item))
        return (
          <div
            key={i}
            className={cn(
              'size-4 rounded-full border border-main-view-fg/20 cursor-pointer',
              isSelected && 'ring-2 ring-accent border-none'
            )}
            onClick={() => {
              setAppBgColor(item)
            }}
            style={{
              backgroundColor: `rgba(${item.r}, ${item.g}, ${item.b}, ${item.a})`,
            }}
          />
        )
      })}

      <div className="">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              title={t('common:pickColorWindowBackground')}
              className="size-6 cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out data-[state=open]:bg-main-view-fg/10"
            >
              <IconColorPicker size={18} className="text-main-view-fg/50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="border-none w-full h-full overflow-visible"
            side="right"
            align="start"
          >
            <RgbaColorPicker
              color={appBgColor}
              onChange={(color) => setAppBgColor(color)}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
