/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from '@tanstack/react-router'
import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { route } from '@/constants/routes'
import { Button } from '@/components/ui/button'
import { useServiceHub } from '@/hooks/useServiceHub'
import { Laptop, Folder } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { invoke, Channel } from '@tauri-apps/api/core'
import { cn } from '@/lib/utils'
import {
  useCodeSessions,
  ensureCurrentSession,
  type CodeTurn,
  type CodeMessage,
} from '@/hooks/useCodeSessions'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { useModelProvider } from '@/hooks/useModelProvider'

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
      prompt_kind: string
      offers_always: boolean
    }

function CodePage() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()

  const sessions = useCodeSessions((s) => s.sessions)
  const currentId = useCodeSessions((s) => s.currentId)
  const current = sessions.find((s) => s.id === currentId)
  const selectedModel = useModelProvider((s) => s.selectedModel)

  const folder = current?.folder ?? null
  const folderName = folder ? folder.split(/[/\\]/).pop() : undefined

  // In-flight transcript for the active run; committed to the store on `done`.
  const [liveTurns, setLiveTurns] = useState<CodeTurn[]>([])
  const [running, setRunning] = useState(false)
  const liveTurnsRef = useRef<CodeTurn[]>([])
  const runIdRef = useRef<string | null>(null)

  const displayedTurns: CodeTurn[] = [...(current?.turns ?? []), ...liveTurns]

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
    if (running) return

    const sid = ensureCurrentSession()
    const store = useCodeSessions.getState()
    const session = store.sessions.find((s) => s.id === sid)
    if (!session?.folder) {
      toast.error(t('common:selectFolder'))
      return
    }
    if (session.title === 'New session') {
      store.setTitle(sid, text.slice(0, 40))
    }

    const outgoing: CodeMessage[] = [
      ...session.history,
      { role: 'user', content: text },
    ]
    liveTurnsRef.current = [{ role: 'user', content: text }]
    setLiveTurns(liveTurnsRef.current)
    setRunning(true)

    const runId = crypto.randomUUID()
    runIdRef.current = runId

    const onEvent = new Channel<StreamEvent>()
    onEvent.onmessage = (ev) => {
      switch (ev.type) {
        case 'token':
          appendToken(ev.text)
          break
        case 'tool_call':
          pushLive({ role: 'tool', content: `⚙ ${ev.name}` })
          break
        case 'tool_result':
          pushLive({
            role: 'tool',
            content: `${ev.is_error ? '✗' : '✓'} ${ev.content.slice(0, 400)}`,
          })
          break
        case 'permission_request':
          // MVP: auto-approve once. Replace with an approval dialog later.
          invoke('agent_permission_respond', {
            requestId: ev.request_id,
            decision: 'allow_once',
          }).catch(() => {})
          break
        case 'error':
          if (ev.code !== 'cancelled') toast.error(ev.message)
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
          ...(selectedModel?.id ? { model: selectedModel.id } : {}),
        },
      })
    } catch (e) {
      toast.error(String(e))
    } finally {
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
      setRunning(false)
      runIdRef.current = null
    }
  }

  const handleStop = () => {
    if (runIdRef.current)
      invoke('agent_cancel', { runId: runIdRef.current }).catch(() => {})
  }

  return (
    <div className="flex h-full flex-col">
      <HeaderPage>
        <span className="font-medium">
          {current?.title ?? t('common:newSession')}
        </span>
      </HeaderPage>

      <div className="flex-1 overflow-y-auto px-3">
        {displayedTurns.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center">
            <h1 className="text-2xl font-studio font-medium">
              {t('common:newSession')}
            </h1>
          </div>
        ) : (
          <div className="mx-auto w-full md:w-4/5 xl:w-4/6 py-4 flex flex-col gap-3">
            {displayedTurns.map((turn, i) => (
              <div
                key={i}
                className={cn(
                  'text-sm whitespace-pre-wrap break-words',
                  turn.role === 'user' && 'font-medium',
                  turn.role === 'tool' &&
                    'font-mono text-xs text-muted-foreground bg-sidebar-foreground/5 rounded-md px-2 py-1'
                )}
              >
                {turn.content}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 pb-4 shrink-0">
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
          </div>
          <ChatInput
            showSpeedToken={false}
            initialMessage={true}
            onSubmit={handleSubmit}
            onStop={handleStop}
            chatStatus={running ? 'streaming' : 'ready'}
          />
          <div className="flex justify-end px-1 pt-2">
            <DropdownModelProvider />
          </div>
        </div>
      </div>
    </div>
  )
}
