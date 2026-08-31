/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from '@tanstack/react-router'
import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { route } from '@/constants/routes'
import { useServiceHub } from '@/hooks/useServiceHub'
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { toast } from 'sonner'
import { invoke } from '@tauri-apps/api/core'
import { getLoadedModels } from '@janhq/tauri-plugin-llamacpp-api'
import { sessionWorkspacePath } from '@janhq/tauri-plugin-agent-tools-api'
import {
  cn,
  getModelDisplayName,
  getProviderTitle,
} from '@/lib/utils'
import { predefinedProviders } from '@/constants/providers'
import { providerHasRemoteApiKeys } from '@/lib/provider-api-keys'
import { runSlashCommand, SLASH_COMMANDS } from '@/lib/coworkCommands'
import {
  compactMessages,
  type ContextManagerConfig,
} from '@/lib/context-manager'
import { ModelFactory } from '@/lib/model-factory'
import { useMessageQueue } from '@/stores/message-queue-store'
import {
  useCoworkSessions,
  ensureCurrentSession,
} from '@/hooks/useCoworkSessions'
import type { AskAnswer, CoworkTurn, Usage } from '@/types/coworkSession'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { useModelProvider } from '@/hooks/useModelProvider'
import { MessageItem } from '@/containers/MessageItem'
import SkillSelector from '@/containers/SkillSelector'
import { coworkTurnsToUIMessages } from '@/lib/coworkTurns'
import { useToolCallRuntime } from '@/hooks/useToolCallRuntime'
import { PromptProgress } from '@/components/PromptProgress'
import { useAppState } from '@/hooks/useAppState'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { CoworkWorkspacePill } from '@/containers/CoworkWorkspacePill'
import { CoworkPlanToggle } from '@/containers/CoworkPlanToggle'
import { CoworkEmptyState } from '@/containers/CoworkEmptyState'
import { usePrompt } from '@/hooks/usePrompt'
import { awaitsModel } from '@/lib/agentActivity'
import { artifactsFromParts } from '@/lib/coworkArtifacts'
import { CoworkArtifactCard } from '@/containers/CoworkArtifactCard'
import { CoworkPreviewPanel } from '@/containers/CoworkPreviewPanel'
import { CoworkDiffPanel } from '@/containers/CoworkDiffPanel'
import { CoworkTodoPanel } from '@/containers/CoworkTodoPanel'
import { CoworkTasksPanel } from '@/containers/CoworkTasksPanel'
import { CoworkChangesChip } from '@/containers/CoworkChangesChip'
import { CoworkTodoChip } from '@/containers/CoworkTodoChip'
import { CoworkTasksChip } from '@/containers/CoworkTasksChip'
import { collectCodeFileDiffs } from '@/lib/coworkDiffs'
import { CoworkSandboxChip } from '@/containers/CoworkSandboxChip'
import { CoworkBudgetNotice } from '@/containers/CoworkBudgetNotice'
import { CoworkRunNotice } from '@/containers/CoworkRunNotice'
import { CoworkAskCard } from '@/containers/CoworkAskCard'
import { CoworkChatTransport } from '@/lib/coworkTransport'
import { dispatchCoworkTool } from '@/lib/coworkDispatch'
import { applyTodoOp, renderTodoResult } from '@/lib/coworkTodo'
import { parseAskRequest, renderAskResult } from '@/lib/coworkAsk'
import { getSandboxStatus, sandboxEnforces } from '@/lib/agentTools'
import { useWebSearchConfig } from '@/hooks/useWebSearchConfig'
import { MAX_AGENT_STEPS } from '@/lib/coworkBudget'
import {
  abortRun,
  isAbortLike,
  answerAsk,
  runTurn,
  type RunOutcome,
  type StreamSink,
  type ToolOutcome,
} from '@/lib/coworkRunner'
import { useCoworkRun } from '@/hooks/useCoworkRun'
import {
  listSubagents,
  type SubagentDefinition,
} from '@/lib/coworkSubagentRegistry'
import {
  parseSubagentRequest,
  resolveSubagent,
  parentToolNames,
  runSubagent,
} from '@/lib/coworkSubagent'

export const Route = createFileRoute(route.cowork as any)({
  component: CoworkPage,
})

// A row in the slash menu — commands and model options share one shape so the
// keyboard navigation works uniformly across both.
type MenuItem = {
  key: string
  label: string
  description: string
  onSelect: () => void
}

