/* eslint-disable react-refresh/only-export-components */
import { useControllableState } from '@radix-ui/react-use-controllable-state'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import {
  SparklesIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  CircleIcon,
  SearchIcon,
  ExternalLinkIcon,
} from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Streamdown } from 'streamdown'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { formatCompactDuration } from '@/lib/duration'
import { Shimmer } from './shimmer'

// ── Types ──────────────────────────────────────────────────────────────────

export type ChainOfThoughtStepStatus = 'complete' | 'active' | 'pending'

// ── Context ────────────────────────────────────────────────────────────────

type ChainOfThoughtContextValue = {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  isStreaming: boolean
  duration: number | undefined
}

const MS_IN_S = 1000

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue | null>(
  null
)

export const useChainOfThought = () => {
  const context = useContext(ChainOfThoughtContext)
  if (!context) {
    throw new Error(
      'ChainOfThought components must be used within ChainOfThought'
    )
  }
  return context
}

// ── ChainOfThought (root) ──────────────────────────────────────────────────

export type ChainOfThoughtProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean
  /** When true the collapsible auto-collapses (e.g. text content appeared after this CoT group). */
  shouldCollapse?: boolean
  /** When true the collapsible is forced open and overrides auto-collapse (e.g. a tool is awaiting approval). */
  forceOpen?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export const ChainOfThought = memo(
  ({
    className,
    isStreaming = false,
    shouldCollapse,
    forceOpen = false,
    open,
    defaultOpen = true,
    onOpenChange,
    children,
    ...props
  }: ChainOfThoughtProps) => {
    const [isOpen, setIsOpen] = useControllableState({
      prop: open,
      defaultProp: defaultOpen,
      onChange: onOpenChange,
    })

    // Follow the caller's open intent. forceOpen pins it open (e.g. a tool
    // awaiting approval). When shouldCollapse is a boolean, track it two-way so
    // the trace opens as a step gains content and collapses when it has none or
    // the answer begins; when undefined the caller isn't controlling collapse,
    // so defaultOpen / manual toggle is left untouched. Re-applied only on
    // input change, preserving a manual toggle between changes.
    useEffect(() => {
      if (forceOpen) setIsOpen(true)
      else if (shouldCollapse === true) setIsOpen(false)
      else if (shouldCollapse === false) setIsOpen(true)
    }, [forceOpen, shouldCollapse, setIsOpen])

    const handleOpenChange = (newOpen: boolean) => {
      setIsOpen(newOpen)
    }

    const [startTime, setStartTime] = useState<number | null>(null)
    const [elapsedMs, setElapsedMs] = useState<number | undefined>(undefined)

    useEffect(() => {
      if (isStreaming) {
        if (startTime === null) {
          setStartTime(Date.now())
        }
      } else if (startTime !== null) {
        // Accumulated, not replaced: an agentic turn reasons, answers, then
        // reasons again, and each window is part of the same trace.
        const window = Date.now() - startTime
        setElapsedMs((previous) => (previous ?? 0) + window)
        setStartTime(null)
      }
    }, [isStreaming, startTime])

    // Rounded up to at least a second: a trace that begins and ends inside one
    // tick still ran, and a zero would read as "still going" below.
    const duration =
      elapsedMs === undefined
        ? undefined
        : Math.max(1, Math.ceil(elapsedMs / MS_IN_S))

    const contextValue = useMemo(
      () => ({ isStreaming, isOpen, setIsOpen, duration }),
      [isStreaming, isOpen, setIsOpen, duration]
    )

    return (
      <ChainOfThoughtContext.Provider value={contextValue}>
        <Collapsible
          className={cn(
            'not-prose rounded-2xl transition-colors',
            // Card frame only while expanded; collapsed shows a bare summary row.
            'data-[state=open]:border data-[state=open]:border-border/50 data-[state=open]:bg-main-view-fg/2 data-[state=open]:p-3',
            className
          )}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ChainOfThoughtContext.Provider>
    )
  }
)

