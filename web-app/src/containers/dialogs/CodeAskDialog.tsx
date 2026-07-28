import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { AskAnswer, AskRequestPayload } from '@/hooks/useCodeRun'

const OTHER = '__other__'

/**
 * Dialog for the agent core's interactive `ask` tool (see interaction.rs),
 * mirroring the TUI's structured question prompt. Answers every question in
 * the request at once; dismissing without answering is treated as cancelled.
 */
export function CodeAskDialog({
  requestId,
  request,
  onRespond,
}: {
  requestId: string | null
  request: AskRequestPayload | null
  onRespond: (requestId: string, answers: AskAnswer[] | null) => void
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})

  useEffect(() => {
    setSelected({})
    setCustom({})
  }, [requestId])

  if (!requestId || !request) return null

  const toggleOption = (questionId: string, label: string, multi: boolean) => {
    setSelected((prev) => {
      const current = prev[questionId] ?? []
      if (label === OTHER) {
        return { ...prev, [questionId]: current.includes(OTHER) ? [] : [OTHER] }
      }
      if (!multi) return { ...prev, [questionId]: current.includes(label) ? [] : [label] }
      return {
        ...prev,
        [questionId]: current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current.filter((l) => l !== OTHER), label],
      }
    })
  }

  const answered = request.questions.every((q) => {
    const sel = selected[q.id] ?? []
    if (sel.includes(OTHER)) return !!custom[q.id]?.trim()
    return sel.length > 0
  })

  const submit = () => {
    const answers: AskAnswer[] = request.questions.map((q) => {
      const sel = selected[q.id] ?? []
      if (sel.includes(OTHER)) {
        return { id: q.id, selected: [], custom_input: custom[q.id]?.trim() }
      }
      return { id: q.id, selected: sel }
    })
    onRespond(requestId, answers)
  }

  return (
    <Dialog
      open={!!requestId}
      onOpenChange={(next) => {
        if (!next) onRespond(requestId, null)
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('common:askDialogTitle')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {request.questions.map((q) => (
            <div key={q.id} className="flex flex-col gap-2">
              <p className="text-sm font-medium">{q.question}</p>
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((opt) => {
                  const isSelected = (selected[q.id] ?? []).includes(opt.label)
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      title={opt.description}
                      onClick={() => toggleOption(q.id, opt.label, !!q.multi)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs',
                        isSelected
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-input hover:bg-accent'
                      )}
                    >
                      {opt.label}
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={() => toggleOption(q.id, OTHER, !!q.multi)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs',
                    (selected[q.id] ?? []).includes(OTHER)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-input hover:bg-accent'
                  )}
                >
                  {t('common:askDialogOther')}
                </button>
              </div>
              {(selected[q.id] ?? []).includes(OTHER) && (
                <Input
                  autoFocus
                  value={custom[q.id] ?? ''}
                  onChange={(e) =>
                    setCustom((prev) => ({ ...prev, [q.id]: e.target.value }))
                  }
                  placeholder={t('common:askDialogOtherPlaceholder')}
                />
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onRespond(requestId, null)}>
            {t('common:cancel')}
          </Button>
          <Button disabled={!answered} onClick={submit}>
            {t('common:submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
