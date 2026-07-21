import { Shield, ShieldAlert, type LucideIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'
import type { CodeRunMode } from '@/hooks/useCodeSessions'

const MODES: {
  value: CodeRunMode
  labelKey: string
  descKey: string
  icon: LucideIcon
}[] = [
  {
    value: 'normal',
    labelKey: 'common:modeNormal',
    descKey: 'common:modeNormalDesc',
    icon: Shield,
  },
  {
    value: 'yolo',
    labelKey: 'common:modeYolo',
    descKey: 'common:modeYoloDesc',
    icon: ShieldAlert,
  },
]

/**
 * Run-mode selector for the Code UI input dock. Only two options exist
 * because that's all the agent core actually supports today (the `--yolo`
 * bypass flag, reachable via agent_run's `yolo` body field) — there's no
 * plan/auto-accept mode on the backend to offer here.
 */
export default function CodeModeSelector({
  mode,
  onChange,
}: {
  mode: CodeRunMode
  onChange: (mode: CodeRunMode) => void
}) {
  const { t } = useTranslation()
  const current = MODES.find((m) => m.value === mode) ?? MODES[0]
  const Icon = current.icon
  const isYolo = mode === 'yolo'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('h-7 gap-1.5 rounded-full', isYolo && 'border-destructive/40')}
          title={t(current.descKey)}
        >
          <Icon
            size={14}
            className={isYolo ? 'text-destructive' : 'text-muted-foreground'}
          />
          <span className={isYolo ? 'text-destructive' : undefined}>
            {t(current.labelKey)}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(v) => onChange(v as CodeRunMode)}
        >
          {MODES.map((m) => (
            <DropdownMenuRadioItem key={m.value} value={m.value}>
              <div className="flex flex-col">
                <span>{t(m.labelKey)}</span>
                <span className="text-xs text-muted-foreground">
                  {t(m.descKey)}
                </span>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
