import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
<<<<<<< HEAD
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
=======
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useAssistant } from '@/hooks/useAssistant'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ChevronDown, Plus } from 'lucide-react'
import AddEditAssistant from './AddEditAssistant'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

interface AddProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingKey: string | null
  initialData?: {
    id: string
    name: string
    updated_at: number
<<<<<<< HEAD
  }
  onSave: (name: string) => void
=======
    assistantId?: string
  }
  onSave: (name: string, assistantId?: string) => void
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
  const { folders } = useThreadManagement()
=======
  const [selectedAssistantId, setSelectedAssistantId] = useState<string | undefined>(initialData?.assistantId)
  const { folders } = useThreadManagement()
  const { assistants, addAssistant } = useAssistant()
  const [addAssistantDialogOpen, setAddAssistantDialogOpen] = useState(false)

  const selectedAssistant = assistants.find((a) => a.id === selectedAssistantId)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

  useEffect(() => {
    if (open) {
      setName(initialData?.name || '')
<<<<<<< HEAD
=======
      setSelectedAssistantId(initialData?.assistantId)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
      toast.warning(
        t('projects.addProjectDialog.alreadyExists', {
          projectName: trimmedName,
        })
      )
      return
    }

    onSave(trimmedName)

    // Show detailed success message
    if (editingKey && initialData) {
      toast.success(
        t('projects.addProjectDialog.renameSuccess', {
          oldName: initialData.name,
          newName: trimmedName,
        })
      )
    } else {
      toast.success(
        t('projects.addProjectDialog.createSuccess', {
          projectName: trimmedName,
        })
      )
    }

    setName('')
=======
      toast.warning(t('projects.addProjectDialog.alreadyExists', { projectName: trimmedName }))
      return
    }

    onSave(trimmedName, selectedAssistantId)

    // Show success message
    if (editingKey) {
      toast.success(t('projects.addProjectDialog.updateSuccess', { projectName: trimmedName }))
    } else {
      toast.success(t('projects.addProjectDialog.createSuccess', { projectName: trimmedName }))
    }
    setName('')
    setSelectedAssistantId(undefined)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  }

  const handleCancel = () => {
    onOpenChange(false)
    setName('')
<<<<<<< HEAD
  }

  // Check if the button should be disabled
  const isButtonDisabled =
    !name.trim() || (editingKey && name.trim() === initialData?.name)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editingKey
              ? t('projects.addProjectDialog.editTitle')
              : t('projects.addProjectDialog.createTitle')}
=======
    setSelectedAssistantId(undefined)
  }

  // Check if the button should be disabled
  const hasChanged = editingKey
    ? name.trim() !== initialData?.name || selectedAssistantId !== initialData?.assistantId
    : true
  const isButtonDisabled = !name.trim() || (editingKey && !hasChanged)

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editingKey ? t('projects.addProjectDialog.editTitle') : t('projects.addProjectDialog.createTitle')}
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
<<<<<<< HEAD
            <label className="text-sm font-medium text-main-view-fg/80">
              {t('projects.addProjectDialog.nameLabel')}
            </label>
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
        </div>
        <DialogFooter>
          <Button variant="link" onClick={handleCancel}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={Boolean(isButtonDisabled)}>
            {editingKey
              ? t('projects.addProjectDialog.updateButton')
              : t('projects.addProjectDialog.createButton')}
=======
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              {t('projects.addProjectDialog.assistant')}
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between rounded-md"
                >
                  {selectedAssistant ? (
                    <div className="flex items-center gap-2">
                      {selectedAssistant.avatar && (
                        <AvatarEmoji
                          avatar={selectedAssistant.avatar}
                          imageClassName="w-4 h-4 object-contain"
                          textClassName="text-sm"
                        />
                      )}
                      <span>{selectedAssistant.name}</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">
                      {t('projects.addProjectDialog.selectAssistant')}
                    </span>
                  )}
                  <ChevronDown className="size-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
                <DropdownMenuItem
                  onSelect={() => setSelectedAssistantId(undefined)}
                >
                  <span className="text-muted-foreground">
                    {t('projects.addProjectDialog.noAssistant')}
                  </span>
                </DropdownMenuItem>
                {assistants.map((assistant) => (
                  <DropdownMenuItem
                    key={assistant.id}
                    onSelect={() => setSelectedAssistantId(assistant.id)}
                  >
                    <div className="flex items-center gap-2">
                      {assistant.avatar && (
                        <AvatarEmoji
                          avatar={assistant.avatar}
                          imageClassName="w-4 h-4 object-contain"
                          textClassName="text-sm"
                        />
                      )}
                      <span>{assistant.name}</span>
                    </div>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => setAddAssistantDialogOpen(true)}
                >
                  <div className="flex items-center gap-2">
                    <Plus className="size-4" />
                    <span>{t('projects.addProjectDialog.addAssistant')}</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={handleCancel}>
            {t('cancel')}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={Boolean(isButtonDisabled)}>
            {editingKey ? t('projects.addProjectDialog.updateButton') : t('projects.addProjectDialog.createButton')}
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
<<<<<<< HEAD
=======

    <AddEditAssistant
      open={addAssistantDialogOpen}
      onOpenChange={setAddAssistantDialogOpen}
      editingKey={null}
      onSave={(assistant) => {
        addAssistant(assistant)
        setSelectedAssistantId(assistant.id)
      }}
    />
  </>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  )
}
