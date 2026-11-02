/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  coworkEnabled: false,
  selectedModel: undefined as any,
  selectedProvider: '',
  project: {
    id: 'project-1',
    name: 'Project',
    updated_at: 1,
    assistantId: undefined as string | undefined,
  } as any,
  startCoworkConversation: vi.fn(() => 'session-1'),
  toastError: vi.fn(),
  lastSubmitResult: undefined as unknown,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config, id: '/project/$projectId' }),
  useNavigate: () => h.navigate,
  useParams: () => ({ projectId: 'project-1' }),
}))

vi.mock('@/lib/version', () => ({ isCoworkEnabled: () => h.coworkEnabled }))
vi.mock('@/lib/startCoworkConversation', () => ({
  startCoworkConversation: (opts: any) => h.startCoworkConversation(opts),
}))
vi.mock('sonner', () => ({ toast: { error: (...args: any[]) => h.toastError(...args) } }))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    selectedModel: h.selectedModel,
    selectedProvider: h.selectedProvider,
  }),
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: (selector: any) =>
    selector({ threads: {}, deleteAllThreadsByProject: vi.fn() }),
}))

vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({
    getFolderById: () => h.project,
    updateFolder: vi.fn(),
  }),
}))

vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: () => ({ assistants: [] }),
}))

vi.mock('@/containers/ChatInput', () => ({
  default: ({
    onSubmit,
    leadingControls,
    projectId,
    scopeKey,
    supportsAssistants,
    ownsToolSet,
  }: any) => (
    <div
      data-testid="chat-input"
      data-project-id={projectId}
      data-scope-key={scopeKey}
      data-supports-assistants={String(supportsAssistants)}
      data-owns-toolset={String(ownsToolSet)}
    >
      <div data-testid="leading-controls">{leadingControls}</div>
      <button
        data-testid="submit"
        onClick={() => {
          h.lastSubmitResult = (onSubmit ?? (() => {}))(
            'project task',
            undefined,
            undefined,
            'project task'
          )
        }}
      />
    </div>
  ),
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@/containers/ThreadList', () => ({ default: () => null }))
vi.mock('@/containers/ProjectFiles', () => ({ default: () => null }))
vi.mock('@/containers/ConversationHeaderTitle', () => ({
  ConversationHeaderTitle: () => null,
}))
vi.mock('@/containers/AvatarEmoji', () => ({ AvatarEmoji: () => null }))
vi.mock('@/containers/dialogs/AddProjectDialog', () => ({ default: () => null }))
vi.mock('@/containers/dialogs/DeleteProjectDialog', () => ({
  DeleteProjectDialog: () => null,
}))
vi.mock('@/containers/dialogs/DeleteAllThreadsInProjectDialog', () => ({
  DeleteAllThreadsInProjectDialog: () => null,
}))
vi.mock('@/lib/utils', () => ({
  cn: (...c: any[]) => c.filter(Boolean).join(' '),
}))

import { Route } from '../project/$projectId'
import { useHomeMode } from '@/hooks/useHomeMode'

const renderComponent = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

describe('Project route Chat/Cowork selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.coworkEnabled = false
    h.selectedModel = undefined
    h.selectedProvider = ''
    h.startCoworkConversation.mockReturnValue('session-1')
    h.lastSubmitResult = undefined
    useHomeMode.setState({ mode: 'chat' })
  })

  it('hides the selector and keeps the Chat contract where Cowork is unavailable', () => {
    renderComponent()
    expect(screen.queryByTestId('home-mode-toggle')).not.toBeInTheDocument()
    const input = screen.getByTestId('chat-input')
    expect(input).toHaveAttribute('data-supports-assistants', 'true')
    expect(input).toHaveAttribute('data-owns-toolset', 'undefined')
    expect(input).not.toHaveAttribute('data-scope-key')
  })

  it('forces Chat mode when Cowork is unavailable even with a stored cowork mode', () => {
    useHomeMode.setState({ mode: 'cowork' })
    renderComponent()
    const input = screen.getByTestId('chat-input')
    expect(input).toHaveAttribute('data-supports-assistants', 'true')
    expect(input).not.toHaveAttribute('data-scope-key')
    fireEvent.click(screen.getByTestId('submit'))
    expect(h.startCoworkConversation).not.toHaveBeenCalled()
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('shows the selector defaulting to Chat where Cowork is available', () => {
    h.coworkEnabled = true
    renderComponent()
    expect(screen.getByTestId('home-mode-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('home-mode-chat')).toHaveAttribute(
      'aria-checked',
      'true'
    )
    const input = screen.getByTestId('chat-input')
    expect(input).toHaveAttribute('data-supports-assistants', 'true')
    expect(input).not.toHaveAttribute('data-scope-key')
  })

  it('switches ChatInput to the Cowork contract with a project-scoped draft key', () => {
    h.coworkEnabled = true
    useHomeMode.setState({ mode: 'cowork' })
    renderComponent()
    const input = screen.getByTestId('chat-input')
    expect(input).toHaveAttribute('data-supports-assistants', 'false')
    expect(input).toHaveAttribute('data-owns-toolset', 'false')
    expect(input).toHaveAttribute('data-scope-key', 'project-cowork:project-1')
  })

  it('Cowork submit starts a project session with no folder and opens its URL', () => {
    h.coworkEnabled = true
    h.selectedModel = { id: 'model-a' }
    h.selectedProvider = 'llamacpp'
    useHomeMode.setState({ mode: 'cowork' })
    renderComponent()
    fireEvent.click(screen.getByTestId('submit'))
    expect(h.startCoworkConversation).toHaveBeenCalledWith({
      model: { id: 'model-a', provider: 'llamacpp' },
      folder: null,
      project: h.project,
      handoff: {
        text: 'project task',
        files: undefined,
        documents: undefined,
        draft: 'project task',
      },
    })
    expect(h.navigate).toHaveBeenCalledWith({
      to: '/cowork/$sessionId',
      params: { sessionId: 'session-1' },
    })
    // An accepted submission must not signal refusal: ChatInput clears the
    // draft unless onSubmit returns false.
    expect(h.lastSubmitResult).not.toBe(false)
  })

  it('keeps the draft path when the Cowork handoff cannot be stored', () => {
    h.coworkEnabled = true
    useHomeMode.setState({ mode: 'cowork' })
    h.startCoworkConversation.mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    renderComponent()
    fireEvent.click(screen.getByTestId('submit'))
    expect(h.toastError).toHaveBeenCalled()
    expect(h.navigate).not.toHaveBeenCalled()
    // The route must tell ChatInput the submission was refused, or the real
    // composer would clear the draft and attachments despite the failure.
    expect(h.lastSubmitResult).toBe(false)
  })
})
