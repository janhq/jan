/**
 * Template Selector Dialog
 * Browse and select project templates for quick-start
 */

import { useState, useEffect } from 'react'
import { projectTemplatesService, ProjectTemplate } from '@/services/templates'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface TemplateSelectorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (template: ProjectTemplate, projectName: string) => void
}

const CATEGORY_LABELS = {
  work: 'Work',
  personal: 'Personal',
  research: 'Research',
  creative: 'Creative',
  other: 'Other',
}

export function TemplateSelectorDialog({
  open,
  onOpenChange,
  onSelect,
}: TemplateSelectorDialogProps) {
  const [templates, setTemplates] = useState<ProjectTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] =
    useState<ProjectTemplate | null>(null)
  const [projectName, setProjectName] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')

  useEffect(() => {
    if (open) {
      loadTemplates()
    }
  }, [open])

  const loadTemplates = async () => {
    const all = await projectTemplatesService.getAllTemplates()
    setTemplates(all)
  }

  const filteredTemplates =
    selectedCategory === 'all'
      ? templates
      : templates.filter((t) => t.category === selectedCategory)

  const handleSelectTemplate = (template: ProjectTemplate) => {
    setSelectedTemplate(template)
    setProjectName(template.name)
  }

  const handleCreate = () => {
    if (selectedTemplate && projectName.trim()) {
      onSelect(selectedTemplate, projectName)
      onOpenChange(false)
      setSelectedTemplate(null)
      setProjectName('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Project from Template</DialogTitle>
          <DialogDescription>
            Choose a template to quickly start your project
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Category Filter */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            <Button
              variant={selectedCategory === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory('all')}
            >
              All
            </Button>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <Button
                key={key}
                variant={selectedCategory === key ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedCategory(key)}
              >
                {label}
              </Button>
            ))}
          </div>

          {/* Templates Grid */}
          <div className="grid grid-cols-2 gap-4">
            {filteredTemplates.map((template) => (
              <button
                key={template.id}
                className={cn(
                  'p-4 rounded-lg border-2 text-left transition-all hover:scale-[1.02]',
                  selectedTemplate?.id === template.id
                    ? 'border-accent bg-accent/5'
                    : 'border-main-view-fg/10 hover:border-main-view-fg/20'
                )}
                onClick={() => handleSelectTemplate(template)}
              >
                <div className="flex items-start gap-3">
                  <div className="text-3xl">{template.icon}</div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{template.name}</h3>
                    <p className="text-xs text-main-view-fg/60 mt-1 line-clamp-2">
                      {template.description}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {template.metadata.tags.slice(0, 2).map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 text-xs rounded-full bg-accent/10 text-accent"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {template.defaultThreads && (
                  <div className="mt-3 pt-3 border-t border-main-view-fg/10">
                    <p className="text-xs text-main-view-fg/60 mb-1">
                      Includes {template.defaultThreads.length} starter threads
                    </p>
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Project Name Input */}
          {selectedTemplate && (
            <div className="pt-4 border-t border-main-view-fg/10">
              <label className="block text-sm font-medium mb-2">
                Project Name
              </label>
              <Input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Enter project name..."
                className="mb-4"
              />
              <Button
                onClick={handleCreate}
                className="w-full"
                disabled={!projectName.trim()}
              >
                Create Project from Template
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
