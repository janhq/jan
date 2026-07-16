/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from '@tanstack/react-router'
import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { route } from '@/constants/routes'
import { Button } from '@/components/ui/button'
import { useServiceHub } from '@/hooks/useServiceHub'
import { Laptop, Folder } from 'lucide-react'
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
} from '@/hooks/useCodeSessions'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { useModelProvider } from '@/hooks/useModelProvider'
import { usePrompt } from '@/hooks/usePrompt'
import CodePermissionDialog, {
  type PendingPermission,
  type PermissionDecision,
} from '@/containers/dialogs/CodePermissionDialog'
import { MessageItem } from '@/containers/MessageItem'
import SkillSelector from '@/containers/SkillSelector'
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

// StreamEvent shapes emitted by the Rust agent loop (events.rs, tag = "type").
type StreamEvent =
  | { type: 'token'; text: string }
  | { type: 'step'; index: number; max: number }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; content: string; is_error: boolean; diff?: string }
  | { type: 'done'; stop_reason: string; usage: unknown }
  | { type: 'error'; code: string; message: string }
  | {
      type: 'permission_request'
      request_id: string
      tool_name: string
      capability: string
      path?: string
      command?: string
      diff?: string
      prompt_kind: string
      offers_always: boolean
    }

// Per-run token ceiling. `max_turns: 0` lets a multi-step task run to completion;
// this budget is the real bound that stops a runaway loop (see loop.rs).
const MAX_SESSION_TOKENS = 200_000

