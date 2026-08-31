import { memo, useMemo } from 'react'
import type { ToolUIPart } from 'ai'
import {
  IconTerminal2,
  IconFile,
  IconFolder,
  IconSearch,
  IconNotebook,
  IconBook,
  IconLock,
  IconFilePencil,
} from '@tabler/icons-react'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  isToolRunning,
  parseBashOutput,
  type ToolCallBar,
} from '@/lib/toolPresentation'
import { cn } from '@/lib/utils'
import { useToolCallRuntime } from '@/hooks/useToolCallRuntime'
import { Caret, ToolBar } from './ToolBar'

const asText = (output: unknown): string =>
  typeof output === 'string'
    ? output
    : typeof (output as { content?: unknown })?.content === 'string'
      ? (output as { content: string }).content
      : ''

const OutputBlock = ({ children }: { children: React.ReactNode }) => (
  <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap wrap-break-word rounded-md border bg-card/40 px-2 py-1.5 font-mono text-xs text-muted-foreground">
    {children}
  </pre>
)

/**
 * Tone for one line of a `write`/`edit` diff. The format comes from
 * `render_edit_diff`/`render_write_diff` in Rust: `@@ ... @@` hunk headers, then
 * `-`/`+` lines carrying their own `   N | text` line numbers.
 */
const diffLineTone = (line: string): string => {
  if (line.startsWith('@@')) return 'text-muted-foreground/60'
  if (line.startsWith('+'))
    return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  if (line.startsWith('-')) return 'bg-destructive/10 text-destructive'
  return 'text-muted-foreground'
}

/**
 * A `write`/`edit` diff. Kept out of the model-facing tool output on purpose (it
 * would just repeat the file), so it arrives through the runtime store instead.
 */
const DiffBlock = memo(({ diff }: { diff: string }) => (
  <div className="mt-1.5 max-h-56 overflow-auto rounded-md border bg-card/40 py-1 font-mono text-xs">
    {diff.split('\n').map((line, i) => (
      <div
        key={i}
        className={cn(
          'whitespace-pre-wrap wrap-break-word px-2',
          diffLineTone(line)
        )}
      >
        {line || ' '}
      </div>
    ))}
  </div>
))

DiffBlock.displayName = 'DiffBlock'

export type TerminalWidgetProps = {
  bar: Extract<ToolCallBar, { variant: 'terminal' }>
  state: ToolUIPart['state']
  output?: ToolUIPart['output']
  errorText?: string
}

/**
 * `bash` rendered as a terminal: the command streams in after a prompt, then its
 * output fills the scrollback below. The trailing `[exit N]` marker becomes a
 * status chip rather than staying in the text.
 *
 * The command streams; the output does not. `execute_tool` is one round trip, so
 * stdout arrives whole when the run finishes. Incremental output would need the
 * Rust side to emit events per chunk.
 */
export const TerminalWidget = memo(
  ({ bar, state, output, errorText }: TerminalWidgetProps) => {
    const { t } = useTranslation()
    const running = isToolRunning(state)
    const result = useMemo(
      () => (output ? parseBashOutput(output) : undefined),
      [output]
    )
    // A non-zero exit is reported in-band, so the body is the failure detail and
    // the chip is the failure signal; there is no separate error banner to show.
    const failed = errorText !== undefined || (result?.exit ?? 0) !== 0
    const body = result?.text || (errorText ? asText(errorText) : '')

    return (
      <div className="overflow-hidden rounded-md border bg-card/60">
        <div className="flex items-center gap-1.5 border-b px-2 py-1 text-xs text-muted-foreground">
          <IconTerminal2 size={14} className="shrink-0" />
          <span className="font-medium">{t('tools:toolCall.terminal')}</span>
          {result?.exit !== undefined && (
            <span
              className={cn(
                'ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono',
                failed
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-primary/10 text-primary'
              )}
            >
              {t('tools:toolCall.exitCode', { code: result.exit })}
            </span>
          )}
          {result?.signaled && (
            <span className="ml-auto shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">
              {t('tools:toolCall.terminated')}
            </span>
          )}
        </div>
        <div className="px-2 py-1.5 font-mono text-xs">
          <div className="flex gap-1.5">
            <span className="shrink-0 select-none text-muted-foreground/70">
              $
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap wrap-break-word text-foreground">
              {bar.jobId && !bar.command
                ? t('tools:toolCall.pollingJob', { id: bar.jobId })
                : bar.command}
              {running && <Caret />}
            </span>
          </div>
          {!running && body && (
            <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap wrap-break-word text-muted-foreground">
              {body}
            </pre>
          )}
          {result?.truncated && (
            <p className="mt-1 text-muted-foreground/70">
              {t('tools:toolCall.outputTruncated')}
            </p>
          )}
          {/* Surfaced rather than dropped: when the sandbox is what failed the
              command, the limits are the actual explanation for the exit code. */}
          {result?.sandboxNote && (
            <p className="mt-1 flex items-start gap-1.5 text-muted-foreground/70">
              <IconLock size={13} className="mt-0.5 shrink-0" />
              <span>{result.sandboxNote}</span>
            </p>
          )}
        </div>
      </div>
    )
  }
)

