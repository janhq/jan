import { cn } from '@/lib/utils'
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
import { useRouter } from '@tanstack/react-router'
import { Folder } from 'lucide-react'

const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  instruction: z.string().optional(),
})

type CreateProjectFormData = z.infer<typeof createProjectSchema>

interface CreateProjectFormProps extends React.ComponentProps<'div'> {
  onSuccess?: () => void
}

export function CreateProjectForm({
  className,
  onSuccess,
  ...props
}: CreateProjectFormProps) {
  const createProject = useProjects((state) => state.createProject)
  const router = useRouter()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<CreateProjectFormData>({
    resolver: zodResolver(createProjectSchema),
  })

  const onSubmit = async (data: CreateProjectFormData) => {
    try {
      const newProject = await createProject({
        name: data.name,
        instruction: data.instruction || '',
      })

      // Reset form
      reset()

      // Navigate to the newly created project
      router.navigate({
        to: '/projects/$projectId',
        params: { projectId: newProject.id },
      })

      // Call onSuccess callback if provided
      onSuccess?.()
    } catch (error) {
      console.error('Failed to create project:', error)
    }
  }

  return (
    <div className={cn('flex flex-col gap-3', className)} {...props}>
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
            {errors.name && <FieldError>{errors.name.message}</FieldError>}
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
                onClick={() => {
                  const url = new URL(window.location.href)
                  url.searchParams.delete('projects')
                  router.navigate({ to: url.pathname + url.search })
                }}
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
  )
}
