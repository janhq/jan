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
import { useTranslation } from '@/i18n/react-i18next-compat'

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
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconFolder size={20} />
            {t('settings:dialogs.changeDataFolder.title')}
          </DialogTitle>
          <DialogDescription>
            {t('settings:dialogs.changeDataFolder.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
<<<<<<< HEAD
            <h4 className="text-sm font-medium text-main-view-fg/80 mb-2">
              {t('settings:dialogs.changeDataFolder.currentLocation')}
            </h4>
            <div className="bg-main-view-fg/5 border border-main-view-fg/10 rounded">
              <code className="text-xs text-main-view-fg/70 break-all">
=======
            <h4 className="text-sm font-medium mb-2">
              {t('settings:dialogs.changeDataFolder.currentLocation')}
            </h4>
            <div className="bg-secondary border p-2 rounded-lg">
              <code className="text-xs text-muted-foreground break-all">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                {currentPath}
              </code>
            </div>
          </div>

          <div>
<<<<<<< HEAD
            <h4 className="text-sm font-medium text-main-view-fg/80 mb-2">
              {t('settings:dialogs.changeDataFolder.newLocation')}
            </h4>
            <div className="bg-accent/10 border border-accent/20 rounded">
              <code className="text-xs text-accent break-all">{newPath}</code>
=======
            <h4 className="text-sm font-medium mb-2">
              {t('settings:dialogs.changeDataFolder.newLocation')}
            </h4>
            <div className="bg-secondary border p-2 rounded-lg">
              <code className="text-xs break-all">{newPath}</code>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            </div>
          </div>
        </div>

        <DialogFooter className="flex items-center gap-2">
          <DialogClose asChild>
<<<<<<< HEAD
            <Button variant="link" size="sm">
=======
            <Button variant="ghost" size="sm">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
              {t('settings:dialogs.changeDataFolder.cancel')}
            </Button>
          </DialogClose>
          <DialogClose asChild>
<<<<<<< HEAD
            <Button onClick={onConfirm}>
=======
            <Button size="sm" onClick={onConfirm}>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
              {t('settings:dialogs.changeDataFolder.changeLocation')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
