import { useInterfaceSettings, isDefaultColorDestructive } from '@/hooks/useInterfaceSettings'
import { cn } from '@/lib/utils'
import { RgbaColor, RgbaColorPicker } from 'react-colorful'
import { IconColorPicker } from '@tabler/icons-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme } from '@/hooks/useTheme'

export function ColorPickerAppDestructiveColor() {
  const { appDestructiveBgColor, setAppDestructiveBgColor } = useInterfaceSettings()
  const { isDark } = useTheme()

  const predefineAppDestructiveBgColor: RgbaColor[] = [
    isDark
      ? { r: 144, g: 60, b: 60, a: 1 }
      : {
          r: 217,
          g: 95,
          b: 95,
          a: 1,
        },
    {
      r: 220,
      g: 100,
      b: 45,
      a: 1,
    },
    {
      r: 180,
      g: 45,
      b: 120,
      a: 1,
    },
    {
      r: 150,
      g: 45,
      b: 180,
      a: 1,
    },
  ]

  return (
    <div className="flex items-center gap-1.5">
      {predefineAppDestructiveBgColor.map((item, i) => {
        const isSelected =
          (item.r === appDestructiveBgColor.r &&
          item.g === appDestructiveBgColor.g &&
          item.b === appDestructiveBgColor.b &&
          item.a === appDestructiveBgColor.a) ||
          (isDefaultColorDestructive(appDestructiveBgColor) && isDefaultColorDestructive(item))
        return (
          <div
            key={i}
            className={cn(
              'size-4 rounded-full border border-main-view-fg/20',
              isSelected && 'ring-2 ring-accent border-none'
            )}
            onClick={() => {
              setAppDestructiveBgColor(item)
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
              title="Pick Color App Destructive"
              className="size-6 cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out data-[state=open]:bg-main-view-fg/10"
            >
              <IconColorPicker size={18} className="text-main-view-fg/50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="border-none w-full h-full overflow-visible"
            side="right"
            align="start"
            style={{ zIndex: 9999 }}
          >
            <div>
              <RgbaColorPicker
                color={appDestructiveBgColor}
                onChange={(color) => {
                  setAppDestructiveBgColor(color)
                }}
              />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
