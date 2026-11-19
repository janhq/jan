import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { Attachment } from '@/types/attachment'

interface AttachmentPreviewDialogProps {
  attachment: Attachment | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function AttachmentPreviewDialog({
  attachment,
  open,
  onOpenChange,
}: AttachmentPreviewDialogProps) {
  if (!attachment) return null

  const isImageView = attachment.type === 'image' && attachment.dataUrl
  const hasInlineContent = !!attachment.inlineContent
  
  // Calculate file size and line count from content
  const contentLength = hasInlineContent 
    ? new Blob([attachment.inlineContent as string]).size 
    : 0
  const lineCount = hasInlineContent 
    ? attachment.inlineContent?.split('\n').length ?? 0
    : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        {/* Header row with file name */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-sm truncate">{attachment.name}</h3>
        </div>

        {/* File info row: file size • line count */}
        <div className="flex items-center gap-3 text-sm text-muted-foreground mb-3 pb-2 border-b">
          <span>{formatBytes(contentLength)}</span>
          <span>•</span>
          <span>{lineCount} lines</span>
        </div>

        {/* Content area */}
        {isImageView ? (
          <div className="flex-1 overflow-auto flex justify-center">
            <img
              src={attachment.dataUrl}
              alt={attachment.name}
              className="max-w-full max-h-[60vh] object-contain rounded"
            />
          </div>
        ) : hasInlineContent ? (
          <div className="flex-1">
            <textarea
              readOnly
              value={attachment.inlineContent}
              className="w-full h-full min-h-[300px] resize-none border-1 bg-secondary text-sm p-3 font-mono leading-relaxed outline-none overflow-y-auto shadow-[2px_2px_6px_0px_rgba(255,255,255,0.1)]"
              wrap="soft"
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <p>Preview not available for this file type</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Simple utility for formatting bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (
    parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  )
}
