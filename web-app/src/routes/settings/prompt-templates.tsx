import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useState, useEffect } from 'react'
import { usePromptTemplates } from '@/hooks/usePromptTemplates'
import { PromptTemplate } from '@janhq/core'
import SettingsMenu from '@/containers/SettingsMenu'
import { Card, CardItem } from '@/containers/Card'
import {
  IconPlus,
  IconPencil,
  IconTrash,
  IconSparkles,
} from '@tabler/icons-react'
import { AddEditPromptTemplate } from '@/containers/dialogs/AddEditPromptTemplate'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export const Route = createFileRoute(route.settings.prompt_templates as any)({
  component: PromptTemplatesSettings,
})

function PromptTemplatesSettings() {
  const { templates, loadTemplates, deleteTemplate } = usePromptTemplates()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<
    PromptTemplate | undefined
  >()
  const [deletingTemplate, setDeletingTemplate] = useState<
    PromptTemplate | undefined
  >()
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  const handleEdit = (template: PromptTemplate) => {
    setEditingTemplate(template)
    setDialogOpen(true)
  }

  const handleDelete = (template: PromptTemplate) => {
    setDeletingTemplate(template)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (deletingTemplate) {
      await deleteTemplate(deletingTemplate.id)
      setDeleteDialogOpen(false)
      setDeletingTemplate(undefined)
    }
  }

  const handleNewTemplate = () => {
    setEditingTemplate(undefined)
    setDialogOpen(true)
  }

  const templatesList = Object.values(templates).filter(
    (t) =>
      !searchQuery ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.trigger.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="flex h-full w-full">
      <SettingsMenu />
      <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
        <div className="flex flex-col gap-4 w-full">
          <Card
            header={
              <div className="flex flex-col mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h1 className="text-main-view-fg font-medium text-base">
                      Prompt Templates
                    </h1>
                    <div className="text-xs bg-main-view-fg/10 border border-main-view-fg/20 text-main-view-fg/70 rounded-full py-0.5 px-2">
                      <span>Beta</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Search templates..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-48"
                    />
                    <div
                      className="size-8 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                      onClick={handleNewTemplate}
                    >
                      <IconPlus size={18} className="text-main-view-fg/60" />
                    </div>
                  </div>
                </div>

                <p className="text-sm text-main-view-fg/70 mt-2">
                  Create reusable prompt templates that can be triggered with /
                  commands in chat.
                </p>
              </div>
            }
          >
            {templatesList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <IconSparkles size={48} className="text-main-view-fg/30 mb-3" />
                <h3 className="text-main-view-fg/70 font-medium mb-1">
                  {searchQuery ? 'No templates found' : 'No templates yet'}
                </h3>
                <p className="text-sm text-main-view-fg/60 mb-4">
                  {searchQuery
                    ? 'Try a different search term'
                    : 'Create your first prompt template to get started'}
                </p>
                {!searchQuery && (
                  <Button onClick={handleNewTemplate}>
                    <IconPlus size={16} className="mr-2" />
                    Create Template
                  </Button>
                )}
              </div>
            ) : (
              templatesList.map((template) => (
                <CardItem
                  key={template.id}
                  title={
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{template.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-mono">
                        /{template.trigger}
                      </span>
                      {template.category && (
                        <span className="text-xs px-2 py-0.5 rounded bg-main-view-fg/10">
                          {template.category}
                        </span>
                      )}
                    </div>
                  }
                  descriptionOutside={
                    <div className="space-y-2">
                      <p className="text-sm text-main-view-fg/70">
                        {template.description}
                      </p>

                      {template.variables && template.variables.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          <span className="text-xs text-main-view-fg/60">
                            Variables:
                          </span>
                          {template.variables.map((v) => (
                            <span
                              key={v}
                              className="text-xs px-1.5 py-0.5 rounded bg-main-view-fg/5 text-main-view-fg/60 font-mono"
                            >
                              {'{' + v + '}'}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="text-xs text-main-view-fg/50">
                        {template.source === 'mcp'
                          ? 'From MCP Server'
                          : 'User Created'}{' '}
                        • Updated{' '}
                        {new Date(template.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                  }
                  actions={
                    <div className="flex items-center gap-0.5">
                      <div
                        className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                        onClick={() => handleEdit(template)}
                      >
                        <IconPencil
                          size={18}
                          className="text-main-view-fg/60"
                        />
                      </div>
                      {template.source === 'user' && (
                        <div
                          className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-red-500/10 transition-all duration-200 ease-in-out"
                          onClick={() => handleDelete(template)}
                        >
                          <IconTrash size={18} className="text-red-500/70" />
                        </div>
                      )}
                    </div>
                  }
                />
              ))
            )}
          </Card>
        </div>
      </div>

      <AddEditPromptTemplate
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingTemplate={editingTemplate}
      />

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Template</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deletingTemplate?.name}"? This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="link" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
