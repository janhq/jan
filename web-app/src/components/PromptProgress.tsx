import { useAppState } from '@/hooks/useAppState'
import { Loader } from 'lucide-react'

export function PromptProgress() {
  const promptProgress = useAppState((state) => state.promptProgress)

  const percentage =
    promptProgress && promptProgress.total > 0
      ? Math.round((promptProgress.processed / promptProgress.total) * 100)
      : 0

  // Show progress only when promptProgress exists and has valid data, and not completed
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
      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
      <span>Reading: {percentage}%</span>
    </div>
  )
}
