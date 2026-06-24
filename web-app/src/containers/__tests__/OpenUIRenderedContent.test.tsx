import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OPENUI_CHAT_ACTION_EVENT,
  type OpenUIChatActionDetail,
} from '@/lib/openui-actions'
import { OpenUIRenderedContent } from '../OpenUIRenderedContent'

const mocks = vi.hoisted(() => ({
  setPrompt: vi.fn(),
}))

type MockOpenUISettingsState = {
  componentLibrary: 'chat'
}

type MockPromptState = {
  setPrompt: typeof mocks.setPrompt
}

vi.mock('@/hooks/useOpenUISettings', () => ({
  useOpenUISettings: <T,>(selector: (state: MockOpenUISettingsState) => T) =>
    selector({
      componentLibrary: 'chat',
    }),
}))

vi.mock('@/hooks/usePrompt', () => ({
  usePrompt: <T,>(selector: (state: MockPromptState) => T) =>
    selector({ setPrompt: mocks.setPrompt }),
}))

vi.mock('@/containers/RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

const buttonResponse = `
root = Buttons([primary])
primary = Button("Show me options")
`

const formResponse = `
root = Form("contact", btns, [nameField])
nameField = FormControl("Name", Input("name", "Your name", "text", {}))
btns = Buttons([Button("Submit", Action([@ToAssistant("Submit")]), "primary")])
`

const openUrlResponse = (url: string) => `
root = Button("Open link", Action([@OpenUrl("${url}")]), "primary")
`

describe('OpenUIRenderedContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dispatches OpenUI CTA clicks to the active chat input', async () => {
    const user = userEvent.setup()
    const handleAction = vi.fn((event: Event) => {
      event.preventDefault()
    })

    window.addEventListener(OPENUI_CHAT_ACTION_EVENT, handleAction)

    try {
      render(
        <OpenUIRenderedContent
          content={buttonResponse}
          openUIResponse={buttonResponse}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Show me options' }))

      expect(handleAction).toHaveBeenCalledTimes(1)
      const event = handleAction.mock.calls[0][0] as CustomEvent<
        OpenUIChatActionDetail
      >
      expect(event.detail.prompt).toBe('Show me options')
      expect(mocks.setPrompt).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(OPENUI_CHAT_ACTION_EVENT, handleAction)
    }
  })

  it('falls back to filling the prompt when no chat input handles the click', async () => {
    const user = userEvent.setup()

    render(
      <OpenUIRenderedContent
        content={buttonResponse}
        openUIResponse={buttonResponse}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Show me options' }))

    expect(mocks.setPrompt).toHaveBeenCalledWith('Show me options')
  })

  it('includes OpenUI form state when submitting a CTA', async () => {
    const user = userEvent.setup()
    const handleAction = vi.fn((event: Event) => {
      event.preventDefault()
    })

    window.addEventListener(OPENUI_CHAT_ACTION_EVENT, handleAction)

    try {
      render(
        <OpenUIRenderedContent
          content={formResponse}
          openUIResponse={formResponse}
        />
      )

      await user.type(screen.getByPlaceholderText('Your name'), 'Ada')
      await user.click(screen.getByRole('button', { name: 'Submit' }))

      const event = handleAction.mock.calls[0][0] as CustomEvent<
        OpenUIChatActionDetail
      >
      expect(event.detail.prompt).toContain('<content>Submit</content>')
      expect(event.detail.prompt).toContain('<context>')
      expect(event.detail.prompt).toContain('"formState":{"contact":{"name":"Ada"}}')
    } finally {
      window.removeEventListener(OPENUI_CHAT_ACTION_EVENT, handleAction)
    }
  })

  it.each(['https://example.com/docs', 'http://example.com/docs'])(
    'opens allowed OpenUrl actions for %s',
    async (url) => {
      const user = userEvent.setup()
      const open = vi.spyOn(window, 'open').mockImplementation(() => null)

      render(
        <OpenUIRenderedContent
          content={openUrlResponse(url)}
          openUIResponse={openUrlResponse(url)}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Open link' }))

      expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer')
      open.mockRestore()
    }
  )

  it.each([
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'file:///tmp/unsafe',
    '/relative-path',
  ])('blocks unsafe OpenUrl actions for %s', async (url) => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(
      <OpenUIRenderedContent
        content={openUrlResponse(url)}
        openUIResponse={openUrlResponse(url)}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Open link' }))

    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })
})
