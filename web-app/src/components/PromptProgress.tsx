import { useAppState } from '@/hooks/useAppState'
<<<<<<< HEAD
=======
import { Loader } from 'lucide-react'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

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
<<<<<<< HEAD
    return null
=======
    return <Loader className="animate-spin w-4 h-4" />
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  }

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
      <span>Reading: {percentage}%</span>
    </div>
  )
}
