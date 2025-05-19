import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAssistant } from '@/hooks/useAssistant'
import AddEditAssistant from './dialogs/AddEditAssistant'
import { IconCirclePlus } from '@tabler/icons-react'
import type { Assistant } from '@/hooks/useAssistant'

const DropdownAssistant = () => {
  const { assistants, addAssistant, updateAssistant } = useAssistant()
  const [open, setOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)

  const handleSave = (assistant: Assistant) => {
    addAssistant(assistant)
    setOpen(false)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="rounded font-medium cursor-pointer flex items-center gap-1.5 relative z-20">
            <span className="text-main-view-fg/80">
              {assistants[0]?.name || 'Jan'}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-44 max-h-[320px]"
          side="bottom"
          sideOffset={10}
          align="start"
        >
          {assistants.map((assistant) => (
            <DropdownMenuItem key={assistant.id}>
              <span className="truncate text-main-view-fg/70">
                {assistant.name}
              </span>
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOpen(true)}>
            <IconCirclePlus />
            <span className="truncate text-main-view-fg/70">
              Create Assistant
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddEditAssistant
        open={open}
        onOpenChange={setOpen}
        editingKey={editingKey}
        onSave={handleSave}
      />
    </>
  )
}

export default DropdownAssistant
