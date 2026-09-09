import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { UIMessage } from 'ai'
import type * as CoworkRunner from '@/lib/coworkRunner'

const backend = vi.hoisted(() => ({
  skills: new Map<string, string>(),
  projectSkills: new Map<string, string>(),
  received: [] as UIMessage[][],
  hold: false,
  preparationError: false,
  runs: [] as {
    signal: AbortSignal
    sink: CoworkRunner.StreamSink
    finish: () => void
  }[],
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => vi.fn(),
}))
vi.mock('@/lib/skillStore', () => ({
  storeScope: { kind: 'store' },
  projectScope: (folder: string) => ({ kind: 'project', folder }),
  listSkills: async (scope: { kind: string }) =>
    [
      ...(scope.kind === 'store'
        ? backend.skills
        : backend.projectSkills
      ).keys(),
    ].map((name) => ({ name, description: `${name} description` })),
  writeSkill: async (_scope: unknown, name: string, content: string) => {
    backend.skills.set(name, content)
  },
  invokeSkill: async (scope: { kind: string }, name: string, args: string) =>
    `${(scope.kind === 'store' ? backend.skills : backend.projectSkills).get(name)}\nArguments: ${args}`,
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string) =>
    command === 'agent_skill_enabled_get' ? [] : null,
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/lib/backendStorage', () => ({
  backendStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    selectedModel: { id: 'test-model', capabilities: ['tools'] },
    selectedProvider: 'test',
    providers: [
      { provider: 'test', active: true, api_key: 'test', models: [] },
    ],
  }),
}))
vi.mock('@/lib/coworkTransport', () => ({
  CoworkChatTransport: class {
    async refreshTools() {
      if (backend.preparationError) throw new Error('Tool preparation failed')
    }
  },
}))
vi.mock('@/lib/coworkEnv', () => ({ getCoworkEnvironment: async () => ({}) }))
vi.mock('@/lib/coworkRunner', async (original) => ({
  ...(await original<typeof CoworkRunner>()),
  runTurn: async ({
    messages,
    signal,
    deps,
  }: Parameters<typeof CoworkRunner.runTurn>[0]) => {
    backend.received.push(messages)
    if (backend.hold) {
      await new Promise<void>((resolve) => {
        backend.runs.push({ signal, sink: deps.sink, finish: resolve })
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
    }
    return { messages, stoppedBy: signal.aborted ? 'aborted' : 'done' }
  },
}))
vi.mock('@/lib/agentTools', () => ({
  getSandboxStatus: async () => ({}),
  sandboxEnforces: () => false,
  activeAgentMonitorIds: async () => [],
  cancelAgentThreadBash: async () => {},
}))
vi.mock('@/lib/coworkSubagentRegistry', () => ({
  listSubagents: async () => [],
}))
vi.mock('@/lib/coworkDispatch', () => ({ dispatchCoworkTool: vi.fn() }))
vi.mock('@/lib/model-factory', () => ({ ModelFactory: {} }))
vi.mock('@janhq/tauri-plugin-agent-tools-api', () => ({
  sessionWorkspacePath: async () => '/sandbox',
}))
vi.mock('@/containers/ChatInput', () => ({
  default: ({
    onSubmit,
    onStop,
    chatStatus,
    scopeKey,
  }: {
    onSubmit: (text: string) => void
    onStop: () => void
    chatStatus: string
    scopeKey: string
  }) => (
    <>
      <output aria-label="Composer status">{chatStatus}</output>
      <button
        onClick={() => {
          const text = usePrompt.getState().prompt
          if (chatStatus === 'streaming')
            useMessageQueue
              .getState()
              .enqueue(scopeKey, {
                id: crypto.randomUUID(),
                text,
                createdAt: Date.now(),
              })
          else onSubmit(text)
        }}
      >
        Send
      </button>
      <button onClick={onStop}>Stop</button>
    </>
  ),
}))
vi.mock('@/containers/MessageItem', () => ({
  MessageItem: ({
    message,
    onRetry,
  }: {
    message: UIMessage
    onRetry?: (id: string, text: string) => void
  }) => {
    const text = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
    return (
      <article>
        {text}
        <button onClick={() => onRetry?.(message.id, text)}>Retry</button>
      </article>
    )
  },
}))
vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <header>{children}</header>
  ),
}))
vi.mock('@/containers/DropdownModelProvider', () => ({ default: () => null }))
vi.mock('@/containers/SkillSelector', () => ({ default: () => null }))
vi.mock('@/components/ai-elements/conversation', () => ({
  Conversation: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ConversationContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ConversationScrollButton: () => null,
}))
vi.mock('@/components/PromptProgress', () => ({ PromptProgress: () => null }))
vi.mock('@/containers/CoworkEmptyState', () => ({
  CoworkEmptyState: () => null,
}))
vi.mock('@/containers/CoworkWorkspacePill', () => ({
  CoworkWorkspacePill: () => null,
}))
vi.mock('@/containers/CoworkPlanToggle', () => ({
  CoworkPlanToggle: () => null,
}))
vi.mock('@/containers/CoworkArtifactCard', () => ({
  CoworkArtifactCard: () => null,
}))
vi.mock('@/containers/CoworkPreviewPanel', () => ({
  CoworkPreviewPanel: () => null,
}))
vi.mock('@/containers/CoworkDiffPanel', () => ({ CoworkDiffPanel: () => null }))
vi.mock('@/containers/CoworkTodoPanel', () => ({ CoworkTodoPanel: () => null }))
vi.mock('@/containers/CoworkTasksPanel', () => ({
  CoworkTasksPanel: () => null,
}))
vi.mock('@/containers/CoworkChangesChip', () => ({
  CoworkChangesChip: () => null,
}))
vi.mock('@/containers/CoworkFilesChip', () => ({ CoworkFilesChip: () => null }))
vi.mock('@/containers/CoworkFilesPanel', () => ({
  CoworkFilesPanel: () => null,
}))
vi.mock('@/containers/CoworkTodoChip', () => ({ CoworkTodoChip: () => null }))
vi.mock('@/containers/CoworkTasksChip', () => ({ CoworkTasksChip: () => null }))
vi.mock('@/containers/CoworkModelChip', () => ({ CoworkModelChip: () => null }))
vi.mock('@/containers/CoworkModelPanel', () => ({
  CoworkModelPanel: () => null,
}))
vi.mock('@/containers/CoworkSandboxChip', () => ({
  CoworkSandboxChip: () => null,
}))
vi.mock('@/containers/CoworkBudgetNotice', () => ({
  CoworkBudgetNotice: () => null,
}))
vi.mock('@/containers/CoworkRunNotice', () => ({
  CoworkRunNotice: ({ onRetry }: { onRetry?: () => void }) =>
    onRetry ? <button onClick={onRetry}>Retry failed run</button> : null,
}))
vi.mock('@/containers/CoworkAskCard', () => ({ CoworkAskCard: () => null }))
vi.mock('@/containers/CoworkParkedNotice', () => ({
  CoworkParkedNotice: () => null,
}))