/**
 * Manual `/compact` budget. Unlike the transport's auto-compact (which uses the
 * model's real context window and so only fires when genuinely near the limit),
 * a manual compact means "shrink this now": keep only a recent tail and
 * summarize everything older, regardless of how big the window is.
 */
const MANUAL_COMPACT_CONFIG: ContextManagerConfig = {
  maxContextTokens: 8192,
  maxOutputTokens: 2048,
  autoCompact: true,
}

function CoworkPage() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const { selectedModel, selectedProvider, providers } = useModelProvider()

  const sessions = useCoworkSessions((s) => s.sessions)
  const currentId = useCoworkSessions((s) => s.currentId)
  const session = useMemo(
    () => sessions.find((s) => s.id === currentId) ?? null,
    [sessions, currentId]
  )
  const folder = session?.folder ?? null
  const planMode = session?.planMode ?? false

  const [running, setRunning] = useState(false)
  // The session the in-flight run belongs to. The live rows are appended to
  // that session's transcript only — without this, switching sessions mid-run
  // rendered the running session's live turns under the viewed one.
  const [runSid, setRunSid] = useState<string | null>(null)
  const [liveTurns, setLiveTurns] = useState<CoworkTurn[]>([])
  const liveTurnsRef = useRef<CoworkTurn[]>([])
  const [stoppedBy, setStoppedBy] = useState<RunOutcome['stoppedBy'] | null>(
    null
  )
  const [runError, setRunError] = useState<string | undefined>(undefined)
  const [gitBranch, setGitBranch] = useState<string | null>(null)
  const [subagentDefs, setSubagentDefs] = useState<SubagentDefinition[]>([])
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  // The step just finished, so the counter tracks a run instead of jumping once
  // at the end. Falls back to the committed usage between runs.
  const [liveUsage, setLiveUsage] = useState<Usage | null>(null)
  // The rail holds one panel at a time: they all want the width, so showing
  // two together starves the transcript (C7).
  const [rail, setRail] = useState<
    | { kind: 'preview'; path: string }
    | { kind: 'diff' }
    | { kind: 'todos' }
    | { kind: 'tasks' }
    | null
  >(null)
  const showPreview = useCallback(
    (path: string) => setRail({ kind: 'preview', path }),
    []
  )
  const [ask, setAsk] = useState<{
    requestId: string
    request: ReturnType<typeof parseAskRequest>
  } | null>(null)

  const {
    containerRef: reasoningContainerRef,
    isAtBottom: isReasoningAtBottom,
    handleScroll: handleReasoningScroll,
    forceScrollToBottom: forceScrollReasoningToBottom,
  } = useAutoScroll()

  // The session's sandbox, resolved once so the workspace pill can name the
  // directory writes actually land in.
  useEffect(() => {
    let alive = true
    if (!session?.id) return
    void (async () => {
      try {
        const dataFolder = await serviceHub.app().getJanDataFolder()
        if (!dataFolder) return
        const path = await sessionWorkspacePath(dataFolder, session.id)
        if (alive) setWorkspacePath(path)
      } catch {
        // A missing path only costs the pill a subtitle.
      }
    })()
    return () => {
      alive = false
    }
  }, [session?.id, serviceHub])

  // Saved definitions name the `task` tool's options. Loaded once: the list is
  // only advertised, so a definition added mid-session applies at the next run.
  useEffect(() => {
    let alive = true
    void listSubagents().then((defs) => {
      if (alive) setSubagentDefs(defs)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!folder) {
      setGitBranch(null)
      return
    }
    invoke<string | null>('agent_git_branch', { project: folder })
      .then(setGitBranch)
      .catch(() => setGitBranch(null))
  }, [folder])

  const attachFolder = useCallback(async () => {
    const picked = await serviceHub.dialog().open({ directory: true })
    if (typeof picked !== 'string') return
    const sid = ensureCurrentSession()
    useCoworkSessions.getState().setFolder(sid, picked)
  }, [serviceHub])

  const detachFolder = useCallback(() => {
    if (session?.id) useCoworkSessions.getState().setFolder(session.id, null)
  }, [session?.id])

  // `liveTurns` holds only the rows this run has produced — `commitTurns`
  // appends them — so the committed transcript has to be shown alongside it or
  // the conversation disappears the moment a follow-up run starts.
  const viewingRun = running && runSid === session?.id
  const displayedTurns = useMemo(
    () =>
      viewingRun
        ? [...(session?.turns ?? []), ...liveTurns]
        : (session?.turns ?? []),
    [viewingRun, liveTurns, session?.turns]
  )
  const uiMessages = useMemo(
    () => coworkTurnsToUIMessages(displayedTurns, session?.id ?? 'cowork'),
    [displayedTurns, session?.id]
  )

  const usage = liveUsage ?? session?.lastUsage ?? null
  const tokenSource = useMemo(
    () => ({
      threadId: session?.id,
      usage: usage
        ? {
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          }
        : undefined,
    }),
    [session?.id, usage]
  )

  // Live runs write into the run store; a committed session carries its own.
  const liveSubagents = useCoworkRun((s) =>
    session?.id ? s.subagents[session.id] : undefined
  )
  const subagents = useMemo(
    () => liveSubagents ?? session?.subagents ?? [],
    [liveSubagents, session?.subagents]
  )
  const fileDiffs = useMemo(
    () => collectCodeFileDiffs(displayedTurns, subagents),
    [displayedTurns, subagents]
  )

  const awaitingModel = useMemo(
    () => awaitsModel(running, displayedTurns),
    [running, displayedTurns]
  )

  const pushLive = useCallback((turns: CoworkTurn[]) => {
    liveTurnsRef.current = [...liveTurnsRef.current, ...turns]
    setLiveTurns(liveTurnsRef.current)
  }, [])

  /**
   * Drive one request. `text` is null for a resume — a retry after a failure
   * re-runs the committed history rather than re-sending the question, which
   * would leave the model reading it twice.
   */
  const runRequest = async (text: string | null) => {
    if (running) return
    const sid = ensureCurrentSession()
    const store = useCoworkSessions.getState()
    const current = store.sessions.find((s) => s.id === sid)
    if (!text && !(current?.messages?.length ?? 0)) return
    if (!selectedModel?.id) {
      toast.error(t('common:selectModel'))
      return
    }
    // Without tool calling the transport drops the tool set silently, and the
    // agent then narrates work it never did. Refusing up front is honest; a
    // toolless "agent" run is worse than no run.
    if (!selectedModel.capabilities?.includes('tools')) {
      toast.error(t('common:modelNoTools', { model: selectedModel.id }))
      return
    }
    if (text && current?.title === 'New session')
      // Collapse newlines/runs of whitespace so a pasted multi-line prompt
      // doesn't become an unreadable sidebar title.
      store.setTitle(sid, text.trim().replace(/\s+/g, ' ').slice(0, 40))

    setStoppedBy(null)
    setRunError(undefined)
    setLiveUsage(null)
    liveTurnsRef.current = text ? [{ role: 'user', content: text }] : []
    setLiveTurns(liveTurnsRef.current)
    // Marks the session running in the store (and resets its subagent lanes),
    // so surfaces outside this component — the sidebar's per-session spinner
    // and its empty-session filter — can see a run this component owns.
    useCoworkRun.getState().beginRun(sid, crypto.randomUUID(), text ?? '')
    setRunSid(sid)
    setRunning(true)

    // Local models load before the first token, but only on a cold start. Probe
    // the engine so the load card shows on a real load, not on every warm run.
    if (selectedProvider === 'llamacpp') {
      try {
        const loaded = await getLoadedModels()
        if (!loaded.includes(selectedModel.id)) {
          useAppState.getState().updateModelLoadProgress(undefined)
          useAppState.getState().updateLoadingModel(true)
        }
      } catch {
        // Probe failed; skip the card rather than flash it every run.
      }
    }

    // Warm the sandbox probe: the transport's prompt and tool set read it
    // synchronously via sandboxEnforces().
    await getSandboxStatus()
    // Read once per run, not subscribed: the advertised set is frozen for the
    // run anyway, so a mid-run flip in Settings would only desync the prompt.
    const webSearch = useWebSearchConfig.getState().webSearchEnabled
    const transport = new CoworkChatTransport(sid, {
      planMode: current?.planMode ?? false,
      subagentNames: subagentDefs.map((d) => d.name),
      // Always on at depth 0, even with nothing saved: a one-off subagent with
      // an inline `system_prompt` is first-class, as it is in Rust.
      allowSubagents: true,
      webSearch,
      workspacePath,
      readOnlyFolder: current?.folder ?? null,
    })
    await transport.refreshTools()

    const controller = new AbortController()
    abortRef.current = controller

    const sink: StreamSink = {
      onText: (delta) => {
        const last = liveTurnsRef.current[liveTurnsRef.current.length - 1]
        if (last && last.role === 'assistant') {
          last.content += delta
          setLiveTurns([...liveTurnsRef.current])
        } else {
          pushLive([{ role: 'assistant', content: delta }])
        }
      },
      onToolStart: (callId, name) =>
        pushLive([
          { role: 'tool', content: '', callId, name, status: 'running' },
        ]),
      onToolArgsDelta: () => {},
      onToolCall: (call) => {
        const row = liveTurnsRef.current.find(
          (turn) => turn.callId === call.toolCallId
        )
        if (row) {
          row.args = call.input
          setLiveTurns([...liveTurnsRef.current])
        }
      },
    }

    const baseMessages = current?.messages ?? []
    const messages = text
      ? [
          ...baseMessages,
          {
            id: `${sid}-user-${baseMessages.length}`,
            role: 'user',
            parts: [{ type: 'text', text }],
          } as any,
        ]
      : [...baseMessages]

    let outcome: RunOutcome | null = null
    let thrown: Pick<RunOutcome, 'stoppedBy' | 'errorText'> | null = null
    try {
      outcome = await runTurn({
        messages,
        signal: controller.signal,
        // Starts at zero each request, matching Rust: `SessionBudget` is built
        // inside `run_orchestration_streamed`, so the allowance is per request.
        // The previous turn's `total_tokens` is a context size, not a spend, and
        // seeding with it would pre-charge the whole replayed prompt.
        sessionTokens: 0,
        deps: {
          sendStep: (msgs, signal) =>
            transport.sendMessages({
              chatId: sid,
              messages: msgs,
              abortSignal: signal,
              trigger: 'submit-message',
              messageId: undefined,
            } as any),
          dispatch: (call) =>
            dispatchCoworkTool(call, {
              sessionId: sid,
              readOnlyFolder: current?.folder ?? null,
              planMode: current?.planMode ?? false,
              webSearch,
              onTodo: async (input) => {
                const result = applyTodoOp(
                  useCoworkSessions
                    .getState()
                    .sessions.find((s) => s.id === sid)?.todos,
                  input
                )
                if (result.error) {
                  return { output: `ERROR: ${result.error}`, isError: true }
                }
                useCoworkSessions.getState().setTodos(sid, result.list)
                return { output: renderTodoResult(result.list) }
              },
              onAsk: (callId, input) =>
                new Promise<ToolOutcome>((resolve) => {
                  const parsed = parseAskRequest(input)
                  if (typeof parsed === 'string') {
                    resolve({ output: `ERROR: ${parsed}`, isError: true })
                    return
                  }
                  setAsk({ requestId: callId, request: parsed })
                  askResolvers.current.set(callId, (answers) => {
                    setAsk(null)
                    resolve(renderAskResult(answers))
                  })
                }),
              onTask: async (callId, input) => {
                const req = parseSubagentRequest(input)
                if (typeof req === 'string') {
                  return { output: `ERROR: ${req}`, isError: true }
                }
                const resolved = resolveSubagent(
                  req,
                  subagentDefs,
                  parentToolNames(transport.advertisedTools)
                )
                if ('error' in resolved) {
                  return { output: `ERROR: ${resolved.error}`, isError: true }
                }
                if (!transport.model) {
                  return {
                    output:
                      'ERROR: no model is loaded for this run, so no subagent can start',
                    isError: true,
                  }
                }
                const child = await runSubagent({
                  resolved,
                  description: req.description,
                  // The parent's instance: a second one would mean a second
                  // llama-server load for the same model.
                  model: transport.model,
                  parentTools: transport.advertisedTools,
                  system: {
                    workspacePath,
                    readOnlyFolder: current?.folder ?? null,
                    bashAvailable: sandboxEnforces(),
                  },
                  signal: controller.signal,
                  sessionTokens: 0,
                  // A child never gets `todo`/`ask`/`task`, so these refuse
                  // rather than execute: a model can still emit a call to a
                  // tool that was never advertised.
                  dispatch: (call) =>
                    dispatchCoworkTool(call, {
                      sessionId: sid,
                      readOnlyFolder: current?.folder ?? null,
                      planMode: current?.planMode ?? false,
                      webSearch,
                      onTodo: async () => ({
                        output:
                          'The todo list belongs to the agent that dispatched you.',
                        isError: true,
                      }),
                      onAsk: async () => ({
                        output:
                          'You cannot ask the user questions. Decide, and say what you assumed.',
                        isError: true,
                      }),
                      onTask: async () => ({
                        output: 'A subagent cannot dispatch subagents.',
                        isError: true,
                      }),
                    }),
                  events: {
                    onQueued: (waiting) =>
                      useCoworkRun
                        .getState()
                        .queueSubagent(sid, callId, resolved.name, waiting),
                    onStart: () =>
                      useCoworkRun
                        .getState()
                        .startSubagent(sid, callId, resolved.name),
                    onInner: (event) =>
                      useCoworkRun
                        .getState()
                        .routeIntoSubagent(sid, callId, event),
                    onEnd: (usage) =>
                      useCoworkRun.getState().endSubagent(sid, callId, usage),
                  },
                })
                useCoworkRun
                  .getState()
                  .attachSubagentOutput(sid, callId, child.output)
                return { output: child.output, isError: child.isError }
              },
            }),
          sink,
          onStep: ({ result, turns, outcomes }) => {
            if (result.usage) setLiveUsage(result.usage)
            // Replace the optimistic running rows with the settled ones so the
            // transcript shows results, not spinners.
            liveTurnsRef.current = liveTurnsRef.current.filter(
              (turn) =>
                !(turn.role === 'tool' && outcomes.has(turn.callId ?? '')) &&
                !(turn.role === 'assistant' && turn.content === result.text)
            )
            pushLive(turns)
            for (const [callId, outcome] of outcomes) {
              if (outcome.diff) {
                useToolCallRuntime.getState().recordDiff(callId, outcome.diff)
              }
            }
          },
          nextMessageId: (() => {
            let n = baseMessages.length
            return () => `${sid}-asst-${n++}`
          })(),
        },
      })
    } catch (e) {
      // The runner turns a failed step into an outcome, so this is the last
      // resort — a fault in the loop itself. Either way it is not a tool call,
      // and rendering it as one claimed the agent had run something.
      thrown = isAbortLike(e, controller.signal)
        ? { stoppedBy: 'aborted' }
        : {
            stoppedBy: 'error',
            errorText: e instanceof Error ? e.message : String(e),
          }
    } finally {
      useAppState.getState().updateLoadingModel(false)
      useCoworkSessions
        .getState()
        .commitTurns(
          sid,
          liveTurnsRef.current,
          outcome?.messages ?? messages,
          useCoworkRun.getState().subagents[sid] ?? [],
          outcome?.usage ?? undefined
        )
      useCoworkRun.getState().clearCodeRun(sid)
      liveTurnsRef.current = []
      setLiveTurns([])
      setRunning(false)
      setRunSid(null)
      abortRef.current = null
      askResolvers.current.clear()
      setAsk(null)
      const stop = thrown?.stoppedBy ?? outcome?.stoppedBy ?? null
      setStoppedBy(stop)
      setRunError(thrown?.errorText ?? outcome?.errorText)

      // Message queue (ChatInput enqueues while chatStatus is 'streaming',
      // scoped to this session): a clean finish sends the next queued message;
      // an error discards the queue, mirroring the chat route — errors mean the
      // conversation needs attention, not more unattended sends. A stop or
      // budget halt leaves the queue in place, visible as chips in the input.
      if (stop === 'error') {
        useMessageQueue.getState().clearQueue(sid)
      } else if (stop === 'done') {
        // Deferred past the re-render so the next runRequest closure sees
        // running=false; skipped if the user has since switched sessions, since
        // runRequest always targets the current one.
        setTimeout(() => {
          if (useCoworkSessions.getState().currentId !== sid) return
          const next = useMessageQueue.getState().dequeue(sid)
          if (next) void runRequestRef.current(next.text)
        }, 0)
      }
    }
  }

  // Read through a ref so the memoized message rows keep a stable callback
  // while still calling the current render's closure.
  const runRequestRef = useRef(runRequest)
  runRequestRef.current = runRequest

  /**
   * `/compact`: summarize everything but the recent tail into one system
   * message, reusing the transport's auto-compact machinery (context-manager).
   * The transcript (`turns`) is untouched — compaction rewrites what the model
   * replays, not what the user reads.
   */
  const handleCompact = async () => {
    const sid = session?.id
    const msgs = session?.messages ?? []
    if (!sid || msgs.length === 0) {
      toast(t('common:cmdNothingToCompact'))
      return
    }
    if (!selectedModel?.id) {
      toast.error(t('common:selectModel'))
      return
    }
    const provider = providers.find((p) => p.provider === selectedProvider)
    if (!provider) {
      toast.error(t('common:selectModel'))
      return
    }
    try {
      const model = await ModelFactory.createModel(selectedModel.id, provider)
      const result = await compactMessages(msgs, MANUAL_COMPACT_CONFIG, model)
      if (result.trimmedCount === 0 || !result.compactedSummary) {
        toast(t('common:cmdNothingToCompact'))
        return
      }
      useCoworkSessions.getState().setMessages(sid, result.messages)
      toast.success(
        t('common:cmdCompacted', {
          before: msgs.length,
          after: result.messages.length,
        })
      )
    } catch (e) {
      toast.error(t('common:cmdCompactFailed', { error: String(e) }))
    }
  }

  const handleSubmit = (text: string) => {
    // Slash commands are client-side actions; they never reach the agent.
    if (text.trim().startsWith('/')) {
      runSlashCommand(text, {
        t,
        running,
        currentId,
        submitTurn: (prompt) => void runRequestRef.current(prompt),
        openRail: (kind) => setRail({ kind }),
        compact: () => void handleCompact(),
      })
      return
    }
    void runRequest(text)
  }

  // Slash-command menu: the input text lives in the shared usePrompt store, so
  // the menu (and its keyboard nav) works without touching ChatInput.
  const prompt = usePrompt((s) => s.prompt)
  const [menuIndex, setMenuIndex] = useState(0)

  // Switchable models for /models — mirrors DropdownModelProvider's filtering
  // (active providers, no embedding models, remote providers only with a key),
  // narrowed to tool-capable models since runRequest refuses the rest anyway.
  const allModels = useMemo(() => {
    const items: { providerName: string; id: string; label: string }[] = []
    providers.forEach((p) => {
      if (!p.active) return
      const isPredefined = predefinedProviders.some((e) =>
        e.provider.includes(p.provider)
      )
      if (
        p.provider !== 'llamacpp' &&
        !providerHasRemoteApiKeys(p) &&
        (isPredefined || p.models.length === 0)
      )
        return
      p.models.forEach((m) => {
        if (!m.capabilities?.includes('tools')) return
        items.push({
          providerName: p.provider,
          id: m.id,
          label: getModelDisplayName(m),
        })
      })
    })
    return items
  }, [providers])

  const switchModel = useCallback(
    (providerName: string, modelId: string) => {
      useModelProvider.getState().selectModelProvider(providerName, modelId)
      usePrompt.getState().setPrompt('')
      toast.success(t('common:cmdModelSwitched', { name: modelId }))
    },
    [t]
  )

  // Build the current menu: model picker when the text is `/models[ filter]`,
  // otherwise the command list filtered by the typed `/token`.
  const menuItems: MenuItem[] = useMemo(() => {
    const inModelMode = prompt === '/models' || prompt.startsWith('/models ')
    if (inModelMode) {
      const filter = prompt.slice('/models'.length).trim().toLowerCase()
      return allModels
        .filter((m) => `${m.id} ${m.label}`.toLowerCase().includes(filter))
        .slice(0, 50)
        .map((m) => ({
          key: `${m.providerName}/${m.id}`,
          label: m.label,
          description: getProviderTitle(m.providerName),
          onSelect: () => switchModel(m.providerName, m.id),
        }))
    }
    if (prompt.startsWith('/') && !prompt.includes(' ')) {
      const q = prompt.slice(1)
      return SLASH_COMMANDS.filter((c) => c.name.slice(1).startsWith(q)).map(
        (c) => ({
          key: c.name,
          label: c.name,
          description: t(c.descKey),
          onSelect: () => {
            if (c.mode === 'args') {
              usePrompt.getState().setPrompt(`${c.name} `)
            } else {
              usePrompt.getState().setPrompt('')
              handleSubmit(c.name)
            }
          },
        })
      )
    }
    return []
    // handleSubmit is recreated every render but only reads refs/stores.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, allModels, switchModel, t])

  // Reset the highlighted row whenever the menu contents change.
  useEffect(() => setMenuIndex(0), [prompt])

  // Capture-phase keydown so arrows/Enter/Esc drive the menu BEFORE ChatInput's
  // textarea sees them (no ChatInput changes needed).
  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (menuItems.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      setMenuIndex((i) => Math.min(i + 1, menuItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      setMenuIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      menuItems[Math.min(menuIndex, menuItems.length - 1)]?.onSelect()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      usePrompt.getState().setPrompt('')
    }
  }

  /**
   * Take the last turn again. Rewinding to the question and resuming is the
   * whole operation — an agent turn is a chain of tool calls, so regenerating
   * means discarding that chain, not re-sending the question after it.
   */
  const handleRegenerate = useCallback(() => {
    if (running || !session?.id) return
    useCoworkSessions.getState().rewindToLastUser(session.id)
    void runRequestRef.current(null)
  }, [running, session?.id])

  const abortRef = useRef<AbortController | null>(null)
  const askResolvers = useRef(
    new Map<string, (answers: AskAnswer[] | null) => void>()
  )

  const handleStop = useCallback(() => {
    abortRef.current?.abort('cancelled')
    if (session?.id) abortRun(session.id)
    for (const resolve of askResolvers.current.values()) resolve(null)
    askResolvers.current.clear()
  }, [session?.id])

  const respondAsk = useCallback(
    (requestId: string, answers: AskAnswer[] | null) => {
      const resolve = askResolvers.current.get(requestId)
      askResolvers.current.delete(requestId)
      if (resolve) resolve(answers)
      else if (session?.id) answerAsk(session.id, requestId, answers)
    },
    [session?.id]
  )

  // A run outlives this component, so unmounting must not stop it.
  useEffect(() => () => useCoworkRun.getState().clearPendingPreview(), [])

  // The artifacts library selects a session, parks the path here and navigates.
  // Consumed once, so returning to Cowork later does not reopen it.
  const pendingPreview = useCoworkRun((s) => s.pendingPreview)
  useEffect(() => {
    if (!pendingPreview || !session?.id) return
    if (pendingPreview.sessionId !== session.id) return
    setRail({ kind: 'preview', path: pendingPreview.path })
    useCoworkRun.getState().clearPendingPreview()
  }, [pendingPreview, session?.id])

  // Nothing to show once the session changes: both panels describe the session
  // they were opened from.
  useEffect(() => setRail(null), [session?.id])

  return (
    <div className="flex flex-col h-[calc(100dvh-(env(safe-area-inset-bottom)+env(safe-area-inset-top)))]">
      <HeaderPage>
        <div className="flex items-center justify-between w-full pr-2">
          <DropdownModelProvider useLastUsedModel />
        </div>
      </HeaderPage>

      <div className="flex flex-1 h-full overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col h-full overflow-hidden">
          <div className="flex-1 relative">
            {displayedTurns.length === 0 ? (
              <CoworkEmptyState
                folder={folder}
                onPick={(text) => usePrompt.getState().setPrompt(text)}
              />
            ) : (
              <Conversation className="absolute inset-0 text-start">
                <ConversationContent
                  className={cn('mx-auto w-full md:w-4/5 xl:w-4/6')}
                >
                  {uiMessages.map((message, i) => (
                    <Fragment key={message.id}>
                      <MessageItem
                        message={message}
                        isFirstMessage={i === 0}
                        isLastMessage={i === uiMessages.length - 1}
                        status={viewingRun ? 'streaming' : 'ready'}
                        onRegenerate={handleRegenerate}
                        reasoningContainerRef={reasoningContainerRef}
                        isReasoningAtBottom={isReasoningAtBottom}
                        onReasoningScroll={handleReasoningScroll}
                        onReasoningScrollToBottom={forceScrollReasoningToBottom}
                      />
                      {/* Derived from the message's own write parts, so nothing
                        shared with the chat surface needs to know artifacts
                        exist. */}
                      {artifactsFromParts(message.parts).map((artifact) => (
                        <CoworkArtifactCard
                          key={artifact.path}
                          artifact={artifact}
                          root={workspacePath}
                          onPreview={showPreview}
                        />
                      ))}
                    </Fragment>
                  ))}
                  {viewingRun && (
                    // Row wrapper as in the chat route: the transcript is a
                    // column flex, which stretches the indicator's own
                    // `inline-flex` box across the whole column.
                    <div className="flex flex-row items-center gap-2">
                      <PromptProgress
                        hideIdle={!awaitingModel}
                        stateKey={session?.id}
                      />
                    </div>
                  )}
                  {stoppedBy === 'steps' && (
                    <CoworkBudgetNotice
                      kind="steps"
                      max={MAX_AGENT_STEPS}
                      onContinue={() => void handleSubmit('Continue.')}
                    />
                  )}
                  {stoppedBy === 'aborted' && (
                    <CoworkRunNotice kind="stopped" />
                  )}
                  {stoppedBy === 'error' && (
                    <CoworkRunNotice
                      kind="error"
                      message={runError}
                      onRetry={() => void runRequest(null)}
                    />
                  )}
                  {stoppedBy === 'tokens' && (
                    <CoworkBudgetNotice
                      kind="tokens"
                      onCompact={() => void handleCompact()}
                      onNewSession={() =>
                        useCoworkSessions.getState().createSession()
                      }
                    />
                  )}
                </ConversationContent>
                <ConversationScrollButton />
              </Conversation>
            )}
          </div>

          <div className="pb-4 shrink-0">
            <div className="mx-auto w-full md:w-4/5 xl:w-4/6">
              {ask && typeof ask.request !== 'string' && (
                <div className="px-1 pb-2">
                  <CoworkAskCard
                    requestId={ask.requestId}
                    request={ask.request}
                    onRespond={respondAsk}
                  />
                </div>
              )}
              <div className="relative" onKeyDownCapture={onMenuKeyDown}>
                {menuItems.length > 0 && (
                  <div className="absolute left-0 right-0 bottom-full mb-2 z-10 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-md">
                    {menuItems.map((item, i) => (
                      <button
                        key={item.key}
                        type="button"
                        ref={
                          i === menuIndex
                            ? (el) => el?.scrollIntoView({ block: 'nearest' })
                            : undefined
                        }
                        onClick={item.onSelect}
                        onMouseEnter={() => setMenuIndex(i)}
                        className={cn(
                          'flex w-full items-center gap-3 px-3 py-2 text-left text-sm',
                          i === menuIndex ? 'bg-accent' : 'hover:bg-accent'
                        )}
                      >
                        <span className="font-mono font-medium">
                          {item.label}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <ChatInput
                showSpeedToken={false}
                initialMessage={true}
                scopeKey={session?.id}
                ownsToolSet={false}
                onSubmit={handleSubmit}
                onStop={handleStop}
                chatStatus={running ? 'streaming' : 'ready'}
                tokenSource={tokenSource}
                surfaceControls={
                  <>
                    <CoworkPlanToggle
                      planMode={planMode}
                      onChange={(next) => {
                        if (session?.id)
                          useCoworkSessions
                            .getState()
                            .setPlanMode(session.id, next)
                      }}
                    />
                    <CoworkWorkspacePill
                      folder={folder}
                      gitBranch={gitBranch}
                      onAttach={() => void attachFolder()}
                      onDetach={detachFolder}
                    />
                    <CoworkSandboxChip />
                    <CoworkTodoChip
                      todos={session?.todos}
                      open={rail?.kind === 'todos'}
                      onToggle={() =>
                        setRail((r) =>
                          r?.kind === 'todos' ? null : { kind: 'todos' }
                        )
                      }
                    />
                    <CoworkTasksChip
                      subagents={subagents}
                      open={rail?.kind === 'tasks'}
                      onToggle={() =>
                        setRail((r) =>
                          r?.kind === 'tasks' ? null : { kind: 'tasks' }
                        )
                      }
                    />
                    <CoworkChangesChip
                      files={fileDiffs}
                      open={rail?.kind === 'diff'}
                      onToggle={() =>
                        setRail((r) =>
                          r?.kind === 'diff' ? null : { kind: 'diff' }
                        )
                      }
                    />
                    <div className="ml-auto flex items-center">
                      <SkillSelector folder={folder} />
                    </div>
                  </>
                }
                />
              </div>
            </div>
          </div>
        </div>

        {rail?.kind === 'preview' && (
          <CoworkPreviewPanel
            root={workspacePath}
            path={rail.path}
            onClose={() => setRail(null)}
          />
        )}
        {rail?.kind === 'diff' && (
          <CoworkDiffPanel files={fileDiffs} onClose={() => setRail(null)} />
        )}
        {rail?.kind === 'todos' && (
          <CoworkTodoPanel
            todos={session?.todos}
            onClose={() => setRail(null)}
          />
        )}
        {rail?.kind === 'tasks' && (
          <CoworkTasksPanel subagents={subagents} onClose={() => setRail(null)} />
        )}
      </div>
    </div>
  )
}
