import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useState } from 'react'

import { useAssistant } from '@/hooks/useAssistant'

import HeaderPage from '@/containers/HeaderPage'
import { IconCirclePlus, IconPencil, IconTrash } from '@tabler/icons-react'
import AddEditAssistant from '@/containers/dialogs/AddEditAssistant'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
import { useTranslation } from '@/i18n/react-i18next-compat'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.assistant as any)({
  component: Assistant,
})

function Assistant() {
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
    <div className="flex h-full flex-col flex-justify-center">
      <HeaderPage>
        <span>{t('assistants:title')}</span>
      </HeaderPage>
      <div className="h-full p-4 overflow-y-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {assistants
            .slice().sort((a, b) => a.created_at - b.created_at)
            .map((assistant) => (
              <div
                className="bg-main-view-fg/3 p-3 rounded-md"
                key={assistant.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-medium text-main-view-fg/80">
                    <div className="flex items-center gap-1">
                      {assistant?.avatar && (
                        <span className="shrink-0 w-4 h-4 relative flex items-center justify-center">
                          <AvatarEmoji
                            avatar={assistant?.avatar}
                            imageClassName="object-cover"
                            textClassName="text-sm"
                          />
                        </span>
                      )}
                      <span className="line-clamp-1">{assistant.name}</span>
                    </div>
                  </h3>
                  <div className="flex items-center gap-0.5">
                    <div
                      className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                      title={t('assistants:editAssistant')}
                      onClick={() => {
                        setEditingKey(assistant.id)
                        setOpen(true)
                      }}
                    >
                      <IconPencil size={18} className="text-main-view-fg/50" />
                    </div>
                    <div
                      className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                      title={t('assistants:deleteAssistant')}
                      onClick={() => handleDelete(assistant.id)}
                    >
                      <IconTrash size={18} className="text-main-view-fg/50" />
                    </div>
                  </div>
                </div>
                <p
                  className="text-main-view-fg/50 mt-1 line-clamp-2"
                  title={assistant.description}
                >
                  {assistant.description}
                </p>
              </div>
            ))}

          <div
            className="bg-main-view p-3 min-h-[88px] rounded-md border border-dashed border-main-view-fg/10 flex items-center justify-center cursor-pointer hover:bg-main-view-fg/1 transition-all duration-200 ease-in-out"
            key="new-assistant"
            onClick={() => {
              setEditingKey(null)
              setOpen(true)
            }}
          >
            <IconCirclePlus className="text-main-view-fg/50" />
          </div>
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
        <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('assistants:deleteConfirmation')}</DialogTitle>
              <DialogDescription>
                {t('assistants:deleteConfirmationDesc')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="link"
                onClick={() => setDeleteConfirmOpen(false)}
              >
                {t('assistants:cancel')}
              </Button>
              <Button variant="destructive" onClick={confirmDelete} autoFocus>
                {t('assistants:delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
