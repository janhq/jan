import { memo } from 'react'
import {
  Tool,
  ToolApprovalActions,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool'
import { ToolProgressRow } from '@/components/ai-elements/tool-runtime'
import { useToolOrigin } from '@/hooks/useToolOrigin'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { completedToolLabel } from '@/lib/agentActivity'
import { describeNativeToolCall, isToolRunning } from '@/lib/toolPresentation'
import { isToolPart, type MessagePartLike } from './types'
import { RagToolWidget } from './RagToolWidget'
import { WebToolWidget } from './WebToolWidget'
import { AgentToolWidget, TerminalWidget } from './AgentToolWidget'
import { SubagentToolWidget } from './SubagentToolWidget'

const identityResolver = (input: string) => Promise.resolve(input)

export type ToolCallCardProps = {
  part: MessagePartLike
  messageId: string
  /** Citation count from earlier tool calls in this turn, for continuous numbering. */
  citationOffset?: number
  className?: string
}

export const ToolCallCard = memo(
  ({ part, messageId, citationOffset = 0, className }: ToolCallCardProps) => {
    const { t } = useTranslation()
    const toolName = part.type.split('-').slice(1).join('-')
    const origin = useToolOrigin(toolName)
    if (!isToolPart(part)) return null

    const isError = part.state === 'output-error'
    // Native families get a fixed label; web search and MCP name their source.
    const originLabel =
      origin === undefined
        ? undefined
        : origin.kind === 'web-fetch'
          ? t('tools:toolCall.originWeb')
          : origin.kind === 'rag'
            ? t('tools:toolCall.originDocuments')
            : origin.kind === 'agent'
              ? t('tools:toolCall.originWorkspace')
              : origin.kind === 'subagent'
                ? t('tools:toolCall.originSubagent')
                : origin.detail

    const errorText = isError
      ? part.error || part.errorText || t('tools:toolCall.executionFailed')
      : undefined

    // Native tools present as an input bar that fills in as the arguments
    // stream, so it stays visible instead of hiding behind the collapsible;
    // the raw payload is still one click away in the header.
    const bar = describeNativeToolCall(origin, toolName, part.input)

    // `skill_read` reads as a bare tool name otherwise; the label names the
    // skill actually being loaded, which is the only interesting part of it.
    // A `task` names its subagent for a stronger reason: its widget goes away
    // once the child is launched, so without this a fan-out collapses to three
    // identical rows.
    const title =
      toolName === 'skill_read'
        ? completedToolLabel(toolName, part.input, part.state)
        : bar?.variant === 'subagent' && bar.name
          ? `${toolName}: ${bar.name}`
          : toolName

    // A `task` widget describes a launch, and the launch is over the moment the
    // call settles: the child then runs for minutes with the tasks panel
    // following it, so leaving the card open would park a static "Running in
    // the background" under every dispatch. Every other widget reports its own
    // call, which is still worth reading afterwards.
    const showBar =
      bar && (bar.variant !== 'subagent' || isToolRunning(part.state))

    return (
      <Tool
        state={part.state}
        toolCallId={part.toolCallId}
        messageId={messageId}
        className={className}
      >
        <ToolHeader
          title={title}
          type={`tool-${toolName}` as `tool-${string}`}
          state={part.state}
          origin={originLabel}
          // The widget's bar already shows the arguments; previewing them in
          // the header too prints the same text twice, one line apart.
          input={bar ? undefined : part.input}
        />
        <ToolProgressRow toolCallId={part.toolCallId} />
        {showBar && (
          <div className="mt-2">
            {bar.variant === 'documents' ? (
              <RagToolWidget
                bar={bar}
                state={part.state}
                output={part.output}
                errorText={errorText}
                messageId={messageId}
                citationOffset={citationOffset}
              />
            ) : bar.variant === 'terminal' ? (
              <TerminalWidget
                bar={bar}
                state={part.state}
                output={part.output}
                errorText={errorText}
              />
            ) : bar.variant === 'subagent' ? (
              <SubagentToolWidget bar={bar} />
            ) : bar.variant === 'workspace' ? (
              <AgentToolWidget
                bar={bar}
                state={part.state}
                output={part.output}
                errorText={errorText}
                toolCallId={part.toolCallId}
              />
            ) : (
              <WebToolWidget
                bar={bar}
                state={part.state}
                output={part.output}
                errorText={errorText}
              />
            )}
          </div>
        )}
        <ToolContent title={title}>
          {Boolean(part.input) && <ToolInput input={part.input} />}
          <ToolApprovalActions />
          {/* The widget already presents the result for native tools -- but a
              `task` has none once it settles, so its outcome (a refusal, most
              of all) has to stay reachable here. */}
          {!showBar &&
            (isError ? (
              <ToolOutput
                output={undefined}
                errorText={errorText}
                resolver={identityResolver}
              />
            ) : (
              Boolean(part.output) && (
                <ToolOutput
                  output={part.output}
                  errorText={undefined}
                  resolver={identityResolver}
                  citationOffset={citationOffset}
                />
              )
            ))}
        </ToolContent>
      </Tool>
    )
  }
)

ToolCallCard.displayName = 'ToolCallCard'
