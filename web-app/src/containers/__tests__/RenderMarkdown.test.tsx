import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RenderMarkdown } from '../RenderMarkdown';

vi.mock('@i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn()
  }
})

describe('RenderMarkdown', () => {
  it('preserves line breaks in model responses (when isUser == undefined)', () => {
    const modelResponseWithNewLines = `This is line 1
    This is line 2
    This is line 3`
    render (
      <RenderMarkdown
        content={modelResponseWithNewLines}
      />
    )
    const markdownContainer = document.querySelector('.markdown')
    expect(markdownContainer?.innerHTML).toContain('<br>')
    // Match either <br> or <br/>
    const brCount = (markdownContainer?.innerHTML.match(/<br\s*\/?>/g) || []).length
    expect(brCount).toBe(2)
  })
  
  it('preserves line breaks in user message (when isUser == true)', () => {
    const userMessageWithNewlines = `User question line 1
    User question line 2
    User question line 3`
    render(
      <RenderMarkdown
        content={userMessageWithNewlines}
        isUser={true}
      />
    )
    const markdownContainer = document.querySelector('.markdown')
    expect(markdownContainer).toBeTruthy()
    expect(markdownContainer?.innerHTML).toContain('<br>')
    const brCount = (markdownContainer?.innerHTML.match(/<br\s*\/?>/g) || []).length
    expect(brCount).toBe(2)
  })

  it('preserves line breaks with different line ending types', () => {
    const contentWithDifferentLineEndings = "Line1\nLine2\r\nLine3\rLine4"
    render(
      <RenderMarkdown
        content={contentWithDifferentLineEndings}
      />
    )
    const markdownContainer = document.querySelector('.markdown')
    expect(markdownContainer?.innerHTML).toContain('<br>')
    const brCount = (markdownContainer?.innerHTML.match(/<br\s*\/?>/g) || []).length
    expect(brCount).toBe(3)
  })

  it('handles empty lines correctly', () => {
    const contentWithEmptyLines = 'Line 1\n\nLine 3 (after empty line)\n\nLine 5 (after two empty lines)'
    render(
      <RenderMarkdown
        content={contentWithEmptyLines}
      />
    )
    const markdownContainer = document.querySelector('.markdown')
    const html = markdownContainer?.innerHTML || ''
    // Double new lines (`\n\n`) creates paragraph breaks, not line breaks
    expect(html).not.toContain('<br>')
    const paragraphCount = (html.match(/<p>/g) || []).length
    expect(paragraphCount).toBe(3)  // Expect 3 paragraphs for 2 empty lines
  })

  it('does not format indented text as code blocks', () => {
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
            <p>&copy; 2023 My Sample Website. All rights reserved.</p>
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
  })
  
  it('formats fenced code blocks correctly', () => {
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
        <p>&copy; 2023 My Sample Website. All rights reserved.</p>
    </footer>
</body>
</html>
\`\`\`
`
    render(
      <RenderMarkdown
        content={contentWithFencedCodeBlock}
      />
    )
    const markdownContainer = document.querySelector('.markdown')
    const html = markdownContainer?.innerHTML || ''
    console.log(html)
    expect(1).toBe(1) // Dummy assertion to ensure test runs
    expect(html).toContain('<pre>')
  })
})