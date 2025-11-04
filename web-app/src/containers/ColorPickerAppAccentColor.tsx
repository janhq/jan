import { useInterfaceSettings, isDefaultColorAccent } from '@/hooks/useInterfaceSettings'
import { cn } from '@/lib/utils'
import { RgbaColor, RgbaColorPicker } from 'react-colorful'
import { IconColorPicker } from '@tabler/icons-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function ColorPickerAppAccentColor() {
  const { appAccentBgColor, setAppAccentBgColor } = useInterfaceSettings()

  const predefineAppAccentBgColor: RgbaColor[] = [
    {
      r: 45,
      g: 120,
      b: 220,
      a: 1,
    },
    {
      r: 220,
      g: 45,
      b: 120,
      a: 1,
    },

    {
      r: 180,
      g: 120,
      b: 45,
      a: 1,
    },
  ]

  return (
    <div className="flex items-center gap-1.5">
      {predefineAppAccentBgColor.map((item, i) => {
        const isSelected =
          (item.r === appAccentBgColor.r &&
          item.g === appAccentBgColor.g &&
          item.b === appAccentBgColor.b &&
          item.a === appAccentBgColor.a) ||
          (isDefaultColorAccent(appAccentBgColor) && isDefaultColorAccent(item))
        return (
          <div
            key={i}
            className={cn(
              'size-4 rounded-full border border-main-view-fg/20',
              isSelected && 'ring-2 ring-accent border-none'
            )}
            onClick={() => {
              setAppAccentBgColor(item)
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
              title="Pick Color App Accent"
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
                color={appAccentBgColor}
                onChange={(color) => {
                  setAppAccentBgColor(color)
                }}
              />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
