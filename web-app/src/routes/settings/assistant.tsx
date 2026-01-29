import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useState } from 'react'

import { useAssistant } from '@/hooks/useAssistant'

import HeaderPage from '@/containers/HeaderPage'
import { IconCirclePlus, IconPencil, IconTrash } from '@tabler/icons-react'
import AddEditAssistant from '@/containers/dialogs/AddEditAssistant'
import { DeleteAssistantDialog } from '@/containers/dialogs'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Button } from '@/components/ui/button'
import SettingsMenu from '@/containers/SettingsMenu'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.assistant as any)({
  component: AssistantContent,
})

function AssistantContent() {
  const { t } = useTranslation()
  const { assistants, addAssistant, updateAssistant, deleteAssistant } =
    useAssistant()
  const [open, setOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDelete = (id: string) => {
    setDeletingId(id)
    setDeleteConfirmOpen(true)
  }

  const confirmDelete = () => {
    if (deletingId) {
      deleteAssistant(deletingId)
      setDeleteConfirmOpen(false)
      setDeletingId(null)
    }
  }

  const handleSave = (assistant: Assistant) => {
    if (editingKey) {
      updateAssistant(assistant)
    } else {
      addAssistant(assistant)
    }
    setOpen(false)
    setEditingKey(null)
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center justify-between w-full mr-2 pr-4">
          <span className='font-medium text-base font-studio'>{t('common:settings')}</span>
          <Button
            onClick={() => {
              setEditingKey(null)
              setOpen(true)
            }}
            size="sm"
            variant="secondary"
            className="relative z-50"
          >
            <IconCirclePlus size={16} />
            {t('assistants:addAssistant')}
          </Button>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <div className="flex h-svh w-full">
          <SettingsMenu />
          <div className="space-y-3 p-4 pt-0 w-full overflow-y-auto">
            {assistants
              .slice()
              .sort((a, b) => a.created_at - b.created_at)
              .map((assistant) => (
                <div
                  className="bg-secondary dark:bg-secondary/20 p-4 rounded-lg flex items-center gap-4"
                  key={assistant.id}
                >
                  <div className="flex items-start gap-3 flex-1">
                    {assistant?.avatar && (
                      <div className="shrink-0 w-8 h-8 relative flex items-center justify-center bg-secondary rounded-md">
                        <AvatarEmoji
                          avatar={assistant?.avatar}
                          imageClassName="w-5 h-5 object-contain"
                          textClassName="text-lg"
                        />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-studio font-medium line-clamp-1">
                        {assistant.name}
                      </h3>
                      <p className="text-muted-foreground leading-normal text-xs line-clamp-2 mt-1">
                        {assistant.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t('assistants:editAssistant')}
                      onClick={() => {
                        setEditingKey(assistant.id)
                        setOpen(true)
                      }}
                    >
                      <IconPencil className="text-muted-foreground size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t('assistants:deleteAssistant')}
                      onClick={() => handleDelete(assistant.id)}
                    >
                      <IconTrash className="text-destructive size-4" />
                    </Button>
                  </div>
                </div>
              ))}
          </div>
          <AddEditAssistant
            open={open}
            onOpenChange={setOpen}
            editingKey={editingKey}
            initialData={
              editingKey ? assistants.find((a) => a.id === editingKey) : undefined
            }
            onSave={handleSave}
          />
          <DeleteAssistantDialog
            open={deleteConfirmOpen}
            onOpenChange={setDeleteConfirmOpen}
            onConfirm={confirmDelete}
          />
        </div>
      </div>
    </div>
  )
}
