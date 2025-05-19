import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { Assistant } from '@/hooks/useAssistant'
import { Textarea } from '@/components/ui/textarea'

interface AddEditAssistantProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingKey: string | null
  initialData?: Assistant
  onSave: (assistant: Assistant) => void
}

export default function AddEditAssistant({
  open,
  onOpenChange,
  editingKey,
  initialData,
  onSave,
}: AddEditAssistantProps) {
  const [avatar, setAvatar] = useState<string | undefined>(initialData?.avatar)

  const [name, setName] = useState(initialData?.name || '')
  const [description, setDescription] = useState<string | undefined>(
    initialData?.description
  )
  const [instructions, setInstructions] = useState(
    initialData?.instructions || ''
  )
  const [paramsKeys, setParamsKeys] = useState<string[]>([''])
  const [paramsValues, setParamsValues] = useState<string[]>([''])

  // Reset form when modal opens/closes or editing key changes
  useEffect(() => {
    if (open && editingKey && initialData) {
      setAvatar(initialData.avatar)
      setName(initialData.name)
      setDescription(initialData.description)
      setInstructions(initialData.instructions)
      // Convert parameters object to arrays of keys and values
      const keys = Object.keys(initialData.parameters || {})
      const values = Object.values(initialData.parameters || {})

      setParamsKeys(keys.length > 0 ? keys : [''])
      setParamsValues(values.length > 0 ? values : [''])
    } else if (open) {
      // Add mode - reset form
      resetForm()
    }
  }, [open, editingKey, initialData])

  const resetForm = () => {
    setAvatar(undefined)
    setName('')
    setDescription(undefined)
    setInstructions('')
    setParamsKeys([''])
    setParamsValues([''])
  }

  const handleParameterChange = (
    index: number,
    value: string,
    isKey: boolean
  ) => {
    if (isKey) {
      const newKeys = [...paramsKeys]
      newKeys[index] = value
      setParamsKeys(newKeys)
    } else {
      const newValues = [...paramsValues]
      newValues[index] = value
      setParamsValues(newValues)
    }
  }

  const handleAddParameter = () => {
    setParamsKeys([...paramsKeys, ''])
    setParamsValues([...paramsValues, ''])
  }

  const handleRemoveParameter = (index: number) => {
    const newKeys = [...paramsKeys]
    const newValues = [...paramsValues]
    newKeys.splice(index, 1)
    newValues.splice(index, 1)
    setParamsKeys(newKeys.length > 0 ? newKeys : [''])
    setParamsValues(newValues.length > 0 ? newValues : [''])
  }

  const handleSave = () => {
    // Convert parameters arrays to object
    const parameters: Record<string, string> = {}
    paramsKeys.forEach((key, index) => {
      parameters[key] = paramsValues[index] || ''
    })

    const assistant: Assistant = {
      avatar,
      id: initialData?.id || Math.random().toString(36).substring(7),
      name,
      created_at: initialData?.created_at || Date.now(),
      description,
      instructions,
      parameters: parameters || {},
    }
    onSave(assistant)
    onOpenChange(false)
    resetForm()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editingKey ? 'Edit Assistant' : 'Add Assistant'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm mb-2 inline-block">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter name"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm mb-2 inline-block">
              Avatar (optional)
            </label>
            <Input
              value={avatar || ''}
              onChange={(e) => setAvatar(e.target.value)}
              placeholder="Enter avatar URL"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm mb-2 inline-block">
              Description (optional)
            </label>
            <Input
              value={description || ''}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter description"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm mb-2 inline-block">Instructions</label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Enter instructions"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm">Parameters</label>
              <div
                className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                onClick={handleAddParameter}
              >
                <IconPlus size={18} className="text-main-view-fg/60" />
              </div>
            </div>

            {paramsKeys.map((key, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={key}
                  onChange={(e) =>
                    handleParameterChange(index, e.target.value, true)
                  }
                  placeholder="Key"
                  className="flex-1"
                />
                <Input
                  value={paramsValues[index] || ''}
                  onChange={(e) =>
                    handleParameterChange(index, e.target.value, false)
                  }
                  placeholder="Value"
                  className="flex-1"
                />
                <div
                  className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                  onClick={() => handleRemoveParameter(index)}
                >
                  <IconTrash size={18} className="text-destructive" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
