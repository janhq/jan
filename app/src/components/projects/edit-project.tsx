import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Textarea } from '@/components/ui/textarea'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useProjects } from '@/stores/projects-store'
import { Folder } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useIsMobile } from '@/hooks/use-mobile'
import { ApiError } from '@/lib/api-client'

const editProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  instruction: z.string().optional(),
})

type EditProjectFormData = z.infer<typeof editProjectSchema>

interface EditProjectProps {
  open: boolean
  project: Project | null
  onSuccess?: () => void
  onOpenChange?: (open: boolean) => void
}

export function EditProject({
  open,
  project,
  onSuccess,
  onOpenChange,
}: EditProjectProps) {
  const updateProject = useProjects((state) => state.updateProject)
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isSubmitted },
    reset,
    setValue,
  } = useForm<EditProjectFormData>({
    resolver: zodResolver(editProjectSchema),
  })

  // Set initial values when project changes
  useEffect(() => {
    if (project) {
      setValue('name', project.name)
      setValue('instruction', project.instruction || '')
    }
  }, [project, setValue])

  const handleClose = () => {
    onOpenChange?.(false)
    setServerError(null)
  }

  const onSubmit = async (data: EditProjectFormData) => {
    if (!project) return

    setServerError(null)
    try {
      await updateProject(project.id, {
        name: data.name,
        instruction: data.instruction || '',
      })
      reset()
      handleClose()
      onSuccess?.()
    } catch (error) {
      if (error instanceof ApiError && error.isDuplicateProjectName()) {
        setServerError(error.message)
      } else {
        console.error('Failed to update project:', error)
      }
    }
  }

  const isMobile = useIsMobile()

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent
        className="p-0 gap-0 overflow-hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => (isMobile ? e.preventDefault() : undefined)}
      >
        <DialogHeader className="px-6 py-4 border-b border-muted text-left">
          <DialogTitle className="font-medium">Edit Project</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col">
          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            <form onSubmit={handleSubmit(onSubmit)}>
              <FieldGroup>
                <Field>
                  <InputGroup>
                    <InputGroupAddon>
                      <Folder />
                    </InputGroupAddon>
                    <InputGroupInput
                      id="name"
                      type="text"
                      placeholder="Name"
                      autoComplete="off"
                      autoFocus={isMobile ? false : true}
                      {...register('name', {
                        onChange: () => setServerError(null),
                      })}
                    />
                  </InputGroup>
                  {isSubmitted && (errors.name || serverError) && (
                    <FieldError>
                      {errors.name?.message || serverError}
                    </FieldError>
                  )}
                </Field>

                <Field>
                  <Textarea
                    id="instruction"
                    placeholder="Project instructions (optional)"
                    rows={4}
                    className="max-h-100"
                    {...register('instruction')}
                  />
                  {errors.instruction && (
                    <FieldError>{errors.instruction.message}</FieldError>
                  )}
                </Field>

                <Field>
                  <div className="flex gap-2 justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      className="rounded-full"
                      onClick={handleClose}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="rounded-full"
                    >
                      {isSubmitting ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                </Field>
              </FieldGroup>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
