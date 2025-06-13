import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconFolder } from '@tabler/icons-react'

interface ChangeDataFolderLocationProps {
  children: React.ReactNode
  currentPath: string
  newPath: string
  onConfirm: () => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function ChangeDataFolderLocation({
  children,
  currentPath,
  newPath,
  onConfirm,
  open,
  onOpenChange,
}: ChangeDataFolderLocationProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconFolder size={20} />
            Change Data Folder Location
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to change the data folder location? This will
            move all your data to the new location and restart the application.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium text-main-view-fg/80 mb-2">
              Current Location:
            </h4>
            <div className="bg-main-view-fg/5 border border-main-view-fg/10 rounded">
              <code className="text-xs text-main-view-fg/70 break-all">
                {currentPath}
              </code>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium text-main-view-fg/80 mb-2">
              New Location:
            </h4>
            <div className="bg-accent/10 border border-accent/20 rounded">
              <code className="text-xs text-accent break-all">{newPath}</code>
            </div>
          </div>
        </div>

        <DialogFooter className="flex items-center gap-2">
          <DialogClose asChild>
            <Button variant="link" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button onClick={onConfirm}>Change Location</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
