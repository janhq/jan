import { useAppState } from '@/hooks/useAppState'
import { Loader } from 'lucide-react'

export function PromptProgress() {
  const promptProgress = useAppState((state) => state.promptProgress)
  const loadingModel = useAppState((state) => state.loadingModel)

  if (loadingModel) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <Loader className="animate-spin w-4 h-4" />
        <span>Loading model…</span>
      </div>
    )
  }

  const percentage =
    promptProgress && promptProgress.total > 0
      ? Math.round((promptProgress.processed / promptProgress.total) * 100)
      : 0

  if (
    !promptProgress ||
    !promptProgress.total ||
    promptProgress.total <= 0 ||
    percentage >= 100
  ) {
    return <Loader className="animate-spin w-4 h-4" />
  }

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
      <Loader className="animate-spin w-4 h-4" />
      <span>Reading: {percentage}%</span>
    </div>
  )
}
