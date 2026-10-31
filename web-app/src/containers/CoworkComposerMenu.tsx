import { Check, ClipboardList, Folder, FolderPlus } from 'lucide-react'
import {
  DropdownMenuCheckboxItem, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { ThreadFolder } from '@/services/projects/types'

type Props = {
  section: 'workspace' | 'controls'
  projects?: ThreadFolder[]
  projectId?: string
  onAttachFolder?: () => void
  onSelectProject?: (project: ThreadFolder) => void
  onAddProject?: () => void
  planMode?: boolean
  onPlanChange?: (enabled: boolean) => void
}

/** Surface-owned actions; ChatInput owns attachment and shared tool controls. */
export function CoworkComposerMenu({ section, projects = [], projectId, onAttachFolder, onSelectProject, onAddProject, planMode = false, onPlanChange }: Props) {
  const { t } = useTranslation()
  if (section === 'controls') return (
    <DropdownMenuCheckboxItem
      className="pl-2 pr-8 [&>span:first-child]:left-auto [&>span:first-child]:right-2 [&>span:first-child]:text-primary"
      disabled={!onPlanChange} checked={planMode} onCheckedChange={onPlanChange}
    >
      <ClipboardList className="size-4 text-muted-foreground" />
      {t('common:planMode.label')}
    </DropdownMenuCheckboxItem>
  )
  return <>
    <DropdownMenuItem disabled={!onAttachFolder} onSelect={onAttachFolder}>
      <FolderPlus className="size-4 text-muted-foreground" />
      {t('common:homeMode.addFolderAction')}
    </DropdownMenuItem>
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={!onSelectProject && !onAddProject}>
        <Folder className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1">{t('common:homeMode.addToProject')}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="flex max-h-(--radix-dropdown-menu-content-available-height) w-64 flex-col" sideOffset={4}>
        <DropdownMenuGroup className="min-h-0 max-h-64 overflow-y-auto">
          {projects.map((project) => <DropdownMenuItem key={project.id} disabled={!onSelectProject} onSelect={() => onSelectProject?.(project)}>
            <Folder className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            <span className="flex size-4 shrink-0 items-center justify-center">
              {projectId === project.id && <Check className="size-4 text-primary" />}
            </span>
          </DropdownMenuItem>)}
          {!projects.length && <DropdownMenuItem disabled>{t('common:homeMode.noProjects')}</DropdownMenuItem>}
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="shrink-0" />
        <DropdownMenuItem className="shrink-0" disabled={!onAddProject} onSelect={onAddProject}>
          <FolderPlus className="size-4 text-muted-foreground" />
          {t('common:homeMode.newProject')}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  </>
}
