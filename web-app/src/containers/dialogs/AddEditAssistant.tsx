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
import { IconMoodSmile } from '@tabler/icons-react'
import EmojiPicker, { EmojiClickData, Theme } from 'emoji-picker-react'

import { Textarea } from '@/components/ui/textarea'

import { useTheme } from '@/hooks/useTheme'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
import { useTranslation } from '@/i18n/react-i18next-compat'

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
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const emojiPickerRef = useRef<HTMLDivElement>(null)
  const emojiPickerTriggerRef = useRef<HTMLDivElement>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  // const [toolStepsInput, setToolStepsInput] = useState('20')

  // Handle click outside emoji picker or trigger
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        emojiPickerRef.current &&
        emojiPickerTriggerRef.current &&
        !emojiPickerRef.current.contains(event.target as Node) &&
        !emojiPickerTriggerRef.current.contains(event.target as Node)
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
      setShowEmojiPicker(false)
      // setToolStepsInput(String(initialData.tool_steps ?? 20))
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
    setNameError(null)
    setShowEmojiPicker(false)
    // setToolStepsInput('20')
  }

  const handleSave = () => {
    if (!name.trim()) {
      setNameError(t('assistants:nameRequired'))
      return
    }
    setNameError(null)

    // const parsedToolSteps = Number(toolStepsInput)
    const assistant: Assistant = {
      avatar,
      id: initialData?.id || Math.random().toString(36).substring(7),
      name,
      created_at: initialData?.created_at || Date.now(),
      description,
      instructions,
      // Sampling moved to the global Sampling popover; assistants are
      // persona-only now. Preserve any existing on-disk parameters
      // untouched (vestigial), default to empty for new assistants.
      parameters: initialData?.parameters ?? {},
      // tool_steps: isNaN(parsedToolSteps) ? 20 : parsedToolSteps,
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
            {editingKey
              ? t('assistants:editAssistant')
              : t('assistants:addAssistant')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative">
              <label className="text-sm mb-2 inline-block">
                {t('assistants:emoji')}
              </label>
              <div
                className="border rounded-sm p-1 size-9 flex items-center justify-center cursor-pointer"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                ref={emojiPickerTriggerRef}
              >
                {avatar ? (
                  <AvatarEmoji
                    avatar={avatar}
                    imageClassName="size-5 object-contain"
                    textClassName=""
                  />
                ) : (
                  <IconMoodSmile size={18} className="text-muted-foreground" />
                )}
              </div>
              <div className="relative" ref={emojiPickerRef}>
                <EmojiPicker
                  open={showEmojiPicker}
                  theme={isDark ? ('dark' as Theme) : ('light' as Theme)}
                  className="absolute!s z-40! overflow-y-auto! top-2"
                  height={350}
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
                {t(`common:name`)}
              </label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  if (e.target.value.trim()) setNameError(null)
                }}
                placeholder={t('assistants:enterName')}
                autoFocus
              />
            </div>
          </div>

          {nameError && (
            <div className="ml-12 text-xs text-destructive mt-1">
              {nameError}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm mb-2 inline-block">
              {t('assistants:description')}
            </label>
            <Textarea
              value={description || ''}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('assistants:enterDescription')}
              className="resize-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm mb-2 inline-block">
              {t('assistants:instructions')}
            </label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={t('assistants:enterInstructions')}
              className="resize-none"
              rows={4}
            />
            <div className="text-xs text-muted-foreground">
              {t('assistants:instructionsDateHint')}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSave}>{t('assistants:save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
