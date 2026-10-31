import { useState } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, FileText, DownloadCloud, Loader2, Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { useSkills, type HubSkill } from '@/hooks/useSkills'

type SkillsManagerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function SkillsManagerDialog(props: SkillsManagerDialogProps) {
  const sessions = useCoworkSessions((s) => s.sessions)
  const currentId = useCoworkSessions((s) => s.currentId)
  const folder = sessions.find((s) => s.id === currentId)?.folder ?? null

  // Remount all scope-owned state (including useSkills) together. Late reads or
  // hub loads from the old instance cannot populate an editor in the new scope.
  // Do not key on `open` or session ID: same-folder drafts survive reopening.
  return <ScopedSkillsManagerDialog key={JSON.stringify(folder)} folder={folder} {...props} />
}

function ScopedSkillsManagerDialog({
  open,
  onOpenChange,
  folder,
}: SkillsManagerDialogProps & { folder: string | null }) {
  const { t } = useTranslation()
  const { skills, remove, write, read, hubList, hubImport } = useSkills(folder)
  const localNames = new Set(skills.map((s) => s.name))

  // `selected` is the skill being edited; '' with isNew means a fresh draft.
  const [selected, setSelected] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  // Hub browse state.
  const [hubMode, setHubMode] = useState(false)
  const [hubSkills, setHubSkills] = useState<HubSkill[]>([])
  const [hubLoading, setHubLoading] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)

  const openSkill = async (skillName: string) => {
    try {
      const body = await read(skillName)
      setHubMode(false)
      setSelected(skillName)
      setIsNew(false)
      setName(skillName)
      setContent(body)
    } catch (e) {
      toast.error(String(e))
    }
  }

  const startNew = () => {
    setHubMode(false)
    setSelected(null)
    setIsNew(true)
    setName('')
    // Prefill the SKILL.md frontmatter so new (folder-form) skills carry a
    // name/description the catalog can read.
    setContent('---\nname: \ndescription: \n---\n\n')
  }

  const closeEditor = () => {
    setSelected(null)
    setIsNew(false)
    setName('')
    setContent('')
  }

  const openHub = async () => {
    closeEditor()
    setHubMode(true)
    if (hubSkills.length === 0) {
      setHubLoading(true)
      try {
        setHubSkills(await hubList())
      } catch (e) {
        toast.error(String(e))
      } finally {
        setHubLoading(false)
      }
    }
  }

  const handleImport = async (skillName: string) => {
    setImporting(skillName)
    try {
      await hubImport(skillName)
      toast.success(t('common:skillImported', { name: skillName }))
    } catch (e) {
      toast.error(String(e))
    } finally {
      setImporting(null)
    }
  }

  const handleSave = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error(t('common:skillNameRequired'))
      return
    }
    setSaving(true)
    try {
      await write(trimmed, content)
      setSelected(trimmed)
      setIsNew(false)
      toast.success(t('common:skillSaved'))
    } catch (e) {
      toast.error(String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (skillName: string) => {
    try {
      await remove(skillName)
      if (selected === skillName) closeEditor()
    } catch (e) {
      toast.error(String(e))
    }
  }

  const editing = isNew || selected !== null
  const showWorkspace = hubMode || editing || skills.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-4 overflow-hidden sm:max-w-3xl">
        <DialogHeader className="shrink-0 pr-6 text-left">
          <DialogTitle>{t('common:skillsTitle')}</DialogTitle>
          {/* Name the stores being managed. With a folder attached the list is
              the union of its co-located skills and the global store (#8879);
              with nothing attached it is the global store every session reads. */}
          <p className="break-words text-xs text-muted-foreground">
            {folder
              ? t('common:skillsScopeMerged', { folder })
              : t('common:skillsScopeGlobal')}
          </p>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" className="gap-1.5 rounded-md" onClick={startNew}>
            <Plus size={14} />
            {t('common:skillNew')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={cn('gap-1.5 rounded-md', hubMode && 'bg-accent text-accent-foreground')}
            onClick={openHub}
            aria-pressed={hubMode}
          >
            <DownloadCloud size={14} />
            {t('common:skillHubImport')}
          </Button>
        </div>

        {showWorkspace ? (
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto sm:h-[min(55vh,32rem)] sm:flex-row sm:overflow-hidden">
            {/* Only reserve a sidebar when there are skills to browse. */}
            {skills.length > 0 && (
              <div className="flex max-h-40 shrink-0 flex-col rounded-lg border border-border bg-muted/20 p-2 sm:max-h-none sm:w-56">
                <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1">
                  {skills.map((s) => (
                    <div
                      key={s.name}
                      className={cn(
                        'group flex items-center gap-1 rounded-md text-sm hover:bg-accent hover:text-accent-foreground',
                        !hubMode && selected === s.name && 'bg-accent text-accent-foreground'
                      )}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => openSkill(s.name)}
                        aria-pressed={!hubMode && selected === s.name}
                      >
                        <FileText size={16} className="shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="truncate font-medium leading-5">{s.name}</span>
                            {folder && (
                              <span className="shrink-0 rounded bg-muted px-1 text-[10px] leading-4 text-muted-foreground">
                                {t(
                                  s.origin === 'project'
                                    ? 'common:skillOriginFolder'
                                    : 'common:skillOriginGlobal'
                                )}
                              </span>
                            )}
                          </div>
                          {s.description && (
                            <div className="line-clamp-2 break-words text-xs text-muted-foreground">
                              {s.description}
                            </div>
                          )}
                        </div>
                      </button>
                      <button
                        type="button"
                        className="mr-1 flex shrink-0 items-center justify-center rounded p-1.5 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                        aria-label={`${t('common:skillDelete')}: ${s.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(s.name)
                        }}
                        title={t('common:skillDelete')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    ))}
                </div>
              </div>
            )}

            {/* Hub and editor share the full width when the library is empty. */}
            <div className="flex min-h-64 min-w-0 flex-1 flex-col gap-3 sm:min-h-0">
              {hubMode ? (
                <>
                  <div className="text-sm font-medium">
                    {t('common:skillHubTitle')}
                  </div>
                  {hubLoading ? (
                    <div className="flex-1 flex items-center justify-center text-muted-foreground">
                      <Loader2 className="animate-spin" size={18} />
                    </div>
                  ) : hubSkills.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                      {t('common:skillHubEmpty')}
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1">
                      {hubSkills.map((s) => {
                        const imported = localNames.has(s.name)
                        return (
                          <div
                            key={s.name}
                            className="flex items-center gap-2 rounded-md px-2 py-1.5 min-w-0"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="truncate font-medium text-sm">
                                {s.name}
                              </div>
                              {s.description && (
                                <div className="line-clamp-2 break-words text-xs text-muted-foreground">
                                  {s.description}
                                </div>
                              )}
                            </div>
                            <Button
                              variant="outline"
                              size="xs"
                              className="gap-1 shrink-0"
                              disabled={importing !== null}
                              onClick={() => handleImport(s.name)}
                            >
                              {importing === s.name ? (
                                <Loader2 className="animate-spin" size={12} />
                              ) : imported ? (
                                <Check size={12} />
                              ) : (
                                <DownloadCloud size={12} />
                              )}
                              {imported
                                ? t('common:skillReimport')
                                : t('common:skillImport')}
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              ) : editing ? (
                <>
                  <Input
                    aria-label={t('common:skillNamePlaceholder')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('common:skillNamePlaceholder')}
                    disabled={!isNew}
                  />
                  <Textarea
                    aria-label={t('common:skillContentPlaceholder')}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={t('common:skillContentPlaceholder')}
                    className="min-h-52 flex-1 resize-none font-mono text-xs sm:min-h-0"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={closeEditor}>
                      {t('common:cancel')}
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={saving}>
                      {t('common:skillSave')}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                  <FileText size={24} aria-hidden="true" />
                  <p>{t('common:skillsPickOrNew')}</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
            <div className="rounded-full bg-muted p-3 text-muted-foreground">
              <FileText size={24} aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{t('common:skillsEmpty')}</p>
              <p className="text-sm text-muted-foreground">{t('common:skillsPickOrNew')}</p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
