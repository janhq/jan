/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { IconRobot } from '@tabler/icons-react'
import { route } from '@/constants/routes'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { StreamEvent } from '@/services/agent/types'
import type { MCPTool } from '@/types/completion'

export const Route = createFileRoute(route.agentDebug as any)({
  component: AgentDebugPanel,
})

function truncate(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}...` : flat
}

/** Collapse the raw event stream into a compact log: runs of token events
 * become a single live counter, tool calls/results show name + short output. */
function condenseEvents(events: StreamEvent[]): string[] {
  const rows: string[] = []
  const toolNames = new Map<string, string>()
  let tokenRun = 0

  const flushTokens = () => {
    if (tokenRun > 0) {
      rows.push(`streaming... (${tokenRun} token${tokenRun === 1 ? '' : 's'})`)
      tokenRun = 0
    }
  }

  for (const event of events) {
    if (event.type === 'token') {
      tokenRun++
      continue
    }
    flushTokens()
    switch (event.type) {
      case 'step':
        rows.push(`step ${event.index}/${event.max}`)
        break
      case 'tool_call':
        toolNames.set(event.id, event.name)
        rows.push(`tool_call: ${event.name}`)
        break
      case 'tool_result': {
        const name = toolNames.get(event.id) ?? event.id
        const flag = event.is_error ? ' [error]' : ''
        rows.push(`tool_result: ${name}${flag} - ${truncate(event.content)}`)
        break
      }
      case 'done':
        rows.push(`done: ${event.stop_reason}`)
        break
      case 'error':
        rows.push(`error [${event.code}]: ${event.message}`)
        break
    }
  }
  flushTokens()
  return rows
}

function AgentDebugPanel() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const providers = useModelProvider((s) => s.providers)

  const [prompt, setPrompt] = useState('')
  const [modelId, setModelId] = useState('')
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [running, setRunning] = useState(false)
  const [availableTools, setAvailableTools] = useState<MCPTool[]>([])
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set())
  const runIdRef = useRef<string | null>(null)

  useEffect(() => {
    serviceHub
      .mcp()
      .getTools()
      .then((tools) => {
        setAvailableTools(tools)
        setSelectedTools(new Set(tools.map((tool) => tool.name)))
      })
      .catch((error) => console.error('Failed to load MCP tools:', error))
  }, [serviceHub])

  const toggleTool = (name: string) => {
    setSelectedTools((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const modelOptions = useMemo(
    () =>
      providers
        .filter((p) => p.active)
        .flatMap((p) =>
          p.models.map((m) => ({ id: m.id, label: `${p.provider} / ${m.id}` }))
        ),
    [providers]
  )

  const streamedText = useMemo(
    () =>
      events
        .filter((e): e is Extract<StreamEvent, { type: 'token' }> => e.type === 'token')
        .map((e) => e.text)
        .join(''),
    [events]
  )

  const logRows = useMemo(() => condenseEvents(events), [events])

  const handleRun = async () => {
    if (running || !prompt.trim()) return
    const runId = crypto.randomUUID()
    runIdRef.current = runId
    setEvents([])
    setRunning(true)
    try {
      await serviceHub.agent().run(
        runId,
        {
          messages: [{ role: 'user', content: prompt }],
          ...(modelId ? { model: modelId } : {}),
          ...(availableTools.length > 0
            ? { allowed_tools: Array.from(selectedTools) }
            : {}),
        },
        (event) => setEvents((prev) => [...prev, event])
      )
    } catch (error) {
      setEvents((prev) => [
        ...prev,
        { type: 'error', code: 'invoke', message: String(error) },
      ])
    } finally {
      setRunning(false)
      runIdRef.current = null
    }
  }

  const handleCancel = async () => {
    if (runIdRef.current) {
      await serviceHub.agent().cancel(runIdRef.current)
    }
  }

  return (
    <div className="flex flex-col h-full min-w-0 bg-background overflow-y-auto overflow-x-hidden p-6 gap-4">
      <div className="flex items-center gap-2">
        <IconRobot className="text-muted-foreground/80 size-6" />
        <h1 className="text-xl font-bold text-muted-foreground">
          {t('common:agentDebug.title')}
        </h1>
      </div>

      <label className="text-sm text-muted-foreground" htmlFor="agent-model">
        {t('common:agentDebug.modelLabel')}
      </label>
      <select
        id="agent-model"
        className="appearance-none bg-secondary text-foreground border border-border rounded-lg p-2 text-sm w-full max-w-md [color-scheme:dark]"
        value={modelId}
        onChange={(e) => setModelId(e.target.value)}
        disabled={running}
      >
        <option value="">{t('common:agentDebug.modelAuto')}</option>
        {modelOptions.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>

      <span className="text-sm text-muted-foreground">
        {t('common:agentDebug.toolsLabel')}
      </span>
      <div className="bg-secondary/50 rounded-lg p-3 max-h-40 overflow-y-auto shrink-0">
        {availableTools.length === 0 ? (
          <div className="text-muted-foreground text-sm">
            {t('common:agentDebug.noTools')}
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {availableTools.map((tool) => (
              <li key={tool.name}>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedTools.has(tool.name)}
                    onChange={() => toggleTool(tool.name)}
                    disabled={running}
                  />
                  <span className="text-foreground">{tool.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {tool.server}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="text-sm text-muted-foreground" htmlFor="agent-prompt">
        {t('common:agentDebug.promptLabel')}
      </label>
      <textarea
        id="agent-prompt"
        className="bg-secondary/50 rounded-lg p-3 text-sm font-mono min-h-24 w-full shrink-0"
        placeholder={t('common:agentDebug.promptPlaceholder')}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={running}
      />

      <div className="flex gap-2 shrink-0">
        <button
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm disabled:opacity-50"
          onClick={handleRun}
          disabled={running || !prompt.trim()}
        >
          {running ? t('common:agentDebug.running') : t('common:agentDebug.run')}
        </button>
        <button
          className="bg-secondary text-foreground rounded-md px-4 py-2 text-sm disabled:opacity-50"
          onClick={handleCancel}
          disabled={!running}
        >
          {t('common:agentDebug.cancel')}
        </button>
        <button
          className="text-muted-foreground rounded-md px-4 py-2 text-sm disabled:opacity-50"
          onClick={() => setEvents([])}
          disabled={running || events.length === 0}
        >
          {t('common:agentDebug.clear')}
        </button>
      </div>

      <div className="bg-secondary/50 rounded-lg p-3 min-w-0 shrink-0">
        <h2 className="text-base font-semibold mb-2">
          {t('common:agentDebug.output')}
        </h2>
        <pre className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere] min-h-12 max-h-48 overflow-y-auto">
          {streamedText}
        </pre>
      </div>

      <div className="bg-secondary/50 rounded-lg p-3 min-w-0 shrink-0">
        <h2 className="text-base font-semibold mb-2">
          {t('common:agentDebug.eventLog')}
        </h2>
        {events.length === 0 ? (
          <div className="text-muted-foreground text-sm py-2">
            {t('common:agentDebug.empty')}
          </div>
        ) : (
          <ol className="text-xs font-mono flex flex-col gap-1 max-h-80 overflow-y-auto overflow-x-hidden">
            {logRows.map((row, i) => (
              <li
                key={i}
                className="text-foreground whitespace-pre-wrap [overflow-wrap:anywhere]"
              >
                {row}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
