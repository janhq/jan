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
import { cn } from '@/lib/utils'
import { Card, CardItem } from '@/containers/Card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronsUpDown } from 'lucide-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.assistant as any)({
  component: AssistantContent,
})

function AssistantContent() {
  const { t } = useTranslation()
  const { assistants, addAssistant, updateAssistant, deleteAssistant, defaultAssistantId, setDefaultAssistant } =
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

  const sortedAssistants = assistants.slice().sort((a, b) => a.created_at - b.created_at)
  const defaultAssistant = sortedAssistants.find((a) => a.id === defaultAssistantId)

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className={cn("flex items-center justify-between w-full mr-2 pr-3", !IS_MACOS && "pr-30")}>
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
          <Button
            onClick={() => {
              setEditingKey(null)
              setOpen(true)
            }}
            size="sm"
            variant="outline"
            className="relative z-50"
          >
            <IconCirclePlus size={16} />
            {t('assistants:addAssistant')}
          </Button>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <div className="flex size-full">
          <SettingsMenu />
          <div className="flex flex-col gap-4 p-4 pt-4 w-full overflow-y-auto">
            {/* Default Assistant */}
            <Card>
              <CardItem
                title={t('assistants:defaultAssistantSection')}
                description={t('assistants:defaultAssistantDesc')}
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="justify-between">
                        <span className="truncate">{defaultAssistant?.name ?? '—'}</span>
                        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40 max-h-80">
                      {sortedAssistants.map((a) => (
                        <DropdownMenuItem
                          key={a.id}
                          className={cn(
                            'cursor-pointer my-0.5',
                            defaultAssistantId === a.id && 'bg-secondary-foreground/8'
                          )}
                          onClick={() => setDefaultAssistant(a.id)}
                        >
                          {a.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
              <h1 className="text-foreground font-studio font-medium text-sm mt-4 mb-4">{t('assistants:allAssistants')}</h1>
              {sortedAssistants.map((assistant) => (
                <div
                  className="group flex items-center gap-3 px-3 py-3 rounded-lg my-1 bg-secondary/20 hover:bg-secondary dark:hover:bg-secondary/20 transition-colors"
                  key={assistant.id}
                >
                  <div className="size-9 shrink-0 flex items-center justify-center bg-secondary dark:bg-secondary/40 rounded-lg">
                    {assistant?.avatar && (
                      <AvatarEmoji
                        avatar={assistant?.avatar}
                        imageClassName="size-6 object-contain"
                        textClassName="text-2xl"
                      />
                    )}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-studio font-medium truncate">
                        {assistant.name}
                      </span>
                      {defaultAssistantId === assistant.id && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-muted-foreground bg-foreground/10 leading-none shrink-0">
                          {t('assistants:isDefault')}
                        </span>
                      )}
                    </div>
                    {assistant.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1 pr-12 mt-0.5">
                        {assistant.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-xs"
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
                      size="icon-xs"
                      title={t('assistants:deleteAssistant')}
                      onClick={() => handleDelete(assistant.id)}
                    >
                      <IconTrash className="text-destructive size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </Card>
          </div>
          <AddEditAssistant
            open={open}
            onOpenChange={setOpen}
            editingKey={editingKey}
            initialData={
              editingKey
                ? assistants.find((a) => a.id === editingKey)
                : undefined
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
