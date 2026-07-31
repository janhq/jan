/* eslint-disable react-refresh/only-export-components */
import { useControllableState } from '@radix-ui/react-use-controllable-state'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { ToolUIPart } from 'ai'
import { ChevronDownIcon, WrenchIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import {
  createContext,
  Fragment,
  isValidElement,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { CodeBlock } from './code-block'
import { CopyButton } from '@/containers/CopyButton'
import {
  isPlainObject,
  parseToolInput,
  stringifyToolInput,
  summarizeToolInput,
} from '@/lib/toolInputSummary'
import { summarizeToolOutput } from '@/lib/toolOutputSummary'
import { useToolApprovalRequests } from '@/hooks/useToolApprovalRequests'
import { useToolCallRuntime } from '@/hooks/useToolCallRuntime'
import { ToolElapsed } from './tool-runtime'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Button } from '@/components/ui/button'
import { ShieldAlertIcon } from 'lucide-react'
import { Citations } from '@/components/Citations'
import { parseCitationsFromToolOutput } from '@/lib/citation-parser'

/** Payloads shorter than this fit the collapsed box, so no expand control. */
const OUTPUT_EXPAND_THRESHOLD = 600

type ToolContextValue = {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  state: ToolUIPart['state']
  toolCallId?: string
  messageId?: string
}

const ToolContext = createContext<ToolContextValue | null>(null)

export const useTool = () => {
  const context = useContext(ToolContext)
  if (!context) {
    throw new Error('Tool components must be used within Tool')
  }
  return context
}

export type ToolProps = ComponentProps<typeof Collapsible> & {
  className?: string
  state: ToolUIPart['state']
  toolCallId?: string
  messageId?: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export const Tool = memo(
  ({
    className,
    state,
    toolCallId,
    messageId,
    open,
    defaultOpen = false,
    onOpenChange,
    children,
    ...props
  }: ToolProps) => {
    const isPending = useToolApprovalRequests((s) =>
      toolCallId ? Boolean(s.pending[toolCallId]) : false
    )
    const [isOpen, setIsOpen] = useControllableState({
      prop: open,
      defaultProp: defaultOpen || isPending,
      onChange: onOpenChange,
    })

    const wasPendingRef = useRef(isPending)
    useEffect(() => {
      if (isPending && !wasPendingRef.current) {
        setIsOpen(true)
      } else if (!isPending && wasPendingRef.current) {
        setIsOpen(false)
      }
      wasPendingRef.current = isPending
    }, [isPending, setIsOpen])

    const handleOpenChange = (newOpen: boolean) => {
      setIsOpen(newOpen)
    }

    return (
      <ToolContext.Provider
        value={{ isOpen, setIsOpen, state, toolCallId, messageId }}
      >
        <Collapsible
          className={cn('not-prose', className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ToolContext.Provider>
    )
  }
)

export type ToolHeaderProps = {
  title?: string
  state: ToolUIPart['state']
  type: ToolUIPart['type']
  className?: string
  /** Where the tool came from (web provider, documents, MCP server name). */
  origin?: string
  /** Arguments, previewed inline so a collapsed call still says what it did. */
  input?: ToolUIPart['input']
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string

const getStatusText = (
  t: TranslateFn,
  status: ToolUIPart['state'],
  toolName: string,
  awaitingApproval: boolean,
  isQueued: boolean
) => {
  const isRunning = status === 'input-streaming' || status === 'input-available'
  const hasError = status === 'output-error' || status === 'output-denied'
  const tool = toolName.replaceAll('_', ' ')

  if (awaitingApproval) {
    return t('tools:toolCall.awaitingApproval', { tool })
  }
  // Tools run one at a time, so a pending call is only "running" once the
  // executor has actually reached it.
  if (isQueued) {
    return t('tools:toolCall.queued', { tool })
  }
  if (isRunning) {
    return t('tools:toolCall.running', { tool })
  }
  if (hasError) {
    return t('tools:toolCall.failed', { tool })
  }
  return t('tools:toolCall.used', { tool })
}

export const ToolHeader = memo(
  ({ className, title, state, type, origin, input }: ToolHeaderProps) => {
    const { t } = useTranslation()
    const { isOpen, toolCallId } = useTool()
    const awaitingApproval = useToolApprovalRequests((s) =>
      toolCallId ? Boolean(s.pending[toolCallId]) : false
    )
    const toolName = title ?? type.split('-').slice(1).join('-')
    const summary = useMemo(() => summarizeToolInput(input), [input])
    // Position in the pending queue, or -1 once the executor has reached it.
    const queuePosition = useToolCallRuntime((s) =>
      toolCallId ? s.queue.indexOf(toolCallId) : -1
    )
    const startedAt = useToolCallRuntime((s) =>
      toolCallId ? s.timings[toolCallId]?.startedAt : undefined
    )
    const endedAt = useToolCallRuntime((s) =>
      toolCallId ? s.timings[toolCallId]?.endedAt : undefined
    )

    return (
      <CollapsibleTrigger
        className={cn(
          'cursor-pointer flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors',
          !isOpen && 'hover:bg-secondary',
          className
        )}
      >
        {awaitingApproval ? (
          <ShieldAlertIcon className="size-4 shrink-0 text-amber-500" />
        ) : (
          <WrenchIcon className="size-4 shrink-0" />
        )}
        <span
          className={cn(
            'shrink-0 capitalize',
            awaitingApproval && 'text-amber-600 dark:text-amber-400'
          )}
        >
          {getStatusText(
            t,
            state,
            toolName,
            awaitingApproval,
            queuePosition >= 0
          )}
        </span>
        {origin && (
          <span className="shrink-0 text-muted-foreground/60">{origin}</span>
        )}
        {summary && (
          <span className="min-w-0 truncate text-left font-mono text-xs text-muted-foreground/60">
            {summary}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {queuePosition > 0 && (
            <span className="text-xs text-muted-foreground/60">
              {t('tools:toolCall.queuedPosition', { count: queuePosition })}
            </span>
          )}
          <ToolElapsed
            startedAt={startedAt}
            endedAt={endedAt}
            className="text-muted-foreground/60"
          />
          <ChevronDownIcon
            className={cn(
              'size-4 shrink-0 transition-transform',
              isOpen ? 'rotate-180' : 'rotate-0'
            )}
          />
        </span>
      </CollapsibleTrigger>
    )
  }
)

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>

export const ToolContent = memo(
  ({ className, children, ...props }: ToolContentProps) => (
    <CollapsibleContent
      className={cn(
        'overflow-hidden text-sm relative data-[state=open]:mt-4',
        'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-muted-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
        className
      )}
      {...props}
    >
      <div className="ml-2 pl-4 border-l-2 border-dotted">
        {children}
      </div>
    </CollapsibleContent>
  )
)

export type ToolInputProps = ComponentProps<'div'> & {
  input: ToolUIPart['input']
}

/** Table cells keep nested values readable rather than collapsing them. */
const formatParamValue = (value: unknown): string =>
  typeof value === 'string' ? value : stringifyToolInput(value)

export const ToolInput = memo(
  ({ className, input, ...props }: ToolInputProps) => {
    const { t } = useTranslation()
    const [showRaw, setShowRaw] = useState(false)

    const parsed = useMemo(() => parseToolInput(input), [input])
    const formatted = useMemo(() => stringifyToolInput(parsed), [parsed])
    const rows = useMemo(
      () => (isPlainObject(parsed) ? Object.entries(parsed) : []),
      [parsed]
    )
    const asTable = rows.length > 0 && !showRaw

    return (
      <div className={cn('space-y-2', className)} {...props}>
        <div className="flex items-center gap-1">
          <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {t('tools:toolCall.parameters')}
          </h4>
          <div className="ml-auto flex items-center gap-1">
            {rows.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => setShowRaw((raw) => !raw)}
              >
                {showRaw
                  ? t('tools:toolCall.viewTable')
                  : t('tools:toolCall.viewRaw')}
              </Button>
            )}
            <CopyButton text={formatted} />
          </div>
        </div>
        {asTable ? (
          <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            {rows.map(([key, value]) => (
              <Fragment key={key}>
                <dt className="truncate font-mono text-xs text-muted-foreground/70">
                  {key}
                </dt>
                <dd className="min-w-0 max-h-24 overflow-auto whitespace-pre-wrap wrap-break-word font-mono text-xs">
                  {formatParamValue(value)}
                </dd>
              </Fragment>
            ))}
          </dl>
        ) : (
          <div className="rounded-md max-h-40 overflow-auto border">
            <CodeBlock code={formatted} language="json" />
          </div>
        )}
      </div>
    )
  }
)

export const ToolApprovalActions = memo(() => {
  const { t } = useTranslation()
  const { toolCallId } = useTool()
  const pending = useToolApprovalRequests((s) =>
    toolCallId ? s.pending[toolCallId] : undefined
  )
  const resolveApproval = useToolApprovalRequests((s) => s.resolveApproval)

  if (!pending || !toolCallId) return null

  return (
    <div className="mt-4 space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 text-xs font-medium">
        <ShieldAlertIcon className="size-4" />
        <span>{t('tools:toolApproval.needsApproval')}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="destructive"
          onClick={() => resolveApproval(toolCallId, 'deny')}
        >
          {t('tools:toolApproval.deny')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => resolveApproval(toolCallId, 'allow-once')}
        >
          {t('tools:toolApproval.allowOnce')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => resolveApproval(toolCallId, 'allow-thread')}
        >
          {t('tools:toolApproval.allowInThread')}
        </Button>
        <Button
          size="sm"
          autoFocus
          onClick={() => resolveApproval(toolCallId, 'allow-always')}
        >
          {/* Trusting a server tool-by-tool is the same decision repeated. */}
          {pending.serverName
            ? t('tools:toolApproval.allowServerAlways', {
                server: pending.serverName,
              })
            : t('tools:toolApproval.allowToolAlways', {
                tool: pending.toolName,
              })}
        </Button>
      </div>
    </div>
  )
})

type ToolImageProps = {
  data: string
  index: number
  resolver: (input: string) => Promise<string>
}

const ToolImage = memo(({ data, index }: ToolImageProps) => {
  // Prepare the URL - convert base64 to data URL if needed
  const [preparedUrl, setPreparedUrl] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (data.startsWith('data:image') || data.startsWith('http')) {
      // Already a data URL or HTTP URL
      setPreparedUrl(data)
    } else {
      // Assume it's base64 encoded
      setPreparedUrl(`data:image/png;base64,${data}`)
    }
  }, [data])

  const isLoading = !preparedUrl

  if (isLoading) {
    return (
      <div className="flex justify-center">
        <div className="flex size-24 items-center justify-center rounded-md bg-muted">
          <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </div>
    )
  }

  if (!preparedUrl) {
    return null
  }

  return (
    <div key={index} className="inline-block">
      <img
        src={preparedUrl}
        alt="Tool output"
        className="max-w-full max-h-96 w-auto h-auto object-contain rounded-md border"
      />
    </div>
  )
})

export type ToolOutputProps = ComponentProps<'div'> & {
  output: ToolUIPart['output']
  errorText: ToolUIPart['errorText']
  resolver: (input: string) => Promise<string>
  // Running count of citations from earlier tool calls in this turn, so each
  // card's numbering/anchors continue the global sequence the markers use.
  citationOffset?: number
}

export const ToolOutput = memo(
  ({
    className,
    output,
    errorText,
    resolver,
    citationOffset = 0,
    ...props
  }: ToolOutputProps) => {
    const { t } = useTranslation()
    const { messageId } = useTool()
    const [expanded, setExpanded] = useState(false)
    const [showRaw, setShowRaw] = useState(false)
    const citationPayload = useMemo(
      () => (output ? parseCitationsFromToolOutput(output) : null),
      [output]
    )

    // Generic results lead with a description of what came back; the payload
    // itself is one click away rather than dumped as JSON.
    const summary = useMemo(
      () => (citationPayload || errorText ? undefined : summarizeToolOutput(output)),
      [citationPayload, errorText, output]
    )

    const copyText = useMemo(
      () => (errorText ? errorText : stringifyToolInput(output)),
      [errorText, output]
    )
    // Only offer expansion for payloads long enough to be clipped. Citation
    // output (native web search, RAG) renders as cards outside the scroll box,
    // so there is no height for the control to act on.
    const isLong =
      !citationPayload && copyText.length > OUTPUT_EXPAND_THRESHOLD
    const boxClassName = cn(
      'rounded-md overflow-auto border',
      expanded ? 'max-h-[32rem]' : 'max-h-40'
    )

    const Output = useMemo(() => {
      if (!(output || errorText)) {
        return null
      }

      if (citationPayload) {
        return (
          <Citations
            payload={citationPayload}
            anchorPrefix={messageId ? `cite-${messageId}` : undefined}
            indexOffset={citationOffset}
          />
        )
      }

      // Handle string output
      if (typeof output === 'string') {
        return (
          <div className={boxClassName}>
            <CodeBlock code={output} language="json" />
          </div>
        )
      }

      if (typeof output === 'object' && !isValidElement(output)) {
        // Check if output has content array (new structure: {content: [{text, type}, {data, type: image}]})
        if (
          output &&
          typeof output === 'object' &&
          'content' in output &&
          Array.isArray(output.content)
        ) {
          const content = output.content as Array<{
            type: string
            text?: string
            data?: string
            mimeType?: string
          }>

          const textItems = content.filter((item) => item.type === 'text')
          const imageItems = content.filter((item) => item.type === 'image')

          return (
            <div className="space-y-4">
              {textItems.length > 0 && (
                <div className="space-y-2">
                  {textItems.map((item, index) => (
                    <div key={index} className={boxClassName}>
                      <CodeBlock code={item.text || ''} language="markdown" />
                    </div>
                  ))}
                </div>
              )}
              {imageItems.length > 0 && (
                <div className="space-y-2">
                  {imageItems.map((item, index) => (
                    <ToolImage
                      key={index}
                      data={item.data || ''}
                      index={index}
                      resolver={resolver}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        }

        // Handle old array format for backward compatibility
        if (Array.isArray(output)) {
          const hasImages = output.some(
            (item) => item?.type === 'image' && (item?.data || item?.image)
          )

          if (hasImages) {
            // Filter out images from JSON and render images separately
            const nonImageOutput = output.filter(
              (item) => item?.type !== 'image'
            )

            return (
              <div className="space-y-4">
                {nonImageOutput.length > 0 && (
                  <div className={boxClassName}>
                    <CodeBlock
                      code={JSON.stringify(nonImageOutput, null, 2)}
                      language="json"
                    />
                  </div>
                )}
                {output
                  .filter(
                    (item) =>
                      item?.type === 'image' && (item?.data || item?.image?.url)
                  )
                  .map((item, index) => (
                    <ToolImage
                      key={index}
                      data={item.data ?? item.image?.url}
                      index={index}
                      resolver={resolver}
                    />
                  ))}
              </div>
            )
          }

          return (
            <div className={boxClassName}>
              <CodeBlock
                code={JSON.stringify(output, null, 2)}
                language="json"
              />
            </div>
          )
        }

        // Handle regular object
        return (
          <div className={boxClassName}>
            <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
          </div>
        )
      }

      return <div>{output as ReactNode}</div>
    }, [
      output,
      errorText,
      resolver,
      citationPayload,
      messageId,
      citationOffset,
      boxClassName,
    ])

    if (!(output || errorText)) {
      return null
    }

    return (
      <div className={cn('space-y-2 mt-4', className)} {...props}>
        <div className="flex items-center gap-1">
          <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {errorText ? t('tools:toolCall.error') : t('tools:toolCall.result')}
          </h4>
          <div className="ml-auto flex items-center gap-1">
            {summary && (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => setShowRaw((raw) => !raw)}
              >
                {showRaw
                  ? t('tools:toolCall.hideRaw')
                  : t('tools:toolCall.viewRaw')}
              </Button>
            )}
            {isLong && (!summary || showRaw) && (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => setExpanded((open) => !open)}
              >
                {expanded
                  ? t('tools:toolCall.showLess')
                  : t('tools:toolCall.showMore')}
              </Button>
            )}
            <CopyButton text={copyText} />
          </div>
        </div>
        {summary && (
          <p className="text-sm text-muted-foreground">
            {t(summary.key, summary.values)}
          </p>
        )}
        <div className="rounded-md overflow-hidden">
          {errorText && (
            <div className="m-2 p-2 bg-destructive/10 text-destructive rounded-md">
              {errorText}
            </div>
          )}
          {(!summary || showRaw) && Output}
        </div>
      </div>
    )
  }
)

Tool.displayName = 'Tool'
ToolHeader.displayName = 'ToolHeader'
ToolContent.displayName = 'ToolContent'
ToolInput.displayName = 'ToolInput'
ToolOutput.displayName = 'ToolOutput'
ToolApprovalActions.displayName = 'ToolApprovalActions'