// Cap the history replayed to the agent so a long session never sends more than
// the model can take (rough ~4 chars/token estimate → well under the ceiling).
// Keeps the most recent messages; older ones roll off. Display keeps everything.
const MAX_HISTORY_CHARS = 400_000

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

  // In-flight transcript for the active run; committed to the store on `done`.
  const [liveTurns, setLiveTurns] = useState<CodeTurn[]>([])
  const [running, setRunning] = useState(false)
  // Mirrors `running` for reads from closures that outlive a render (the slash
  // menu's onSelect is memoized without a `running` dep, so it would otherwise
  // see a stale value).
  const runningRef = useRef(false)
  const liveTurnsRef = useRef<CodeTurn[]>([])
  const runIdRef = useRef<string | null>(null)

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

  // Queue of gated tool calls awaiting the user's approval. The agent loop
  // awaits each one, so in practice there is at most one live at a time, but we
  // queue defensively. The head is shown in the approval dialog.
  const [pendingPerms, setPendingPerms] = useState<PendingPermission[]>([])

  const respondPermission = (requestId: string, decision: PermissionDecision) => {
    invoke('agent_permission_respond', { requestId, decision }).catch(() => {})
    setPendingPerms((prev) => prev.filter((p) => p.requestId !== requestId))
  }

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
        if (runningRef.current) {
          toast.error(t('common:cmdBusy'))
          break
        }
        if (currentId) useCodeSessions.getState().clearSession(currentId)
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

  const pushLive = (turn: CodeTurn) => {
    liveTurnsRef.current = [...liveTurnsRef.current, turn]
    setLiveTurns(liveTurnsRef.current)
  }

  const appendToken = (text: string) => {
    const arr = liveTurnsRef.current
    const last = arr[arr.length - 1]
    if (last && last.role === 'assistant') {
      liveTurnsRef.current = [
        ...arr.slice(0, -1),
        { ...last, content: last.content + text },
      ]
    } else {
      liveTurnsRef.current = [...arr, { role: 'assistant', content: text }]
    }
    setLiveTurns(liveTurnsRef.current)
  }

  // Merge a `tool_result` into the tool turn its `tool_call` created.
  const updateToolTurn = (callId: string, patch: Partial<CodeTurn>) => {
    const arr = liveTurnsRef.current
    const idx = arr.findIndex((tn) => tn.role === 'tool' && tn.callId === callId)
    if (idx === -1) return
    liveTurnsRef.current = [
      ...arr.slice(0, idx),
      { ...arr[idx], ...patch },
      ...arr.slice(idx + 1),
    ]
    setLiveTurns(liveTurnsRef.current)
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

  const handleSubmit = async (text: string) => {
    // Slash commands are client-side actions; they never reach the agent.
    if (text.trim().startsWith('/')) {
      runCommand(text)
      return
    }
    if (running) return

    const sid = ensureCurrentSession()
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

    const outgoing: CodeMessage[] = [
      ...capHistory(session.history),
      { role: 'user', content: text },
    ]
    liveTurnsRef.current = [{ role: 'user', content: text }]
    setLiveTurns(liveTurnsRef.current)
    runningRef.current = true
    setRunning(true)

    // Local models load before the first token; surface the shared progress card
    // until generation actually starts (first stream event) or the run ends.
    if (selectedProvider === 'llamacpp') {
      modelLoadingRef.current = true
      useAppState.getState().updateModelLoadProgress(undefined)
      useAppState.getState().updateLoadingModel(true)
    }

    const runId = crypto.randomUUID()
    runIdRef.current = runId

    // Captured across the stream + catch so a failed run leaves a visible marker
    // in the transcript (not just a transient toast).
    let runError: string | null = null

    const onEvent = new Channel<StreamEvent>()
    onEvent.onmessage = (ev) => {
      switch (ev.type) {
        case 'token':
          // First actual output means the model finished loading and is now
          // generating; drop the load card. (`step` fires before invoke/load,
          // so clearing on it would hide the card during the real load.)
          finishModelLoad()
          appendToken(ev.text)
          break
        case 'tool_call':
          // A tool call is model output too — loading is done.
          finishModelLoad()
          pushLive({
            role: 'tool',
            content: '',
            callId: ev.id,
            name: ev.name,
            args: ev.args,
            status: 'running',
          })
          break
        case 'tool_result':
          updateToolTurn(ev.id, {
            result: ev.content,
            isError: ev.is_error,
            diff: ev.diff,
            status: 'done',
          })
          break
        case 'permission_request':
          setPendingPerms((prev) => [
            ...prev,
            {
              requestId: ev.request_id,
              toolName: ev.tool_name,
              capability: ev.capability,
              path: ev.path,
              command: ev.command,
              diff: ev.diff,
              promptKind: ev.prompt_kind,
              offersAlways: ev.offers_always,
            },
          ])
          break
        case 'error':
          if (ev.code !== 'cancelled') {
            runError = ev.message
            toast.error(ev.message)
          }
          break
        case 'done':
          break
      }
    }

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
        },
      })
    } catch (e) {
      runError = String(e)
      toast.error(String(e))
    } finally {
      // Drop the load card if the run ended before any stream event (error,
      // cancel, or an unloaded model that never produced output).
      finishModelLoad()
      // Any tool call still 'running' when the run ends was interrupted (cancel
      // or error mid-tool); finalize it so it doesn't render as a forever spinner.
      liveTurnsRef.current = liveTurnsRef.current.map((tn) =>
        tn.role === 'tool' && tn.status === 'running'
          ? { ...tn, status: 'done', isError: true, result: tn.result || '(interrupted)' }
          : tn
      )
      // Surface a failed run in the transcript so it is not silently empty.
      if (runError) {
        liveTurnsRef.current = [
          ...liveTurnsRef.current,
          {
            role: 'tool',
            content: '',
            name: 'error',
            result: runError,
            isError: true,
            status: 'done',
          },
        ]
      }
      // Commit the whole in-flight transcript into the session.
      const assistantText = liveTurnsRef.current
        .filter((tn) => tn.role === 'assistant')
        .map((tn) => tn.content)
        .join('\n')
      const history: CodeMessage[] = assistantText
        ? [...outgoing, { role: 'assistant', content: assistantText }]
        : outgoing
      useCodeSessions.getState().commitTurns(sid, liveTurnsRef.current, history)
      liveTurnsRef.current = []
      setLiveTurns([])
      runningRef.current = false
      setRunning(false)
      runIdRef.current = null
      // The loop has dropped any outstanding permission receivers; drop the UI.
      setPendingPerms([])
    }
  }

  const handleStop = () => {
    if (runIdRef.current)
      invoke('agent_cancel', { runId: runIdRef.current }).catch(() => {})
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-(env(safe-area-inset-bottom)+env(safe-area-inset-top)))]">
      <HeaderPage>
        <div className="flex items-center justify-between w-full pr-2">
          <DropdownModelProvider useLastUsedModel />
        </div>
      </HeaderPage>

      <div className="flex flex-1 flex-col h-full overflow-hidden">
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
                {/* Shared load card; renders only while a local model is loading
                    (hideIdle suppresses the generic "Working…" fallback). */}
                {running && <PromptProgress hideIdle />}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          )}
        </div>

        {/* Fixed input dock at the bottom. */}
        <div className="pb-4 shrink-0">
          <div className="mx-auto w-full md:w-4/5 xl:w-4/6">
            <div className="flex items-center gap-2 px-1 pb-2">
              <Button variant="outline" size="sm" className="h-7 gap-1.5 rounded-full">
                <Laptop size={14} className="text-muted-foreground" />
                <span>{t('common:local')}</span>
              </Button>
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
              <div className="ml-auto">
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
              />
            </div>
          </div>
        </div>
      </div>

      <CodePermissionDialog
        request={pendingPerms[0] ?? null}
        onRespond={respondPermission}
      />
    </div>
  )
}
