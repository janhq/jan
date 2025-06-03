import { useState, useEffect, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  IconPlus,
  IconTrash,
  IconChevronDown,
  IconMoodSmile,
} from '@tabler/icons-react'
import EmojiPicker, { EmojiClickData, Theme } from 'emoji-picker-react'

import { Textarea } from '@/components/ui/textarea'
import { paramsSettings } from '@/lib/predefinedParams'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme } from '@/hooks/useTheme'
import { teamEmoji } from '@/utils/teamEmoji'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
import { useTranslation } from 'react-i18next'
import { cn, isDev } from '@/lib/utils'

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
  const { isDark } = useTheme()
  const [paramsKeys, setParamsKeys] = useState<string[]>([''])
  const [paramsValues, setParamsValues] = useState<unknown[]>([''])
  const [paramsTypes, setParamsTypes] = useState<string[]>(['string'])
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const emojiPickerRef = useRef<HTMLDivElement>(null)

  // Handle click outside emoji picker
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(event.target as Node)
      ) {
        setShowEmojiPicker(false)
      }
    }

    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showEmojiPicker])

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

  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editingKey ? 'Edit Assistant' : 'Add Assistant'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative">
              <label className="text-sm mb-2 inline-block">Emoji</label>
              <div
                className="border rounded-sm p-1 w-9 h-9 flex items-center justify-center border-main-view-fg/10 cursor-pointer"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              >
                {avatar ? (
                  <AvatarEmoji
                    avatar={avatar}
                    imageClassName="w-5 h-5 object-contain"
                    textClassName=""
                  />
                ) : (
                  <IconMoodSmile size={18} className="text-main-view-fg/50" />
                )}
              </div>
              <div className="relative" ref={emojiPickerRef}>
                <EmojiPicker
                  open={showEmojiPicker}
                  theme={isDark ? ('dark' as Theme) : ('light' as Theme)}
                  className="!absolute !z-40 !overflow-y-auto top-2"
                  height={350}
                  customEmojis={isDev() ? teamEmoji : []}
                  lazyLoadEmojis
                  previewConfig={{ showPreview: false }}
                  onEmojiClick={(emojiData: EmojiClickData) => {
                    // For custom emojis, use the imageUrl instead of the emoji name
                    if (emojiData.isCustom && emojiData.imageUrl) {
                      setAvatar(emojiData.imageUrl)
                    } else {
                      setAvatar(emojiData.emoji)
                    }
                    setShowEmojiPicker(false)
                  }}
                />
              </div>
            </div>

            <div className="space-y-2 w-full">
              <label className="text-sm mb-2 inline-block">
                {t(`common.name`)}
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter name"
                autoFocus
              />
            </div>
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

          <div className="space-y-2 my-4">
            <div className="flex items-center justify-between">
              <label className="text-sm">Predefined Parameters</label>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(paramsSettings).map(([key, setting]) => (
                <div
                  key={key}
                  onClick={() => {
                    // Check if parameter already exists
                    const existingIndex = paramsKeys.findIndex(
                      (k) => k === setting.key
                    )
                    if (existingIndex === -1) {
                      // Add new parameter
                      const newKeys = [...paramsKeys]
                      const newValues = [...paramsValues]
                      const newTypes = [...paramsTypes]

                      // If the last param is empty, replace it, otherwise add new
                      if (paramsKeys[paramsKeys.length - 1] === '') {
                        newKeys[newKeys.length - 1] = setting.key
                        newValues[newValues.length - 1] = setting.value
                        newTypes[newTypes.length - 1] =
                          typeof setting.value === 'boolean'
                            ? 'boolean'
                            : typeof setting.value === 'number'
                              ? 'number'
                              : 'string'
                      } else {
                        newKeys.push(setting.key)
                        newValues.push(setting.value)
                        newTypes.push(
                          typeof setting.value === 'boolean'
                            ? 'boolean'
                            : typeof setting.value === 'number'
                              ? 'number'
                              : 'string'
                        )
                      }

                      setParamsKeys(newKeys)
                      setParamsValues(newValues)
                      setParamsTypes(newTypes)
                    }
                  }}
                  className={cn(
                    'text-xs bg-main-view-fg/10 py-1 px-2 rounded-sm cursor-pointer',
                    paramsKeys.includes(setting.key) && 'opacity-50'
                  )}
                >
                  {setting.title}
                </div>
              ))}
            </div>
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
