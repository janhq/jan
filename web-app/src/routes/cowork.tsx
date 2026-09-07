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
import { cn } from '@/lib/utils'
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
import { CoworkChangesChip } from '@/containers/CoworkChangesChip'
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

function CoworkPage() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const { selectedModel, selectedProvider } = useModelProvider()

  const sessions = useCoworkSessions((s) => s.sessions)
  const currentId = useCoworkSessions((s) => s.currentId)
  const session = useMemo(
    () => sessions.find((s) => s.id === currentId) ?? null,
    [sessions, currentId]
  )
  const folder = session?.folder ?? null
  const planMode = session?.planMode ?? false

  const [running, setRunning] = useState(false)
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
  // The rail holds one panel at a time: preview and diff both want the width,
  // so showing them together starves the transcript (C7).
  const [rail, setRail] = useState<
    { kind: 'preview'; path: string } | { kind: 'diff' } | null
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
  const displayedTurns = useMemo(
    () =>
      running
        ? [...(session?.turns ?? []), ...liveTurns]
        : (session?.turns ?? []),
    [running, liveTurns, session?.turns]
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
  const fileDiffs = useMemo(
    () =>
      collectCodeFileDiffs(
        displayedTurns,
        liveSubagents ?? session?.subagents ?? []
      ),
    [displayedTurns, liveSubagents, session?.subagents]
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
      store.setTitle(sid, text.slice(0, 40))

    setStoppedBy(null)
    setRunError(undefined)
    setLiveUsage(null)
    liveTurnsRef.current = text ? [{ role: 'user', content: text }] : []
    setLiveTurns(liveTurnsRef.current)
    useCoworkRun.getState().resetSubagents(sid)
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
      liveTurnsRef.current = []
      setLiveTurns([])
      setRunning(false)
      abortRef.current = null
      askResolvers.current.clear()
      setAsk(null)
      setStoppedBy(thrown?.stoppedBy ?? outcome?.stoppedBy ?? null)
      setRunError(thrown?.errorText ?? outcome?.errorText)
    }
  }

  // Read through a ref so the memoized message rows keep a stable callback
  // while still calling the current render's closure.
  const runRequestRef = useRef(runRequest)
  runRequestRef.current = runRequest

  const handleSubmit = (text: string) => void runRequest(text)

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
                        status={running ? 'streaming' : 'ready'}
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
                  {running && (
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
                      onCompact={() => toast.info(t('common:budget.compact'))}
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
      </div>
    </div>
  )
}
