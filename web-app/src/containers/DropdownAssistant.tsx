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
import { useThreads } from '@/hooks/useThreads'
import { AvatarEmoji } from '@/containers/AvatarEmoji'

const DropdownAssistant = () => {
  const {
    assistants,
    currentAssistant,
    addAssistant,
    updateAssistant,
    setCurrentAssistant,
  } = useAssistant()
  const updateCurrentThreadAssistant = useThreads(
    (state) => state.updateCurrentThreadAssistant
  )
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingAssistantId, setEditingAssistantId] = useState<string | null>(
    null
  )

  const selectedAssistant =
    assistants.find((a) => a.id === currentAssistant?.id) || assistants[0]

  return (
    <>
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <div className="inline-flex items-center justify-between gap-2 bg-main-view-fg/5 py-1 hover:bg-main-view-fg/8 px-2 rounded-sm">
          <DropdownMenuTrigger asChild>
            <button className="font-medium cursor-pointer flex items-center gap-1.5 relative z-20 max-w-40">
              <div className="text-main-view-fg/80 flex items-center gap-1">
                {selectedAssistant?.avatar && (
                  <span className="shrink-0 w-4 h-4 relative flex items-center justify-center">
                    <AvatarEmoji
                      avatar={selectedAssistant.avatar}
                      imageClassName="object-cover"
                      textClassName="text-sm"
                    />
                  </span>
                )}
                <div className="truncate max-w-30">
                  <span>{selectedAssistant?.name || 'Jan'}</span>
                </div>
              </div>
            </button>
          </DropdownMenuTrigger>
          <div
            className="size-5 cursor-pointer relative z-10 flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out "
            onClick={() => {
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
            <div
              className="relative pr-6 hover:bg-main-view-fg/4 rounded-sm"
              key={assistant.id}
            >
              <DropdownMenuItem
                className="hover:bg-transparent"
                onClick={() => {
                  setCurrentAssistant(assistant)
                  updateCurrentThreadAssistant(assistant)
                }}
              >
                <div className="text-main-view-fg/70 cursor-pointer flex gap-2 w-full">
                  {assistant?.avatar && (
                    <div className="shrink-0 relative w-4 h-4">
                      <AvatarEmoji
                        avatar={assistant?.avatar}
                        imageClassName="object-cover"
                        textClassName=""
                      />
                    </div>
                  )}

                  <div className="text-left">
                    <span className="line-clamp-1">{assistant.name}</span>
                  </div>
                </div>
              </DropdownMenuItem>
              <div className="absolute top-1/2 -translate-y-1/2 right-1">
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
