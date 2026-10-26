import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  X,
} from 'lucide-react'
import { useIsPresent } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { AskAnswer, AskRequestPayload } from '@/types/coworkSession'

/** Pause between a single-select pick and moving to the next question. */
const AUTO_ADVANCE_MS = 200

/** Clicks this soon after an automatic jump are ignored (see `jumpedAtRef`). */
const CLICK_GUARD_MS = 300

/** Sentinel for the free-text row; never a real option label. */
const OTHER = '\u0000other'

/** Square check for multi-select rows. No checkbox primitive exists in `ui/`. */
function CheckSquare({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center"
    >
      <span
        className={cn(
          'flex size-4 items-center justify-center rounded border transition-colors',
          checked
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-main-view-fg/30'
        )}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
    </span>
  )
}

/** Numbered badge for single-select rows; fills when selected. Matches the 1–9 shortcuts. */
function NumberBadge({ n, checked }: { n: React.ReactNode; checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-medium tabular-nums transition-colors',
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
  // Which way the last page change went, so the new question slides in from
  // that side. Derived during render from the previous index (React's
  // "storing information from previous renders" pattern); 0 on first render,
  // so the opening question doesn't slide on top of the card's own entrance.
  const [shownIndex, setShownIndex] = useState(index)
  const [direction, setDirection] = useState(0)
  if (index !== shownIndex) {
    setShownIndex(index)
    setDirection(index > shownIndex ? 1 : -1)
  }
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const otherInputRef = useRef<HTMLInputElement>(null)
  const keyHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  // The option row last pressed with a pointer. A clicked row keeps focus, so
  // Enter there means "continue"; a row reached by Tab means "pick this one".
  const pointerRowRef = useRef<Element | null>(null)
  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // When the last automatic jump landed. A click this soon after one is most
  // likely the tail of a double-click on the previous page, and would
  // otherwise answer the new question too; number keys are unaffected.
  const jumpedAtRef = useRef(-Infinity)
  const cancelAutoAdvance = () =>
    clearTimeout(autoAdvanceRef.current ?? undefined)
  // False while the card plays its exit animation (cowork.tsx wraps it in
  // AnimatePresence). An exiting card is already answered, or belongs to a
  // session the user switched away from, so it must stop taking input:
  // no shortcuts, no pending jump, no focus grabs, and `inert` for the rest.
  const isPresent = useIsPresent()
  useEffect(() => {
    if (!isPresent) clearTimeout(autoAdvanceRef.current ?? undefined)
  }, [isPresent])
  // Any page change (manual or the jump itself) cancels a pending jump, so
  // paging away and back can't be followed by a surprise advance.
  useEffect(
    () => () => clearTimeout(autoAdvanceRef.current ?? undefined),
    [index]
  )
  // Option picks set aside while free text is active, so clearing the text
  // restores them instead of leaving the user with nothing selected.
  const stashRef = useRef<Record<string, string[]>>({})

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandlerRef.current?.(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Built later in render (it needs the question), but only installed once the
  // render commits, so a discarded render can never leave a stale handler. It
  // stays null on the early-return path below, which clears the old one.
  let handleKey: ((e: KeyboardEvent) => void) | null = null
  useLayoutEffect(() => {
    keyHandlerRef.current = isPresent ? handleKey : null
  })

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

  // The chat box autofocuses and would swallow the digits, so a new question
  // takes focus itself — on arrival and on every page change, since the control
  // that advanced (the arrow) may unmount and drop focus to the page. A chat
  // box the user is already typing into keeps its focus and its text.
  const hasQuestion = !!requestId && !!question
  useEffect(() => {
    if (!hasQuestion || !isPresent) return
    const active = document.activeElement
    const typing =
      (active instanceof HTMLTextAreaElement ||
        active instanceof HTMLInputElement) &&
      !cardRef.current?.contains(active) &&
      active.value.trim() !== ''
    if (!typing) cardRef.current?.focus({ preventScroll: true })
  }, [requestId, hasQuestion, index, isPresent])

  if (!requestId || !question) return null

  const picks = selected[question.id] ?? []
  const isLast = index === questions.length - 1
  const usingCustom = picks.includes(OTHER)

  const toggle = (label: string) => {
    // Picking an option drops the free-text answer, so don't leave its text
    // sitting in the input looking like the live answer.
    if (picks.includes(OTHER)) {
      setCustom((c) => ({ ...c, [question.id]: '' }))
      const stashed = stashRef.current[question.id] ?? []
      delete stashRef.current[question.id]
      if (question.multi) {
        // Bring the set-aside checks back and add this one, rather than losing them.
        setSelected((prev) => ({
          ...prev,
          [question.id]: stashed.includes(label)
            ? stashed
            : [...stashed, label],
        }))
        return
      }
    }
    setSelected((prev) => {
      const current = prev[question.id] ?? []
      // Free text is exclusive with options: the contract allows one or the
      // other on a `QuestionResult`, never both.
      const withoutOther = current.filter((l) => l !== OTHER)
      // Radio semantics: picking again keeps the pick, so pressing the same
      // number twice can't silently clear the answer.
      if (!question.multi) return { ...prev, [question.id]: [label] }
      return {
        ...prev,
        [question.id]: withoutOther.includes(label)
          ? withoutOther.filter((l) => l !== label)
          : [...withoutOther, label],
      }
    })
    // A single-select pick is the whole answer, so move on to the next question
    // after a beat that lets the pick register. The last question waits for an
    // explicit continue, since submitting can't be undone.
    if (!question.multi && !isLast) {
      cancelAutoAdvance()
      const from = index
      autoAdvanceRef.current = setTimeout(() => {
        jumpedAtRef.current = performance.now()
        setIndex(from + 1)
      }, AUTO_ADVANCE_MS)
    }
  }

  const submit = () => {
    onRespond(
      requestId,
      questions.map((q) => {
        const answer = selected[q.id] ?? []
        return answer.includes(OTHER)
          ? { id: q.id, selected: [], custom_input: custom[q.id]?.trim() }
          : {
              id: q.id,
              // Option order, not click order, so the answer reads like the list.
              selected: q.options
                .map((o) => o.label)
                .filter((l) => answer.includes(l)),
            }
      })
    )
  }

  // The core rejects a response that doesn't answer every question exactly
  // once (`validate_results`), so submit waits until all are answered.
  const firstUnanswered = questions.findIndex((q) => !isAnswered(q.id))
  const openElsewhere = questions.some(
    (q, i) => i !== index && !isAnswered(q.id)
  )
  // On the last page with an earlier question still open (the user paged ahead),
  // continuing takes them to it rather than leaving a disabled dead end.
  const advance = () => {
    if (!isLast) setIndex((i) => i + 1)
    else if (firstUnanswered === -1) submit()
    else setIndex(firstUnanswered)
  }

  // Enter continues once this question is answered. Single-select also gets 1–9
  // to pick the matching option, and the number after the last option focuses
  // the free-text row. Ignored while typing so digits still reach inputs.
  handleKey = (e: KeyboardEvent) => {
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
    // Keyboard-only path: after a pick, Enter continues. Handled on the page,
    // on a row the user clicked (a clicked row keeps focus, and its native
    // Enter would re-toggle it), or on the ticked radio. Enter on any other row
    // keeps its native meaning — pick or untick that row — so it never submits
    // a different answer than the one the user is looking at.
    if (e.key === 'Enter') {
      const onPage =
        !el ||
        el === document.body ||
        el === cardRef.current ||
        el === pointerRowRef.current ||
        // A ticked radio is the answer itself, so Enter on it continues. A
        // ticked checkbox is not: Enter there must untick it as usual.
        (el.getAttribute('role') === 'radio' &&
          el.getAttribute('aria-checked') === 'true')
      if (onPage && isAnswered(question.id)) {
        e.preventDefault()
        advance()
      }
      return
    }
    if (question.multi || !/^[1-9]$/.test(e.key)) return
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

  const answered = isAnswered(question.id)
  const canAdvance = answered
  // Typed text replaces the option picks (the contract allows one or the other),
  // so the options recede — for multi-select too, where the unticking is
  // otherwise easy to miss.
  const dimOptions = usingCustom

  const iconButton =
    'rounded p-1 hover:text-main-view-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-30'

  const skipButton = (
    <Button variant="ghost" size="sm" className="h-7" onClick={decline}>
      {t('common:skip')}
    </Button>
  )
  const continueButton = (
    <Button
      size="icon-sm"
      className="rounded-md"
      disabled={!canAdvance}
      // Distinct from the chevron's `askNext`: that only pages the view,
      // this is the primary action (record this answer, then move on).
      aria-label={
        isLast && !openElsewhere ? t('common:submit') : t('common:askContinue')
      }
      onClick={advance}
    >
      <ArrowRight size={14} />
    </Button>
  )

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      inert={!isPresent}
      role="group"
      aria-label={
        questions.length > 1
          ? `${question.question} (${t('common:askPageOf', { current: index + 1, total: questions.length })})`
          : question.question
      }
      className="mb-2 rounded-lg border bg-main-view outline-none"
    >
      <div className="flex items-start gap-2 px-4 pt-3 pb-1.5">
        <p
          key={index}
          className={cn(
            'min-w-0 flex-1 text-sm font-medium',
            direction !== 0 &&
              'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200'
          )}
        >
          {question.question}
        </p>
        <div className="flex shrink-0 items-center gap-0.5 text-main-view-fg/50">
          {questions.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                disabled={index === 0}
                aria-label={t('common:askPrev')}
                className={iconButton}
              >
                <ChevronLeft size={14} />
              </button>
              <span className="px-0.5 text-xs tabular-nums">
                {t('common:askPageOf', {
                  current: index + 1,
                  total: questions.length,
                })}
              </span>
              <button
                type="button"
                onClick={() =>
                  setIndex((i) => Math.min(questions.length - 1, i + 1))
                }
                disabled={isLast}
                aria-label={t('common:askNext')}
                className={iconButton}
              >
                <ChevronRight size={14} />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={decline}
            aria-label={t('common:close')}
            className={cn(iconButton, 'ml-1')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Keyed by page so each question mounts fresh and plays the slide. */}
      <div
        key={index}
        className={cn(
          direction !== 0 &&
            'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200 motion-safe:ease-out',
          direction > 0 && 'motion-safe:slide-in-from-right-2',
          direction < 0 && 'motion-safe:slide-in-from-left-2'
        )}
      >
        <div
          role={question.multi ? 'group' : 'radiogroup'}
          aria-label={question.question}
          // Capped so a long list can't push the chat box off screen.
          className="flex max-h-[45vh] flex-col overflow-y-auto px-2"
        >
          {question.options.map((option, i) => {
            const checked = picks.includes(option.label)
            return (
              // The hairline sits on a flat wrapper so the row's rounded hover
              // fill doesn't curl its ends.
              <div
                key={option.label}
                className={cn(
                  'border-b border-main-view-fg/5 py-px last:border-b-0',
                  // No hairline touching a filled row (picked or hovered): drop
                  // this wrapper's own line and the one on the row above it.
                  'has-[>button[aria-checked=true]]:border-transparent has-[>button:hover]:border-transparent',
                  '[&:has(+div>button[aria-checked=true])]:border-transparent [&:has(+div>button:hover)]:border-transparent'
                )}
              >
                <button
                  type="button"
                  role={question.multi ? 'checkbox' : 'radio'}
                  aria-checked={checked}
                  aria-keyshortcuts={
                    question.multi || i > 8 ? undefined : String(i + 1)
                  }
                  onPointerDown={(e) =>
                    (pointerRowRef.current = e.currentTarget)
                  }
                  onClick={() => {
                    if (
                      performance.now() - jumpedAtRef.current <
                      CLICK_GUARD_MS
                    )
                      return
                    toggle(option.label)
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-[opacity,background-color] hover:bg-main-view-fg/5',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    checked && 'bg-main-view-fg/5',
                    dimOptions &&
                      'opacity-50 hover:opacity-100 focus-visible:opacity-100'
                  )}
                >
                  {question.multi ? (
                    <CheckSquare checked={checked} />
                  ) : (
                    // Only 1–9 have key shortcuts; past that a number would read as a
                    // shortcut that doesn't exist.
                    <NumberBadge n={i < 9 ? i + 1 : '·'} checked={checked} />
                  )}
                  {/* leading-6 matches the 24px badge so the label centres on it. */}
                  <span className="min-w-0 flex-1 leading-6">
                    <span className="text-[13px]">{option.label}</span>
                    {question.recommended === i && (
                      // The leading space keeps the accessible name from running
                      // "label.Recommended" together.
                      <span className="ml-1 text-[11px] text-main-view-fg/60">
                        {' '}
                        {t('common:askRecommended')}
                      </span>
                    )}
                    {option.description && (
                      <span className="block text-[11px] leading-4 text-main-view-fg/60">
                        {option.description}
                      </span>
                    )}
                  </span>
                </button>
              </div>
            )
          })}
        </div>

        {/* Always-visible row (like Claude's ask card) so it's obvious users can
          type their own answer. Its leading mark matches the option rows: a
          pencil badge for single-select, a checkbox for multi-select. */}
        <div className="px-2 pt-1 pb-2">
          <div
            onClick={() => otherInputRef.current?.focus()}
            className={cn(
              'flex h-11 cursor-text items-center gap-3 rounded-lg px-2 transition-colors',
              usingCustom
                ? 'bg-main-view-fg/8'
                : 'bg-main-view-fg/4 focus-within:bg-main-view-fg/8'
            )}
          >
            {question.multi ? (
              <CheckSquare checked={usingCustom} />
            ) : (
              <NumberBadge n={<Pencil size={12} />} checked={false} />
            )}
            <Input
              ref={otherInputRef}
              value={custom[question.id] ?? ''}
              // Heading for the free-text row means the pick wasn't the final
              // answer, so a jump queued by it must not pull the user away.
              onFocus={cancelAutoAdvance}
              onChange={(e) => {
                cancelAutoAdvance()
                const value = e.target.value
                setCustom((prev) => ({ ...prev, [question.id]: value }))
                // Real text selects the free-text answer (exclusive with options, per
                // the QuestionResult contract); the prior picks are stashed and come
                // back when the text is cleared. Blank text never touches picks.
                if (value.trim()) {
                  if (!picks.includes(OTHER))
                    stashRef.current[question.id] = picks
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
                  if (answered) {
                    e.currentTarget.blur()
                    advance()
                  }
                } else if (e.key === 'Escape') {
                  e.currentTarget.blur()
                }
              }}
              placeholder={t('common:askSomethingElse')}
              aria-label={t('common:askSomethingElse')}
              aria-keyshortcuts={
                question.multi || question.options.length > 8
                  ? undefined
                  : String(question.options.length + 1)
              }
              className="h-8 flex-1 border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0 md:text-[13px] dark:bg-transparent"
            />
            {/* Single-select keeps its actions in this row: Skip until there is an
              answer, then the continue arrow. Multi-select uses the footer. */}
            {!question.multi && (
              <div
                className="flex shrink-0 items-center"
                onClick={(e) => e.stopPropagation()}
              >
                {answered ? continueButton : skipButton}
              </div>
            )}
          </div>
        </div>
      </div>

      {question.multi && (
        <div className="flex items-center gap-1.5 border-t px-4 py-2">
          <span className="flex-1 text-xs text-main-view-fg/50">
            {t('common:askSelectedCount', { count: picks.length })}
          </span>
          {skipButton}
          {continueButton}
        </div>
      )}
    </div>
  )
}
