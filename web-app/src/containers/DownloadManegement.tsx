import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { IconPlayerPauseFilled, IconX } from '@tabler/icons-react'

export function DownloadManagement() {
  return (
    <Popover>
      <PopoverTrigger>
        <div className="bg-left-panel-fg/10 hover:bg-left-panel-fg/12 p-2 rounded-md my-1 relative border border-left-panel-fg/10 cursor-pointer text-left">
          <div className="bg-primary font-bold size-5 rounded-full absolute -top-2 -right-1 flex items-center justify-center text-primary-fg">
            2
          </div>
          <p className="text-left-panel-fg/80 font-medium">Downloads</p>
          <div className="mt-2 flex items-center justify-between space-x-2">
            <Progress value={20} />
            <span className="text-xs font-medium text-main-view-fg/80 shrink-0">
              20%
            </span>
          </div>
        </div>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        className="p-0 overflow-hidden text-sm select-none"
        sideOffset={6}
      >
        <div className="flex flex-col">
          <div className="p-2 py-1.5 bg-main-view-fg/5 border-b border-main-view-fg/6">
            <p className="text-xs text-main-view-fg/70">Downloading</p>
          </div>
          <div className="p-2 max-h-[300px] overflow-y-auto space-y-2">
            <div className="bg-main-view-fg/4 rounded-md p-2">
              <div className="flex items-center justify-between">
                <p className="truncate text-main-view-fg/80">llama3.2:1b</p>
                <div className="shrink-0 flex items-center space-x-0.5">
                  <IconPlayerPauseFilled
                    size={16}
                    className="text-main-view-fg/70 cursor-pointer"
                    title="Pause download"
                  />
                  <IconX
                    size={16}
                    className="text-main-view-fg/70 cursor-pointer"
                    title="Cancel download"
                  />
                </div>
              </div>
              <Progress value={25} className="my-2" />
              <p className="text-main-view-fg/60 text-xs">
                1065.28 MB/4.13 GB (25%)
              </p>
            </div>

            <div className="bg-main-view-fg/4 rounded-md p-2">
              <div className="flex items-center justify-between">
                <p className="truncate text-main-view-fg/80">
                  deepseek-r1:1.5b
                </p>
                <div className="shrink-0 flex items-center space-x-0.5">
                  <IconPlayerPauseFilled
                    size={16}
                    className="text-main-view-fg/70 cursor-pointer"
                    title="Pause download"
                  />
                  <IconX
                    size={16}
                    className="text-main-view-fg/70 cursor-pointer"
                    title="Cancel download"
                  />
                </div>
              </div>
              <Progress value={80} className="my-2" />
              <p className="text-main-view-fg/60 text-xs">
                1065.28 MB/4.13 GB (80%)
              </p>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
