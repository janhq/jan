import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AnnotationOverlay } from '../AnnotationOverlay'

// jsdom doesn't have ResizeObserver
beforeAll(() => {
  class MockResizeObserver {
    callback: ResizeObserverCallback
    constructor(cb: ResizeObserverCallback) { this.callback = cb }
    observe() { this.callback([{ contentRect: { width: 600, height: 400 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    unobserve() {}
    disconnect() {}
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof globalThis.ResizeObserver === 'undefined') {
    // @ts-expect-error -- jsdom polyfill
    globalThis.ResizeObserver = MockResizeObserver
  }
})

// Mock react-konva to avoid canvas issues in jsdom
vi.mock('react-konva', () => ({
  Stage: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div data-testid="konva-stage" {...props}>
      {children}
    </div>
  ),
  Layer: ({ children }: { children: React.ReactNode }) => <div data-testid="konva-layer">{children}</div>,
  Group: ({ children }: { children: React.ReactNode }) => <div data-testid="konva-note">{children}</div>,
  Line: () => null,
  Arrow: () => null,
  Text: () => null,
  Circle: () => null,
  Rect: () => null,
}))

const pin = (rect: { x: number; y: number; width: number; height: number }, label = 'div#hero') =>
  fireEvent(
    window,
    new MessageEvent('message', {
      data: { source: 'jan-preview-inspector', type: 'pin', label, rect },
    })
  )

type FakeStage = HTMLElement & {
  setPos: (p: { x: number; y: number }) => void
}

/**
 * The mocked Stage is a plain div, so it has none of the Konva stage API the
 * overlay reads (pointer position, size, export). Bolt a minimal one onto the
 * node: `e.target.getStage()` and the `stageRef` both resolve to it.
 */
function equipStage(): FakeStage {
  const el = screen.getByTestId('konva-stage') as FakeStage &
    Record<string, unknown>
  let pos = { x: 0, y: 0 }
  el.getStage = () => el
  el.getPointerPosition = () => pos
  el.width = () => 600
  el.height = () => 400
  el.toDataURL = () => 'data:image/png;base64,AAAA'
  el.setPos = (p: { x: number; y: number }) => {
    pos = p
  }
  return el
}

/** Draw one pencil stroke on the mocked stage. */
const strokeOn = (stage: FakeStage) => {
  stage.setPos({ x: 10, y: 10 })
  fireEvent.mouseDown(stage)
  stage.setPos({ x: 40, y: 60 })
  fireEvent.mouseMove(stage)
  stage.setPos({ x: 90, y: 120 })
  fireEvent.mouseMove(stage)
  fireEvent.mouseUp(stage)
}

describe('AnnotationOverlay', () => {
  const defaultProps = {
    active: false,
    onSend: vi.fn(),
    onCancel: vi.fn(),
  }

  it('renders children when inactive', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={false}>
        <div>Preview content</div>
      </AnnotationOverlay>
    )
    expect(screen.getByText('Preview content')).toBeTruthy()
    // Toolbar should NOT be visible
    expect(screen.queryByLabelText('Pencil (freehand)')).toBeNull()
  })

  it('shows the toolbar when active', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview content</div>
      </AnnotationOverlay>
    )
    expect(screen.getByText('Preview content')).toBeTruthy()
    expect(screen.getByLabelText('Select (inspect)')).toBeTruthy()
    expect(screen.getByLabelText('Pencil (freehand)')).toBeTruthy()
    expect(screen.getByLabelText('Arrow')).toBeTruthy()
    expect(screen.getByLabelText('Text')).toBeTruthy()
    expect(screen.getByLabelText('Exit annotation mode')).toBeTruthy()
  })

  it('shows Konva canvas when active', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    expect(screen.getByTestId('konva-stage')).toBeTruthy()
    expect(screen.getByTestId('konva-layer')).toBeTruthy()
  })

  it('keeps undo/clear and the send pill hidden until something is drawn', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    expect(screen.queryByLabelText('Undo (last shape)')).toBeNull()
    expect(screen.queryByLabelText('Clear all')).toBeNull()
    expect(screen.queryByText('Send to model')).toBeNull()

    fireEvent.click(screen.getByLabelText('Pencil (freehand)'))
    strokeOn(equipStage())

    expect(screen.getByLabelText('Undo (last shape)')).toBeTruthy()
    expect(screen.getByText('Send to model')).toBeTruthy()
  })

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn()
    render(
      <AnnotationOverlay {...defaultProps} active={true} onCancel={onCancel}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    fireEvent.click(screen.getByLabelText('Pencil (freehand)'))
    strokeOn(equipStage())
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('exits via the toolbar close button', () => {
    const onCancel = vi.fn()
    render(
      <AnnotationOverlay {...defaultProps} active={true} onCancel={onCancel}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    fireEvent.click(screen.getByLabelText('Exit annotation mode'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('hides style controls in select mode and shows them for drawing tools', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    expect(screen.queryByLabelText('Colour and stroke width')).toBeNull()
    fireEvent.click(screen.getByLabelText('Pencil (freehand)'))
    expect(screen.getByLabelText('Colour and stroke width')).toBeTruthy()
  })

  it('exposes the palette and stroke widths in the style popover', async () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    fireEvent.click(screen.getByLabelText('Pencil (freehand)'))
    fireEvent.click(screen.getByLabelText('Colour and stroke width'))

    const hexColors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7']
    for (const hex of hexColors) {
      expect(await screen.findByTitle(hex)).toBeTruthy()
    }
    expect(screen.getByTitle('2px')).toBeTruthy()
    expect(screen.getByTitle('3px')).toBeTruthy()
    expect(screen.getByTitle('5px')).toBeTruthy()
  })

  it('defaults to the select (inspect) tool and passes clicks through', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    const selectBtn = screen.getByLabelText('Select (inspect)')
    expect(selectBtn.className).toContain('bg-main-view-fg/10')
    expect(selectBtn.className).toContain('text-main-view-fg')
    // In select mode the stage must not swallow clicks (the element inspector
    // lives in the preview iframe below it). `listening` is a Konva-node prop
    // (not DOM-observable); pointer-events:none is what actually lets events
    // through to the iframe.
    const stage = screen.getByTestId('konva-stage')
    expect((stage as HTMLElement).style.pointerEvents).toBe('none')
  })

  it('re-enables stage events when a drawing tool is picked', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    fireEvent.click(screen.getByLabelText('Pencil (freehand)'))
    const stage = screen.getByTestId('konva-stage')
    expect((stage as HTMLElement).style.pointerEvents).toBe('auto')
  })

  it('switches tools with keyboard shortcuts', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    fireEvent.keyDown(window, { key: 'p' })
    expect(screen.getByLabelText('Pencil (freehand)').className).toContain('bg-main-view-fg/10')
    fireEvent.keyDown(window, { key: 'a' })
    expect(screen.getByLabelText('Arrow').className).toContain('bg-main-view-fg/10')
    fireEvent.keyDown(window, { key: 'v' })
    expect(screen.getByLabelText('Select (inspect)').className).toContain('bg-main-view-fg/10')
  })

  it('undoes the last shape with cmd+z', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    fireEvent.click(screen.getByLabelText('Pencil (freehand)'))
    strokeOn(equipStage())
    expect(screen.getByText('Send to model')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'z', metaKey: true })
    // Last (and only) shape gone -> back to the empty state.
    expect(screen.queryByText('Send to model')).toBeNull()
  })

  it('pins an element without forcing a note open', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    pin({ x: 50, y: 60, width: 100, height: 30 }, 'div#hero.card')
    // The note is offered against the named element, not opened.
    expect(screen.getByTitle('Add a note on div#hero.card')).toBeTruthy()
    expect(screen.queryByPlaceholderText('Add note…')).toBeNull()

    fireEvent.click(screen.getByText('Note'))
    expect(screen.getByPlaceholderText('Add note…')).toBeTruthy()
  })

  it('drops the pin chip when the inspector clears', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    pin({ x: 0, y: 0, width: 40, height: 20 }, 'span.badge')
    expect(screen.getByTitle('Add a note on span.badge')).toBeTruthy()
    fireEvent(
      window,
      new MessageEvent('message', {
        data: { source: 'jan-preview-inspector', type: 'clear' },
      })
    )
    expect(screen.queryByTitle('Add a note on span.badge')).toBeNull()
  })

  it('commits a note from the pinned element', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    pin({ x: 10, y: 10, width: 40, height: 20 })
    fireEvent.click(screen.getByText('Note'))
    fireEvent.change(screen.getByPlaceholderText('Add note…'), {
      target: { value: 'fix this' },
    })
    fireEvent.keyDown(screen.getByPlaceholderText('Add note…'), { key: 'Enter' })

    expect(screen.queryByPlaceholderText('Add note…')).toBeNull()
    // Committed as a note card on the stage.
    expect(screen.getByTestId('konva-note')).toBeTruthy()
    expect(screen.getByText('Send to model')).toBeTruthy()
  })

  it('offers, but does not open, a note at the tip of a finished stroke', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    fireEvent.click(screen.getByLabelText('Pencil (freehand)'))
    strokeOn(equipStage())

    expect(screen.queryByPlaceholderText('Add note…')).toBeNull()
    fireEvent.click(screen.getByLabelText('Add a note here'))
    expect(screen.getByPlaceholderText('Add note…')).toBeTruthy()
  })

  it('discards an empty note instead of committing a blank card', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    pin({ x: 10, y: 10, width: 40, height: 20 })
    fireEvent.click(screen.getByText('Note'))
    fireEvent.keyDown(screen.getByPlaceholderText('Add note…'), { key: 'Enter' })
    expect(screen.queryByPlaceholderText('Add note…')).toBeNull()
    expect(screen.queryByTestId('konva-note')).toBeNull()
    expect(screen.queryByText('Send to model')).toBeNull()
  })

  it('clears everything when annotation mode is deactivated', () => {
    const { rerender } = render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    pin({ x: 0, y: 0, width: 40, height: 20 }, 'p.lead')
    expect(screen.getByTitle('Add a note on p.lead')).toBeTruthy()
    rerender(
      <AnnotationOverlay {...defaultProps} active={false}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    // Inactive: no overlay UI at all.
    expect(screen.queryByTitle('Add a note on p.lead')).toBeNull()
  })

  it('blocks the send and explains when the base render fails', async () => {
    const onSend = vi.fn()
    const captureBase = vi.fn().mockRejectedValue(new Error('no Chrome binary found'))
    render(
      <AnnotationOverlay
        {...defaultProps}
        active={true}
        onSend={onSend}
        captureBase={captureBase}
      >
        <div>Preview</div>
      </AnnotationOverlay>
    )
    fireEvent.click(screen.getByLabelText('Pencil (freehand)'))
    strokeOn(equipStage())
    fireEvent.click(screen.getByText('Send to model'))

    await waitFor(() =>
      expect(screen.getByText(/no Chrome binary found/)).toBeTruthy()
    )
    expect(onSend).not.toHaveBeenCalled()
    // Sending the marks alone is now an explicit, labelled second choice.
    expect(screen.getByText('Send marks only')).toBeTruthy()
  })
})
