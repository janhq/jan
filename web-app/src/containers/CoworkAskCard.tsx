import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { AskAnswer, AskRequestPayload } from '@/types/coworkSession'

/** Sentinel for the free-text row; never a real option label. */
const OTHER = '\u0000other'

/** Square check used by the option rows. No checkbox primitive exists in `ui/`. */
function CheckSquare({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
        checked
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-main-view-fg/30'
      )}
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </span>
  )
}

/**
 * Inline card for the agent core's `ask` tool (see interaction.rs), docked above
 * the input rather than shown as a modal — the run is paused, but the user can
 * still scroll the transcript and type a normal reply instead of answering.
 *
 * One question at a time with paging, because a request may carry several.
 */
export function CoworkAskCard({
  requestId,
  request,
  onRespond,
}: {
  requestId: string | null
  request: AskRequestPayload | null
  onRespond: (requestId: string, answers: AskAnswer[] | null) => void
}) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})

  // A new request is a clean slate; keeping prior picks would silently answer
  // the next question with the previous one's selections.
  useEffect(() => {
    setIndex(0)
    setSelected({})
    setCustom({})
  }, [requestId])

  const questions = request?.questions ?? []
  const question = questions[index]

  const isAnswered = (qid: string) => {
    const picks = selected[qid] ?? []
    if (picks.includes(OTHER)) return !!custom[qid]?.trim()
    return picks.length > 0
  }
  // The core rejects a response that doesn't answer every question exactly
  // once (`validate_results`), so submit stays closed until all are answered.
  const allAnswered = useMemo(
    () => questions.length > 0 && questions.every((q) => isAnswered(q.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [questions, selected, custom]
  )

  if (!requestId || !question) return null

  const picks = selected[question.id] ?? []
  const isLast = index === questions.length - 1
  const usingCustom = picks.includes(OTHER)

  const toggle = (label: string) => {
    setSelected((prev) => {
      const current = prev[question.id] ?? []
      // Free text is exclusive with options: the contract allows one or the
      // other on a `QuestionResult`, never both.
      if (label === OTHER) {
        return { ...prev, [question.id]: current.includes(OTHER) ? [] : [OTHER] }
      }
      const withoutOther = current.filter((l) => l !== OTHER)
      if (!question.multi) {
        return { ...prev, [question.id]: withoutOther.includes(label) ? [] : [label] }
      }
      return {
        ...prev,
        [question.id]: withoutOther.includes(label)
          ? withoutOther.filter((l) => l !== label)
          : [...withoutOther, label],
      }
    })
  }

  const submit = () => {
    onRespond(
      requestId,
      questions.map((q) => {
        const answer = selected[q.id] ?? []
        return answer.includes(OTHER)
          ? { id: q.id, selected: [], custom_input: custom[q.id]?.trim() }
          : { id: q.id, selected: answer }
      })
    )
  }

  const advance = () => (isLast ? submit() : setIndex((i) => i + 1))
  // Declining resolves the whole request as cancelled — the core has no
  // per-question skip, since every question must come back answered.
  const decline = () => onRespond(requestId, null)

  return (
    <div className="mb-2 rounded-lg border bg-main-view">
      <div className="flex items-start gap-2 px-3 pt-2.5 pb-2">
        <p className="min-w-0 flex-1 text-sm font-medium">{question.question}</p>
        <div className="flex shrink-0 items-center gap-0.5 text-main-view-fg/50">
          {questions.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                disabled={index === 0}
                aria-label={t('common:askPrev')}
                className="rounded p-0.5 hover:text-main-view-fg disabled:opacity-30"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="px-0.5 text-xs tabular-nums">
                {index + 1}/{questions.length}
              </span>
              <button
                type="button"
                onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
                disabled={isLast}
                aria-label={t('common:askNext')}
                className="rounded p-0.5 hover:text-main-view-fg disabled:opacity-30"
              >
                <ChevronRight size={14} />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={decline}
            aria-label={t('common:close')}
            className="ml-0.5 rounded p-0.5 hover:text-main-view-fg"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-0.5 px-2 pb-1">
        {question.options.map((option, i) => {
          const checked = picks.includes(option.label)
          return (
            <button
              key={option.label}
              type="button"
              onClick={() => toggle(option.label)}
              title={option.description}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-main-view-fg/5"
            >
              <CheckSquare checked={checked} />
              <span className="min-w-0 flex-1">
                <span className="text-[13px] leading-5">{option.label}</span>
                {question.recommended === i && (
                  <span className="ml-1.5 text-[11px] text-main-view-fg/45">
                    {t('common:askRecommended')}
                  </span>
                )}
                {option.description && (
                  <span className="block text-[11px] leading-4 text-main-view-fg/50">
                    {option.description}
                  </span>
                )}
              </span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => toggle(OTHER)}
          className={cn(
            'flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-main-view-fg/5',
            usingCustom && 'bg-main-view-fg/5'
          )}
        >
          <CheckSquare checked={usingCustom} />
          <span className="text-[13px] leading-5">{t('common:askSomethingElse')}</span>
        </button>
        {usingCustom && (
          <Input
            autoFocus
            value={custom[question.id] ?? ''}
            onChange={(e) =>
              setCustom((prev) => ({ ...prev, [question.id]: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isAnswered(question.id)) {
                e.preventDefault()
                advance()
              }
            }}
            placeholder={t('common:askSomethingElsePlaceholder')}
            className="mx-1 mb-1 h-8"
          />
        )}
      </div>

      <div className="flex items-center gap-2 border-t px-3 py-2">
        <span className="text-xs text-main-view-fg/50">
          {question.multi || picks.length > 0
            ? t('common:askSelectedCount', { count: picks.filter((p) => p !== OTHER).length })
            : null}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" className="h-7" onClick={decline}>
            {t('common:skip')}
          </Button>
          <Button
            size="icon-sm"
            className="rounded-full"
            disabled={isLast ? !allAnswered : !isAnswered(question.id)}
            // Distinct from the chevron's `askNext`: that only pages the view,
            // this is the primary action (record this answer, then move on).
            aria-label={isLast ? t('common:submit') : t('common:askContinue')}
            onClick={advance}
          >
            <ArrowRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  )
}
