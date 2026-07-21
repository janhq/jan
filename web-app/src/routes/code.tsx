/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from '@tanstack/react-router'
import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { route } from '@/constants/routes'
import { Button } from '@/components/ui/button'
import { useServiceHub } from '@/hooks/useServiceHub'
import { Folder, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { invoke, Channel } from '@tauri-apps/api/core'
import { cn, getProviderTitle, getModelDisplayName } from '@/lib/utils'
import { predefinedProviders } from '@/constants/providers'
import { providerHasRemoteApiKeys } from '@/lib/provider-api-keys'
import {
  useCodeSessions,
  ensureCurrentSession,
  type CodeTurn,
  type CodeMessage,
  type SubagentRun,
} from '@/hooks/useCodeSessions'
import { useCodeRun, makeToolCallTurn, type StreamEvent } from '@/hooks/useCodeRun'
import { useMessageQueue } from '@/stores/message-queue-store'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { TokenCountOnly } from '@/components/TokenCounter'
import { useModelProvider } from '@/hooks/useModelProvider'
import { usePrompt } from '@/hooks/usePrompt'
import CodePermissionDialog, {
  type PendingPermission,
  type PermissionDecision,
} from '@/containers/dialogs/CodePermissionDialog'
import { MessageItem } from '@/containers/MessageItem'
import SkillSelector from '@/containers/SkillSelector'
import CodeModeSelector from '@/containers/CodeModeSelector'
import { SubagentTasksPanel } from '@/containers/SubagentTasksPanel'
import { codeTurnsToUIMessages } from '@/lib/codeTurns'
import { PromptProgress } from '@/components/PromptProgress'
import { useAppState } from '@/hooks/useAppState'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'

export const Route = createFileRoute(route.code as any)({
  component: CodePage,
})

// Per-run token ceiling. `max_turns: 0` lets a multi-step task run to completion;
// this budget is the real bound that stops a runaway loop (see loop.rs).
const MAX_SESSION_TOKENS = 200_000

// Cap the history replayed to the agent so a long session never sends more than
// the model can take (rough ~4 chars/token estimate → well under the ceiling).
// Keeps the most recent messages; older ones roll off. Display keeps everything.
const MAX_HISTORY_CHARS = 400_000

// Stable empty defaults for the per-session selectors below — returning a fresh
// `[]` from a zustand selector would change identity every render and loop.
const EMPTY_TURNS: CodeTurn[] = []
const EMPTY_SUBAGENTS: SubagentRun[] = []
const EMPTY_PERMS: PendingPermission[] = []

// Safe `run_id` extraction from an await_subagent tool call's parsed args.
const argRunId = (args: unknown): string | undefined => {
  if (args && typeof args === 'object' && 'run_id' in args) {
    const v = (args as Record<string, unknown>).run_id
    return typeof v === 'string' ? v : undefined
  }
  return undefined
}

function capHistory(messages: CodeMessage[]): CodeMessage[] {
  let budget = MAX_HISTORY_CHARS
  const kept: CodeMessage[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    budget -= messages[i].content.length
    if (budget < 0 && kept.length > 0) break
    kept.unshift(messages[i])
  }
  return kept
}

// Strict chat templates (llama.cpp Jinja) require strictly alternating
// user/assistant roles and reject empty content. Drop empties and merge
// consecutive same-role messages so a turn that produced no assistant text
// (tool-only / cancelled / errored) can't leave two user messages adjacent.
const normalizeAlternating = (messages: CodeMessage[]): CodeMessage[] => {
  const out: CodeMessage[] = []
  for (const m of messages) {
    if (!m.content.trim()) continue
    // The template also requires the conversation to START with user; drop any
    // leading assistant message (e.g. after aggressive trimming).
    if (out.length === 0 && m.role !== 'user') continue
    const last = out[out.length - 1]
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`
    } else {
      out.push({ role: m.role, content: m.content })
    }
  }
  return out
}

// Slash commands available from the input. Client-side actions — they never hit
// the agent. `descKey` is an i18n key resolved at render time. mode 'run'
// executes immediately; 'args' fills the input so the user can pick an argument
// (e.g. /models → model picker).
const SLASH_COMMANDS = [
  { name: '/help', descKey: 'common:cmdHelp', mode: 'run' },
  { name: '/clear', descKey: 'common:cmdClear', mode: 'run' },
  { name: '/models', descKey: 'common:cmdModels', mode: 'args' },
] as const

// A row in the slash menu — commands and model options share one shape so the
// keyboard navigation works uniformly across both.
type MenuItem = {
  key: string
  label: string
  description: string
  onSelect: () => void
}

function CodePage() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()

  const sessions = useCodeSessions((s) => s.sessions)
  const currentId = useCodeSessions((s) => s.currentId)
  const current = sessions.find((s) => s.id === currentId)
  const selectedModel = useModelProvider((s) => s.selectedModel)
  const selectedProvider = useModelProvider((s) => s.selectedProvider)
  const providers = useModelProvider((s) => s.providers)

  const folder = current?.folder ?? null
  const folderName = folder ? folder.split(/[/\\]/).pop() : undefined
  const mode = current?.mode ?? 'normal'

  // Per-session run state (transient, keyed by session id — see useCodeRun).
  // Reads here are for the VIEWED session (currentId); during a run, writes
  // target the session id captured at submit, so a background session keeps
  // updating while another is viewed.
  const running = useCodeRun((s) =>
    currentId ? s.runId[currentId] != null : false
  )
  const liveTurns = useCodeRun((s) =>
    currentId ? (s.liveTurns[currentId] ?? EMPTY_TURNS) : EMPTY_TURNS
  )
  const liveSubagents = useCodeRun((s) =>
    currentId ? (s.subagents[currentId] ?? EMPTY_SUBAGENTS) : EMPTY_SUBAGENTS
  )
  // While running, the live map only holds THIS turn's subagents (it starts
  // fresh each run) — merge in the committed set from earlier turns so a
  // second turn's new dispatches don't make the first turn's finished ones
  // disappear from the panel. Once idle, the committed snapshot alone is
  // authoritative (survives session switch + restart).
  const committedSubagents = current?.subagents ?? EMPTY_SUBAGENTS
  const subagents = useMemo(() => {
    if (!running) return committedSubagents
    const liveIds = new Set(liveSubagents.map((r) => r.runId))
    return [
      ...committedSubagents.filter((r) => !liveIds.has(r.runId)),
      ...liveSubagents,
    ]
  }, [running, committedSubagents, liveSubagents])
  const liveUsage = useCodeRun((s) =>
    currentId ? s.usage[currentId] : undefined
  )
  // Same live-vs-committed split as subagents: while running, the number can
  // still bump on later turns; once idle, show what actually got persisted.
  const usage = running ? liveUsage : current?.lastUsage
  const [tasksPanelOpen, setTasksPanelOpen] = useState(false)

  // Local (llamacpp) models can take a while to load before the first token.
  // The router emits `llamacpp-model-load-progress`, which LlamacppOomListener
  // pipes into the global useAppState load state; we just flip `loadingModel`
  // (the flag PromptProgress keys off) on for the code run so the shared
  // progress card shows here too. Cleared once generation starts or the run ends.
  const modelLoadingRef = useRef(false)
  const finishModelLoad = () => {
    if (!modelLoadingRef.current) return
    modelLoadingRef.current = false
    useAppState.getState().updateLoadingModel(false)
    useAppState.getState().updateModelLoadProgress(undefined)
  }
  // Clear the shared load flag if the user navigates away mid-load.
  useEffect(() => finishModelLoad, [])

  // Same auto-scroll wiring the chat route uses, so the streaming reasoning
  // block scrolls and shows the scroll-to-bottom button identically here.
  const {
    containerRef: reasoningContainerRef,
    isAtBottom: isReasoningAtBottom,
    handleScroll: handleReasoningScroll,
    forceScrollToBottom: forceScrollReasoningToBottom,
  } = useAutoScroll()

  // Gated tool calls awaiting approval, for the VIEWED session. The agent loop
  // awaits one at a time; the head is shown in the approval dialog.
  const pendingPerms = useCodeRun((s) =>
    currentId ? (s.pendingPerms[currentId] ?? EMPTY_PERMS) : EMPTY_PERMS
  )

  const respondPermission = (requestId: string, decision: PermissionDecision) => {
    invoke('agent_permission_respond', { requestId, decision }).catch(() => {})
    if (currentId)
      useCodeRun.getState().removePendingPerm(currentId, requestId)
  }

  // Subagents (of the viewed session) currently blocked on a permission
  // prompt — the tasks panel shows these as "needs input" instead of "running".
  const awaitingInputRunIds = useMemo(
    () =>
      new Set(
        pendingPerms
          .map((p) => p.subagentRunId)
          .filter((id): id is string => id != null)
      ),
    [pendingPerms]
  )

  const displayedTurns: CodeTurn[] = useMemo(
    () => [...(current?.turns ?? []), ...liveTurns],
    [current?.turns, liveTurns]
  )
  // Committed turns are stable during a run; only the live tail changes per
  // token. Memoize them separately so streaming rebuilds just the small tail,
  // not the whole transcript. Distinct id prefixes keep React keys unique.
  const committedMessages = useMemo(
    () => codeTurnsToUIMessages(current?.turns ?? [], 'c'),
    [current?.turns]
  )
  const liveMessages = useMemo(
    () => codeTurnsToUIMessages(liveTurns, 'l'),
    [liveTurns]
  )
  const uiMessages = useMemo(
    () => [...committedMessages, ...liveMessages],
    [committedMessages, liveMessages]
  )

  // Slash commands: the input text lives in the shared usePrompt store, so we can
  // drive the menu (and keyboard nav) without touching ChatInput.
  const prompt = usePrompt((s) => s.prompt)
  const [menuIndex, setMenuIndex] = useState(0)

  // Switchable models for /models — mirrors DropdownModelProvider's filtering:
  // active providers only, no embedding models, and skip remote providers that
  // have no API key configured (they can't actually be used).
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
        if (m.embedding) return
        items.push({
          providerName: p.provider,
          id: m.id,
          label: getModelDisplayName(m),
        })
      })
    })
    return items
  }, [providers])

  const runCommand = (raw: string) => {
    const parts = raw.trim().split(/\s+/)
    const name = parts[0]
    const arg = parts.slice(1).join(' ')
    switch (name) {
      case '/help':
        toast(t('common:commands'), {
          description: SLASH_COMMANDS.map(
            (c) => `${c.name} — ${t(c.descKey)}`
          ).join('\n'),
        })
        break
      case '/clear':
        // Clearing mid-run would wipe the session the in-flight run is about to
        // commit its transcript into, leaving it inconsistent.
        if (currentId && useCodeRun.getState().runId[currentId] != null) {
          toast.error(t('common:cmdBusy'))
          break
        }
        if (currentId) {
          useCodeSessions.getState().clearSession(currentId)
          useCodeRun.getState().clearCodeRun(currentId)
        }
        break
      case '/models': {
        const q = arg.toLowerCase()
        const found = allModels.find(
          (m) => m.id.toLowerCase() === q || m.label.toLowerCase() === q
        )
        if (found) switchModel(found.providerName, found.id)
        else toast(t('common:cmdModelsHint'))
        break
      }
      default:
        toast.error(t('common:cmdUnknown', { name }))
    }
  }

  const switchModel = (providerName: string, modelId: string) => {
    useModelProvider.getState().selectModelProvider(providerName, modelId)
    usePrompt.getState().setPrompt('')
    toast.success(t('common:cmdModelSwitched', { name: modelId }))
  }

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
          onSelect: () =>
            c.mode === 'args'
              ? usePrompt.getState().setPrompt(`${c.name} `)
              : (usePrompt.getState().setPrompt(''), runCommand(c.name)),
        })
      )
    }
    return []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, allModels, t])

  // Reset the highlighted row whenever the menu contents change.
  useEffect(() => setMenuIndex(0), [prompt])

  // Capture-phase keydown so ↑/↓/Enter/Esc drive the menu BEFORE ChatInput's
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

  const handleSelectFolder = async () => {
    const selected = await serviceHub.dialog().open({
      multiple: false,
      directory: true,
      defaultPath: folder ?? undefined,
    })
    if (typeof selected === 'string') {
      const sid = ensureCurrentSession()
      useCodeSessions.getState().setFolder(sid, selected)
    }
  }

  // Takes an explicit sid (never ensureCurrentSession()) so the queue's
  // auto-resend below can target the session whose run just finished even if
  // the user has since switched to viewing a different one.
  const submitTurn = async (text: string, sid: string) => {
    // Slash commands are client-side actions; they never reach the agent.
    if (text.trim().startsWith('/')) {
      runCommand(text)
      return
    }

    const run = useCodeRun.getState()
    // Per-session guard: only block if THIS session is already running. A run in
    // another session no longer locks this one.
    if (run.runId[sid] != null) return

    const store = useCodeSessions.getState()
    const session = store.sessions.find((s) => s.id === sid)
    if (!session?.folder) {
      toast.error(t('common:selectFolder'))
      return
    }
    if (!selectedModel?.id) {
      toast.error(t('common:selectModel'))
      return
    }
    if (session.title === 'New session') {
      store.setTitle(sid, text.slice(0, 40))
    }

    // Mirror the CLI agent: replay the full history each turn (capped only by a
    // coarse sliding window against runaway growth). normalizeAlternating is the
    // one guard the CLI lacks — it keeps roles strictly alternating so a turn
    // that produced no assistant text can't leave two user messages adjacent.
    const outgoing: CodeMessage[] = normalizeAlternating([
      ...capHistory(session.history),
      { role: 'user', content: text },
    ])

    const runId = crypto.randomUUID()
    run.beginRun(sid, runId, text)

    // Local models load before the first token — but only on a cold start.
    // Probe the router (as the chat transport does) so the load card shows only
    // when the model isn't already loaded, not on every warm run.
    if (selectedProvider === 'llamacpp') {
      try {
        const loaded = await invoke<string[]>('plugin:llamacpp|get_loaded_models')
        if (!loaded.includes(selectedModel.id)) {
          modelLoadingRef.current = true
          useAppState.getState().updateModelLoadProgress(undefined)
          useAppState.getState().updateLoadingModel(true)
        }
      } catch {
        // Probe failed; skip the load card rather than flash it every run.
      }
    }

    // Captured across the stream + catch so a failed run leaves a visible marker
    // in the transcript (not just a transient toast).
    let runError: string | null = null

    // subagentRunId is set when this request came from inside a subagent's
    // wrapped stream, so the tasks panel can flag that run as needing input.
    const addPerm = (
      ev: Extract<StreamEvent, { type: 'permission_request' }>,
      subagentRunId?: string
    ) =>
      run.addPendingPerm(sid, {
        requestId: ev.request_id,
        toolName: ev.tool_name,
        capability: ev.capability,
        path: ev.path,
        command: ev.command,
        diff: ev.diff,
        promptKind: ev.prompt_kind,
        offersAlways: ev.offers_always,
        subagentRunId,
      })

    // Every write targets `sid` — the session that OWNS this run — never the
    // viewed session, so a background session keeps updating while another is
    // viewed. Recurses for the event wrapped inside a 'subagent' event.
    const handleEvent = (ev: StreamEvent) => {
      switch (ev.type) {
        case 'token':
          // First output means the model finished loading; drop the load card.
          finishModelLoad()
          run.appendToken(sid, ev.text)
          break
        case 'tool_call':
          finishModelLoad()
          run.pushToolTurn(sid, makeToolCallTurn(ev))
          break
        case 'tool_result': {
          // If this call was an await_subagent, its run_id is already sitting on
          // the tool_call turn's own args — no separate map needed to carry it
          // from tool_call time to tool_result time.
          const turn = (useCodeRun.getState().liveTurns[sid] ?? []).find(
            (tn) => tn.role === 'tool' && tn.callId === ev.id
          )
          if (turn?.name === 'await_subagent') {
            const rid = argRunId(turn.args)
            if (rid) run.attachSubagentOutput(sid, rid, ev.content)
          }
          run.updateToolTurn(sid, ev.id, {
            result: ev.content,
            isError: ev.is_error,
            diff: ev.diff,
            status: 'done',
          })
          break
        }
        case 'permission_request':
          addPerm(ev)
          break
        case 'error':
          if (ev.code !== 'cancelled') {
            runError = ev.message
            toast.error(ev.message)
          }
          break
        case 'done':
          run.setUsage(sid, ev.usage)
          break
        case 'subagent_start':
          run.startSubagent(sid, ev.run_id, ev.name)
          break
        case 'subagent_end':
          run.endSubagent(sid, ev.run_id, ev.usage)
          break
        case 'subagent': {
          finishModelLoad()
          const inner = ev.event
          // A gated tool INSIDE a subagent still needs the approval dialog —
          // otherwise the subagent (and the whole run) hangs on a decision the
          // user is never shown. Everything else goes into the subagent's lane.
          if (inner.type === 'permission_request') {
            addPerm(inner, ev.run_id)
          } else {
            run.startSubagent(sid, ev.run_id, ev.name) // idempotent; guards reordering
            run.routeIntoSubagent(sid, ev.run_id, inner)
          }
          break
        }
      }
    }

    const onEvent = new Channel<StreamEvent>()
    onEvent.onmessage = handleEvent

    try {
      await invoke('agent_run', {
        runId,
        onEvent,
        body: {
          project: session.folder,
          messages: outgoing,
          max_turns: 0,
          max_session_tokens: MAX_SESSION_TOKENS,
          model: selectedModel.id,
          yolo: session.mode === 'yolo',
        },
      })
    } catch (e) {
      runError = String(e)
      toast.error(String(e))
    } finally {
      // Drop the load card if the run ended before any stream event.
      finishModelLoad()
      // Finalize interrupted tool turns + subagents, append an error turn if the
      // run failed — all keyed to `sid`. Commit the result onto the session so
      // it survives a session switch and app restart, then drop the transient
      // run state.
      const { turns: finalTurns, subagents: finalSubs } = run.finalizeRun(
        sid,
        runError
      )
      const finalUsage = useCodeRun.getState().usage[sid]
      const assistantText = finalTurns
        .filter((tn) => tn.role === 'assistant')
        .map((tn) => tn.content)
        .join('\n')
      const history: CodeMessage[] = assistantText
        ? [...outgoing, { role: 'assistant', content: assistantText }]
        : outgoing
      useCodeSessions
        .getState()
        .commitTurns(sid, finalTurns, history, finalSubs, finalUsage)
      run.clearCodeRun(sid)

      // Message queue: send the next queued message now that this session's
      // run is done. A failed run discards anything queued instead, mirroring
      // the general chat (errors mean the conversation needs attention, not
      // more unattended sends).
      if (runError) {
        useMessageQueue.getState().clearQueue(sid)
      } else {
        const next = useMessageQueue.getState().dequeue(sid)
        if (next) {
          submitTurn(next.text, sid).catch((err) => {
            console.error('Failed to send queued message:', err)
          })
        }
      }
    }
  }

  // Matches ChatInput's onSubmit shape (text, files?) — Code UI has no file
  // attachments today, so files is accepted and ignored, not threaded through.
  const handleSubmit = (text: string) => submitTurn(text, ensureCurrentSession())

  const handleStop = () => {
    const rid = currentId ? useCodeRun.getState().runId[currentId] : undefined
    if (rid) invoke('agent_cancel', { runId: rid }).catch(() => {})
  }

  // Cancelling one subagent never gets a real SubagentEnd back (same as when
  // the whole parent run tears down) — mark it done locally right away
  // instead of leaving it stuck showing "running" forever.
  const handleCancelSubagent = (subagentRunId: string) => {
    if (!currentId) return
    const rid = useCodeRun.getState().runId[currentId]
    if (!rid) return
    invoke('agent_cancel_subagent', { runId: rid, subagentRunId }).catch(() => {})
    useCodeRun.getState().endSubagent(currentId, subagentRunId, null)
  }

  const runningSubagentCount = subagents.filter(
    (s) => s.status === 'running'
  ).length

  return (
    <div className="flex flex-col h-[calc(100dvh-(env(safe-area-inset-bottom)+env(safe-area-inset-top)))]">
      <HeaderPage>
        <div className="flex items-center justify-between w-full pr-2">
          <DropdownModelProvider useLastUsedModel />
        </div>
      </HeaderPage>

      <div className="flex flex-1 flex-row h-full overflow-hidden">
        <div className="flex flex-1 flex-col h-full overflow-hidden min-w-0">
          {/* Scroll area fills the remaining space; absolute inset-0 keeps message
              volume from ever pushing the fixed input off-screen. */}
          <div className="flex-1 relative">
            {displayedTurns.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center px-3">
                <h1 className="text-2xl font-studio font-medium">
                  {t('common:newSession')}
                </h1>
              </div>
            ) : (
              <Conversation className="absolute inset-0 text-start">
                <ConversationContent className={cn('mx-auto w-full md:w-4/5 xl:w-4/6')}>
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
                  {/* Mirrors the regular chat's own gate ($threadId.tsx): show the
                      shared card, unsuppressed, only before this turn's first
                      visible content has arrived — once liveTurns has something,
                      that content is itself the "it's working" signal. */}
                  {running && liveTurns.length === 0 && <PromptProgress />}
                </ConversationContent>
                <ConversationScrollButton />
              </Conversation>
            )}
          </div>

          {/* Fixed input dock at the bottom. */}
          <div className="pb-4 shrink-0">
            <div className="mx-auto w-full md:w-4/5 xl:w-4/6">
              <div className="flex items-center gap-2 px-1 pb-2">
                <CodeModeSelector
                  mode={mode}
                  onChange={(m) => {
                    const sid = currentId ?? ensureCurrentSession()
                    useCodeSessions.getState().setMode(sid, m)
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 rounded-full max-w-[220px]"
                  onClick={handleSelectFolder}
                  title={folder ?? undefined}
                >
                  <Folder size={14} className="text-muted-foreground" />
                  <span className="truncate">
                    {folderName ?? t('common:selectFolder')}
                  </span>
                </Button>
                {subagents.length > 0 && (
                  <Button
                    variant={tasksPanelOpen ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 gap-1.5 rounded-full"
                    onClick={() => setTasksPanelOpen((o) => !o)}
                    title={t('common:backgroundTasks')}
                  >
                    <Sparkles size={14} className={tasksPanelOpen ? undefined : 'text-muted-foreground'} />
                    <span>
                      {runningSubagentCount > 0
                        ? `${runningSubagentCount} running`
                        : `${subagents.length} tasks`}
                    </span>
                  </Button>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {usage?.total_tokens ? (
                    <TokenCountOnly
                      totalTokens={usage.total_tokens}
                      inputTokens={usage.prompt_tokens}
                      outputTokens={usage.completion_tokens}
                      modelDisplayName={selectedModel?.name || selectedModel?.id}
                    />
                  ) : null}
                  <SkillSelector folder={folder} />
                </div>
              </div>
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
                        <span className="font-mono font-medium">{item.label}</span>
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
                  onSubmit={handleSubmit}
                  onStop={handleStop}
                  chatStatus={running ? 'streaming' : 'ready'}
                  queueKey={currentId ?? undefined}
                />
              </div>
            </div>
        </div>
      </div>
        {tasksPanelOpen && (
          <SubagentTasksPanel
            subagents={subagents}
            awaitingInputRunIds={awaitingInputRunIds}
            onClose={() => setTasksPanelOpen(false)}
            onCancel={handleCancelSubagent}
          />
        )}
      </div>

      <CodePermissionDialog
        request={pendingPerms[0] ?? null}
        onRespond={respondPermission}
      />
    </div>
  )
}
