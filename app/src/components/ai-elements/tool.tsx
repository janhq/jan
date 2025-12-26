/* eslint-disable react-hooks/set-state-in-effect */

import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { useResolvedMediaUrl } from '@/hooks/use-resolved-media-url'
import type { ToolUIPart } from 'ai'
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { isValidElement, useEffect, useState } from 'react'
import { CodeBlock } from './code-block'
import { TOOL_STATE } from '@/constants'

export type ToolProps = ComponentProps<typeof Collapsible>

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn('not-prose mb-4 w-full rounded-md border', className)}
    {...props}
  />
)

export type ToolHeaderProps = {
  title?: string
  type: ToolUIPart['type']
  state: ToolUIPart['state']
  className?: string
}

const getStatusBadge = (status: ToolUIPart['state']) => {
  const labels: Record<ToolUIPart['state'], string> = {
    [TOOL_STATE.INPUT_STREAMING]: 'Pending',
    [TOOL_STATE.INPUT_AVAILABLE]: 'Running',
    // @ts-expect-error state only available in AI SDK v6
    [TOOL_STATE.APPROVAL_REQUESTED]: 'Awaiting Approval',
    [TOOL_STATE.APPROVAL_RESPONDED]: 'Responded',
    [TOOL_STATE.OUTPUT_AVAILABLE]: 'Completed',
    [TOOL_STATE.OUTPUT_ERROR]: 'Error',
    [TOOL_STATE.OUTPUT_DENIED]: 'Denied',
  }

  const icons: Record<ToolUIPart['state'], ReactNode> = {
    [TOOL_STATE.INPUT_STREAMING]: <CircleIcon className="size-4" />,
    [TOOL_STATE.INPUT_AVAILABLE]: <ClockIcon className="size-4 animate-pulse" />,
    // @ts-expect-error state only available in AI SDK v6
    [TOOL_STATE.APPROVAL_REQUESTED]: <ClockIcon className="size-4 text-yellow-600" />,
    [TOOL_STATE.APPROVAL_RESPONDED]: <CheckCircleIcon className="size-4 text-blue-600" />,
    [TOOL_STATE.OUTPUT_AVAILABLE]: <CheckCircleIcon className="size-4 text-green-600" />,
    [TOOL_STATE.OUTPUT_ERROR]: <XCircleIcon className="size-4 text-red-600" />,
    [TOOL_STATE.OUTPUT_DENIED]: <XCircleIcon className="size-4 text-orange-600" />,
  }

  return (
    <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
      {icons[status]}
      {labels[status]}
    </Badge>
  )
}

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  ...props
}: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      'flex w-full items-center justify-between gap-4 p-3',
      className
    )}
    {...props}
  >
    <div className="flex items-center gap-2">
      <WrenchIcon className="size-4 text-muted-foreground" />
      <span className="font-medium text-sm">
        {title ?? type.split('-').slice(1).join('-')}
      </span>
      {getStatusBadge(state)}
    </div>
    <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
)

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
      className
    )}
    {...props}
  />
)

export type ToolInputProps = ComponentProps<'div'> & {
  input: ToolUIPart['input']
}

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn('space-y-2 overflow-hidden p-4', className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      Parameters
    </h4>
    <div className="rounded-md bg-muted/50">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
)

type ToolImageProps = {
  data: string
  index: number
}

const ToolImage = ({ data, index }: ToolImageProps) => {
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

  // Resolve Jan media URL to displayable URL using shared hook
  const { displayUrl, isLoading } = useResolvedMediaUrl(preparedUrl)

  if (isLoading) {
    return (
      <div className="flex justify-center">
        <div className="flex size-24 items-center justify-center rounded-md bg-muted">
          <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </div>
    )
  }

  if (!displayUrl) {
    return null
  }

  return (
    <div key={index} className="flex justify-center">
      <img
        src={displayUrl}
        alt="Tool output"
        className="max-w-full rounded-md"
      />
    </div>
  )
}

export type ToolOutputProps = ComponentProps<'div'> & {
  output: ToolUIPart['output']
  errorText: ToolUIPart['errorText']
}

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null
  }

  let Output = <div>{output as ReactNode}</div>

  if (typeof output === 'object' && !isValidElement(output)) {
    // Check if output is an array with mixed content
    if (Array.isArray(output)) {
      const hasImages = output.some(
        (item) => item?.type === 'image' && (item?.data || item?.image)
      )

      if (hasImages) {
        // Filter out images from JSON and render images separately
        const nonImageOutput = output.filter((item) => item?.type !== 'image')

        Output = (
          <div className="space-y-4">
            {nonImageOutput.length > 0 && (
              <CodeBlock
                code={JSON.stringify(nonImageOutput, null, 2)}
                language="json"
              />
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
                />
              ))}
          </div>
        )
      } else {
        Output = (
          <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
        )
      }
    } else {
      Output = (
        <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
      )
    }
  } else if (typeof output === 'string') {
    Output = <CodeBlock code={output} language="json" />
  }

  return (
    <div className={cn('space-y-2 p-4', className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? 'Error' : 'Result'}
      </h4>
      <div
        className={cn(
          'overflow-x-auto rounded-md text-xs [&_table]:w-full',
          errorText
            ? 'bg-destructive/10 text-destructive'
            : 'bg-muted/50 text-foreground'
        )}
      >
        {errorText && <div className="m-2">{errorText}</div>}
        {Output}
      </div>
    </div>
  )
}