import { Route } from '../cowork'
import { useSkills } from '@/hooks/useSkills'
import { usePrompt } from '@/hooks/usePrompt'
import { startNewSession, useCoworkSessions } from '@/hooks/useCoworkSessions'
import { useCoworkRun } from '@/hooks/useCoworkRun'
import { useMessageQueue } from '@/stores/message-queue-store'
// The router mock returns the supplied component options directly.
const routeOptions = Route as unknown as { component: () => ReactNode }
const CoworkPage = routeOptions.component
function Manager() {
  const { write } = useSkills(null)
  return (
    <button
      onClick={() => void write('new-skill', 'Private skill instructions')}
    >
      Save skill
    </button>
  )
}

beforeEach(() => {
  backend.skills.clear()
  backend.projectSkills.clear()
  backend.received = []
  backend.hold = false
  backend.preparationError = false
  backend.runs = []
  useCoworkRun.setState(useCoworkRun.getInitialState())
  useMessageQueue.setState(useMessageQueue.getInitialState())
  useCoworkSessions.setState({ sessions: [], currentId: null })
  usePrompt.setState({ prompt: '' })
  Element.prototype.scrollIntoView = vi.fn()
})

it('refreshes the current slash menu after a global skill is saved with a project attached', async () => {
  const id = useCoworkSessions.getState().createSession()
  useCoworkSessions.getState().setFolder(id, '/project')
  render(
    <>
      <CoworkPage />
      <Manager />
    </>
  )
  await act(async () => {})
  fireEvent.click(screen.getByText('Save skill'))
  act(() => usePrompt.getState().setPrompt('/'))
  expect(await screen.findByText('/new-skill')).toBeInTheDocument()
  act(() => usePrompt.getState().setPrompt('/new-skill'))
  fireEvent.click(screen.getByText('Send'))
  await waitFor(() => expect(backend.received).toHaveLength(1))
  expect(backend.received[0].at(-1)?.parts).toContainEqual({
    type: 'text',
    text: 'Private skill instructions\nArguments: ',
  })
})

it('keeps invocations compact after completion and retry while retaining instructions in model history', async () => {
  backend.skills.set('example', 'Private skill instructions')
  render(<CoworkPage />)
  act(() => usePrompt.getState().setPrompt('/example'))
  await screen.findByText('/example')
  act(() => usePrompt.getState().setPrompt('/example argument'))
  fireEvent.click(screen.getByText('Send'))
  await waitFor(() => expect(backend.received).toHaveLength(1))
  await waitFor(() =>
    expect(document.querySelector('article')).toHaveTextContent(
      '/example argument'
    )
  )
  expect(document.querySelector('article')).not.toHaveTextContent(
    'Private skill instructions'
  )
  expect(backend.received[0].at(-1)?.parts).toContainEqual({
    type: 'text',
    text: 'Private skill instructions\nArguments: argument',
  })
  fireEvent.click(screen.getByText('Retry'))
  await waitFor(() => expect(backend.received).toHaveLength(2))
  expect(backend.received[1].at(-1)?.parts).toContainEqual({
    type: 'text',
    text: 'Private skill instructions\nArguments: argument',
  })
  expect(document.querySelector('article')).not.toHaveTextContent(
    'Private skill instructions'
  )
})

