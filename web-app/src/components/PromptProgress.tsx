import { useAppState } from '@/hooks/useAppState'
import { Loader } from 'lucide-react'

export function PromptProgress() {
  const promptProgress = useAppState((state) => state.promptProgress)
  const loadingModel = useAppState((state) => state.loadingModel)

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
