import { useAppearance } from '@/hooks/useAppearance'
import { cn } from '@/lib/utils'
import { RgbaColor, RgbaColorPicker } from 'react-colorful'
import { IconColorPicker } from '@tabler/icons-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function ColorPickerAppMainView() {
  const { appMainViewBgColor, setAppMainViewBgColor } = useAppearance()

  const predefineAppMainViewBgColor: RgbaColor[] = [
    {
      r: 251,
      g: 251,
      b: 251,
      a: 1,
    },
    {
      r: 24,
      g: 24,
      b: 24,
      a: 1,
    },
  ]

  return (
    <div className="flex items-center gap-1.5">
      {predefineAppMainViewBgColor.map((item, i) => {
        const isSelected =
          item.r === appMainViewBgColor.r &&
          item.g === appMainViewBgColor.g &&
          item.b === appMainViewBgColor.b &&
          item.a === appMainViewBgColor.a
        return (
          <div
            key={i}
            className={cn(
              'size-4 rounded-full border border-main-view-fg/20',
              isSelected && 'ring-2 ring-accent border-none'
            )}
            onClick={() => {
              setAppMainViewBgColor(item)
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
              title="Pick Color App Main View"
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
              color={appMainViewBgColor}
              onChange={(color) => setAppMainViewBgColor(color)}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
