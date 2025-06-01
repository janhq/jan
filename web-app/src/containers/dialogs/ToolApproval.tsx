import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToolApproval } from '@/hooks/useToolApproval'
import { AlertTriangle } from 'lucide-react'

export default function ToolApproval() {
  const { isModalOpen, modalProps, setModalOpen } = useToolApproval()

  if (!modalProps) {
    return null
  }

  const { toolName, onApprove, onDeny } = modalProps

  const handleAllowOnce = () => {
    onApprove(true) // true = allow once only
  }

  const handleAllow = () => {
    onApprove(false) // false = remember for this thread
  }

  const handleDeny = () => {
    onDeny()
  }

  return (
    <Dialog open={isModalOpen} onOpenChange={setModalOpen}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="shrink-0">
              <AlertTriangle className="size-4" />
            </div>
            <div>
              <DialogTitle>Tool Call Request</DialogTitle>
              <DialogDescription className="mt-1 text-main-view-fg/70">
                The assistant wants to use the tool: <strong>{toolName}</strong>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="bg-main-view-fg/8 p-2 border border-main-view-fg/5 rounded-lg">
          <p className="text-sm text-main-view-fg/70 leading-relaxed">
            <strong>Security Notice:</strong> Malicious tools or conversation
            content could potentially trick the assistant into attempting
            harmful actions. Review each tool call carefully before approving.
          </p>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="link" onClick={handleDeny} className="w-full">
            Deny
          </Button>
          <Button
            variant="link"
            onClick={handleAllowOnce}
            className="border border-main-view-fg/20"
          >
            Allow Once
          </Button>
          <Button variant="default" onClick={handleAllow}>
            Always Allow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
