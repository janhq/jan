/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from '@tanstack/react-router'
import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { route } from '@/constants/routes'
import { Button } from '@/components/ui/button'
import { useServiceHub } from '@/hooks/useServiceHub'
import { FileDiff, GitBranch, Folder, Sparkles, ListTodo, Eye } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { invoke, Channel } from '@tauri-apps/api/core'
import { cn, getProviderTitle, getModelDisplayName } from '@/lib/utils'
import { predefinedProviders } from '@/constants/providers'
import { providerHasRemoteApiKeys } from '@/lib/provider-api-keys'
import {
  useCodeSessions,
  DEFAULT_CODE_RUN_MODE,
  ensureCurrentSession,
  type CodeTurn,
  type CodeMessage,
  type SubagentRun,
} from '@/hooks/useCodeSessions'
import {
  useCodeRun,
  makeToolCallTurn,
  type StreamEvent,
  type AskAnswer,
  type AskRequestPayload,
} from '@/hooks/useCodeRun'
import { useMessageQueue } from '@/stores/message-queue-store'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { TokenCountOnly } from '@/components/TokenCounter'
import { useModelProvider } from '@/hooks/useModelProvider'
import { usePrompt } from '@/hooks/usePrompt'
import CodePermissionDialog, {
  type PendingPermission,
  type PermissionDecision,
  WIRE,
} from '@/containers/dialogs/CodePermissionDialog'
import { CodeAskCard } from '@/containers/CodeAskCard'
import { MessageItem } from '@/containers/MessageItem'
import SkillSelector from '@/containers/SkillSelector'
import CodeModeSelector from '@/containers/CodeModeSelector'
import { SubagentTasksPanel } from '@/containers/SubagentTasksPanel'
import { CodeDiffPanel } from '@/containers/CodeDiffPanel'
import { CodeTodoPanel } from '@/containers/CodeTodoPanel'
import { CodePreviewPanel } from '@/containers/CodePreviewPanel'
import { CodeArtifactCard } from '@/containers/CodeArtifactCard'
import { ensureCodeModelStarted } from '@/lib/codeModelStartup'
import { artifactsFromParts } from '@/lib/codeArtifacts'
import { codeTurnsToUIMessages } from '@/lib/codeTurns'
import { collectCodeFileDiffs } from '@/lib/codeDiffs'
import { contentLength, hasContent } from '@/lib/codeHistory'
import { useToolCallRuntime } from '@/hooks/useToolCallRuntime'
import { PromptProgress } from '@/components/PromptProgress'
import { useMessageErrors } from '@/stores/message-errors'
import { useToolApprovalRequests } from '@/hooks/useToolApprovalRequests'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export const Route = createFileRoute(route.code as any)({
  component: CodePage,
})

type CodeSidePanelView = 'subagents' | 'diff' | 'todos' | 'preview'


