import { IconSettings } from '@tabler/icons-react'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

type ModelSettingProps = {
  model: Model
}

export function ModelSetting({ model }: ModelSettingProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <div className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out">
          <IconSettings size={18} className="text-main-view-fg/50" />
        </div>
      </SheetTrigger>
      <SheetContent className="h-[calc(100%-8px)] top-1 right-1 rounded-e-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Model Setting {model.id}</SheetTitle>
          <SheetDescription>
            Make changes to your profile here. Click save when you're done.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4">
          <p>
            Lorem, ipsum dolor sit amet consectetur adipisicing elit.
            Consequatur excepturi reprehenderit, nihil cupiditate aperiam
            impedit! Ducimus veniam animi vel cumque minima ut mollitia, vero
            vitae sunt odio ratione nisi officiis?
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
