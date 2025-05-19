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
import { IconPlus, IconTrash, IconChevronDown } from '@tabler/icons-react'
import { Assistant } from '@/hooks/useAssistant'
import { Textarea } from '@/components/ui/textarea'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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
  const [paramsValues, setParamsValues] = useState<unknown[]>([''])
  const [paramsTypes, setParamsTypes] = useState<string[]>(['string'])

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

      // Determine parameter types based on values
      const types = values.map((value) => {
        if (typeof value === 'boolean') return 'boolean'
        if (typeof value === 'number') return 'number'
        if (typeof value === 'object') return 'json'
        return 'string'
      })

      setParamsKeys(keys.length > 0 ? keys : [''])
      setParamsValues(values.length > 0 ? values : [''])
      setParamsTypes(types.length > 0 ? types : ['string'])
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
    setParamsTypes(['string'])
  }

  const handleParameterChange = (
    index: number,
    value: unknown,
    field: 'key' | 'value' | 'type'
  ) => {
    if (field === 'key') {
      const newKeys = [...paramsKeys]
      newKeys[index] = value as string
      setParamsKeys(newKeys)
    } else if (field === 'value') {
      const newValues = [...paramsValues]

      // Convert value based on parameter type
      if (paramsTypes[index] === 'number' && typeof value === 'string') {
        newValues[index] = value === '' ? '' : Number(value)
      } else if (
        paramsTypes[index] === 'boolean' &&
        typeof value === 'boolean'
      ) {
        newValues[index] = value
      } else if (paramsTypes[index] === 'json' && typeof value === 'string') {
        try {
          newValues[index] = value === '' ? {} : JSON.parse(value)
        } catch {
          // If JSON is invalid, keep as string
          newValues[index] = value
        }
      } else {
        newValues[index] = value
      }

      setParamsValues(newValues)
    } else {
      const newTypes = [...paramsTypes]
      newTypes[index] = value as string

      // Reset value based on the new type
      const newValues = [...paramsValues]

      if (value === 'string') {
        newValues[index] = ''
      } else if (value === 'number') {
        newValues[index] = ''
      } else if (value === 'boolean') {
        newValues[index] = false
      } else if (value === 'json') {
        newValues[index] = {}
      }

      setParamsValues(newValues)
      setParamsTypes(newTypes)
    }
  }

  const handleAddParameter = () => {
    setParamsKeys([...paramsKeys, ''])
    setParamsValues([...paramsValues, ''])
    setParamsTypes([...paramsTypes, 'string'])
  }

  const handleRemoveParameter = (index: number) => {
    const newKeys = [...paramsKeys]
    const newValues = [...paramsValues]
    const newTypes = [...paramsTypes]
    newKeys.splice(index, 1)
    newValues.splice(index, 1)
    newTypes.splice(index, 1)
    setParamsKeys(newKeys.length > 0 ? newKeys : [''])
    setParamsValues(newValues.length > 0 ? newValues : [''])
    setParamsTypes(newTypes.length > 0 ? newTypes : ['string'])
  }

  const handleSave = () => {
    // Convert parameters arrays to object
    const parameters: Record<string, unknown> = {}
    paramsKeys.forEach((key, index) => {
      if (key) {
        parameters[key] = paramsValues[index]
      }
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
        <div className="space-y-2">
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
            <Textarea
              value={description || ''}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter description"
              className="resize-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm mb-2 inline-block">Instructions</label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Enter instructions"
              className="resize-none"
              rows={4}
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
                    handleParameterChange(index, e.target.value, 'key')
                  }
                  placeholder="Key"
                  className="w-24"
                />

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <div className="relative w-30">
                      <Input
                        value={
                          paramsTypes[index].charAt(0).toUpperCase() +
                          paramsTypes[index].slice(1)
                        }
                        readOnly
                      />
                      <IconChevronDown
                        size={14}
                        className="text-main-view-fg/50 absolute right-2 top-1/2 -translate-y-1/2"
                      />
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-32" align="start">
                    <DropdownMenuItem
                      onClick={() =>
                        handleParameterChange(index, 'string', 'type')
                      }
                    >
                      String
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        handleParameterChange(index, 'number', 'type')
                      }
                    >
                      Number
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        handleParameterChange(index, 'boolean', 'type')
                      }
                    >
                      Boolean
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        handleParameterChange(index, 'json', 'type')
                      }
                    >
                      JSON
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {paramsTypes[index] === 'boolean' ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <div className="relative flex-1">
                        <Input
                          value={paramsValues[index] ? 'True' : 'False'}
                          readOnly
                        />
                        <IconChevronDown
                          size={14}
                          className="text-main-view-fg/50 absolute right-2 top-1/2 -translate-y-1/2"
                        />
                      </div>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-24" align="start">
                      <DropdownMenuItem
                        onClick={() =>
                          handleParameterChange(index, true, 'value')
                        }
                      >
                        True
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          handleParameterChange(index, false, 'value')
                        }
                      >
                        False
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : paramsTypes[index] === 'json' ? (
                  <Input
                    value={
                      typeof paramsValues[index] === 'object'
                        ? JSON.stringify(paramsValues[index], null, 2)
                        : paramsValues[index]?.toString() || ''
                    }
                    onChange={(e) =>
                      handleParameterChange(index, e.target.value, 'value')
                    }
                    placeholder="JSON Value"
                    className="flex-1"
                  />
                ) : (
                  <Input
                    value={paramsValues[index]?.toString() || ''}
                    onChange={(e) =>
                      handleParameterChange(index, e.target.value, 'value')
                    }
                    type={paramsTypes[index] === 'number' ? 'number' : 'text'}
                    placeholder="Value"
                    className="flex-1"
                  />
                )}

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
