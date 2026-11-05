import { useState } from 'react'
import { Check, Folder, FolderOpen, FolderPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { basenameOf } from '@/lib/coworkPreview'
import type { ThreadFolder } from '@/services/projects/types'

type Props = {
  folder: string | null
  project?: ThreadFolder | null
  projects?: ThreadFolder[]
  onSelectProject?: (project: ThreadFolder) => void
  onAddFolder: () => void
  onAddProject: () => void
  onRemove: () => void
}

/** Folder selection is separate from the attachment menu: files are inputs to
 * a prompt, while a folder is the workspace for the whole conversation. */
export function HomeWorkspacePicker({ folder, project, projects = [], onSelectProject, onAddFolder, onAddProject, onRemove }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const selected = !!(folder || project)
  const label = folder ? basenameOf(folder) : project?.name
  const menu = (
    <DropdownMenuContent align="start" sideOffset={8} className="w-80 max-w-[calc(100vw-2rem)] rounded-2xl p-2 shadow-lg">
      {selected && (
        <>
          <DropdownMenuItem className="items-start gap-3 rounded-lg px-3 py-3" onSelect={(e) => e.preventDefault()}>
            <Folder className="mt-0.5 size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{label}</div>
              {folder && <div className="mt-0.5 truncate text-sm text-muted-foreground" title={folder}>{folder}</div>}
              {project && folder && <div className="mt-0.5 truncate text-xs text-muted-foreground">{project.name}</div>}
            </div>
            <Check className="mt-0.5 size-4 text-primary" />
          </DropdownMenuItem>
          <DropdownMenuSeparator className="mx-2 my-2" />
        </>
      )}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-3 rounded-lg px-3 py-2.5">
          <FolderPlus className="size-4 text-muted-foreground" />
          {t('common:homeMode.addToProject')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-72 min-w-56 overflow-y-auto rounded-xl p-1.5">
          {projects.map((item) => (
            <DropdownMenuItem key={item.id} className="gap-2 rounded-lg px-3 py-2.5" onSelect={() => onSelectProject?.(item)}>
              <Folder className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              {project?.id === item.id && <Check className="size-4 text-primary" />}
            </DropdownMenuItem>
          ))}
          {projects.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem className="gap-2 rounded-lg px-3 py-2.5" onSelect={onAddProject}>
            <FolderPlus className="size-4 text-muted-foreground" />
            {t('common:homeMode.newProject')}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem className="gap-3 rounded-lg px-3 py-2.5" onSelect={onAddFolder}>
        <FolderOpen className="size-4 text-muted-foreground" />
        {t('common:homeMode.addFolderAction')}
      </DropdownMenuItem>
      {selected && (
        <DropdownMenuItem className="gap-3 rounded-lg px-3 py-2.5 text-muted-foreground" onSelect={onRemove}>
          <X className="size-4" />
          {t('common:homeMode.removeFolder')}
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  )

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-9 max-w-64 gap-2 rounded-full border-border bg-white px-3 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground dark:bg-background motion-reduce:transition-none has-[>svg]:px-3" data-testid="home-cowork-folder">
            {selected && <Folder className="size-4 text-muted-foreground" aria-hidden="true" />}
            <span className="truncate">{selected ? label : t('common:homeMode.addFolder')}</span>
          </Button>
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
      {selected && (
        <Button variant="outline" size="icon" className="size-9 rounded-full border-border bg-white shadow-none hover:bg-accent dark:bg-background motion-reduce:transition-none" aria-label={t('common:homeMode.addFolder')} onClick={() => setOpen(true)}>
          <FolderPlus className="size-4 text-muted-foreground" />
        </Button>
      )}
    </div>
  )
}
