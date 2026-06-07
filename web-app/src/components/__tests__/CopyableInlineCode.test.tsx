import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CopyableInlineCode } from '../CopyableInlineCode'

describe('CopyableInlineCode', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Mirrors how Streamdown renders inline code: a <code> tagged with
  // data-streamdown="inline-code", which the component targets via delegation.
  const renderWithCode = () =>
    render(
      <CopyableInlineCode>
        <p>
          Set <code data-streamdown="inline-code">upgrade_disk</code> to false
        </p>
      </CopyableInlineCode>
    )

  it('copies the inline code text to the clipboard on click', async () => {
    renderWithCode()
    fireEvent.click(screen.getByText('upgrade_disk'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('upgrade_disk'))
  })

  it('shows a "Copied!" badge after copying', async () => {
    renderWithCode()
    fireEvent.click(screen.getByText('upgrade_disk'))
    expect(await screen.findByText('Copied!')).toBeInTheDocument()
  })

  it('does not copy when the user has an active text selection (drag-select)', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      toString: () => 'upgrade',
    } as unknown as Selection)

    renderWithCode()
    fireEvent.click(screen.getByText('upgrade_disk'))

    expect(writeText).not.toHaveBeenCalled()
    expect(screen.queryByText('Copied!')).not.toBeInTheDocument()
  })

  it('ignores clicks outside inline code', () => {
    render(
      <CopyableInlineCode>
        <p>plain text only</p>
      </CopyableInlineCode>
    )
    fireEvent.click(screen.getByText('plain text only'))
    expect(writeText).not.toHaveBeenCalled()
  })

  it('degrades gracefully when the clipboard write is rejected', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    renderWithCode()
    fireEvent.click(screen.getByText('upgrade_disk'))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(screen.queryByText('Copied!')).not.toBeInTheDocument()
  })
})
