import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { AskAnswer, AskRequestPayload } from '@/types/coworkSession'

/** Sentinel for the free-text row; never a real option label. */
const OTHER = '\u0000other'

/** Square check for multi-select rows. No checkbox primitive exists in `ui/`. */
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

/** Numbered badge for single-select rows; fills when selected. Matches the 1–9 shortcuts. */
function NumberBadge({ n, checked }: { n: number; checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-medium tabular-nums transition-colors',
        checked
          ? 'bg-primary text-primary-foreground'
          : 'bg-main-view-fg/10 text-main-view-fg/60'
      )}
    >
      {n}
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
  const otherInputRef = useRef<HTMLInputElement>(null)
  const keyHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  // Option picks set aside while free text is active, so clearing the text
  // restores them instead of leaving the user with nothing selected.
  const stashRef = useRef<Record<string, string[]>>({})

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandlerRef.current?.(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A new request is a clean slate; keeping prior picks would silently answer
  // the next question with the previous one's selections.
  useEffect(() => {
    setIndex(0)
    setSelected({})
    setCustom({})
    stashRef.current = {}
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

  if (!requestId || !question) {
    // Don't leave the previous render's closure answering digit presses.
    keyHandlerRef.current = null
    return null
  }

  const picks = selected[question.id] ?? []
  const isLast = index === questions.length - 1
  const usingCustom = picks.includes(OTHER)

  const toggle = (label: string) => {
    // Picking an option drops the free-text answer, so don't leave its text
    // sitting in the input looking like the live answer.
    if (label !== OTHER && picks.includes(OTHER)) {
      setCustom((c) => ({ ...c, [question.id]: '' }))
      delete stashRef.current[question.id]
    }
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

  // Single-select only: 1–9 pick the matching option; the number after the last
  // option focuses the free-text row. Ignored while typing so digits still reach
  // inputs.
  keyHandlerRef.current = (e: KeyboardEvent) => {
    if (question.multi) return
    if (e.defaultPrevented || e.isComposing || e.repeat) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const el = e.target instanceof HTMLElement ? e.target : null
    // Only act when focus is on the page itself or inside this card; a press on
    // a sidebar button or link elsewhere must not change the pending answer.
    if (el && el !== document.body && !cardRef.current?.contains(el)) return
    if (
      el &&
      (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
        el.isContentEditable ||
        el.closest(
          '[role=textbox],[role=combobox],[role=listbox],[role=menu],[role=dialog],[role=slider]'
        ))
    ) {
      return
    }
    // Keyboard-only path: after a number pick, Enter continues. Handled on the
    // page or on a focused option row (a mouse-clicked option keeps focus, and
    // its native Enter would re-toggle it); other buttons keep native Enter.
    if (e.key === 'Enter') {
      const onPage = !el || el === document.body || el.getAttribute('role') === 'radio'
      if (onPage && (isLast ? allAnswered : isAnswered(question.id))) {
        e.preventDefault()
        advance()
      }
      return
    }
    if (!/^[1-9]$/.test(e.key)) return
    const n = Number(e.key)
    if (n <= question.options.length) {
      e.preventDefault()
      toggle(question.options[n - 1].label)
    } else if (n === question.options.length + 1) {
      e.preventDefault()
      otherInputRef.current?.focus()
    }
  }
  // Declining resolves the whole request as cancelled — the core has no
  // per-question skip, since every question must come back answered.
  const decline = () => onRespond(requestId, null)

  return (
    <div ref={cardRef} className="mb-2 rounded-lg border bg-main-view">
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

      <div
        role={question.multi ? 'group' : 'radiogroup'}
        aria-label={question.question}
        className="flex flex-col gap-0.5 px-2 pb-1"
      >
        {question.options.map((option, i) => {
          const checked = picks.includes(option.label)
          return (
            <button
              key={option.label}
              type="button"
              role={question.multi ? 'checkbox' : 'radio'}
              aria-checked={checked}
              aria-keyshortcuts={question.multi || i > 8 ? undefined : String(i + 1)}
              onClick={() => toggle(option.label)}
              title={option.description}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-main-view-fg/5"
            >
              {question.multi ? (
                <CheckSquare checked={checked} />
              ) : (
                <NumberBadge n={i + 1} checked={checked} />
              )}
              <span className="min-w-0 flex-1 leading-5">
                <span className="text-[13px]">{option.label}</span>
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
        {/* Always-visible input so users can see they can type their own answer. */}
        <div
          onClick={() => otherInputRef.current?.focus()}
          className={cn(
            'flex items-center gap-2 rounded-md px-2 py-1 focus-within:bg-main-view-fg/5',
            usingCustom && 'bg-main-view-fg/5'
          )}
        >
          {question.multi ? (
            <CheckSquare checked={usingCustom} />
          ) : (
            <NumberBadge n={question.options.length + 1} checked={usingCustom} />
          )}
          <Input
            ref={otherInputRef}
            value={custom[question.id] ?? ''}
            onChange={(e) => {
              const value = e.target.value
              setCustom((prev) => ({ ...prev, [question.id]: value }))
              // Real text selects the free-text answer (exclusive with options, per
              // the QuestionResult contract); the prior picks are stashed and come
              // back when the text is cleared. Blank text never touches picks.
              if (value.trim()) {
                if (!picks.includes(OTHER)) stashRef.current[question.id] = picks
                setSelected((prev) => ({ ...prev, [question.id]: [OTHER] }))
              } else if (picks.includes(OTHER)) {
                const restored = stashRef.current[question.id] ?? []
                delete stashRef.current[question.id]
                setSelected((prev) => ({ ...prev, [question.id]: restored }))
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // Confirming an IME composition must not advance or submit.
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                e.preventDefault()
                if (isLast ? allAnswered : isAnswered(question.id)) {
                  e.currentTarget.blur()
                  advance()
                }
              } else if (e.key === 'Escape') {
                e.currentTarget.blur()
              }
            }}
            placeholder={t('common:askSomethingElse')}
            aria-label={t('common:askSomethingElse')}
            className="h-7 flex-1 border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0 md:text-[13px] dark:bg-transparent"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 border-t px-3 py-2">
        <span className="text-xs text-main-view-fg/50">
          {question.multi && !usingCustom
            ? t('common:askSelectedCount', { count: picks.length })
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
