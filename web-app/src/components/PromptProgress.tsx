import { useAppState } from '@/hooks/useAppState'
import { Loader } from 'lucide-react'
import { useParams } from '@tanstack/react-router'

export function PromptProgress() {
  const params = useParams({ from: '/threads/$threadId', shouldThrow: false })
  const threadId = params?.threadId
  const promptProgress = useAppState((state) =>
    (threadId ? state.promptProgresses[threadId] : undefined) ??
    state.promptProgress
  )
  const loadingModel = useAppState((state) =>
    (threadId ? state.loadingModels[threadId] : undefined) ??
    state.loadingModel
  )

  const percentage =
    promptProgress && promptProgress.total > 0
      ? Math.round((promptProgress.processed / promptProgress.total) * 100)
      : 0

  const showReading =
    promptProgress &&
    promptProgress.total > 0 &&
    percentage < 100

  const label = loadingModel
    ? 'Loading model…'
    : showReading
      ? `Reading: ${percentage}%`
      : 'Working…'

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader className="animate-spin w-4 h-4" />
      <span>{label}</span>
    </div>
  )
}