// Per-run token ceiling. `max_turns: 0` lets a multi-step task run to completion;
// this budget is the real bound that stops a runaway loop (see SessionBudget in
// session.rs). Only the *marginal* token increase between requests counts — every
// turn replays the full conversation, so summing absolute totals would grow
// quadratically with context length and cut off a legitimate long task. A real
// runaway (hundreds of turns) still accumulates unbounded marginal spend and trips.
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
const EMPTY_ASKS: { requestId: string; request: AskRequestPayload }[] = []

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
    budget -= contentLength(messages[i].content)
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
    if (!hasContent(m)) continue
    // The template also requires the conversation to START with user; drop any
    // leading assistant message (e.g. after aggressive trimming).
    if (out.length === 0 && m.role !== 'user') continue
    const last = out[out.length - 1]
    if (
      last &&
      last.role === m.role &&
      typeof last.content === 'string' &&
      typeof m.content === 'string'
    ) {
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
  { name: '/compact', descKey: 'common:cmdCompact', mode: 'run' },
  { name: '/goal', descKey: 'common:cmdGoal', mode: 'args' },
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
  const mode = current?.mode ?? DEFAULT_CODE_RUN_MODE
  const [gitBranch, setGitBranch] = useState<string | null>(null)

  // Fetch git branch when the folder changes.
  useEffect(() => {
    if (!folder) {
      setGitBranch(null)
      return
    }
    setGitBranch(null)
    invoke<string | null>('agent_git_branch', { project: folder })
      .then(setGitBranch)
      .catch(() => setGitBranch(null))
  }, [folder])

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
  const [activePanel, setActivePanel] = useState<CodeSidePanelView | null>(null)
  // Lifted so a transcript artifact card can open a specific file in the pane.
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const openPreview = (path: string) => {
    setPreviewPath(path)
    setActivePanel('preview')
  }

  // The artifacts library hands us a file to show when it navigates here.
  const pendingPreview = useCodeRun((s) => s.pendingPreview)
  useEffect(() => {
    if (!pendingPreview || pendingPreview.sessionId !== currentId) return
    setPreviewPath(pendingPreview.path)
    setActivePanel('preview')
    useCodeRun.getState().clearPendingPreview()
  }, [pendingPreview, currentId])
  const togglePanel = (view: CodeSidePanelView) =>
    setActivePanel((current) => (current === view ? null : view))

  // Local (llamacpp) models can take a while to load before the first token.
  // The router emits `llamacpp-model-load-progress`, which LlamacppOomListener
  // forwards into this session's own slot of useCodeRun's per-session load
  // state (keyed by session id, mirroring — but not sharing — the per-thread
  // Records chat uses; see useCodeRun.loadingModels for why) — so a session
  // loading in the background never shows on whichever session is currently
  // being viewed. Cleared once generation starts or the run ends (`finally`,
  // below).
  const finishModelLoad = (sid: string) => {
    if (!useCodeRun.getState().loadingModels[sid]) return
    useCodeRun.getState().setSessionLoadingModel(sid, false)
    useCodeRun.getState().setSessionModelLoadProgress(sid, undefined)
  }

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
    if (currentId) useCodeRun.getState().removePendingPerm(currentId, requestId)
    // The modal and the inline tool-card approval (`ToolApprovalActions`)
    // both resolve the same request; whichever fires first wins. Drop the
    // other's pending entry so its buttons don't linger on a decided call.
    const toolCallId = pendingPerms.find((p) => p.requestId === requestId)?.toolCallId
    if (toolCallId) {
      useToolApprovalRequests.setState((s) => {
        const next = { ...s.pending }
        delete next[toolCallId]
        return { pending: next }
      })
    }
  }

  // In-flight `ask` tool questions for the VIEWED session, same one-at-a-time
  // shape as pendingPerms.
  const pendingAsks = useCodeRun((s) =>
    currentId ? (s.pendingAsks[currentId] ?? EMPTY_ASKS) : EMPTY_ASKS
  )

  const respondAsk = (requestId: string, answers: AskAnswer[] | null) => {
    invoke('agent_ask_respond', { requestId, answers }).catch(() => {})
    if (currentId) useCodeRun.getState().removePendingAsk(currentId, requestId)
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
  const codeDiffs = useMemo(
    () => collectCodeFileDiffs(displayedTurns, subagents),
    [displayedTurns, subagents]
  )
  // Committed turns are stable during a run; only the live tail changes per
  // token. Memoize them separately so streaming rebuilds just the small tail,
  // not the whole transcript. Distinct id prefixes keep React keys unique.
  const committedMessages = useMemo(
    () => codeTurnsToUIMessages(current?.turns ?? [], 'c'),
    [current?.turns]
  )
  // Sessions persist their diffs, but the runtime diff store is transient, so
  // reopening a session would otherwise render its write/edit cards with no
  // diff at all.
  useEffect(() => {
    const { recordDiff } = useToolCallRuntime.getState()
    for (const turn of current?.turns ?? []) {
      if (turn.callId && turn.diff) recordDiff(turn.callId, turn.diff)
    }
  }, [current?.turns])
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
        if (running) {
          toast.error(t('common:cmdBusy'))
          break
        }
        if (currentId) {
          useCodeSessions.getState().clearSession(currentId)
          useCodeRun.getState().clearCodeRun(currentId)
        }
        break
      case '/compact': {
        if (running) {
          toast.error(t('common:cmdBusy'))
          break
        }
        if (!currentId || !selectedModel?.id) {
          toast.error(t('common:selectModel'))
          break
        }
        const session = useCodeSessions
          .getState()
          .sessions.find((s) => s.id === currentId)
        const before = session?.history.length ?? 0
        invoke<CodeMessage[]>('agent_compact', {
          modelId: selectedModel.id,
          messages: session?.history ?? [],
        })
          .then((compacted) => {
            if (compacted.length < before) {
              useCodeSessions.getState().setHistory(currentId, compacted)
              toast.success(
                t('common:cmdCompacted', {
                  before,
                  after: compacted.length,
                })
              )
            } else {
              toast(t('common:cmdNothingToCompact'))
            }
          })
          .catch((e) =>
            toast.error(t('common:cmdCompactFailed', { error: String(e) }))
          )
        break
      }
      case '/goal': {
        if (!currentId) break
        const goal = useCodeSessions
          .getState()
          .sessions.find((s) => s.id === currentId)?.goal
        const condition = arg.trim()
        if (condition === 'clear') {
          useCodeSessions.getState().setGoal(currentId, null)
          toast(goal ? t('common:cmdGoalCleared') : t('common:cmdGoalNone'))
          break
        }
        if (!condition) {
          if (!goal) {
            toast(t('common:cmdGoalNone'))
          } else {
            toast(
              t('common:cmdGoalStatus', {
                status: goal.status,
                condition: goal.condition,
                turns: goal.turns,
                reason: goal.lastReason || '—',
              })
            )
          }
          break
        }
        if (condition.length > 4096) {
          toast.error(t('common:cmdGoalTooLong'))
          break
        }
        // Mirror the TUI's `set_goal` (tui.rs): setting a goal both arms it and
        // immediately starts the first turn with the condition as the prompt.
        // Gate on the same preconditions a real run needs so the "Goal set"
        // toast never lies about work that can't actually start.
        if (running) {
          toast.error(t('common:cmdBusy'))
          break
        }
        if (!current?.folder) {
          toast.error(t('common:selectFolder'))
          break
        }
        if (!selectedModel?.id) {
          toast.error(t('common:selectModel'))
          break
        }
        useCodeSessions.getState().setGoal(currentId, {
          condition,
          turns: 0,
          status: 'active',
          lastReason: '',
        })
        toast.success(t('common:cmdGoalSet', { condition }))
        // The condition is the first prompt; on_done triggers the evaluator,
        // which drives auto-continuation from there (see the goal block after
        // agent_run below).
        submitTurn(condition, currentId).catch((err) => {
          console.error('Failed to start goal turn:', err)
        })
        break
      }
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
  const submitTurn = async (
    text: string,
    sid: string,
    files?: Array<{ type: string; mediaType: string; url: string }>
  ) => {
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
    const images = (files ?? [])
      .filter((f) => f.mediaType.startsWith('image/'))
      .map((f) => f.url)
    const content: CodeMessage['content'] =
      images.length > 0
        ? [
            { type: 'text' as const, text },
            ...images.map((url) => ({
              type: 'image_url' as const,
              image_url: { url },
            })),
          ]
        : text
    const outgoing: CodeMessage[] = normalizeAlternating([
      ...capHistory(session.history),
      { role: 'user', content },
    ])

    const runId = crypto.randomUUID()
    run.beginRun(sid, runId, text, images.length > 0 ? images : undefined)
    // Clear any stale failure banner from a prior run in this session — a new
    // submit means the user is moving past whatever previously failed.
    codeTurnsToUIMessages(session.turns, 'c')
      .filter((m) => m.role === 'assistant')
      .forEach((m) => useMessageErrors.getState().clearError(m.id))

    // Tracked for this run's whole duration (not just the cold-load window
    // below), so the global OOM/backend-error listener can attribute a
    // router-level failure to this session even if it happens mid-generation
    // rather than mid-load — cleared in `finally`.
    if (selectedProvider === 'llamacpp') {
      run.setLlamacppRun(sid, selectedModel.id)

      // Local models load before the first token — but only on a cold start.
      // Probe the router (as the chat transport does) so the load card shows
      // only when the model isn't already loaded, not on every warm run.
      try {
        const loaded = await invoke<string[]>('plugin:llamacpp|get_loaded_models')
        if (!loaded.includes(selectedModel.id)) {
          run.setSessionModelLoadProgress(sid, undefined)
          run.setSessionLoadingModel(sid, true)
        }
      } catch {
        // Probe failed; skip the load card rather than flash it every run.
      }
    }

    // Captured across the stream + catch so a failed run leaves a visible marker
    // in the transcript (not just a transient toast).
    let runError: string | null = null

    // If the backend compacted the conversation mid-run (context overflow), it
    // emits `messages_updated` with the shortened array. Persist THAT as the
    // session history for the next turn — otherwise we'd re-send the full,
    // pre-compaction history and immediately re-overflow (mirrors the TUI, which
    // replaces app.history on this event).
    let compactedHistory: CodeMessage[] | null = null

    // subagentRunId is set when this request came from inside a subagent's
    // wrapped stream, so the tasks panel can flag that run as needing input.
    const addPerm = (
      ev: Extract<StreamEvent, { type: 'permission_request' }>,
      subagentRunId?: string
    ) => {
      run.addPendingPerm(sid, {
        requestId: ev.request_id,
        toolCallId: ev.tool_call_id,
        toolName: ev.tool_name,
        capability: ev.capability,
        path: ev.path,
        command: ev.command,
        diff: ev.diff,
        promptKind: ev.prompt_kind,
        offersAlways: ev.offers_always,
        subagentRunId,
      })
      // Also register with the shared tool-approval store keyed by
      // tool_call_id, so `ToolApprovalActions` (rendered inline on the
      // matching tool card by `MessageItem`, same component the regular
      // chat uses) shows Allow/Deny buttons there too — the modal
      // (`CodePermissionDialog`) stays as the primary surface (has
      // command/diff/path detail the compact inline card doesn't); either
      // resolving the same `requestId` via `respondPermission`.
      if (ev.tool_call_id) {
        useToolApprovalRequests
          .getState()
          .registerPending(ev.tool_call_id, ev.tool_name, sid, (decision) =>
            respondPermission(ev.request_id, WIRE[decision])
          )
      }
    }

    // Every write targets `sid` — the session that OWNS this run — never the
    // viewed session, so a background session keeps updating while another is
    // viewed. Recurses for the event wrapped inside a 'subagent' event.
    const handleEvent = (ev: StreamEvent) => {
      switch (ev.type) {
        case 'token':
          // First output means the model finished loading; drop the load card.
          finishModelLoad(sid)
          run.appendToken(sid, ev.text)
          break
        case 'tool_call':
          finishModelLoad(sid)
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
          // Kept out of the turn's output text so the model never sees it and
          // the widget's output parsing stays intact.
          if (ev.diff) {
            useToolCallRuntime.getState().recordDiff(ev.id, ev.diff)
          }
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
        case 'messages_updated':
          // Drop the core's tool-call turns here so they never reach the store:
          // `CodeMessage` has no `tool_calls`, so all that survives is an
          // assistant entry with null content.
          compactedHistory = ev.messages.filter(hasContent)
          break
        case 'todo_update':
          useCodeSessions.getState().setTodos(sid, ev.list)
          break
        case 'ask_request':
          run.addPendingAsk(sid, ev.request_id, ev.request)
          break
        case 'subagent_start':
          run.startSubagent(sid, ev.run_id, ev.name)
          break
        case 'subagent_end':
          run.endSubagent(sid, ev.run_id, ev.usage)
          break
        case 'subagent': {
          finishModelLoad(sid)
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
      if (selectedProvider === 'llamacpp' || selectedProvider === 'mlx') {
        const provider = providers.find((p) => p.provider === selectedProvider)
        await ensureCodeModelStarted(serviceHub.models(), provider, selectedModel.id)
      }

      await invoke('agent_run', {
        runId,
        onEvent,
        body: {
          project: session.folder,
          messages: outgoing,
          max_turns: 0,
          max_session_tokens: MAX_SESSION_TOKENS,
          model: selectedModel.id,
          auto_approve: (session.mode ?? DEFAULT_CODE_RUN_MODE) === 'yolo',
          plan: (session.mode ?? DEFAULT_CODE_RUN_MODE) === 'plan',
          todos: session.todos ?? { phases: [] },
        },
      })
    } catch (e) {
      runError = String(e)
      toast.error(String(e))
    } finally {
      // The run is over either way — stop attributing future router events
      // (load-progress, OOM, backend-error) to this dead session.
      run.clearLlamacppRun(sid)
      // A cancel the OOM/backend-error listener triggered on this run reports
      // as a clean 'cancelled' StreamEvent (ignored above, so runError is
      // still null) with a friendlier message waiting here instead — that
      // message wins over whatever the stream itself reported, including
      // nothing at all.
      const pendingLlamacppMessage = run.takePendingLlamacppError(sid)
      if (pendingLlamacppMessage) {
        runError = pendingLlamacppMessage
        toast.error(pendingLlamacppMessage)
      }
      // Drop the load card if the run ended before any stream event.
      finishModelLoad(sid)
      // Finalize interrupted tool turns + subagents, append an error turn if the
      // run failed — all keyed to `sid`. Commit the result onto the session so
      // it survives a session switch and app restart, then drop the transient
      // run state.
      const { turns: finalTurns, subagents: finalSubs } = run.finalizeRun(sid)
      useToolApprovalRequests.getState().clearPendingForThread(sid)
      const finalUsage = useCodeRun.getState().usage[sid]
      const assistantText = finalTurns
        .filter((tn) => tn.role === 'assistant')
        .map((tn) => tn.content)
        .join('\n')
      // Base history: the backend's compacted array if it compacted mid-run,
      // else the messages we sent. Appending the assistant reply to the
      // compacted base keeps the next turn from re-sending the pre-compaction
      // history.
      const base = compactedHistory ?? outgoing
      const history: CodeMessage[] = assistantText
        ? [...base, { role: 'assistant', content: assistantText }]
        : base
      useCodeSessions
        .getState()
        .commitTurns(sid, finalTurns, history, finalSubs, finalUsage)
      run.clearCodeRun(sid)

      // Run-level failure -> standard "Generation failed" banner (with
      // Regenerate) on the turn's assistant message, matching Home UI —
      // instead of a tool-error card (see codeTurns.ts for id scheme: 'c'
      // prefix once committed, matching how `committedMessages` renders it).
      // A run that failed before any assistant content arrived (e.g. a local
      // model that OOMs on load) has no assistant message to attach to —
      // fall back to whatever the last message actually is (the user's own)
      // rather than silently dropping the error. MessageItem's banner has no
      // role restriction, and `onRegenerate` already re-sends the last user
      // turn, so this reads correctly either way.
      if (runError) {
        const committed = codeTurnsToUIMessages(finalTurns, 'c')
        const lastAssistant = [...committed]
          .reverse()
          .find((m) => m.role === 'assistant')
        const target = lastAssistant ?? committed[committed.length - 1]
        if (target) {
          useMessageErrors.getState().setError(target.id, runError)
        }
      }

      // `/goal`: after a successful turn, check whether the active goal's
      // condition is met (mirrors the TUI's in-loop evaluator, goal.rs). Runs
      // before the message-queue dequeue below so an auto-continuation
      // doesn't race a queued user message for the same session.
      const activeGoal = useCodeSessions
        .getState()
        .sessions.find((s) => s.id === sid)?.goal
      let goalContinuation: string | null = null
      if (!runError && activeGoal?.status === 'active' && selectedModel?.id) {
        const turns = activeGoal.turns + 1
        try {
          const verdict = await invoke<{ met: boolean; reason: string }>(
            'agent_goal_evaluate',
            {
              smolModelId: selectedModel.id,
              condition: activeGoal.condition,
              messages: history,
            }
          )
          useCodeSessions.getState().setGoal(sid, {
            ...activeGoal,
            turns,
            status: verdict.met ? 'achieved' : 'active',
            lastReason: verdict.reason,
          })
          if (verdict.met) {
            toast.success(
              t('common:cmdGoalStatus', {
                status: 'achieved',
                condition: activeGoal.condition,
                turns,
                reason: verdict.reason,
              })
            )
          } else {
            goalContinuation = `Continue working toward this goal: ${activeGoal.condition}\n\nThe goal is not yet met: ${verdict.reason}`
          }
        } catch {
          // Evaluator call failed (model unavailable, etc.) — leave the goal
          // active and let the user retry or /goal clear rather than looping
          // forever on a broken evaluator.
          useCodeSessions.getState().setGoal(sid, { ...activeGoal, turns })
        }
      }

      // Message queue: send the next queued message now that this session's
      // run is done. A failed run discards anything queued instead, mirroring
      // the general chat (errors mean the conversation needs attention, not
      // more unattended sends). An unmet goal takes priority over the queue,
      // same as the TUI driving its own next turn before user input.
      if (runError) {
        useMessageQueue.getState().clearQueue(sid)
      } else if (goalContinuation) {
        submitTurn(goalContinuation, sid).catch((err) => {
          console.error('Failed to continue toward goal:', err)
        })
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

  const handleSubmit = (
    text: string,
    files?: Array<{ type: string; mediaType: string; url: string }>
  ) => submitTurn(text, ensureCurrentSession(), files)

  const handleStop = () => {
    const rid = currentId ? useCodeRun.getState().runId[currentId] : undefined
    if (rid) invoke('agent_cancel', { runId: rid }).catch(() => {})
  }

  // Regenerate: re-send the last user turn as a new run. Code UI's transcript
  // is a flat append-only log (no branching), so "regenerate" retries rather
  // than replacing in place — same net effect for the common "run failed,
  // try again" case the banner exists for.
  const handleRegenerate = () => {
    if (!currentId) return
    const lastUser = [...(current?.turns ?? [])]
      .reverse()
      .find((tn) => tn.role === 'user')
    if (lastUser) submitTurn(lastUser.content, currentId)
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


  return (
    <div className="flex flex-col h-[calc(100dvh-(env(safe-area-inset-bottom)+env(safe-area-inset-top)))]">
      <HeaderPage>
        <div className="flex items-center justify-between w-full gap-2 pr-2">
          <DropdownModelProvider useLastUsedModel />
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            {current?.goal && (
              <span
                className="text-xs text-muted-foreground truncate max-w-[40%]"
                title={current.goal.condition}
              >
                {current.goal.status === 'achieved' ? '✓' : '◎'}{' '}
                {current.goal.condition}
              </span>
            )}
            <div className="relative z-30 flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={activePanel === 'todos' ? 'secondary' : 'ghost'}
                    size="icon-sm"
                    onClick={() => togglePanel('todos')}
                    aria-label={t('common:todoPanelTitle')}
                  >
                    <ListTodo size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('common:todoPanelTitle')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={activePanel === 'subagents' ? 'secondary' : 'ghost'}
                    size="icon-sm"
                    onClick={() => togglePanel('subagents')}
                    aria-label="Subagents"
                  >
                    <Sparkles size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Subagents</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={activePanel === 'preview' ? 'secondary' : 'ghost'}
                    size="icon-sm"
                    onClick={() => togglePanel('preview')}
                    aria-label={t('common:previewPanelTitle')}
                  >
                    <Eye size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('common:previewPanelTitle')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={activePanel === 'diff' ? 'secondary' : 'ghost'}
                    size="icon-sm"
                    onClick={() => togglePanel('diff')}
                    aria-label="Diff"
                  >
                    <FileDiff size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Diff</TooltipContent>
              </Tooltip>
            </div>
          </div>
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
                    <div key={message.id}>
                      <MessageItem
                        message={message}
                        isFirstMessage={i === 0}
                        isLastMessage={i === uiMessages.length - 1}
                        status={running ? 'streaming' : 'ready'}
                        reasoningContainerRef={reasoningContainerRef}
                        isReasoningAtBottom={isReasoningAtBottom}
                        onReasoningScroll={handleReasoningScroll}
                        onReasoningScrollToBottom={forceScrollReasoningToBottom}
                        onRegenerate={handleRegenerate}
                        subagents={subagents}
                      />
                      {/* Derived from this message's own write/edit parts, so
                          MessageItem (shared with chat) stays artifact-unaware. */}
                      {artifactsFromParts(message.parts).map((artifact) => (
                        <CodeArtifactCard
                          key={artifact.path}
                          artifact={artifact}
                          root={folder}
                          onPreview={openPreview}
                        />
                      ))}
                    </div>
                  ))}
                  {/* Mirrors the regular chat's own gate ($threadId.tsx): show the
                      shared card, unsuppressed, only before this turn's first
                      visible content has arrived. beginRun seeds liveTurns with
                      the user's own turn, so "nothing yet" is length <= 1, not
                      0 — once anything beyond that turn shows up, that content
                      is itself the "it's working" signal. stateKey scopes the
                      card to the viewed session, matching chat's per-thread
                      isolation (see PromptProgress). */}
                  {running && liveTurns.length <= 1 && (
                    <PromptProgress stateKey={currentId ?? undefined} />
                  )}
                </ConversationContent>
                <ConversationScrollButton />
              </Conversation>
            )}
          </div>

        {/* Fixed input dock at the bottom. */}
        <div className="pb-4 shrink-0">
          <div className="mx-auto w-full md:w-4/5 xl:w-4/6">
            <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
              <CodeModeSelector
                mode={mode}
                onChange={(m) => {
                  const sid = currentId ?? ensureCurrentSession()
                  useCodeSessions.getState().setMode(sid, m)
                }}
              />
              <div className="flex items-center gap-1 min-w-0 max-w-[460px]">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 rounded-full shrink-0"
                  onClick={handleSelectFolder}
                  title={folder ?? t('common:selectFolder')}
                >
                  <Folder size={14} className="text-muted-foreground shrink-0" />
                  <span className="truncate max-w-[140px]">
                    {folderName ?? t('common:selectFolder')}
                  </span>
                </Button>
                {folder && (
                  <span className="text-xs text-muted-foreground truncate" title={folder}>
                    {folder}
                  </span>
                )}
                {gitBranch && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground shrink-0">
                    <GitBranch size={10} />
                    {gitBranch}
                  </span>
                )}
              </div>
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
            {/* Docked above the input, not modal: the run is paused, but the
                user can still read the transcript and reply in prose instead. */}
            <CodeAskCard
              requestId={pendingAsks[0]?.requestId ?? null}
              request={pendingAsks[0]?.request ?? null}
              onRespond={respondAsk}
            />
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
                scopeKey={currentId ?? undefined}
              />
              </div>
            </div>
        </div>
      </div>
        {activePanel === 'subagents' ? (
          <SubagentTasksPanel
            subagents={subagents}
            awaitingInputRunIds={awaitingInputRunIds}
            onClose={() => setActivePanel(null)}
            onCancel={handleCancelSubagent}
          />
        ) : activePanel === 'diff' ? (
          <CodeDiffPanel
            files={codeDiffs}
            folderName={folderName}
            gitBranch={gitBranch}
            onClose={() => setActivePanel(null)}
          />
        ) : activePanel === 'todos' ? (
          <CodeTodoPanel todos={current?.todos} onClose={() => setActivePanel(null)} />
        ) : activePanel === 'preview' ? (
          <CodePreviewPanel
            files={codeDiffs.map((d) => d.path)}
            root={folder}
            selectedPath={previewPath}
            onSelect={setPreviewPath}
            onClose={() => setActivePanel(null)}
          />
        ) : null}
      </div>

      <CodePermissionDialog
        request={pendingPerms[0] ?? null}
        onRespond={respondPermission}
      />
    </div>
  )
}
