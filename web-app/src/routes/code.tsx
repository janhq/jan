/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from '@tanstack/react-router'
import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { route } from '@/constants/routes'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { invoke } from '@tauri-apps/api/core'
import { getLoadedModels } from '@janhq/tauri-plugin-llamacpp-api'
import { sessionWorkspacePath } from '@janhq/tauri-plugin-agent-tools-api'
import { cn } from '@/lib/utils'
import {
  useCodeSessions,
  ensureCurrentSession,
} from '@/hooks/useCodeSessions'
import type { AskAnswer, CodeTurn } from '@/types/codeSession'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { useModelProvider } from '@/hooks/useModelProvider'
import { MessageItem } from '@/containers/MessageItem'
import SkillSelector from '@/containers/SkillSelector'
import { codeTurnsToUIMessages } from '@/lib/codeTurns'
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
import { CoworkSandboxChip } from '@/containers/CoworkSandboxChip'
import { CoworkBudgetNotice } from '@/containers/CoworkBudgetNotice'
import { CodeAskCard } from '@/containers/CodeAskCard'
import { CoworkChatTransport } from '@/lib/coworkTransport'
import { dispatchCoworkTool } from '@/lib/coworkDispatch'
import { applyTodoOp, renderTodoResult } from '@/lib/coworkTodo'
import { parseAskRequest, renderAskResult } from '@/lib/coworkAsk'
import { getSandboxStatus } from '@/lib/agentTools'
import { MAX_AGENT_STEPS } from '@/lib/coworkBudget'
import {
  abortRun,
  answerAsk,
  runTurn,
  type RunOutcome,
  type StreamSink,
  type ToolOutcome,
} from '@/lib/coworkRunner'
import { useCodeRun } from '@/hooks/useCodeRun'

export const Route = createFileRoute(route.code as any)({
  component: CodePage,
})

