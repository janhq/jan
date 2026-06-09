import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useAssistant } from '@/hooks/useAssistant'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ChevronDown, FolderOpen, Plus } from 'lucide-react'
import AddEditAssistant from './AddEditAssistant'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useRuntimePermission } from '@/stores/runtime-permission-store'
import { useWorkspaceDirectories } from '@/stores/workspace-directory-store'
import {
  basenameFromPath,
  findFolderByDirectoryPath,
  getProjectDirectoryPath,
  normalizeProjectPath,
} from '@/lib/project-folders'

interface AddProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingKey: string | null
  initialData?: {
    id: string
    name: string
    updated_at: number
    assistantId?: string
    directoryPath?: string
  }
  onSave: (directoryPath: string, assistantId?: string) => void
}

export default function AddProjectDialog({
  open,
  onOpenChange,
  editingKey,
  initialData,
  onSave,
}: AddProjectDialogProps) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const requestRuntimePermission = useRuntimePermission(
    (state) => state.requestPermission
  )
  const directories = useWorkspaceDirectories((state) => state.directories)
  const [directoryPath, setDirectoryPath] = useState(
    initialData?.directoryPath || ''
  )
  const [selectedAssistantId, setSelectedAssistantId] = useState<
    string | undefined
  >(initialData?.assistantId)
  const { folders } = useThreadManagement()
  const { assistants, addAssistant } = useAssistant()
  const [addAssistantDialogOpen, setAddAssistantDialogOpen] = useState(false)

  const selectedAssistant = assistants.find((a) => a.id === selectedAssistantId)

  useEffect(() => {
    if (!open) return
    const existingPath =
      initialData?.directoryPath ||
      (initialData
        ? getProjectDirectoryPath(initialData, directories)
        : undefined) ||
      ''
    setDirectoryPath(existingPath)
    setSelectedAssistantId(initialData?.assistantId)
  }, [open, initialData, directories])

  const chooseFolder = async () => {
    const allowed = await requestRuntimePermission({
      actionId: 'file.choose-project-dir',
      actionLabel: 'choose project folder',
      category: 'file',
      resourceLabel: directoryPath || 'select folder',
      risk: 'medium',
    })
    if (!allowed) return

    const selection = await serviceHub.dialog().open({
      directory: true,
      defaultPath: directoryPath || undefined,
    })
    if (!selection || Array.isArray(selection)) return
    setDirectoryPath(normalizeProjectPath(selection))
  }

  const handleSave = () => {
    const normalized = normalizeProjectPath(directoryPath)
    if (!normalized) return

    const duplicate = findFolderByDirectoryPath(folders, directories, normalized)
    if (duplicate && duplicate.id !== editingKey) {
      toast.warning(
        `A project already exists for ${basenameFromPath(normalized)}`
      )
      return
    }

    onSave(normalized, selectedAssistantId)

    if (editingKey) {
      toast.success(
        t('projects.addProjectDialog.updateSuccess', {
          projectName: basenameFromPath(normalized),
        })
      )
    } else {
      toast.success(
        t('projects.addProjectDialog.createSuccess', {
          projectName: basenameFromPath(normalized),
        })
      )
    }
    setDirectoryPath('')
    setSelectedAssistantId(undefined)
  }

  const handleCancel = () => {
    onOpenChange(false)
    setDirectoryPath('')
    setSelectedAssistantId(undefined)
  }

  const initialPath =
    initialData?.directoryPath ||
    (initialData ? getProjectDirectoryPath(initialData, directories) : '') ||
    ''
  const hasChanged = editingKey
    ? normalizeProjectPath(directoryPath) !== normalizeProjectPath(initialPath) ||
      selectedAssistantId !== initialData?.assistantId
    : true
  const isButtonDisabled =
    !normalizeProjectPath(directoryPath) || (Boolean(editingKey) && !hasChanged)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingKey
                ? t('projects.addProjectDialog.editTitle')
                : t('projects.addProjectDialog.createTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Project folder</label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 justify-start gap-2"
                  onClick={() => void chooseFolder()}
                >
                  <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-left">
                    {directoryPath
                      ? basenameFromPath(directoryPath)
                      : 'Choose a folder on this device'}
                  </span>
                </Button>
              </div>
              {directoryPath ? (
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={directoryPath}
                >
                  {directoryPath}
                </p>
              ) : null}
            </div>
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
                <DropdownMenuContent
                  align="start"
                  className="w-(--radix-dropdown-menu-trigger-width)"
                >
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
            <Button
              size="sm"
              onClick={handleSave}
              disabled={Boolean(isButtonDisabled)}
            >
              {editingKey
                ? t('projects.addProjectDialog.updateButton')
                : t('projects.addProjectDialog.createButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
  )
}