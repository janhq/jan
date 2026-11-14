import { useState } from 'react'
import type { MCPPrompt } from '@janhq/core'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { DialogDescription } from '@radix-ui/react-dialog'
import { Input } from '@/components/ui/input'

interface PromptInputDialogProps {
  onOpenChange: (open: boolean) => void
  onSubmit: (prompt: MCPPrompt, args: Record<string, string>) => Promise<void>
  open: boolean
  prompt: MCPPrompt | null
}
export default function PromptInputDialog({
  onOpenChange,
  onSubmit,
  open,
  prompt,
}: PromptInputDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  if (!prompt) return null

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      await onSubmit(prompt, values)
      setValues({})
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to apply prompt: ', err)
    } finally {
      setIsSubmitting(false)
    }
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enter prompt inputs</DialogTitle>
          <p className="text-sm font-medium">{prompt.name}</p>
          {prompt.description && (
            <DialogDescription className="mt-1">
              {prompt.description}
            </DialogDescription>
          )}
        </DialogHeader>
        {prompt.arguments && prompt.arguments.length > 0 && (
          <div className="flex flex-col gap-4 py-2">
            {prompt.arguments.map((arg) => (
              <div key={arg.name} className="flex flex-col gap-1.5">
                <Label htmlFor={arg.name}>
                  {arg.name.charAt(0).toUpperCase() + arg.name.slice(1)}
                  {arg.required && (
                    <span className="text-destructive ml-0.5">*</span>
                  )}
                </Label>
                {arg.description && (
                  <p className="text-xs text-muted-foreground">
                    {arg.description}
                  </p>
                )}
                <Input
                  id={arg.name}
                  value={values[arg.name] ?? ''}
                  onChange={(e) =>
                    setValues((prev) => ({
                      ...prev,
                      [arg.name]: e.target.value,
                    }))
                  }
                  placeholder={`Enter ${arg.name}`}
                />
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            Add prompt
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}