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
import { useCodeSessions } from '@/hooks/useCodeSessions'
import { useSkills, type HubSkill } from '@/hooks/useSkills'

export default function SkillsManagerDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const sessions = useCodeSessions((s) => s.sessions)
  const currentId = useCodeSessions((s) => s.currentId)
  const folder = sessions.find((s) => s.id === currentId)?.folder ?? null

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('common:skillsTitle')}</DialogTitle>
        </DialogHeader>

        {!folder ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {t('common:skillsSelectFolder')}
          </div>
        ) : (
          <div className="flex gap-4 h-[60vh] overflow-hidden">
            {/* Skill list */}
            <div className="w-1/3 min-h-0 flex flex-col gap-2 border-r pr-3">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 justify-start"
                onClick={startNew}
              >
                <Plus size={14} />
                {t('common:skillNew')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  'gap-1.5 justify-start',
                  hubMode && 'bg-accent'
                )}
                onClick={openHub}
              >
                <DownloadCloud size={14} />
                {t('common:skillHubImport')}
              </Button>
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1">
                {skills.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-1 py-2">
                    {t('common:skillsEmpty')}
                  </p>
                ) : (
                  skills.map((s) => (
                    <div
                      key={s.name}
                      className={cn(
                        'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-accent',
                        !hubMode && selected === s.name && 'bg-accent'
                      )}
                      onClick={() => openSkill(s.name)}
                    >
                      <FileText size={14} className="shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">{s.name}</div>
                        {s.description && (
                          <div className="line-clamp-2 break-words text-xs text-muted-foreground">
                            {s.description}
                          </div>
                        )}
                      </div>
                      <button
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(s.name)
                        }}
                        title={t('common:skillDelete')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Right pane: hub browser, editor, or placeholder */}
            <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
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
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('common:skillNamePlaceholder')}
                    disabled={!isNew}
                  />
                  <Textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={t('common:skillContentPlaceholder')}
                    className="flex-1 font-mono text-xs resize-none"
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
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                  {t('common:skillsPickOrNew')}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
