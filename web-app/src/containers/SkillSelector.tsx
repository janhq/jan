import { Sparkles } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useSkills, effectiveEnabled, storedEnabled } from '@/hooks/useSkills'

/**
 * Top-of-input control showing which skills will be advertised to the agent this
 * run, with per-skill on/off toggles. Backed by the project's `[skills].enabled`
 * whitelist — an empty whitelist means every skill is enabled.
 */
export default function SkillSelector({ folder }: { folder: string | null }) {
  const { t } = useTranslation()
  const { skills, enabled, setEnabled } = useSkills(folder)

  if (!folder || skills.length === 0) return null

  const allNames = skills.map((s) => s.name)
  const effective = effectiveEnabled(enabled, allNames)

  const toggle = (name: string) => {
    const next = new Set(effective)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setEnabled(storedEnabled(next, allNames))
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 rounded-full"
          title={t('common:skillsInContext')}
        >
          <Sparkles size={14} className="text-muted-foreground" />
          <span>
            {t('common:skills')} {effective.size}/{allNames.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          {t('common:skillsInContext')}
        </div>
        <div className="max-h-64 overflow-y-auto">
          {skills.map((s) => (
            <label
              key={s.name}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
            >
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-medium">{s.name}</div>
                {s.description && (
                  <div className="truncate text-xs text-muted-foreground">
                    {s.description}
                  </div>
                )}
              </div>
              <Switch
                checked={effective.has(s.name)}
                onCheckedChange={() => toggle(s.name)}
              />
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
