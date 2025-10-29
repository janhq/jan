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
  it('preverses line breaks in model responses (when isUser == undefined)', () => {
    const modelREsponseWithNewLines = `This is line 1
    This is line 2
    This is line 3`
    render (
      <RenderMarkdown
        content={modelREsponseWithNewLines}
      />
    )
    const markdownContainer = document.querySelector('.markdown')
    expect(markdownContainer?.innerHTML).toContain('<br>')
    // Match either <br> or <br/>
    const brCount = (markdownContainer?.innerHTML.match(/<br\s*\/?>/g) || []).length
    expect(brCount).toBe(2)
  })
  
  it('preserves line breaks in user message (when isUser == true', () => {
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
    console.log({ brCount })
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
})