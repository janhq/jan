import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'

interface AddProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingKey: string | null
  initialData?: {
    id: string
    name: string
    instruction?: string
    updated_at: number
  }
  onSave: (name: string, instruction?: string) => void
}

export default function AddProjectDialog({
  open,
  onOpenChange,
  editingKey,
  initialData,
  onSave,
}: AddProjectDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialData?.name || '')
  const [instruction, setInstruction] = useState(initialData?.instruction || '')
  const { folders } = useThreadManagement()

  useEffect(() => {
    if (open) {
      setName(initialData?.name || '')
      setInstruction(initialData?.instruction || '')
    }
  }, [open, initialData])

  const handleSave = () => {
    if (!name.trim()) return

    const trimmedName = name.trim()
    const trimmedInstruction = instruction.trim()

    // Check for duplicate names (excluding current project when editing)
    const isDuplicate = folders.some(
      (folder) =>
        folder.name.toLowerCase() === trimmedName.toLowerCase() &&
        folder.id !== editingKey
    )

    if (isDuplicate) {
      toast.warning(t('projects.addProjectDialog.alreadyExists', { projectName: trimmedName }))
      return
    }

    onSave(trimmedName, trimmedInstruction || undefined)

    // Show detailed success message
    if (editingKey && initialData) {
      toast.success(
        t('projects.addProjectDialog.renameSuccess', {
          oldName: initialData.name,
          newName: trimmedName
        })
      )
    } else {
      toast.success(t('projects.addProjectDialog.createSuccess', { projectName: trimmedName }))
    }

    setName('')
    setInstruction('')
  }

  const handleCancel = () => {
    onOpenChange(false)
    setName('')
    setInstruction('')
  }

  // Check if the button should be disabled
  const isButtonDisabled =
    !name.trim() || 
    (editingKey && 
     name.trim() === initialData?.name && 
     instruction.trim() === (initialData?.instruction || ''))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editingKey ? t('projects.addProjectDialog.editTitle') : t('projects.addProjectDialog.createTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-main-view-fg/80">
              {t('projects.addProjectDialog.nameLabel')}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('projects.addProjectDialog.namePlaceholder')}
              className="mt-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isButtonDisabled) {
                  handleSave()
                }
              }}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-main-view-fg/80">
              {t('projects.addProjectDialog.instructionLabel')}
            </label>
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={t('projects.addProjectDialog.instructionPlaceholder')}
              className="mt-1 min-h-[100px] resize-none"
              rows={4}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="link" onClick={handleCancel}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={Boolean(isButtonDisabled)}>
            {editingKey ? t('projects.addProjectDialog.updateButton') : t('projects.addProjectDialog.createButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
