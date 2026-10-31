import { useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Check, ChevronDown, FileCode2, FileText, FileImage, FileAudio, FileVideo, Loader2, Bot, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { TodoList, CoworkAttachedFile, SubagentRun } from '@/types/coworkSession'
import { type CoworkArtifact } from '@/lib/coworkArtifacts'
import { DIFF_ADD_TEXT, DIFF_DEL_TEXT, type CoworkFileDiff } from '@/lib/coworkDiffs'
import { cleanTaskLabel } from '@/lib/todoLabels'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { TITLEBAR_HEIGHT, useTitlebarLayout } from '@/stores/titlebar-layout-store'

function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <section className="py-5 first:pt-0 last:pb-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-2 rounded-md text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {title}
        <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform motion-reduce:transition-none', !open && '-rotate-90')} />
      </button>
      <div className={cn('grid transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')} inert={!open}>
        <div className="overflow-hidden"><div className="pt-4">{children}</div></div>
      </div>
    </section>
  )
}

/** A single quiet information rail; previews and detailed diffs remain separate. */
export function CoworkOverviewPanel({ todos, attachments, artifacts, files, subagents, monitorCount = 0, onPreview, onChanges, onAgents, onClose }: {
  todos?: TodoList
  attachments: CoworkAttachedFile[]
  artifacts: CoworkArtifact[]
  files: CoworkFileDiff[]
  subagents: SubagentRun[]
  monitorCount?: number
  onPreview: (path: string) => void
  onChanges: () => void
  onAgents: () => void
  onClose?: () => void
}) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const desktop = useMediaQuery('(min-width: 1280px)', true)
  const rightButtons = useTitlebarLayout((s) => s.layout.right.length)
  // Move into the header's empty rail column, without covering native caption controls.
  const topInset = !IS_MACOS && rightButtons > 0 ? TITLEBAR_HEIGHT : 8
  const tasks = todos?.phases.flatMap((p) => p.tasks) ?? []
  const additions = files.reduce((n, f) => n + f.additions, 0)
  const deletions = files.reduce((n, f) => n + f.deletions, 0)
  const content = (
      <div className="divide-y divide-sidebar-border rounded-xl border border-sidebar-border bg-linear-to-b from-sidebar to-background px-5 py-5 shadow dark:from-sidebar/70">
        <Section title={t('common:overview.progress')}>
          {tasks.length ? <ul className="space-y-4">{tasks.map((task, i) => (
            <li key={i} className="flex items-start gap-2.5 text-xs leading-5">
              {task.status === 'completed' ? <span className="mt-1 flex size-3.5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="size-2.5" /></span> : task.status === 'in_progress' ? <Loader2 className="mt-1 size-3.5 shrink-0 animate-spin text-primary" /> : <span className="mt-1 size-3.5 shrink-0 rounded-full border border-border" />}
              <span className={cn(task.status === 'abandoned' && 'text-muted-foreground line-through')}>{cleanTaskLabel(task.content)}</span>
            </li>
          ))}</ul> : <p className="text-sm leading-6 text-muted-foreground">{t('common:overview.noProgress')}</p>}
        </Section>
        <Section title={t('common:overview.files')}>
          <div className="space-y-1">
            {artifacts.map((a) => {
              const Icon = a.group === 'Code' ? FileCode2 : a.group === 'Image' ? FileImage : a.group === 'Audio' ? FileAudio : a.group === 'Video' ? FileVideo : FileText
              const color = a.group === 'Code' ? 'text-violet-500' : a.group === 'Image' ? 'text-emerald-500' : a.group === 'Document' ? 'text-blue-500' : 'text-amber-500'
              return <button key={a.path} type="button" onClick={() => onPreview(a.path)} className="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2.5 rounded-lg px-1 py-1.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60"><Icon className={cn("size-4", color)} /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium leading-5" title={a.title}>{a.title}</span><span className="block truncate text-[11px] leading-4 text-muted-foreground">{t(`common:artifactGroup${a.group}`)} · {a.label}</span></span>
              </button>
            })}
            {attachments.map((f) => <button key={f.path} type="button" disabled={!f.workspacePath} onClick={() => f.workspacePath && onPreview(f.workspacePath)} className="flex w-full items-center gap-2.5 rounded-lg py-2 text-left hover:bg-muted/60 disabled:cursor-default">
              <FileText className="size-4 shrink-0 text-muted-foreground" /><span className="truncate text-xs">{f.name}</span>
            </button>)}
            {!artifacts.length && !attachments.length && <p className="text-sm leading-6 text-muted-foreground">{t('common:overview.noFiles')}</p>}
          </div>
        </Section>
        {files.length > 0 && <Section title={t('common:changes.title')}>
          <button type="button" onClick={onChanges} className="flex items-center gap-2 rounded-md py-1 text-xs hover:opacity-75"><FileCode2 className="size-4 text-muted-foreground" /><span className={DIFF_ADD_TEXT}>+{additions}</span><span className={DIFF_DEL_TEXT}>−{deletions}</span></button>
        </Section>}
        {(subagents.length > 0 || monitorCount > 0) && <Section title={t('common:overview.backgroundTasks')}>
          <div className="space-y-2">
            {subagents.map((agent) => <button key={agent.runId} type="button" onClick={onAgents} className="flex w-full items-center gap-2.5 rounded-lg py-1.5 text-left text-xs hover:bg-muted/50">
              <Bot className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{agent.name}</span>
              <span className="text-[11px] text-muted-foreground">{agent.status}</span>
            </button>)}
            {monitorCount > 0 && <button type="button" onClick={onAgents} className="flex items-center gap-2.5 rounded-lg py-1.5 text-xs text-muted-foreground hover:text-foreground"><Activity className="size-4" />{t('common:overview.monitorCount', { count: monitorCount })}</button>}
          </div>
        </Section>}
      </div>
  )
  if (!desktop) return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose?.() }}>
      <SheetContent className="w-[min(100%,360px)] gap-0 overflow-y-auto p-3" onCloseAutoFocus={(event) => {
        const trigger = document.querySelector<HTMLButtonElement>('[data-testid="overview-toggle"]')
        if (trigger) { event.preventDefault(); trigger.focus() }
      }}>
        <SheetHeader className="sr-only"><SheetTitle>{t('common:overview.title')}</SheetTitle></SheetHeader>
        {content}
      </SheetContent>
    </Sheet>
  )
  return (
    <motion.aside
      initial={{ opacity: 0, x: reduceMotion ? 0 : 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: reduceMotion ? 0 : 16, pointerEvents: 'none' }}
      transition={{ duration: reduceMotion ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
      aria-label={t('common:overview.title')} className="absolute right-0 bottom-0 z-(--layer-panel) hidden w-80 overflow-y-auto px-3 pb-4 xl:block" style={{ top: topInset }}>
      {content}

    </motion.aside>
  )
}
