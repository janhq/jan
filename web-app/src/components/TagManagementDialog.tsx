/**
 * Tag Management Dialog
 * UI for creating and managing project tags
 */

import { useState, useEffect } from 'react'
import { tagsService, Tag } from '@/services/tags'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { IconPlus, IconTrash, IconEdit, IconX } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

interface TagManagementDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const TAG_COLORS = [
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Teal', value: '#14b8a6' },
]

const TAG_ICONS = [
  '🏷️',
  '⭐',
  '🎯',
  '📌',
  '🔥',
  '💡',
  '🎨',
  '🚀',
  '✨',
  '💼',
  '📊',
  '🔧',
]

export function TagManagementDialog({
  open,
  onOpenChange,
}: TagManagementDialogProps) {
  const [tags, setTags] = useState<Tag[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [tagName, setTagName] = useState('')
  const [selectedColor, setSelectedColor] = useState(TAG_COLORS[0].value)
  const [selectedIcon, setSelectedIcon] = useState(TAG_ICONS[0])
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      loadTags()
    }
  }, [open])

  const loadTags = async () => {
    const allTags = await tagsService.getAllTags()
    setTags(allTags)
  }

  const handleCreate = async () => {
    if (!tagName.trim()) {
      setError('Tag name is required')
      return
    }

    try {
      if (editingTagId) {
        await tagsService.updateTag(editingTagId, {
          name: tagName,
          color: selectedColor,
          icon: selectedIcon,
        })
      } else {
        await tagsService.createTag(tagName, selectedColor, selectedIcon)
      }

      setTagName('')
      setSelectedColor(TAG_COLORS[0].value)
      setSelectedIcon(TAG_ICONS[0])
      setIsCreating(false)
      setEditingTagId(null)
      setError('')
      loadTags()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save tag')
    }
  }

  const handleEdit = (tag: Tag) => {
    setTagName(tag.name)
    setSelectedColor(tag.color)
    setSelectedIcon(tag.icon || TAG_ICONS[0])
    setEditingTagId(tag.id)
    setIsCreating(true)
  }

  const handleDelete = async (tagId: string) => {
    if (confirm('Are you sure you want to delete this tag?')) {
      await tagsService.deleteTag(tagId)
      loadTags()
    }
  }

  const handleCancel = () => {
    setIsCreating(false)
    setEditingTagId(null)
    setTagName('')
    setSelectedColor(TAG_COLORS[0].value)
    setSelectedIcon(TAG_ICONS[0])
    setError('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Tags</DialogTitle>
          <DialogDescription>
            Create and organize tags for your projects
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Create/Edit Form */}
          {isCreating ? (
            <div className="p-4 border border-main-view-fg/10 rounded-lg space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">
                  {editingTagId ? 'Edit Tag' : 'Create New Tag'}
                </h3>
                <Button variant="ghost" size="sm" onClick={handleCancel}>
                  <IconX size={16} />
                </Button>
              </div>

              <div className="space-y-3">
                <div>
                  <Label htmlFor="tag-name">Tag Name</Label>
                  <Input
                    id="tag-name"
                    value={tagName}
                    onChange={(e) => setTagName(e.target.value)}
                    placeholder="Enter tag name..."
                    className="mt-1"
                  />
                  {error && (
                    <p className="text-xs text-destructive mt-1">{error}</p>
                  )}
                </div>

                <div>
                  <Label>Color</Label>
                  <div className="flex gap-2 mt-2">
                    {TAG_COLORS.map((color) => (
                      <button
                        key={color.value}
                        className={cn(
                          'size-8 rounded-full border-2 transition-all',
                          selectedColor === color.value
                            ? 'border-main-view-fg scale-110'
                            : 'border-transparent hover:scale-105'
                        )}
                        style={{ backgroundColor: color.value }}
                        onClick={() => setSelectedColor(color.value)}
                        title={color.name}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <Label>Icon</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {TAG_ICONS.map((icon) => (
                      <button
                        key={icon}
                        className={cn(
                          'size-10 rounded-lg border transition-all text-xl',
                          selectedIcon === icon
                            ? 'border-accent bg-accent/10 scale-110'
                            : 'border-main-view-fg/10 hover:bg-main-view-fg/5'
                        )}
                        onClick={() => setSelectedIcon(icon)}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button onClick={handleCreate} className="flex-1">
                    {editingTagId ? 'Update Tag' : 'Create Tag'}
                  </Button>
                  <Button variant="outline" onClick={handleCancel}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <Button onClick={() => setIsCreating(true)} className="w-full">
              <IconPlus size={16} className="mr-2" />
              Create New Tag
            </Button>
          )}

          {/* Tags List */}
          <div className="space-y-2">
            {tags.length === 0 ? (
              <p className="text-center text-main-view-fg/60 py-8">
                No tags created yet
              </p>
            ) : (
              tags.map((tag) => (
                <div
                  key={tag.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-main-view-fg/10 hover:bg-main-view-fg/5"
                >
                  <div className="text-2xl">{tag.icon || '🏷️'}</div>
                  <div
                    className="size-3 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{tag.name}</p>
                    <p className="text-xs text-main-view-fg/60">
                      Created {new Date(tag.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(tag)}
                    >
                      <IconEdit size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(tag.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <IconTrash size={16} />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
