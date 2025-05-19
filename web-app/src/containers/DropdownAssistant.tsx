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
import { IconCirclePlus, IconSettings } from '@tabler/icons-react'

const DropdownAssistant = () => {
  const { assistants, addAssistant, updateAssistant } = useAssistant()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingAssistantId, setEditingAssistantId] = useState<string | null>(
    null
  )
  const [selectedAssistantId, setSelectedAssistantId] = useState<string | null>(
    assistants[0]?.id || null
  )

  const selectedAssistant =
    assistants.find((a) => a.id === selectedAssistantId) || assistants[0]

  return (
    <>
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <div className="flex items-center justify-between gap-1">
          <DropdownMenuTrigger asChild>
            <button className="bg-main-view-fg/5 py-0.5 hover:bg-main-view-fg/8 px-2 rounded font-medium cursor-pointer flex items-center gap-1.5 relative z-20 max-w-40">
              <span className="text-main-view-fg/80 truncate">
                {selectedAssistant?.name || 'Jan'}
              </span>
            </button>
          </DropdownMenuTrigger>
          <div
            className="size-5 cursor-pointer relative z-10 flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
            onClick={() => {
              console.log('edit clicked', selectedAssistant)
              if (selectedAssistant) {
                setEditingAssistantId(selectedAssistant.id)
                setDialogOpen(true)
              }
            }}
          >
            <IconSettings
              size={16}
              className="text-main-view-fg/50"
              title="Edit Assistant"
            />
          </div>
        </div>
        <DropdownMenuContent
          className="w-44 max-h-[320px]"
          side="bottom"
          sideOffset={10}
          align="start"
        >
          {assistants.map((assistant) => (
            <div className="relative" key={assistant.id}>
              <DropdownMenuItem className="flex justify-between items-center">
                <span
                  className="truncate text-main-view-fg/70 flex-1 cursor-pointer"
                  onClick={() => setSelectedAssistantId(assistant.id)}
                >
                  {assistant.name}
                </span>
              </DropdownMenuItem>
              <div className="absolute top-1/2 -translate-y-1/2 right-2">
                <div className="size-5 text-main-view-fg/50 cursor-pointer relative z-10 flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out">
                  <IconSettings
                    size={16}
                    onClick={() => {
                      setEditingAssistantId(assistant.id)
                      setDialogOpen(true)
                    }}
                  />
                </div>
              </div>
            </div>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setEditingAssistantId(null)
              setDialogOpen(true)
            }}
          >
            <IconCirclePlus />
            <span className="truncate text-main-view-fg/70">
              Create Assistant
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddEditAssistant
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingKey={editingAssistantId}
        initialData={
          editingAssistantId
            ? assistants.find((a) => a.id === editingAssistantId)
            : undefined
        }
        onSave={(assistant) => {
          if (editingAssistantId) {
            updateAssistant(assistant)
          } else {
            addAssistant(assistant)
          }
          setEditingAssistantId(null)
          setDialogOpen(false)
        }}
      />
    </>
  )
}

export default DropdownAssistant