it('invokes the project skill when it shadows a global skill', async () => {
  backend.skills.set('example', 'Global instructions')
  backend.projectSkills.set('example', 'Project instructions')
  const id = useCoworkSessions.getState().createSession()
  useCoworkSessions.getState().setFolder(id, '/project')
  render(<CoworkPage />)
  act(() => usePrompt.getState().setPrompt('/example'))
  await screen.findByText('/example')
  fireEvent.click(screen.getByText('Send'))
  await waitFor(() => expect(backend.received).toHaveLength(1))
  expect(backend.received[0].at(-1)?.parts).toContainEqual({
    type: 'text',
    text: 'Project instructions\nArguments: ',
  })
  expect(document.querySelector('article')).not.toHaveTextContent(
    'Project instructions'
  )
})

it('isolates concurrent session streams and stops only the viewed session', async () => {
  backend.hold = true
  const a = useCoworkSessions.getState().createSession()
  const view = render(<CoworkPage />)
  act(() => usePrompt.getState().setPrompt('Question A'))
  fireEvent.click(screen.getByText('Send'))
  await waitFor(() => expect(backend.runs).toHaveLength(1))
  let b = ''
  act(() => {
    b = startNewSession(Object.keys(useCoworkRun.getState().runId))
  })
  expect(screen.getByLabelText('Composer status')).toHaveTextContent('ready')
  act(() => usePrompt.getState().setPrompt('Question B'))
  fireEvent.click(screen.getByText('Send'))
  await waitFor(() => expect(backend.runs).toHaveLength(2))
  act(() => {
    backend.runs[0].sink.onText('Answer A')
    backend.runs[1].sink.onText('Answer B')
  })
  expect(screen.getByText('Answer B')).toBeInTheDocument()
  expect(screen.queryByText('Answer A')).not.toBeInTheDocument()
  view.unmount()
  render(<CoworkPage />)
  expect(screen.getByText('Answer B')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Stop'))
  await waitFor(() =>
    expect(screen.getByLabelText('Composer status')).toHaveTextContent('ready')
  )
  expect(backend.runs[0].signal.aborted).toBe(false)
  expect(backend.runs[1].signal.aborted).toBe(true)
  act(() => useCoworkSessions.getState().selectSession(a))
  expect(screen.getByLabelText('Composer status')).toHaveTextContent(
    'streaming'
  )
  expect(screen.getByText('Answer A')).toBeInTheDocument()
  await act(async () => backend.runs[0].finish())
  const sessions = useCoworkSessions.getState().sessions
  expect(sessions.find((s) => s.id === a)?.turns.map((t) => t.content)).toEqual(
    ['Question A', 'Answer A']
  )
  expect(sessions.find((s) => s.id === b)?.turns.map((t) => t.content)).toEqual(
    ['Question B', 'Answer B']
  )
})

it('continues a background session queue without redirecting it into the viewed run', async () => {
  backend.hold = true
  const b = useCoworkSessions.getState().createSession()
  useCoworkSessions.setState({ currentId: null })
  const a = useCoworkSessions.getState().createSession()
  render(<CoworkPage />)
  act(() => usePrompt.getState().setPrompt('First A'))
  fireEvent.click(screen.getByText('Send'))
  await waitFor(() => expect(backend.runs).toHaveLength(1))
  act(() => usePrompt.getState().setPrompt('Follow-up A'))
  fireEvent.click(screen.getByText('Send'))
  act(() => useCoworkSessions.getState().selectSession(b))
  act(() => usePrompt.getState().setPrompt('First B'))
  fireEvent.click(screen.getByText('Send'))
  await waitFor(() => expect(backend.runs).toHaveLength(2))
  await act(async () => backend.runs[0].finish())
  await waitFor(() => expect(backend.runs).toHaveLength(3))
  expect(backend.received[2].map((m) => m.parts)).toEqual([
    [{ type: 'text', text: 'First A' }],
    [{ type: 'text', text: 'Follow-up A' }],
  ])
  expect(useMessageQueue.getState().getQueue(a)).toEqual([])
  expect(screen.getByLabelText('Composer status')).toHaveTextContent(
    'streaming'
  )
  expect(screen.queryByText('Follow-up A')).not.toBeInTheDocument()
  await act(async () => {
    backend.runs[1].finish()
    backend.runs[2].finish()
  })
  expect(
    useCoworkSessions
      .getState()
      .sessions.find((s) => s.id === b)
      ?.turns.map((t) => t.content)
  ).toEqual(['First B'])
})

it('retries the original question after request preparation fails', async () => {
  backend.preparationError = true
  render(<CoworkPage />)
  act(() => usePrompt.getState().setPrompt('Keep this question'))
  fireEvent.click(screen.getByText('Send'))
  const retry = await screen.findByText('Retry failed run')
  backend.preparationError = false
  fireEvent.click(retry)
  await waitFor(() => expect(backend.received).toHaveLength(1))
  expect(backend.received[0].at(-1)?.parts).toEqual([
    { type: 'text', text: 'Keep this question' },
  ])
})
