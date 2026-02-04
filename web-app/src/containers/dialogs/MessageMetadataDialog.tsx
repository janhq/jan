import { useState } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogHeader,
} from '@/components/ui/dialog'
import { IconInfoCircle } from '@tabler/icons-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import CodeEditor from '@uiw/react-textarea-code-editor'
import '@uiw/react-textarea-code-editor/dist.css'

interface MessageMetadataDialogProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: any
  triggerElement?: React.ReactNode
}

export function MessageMetadataDialog({
  metadata,
  triggerElement,
}: MessageMetadataDialogProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)

  const defaultTrigger = (
    <Tooltip>
      <TooltipTrigger asChild>
        <div 
<<<<<<< HEAD
          className="outline-0 focus:outline-0 flex items-center gap-1 hover:text-accent transition-colors cursor-pointer group relative"
=======
          className="outline-0 focus:outline-0 flex items-center gap-1 transition-colors cursor-pointer group relative"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setIsOpen(true)
            }
          }}
        >
          <IconInfoCircle size={16} />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>{t('metadata')}</p>
      </TooltipContent>
    </Tooltip>
  )

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
<<<<<<< HEAD
      <DialogTrigger>{triggerElement || defaultTrigger}</DialogTrigger>
=======
      <DialogTrigger asChild>{triggerElement || defaultTrigger}</DialogTrigger>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('common:dialogs.messageMetadata.title')}</DialogTitle>
          <div className="space-y-2 mt-4">
<<<<<<< HEAD
            <div className="border border-main-view-fg/10 rounded-md">
=======
            <div className="border  rounded-md">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
              <CodeEditor
                value={JSON.stringify(metadata || {}, null, 2)}
                language="json"
                readOnly
                data-color-mode="dark"
                style={{
                  fontSize: 12,
                  backgroundColor: 'transparent',
                  fontFamily: 'monospace',
                }}
<<<<<<< HEAD
                className="w-full h-full !text-sm "
=======
                className="w-full h-full text-sm!"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
              />
            </div>
          </div>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
