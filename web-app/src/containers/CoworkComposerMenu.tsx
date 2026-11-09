import { Check, Folder, FolderPlus } from 'lucide-react'
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { ThreadFolder } from '@/services/projects/types'

type Props = {
  projects?: ThreadFolder[]
  projectId?: string
  /** Absent when the surface cannot attach a folder (browser build). */
  onAttachFolder?: () => void
  /** Absent on a surface whose project is fixed (a project page). */
  onSelectProject?: (project: ThreadFolder) => void
  onAddProject?: () => void
}

/**
 * Workspace and project entries of the composer's + menu. They are owned by the
 * surface that creates the conversation; ChatInput owns attachments and the
 * shared tool controls.
 */
export function CoworkComposerMenu({
  projects = [],
  projectId,
  onAttachFolder,
  onSelectProject,
  onAddProject,
}: Props) {
  const { t } = useTranslation()
  const canPickProject = !!onSelectProject || !!onAddProject
  return (
    <>
      {onAttachFolder && (
        <DropdownMenuItem onSelect={onAttachFolder}>
          <FolderPlus className="size-4 text-muted-foreground" />
          {t('common:homeMode.addFolderAction')}
        </DropdownMenuItem>
      )}
      {canPickProject && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Folder className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              {t('common:homeMode.addToProject')}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            className="flex max-h-(--radix-dropdown-menu-content-available-height) w-64 flex-col"
            sideOffset={4}
          >
            <DropdownMenuGroup className="min-h-0 max-h-64 overflow-y-auto">
              {projects.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  disabled={!onSelectProject}
                  onSelect={() => onSelectProject?.(project)}
                >
                  <Folder className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {projectId === project.id && (
                      <Check className="size-4 text-primary" />
                    )}
                  </span>
                </DropdownMenuItem>
              ))}
              {!projects.length && (
                <DropdownMenuItem disabled>
                  {t('common:homeMode.noProjects')}
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            {onAddProject && (
              <>
                <DropdownMenuSeparator className="shrink-0" />
                <DropdownMenuItem className="shrink-0" onSelect={onAddProject}>
                  <FolderPlus className="size-4 text-muted-foreground" />
                  {t('common:homeMode.newProject')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
    </>
  )
}
