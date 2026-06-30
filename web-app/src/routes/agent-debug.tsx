/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'
import { IconRobot } from '@tabler/icons-react'
import { route } from '@/constants/routes'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { StreamEvent } from '@/services/agent/types'

export const Route = createFileRoute(route.agentDebug as any)({
  component: AgentDebugPanel,
})

function describeEvent(event: StreamEvent): string {
  switch (event.type) {
    case 'token':
      return `token: ${JSON.stringify(event.text)}`
    case 'step':
      return `step ${event.index}/${event.max}`
    case 'tool_call':
      return `tool_call ${event.name} (${event.id}) ${JSON.stringify(event.args)}`
    case 'tool_result':
      return `tool_result ${event.id}${event.is_error ? ' [error]' : ''}: ${event.content}`
    case 'done':
      return `done: ${event.stop_reason}`
    case 'error':
      return `error [${event.code}]: ${event.message}`
  }
}

function AgentDebugPanel() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const providers = useModelProvider((s) => s.providers)

  const [prompt, setPrompt] = useState('')
  const [modelId, setModelId] = useState('')
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [running, setRunning] = useState(false)
  const runIdRef = useRef<string | null>(null)

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
    <div className="flex flex-col h-full bg-background overflow-y-auto p-6 gap-4">
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

      <label className="text-sm text-muted-foreground" htmlFor="agent-prompt">
        {t('common:agentDebug.promptLabel')}
      </label>
      <textarea
        id="agent-prompt"
        className="bg-secondary/50 rounded-lg p-3 text-sm font-mono min-h-24 w-full"
        placeholder={t('common:agentDebug.promptPlaceholder')}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={running}
      />

      <div className="flex gap-2">
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

      <div className="bg-secondary/50 rounded-lg p-3">
        <h2 className="text-base font-semibold mb-2">
          {t('common:agentDebug.output')}
        </h2>
        <pre className="text-sm whitespace-pre-wrap break-words min-h-12 max-h-48 overflow-y-auto">
          {streamedText}
        </pre>
      </div>

      <div className="bg-secondary/50 rounded-lg p-3">
        <h2 className="text-base font-semibold mb-2">
          {t('common:agentDebug.eventLog')}
        </h2>
        {events.length === 0 ? (
          <div className="text-muted-foreground text-sm py-2">
            {t('common:agentDebug.empty')}
          </div>
        ) : (
          <ol className="text-xs font-mono flex flex-col gap-1 max-h-80 overflow-y-auto">
            {events.map((event, i) => (
              <li key={i} className="text-foreground break-words">
                {describeEvent(event)}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
