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
    updated_at: number
  }
  onSave: (name: string) => void
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
  const { folders } = useThreadManagement()

  useEffect(() => {
    if (open) {
      setName(initialData?.name || '')
    }
  }, [open, initialData])

  const handleSave = () => {
    if (!name.trim()) return

    const trimmedName = name.trim()

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

    onSave(trimmedName)

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
  }

  const handleCancel = () => {
    onOpenChange(false)
    setName('')
  }

  // Check if the button should be disabled
  const isButtonDisabled =
    !name.trim() || (editingKey && name.trim() === initialData?.name)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editingKey ? t('projects.addProjectDialog.editTitle') : t('projects.addProjectDialog.createTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
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
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={handleCancel}>
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
