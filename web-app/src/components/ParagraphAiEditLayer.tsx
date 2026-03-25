import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { IconSparkles } from '@tabler/icons-react'
import {
  applySpanReplacement,
  buildParagraphEditPrompts,
  findSelectedSpan,
  unwrapModelPassage,
} from '@/lib/paragraphEdit'
import { runParagraphEditCompletion } from '@/lib/runParagraphEditCompletion'

type ParagraphAiEditLayerProps = {
  sourceMarkdown: string
  disabled?: boolean
  onApply: (newMarkdown: string) => void
  children: ReactNode
}

export function ParagraphAiEditLayer({
  sourceMarkdown,
  disabled,
  onApply,
  children,
}: ParagraphAiEditLayerProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const selectedTextRef = useRef<string>('')
  const editSelectionRef = useRef<string>('')
  const [selectionPreview, setSelectionPreview] = useState('')
  const [toolbar, setToolbar] = useState<{
    left: number
    top: number
  } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [running, setRunning] = useState(false)

  const clearToolbar = useCallback(() => setToolbar(null), [])

  useEffect(() => {
    if (disabled) {
      clearToolbar()
    }
  }, [disabled, clearToolbar])

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const el = containerRef.current
      const tb = toolbarRef.current
      if (!el || !toolbar) return
      const target = e.target as Node
      if (tb?.contains(target)) return
      if (el.contains(target)) return
      clearToolbar()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [toolbar, clearToolbar])

  const handleMouseUp = useCallback(() => {
    if (disabled) return

    const sel = window.getSelection()
    const el = containerRef.current
    if (!sel || sel.isCollapsed || !el) {
      clearToolbar()
      return
    }

    const anchor = sel.anchorNode
    const focus = sel.focusNode
    if (
      !anchor ||
      !focus ||
      !el.contains(anchor) ||
      !el.contains(focus)
    ) {
      clearToolbar()
      return
    }

    const text = sel.toString()
    if (!text.trim()) {
      clearToolbar()
      return
    }

    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      clearToolbar()
      return
    }

    setToolbar({
      left: rect.left + rect.width / 2,
      top: rect.bottom + 8,
    })
    selectedTextRef.current = text
  }, [disabled, clearToolbar])

  const openDialog = useCallback(() => {
    const raw = selectedTextRef.current
    editSelectionRef.current = raw
    setSelectionPreview(raw.trim())
    setInstruction('')
    setDialogOpen(true)
    clearToolbar()
    window.getSelection()?.removeAllRanges()
  }, [clearToolbar])

  const handleSubmit = useCallback(async () => {
    const trimmed = instruction.trim()
    if (!trimmed) return

    const selected = editSelectionRef.current
    const span = findSelectedSpan(sourceMarkdown, selected)
    if (!span) {
      toast.error(t('chat:paragraphEdit.errorLocate'))
      return
    }

    const { system, user } = buildParagraphEditPrompts({
      fullSource: sourceMarkdown,
      span,
      userInstruction: trimmed,
    })

    setRunning(true)
    try {
      const raw = await runParagraphEditCompletion({
        system,
        user,
      })
      const revised = unwrapModelPassage(raw)
      if (!revised) {
        toast.error(t('chat:paragraphEdit.errorEmpty'))
        return
      }
      const next = applySpanReplacement(sourceMarkdown, span, revised)
      onApply(next)
      setDialogOpen(false)
      editSelectionRef.current = ''
      selectedTextRef.current = ''
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : t('chat:paragraphEdit.errorModel')
      toast.error(msg)
    } finally {
      setRunning(false)
    }
  }, [instruction, sourceMarkdown, onApply, t])

  return (
    <>
      <div
        ref={containerRef}
        className="relative"
        onMouseUp={handleMouseUp}
      >
        {children}
      </div>

      {toolbar && !disabled && (
        <div
          ref={toolbarRef}
          className="fixed z-50 pointer-events-auto"
          style={{
            left: toolbar.left,
            top: toolbar.top,
            transform: 'translateX(-50%)',
          }}
        >
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="shadow-md gap-1.5"
            onClick={(e) => {
              e.stopPropagation()
              openDialog()
            }}
          >
            <IconSparkles size={16} className="shrink-0" />
            {t('chat:paragraphEdit.editWithAi')}
          </Button>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('chat:paragraphEdit.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                {t('chat:paragraphEdit.selectionLabel')}
              </p>
              <div className="max-h-28 overflow-y-auto rounded-md border bg-muted/40 px-2 py-1.5 text-sm whitespace-pre-wrap">
                {selectionPreview || '—'}
              </div>
            </div>
            <div>
              <label
                htmlFor="paragraph-edit-instruction"
                className="text-xs text-muted-foreground mb-1 block"
              >
                {t('chat:paragraphEdit.instructionLabel')}
              </label>
              <Textarea
                id="paragraph-edit-instruction"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder={t('chat:paragraphEdit.instructionPlaceholder')}
                rows={3}
                disabled={running}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey) {
                    e.preventDefault()
                    void handleSubmit()
                  }
                }}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {t('chat:paragraphEdit.hintCtrlEnter')}
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={running}
            >
              {t('chat:paragraphEdit.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={running || !instruction.trim()}
            >
              {running
                ? t('chat:paragraphEdit.running')
                : t('chat:paragraphEdit.apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
