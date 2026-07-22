import { useAppState } from '@/hooks/useAppState'
import { Loader } from 'lucide-react'
import { useParams } from '@tanstack/react-router'
import { Progress } from '@/components/ui/progress'

export function PromptProgress({ hideIdle = false }: { hideIdle?: boolean }) {
  const params = useParams({ strict: false })
  const threadId = (params as { threadId?: string })?.threadId
  const promptProgress = useAppState((state) =>
    (threadId ? state.promptProgresses[threadId] : undefined) ??
    state.promptProgress
  )
  const loadingModel = useAppState((state) =>
    (threadId ? state.loadingModels[threadId] : undefined) ??
    state.loadingModel
  )
  const loadProgress = useAppState((state) =>
    (threadId ? state.modelLoadProgressByThread[threadId] : undefined) ??
    state.modelLoadProgress
  )

  const percentage =
    promptProgress && promptProgress.total > 0
      ? Math.round((promptProgress.processed / promptProgress.total) * 100)
      : 0

  const showReading =
    promptProgress &&
    promptProgress.total > 0 &&
    percentage < 100

  // Nothing concrete to report (no model load, no prompt-reading progress).
  // Callers driving their own activity label (e.g. tool-call traces) pass
  // hideIdle to suppress the redundant generic "Working…" fallback.
  if (hideIdle && !loadingModel && !showReading) {
    return null
  }

  const loadPercentage =
    loadingModel && loadProgress ? Math.round(loadProgress.value * 100) : undefined

  // Only worth naming the stage when the load actually has more than one
  // (vision encoder and/or speculative-decoding draft model on top of the
  // main weights) - a plain text-only load is always a single "text_model"
  // stage for its entire duration, so calling that out would be noise.
  const stageLabel =
    loadingModel && loadProgress && (loadProgress.stages?.length ?? 0) > 1
      ? describeLoadStage(loadProgress.stage)
      : undefined

  const label = loadingModel
    ? loadPercentage !== undefined
      ? `Loading ${stageLabel ?? 'model'}: ${loadPercentage}%`
      : 'Loading model…'
    : showReading
      ? `Reading: ${percentage}%`
      : 'Working…'

  const detail =
    showReading && !loadingModel ? buildDetail(promptProgress) : undefined

  return (
    <div className="inline-flex flex-col gap-2 rounded-lg border border-border/40 bg-muted/30 px-3 py-2 min-w-56">
      <div className="flex items-center gap-2 text-sm">
        <Loader className="animate-spin w-3.5 h-3.5 text-primary shrink-0" />
        <span className="font-medium text-foreground">{label}</span>
      </div>
      {showReading && !loadingModel && (
        <Progress value={percentage} className="h-1 bg-secondary/60" />
      )}
      {detail && (
        <div className="text-xs text-muted-foreground tabular-nums">
          {detail}
        </div>
      )}
    </div>
  )
}

function describeLoadStage(stage: string | undefined): string | undefined {
  switch (stage) {
    case 'text_model':
      return 'text model'
    case 'mmproj_model':
      return 'vision encoder'
    case 'spec_model':
      return 'draft model'
    default:
      return undefined
  }
}

function buildDetail(progress: {
  processed: number
  total: number
  time_ms: number
}): string {
  const parts = [
    `${formatTokens(progress.processed)} / ${formatTokens(progress.total)} tokens`,
  ]

  // Extrapolate remaining time from the processing rate so far.
  if (progress.time_ms > 0 && progress.processed > 0) {
    const remaining = progress.total - progress.processed
    const etaMs = (progress.time_ms / progress.processed) * remaining
    if (remaining > 0) parts.push(`~${formatEta(etaMs)} left`)
  }

  return parts.join(' · ')
}

function formatTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000
    return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`
  }
  return `${n}`
}

function formatEta(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rem = seconds % 60
  return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`
}
