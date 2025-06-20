import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'

interface DeleteMCPServerConfirmProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  serverName: string
  onConfirm: () => void
}

export default function DeleteMCPServerConfirm({
  open,
  onOpenChange,
  serverName,
  onConfirm,
}: DeleteMCPServerConfirmProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('mcp-servers:deleteServer.title')}</DialogTitle>
          <DialogDescription>
            {t('mcp-servers:deleteServer.description', { serverName })}
            <span className="font-medium text-main-view-fg">{serverName}</span>?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            {t('mcp-servers:deleteServer.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
