import { useAppearance } from '@/hooks/useAppearance'
import { cn } from '@/lib/utils'
import { RgbaColor, RgbaColorPicker } from 'react-colorful'
import { IconColorPicker } from '@tabler/icons-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function ColorPickerAppBgColor() {
  const { appBgColor, setAppBgColor } = useAppearance()

  const predefineAppBgColor: RgbaColor[] = [
    {
      r: 70,
      g: 79,
      b: 229,
      a: 0.5,
    },
    {
      r: 238,
      g: 130,
      b: 238,
      a: 0.5,
    },

    {
      r: 255,
      g: 99,
      b: 71,
      a: 0.5,
    },
    {
      r: 255,
      g: 165,
      b: 0,
      a: 0.5,
    },
  ]

  return (
    <div className="flex items-center gap-2">
      {predefineAppBgColor.map((item, i) => {
        const isSelected =
          item.r === appBgColor.r &&
          item.g === appBgColor.g &&
          item.b === appBgColor.b &&
          item.a === appBgColor.a
        return (
          <div
            key={i}
            className={cn(
              'w-4 h-4 rounded-full',
              isSelected && 'ring-2 ring-blue-500'
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
            <button className="size-6 flex items-center justify-center rounded hover:bg-neutral-800/10 transition-all duration-200 ease-in-out data-[state=open]:bg-neutral-800/10 cursor-pointer">
              <IconColorPicker size={18} className="text-neutral-300/60" />
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
