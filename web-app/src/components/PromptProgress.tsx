import { useAppState } from '@/hooks/useAppState'
import { useEffect, useState } from 'react'

export function PromptProgress() {
  const promptProgress = useAppState((state) => state.promptProgress)
  const [hideTimeout, setHideTimeout] = useState(false)

  const percentage =
    promptProgress && promptProgress.total > 0
      ? Math.round((promptProgress.processed / promptProgress.total) * 100)
      : 0

  useEffect(() => {
    if (percentage >= 100) {
      const timer = setTimeout(() => {
        setHideTimeout(true)
      }, 500)
      return () => clearTimeout(timer)
    } else {
      setHideTimeout(false)
    }
  }, [percentage])

  if (!promptProgress || hideTimeout) return null

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
      <span>Reading: {percentage}%</span>
    </div>
  )
}