function CodePage() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const { selectedModel, selectedProvider } = useModelProvider()

  const sessions = useCodeSessions((s) => s.sessions)
  const currentId = useCodeSessions((s) => s.currentId)
  const session = useMemo(
    () => sessions.find((s) => s.id === currentId) ?? null,
    [sessions, currentId]
  )
  const folder = session?.folder ?? null
  const planMode = session?.planMode ?? false

  const [running, setRunning] = useState(false)
  const [liveTurns, setLiveTurns] = useState<CodeTurn[]>([])
  const liveTurnsRef = useRef<CodeTurn[]>([])
  const [stoppedBy, setStoppedBy] = useState<RunOutcome['stoppedBy'] | null>(
    null
  )
  const [gitBranch, setGitBranch] = useState<string | null>(null)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
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
    useCodeSessions.getState().setFolder(sid, picked)
  }, [serviceHub])

  const detachFolder = useCallback(() => {
    if (session?.id) useCodeSessions.getState().setFolder(session.id, null)
  }, [session?.id])

  const displayedTurns = useMemo(
    () => (running ? liveTurns : (session?.turns ?? [])),
    [running, liveTurns, session?.turns]
  )
  const uiMessages = useMemo(
    () => codeTurnsToUIMessages(displayedTurns, session?.id ?? 'code'),
    [displayedTurns, session?.id]
  )

  const pushLive = useCallback((turns: CodeTurn[]) => {
    liveTurnsRef.current = [...liveTurnsRef.current, ...turns]
    setLiveTurns(liveTurnsRef.current)
  }, [])

  const handleSubmit = async (text: string) => {
    if (running) return
    const sid = ensureCurrentSession()
    const store = useCodeSessions.getState()
    const current = store.sessions.find((s) => s.id === sid)
    if (!selectedModel?.id) {
      toast.error(t('common:selectModel'))
      return
    }
    if (current?.title === 'New session') store.setTitle(sid, text.slice(0, 40))

    setStoppedBy(null)
    liveTurnsRef.current = [{ role: 'user', content: text }]
    setLiveTurns(liveTurnsRef.current)
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
    const transport = new CoworkChatTransport(sid, {
      planMode: current?.planMode ?? false,
      subagentNames: [],
      // Subagents need `agent_subagent_list`, which is not wired yet.
      allowSubagents: false,
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
    const messages = [
      ...baseMessages,
      {
        id: `${sid}-user-${baseMessages.length}`,
        role: 'user',
        parts: [{ type: 'text', text }],
      } as any,
    ]

    let outcome: RunOutcome | null = null
    try {
      outcome = await runTurn({
        messages,
        signal: controller.signal,
        sessionTokens: session?.lastUsage?.total_tokens ?? 0,
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
              onTodo: async (input) => {
                const result = applyTodoOp(
                  useCodeSessions.getState().sessions.find((s) => s.id === sid)
                    ?.todos,
                  input
                )
                if (result.error) {
                  return { output: `ERROR: ${result.error}`, isError: true }
                }
                useCodeSessions.getState().setTodos(sid, result.list)
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
              onTask: async () => ({
                output:
                  'Subagents are not available in this build. Do the work yourself.',
                isError: true,
              }),
            }),
          sink,
          onStep: ({ result, turns, outcomes }) => {
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
      pushLive([
        {
          role: 'tool',
          content: '',
          name: 'error',
          result: e instanceof Error ? e.message : String(e),
          isError: true,
          status: 'done',
        },
      ])
    } finally {
      useAppState.getState().updateLoadingModel(false)
      useCodeSessions
        .getState()
        .commitTurns(
          sid,
          liveTurnsRef.current,
          outcome?.messages ?? messages,
          [],
          outcome?.usage ?? undefined
        )
      liveTurnsRef.current = []
      setLiveTurns([])
      setRunning(false)
      abortRef.current = null
      askResolvers.current.clear()
      setAsk(null)
      setStoppedBy(outcome?.stoppedBy ?? null)
    }
  }

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
  useEffect(() => () => useCodeRun.getState().clearPendingPreview(), [])

  return (
    <div className="flex flex-col h-[calc(100dvh-(env(safe-area-inset-bottom)+env(safe-area-inset-top)))]">
      <HeaderPage>
        <div className="flex items-center justify-between w-full pr-2">
          <DropdownModelProvider useLastUsedModel />
        </div>
      </HeaderPage>

      <div className="flex flex-1 flex-col h-full overflow-hidden">
        <div className="flex-1 relative">
          {displayedTurns.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-3">
              <h1 className="text-2xl font-studio font-medium">
                {t('common:newSession')}
              </h1>
            </div>
          ) : (
            <Conversation className="absolute inset-0 text-start">
              <ConversationContent
                className={cn('mx-auto w-full md:w-4/5 xl:w-4/6')}
              >
                {uiMessages.map((message, i) => (
                  <MessageItem
                    key={message.id}
                    message={message}
                    isFirstMessage={i === 0}
                    isLastMessage={i === uiMessages.length - 1}
                    status={running ? 'streaming' : 'ready'}
                    reasoningContainerRef={reasoningContainerRef}
                    isReasoningAtBottom={isReasoningAtBottom}
                    onReasoningScroll={handleReasoningScroll}
                    onReasoningScrollToBottom={forceScrollReasoningToBottom}
                  />
                ))}
                {running && <PromptProgress hideIdle stateKey={session?.id} />}
                {stoppedBy === 'steps' && (
                  <CoworkBudgetNotice
                    kind="steps"
                    max={MAX_AGENT_STEPS}
                    onContinue={() => void handleSubmit('Continue.')}
                  />
                )}
                {stoppedBy === 'tokens' && (
                  <CoworkBudgetNotice
                    kind="tokens"
                    onCompact={() => toast.info(t('common:budget.compact'))}
                    onNewSession={() =>
                      useCodeSessions.getState().createSession()
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
            <div className="flex items-center gap-2 px-1 pb-2">
              <CoworkPlanToggle
                planMode={planMode}
                onChange={(next) => {
                  if (session?.id)
                    useCodeSessions.getState().setPlanMode(session.id, next)
                }}
              />
              <CoworkWorkspacePill
                folder={folder}
                sandboxPath={workspacePath}
                gitBranch={gitBranch}
                onAttach={() => void attachFolder()}
                onDetach={detachFolder}
              />
              <CoworkSandboxChip />
              <div className="ml-auto">
                <SkillSelector folder={folder} />
              </div>
            </div>
            {ask && typeof ask.request !== 'string' && (
              <div className="px-1 pb-2">
                <CodeAskCard
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
              onSubmit={handleSubmit}
              onStop={handleStop}
              chatStatus={running ? 'streaming' : 'ready'}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
