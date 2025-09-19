import { useAppState } from '@/hooks/useAppState'

export function PromptProgress() {
  const promptProgress = useAppState((state) => state.promptProgress)

  if (!promptProgress) return null

  const percentage =
    promptProgress.total > 0
      ? Math.round((promptProgress.processed / promptProgress.total) * 100)
      : 0

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
      <span>Reading: {percentage}%</span>
    </div>
  )
}
