import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenUIResponse } from '../OpenUIResponse'

const state = vi.hoisted(() => ({
  currentThreadId: 'thread-1',
  enabledThreads: {} as Record<string, boolean>,
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: <T,>(
    selector: (value: { currentThreadId: string }) => T
  ) => selector({ currentThreadId: state.currentThreadId }),
}))

vi.mock('@/hooks/useOpenUISettings', () => ({
  useOpenUISettings: <T,>(
    selector: (value: { enabledThreads: Record<string, boolean> }) => T
  ) => selector({ enabledThreads: state.enabledThreads }),
}))

vi.mock('@/containers/RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}))

vi.mock('@/containers/OpenUIRenderedContent', () => ({
  OpenUIRenderedContent: () => <div data-testid="openui-renderer" />,
}))

const openUIResponse = `
root = Button("Continue")
`

describe('OpenUIResponse', () => {
  beforeEach(() => {
    state.currentThreadId = 'thread-1'
    state.enabledThreads = {}
  })

  it('falls back to Markdown when OpenUI is disabled for the thread', () => {
    render(<OpenUIResponse content={openUIResponse} />)

    expect(screen.getByTestId('markdown')).toBeInTheDocument()
    expect(screen.queryByTestId('openui-renderer')).not.toBeInTheDocument()
  })

  it('renders OpenUI only when it is enabled for the active thread', async () => {
    state.enabledThreads = { 'thread-1': true }

    render(<OpenUIResponse content={openUIResponse} />)

    expect(await screen.findByTestId('openui-renderer')).toBeInTheDocument()
  })
})
