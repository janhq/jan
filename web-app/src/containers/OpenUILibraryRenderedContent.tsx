import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { usePrompt } from '@/hooks/usePrompt'
import {
  dispatchOpenUIChatAction,
  wrapOpenUIActionMessage,
} from '@/lib/openui-actions'
import { getSafeOpenUIUrl } from '@/lib/openui-url'
import { cn } from '@/lib/utils'
import {
  BuiltinActionType,
  Renderer,
  createParser,
  type ActionEvent,
  type Library,
} from '@openuidev/react-lang'
import { useCallback, useMemo } from 'react'

export interface OpenUIRenderedContentProps {
  content: string
  openUIResponse: string
  className?: string
  isUser?: boolean
  isStreaming?: boolean
  messageId?: string
  isAnimating?: boolean
}

interface OpenUILibraryRenderedContentProps extends OpenUIRenderedContentProps {
  library: Library
}

function getActionPrompt(event: ActionEvent) {
  const actionEvent = event as unknown as Record<string, unknown>
  const params =
    actionEvent.params &&
    typeof actionEvent.params === 'object' &&
    !Array.isArray(actionEvent.params)
      ? (actionEvent.params as Record<string, unknown>)
      : {}

  const candidates = [
    actionEvent.humanFriendlyMessage,
    actionEvent.userMessage,
    actionEvent.message,
    actionEvent.label,
    params.context,
  ]

  return candidates.find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.trim().length > 0
  )
}

function getActionParams(event: ActionEvent) {
  const actionEvent = event as unknown as Record<string, unknown>

  return actionEvent.params &&
    typeof actionEvent.params === 'object' &&
    !Array.isArray(actionEvent.params)
    ? (actionEvent.params as Record<string, unknown>)
    : {}
}

function getActionUrl(event: ActionEvent) {
  const params = getActionParams(event)
  return getSafeOpenUIUrl(params.url)
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

function normalizeFormState(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeFormState)

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>

    if ('value' in record && 'componentType' in record) {
      return normalizeFormState(record.value)
    }

    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [
        key,
        normalizeFormState(entry),
      ])
    )
  }

  return value
}

function getActionMessage(event: ActionEvent, prompt: string) {
  const actionEvent = event as unknown as Record<string, unknown>
  const params = getActionParams(event)
  const context: Array<unknown> = []

  if (hasMeaningfulValue(params.context)) {
    context.push(params.context)
  }

  if (hasMeaningfulValue(actionEvent.formState)) {
    context.push({
      event: `User clicked: ${prompt}`,
      formName: actionEvent.formName,
      formState: normalizeFormState(actionEvent.formState),
    })
  }

  return wrapOpenUIActionMessage(prompt, context)
}

export function OpenUILibraryRenderedContent({
  library,
  content,
  openUIResponse,
  className,
  isUser,
  isStreaming,
  messageId,
  isAnimating,
}: OpenUILibraryRenderedContentProps) {
  const setPrompt = usePrompt((state) => state.setPrompt)

  const parser = useMemo(
    () => createParser(library.toJSONSchema()),
    [library]
  )
  const parseResult = useMemo(() => {
    try {
      return parser.parse(openUIResponse)
    } catch {
      return null
    }
  }, [openUIResponse, parser])

  const handleAction = useCallback(
    (event: ActionEvent) => {
      if (event.type === BuiltinActionType.OpenUrl) {
        const url = getActionUrl(event)
        if (url && typeof window !== 'undefined') {
          window.open(url, '_blank', 'noopener,noreferrer')
        }
        return
      }

      const nextPrompt = getActionPrompt(event)
      if (!nextPrompt) return

      const nextMessage = getActionMessage(event, nextPrompt)
      const wasSubmitted = dispatchOpenUIChatAction(nextMessage)
      if (!wasSubmitted) setPrompt(nextMessage)
    },
    [setPrompt]
  )

  const canRenderOpenUI =
    !!parseResult &&
    (!!parseResult.root || (isStreaming && parseResult.meta.incomplete))

  if (!canRenderOpenUI) {
    return (
      <RenderMarkdown
        content={content}
        className={className}
        isUser={isUser}
        isStreaming={isStreaming}
        messageId={messageId}
        isAnimating={isAnimating}
      />
    )
  }

  return (
    <div
      dir="auto"
      className={cn(
        'openui-response w-full max-w-full overflow-x-auto rounded-md border border-border/50 bg-background/40 p-2',
        className
      )}
    >
      <Renderer
        response={openUIResponse}
        library={library}
        isStreaming={isStreaming}
        onAction={handleAction}
      />
    </div>
  )
}
