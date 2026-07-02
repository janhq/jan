/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { IconRobot } from '@tabler/icons-react'
import { route } from '@/constants/routes'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { PermissionDecision, StreamEvent } from '@/services/agent/types'
import type { MCPTool } from '@/types/completion'

type PermissionRequestEvent = Extract<
  StreamEvent,
  { type: 'permission_request' }
>

/** Built-in fs tools (Rust `BUILTIN_TOOLS`). The tool selector lists only MCP
 * tools, so these must be added to `allowed_tools` when a project is set or the
 * loop's allowlist filter would prune them from advertisement. */
const BUILTIN_TOOL_NAMES = [
  'read',
  'ls',
  'find',
  'grep',
  'write',
  'edit',
  'bash',
]

export const Route = createFileRoute(route.agentDebug as any)({
  component: AgentDebugPanel,
})

function truncate(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}...` : flat
}

/** Strip model reasoning from the streamed text: complete `<think>...</think>`
 * blocks (any namespace prefix, e.g. `<mm:think>`), an in-progress unclosed
 * block at the tail, and any orphan think tags. */
function stripThink(text: string): string {
  return text
    .replace(/<(?:\w+:)?think\b[^>]*>[\s\S]*?<\/(?:\w+:)?think>/gi, '')
    .replace(/<(?:\w+:)?think\b[^>]*>[\s\S]*$/i, '')
    .replace(/<\/?(?:\w+:)?think\b[^>]*>/gi, '')
    .trimStart()
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
      case 'permission_request':
        rows.push(
          `permission_request: ${event.tool_name} (${event.capability})${
            event.path ? ` ${event.path}` : ''
          }`
        )
        break
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
  const [maxTurns, setMaxTurns] = useState(8)
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [running, setRunning] = useState(false)
  const [availableTools, setAvailableTools] = useState<MCPTool[]>([])
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set())
  const [projectRoot, setProjectRoot] = useState('')
  const [initMsg, setInitMsg] = useState('')
  const [pendingPermission, setPendingPermission] =
    useState<PermissionRequestEvent | null>(null)
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
      stripThink(
        events
          .filter(
            (e): e is Extract<StreamEvent, { type: 'token' }> =>
              e.type === 'token'
          )
          .map((e) => e.text)
          .join('')
      ),
    [events]
  )

  const logRows = useMemo(() => condenseEvents(events), [events])

  const handleRun = async () => {
    if (running || !prompt.trim()) return
    const runId = crypto.randomUUID()
    runIdRef.current = runId
    setEvents([])
    setPendingPermission(null)
    setRunning(true)
    try {
      await serviceHub.agent().run(
        runId,
        {
          messages: [{ role: 'user', content: prompt }],
          max_turns: maxTurns,
          ...(modelId ? { model: modelId } : {}),
          ...(availableTools.length > 0
            ? {
                allowed_tools: [
                  ...selectedTools,
                  ...(projectRoot.trim() ? BUILTIN_TOOL_NAMES : []),
                ],
              }
            : {}),
          ...(projectRoot.trim() ? { project: projectRoot.trim() } : {}),
        },
        (event) => {
          setEvents((prev) => [...prev, event])
          if (event.type === 'permission_request') setPendingPermission(event)
        }
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

  const handleInit = async () => {
    if (!projectRoot.trim()) return
    try {
      const dir = await serviceHub.agent().initProject(projectRoot.trim())
      setInitMsg(t('common:agentDebug.initSuccess', { path: dir }))
    } catch (error) {
      // No-clobber: an existing project is a benign "already set up", not a failure.
      const message = String(error)
      setInitMsg(
        /already exists/i.test(message)
          ? t('common:agentDebug.initExists')
          : t('common:agentDebug.initError', { message })
      )
    }
  }

  const respondPermission = async (decision: PermissionDecision) => {
    if (!pendingPermission) return
    const { request_id } = pendingPermission
    setPendingPermission(null)
    await serviceHub.agent().respondPermission(request_id, decision)
  }

  return (
    <div className="flex flex-col h-svh min-h-0 min-w-0 bg-background overflow-hidden p-4 gap-3">
      <div className="flex items-center gap-2 shrink-0">
        <IconRobot className="text-muted-foreground/80 size-6" />
        <h1 className="text-xl font-bold text-muted-foreground">
          {t('common:agentDebug.title')}
        </h1>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        {/* Controls */}
        <div className="flex flex-col gap-3 lg:w-96 lg:shrink-0 min-h-0 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1 shrink-0">
            <label className="text-sm text-muted-foreground" htmlFor="agent-model">
              {t('common:agentDebug.modelLabel')}
            </label>
            <select
              id="agent-model"
              className="appearance-none bg-secondary text-foreground border border-border rounded-lg p-2 text-sm w-full [color-scheme:dark]"
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
          </div>

          <div className="flex flex-col gap-1 shrink-0">
            <label className="text-sm text-muted-foreground" htmlFor="agent-steps">
              {t('common:agentDebug.stepsLabel')}
            </label>
            <input
              id="agent-steps"
              type="number"
              min={1}
              max={400}
              className="appearance-none bg-secondary text-foreground border border-border rounded-lg p-2 text-sm w-full [color-scheme:dark]"
              value={maxTurns}
              onChange={(e) =>
                setMaxTurns(
                  Math.min(400, Math.max(1, Number(e.target.value) || 1))
                )
              }
              disabled={running}
            />
          </div>

          <div className="flex flex-col gap-1 shrink-0">
            <label
              className="text-sm text-muted-foreground"
              htmlFor="agent-project"
            >
              {t('common:agentDebug.projectLabel')}
            </label>
            <div className="flex gap-2 items-center">
              <input
                id="agent-project"
                className="appearance-none bg-secondary text-foreground border border-border rounded-lg p-2 text-sm flex-1 min-w-0 [color-scheme:dark]"
                placeholder={t('common:agentDebug.projectPlaceholder')}
                value={projectRoot}
                onChange={(e) => setProjectRoot(e.target.value)}
                disabled={running}
              />
              <button
                className="bg-secondary text-foreground rounded-md px-3 py-2 text-sm disabled:opacity-50 shrink-0"
                onClick={handleInit}
                disabled={running || !projectRoot.trim()}
              >
                {t('common:agentDebug.init')}
              </button>
            </div>
            {initMsg && (
              <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {initMsg}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1 shrink-0">
            <span className="text-sm text-muted-foreground">
              {t('common:agentDebug.toolsLabel')}
            </span>
            <div className="bg-secondary/50 rounded-lg p-3 max-h-40 overflow-y-auto">
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
          </div>

          <div className="flex flex-col gap-1 flex-1 min-h-0">
            <label
              className="text-sm text-muted-foreground shrink-0"
              htmlFor="agent-prompt"
            >
              {t('common:agentDebug.promptLabel')}
            </label>
            <textarea
              id="agent-prompt"
              className="bg-secondary/50 rounded-lg p-3 text-sm font-mono flex-1 min-h-24 w-full resize-none"
              placeholder={t('common:agentDebug.promptPlaceholder')}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={running}
            />
          </div>

          <div className="flex gap-2 shrink-0">
            <button
              className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm disabled:opacity-50"
              onClick={handleRun}
              disabled={running || !prompt.trim()}
            >
              {running
                ? t('common:agentDebug.running')
                : t('common:agentDebug.run')}
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
        </div>

        {/* Results */}
        <div className="flex flex-col flex-1 min-h-0 min-w-0 gap-3">
          <div className="bg-secondary/50 rounded-lg p-3 min-w-0 flex flex-col flex-1 min-h-0">
            <h2 className="text-base font-semibold mb-2 shrink-0">
              {t('common:agentDebug.output')}
            </h2>
            <pre className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere] flex-1 min-h-0 overflow-y-auto">
              {streamedText}
            </pre>
          </div>

          <div className="bg-secondary/50 rounded-lg p-3 min-w-0 flex flex-col flex-1 min-h-0">
            <h2 className="text-base font-semibold mb-2 shrink-0">
              {t('common:agentDebug.eventLog')}
            </h2>
            {events.length === 0 ? (
              <div className="text-muted-foreground text-sm py-2">
                {t('common:agentDebug.empty')}
              </div>
            ) : (
              <ol className="text-xs font-mono flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
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
      </div>

      {pendingPermission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-lg p-5 w-full max-w-md flex flex-col gap-4">
            <h2 className="text-base font-semibold text-foreground">
              {t('common:agentDebug.permissionTitle')}
            </h2>
            <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {t('common:agentDebug.permissionBody', {
                tool: pendingPermission.tool_name,
                capability: pendingPermission.capability,
                path: pendingPermission.path
                  ? `: ${pendingPermission.path}`
                  : '',
              })}
            </p>
            <div className="flex gap-2 justify-end flex-wrap">
              <button
                className="bg-secondary text-foreground rounded-md px-3 py-2 text-sm"
                onClick={() => respondPermission('deny')}
              >
                {t('common:agentDebug.permissionDeny')}
              </button>
              <button
                className="bg-secondary text-foreground rounded-md px-3 py-2 text-sm"
                onClick={() => respondPermission('allow_once')}
              >
                {t('common:agentDebug.permissionAllowOnce')}
              </button>
              {pendingPermission.offers_always && (
                <button
                  className="bg-primary text-primary-foreground rounded-md px-3 py-2 text-sm"
                  onClick={() => respondPermission('allow_always')}
                >
                  {t('common:agentDebug.permissionAllowAlways')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
