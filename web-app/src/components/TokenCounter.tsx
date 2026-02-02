import { useMemo, useEffect, useState, useRef } from 'react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useTokensCount } from '@/hooks/useTokensCount'
import { ThreadMessage } from '@janhq/core'

interface TokenCounterProps {
  messages?: ThreadMessage[]
  className?: string
  compact?: boolean
  additionalTokens?: number // For vision tokens or other additions
  uploadedFiles?: Array<{
    name: string
    type: string
    size: number
    base64: string
    dataUrl: string
  }>
}

export const TokenCounter = ({
  messages = [],
  className,
  additionalTokens = 0,
  uploadedFiles = [],
}: TokenCounterProps) => {
  const { calculateTokens, ...tokenData } = useTokensCount(
    messages,
    uploadedFiles
  )

  const [isAnimating, setIsAnimating] = useState(false)
  const [prevTokenCount, setPrevTokenCount] = useState(0)
  const [isUpdating, setIsUpdating] = useState(false)
  const timersRef = useRef<{ update?: NodeJS.Timeout; anim?: NodeJS.Timeout }>(
    {}
  )

  // Manual calculation - trigger on click
  const handleCalculateTokens = () => {
    calculateTokens()
  }

  // Handle token count changes with proper debouncing and cleanup
  useEffect(() => {
    const currentTotal = tokenData.tokenCount + additionalTokens
    const timers = timersRef.current

    // Clear any existing timers
    if (timers.update) clearTimeout(timers.update)
    if (timers.anim) clearTimeout(timers.anim)

    if (currentTotal !== prevTokenCount) {
      setIsUpdating(true)

      // Clear updating state after a longer delay for smoother transitions
      timers.update = setTimeout(() => {
        setIsUpdating(false)
      }, 250)

      // Only animate for significant changes and avoid animating on initial load
      if (prevTokenCount > 0) {
        const difference = Math.abs(currentTotal - prevTokenCount)
        if (difference > 10) {
          // Increased threshold to reduce micro-animations
          setIsAnimating(true)
          timers.anim = setTimeout(() => {
            setIsAnimating(false)
          }, 600)
        }
      }

      setPrevTokenCount(currentTotal)
    }

    // Cleanup function
    return () => {
      if (timers.update) clearTimeout(timers.update)
      if (timers.anim) clearTimeout(timers.anim)
    }
  }, [tokenData.tokenCount, additionalTokens, prevTokenCount])

  const totalTokens = useMemo(() => {
    return tokenData.tokenCount + additionalTokens
  }, [tokenData.tokenCount, additionalTokens])

  // Percentage calculation to match useTokensCount exactly
  const adjustedPercentage = useMemo(() => {
    if (!tokenData.maxTokens) return undefined
    return (totalTokens / tokenData.maxTokens) * 100
  }, [totalTokens, tokenData.maxTokens])

  // Check if percentage exceeds max (100%)
  const isOverLimit = useMemo(() => {
    return adjustedPercentage !== undefined && adjustedPercentage > 100
  }, [adjustedPercentage])

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  return (
    <TooltipProvider delayDuration={isUpdating ? 1200 : 400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn('relative cursor-pointer', className)}
            onClick={handleCalculateTokens}
          >
            {/* Main compact display */}
            <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-background border border-border">
              <span
                className={cn(
                  'text-xs font-medium tabular-nums transition-all duration-500 ease-out',
                  isOverLimit ? 'text-destructive' : 'text-primary',
                  isAnimating && 'scale-110'
                )}
              >
                {adjustedPercentage?.toFixed(1) || '0.0'}%
              </span>

              <div className="relative size-4 shrink-0">
                <svg
                  className="size-4 transform -rotate-90"
                  viewBox="0 0 16 16"
                >
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                    className="text-muted-foreground"
                  />
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                    strokeDasharray={`${2 * Math.PI * 6}`}
                    strokeDashoffset={`${2 * Math.PI * 6 * (1 - (adjustedPercentage || 0) / 100)}`}
                    className={cn(
                      'transition-all duration-500 ease-out',
                      isOverLimit ? 'stroke-destructive' : 'stroke-primary'
                    )}
                    style={{
                      transformOrigin: 'center',
                    }}
                  />
                </svg>
              </div>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="center"
          sideOffset={5}
          showArrow={false}
          className="min-w-60 max-w-60 bg-background border"
        >
          {/* Detailed breakdown panel */}
          <>
            {/* Header with percentage and progress bar */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <span
                  className={cn(
                    'text-lg font-semibold tabular-nums',
                    isOverLimit ? 'text-destructive' : 'text-primary'
                  )}
                >
                  {adjustedPercentage?.toFixed(1) || '0.0'}%
                </span>
                <span className="text-sm text-muted-foreground font-mono">
                  {formatNumber(totalTokens)} /{' '}
                  {formatNumber(tokenData.maxTokens || 0)}
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 bg-secondary/20 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-2 rounded-full transition-all duration-500 ease-out',
                    isOverLimit ? 'bg-destructive' : 'bg-primary'
                  )}
                  style={{
                    width: `${Math.min(adjustedPercentage || 0, 100)}%`,
                  }}
                />
              </div>
            </div>

            {/* Token breakdown */}
            <div className="space-y-2 mb-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Text</span>
                <span className="text-foreground font-mono">
                  {formatNumber(Math.max(0, tokenData.tokenCount))}
                </span>
              </div>
            </div>

            {/* Remaining tokens */}
            <div className="border-t border-border pt-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Remaining</span>
                <span className="text-foreground font-semibold font-mono">
                  {formatNumber(
                    Math.max(0, (tokenData.maxTokens || 0) - totalTokens)
                  )}
                </span>
              </div>
            </div>
          </>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
