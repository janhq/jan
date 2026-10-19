import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { codeToHtml } from 'shiki'

import { CodeBlock, CodeBlockCopyButton, highlightCode } from '../code-block'

vi.mock('shiki', () => ({
  codeToHtml: vi.fn().mockResolvedValue('<pre><code>highlighted</code></pre>'),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(codeToHtml).mockResolvedValue('<pre><code>highlighted</code></pre>')
})

describe('highlightCode', () => {
  it('falls back to escaped source when highlighting rejects', async () => {
    const source = '</code><img src=x onerror="bad()"> & literal text'
    vi.mocked(codeToHtml).mockRejectedValue(new Error('unknown language'))
    const [light, dark] = await highlightCode(source, 'unknown-language' as never)
    expect(light).toBe(dark)
    const element = document.createElement('div')
    element.innerHTML = light
    expect(element.textContent).toBe(source)
    expect(element.querySelector('img')).toBeNull()
    expect(element.querySelector('pre code')).not.toBeNull()
  })
  it('returns light and dark HTML strings', async () => {
    const [light, dark] = await highlightCode('const x = 1', 'typescript')

    expect(codeToHtml).toHaveBeenCalledTimes(2)
    expect(codeToHtml).toHaveBeenCalledWith(
      'const x = 1',
      expect.objectContaining({ theme: 'one-light' })
    )
    expect(codeToHtml).toHaveBeenCalledWith(
      'const x = 1',
      expect.objectContaining({ theme: 'one-dark-pro' })
    )
    expect(light).toBe('<pre><code>highlighted</code></pre>')
    expect(dark).toBe('<pre><code>highlighted</code></pre>')
  })

  it('passes line number transformer when showLineNumbers is true', async () => {
    await highlightCode('code', 'javascript', true)

    expect(codeToHtml).toHaveBeenCalledWith(
      'code',
      expect.objectContaining({
        transformers: expect.arrayContaining([
          expect.objectContaining({ name: 'line-numbers' }),
        ]),
      })
    )
  })

  it('passes empty transformers when showLineNumbers is false', async () => {
    await highlightCode('code', 'javascript', false)

    expect(codeToHtml).toHaveBeenCalledWith(
      'code',
      expect.objectContaining({ transformers: [] })
    )
  })
})

describe('CodeBlock', () => {
  it('keeps the source visible in both themes after a highlighter failure', async () => {
    vi.mocked(codeToHtml).mockRejectedValue(new Error('language unavailable'))
    const source = '<script>literal source</script> & more'
    const { container } = render(<CodeBlock code={source} language="javascript" />)
    await waitFor(() => expect(container.querySelectorAll('pre code')).toHaveLength(2))
    expect([...container.querySelectorAll('pre code')].map((node) => node.textContent)).toEqual([source, source])
    expect(container.querySelector('script')).toBeNull()
  })
  it('renders and calls codeToHtml to highlight code', async () => {
    render(<CodeBlock code="const x = 1" language="typescript" />)

    await waitFor(() => {
      expect(codeToHtml).toHaveBeenCalled()
    })
  })

  it('shows light and dark theme containers', async () => {
    const { container } = render(
      <CodeBlock code="hello" language="javascript" />
    )

    await waitFor(() => {
      const lightDiv = container.querySelector('.dark\\:hidden')
      const darkDiv = container.querySelector('.dark\\:block')
      expect(lightDiv).toBeInTheDocument()
      expect(darkDiv).toBeInTheDocument()
    })
  })

  it('renders highlighted HTML after loading', async () => {
    const { container } = render(
      <CodeBlock code="const x = 1" language="typescript" />
    )

    await waitFor(() => {
      expect(container.innerHTML).toContain('highlighted')
    })
  })

  it('passes children positioned absolutely', async () => {
    render(
      <CodeBlock code="const x = 1" language="typescript">
        <span data-testid="child">Copy</span>
      </CodeBlock>
    )

    expect(screen.getByTestId('child')).toBeInTheDocument()
    expect(screen.getByTestId('child').parentElement).toHaveClass('absolute')
  })
})

describe('CodeBlockCopyButton', () => {
  it('copies the original source after falling back to plain text', async () => {
    const user = userEvent.setup()
    vi.mocked(codeToHtml).mockRejectedValue(new Error('highlighter unavailable'))
    const source = 'if (a < b) { return "&value" }'
    render(<CodeBlock code={source} language="javascript"><CodeBlockCopyButton /></CodeBlock>)
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    await screen.findAllByText(source)
    await user.click(screen.getByRole('button'))
    expect(copy).toHaveBeenCalledWith(source)
  })
  it('copies code to clipboard on click', async () => {
    const user = userEvent.setup()

    render(
      <CodeBlock code="const x = 1" language="typescript">
        <CodeBlockCopyButton />
      </CodeBlock>
    )

    // Spy on the clipboard writeText that userEvent.setup() provides
    const writeTextSpy = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)

    const button = screen.getByRole('button')
    await user.click(button)

    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalledWith('const x = 1')
    })
  })

  it('shows CheckIcon after copy', async () => {
    const user = userEvent.setup()

    render(
      <CodeBlock code="const x = 1" language="typescript">
        <CodeBlockCopyButton />
      </CodeBlock>
    )

    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

    const button = screen.getByRole('button')
    await user.click(button)

    await waitFor(() => {
      // After copy, the icon changes from CopyIcon to CheckIcon
      const svg = button.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  it('calls onCopy callback', async () => {
    const user = userEvent.setup()
    const onCopy = vi.fn()

    render(
      <CodeBlock code="const x = 1" language="typescript">
        <CodeBlockCopyButton onCopy={onCopy} />
      </CodeBlock>
    )

    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

    const button = screen.getByRole('button')
    await user.click(button)

    await waitFor(() => {
      expect(onCopy).toHaveBeenCalledOnce()
    })
  })

  it('calls onError when clipboard API is unavailable', async () => {
    const user = userEvent.setup()
    const onError = vi.fn()

    render(
      <CodeBlock code="const x = 1" language="typescript">
        <CodeBlockCopyButton onError={onError} />
      </CodeBlock>
    )

    // Remove clipboard after userEvent.setup() attached it
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    })

    const button = screen.getByRole('button')
    await user.click(button)

    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Clipboard API not available' })
    )
  })

  it('calls onError when writeText rejects', async () => {
    const user = userEvent.setup()
    const onError = vi.fn()
    const writeError = new Error('Permission denied')

    render(
      <CodeBlock code="const x = 1" language="typescript">
        <CodeBlockCopyButton onError={onError} />
      </CodeBlock>
    )

    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(
      writeError
    )

    const button = screen.getByRole('button')
    await user.click(button)

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(writeError)
    })
  })
})
