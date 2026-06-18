import { render, waitFor, act, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { RenderMarkdown } from '../RenderMarkdown'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'

vi.mock('@i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(),
  },
})

describe('RenderMarkdown', () => {
  it('preserves line breaks in model responses (when isUser == undefined)', () => {
    const modelResponseWithNewLines = `This is line 1
    This is line 2
    This is line 3`
    render(<RenderMarkdown content={modelResponseWithNewLines} />)
    const markdownContainer = document.querySelector('.markdown')
    // Line breaks are preserved as newlines in the rendered HTML (not <br> tags)
    const text = markdownContainer?.textContent || ''
    expect(text).toContain('This is line 1')
    expect(text).toContain('This is line 2')
    expect(text).toContain('This is line 3')
  })

  it('preserves line breaks in user message (when isUser == true)', () => {
    const userMessageWithNewlines = `User question line 1
    User question line 2
    User question line 3`
    render(<RenderMarkdown content={userMessageWithNewlines} isUser={true} />)
    const markdownContainer = document.querySelector('.markdown')
    expect(markdownContainer).toBeTruthy()
    // Line breaks are preserved as newlines in the rendered HTML
    const text = markdownContainer?.textContent || ''
    expect(text).toContain('User question line 1')
    expect(text).toContain('User question line 2')
    expect(text).toContain('User question line 3')
  })

  it('preserves line breaks with different line ending types', () => {
    const contentWithDifferentLineEndings = 'Line1\nLine2\r\nLine3\rLine4'
    render(<RenderMarkdown content={contentWithDifferentLineEndings} />)
    const markdownContainer = document.querySelector('.markdown')
    // Line breaks are preserved as newlines in the rendered HTML
    const text = markdownContainer?.textContent || ''
    expect(text).toContain('Line1')
    expect(text).toContain('Line2')
    expect(text).toContain('Line3')
    expect(text).toContain('Line4')
  })

  it('handles empty lines correctly', () => {
    const contentWithEmptyLines =
      'Line 1\n\nLine 3 (after empty line)\n\nLine 5 (after two empty lines)'
    render(<RenderMarkdown content={contentWithEmptyLines} />)
    const markdownContainer = document.querySelector('.markdown')
    const text = markdownContainer?.textContent || ''
    // All content lines should be present
    expect(text).toContain('Line 1')
    expect(text).toContain('Line 3 (after empty line)')
    expect(text).toContain('Line 5 (after two empty lines)')
  })

  describe('LaTeX normalization - dollar sign escaping', () => {
    it('escapes dollar signs followed by numbers to prevent LaTeX interpretation', () => {
      const content = 'The price is $200 for the item'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      expect(text).toContain('$200')
    })

    it('handles multiple dollar amounts in the same content', () => {
      const content = 'Items cost $100, $200, and $350 respectively'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      expect(text).toContain('$100')
      expect(text).toContain('$200')
      expect(text).toContain('$350')
    })

    it('handles single digit dollar amounts', () => {
      const content = 'Only $5 or $9 available'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      expect(text).toContain('$5')
      expect(text).toContain('$9')
    })

    it('handles large dollar amounts', () => {
      const content = 'The total is $1000000 for the project'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      expect(text).toContain('$1000000')
    })

    it('preserves dollar amounts in sentences with mixed content', () => {
      const content = 'I paid $50 yesterday and will pay $75 tomorrow.'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      expect(text).toContain('$50')
      expect(text).toContain('$75')
    })

    it('does not interfere with actual LaTeX inline math', () => {
      const content = 'The equation $x + y = z$ is simple'
      render(<RenderMarkdown content={content} />)
      const katexContainer = document.querySelector('.katex')
      // LaTeX should be rendered (KaTeX will process it)
      expect(katexContainer).toBeTruthy()
    })

    it('does not interfere with actual LaTeX inline math (numerical expression)', () => {
      const content = 'The equation $12 \\times 12 = 144$ is simple'
      render(<RenderMarkdown content={content} />)
      const katexContainer = document.querySelector('.katex')
      // LaTeX should be rendered (KaTeX will process it)
      expect(katexContainer).toBeTruthy()
    })

    it('does not interfere with display math blocks', () => {
      const content = '$$\nx^2 + y^2 = r^2\n$$'
      render(<RenderMarkdown content={content} />)
      const katexContainer = document.querySelector('.katex')
      // Display math should be rendered
      expect(katexContainer).toBeTruthy()
    })

    it('does not interfere with display math blocks (numerical expression)', () => {
      const content = '$$12 \\times 12 = 144$$'
      render(<RenderMarkdown content={content} />)
      const katexContainer = document.querySelector('.katex')
      const katexError = document.querySelector('.katex-error')
      // Display math should be rendered
      expect(katexContainer).toBeTruthy()
      expect(katexError).toBeNull()
    })

    it('does not inject a ZWSP into subscripts (emphasis fix must skip math)', () => {
      // '_' is a LaTeX subscript; the emphasis-flanking fix must not touch it,
      // else KaTeX warns "Unrecognized Unicode character 8203" (U+200B).
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const content = 'The term $x_{i}$ and $a_1 + b_2$ are indexed'
      render(<RenderMarkdown content={content} />)
      expect(document.querySelector('.katex')).toBeTruthy()
      const warnedAboutZwsp = warn.mock.calls
        .flat()
        .some((arg) => typeof arg === 'string' && arg.includes('8203'))
      expect(warnedAboutZwsp).toBe(false)
      warn.mockRestore()
    })
  })

  it('does not format 4-space indented text as code blocks', () => {
    const contentWithIndentedText = `Please explain this code block.

    <!DOCTYPE html>
    <html lang="en">
    <body>
        <header>
            <h1>Welcome to My Website</h1>
            <p>A sample HTML document showcasing various HTML elements</p>
        </header>
        
        <nav>
            <a href="#home">Home</a>
            <a href="#about">About</a>
            <a href="#services">Services</a>
            <a href="#contact">Contact</a>
        </nav>
        
        <div class="container">
            <section id="home">
                <h2>Home</h2>
                <div class="card">
                    <p>This is a sample HTML document that demonstrates various HTML elements and their structure.</p>
                    <p>HTML (HyperText Markup Language) is the standard markup language for creating web pages.</p>
                </div>
            </section>
            
        </div>
        
        <footer>
            <p>&copy; ${new Date().getFullYear()} My Sample Website. All rights reserved.</p>
        </footer>
    </body>
    </html>
    `
    render(
      <RenderMarkdown
        content={contentWithIndentedText}
      />
    )
    const markdownContainer = document.querySelector('.markdown')
    const html = markdownContainer?.innerHTML || ''
    expect(html).not.toContain('<pre>')
    expect(html).toContain('<p>')
    // Left and right brackets get escaped as &lt; and &gt; respectively
    expect(html).toContain('&lt;!DOCTYPE html&gt;')
  })
  
  it('formats fenced code blocks correctly', async () => {
    const contentWithFencedCodeBlock = `Please explain this code block.

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<body>
    <header>
        <h1>Welcome to My Website</h1>
        <p>A sample HTML document showcasing various HTML elements</p>
    </header>
    
    <nav>
        <a href="#home">Home</a>
        <a href="#about">About</a>
        <a href="#services">Services</a>
        <a href="#contact">Contact</a>
    </nav>
    
    <div class="container">
        <section id="home">
            <h2>Home</h2>
            <div class="card">
                <p>This is a sample HTML document that demonstrates various HTML elements and their structure.</p>
                <p>HTML (HyperText Markup Language) is the standard markup language for creating web pages.</p>
            </div>
        </section>
    </div>
    
    <footer>
        <p>&copy; ${new Date().getFullYear()} My Sample Website. All rights reserved.</p>
    </footer>
</body>
</html>
\`\`\`
`
    const { container, findByText}  = render(
      <RenderMarkdown
        content={contentWithFencedCodeBlock}
      />
    )
    // Wait for the code content to be rendered (async operation)
    await findByText('<!DOCTYPE html>', { exact: false })
    const markdownContainer = container.querySelector('.markdown')
    const text = markdownContainer?.textContent || ''
    const codeBlock = container.querySelector('[data-streamdown="code-block"]')
      // Check that the code content is present
    expect(text).toContain('<!DOCTYPE html>')
    expect(text).toContain('<html lang="en">')
    expect(text).toContain('Welcome to My Website')
    expect(codeBlock).toBeTruthy()
  })

  it('formats fenced code blocks without lang spec correctly', async () => {
    const contentWithFencedCodeBlock = `Please explain this code block.

\`\`\`
<!DOCTYPE html>
<html lang="en">
<body>
    <header>
        <h1>Welcome to My Website</h1>
        <p>A sample HTML document showcasing various HTML elements</p>
    </header>
    
    <nav>
        <a href="#home">Home</a>
        <a href="#about">About</a>
        <a href="#services">Services</a>
        <a href="#contact">Contact</a>
    </nav>
    
    <div class="container">
        <section id="home">
            <h2>Home</h2>
            <div class="card">
                <p>This is a sample HTML document that demonstrates various HTML elements and their structure.</p>
                <p>HTML (HyperText Markup Language) is the standard markup language for creating web pages.</p>
            </div>
        </section>
    </div>
    
    <footer>
        <p>&copy; ${new Date().getFullYear()} My Sample Website. All rights reserved.</p>
    </footer>
</body>
</html>
\`\`\`
`
    const { container, findByText}  = render(
      <RenderMarkdown
        content={contentWithFencedCodeBlock}
      />
    )
    // Wait for the code content to be rendered (async operation)
    await findByText('<!DOCTYPE html>', { exact: false })
    const markdownContainer = container.querySelector('.markdown')
    const text = markdownContainer?.textContent || ''
    const codeBlock = container.querySelector('[data-streamdown="code-block"]')
      // Check that the code content is present
    expect(text).toContain('<!DOCTYPE html>')
    expect(text).toContain('<html lang="en">')
    expect(text).toContain('Welcome to My Website')
    expect(codeBlock).toBeTruthy()
  })

  describe('LaTeX normalization - display math', () => {
    it('converts \\[...\\] to $$ display math', () => {
      const content = 'Here is math:\n\\[\nx^2 + y^2\n\\]\nDone'
      render(<RenderMarkdown content={content} />)
      const katexContainer = document.querySelector('.katex')
      // Display math should be rendered by KaTeX
      expect(katexContainer).toBeTruthy()
    })

    it('converts \\[...\\] to $$ display math (numerical expression)', () => {
      const content = 'Here is math:\n\\[\n3^2 + 4^2\n\\]\nDone'
      render(<RenderMarkdown content={content} />)
      const katexContainer = document.querySelector('.katex')
      // Display math should be rendered by KaTeX
      expect(katexContainer).toBeTruthy()
    })
  })

  describe('LaTeX normalization - inline math', () => {
    it('converts \\(...\\) to $ inline math', () => {
      const content = 'The formula \\(E = mc^2\\) is famous'
      render(<RenderMarkdown content={content} />)
      const katexContainer = document.querySelector('.katex')
      // Inline math should be rendered
      expect(katexContainer).toBeTruthy()
    })

    it('converts \\(...\\) to $ inline math (numerical expression)', () => {
      const content = 'The formula \\(3^2 + 4^2 = 5^2\\) is famous'
      render(<RenderMarkdown content={content} />)
      const katexContainer = document.querySelector('.katex')
      // Inline math should be rendered
      expect(katexContainer).toBeTruthy()
    })

    it('converts \\[...\\] mid-sentence (no surrounding newlines)', () => {
      const content = 'Inline display \\[a^2 + b^2\\] right here'
      render(<RenderMarkdown content={content} />)
      expect(document.querySelector('.katex')).toBeTruthy()
      expect(document.querySelector('.katex-error')).toBeNull()
    })
  })

  describe('LaTeX normalization - code block preservation', () => {
    it('does not process dollar amounts inside code blocks', () => {
      const content = '```\nconst price = $100\n```'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      // Code blocks should preserve original content
      expect(markdownContainer).toBeTruthy()
      expect(text).toContain('$100')
    })

    it('does not process dollar amounts inside inline code', () => {
      const content = 'Use `$100` in the variable'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      expect(text).toContain('$100')
    })

    it('does not convert bracket math inside inline code', () => {
      // Code is masked first, so \(x\) stays literal instead of becoming $x$.
      const content = 'Type `\\(x\\)` to write inline math'
      render(<RenderMarkdown content={content} />)
      const text = document.querySelector('.markdown')?.textContent || ''
      expect(text).toContain('\\(x\\)')
      expect(document.querySelector('.katex')).toBeNull()
    })
  })

  describe('emphasis glued to punctuation (CommonMark flanking)', () => {
    const strong = () =>
      document.querySelector('.markdown [data-streamdown="strong"]')

    it('renders bold punctuation glued to a word as strong', async () => {
      render(
        <RenderMarkdown content={'I went home**,** and slept'} isAnimating={false} />
      )
      await waitFor(() => expect(strong()).toBeTruthy())
      expect(strong()?.textContent?.replace(/​/g, '')).toBe(',')
      expect(document.querySelector('.markdown')?.textContent).not.toContain('**')
    })

    it('handles glued bold around CJK punctuation', async () => {
      render(<RenderMarkdown content={'中文**，**测试'} isAnimating={false} />)
      await waitFor(() => expect(strong()).toBeTruthy())
      expect(strong()?.textContent?.replace(/​/g, '')).toBe('，')
    })

    it('leaves stray asterisks alone (no false emphasis)', async () => {
      render(<RenderMarkdown content={'use 2 ** 3 maybe'} isAnimating={false} />)
      await waitFor(() =>
        expect(document.querySelector('.markdown p')).toBeTruthy()
      )
      expect(strong()).toBeNull()
    })

    it('does not touch normal bold spans', async () => {
      render(<RenderMarkdown content={'a **bold** word'} isAnimating={false} />)
      await waitFor(() => expect(strong()).toBeTruthy())
      expect(strong()?.textContent).toBe('bold')
    })
  })

  describe('LaTeX normalization - HTML tag recognition', () => {
    it('does not treat invalid ("<",">") pairs as HTML tag', () => {
      const content = '$1 < $2, So choose the $1 one.\n\n> quoted content'
      render(<RenderMarkdown content={content} />)
      const katexContainer = document.querySelector('.katex')
      // Should not treat < $2, So choose the $1 one.\n\n> as HTML tag
      expect(katexContainer).toBeNull()
    })
  })

  describe('interactive HTML artifacts', () => {
    const HTML_MSG = 'Here:\n\n```html\n<h1>hi</h1>\n```\n'

    // CodeBlock highlights via async Shiki; await the resulting <pre> so the
    // post-render state update settles inside the test rather than leaking.
    const flush = (container: HTMLElement) =>
      waitFor(() => expect(container.querySelector('pre')).toBeTruthy())

    afterEach(() => {
      // Unmount before resetting so the store update doesn't re-render a live,
      // subscribed RenderMarkdown outside act.
      cleanup()
      act(() => {
        useInterfaceSettings.getState().setRenderHtmlArtifacts(false)
      })
    })

    it('renders the Streamdown code block (not an artifact) when the setting is off', async () => {
      const { container } = render(<RenderMarkdown content={HTML_MSG} />)
      expect(container.querySelector('[data-testid="html-artifact"]')).toBeNull()
      expect(
        container.querySelector('[data-streamdown="code-block"]')
      ).toBeTruthy()
      await flush(container)
    })

    it('renders an HtmlArtifact when the setting is on and not streaming', async () => {
      useInterfaceSettings.getState().setRenderHtmlArtifacts(true)
      const { container } = render(<RenderMarkdown content={HTML_MSG} />)
      expect(
        container.querySelector('[data-testid="html-artifact"]')
      ).toBeTruthy()
      // Defaults to the Preview iframe (no async Shiki highlight to flush).
      expect(
        container.querySelector('[data-testid="html-artifact-iframe"]')
      ).toBeTruthy()
    })

    it('falls through to the code block while streaming even when the setting is on', async () => {
      useInterfaceSettings.getState().setRenderHtmlArtifacts(true)
      const { container } = render(
        <RenderMarkdown content={HTML_MSG} isStreaming />
      )
      expect(container.querySelector('[data-testid="html-artifact"]')).toBeNull()
      await flush(container)
    })

    it('does not create an artifact for non-html code when the setting is on', async () => {
      useInterfaceSettings.getState().setRenderHtmlArtifacts(true)
      const { container } = render(
        <RenderMarkdown content={'```js\nconst x = 1\n```'} />
      )
      expect(container.querySelector('[data-testid="html-artifact"]')).toBeNull()
      await flush(container)
    })
  })
})