// ── ChainOfThoughtHeader ───────────────────────────────────────────────────

export type ChainOfThoughtHeaderProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  title?: string
  /** Label shown while streaming, e.g. "Working...". Defaults to "Reasoning...". */
  streamingLabel?: string
  /** Which past-tense phrasing to use once the trace is complete. */
  completedVariant?: 'thought' | 'worked'
  /**
   * Turns the header into a view switch instead of a collapse toggle: the
   * chevron points the way it navigates, e.g. `right` to drill into the full
   * timeline and `left` to come back.
   */
  navDirection?: 'left' | 'right'
  onNavigate?: () => void
}

const COMPLETED_KEYS = {
  thought: {
    aWhile: 'chat:reasoning.thoughtForAWhile',
    withDuration: 'chat:reasoning.thoughtFor',
  },
  worked: {
    aWhile: 'chat:reasoning.workedForAWhile',
    withDuration: 'chat:reasoning.workedFor',
  },
} as const

export const ChainOfThoughtHeader = memo(
  ({
    className,
    title,
    streamingLabel,
    completedVariant = 'thought',
    navDirection,
    onNavigate,
    children,
    ...props
  }: ChainOfThoughtHeaderProps) => {
    const { t } = useTranslation()
    const { isStreaming, isOpen, duration } = useChainOfThought()

    const keys = COMPLETED_KEYS[completedVariant]
    const completedLabel =
      duration === undefined
        ? t(keys.aWhile)
        : t(keys.withDuration, { duration: formatCompactDuration(duration, t) })

    const rowClassName = cn(
      'flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground',
      className
    )

    if (children) {
      return (
        <CollapsibleTrigger className={rowClassName} {...props}>
          {children}
        </CollapsibleTrigger>
      )
    }

    const label = (
      <>
        <SparklesIcon className="size-4" />
        {isStreaming ? (
          <Shimmer duration={1}>
            {streamingLabel ?? t('chat:reasoning.label')}
          </Shimmer>
        ) : title ? (
          <p>{title}</p>
        ) : (
          <p>{completedLabel}</p>
        )}
      </>
    )

    if (navDirection) {
      const navLabel =
        navDirection === 'right'
          ? t('chat:reasoning.showFullTimeline')
          : t('chat:reasoning.showCurrentStep')
      return (
        <button
          type="button"
          className={rowClassName}
          onClick={onNavigate}
          aria-label={navLabel}
          title={navLabel}
          {...props}
        >
          {navDirection === 'left' && <ChevronLeftIcon className="size-4" />}
          {label}
          {navDirection === 'right' && <ChevronRightIcon className="size-4" />}
        </button>
      )
    }

    return (
      <CollapsibleTrigger className={rowClassName} {...props}>
        {label}
        <ChevronDownIcon
          className={cn(
            'size-4 transition-transform',
            isOpen ? 'rotate-180' : 'rotate-0'
          )}
        />
      </CollapsibleTrigger>
    )
  }
)

// ── ChainOfThoughtContent ──────────────────────────────────────────────────

export type ChainOfThoughtContentProps = ComponentProps<
  typeof CollapsibleContent
>

export const ChainOfThoughtContent = memo(
  ({ className, children, ...props }: ChainOfThoughtContentProps) => (
    <CollapsibleContent
      className={cn(
        'mt-4 text-sm relative',
        'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-muted-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
        className
      )}
      {...props}
    >
      <div className="space-y-3">{children}</div>
    </CollapsibleContent>
  )
)

// ── ChainOfThoughtText ─────────────────────────────────────────────────────

export type ChainOfThoughtTextProps = ComponentProps<
  typeof CollapsibleContent
> & {
  children: string
}

