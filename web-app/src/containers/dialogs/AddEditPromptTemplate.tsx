import { useState, useEffect } from 'react'
import { PromptTemplate } from '@janhq/core'
import { usePromptTemplates } from '@/hooks/usePromptTemplates'
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
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

interface AddEditPromptTemplateProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingTemplate?: PromptTemplate
}

export function AddEditPromptTemplate({
  open,
  onOpenChange,
  editingTemplate,
}: AddEditPromptTemplateProps) {
  const { addTemplate, updateTemplate } = usePromptTemplates()

  const [name, setName] = useState('')
  const [trigger, setTrigger] = useState('')
  const [description, setDescription] = useState('')
  const [template, setTemplate] = useState('')
  const [category, setCategory] = useState('')
  const [variables, setVariables] = useState('')

  useEffect(() => {
    if (editingTemplate) {
      setName(editingTemplate.name)
      setTrigger(editingTemplate.trigger)
      setDescription(editingTemplate.description)
      setTemplate(editingTemplate.template)
      setCategory(editingTemplate.category || '')
      setVariables(editingTemplate.variables?.join(', ') || '')
    } else {
      setName('')
      setTrigger('')
      setDescription('')
      setTemplate('')
      setCategory('')
      setVariables('')
    }
  }, [editingTemplate, open])

  const handleSave = async () => {
    const variablesList = variables
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)

    if (editingTemplate) {
      await updateTemplate(editingTemplate.id, {
        name,
        trigger,
        description,
        template,
        category: category || undefined,
        variables: variablesList.length > 0 ? variablesList : undefined,
      })
    } else {
      await addTemplate({
        name,
        trigger,
        description,
        template,
        category: category || undefined,
        variables: variablesList.length > 0 ? variablesList : undefined,
        source: 'user',
      })
    }

    onOpenChange(false)
  }

  const isValid = name && trigger && description && template

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingTemplate
              ? 'Edit Prompt Template'
              : 'Create Prompt Template'}
          </DialogTitle>
          <DialogDescription>
            Create reusable prompt templates that can be triggered with /
            commands
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Travel Planning Assistant"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="trigger">Trigger (without /)</Label>
            <Input
              id="trigger"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value.replace(/^\//, ''))}
              placeholder="travel"
            />
            <p className="text-xs text-main-view-fg/60">
              Type /{trigger || 'trigger'} to use this template
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Plan a complete travel itinerary"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category (optional)</Label>
            <Input
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Travel, Coding, Writing, etc."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="template">Template Content</Label>
            <Textarea
              id="template"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder="Act as a travel planning assistant. Help me plan a trip to {destination} for {duration} with a budget of {budget}. Include recommendations for..."
              rows={8}
              className="font-mono text-sm"
            />
            <p className="text-xs text-main-view-fg/60">
              Use {'{variable_name}'} for dynamic values
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="variables">Variables (optional)</Label>
            <Input
              id="variables"
              value={variables}
              onChange={(e) => setVariables(e.target.value)}
              placeholder="destination, duration, budget"
            />
            <p className="text-xs text-main-view-fg/60">
              Comma-separated list of variables used in template
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="link" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid}>
            {editingTemplate ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
