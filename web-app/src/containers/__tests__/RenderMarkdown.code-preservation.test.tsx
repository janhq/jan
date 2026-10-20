import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RenderMarkdown } from '../RenderMarkdown'

// Observe the exact Markdown handed to the renderer, before highlighting can
// conceal a backslash or an inserted zero-width character.
vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children: string }) => (
    <pre data-testid="markdown-input">{children}</pre>
  ),
  defaultRehypePlugins: { harden: () => {} },
}))

vi.mock('@/hooks/useInterfaceSettings', () => ({
  useInterfaceSettings: (select: (state: object) => unknown) =>
    select({ renderHtmlArtifacts: false }),
}))

afterEach(cleanup)

describe('Markdown normalization preserves code verbatim', () => {
  it.each([
    ['tilde fence', '~~~sh\nprintf "$100"\n\\(literal\\)\na**b**c\n~~~'],
    ['long backtick fence with an inner fence', '````md\n```sh\n$100\n```\n\\(literal\\)\na**b**c\n````'],
    ['unfinished backtick fence', '```sh\nprintf "$100"\n\\(literal\\)\na**b**c'],
    ['unfinished tilde fence', '~~~sh\nprintf "$100"\n\\(literal\\)\na**b**c'],
    ['longer closing fence', '~~~sh\n$100\n~~~~\n'],
    ['multi-backtick code span', 'Use ``literal ` $100 \\(x\\) a**b**c`` here.'],
    ['multiline code span', 'Use `$100\n\\(x\\)` here.'],
    ['ordinary backtick fence', '```sh\n$100\n\\(x\\)\n```'],
    ['ordinary inline code', 'Use `$100 \\(x\\)` here.'],
  ])('keeps %s unchanged', (_, content) => {
    render(<RenderMarkdown content={content} />)
    expect(screen.getByTestId('markdown-input').textContent).toBe(content)
  })

  it('still normalizes math outside a code fence', () => {
    render(<RenderMarkdown content={'~~~sh\n$100\n~~~\n\\(x\\) costs $200'} />)
    expect(screen.getByTestId('markdown-input').textContent).toBe(
      '~~~sh\n$100\n~~~\n$x$ costs \\$200'
    )
  })
})
