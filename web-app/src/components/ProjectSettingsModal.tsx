/**
 * Project Settings Modal
 * Comprehensive settings for project customization
 */

import { useState, useEffect } from 'react'
import { ThreadFolder } from '@/services/projects/types'
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
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface ProjectSettingsModalProps {
  project: ThreadFolder
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (updates: Partial<ThreadFolder>) => void
}

const PROJECT_COLORS = [
  { name: 'Blue', value: 'blue' },
  { name: 'Purple', value: 'purple' },
  { name: 'Green', value: 'green' },
  { name: 'Yellow', value: 'yellow' },
  { name: 'Red', value: 'red' },
  { name: 'Pink', value: 'pink' },
  { name: 'Orange', value: 'orange' },
  { name: 'Gray', value: 'gray' },
]

const PROJECT_ICONS = [
  '📁',
  '📂',
  '🗂️',
  '📋',
  '📊',
  '📈',
  '🎯',
  '🚀',
  '💼',
  '🏢',
  '🎨',
  '🔧',
  '⚙️',
  '💡',
  '🌟',
  '✨',
]

export function ProjectSettingsModal({
  project,
  open,
  onOpenChange,
  onSave,
}: ProjectSettingsModalProps) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description || '')
  const [color, setColor] = useState(project.color || 'gray')
  const [icon, setIcon] = useState(project.icon || '📁')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>(
    project.metadata?.priority || 'medium'
  )
  const [selectedTags, setSelectedTags] = useState<string[]>(
    project.metadata?.tags || []
  )
  const [availableTags, setAvailableTags] = useState<Tag[]>([])
  const [starred, setStarred] = useState(project.metadata?.starred || false)
  const [archived, setArchived] = useState(project.metadata?.archived || false)

  useEffect(() => {
    if (open) {
      loadTags()
    }
  }, [open])

  const loadTags = async () => {
    const tags = await tagsService.getAllTags()
    setAvailableTags(tags)
  }

  const handleSave = () => {
    const updates: Partial<ThreadFolder> = {
      name,
      description: description || undefined,
      color,
      icon,
      metadata: {
        ...project.metadata,
        tags: selectedTags,
        priority,
        starred,
        archived,
      },
    }
    onSave(updates)
    onOpenChange(false)
  }

  const toggleTag = (tagName: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagName)
        ? prev.filter((t) => t !== tagName)
        : [...prev, tagName]
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
          <DialogDescription>
            Customize your project appearance and metadata
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Basic Info */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter project name..."
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="project-description">Description</Label>
              <Textarea
                id="project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your project..."
                rows={3}
                className="mt-1"
              />
            </div>
          </div>

          {/* Visual Customization */}
          <div className="space-y-4">
            <div>
              <Label>Project Icon</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {PROJECT_ICONS.map((projectIcon) => (
                  <button
                    key={projectIcon}
                    className={cn(
                      'size-12 rounded-lg border transition-all text-2xl hover:scale-105',
                      icon === projectIcon
                        ? 'border-accent bg-accent/10 scale-110'
                        : 'border-main-view-fg/10 hover:bg-main-view-fg/5'
                    )}
                    onClick={() => setIcon(projectIcon)}
                  >
                    {projectIcon}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label>Project Color</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {PROJECT_COLORS.map((projectColor) => (
                  <button
                    key={projectColor.value}
                    className={cn(
                      'px-4 py-2 rounded-lg border transition-all font-medium',
                      color === projectColor.value
                        ? 'border-accent bg-accent/10 scale-105'
                        : 'border-main-view-fg/10 hover:bg-main-view-fg/5'
                    )}
                    onClick={() => setColor(projectColor.value)}
                  >
                    {projectColor.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Metadata */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="priority">Priority</Label>
              <select
                id="priority"
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as 'low' | 'medium' | 'high')
                }
                className="mt-1 w-full px-3 py-2 border border-main-view-fg/10 rounded-lg bg-main-view focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <div>
              <Label>Tags</Label>
              {availableTags.length === 0 ? (
                <p className="text-sm text-main-view-fg/60 mt-2">
                  No tags available. Create tags in Tag Management.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2 mt-2">
                  {availableTags.map((tag) => (
                    <button
                      key={tag.id}
                      className={cn(
                        'px-3 py-1.5 rounded-full border transition-all text-sm font-medium',
                        selectedTags.includes(tag.name)
                          ? 'bg-accent/20 border-accent text-accent'
                          : 'border-main-view-fg/20 hover:bg-main-view-fg/5'
                      )}
                      onClick={() => toggleTag(tag.name)}
                    >
                      {tag.icon} {tag.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={starred}
                  onChange={(e) => setStarred(e.target.checked)}
                  className="size-4"
                />
                <span className="text-sm">Star this project</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={archived}
                  onChange={(e) => setArchived(e.target.checked)}
                  className="size-4"
                />
                <span className="text-sm">Archive this project</span>
              </label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
