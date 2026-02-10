import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogClose,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { IconFile, IconPencil, IconX } from '@tabler/icons-react'
import {
  extractFilesFromPrompt,
  injectFilesIntoPrompt,
  FileMetadata,
} from '@/lib/fileMetadata'
import { useModelProvider } from '@/hooks/useModelProvider'

interface EditMessageDialogProps {
  message: string
  imageUrls?: string[]
  onSave: (message: string) => void
  triggerElement?: React.ReactNode
}

export function EditMessageDialog({
  message,
  imageUrls,
  onSave,
  triggerElement,
}: EditMessageDialogProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const { files: initialFiles, cleanPrompt: initialCleanPrompt } = useMemo(
    () => extractFilesFromPrompt(message),
    [message]
  )
  const [draft, setDraft] = useState(initialCleanPrompt)
  const [keptImages, setKeptImages] = useState<string[]>(imageUrls || [])
  const [keptFiles, setKeptFiles] = useState<FileMetadata[]>(initialFiles)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectedModel = useModelProvider((state) => state.selectedModel)

  useEffect(() => {
    const { files, cleanPrompt } = extractFilesFromPrompt(message)
    setDraft(cleanPrompt)
    setKeptImages(imageUrls || [])
    setKeptFiles(files)
  }, [message, imageUrls])

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      setTimeout(() => {
        textareaRef.current?.focus()
        textareaRef.current?.select()
      }, 100)
    }
  }, [isOpen])

  const handleSave = () => {
    const hasTextChanged = draft !== initialCleanPrompt
    const hasFilesChanged =
      JSON.stringify(keptFiles) !== JSON.stringify(initialFiles)

    if ((hasTextChanged || hasFilesChanged) && draft.trim()) {
      const finalMessage = injectFilesIntoPrompt(draft.trim(), keptFiles)
      onSave(finalMessage)
      setIsOpen(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSave()
    }
  }

  const defaultTrigger = (
    <Button
      variant="ghost"
      size="icon-xs"
      role="button"
      tabIndex={0}
      disabled={!selectedModel}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setIsOpen(true)
        }
      }}
    >
      <IconPencil size={16} />
    </Button>
  )

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{triggerElement || defaultTrigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('common:dialogs.editMessage.title')}</DialogTitle>
          {(keptImages.length > 0 || keptFiles.length > 0) && (
            <div className="mt-2 space-y-2">
              <div className="flex gap-3 flex-wrap">
                {keptImages.map((imageUrl, index) => (
                  <div
                    key={`img-${index}`}
                    className="relative border rounded-lg size-14"
                  >
                    <img
                      className="object-cover w-full h-full rounded-lg"
                      src={imageUrl}
                      alt={`Attached image ${index + 1}`}
                    />
                    <div
                      className="absolute -top-1 -right-2.5 bg-destructive size-5 flex rounded-full items-center justify-center cursor-pointer"
                      onClick={() =>
                        setKeptImages((prev) =>
                          prev.filter((_, i) => i !== index)
                        )
                      }
                    >
                      <IconX className="text-destructive-fg" size={16} />
                    </div>
                  </div>
                ))}
                {keptFiles.map((file) => (
                  <div
                    key={file.id}
                    className="relative border rounded-lg px-3 py-2 flex items-center gap-2 bg-muted"
                  >
                    <IconFile size={16} className="text-muted-foreground" />
                    <span className="text-sm max-w-32 truncate">
                      {file.name}
                    </span>
                    <div
                      className="absolute -top-1 -right-2.5 bg-destructive size-5 flex rounded-full items-center justify-center cursor-pointer"
                      onClick={() =>
                        setKeptFiles((prev) =>
                          prev.filter((f) => f.id !== file.id)
                        )
                      }
                    >
                      <IconX className="text-destructive-fg" size={16} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="mt-2 resize-none w-full min-h-24"
            onKeyDown={handleKeyDown}
            placeholder={t('common:dialogs.editMessage.title')}
            aria-label={t('common:dialogs.editMessage.title')}
          />
          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost" size="sm" className="w-full sm:w-auto">
                {t('common:cancel')}
              </Button>
            </DialogClose>
            <Button
              disabled={
                (draft === initialCleanPrompt &&
                  JSON.stringify(imageUrls || []) ===
                    JSON.stringify(keptImages) &&
                  JSON.stringify(initialFiles) ===
                    JSON.stringify(keptFiles)) ||
                !draft.trim()
              }
              onClick={handleSave}
              size="sm"
              className="w-full sm:w-auto"
            >
              {t('common:save')}
            </Button>
          </DialogFooter>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
