import {
  useMemo,
  useEffect,
  useState,
  useRef,
  memo,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'
import {
  TooltipProvider,
} from '@/components/ui/tooltip'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useTokensCount } from '@/hooks/useTokensCount'
import { ThreadMessage } from '@janhq/core'
import {
  IconBrain,
  IconArrowUp,
  IconArrowDown,
  IconSum,
  IconRulerMeasure,
  IconStack2,
  IconPhoto,
  IconMicrophone,
  IconMoon,
  IconAdjustmentsAlt,
} from '@tabler/icons-react'

interface TokenCounterProps {
  messages?: ThreadMessage[]
  className?: string
  compact?: boolean
  additionalTokens?: number
  modelSwitcher?: ReactNode
  reasoningSwitcher?: ReactNode
}

const WARN_PCT = 85
const OVER_PCT = 100
const COMPACT_MODEL_MAX_CHARS = 14

const formatNumber = (num: number) => {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toString()
}

const formatExact = (num: number) => num.toLocaleString()

function truncateLabel(label: string, maxChars: number) {
  if (label.length <= maxChars) return label
  return `${label.slice(0, maxChars - 1)}…`
}

export const TokenCounter = memo(function TokenCounter({
  messages = [],
  className,
  compact = false,
  additionalTokens = 0,
  modelSwitcher,
  reasoningSwitcher,
}: TokenCounterProps) {
  const { calculateTokens, ...tokenData } = useTokensCount(messages)

  const [isAnimating, setIsAnimating] = useState(false)
  const [prevTokenCount, setPrevTokenCount] = useState(0)
  const [isUpdating, setIsUpdating] = useState(false)
  const timersRef = useRef<{ update?: NodeJS.Timeout; anim?: NodeJS.Timeout }>(
    {}
  )

  const handleCalculateTokens = () => {
    calculateTokens()
  }

  useEffect(() => {
    const currentTotal = tokenData.tokenCount + additionalTokens
    const timers = timersRef.current
    if (timers.update) clearTimeout(timers.update)
    if (timers.anim) clearTimeout(timers.anim)

    if (currentTotal !== prevTokenCount) {
      setIsUpdating(true)
      timers.update = setTimeout(() => setIsUpdating(false), 250)
      if (prevTokenCount > 0 && Math.abs(currentTotal - prevTokenCount) > 10) {
        setIsAnimating(true)
        timers.anim = setTimeout(() => setIsAnimating(false), 600)
      }
      setPrevTokenCount(currentTotal)
    }

    return () => {
      if (timers.update) clearTimeout(timers.update)
      if (timers.anim) clearTimeout(timers.anim)
    }
  }, [tokenData.tokenCount, additionalTokens, prevTokenCount])

  const totalTokens = useMemo(
    () => tokenData.tokenCount + additionalTokens,
    [tokenData.tokenCount, additionalTokens]
  )

  const pct = useMemo(() => {
    if (!tokenData.maxTokens) return undefined
    return (totalTokens / tokenData.maxTokens) * 100
  }, [totalTokens, tokenData.maxTokens])

  const tier: 'ok' | 'warn' | 'over' = useMemo(() => {
    if (pct === undefined) return 'ok'
    if (pct >= OVER_PCT) return 'over'
    if (pct >= WARN_PCT) return 'warn'
    return 'ok'
  }, [pct])

  const textCls =
    tier === 'over'
      ? 'text-destructive'
      : tier === 'warn'
        ? 'text-amber-500'
        : 'text-foreground'
  const ringCls =
    tier === 'over'
      ? 'stroke-destructive'
      : tier === 'warn'
        ? 'stroke-amber-500'
        : 'stroke-primary'
  const barCls =
    tier === 'over'
      ? 'bg-destructive'
      : tier === 'warn'
        ? 'bg-amber-500'
        : 'bg-primary'

  const { inputTokens, outputTokens, modelProps, modelDisplayName } = tokenData
  const compactModelLabel = modelDisplayName
    ? truncateLabel(modelDisplayName, COMPACT_MODEL_MAX_CHARS)
    : undefined
  const remaining = tokenData.maxTokens
    ? Math.max(0, tokenData.maxTokens - totalTokens)
    : 0
  const showFittedBadge =
    tokenData.fitEnabled &&
    typeof tokenData.maxTokens === 'number' &&
    typeof tokenData.configuredCtxLen === 'number' &&
    tokenData.configuredCtxLen !== tokenData.maxTokens
  const hasModalities =
    tokenData.modalities?.vision || tokenData.modalities?.audio
  const showFooter =
    showFittedBadge ||
    hasModalities ||
    modelProps?.isSleeping ||
    (modelProps?.totalSlots !== undefined && modelProps.totalSlots > 1)

  return (
    <TooltipProvider delayDuration={isUpdating ? 1200 : 400}>
      <Popover>
        <PopoverTrigger asChild>
          <div
            className={cn('relative cursor-pointer min-w-0', className)}
            onClick={handleCalculateTokens}
          >
            <div
              className={cn(
                'flex min-w-0 items-center rounded-md bg-background border border-border shadow-sm transition-colors hover:bg-secondary/40',
                compact ? 'max-w-[8.5rem] gap-1 px-1.5 py-0.5' : 'gap-2 px-2 py-1'
              )}
            >
              {compact && compactModelLabel && (
                <span
                  className="min-w-0 max-w-[4.5rem] truncate text-xs font-medium text-foreground"
                  title={modelDisplayName}
                >
                  {compactModelLabel}
                </span>
              )}
              {tokenData.maxTokens ? (
                <>
                  <span
                    className={cn(
                      'shrink-0 text-xs font-medium tabular-nums transition-all duration-500 ease-out',
                      textCls,
                      isAnimating && 'scale-110'
                    )}
                  >
                    {compact
                      ? `${pct?.toFixed(0) ?? '0'}%`
                      : `${pct?.toFixed(1) ?? '0.0'}%`}
                  </span>
                  <div
                    className={cn(
                      'relative shrink-0',
                      compact ? 'size-3.5' : 'size-4'
                    )}
                  >
                    <svg
                      className={cn(
                        'transform -rotate-90',
                        compact ? 'size-3.5' : 'size-4'
                      )}
                      viewBox="0 0 16 16"
                    >
                      <circle
                        cx="8"
                        cy="8"
                        r="6"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        fill="none"
                        className="text-muted-foreground/40"
                      />
                      <circle
                        cx="8"
                        cy="8"
                        r="6"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        fill="none"
                        strokeDasharray={`${2 * Math.PI * 6}`}
                        strokeDashoffset={`${2 * Math.PI * 6 * (1 - Math.min(pct ?? 0, 100) / 100)}`}
                        className={cn(
                          'transition-all duration-500 ease-out',
                          ringCls
                        )}
                        style={{ transformOrigin: 'center' }}
                      />
                    </svg>
                  </div>
                </>
              ) : (
                !compact && (
                  <span className="text-xs font-medium text-muted-foreground">
                    —
                  </span>
                )
              )}
            </div>
          </div>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="center"
          sideOffset={6}
          className="min-w-72 max-w-80 bg-background border p-0 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
            <IconBrain className="size-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-foreground">
                Context window
              </div>
              {modelDisplayName && (
                <div className="text-[11px] text-muted-foreground truncate">
                  {modelDisplayName}
                </div>
              )}
            </div>
            {modelProps?.isSleeping && (
              <IconMoon
                className="size-3.5 text-muted-foreground"
                aria-label="Model sleeping"
              />
            )}
          </div>

          {modelSwitcher && (
            <div className="px-3 py-2 border-b border-border">
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
                Model
              </div>
              {modelSwitcher}
            </div>
          )}

          {reasoningSwitcher && (
            <div className="px-3 py-2 border-b border-border">
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
                Reasoning
              </div>
              {reasoningSwitcher}
            </div>
          )}

          {/* Progress block */}
          {tokenData.maxTokens ? (
            <div className="px-3 py-2.5">
              <div className="flex items-baseline justify-between mb-1.5">
                <span
                  className={cn(
                    'text-xl font-semibold tabular-nums leading-none',
                    textCls
                  )}
                >
                  {pct?.toFixed(1) ?? '0.0'}%
                </span>
                <span className="text-xs text-muted-foreground tabular-nums font-mono">
                  {formatNumber(totalTokens)} /{' '}
                  {formatNumber(tokenData.maxTokens)}
                </span>
              </div>
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500 ease-out',
                    barCls
                  )}
                  style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="px-3 py-2.5 text-xs text-muted-foreground">
              Context usage appears after the model reports a context window.
            </div>
          )}

          {/* Token breakdown */}
          {tokenData.maxTokens && (
            <div className="px-3 py-2 border-t border-border space-y-1.5">
            {typeof inputTokens === 'number' && inputTokens > 0 && (
              <Row
                icon={<IconArrowUp className="size-3.5" />}
                label="Prompt"
                value={formatExact(inputTokens)}
              />
            )}
            {typeof outputTokens === 'number' && outputTokens > 0 && (
              <Row
                icon={<IconArrowDown className="size-3.5" />}
                label="Completion"
                value={formatExact(outputTokens)}
              />
            )}
            <Row
              icon={<IconSum className="size-3.5" />}
              label="Used"
              value={formatExact(totalTokens)}
              strong
            />
            <Row
              icon={<IconRulerMeasure className="size-3.5" />}
              label="Remaining"
              value={formatExact(remaining)}
            />
            </div>
          )}

          {/* Footer: fit + slots + modalities */}
          {showFooter && (
            <div className="px-3 py-2 border-t border-border flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {showFittedBadge && (
                <span
                  className="flex items-center gap-1"
                  title={`Configured ctx_len: ${formatExact(tokenData.configuredCtxLen!)}`}
                >
                  <IconAdjustmentsAlt className="size-3" />
                  Fitted to {formatNumber(tokenData.maxTokens ?? 0)}
                </span>
              )}
              {modelProps?.totalSlots !== undefined &&
                modelProps.totalSlots > 1 && (
                  <span className="flex items-center gap-1">
                    <IconStack2 className="size-3" />
                    {modelProps.totalSlots} slots
                  </span>
                )}
              {tokenData.modalities?.vision && (
                <span
                  className="flex items-center gap-1"
                  title="Vision input supported"
                >
                  <IconPhoto className="size-3" />
                  Vision
                </span>
              )}
              {tokenData.modalities?.audio && (
                <span
                  className="flex items-center gap-1"
                  title="Audio input supported"
                >
                  <IconMicrophone className="size-3" />
                  Audio
                </span>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  )
})

function Row({
  icon,
  label,
  value,
  strong,
}: {
  icon: React.ReactNode
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          'font-mono tabular-nums',
          strong ? 'text-foreground font-semibold' : 'text-foreground'
        )}
      >
        {value}
      </span>
    </div>
  )
}
