/* eslint-disable react-refresh/only-export-components */
import { useControllableState } from '@radix-ui/react-use-controllable-state'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { ToolUIPart } from 'ai'
import { ChevronRightIcon, WrenchIcon, SearchIcon, GlobeIcon } from 'lucide-react'
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
import {
  queuePositionOf,
  useToolCallRuntime,
} from '@/hooks/useToolCallRuntime'
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
      toolCallId ? queuePositionOf(s, toolCallId) : -1
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
          // Hover brightens the label like the trace header above it and
          // fades the chevron in, rather than painting a full-width square
          // block behind the row.
          'group/tool-header cursor-pointer flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground',
          className
        )}
      >
        {awaitingApproval ? (
          <ShieldAlertIcon className="size-4 shrink-0 text-amber-500" />
        ) : toolName === 'web_search' ? (
          <SearchIcon className="size-4 shrink-0" />
        ) : toolName === 'web_fetch' ? (
          <GlobeIcon className="size-4 shrink-0" />
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
        {/* Right when folded, turning down as it opens, inline after the
            label: the same cue as the trace header and every other
            expandable row. Shown while open (it is the collapse cue), on
            hover, on keyboard focus, and always where nothing can hover. */}
        <ChevronRightIcon
          className={cn(
            '-ml-1 size-4 shrink-0 transition-[opacity,transform]',
            isOpen
              ? 'rotate-90 opacity-100'
              : 'rotate-0 opacity-0 group-hover/tool-header:opacity-100 group-focus-visible/tool-header:opacity-100 [@media(hover:none)]:opacity-100'
          )}
        />
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
        {/* A strict request saves no grant (see ApprovalOptions.strict), so
            offering a wider scope would be a promise it does not keep. */}
        {!pending.strict && (
          <>
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
          </>
        )}
      </div>
    </div>
  )
})

type ContentBlock = {
  type?: string
  text?: string
  data?: string
  mimeType?: string
  image?: { url?: string }
}

type ToolImageSource = { data: string; mimeType?: string }

const REMOTE_URL = /^https?:/i

/**
 * The image blocks of an MCP result, stored bare or as `{ content }`. Only
 * inline data is drawn: a block that points at a URL is not fetched just
 * because a tool returned it.
 */
function toolImages(output: unknown): ToolImageSource[] {
  const items: ContentBlock[] = Array.isArray(output)
    ? output
    : isPlainObject(output) && Array.isArray(output.content)
      ? output.content
      : []
  return items.flatMap((item) => {
    if (item?.type !== 'image') return []
    const data = item.data || item.image?.url
    return data && !REMOTE_URL.test(data)
      ? [{ data, mimeType: item.mimeType }]
      : []
  })
}

/** The raw view of image blocks: what came back, without the inline data. */
function redactImages(items: ContentBlock[]): ContentBlock[] {
  const elide = (value: string) => `<${value.length} characters elided>`
  const inline = (value?: string): value is string =>
    !!value && !REMOTE_URL.test(value)
  return items.map((item) => {
    if (item?.type !== 'image') return item
    return {
      ...item,
      ...(inline(item.data) ? { data: elide(item.data) } : {}),
      ...(inline(item.image?.url)
        ? { image: { ...item.image, url: elide(item.image.url) } }
        : {}),
    }
  })
}

/**
 * `src` for an inline image: a data URL as given, otherwise bare base64 with
 * the media type the server declared (png when it declared none, or something
 * that is not an image type).
 */
function toolImageSrc(data: string, mimeType?: string): string {
  const value = data.replace(/\s+/g, '')
  if (/^data:image\//i.test(value)) return value
  const mime = mimeType?.toLowerCase().startsWith('image/')
    ? mimeType.toLowerCase()
    : 'image/png'
  return `data:${mime};base64,${value}`
}

const ToolImage = memo(({ data, mimeType }: ToolImageSource) => (
  <div className="inline-block">
    <img
      src={toolImageSrc(data, mimeType)}
      alt="Tool output"
      className="max-w-full max-h-96 w-auto h-auto object-contain rounded-md border"
    />
  </div>
))

export type ToolOutputProps = ComponentProps<'div'> & {
  output: ToolUIPart['output']
  errorText: ToolUIPart['errorText']
  // Running count of citations from earlier tool calls in this turn, so each
  // card's numbering/anchors continue the global sequence the markers use.
  citationOffset?: number
}

export const ToolOutput = memo(
  ({
    className,
    output,
    errorText,
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

    // MCP image blocks are the result itself, not an attachment to it: they show
    // in the card without opening the raw payload (#9547).
    const images = useMemo(() => toolImages(output), [output])

    const copyText = useMemo(
      () => (errorText ? errorText : stringifyToolInput(output)),
      [errorText, output]
    )
    // Only offer expansion for payloads long enough to be clipped. Citation
    // output (native web search, RAG) renders as cards outside the scroll box,
    // so there is no height for the control to act on.
    // The raw view elides image data, so image bytes are not what makes a
    // payload long enough to need the expand control.
    const imageChars = images.reduce((n, image) => n + image.data.length, 0)
    const isLong =
      !citationPayload &&
      copyText.length - imageChars > OUTPUT_EXPAND_THRESHOLD
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
        // MCP content envelope: { content: [{ text, type }, { data, type: image }] }.
        // The images are drawn by the card itself (see `images`), so the raw
        // view carries the text blocks, or the blocks with the base64 elided.
        if (
          output &&
          typeof output === 'object' &&
          'content' in output &&
          Array.isArray(output.content)
        ) {
          const content = output.content as ContentBlock[]
          const textItems = content.filter((item) => item.type === 'text')

          if (textItems.length > 0) {
            return (
              <div className="space-y-2">
                {textItems.map((item, index) => (
                  <div key={index} className={boxClassName}>
                    <CodeBlock code={item.text || ''} language="markdown" />
                  </div>
                ))}
              </div>
            )
          }
          return (
            <div className={boxClassName}>
              <CodeBlock
                code={JSON.stringify(redactImages(content), null, 2)}
                language="json"
              />
            </div>
          )
        }

        // Bare content array, which is how a stored MCP result looks.
        if (Array.isArray(output)) {
          return (
            <div className={boxClassName}>
              <CodeBlock
                code={JSON.stringify(redactImages(output), null, 2)}
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
          {images.length > 0 && (
            <div className="space-y-2">
              {images.map((image, index) => (
                <ToolImage
                  key={index}
                  data={image.data}
                  mimeType={image.mimeType}
                />
              ))}
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
