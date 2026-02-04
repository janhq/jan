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
<<<<<<< HEAD
import { PlatformGuard } from '@/lib/platform/PlatformGuard'
import { PlatformFeature } from '@/lib/platform/types'
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
import { Button } from '@/components/ui/button'
import SettingsMenu from '@/containers/SettingsMenu'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.assistant as any)({
<<<<<<< HEAD
  component: Assistant,
})

function Assistant() {
  return (
    <PlatformGuard feature={PlatformFeature.ASSISTANTS}>
      <AssistantContent />
    </PlatformGuard>
  )
}

=======
  component: AssistantContent,
})

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
    <div className="flex h-full flex-col justify-center">
      <HeaderPage>
        <div className="flex items-center justify-between w-full mr-2">
          <span>{t('assistants:title')}</span>
=======
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center justify-between w-full mr-2 pr-4">
          <span className='font-medium text-base font-studio'>{t('common:settings')}</span>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          <Button
            onClick={() => {
              setEditingKey(null)
              setOpen(true)
            }}
            size="sm"
<<<<<<< HEAD
            className="relative z-50"
          >
            <IconCirclePlus size={16} />
            Add Assistant
          </Button>
        </div>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="space-y-3 p-4">
          {assistants
            .slice()
            .sort((a, b) => a.created_at - b.created_at)
            .map((assistant) => (
              <div
                className="bg-main-view-fg/3 py-2 px-4 rounded-lg flex items-center gap-4"
                key={assistant.id}
              >
                <div className="flex items-start gap-3 flex-1">
                  {assistant?.avatar && (
                    <div className="shrink-0 w-8 h-8 relative flex items-center justify-center bg-main-view-fg/4 rounded-md">
                      <AvatarEmoji
                        avatar={assistant?.avatar}
                        imageClassName="w-5 h-5 object-contain"
                        textClassName="text-lg"
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-medium text-main-view-fg/80 line-clamp-1">
                      {assistant.name}
                    </h3>
                    <p className="text-main-view-fg/50 text-sm line-clamp-2 mt-0.5">
                      {assistant.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center">
                  <button
                    className="size-8 cursor-pointer flex items-center justify-center rounded-md hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                    title={t('assistants:editAssistant')}
                    onClick={() => {
                      setEditingKey(assistant.id)
                      setOpen(true)
                    }}
                  >
                    <IconPencil size={16} className="text-main-view-fg/50" />
                  </button>
                  <button
                    className="size-8 cursor-pointer flex items-center justify-center rounded-md hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                    title={t('assistants:deleteAssistant')}
                    onClick={() => handleDelete(assistant.id)}
                  >
                    <IconTrash size={16} className="text-main-view-fg/50" />
                  </button>
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
=======
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
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      </div>
    </div>
  )
}