export const ChainOfThoughtText = memo(
  ({ className, children, ...props }: ChainOfThoughtTextProps) => (
    <CollapsibleContent
      className={cn(
        'mt-4 text-sm relative',
        'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-muted-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
        className
      )}
      {...props}
    >
      <div className="ml-2 pl-4 border-l-2 border-dotted">
        <Streamdown animate={true} animationDuration={500}>
          {children}
        </Streamdown>
      </div>
    </CollapsibleContent>
  )
)

// ── ChainOfThoughtStep ─────────────────────────────────────────────────────

export type ChainOfThoughtStepProps = ComponentProps<'div'> & {
  icon?: ReactNode
  label: string
  status: ChainOfThoughtStepStatus
}

const statusIcons: Record<ChainOfThoughtStepStatus, ReactNode> = {
  complete: <CheckCircle2Icon className="size-4 text-green-500 shrink-0" />,
  active: (
    <CircleDotIcon className="size-4 text-blue-500 animate-pulse shrink-0" />
  ),
  pending: <CircleIcon className="size-4 text-muted-foreground/50 shrink-0" />,
}

export const ChainOfThoughtStep = memo(
  ({ className, icon, label, status, children, ...props }: ChainOfThoughtStepProps) => (
    <div
      className={cn(
        'flex flex-col gap-2',
        className
      )}
      {...props}
    >
      <div className="flex items-start gap-2">
        {icon ?? statusIcons[status]}
        <span
          className={cn(
            'text-sm leading-snug',
            status === 'active' && 'text-foreground',
            status === 'pending' && 'text-muted-foreground/50'
          )}
        >
          {label}
        </span>
      </div>
      {children && <div className="ml-6">{children}</div>}
    </div>
  )
)

// ── ChainOfThoughtSearchResults ────────────────────────────────────────────

export type ChainOfThoughtSearchResultsProps = ComponentProps<'div'> & {
  title?: string
}

export const ChainOfThoughtSearchResults = memo(
  ({
    className,
    title,
    children,
    ...props
  }: ChainOfThoughtSearchResultsProps) => (
    <div className={cn('space-y-1.5', className)} {...props}>
      {title && (
        <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {title}
        </h4>
      )}
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
)

// ── ChainOfThoughtSearchResult ─────────────────────────────────────────────

export type ChainOfThoughtSearchResultProps = ComponentProps<'a'>

export const ChainOfThoughtSearchResult = memo(
  ({ className, children, href, ...props }: ChainOfThoughtSearchResultProps) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
        className
      )}
      {...props}
    >
      <SearchIcon className="size-3 shrink-0" />
      <span className="truncate max-w-[200px]">{children}</span>
      <ExternalLinkIcon className="size-3 shrink-0 opacity-50" />
    </a>
  )
)

// ── ChainOfThoughtImage ────────────────────────────────────────────────────

export type ChainOfThoughtImageProps = ComponentProps<'figure'> & {
  caption?: string
  children: ReactNode
}

export const ChainOfThoughtImage = memo(
  ({ className, caption, children, ...props }: ChainOfThoughtImageProps) => (
    <figure className={cn('space-y-1.5', className)} {...props}>
      {children}
      {caption && (
        <figcaption className="text-xs text-muted-foreground text-center">
          {caption}
        </figcaption>
      )}
    </figure>
  )
)

// ── Display names ──────────────────────────────────────────────────────────

ChainOfThought.displayName = 'ChainOfThought'
ChainOfThoughtHeader.displayName = 'ChainOfThoughtHeader'
ChainOfThoughtContent.displayName = 'ChainOfThoughtContent'
ChainOfThoughtText.displayName = 'ChainOfThoughtText'
ChainOfThoughtStep.displayName = 'ChainOfThoughtStep'
ChainOfThoughtSearchResults.displayName = 'ChainOfThoughtSearchResults'
ChainOfThoughtSearchResult.displayName = 'ChainOfThoughtSearchResult'
ChainOfThoughtImage.displayName = 'ChainOfThoughtImage'
