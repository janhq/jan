import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useState } from 'react'

import { useAssistant } from '@/hooks/useAssistant'
import type { Assistant } from '@/hooks/useAssistant'

import HeaderPage from '@/containers/HeaderPage'
import {
  IconCirclePlus,
  IconCodeCircle,
  IconPencil,
  IconTrash,
} from '@tabler/icons-react'
import AddEditAssistant from '@/containers/dialogs/AddEditAssistant'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.assistant as any)({
  component: Assistant,
})

function Assistant() {
  const { assistants, addAssistant, updateAssistant } = useAssistant()
  const [open, setOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)

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
        <span>Assistant</span>
      </HeaderPage>
      <div className="h-full p-4 overflow-y-auto">
        <div className="grid grid-cols-3 gap-4">
          {assistants.map((assistant) => (
            <div
              className="bg-main-view-fg/3 p-3 rounded-md"
              key={assistant.id}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-medium text-main-view-fg/80">
                  {assistant.name}
                </h3>
                <div className="flex items-center gap-0.5">
                  <div
                    className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                    title="Edit Assistant in JSON"
                  >
                    <IconCodeCircle
                      size={18}
                      className="text-main-view-fg/50"
                    />
                  </div>
                  <div
                    className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                    title="Edit Assistant"
                    onClick={() => {
                      setEditingKey(assistant.id)
                      setOpen(true)
                    }}
                  >
                    <IconPencil size={18} className="text-main-view-fg/50" />
                  </div>
                  <div
                    className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                    title="Delete Assistant"
                  >
                    <IconTrash size={18} className="text-main-view-fg/50" />
                  </div>
                </div>
              </div>
              <p className="text-main-view-fg/50 mt-1">
                {assistant.description}
              </p>
            </div>
          ))}
          <div
            className="bg-main-view p-3 rounded-md border border-dashed border-main-view-fg/10 flex items-center justify-center cursor-pointer hover:bg-main-view-fg/1 transition-all duration-200 ease-in-out"
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
      </div>
    </div>
  )
}
