import { useRouter } from '@tanstack/react-router'
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

const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  instruction: z.string().optional(),
})

type CreateProjectFormData = z.infer<typeof createProjectSchema>

interface CreateProjectProps {
  open: boolean
  onOpenChange?: (open: boolean) => void
}

export function CreateProject({ open, onOpenChange }: CreateProjectProps) {
  const router = useRouter()
  const createProject = useProjects((state) => state.createProject)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<CreateProjectFormData>({
    resolver: zodResolver(createProjectSchema),
  })

  const handleClose = () => {
    onOpenChange?.(false)
    // Fallback to URL-based closing if no callback provided
    const url = new URL(window.location.href)
    if (!onOpenChange && url.searchParams.get('projects') === 'create') {
      url.searchParams.delete('projects')
      router.navigate({ to: url.pathname + url.search })
    }
  }

  const onSubmit = async (data: CreateProjectFormData) => {
    try {
      const newProject = await createProject({
        name: data.name,
        instruction: data.instruction || '',
      })
      reset()
      handleClose()
      router.navigate({
        to: '/projects/$projectId',
        params: { projectId: newProject.id },
      })
    } catch (error) {
      console.error('Failed to create project:', error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent
        className="max-w-full max-h-full sm:max-w-[500px] p-0 gap-0 rounded-none md:rounded-lg overflow-hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 py-4 border-b border-muted text-left">
          <DialogTitle className="font-medium">Create New Project</DialogTitle>
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
                      {...register('name')}
                    />
                  </InputGroup>
                  {errors.name && (
                    <FieldError>{errors.name.message}</FieldError>
                  )}
                </Field>

                <Field>
                  <Textarea
                    id="instruction"
                    placeholder="Project instructions (optional)"
                    rows={4}
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
                      {isSubmitting ? 'Creating...' : 'Create Project'}
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