TerminalWidget.displayName = 'TerminalWidget'

const TOOL_ICONS: Record<string, typeof IconFile> = {
  read: IconFile,
  ls: IconFolder,
  find: IconSearch,
  grep: IconSearch,
  write: IconFilePencil,
  edit: IconFilePencil,
  memory_list: IconNotebook,
  memory_read: IconNotebook,
  memory_write: IconNotebook,
  skill_list: IconBook,
  skill_read: IconBook,
  skill_write: IconBook,
}

/** Tools whose whole call is the verb: there is no argument worth a bar. */
const LISTING_TOOLS = new Set(['memory_list', 'skill_list', 'ls'])

// A workspace call is not always a read: `Reading...` under a `write` is simply
// wrong, and the verb is the only progress signal the widget has.
const RUNNING_KEYS: Record<string, string> = {
  write: 'tools:toolCall.writing',
  memory_write: 'tools:toolCall.writing',
  skill_write: 'tools:toolCall.writing',
  edit: 'tools:toolCall.editing',
  find: 'tools:toolCall.searching',
  grep: 'tools:toolCall.searching',
  ls: 'tools:toolCall.listing',
  memory_list: 'tools:toolCall.listing',
  skill_list: 'tools:toolCall.listing',
}

// find/grep bars carry a pattern and memory/skill an entry name, so `path` is
// the wrong prompt for both.
const PLACEHOLDER_KEYS: Record<string, string> = {
  find: 'tools:toolCall.patternPlaceholder',
  grep: 'tools:toolCall.patternPlaceholder',
  memory_read: 'tools:toolCall.namePlaceholder',
  memory_write: 'tools:toolCall.namePlaceholder',
  skill_read: 'tools:toolCall.namePlaceholder',
  skill_write: 'tools:toolCall.namePlaceholder',
}

export type AgentToolWidgetProps = {
  bar: Extract<ToolCallBar, { variant: 'workspace' }>
  state: ToolUIPart['state']
  output?: ToolUIPart['output']
  errorText?: string
  /** Needed to look up this call's display-only diff. */
  toolCallId?: string
}

/**
 * The workspace tools rendered as the thing they act on -- a path, a glob, a
 * memory name -- followed by the result, mirroring how the web tools present a
 * query or a URL.
 */
export const AgentToolWidget = memo(
  ({ bar, state, output, errorText, toolCallId }: AgentToolWidgetProps) => {
    const { t } = useTranslation()
    const running = isToolRunning(state)
    const diff = useToolCallRuntime((s) =>
      toolCallId ? s.diffs[toolCallId] : undefined
    )
    const Icon = TOOL_ICONS[bar.tool] ?? IconFile
    const body = asText(output)
    // `ls` with no path lists the workspace root; show that rather than a bar
    // that reads as though an argument failed to stream.
    const value =
      bar.target || (LISTING_TOOLS.has(bar.tool) ? t('tools:toolCall.workspaceRoot') : '')

    return (
      <div className="space-y-1.5">
        <ToolBar
          icon={<Icon size={16} />}
          value={value}
          placeholder={t(
            PLACEHOLDER_KEYS[bar.tool] ?? 'tools:toolCall.pathPlaceholder'
          )}
          typing={running}
          mono
          trailing={
            bar.detail ? (
              <span className="shrink-0 font-mono text-xs text-muted-foreground/70">
                {bar.detail}
              </span>
            ) : undefined
          }
        />

        {errorText && (
          <div className="rounded-md bg-destructive/10 px-2 py-1.5 text-sm text-destructive">
            {errorText}
          </div>
        )}

        {running && !errorText && (
          <div className="px-2 text-sm">
            <Shimmer duration={1}>
              {t(RUNNING_KEYS[bar.tool] ?? 'tools:toolCall.reading')}
            </Shimmer>
          </div>
        )}

        {!running &&
          !errorText &&
          // A diff supersedes the body: `Applied 2 edit(s) to a.txt` says less
          // than the change itself.
          (diff ? (
            <DiffBlock diff={diff} />
          ) : body ? (
            <OutputBlock>{body}</OutputBlock>
          ) : (
            <p className="px-2 text-sm text-muted-foreground/70">
              {t('tools:toolCall.noResults')}
            </p>
          ))}
      </div>
    )
  }
)

AgentToolWidget.displayName = 'AgentToolWidget'
