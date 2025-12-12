import { useRouter } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CreateProjectForm } from '@/components/form/create-project'

interface ProjectsDialogProps {
  open: boolean
  section?: string
}

export function ProjectsDialog({ open, section }: ProjectsDialogProps) {
  const router = useRouter()

  const handleClose = () => {
    const url = new URL(window.location.href)
    url.searchParams.delete('projects')
    router.navigate({ to: url.pathname + url.search })
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent
        className="max-w-full max-h-full sm:max-w-[500px] p-0 gap-0 rounded-none md:rounded-lg overflow-hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 py-4 border-b border-muted text-left">
          <DialogTitle className="font-medium">
            {section === 'create' && 'Create New Project'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col">
          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {section === 'create' && <CreateProjectForm />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
