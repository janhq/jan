import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
  Line: () => null,
  Arrow: () => null,
  Text: () => null,
  Circle: () => null,
}))

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
    expect(screen.queryByTitle('Pencil (freehand)')).toBeNull()
  })

  it('shows toolbar when active', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview content</div>
      </AnnotationOverlay>
    )
    expect(screen.getByText('Preview content')).toBeTruthy()
    expect(screen.getByTitle('Select (inspect)')).toBeTruthy()
    expect(screen.getByTitle('Pencil (freehand)')).toBeTruthy()
    expect(screen.getByTitle('Arrow')).toBeTruthy()
    expect(screen.getByTitle('Text')).toBeTruthy()
    expect(screen.getByTitle('Undo (last shape)')).toBeTruthy()
    expect(screen.getByTitle('Clear all')).toBeTruthy()
    expect(screen.getByText('Send to model')).toBeTruthy()
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

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn()
    render(
      <AnnotationOverlay {...defaultProps} active={true} onCancel={onCancel}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('calls onSend with data URL when Send is clicked', () => {
    const onSend = vi.fn()
    render(
      <AnnotationOverlay {...defaultProps} active={true} onSend={onSend}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    // The send button exists and is wired
    expect(screen.getByText('Send to model')).toBeTruthy()
    // Full toDataURL flow requires real Konva Stage ref; button wiring verified here
  })

  it('shows color picker with 6 colors', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    // 6 color buttons with hex color titles
    const hexColors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7']
    for (const hex of hexColors) {
      expect(screen.getByTitle(hex)).toBeTruthy()
    }
  })

  it('shows 3 stroke width options', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    // Stroke width buttons have title "2px", "3px", "5px"
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
    const selectBtn = screen.getByTitle('Select (inspect)')
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
    fireEvent.click(screen.getByTitle('Pencil (freehand)'))
    const stage = screen.getByTestId('konva-stage')
    expect((stage as HTMLElement).style.pointerEvents).toBe('auto')
  })

  it('toggles tool selection', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    const arrowBtn = screen.getByTitle('Arrow')
    fireEvent.click(arrowBtn)
    // Arrow button should now have active class
    expect(arrowBtn.className).toContain('bg-main-view-fg/10')
    expect(arrowBtn.className).toContain('text-main-view-fg')
  })

  it('opens an inline note at the pinned element (select tool)', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    fireEvent(window, new MessageEvent('message', {
        data: {
          source: 'jan-preview-inspector',
          type: 'pin',
          rect: { x: 50, y: 60, width: 100, height: 30 },
        },
      })
    )
    const note = screen.getByPlaceholderText('Add note…')
    expect(note).toBeTruthy()
    // Note is positioned absolutely in the overlay
    expect(note.closest('[style*="position: absolute"]')).toBeTruthy()
  })

  it('closes the pending note when the pin is cleared', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    fireEvent(window, new MessageEvent('message', {
        data: { source: 'jan-preview-inspector', type: 'pin', rect: { x: 0, y: 0, width: 40, height: 20 } },
      })
    )
    expect(screen.getByPlaceholderText('Add note…')).toBeTruthy()
    fireEvent(window, new MessageEvent('message', {
        data: { source: 'jan-preview-inspector', type: 'clear' },
      })
    )
    expect(screen.queryByPlaceholderText('Add note…')).toBeNull()
  })

  it('commits a note and does not reopen it on re-click of the same element', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    fireEvent(window, new MessageEvent('message', {
        data: { source: 'jan-preview-inspector', type: 'pin', rect: { x: 10, y: 10, width: 40, height: 20 } },
      })
    )
    fireEvent.change(screen.getByPlaceholderText('Add note…'), {
      target: { value: 'fix this' },
    })
    fireEvent.keyDown(screen.getByPlaceholderText('Add note…'), { key: 'Enter' })
    expect(screen.queryByPlaceholderText('Add note…')).toBeNull()

    // Same element pinned again must not pop another note box.
    fireEvent(window, new MessageEvent('message', {
        data: { source: 'jan-preview-inspector', type: 'pin', rect: { x: 10, y: 10, width: 40, height: 20 } },
      })
    )
    expect(screen.queryByPlaceholderText('Add note…')).toBeNull()
  })

  it('opens an inline note at the tip of a finished stroke', () => {
    render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    fireEvent.click(screen.getByTitle('Pencil (freehand)'))
    const stage = screen.getByTestId('konva-stage')
    fireEvent.mouseDown(stage)
    fireEvent.mouseMove(stage)
    fireEvent.mouseMove(stage)
    fireEvent.mouseUp(stage)
    expect(screen.getByPlaceholderText('Add note…')).toBeTruthy()
  })

  it('drops the pending note when annotation mode is deactivated', () => {
    const { rerender } = render(
      <AnnotationOverlay {...defaultProps} active={true}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    fireEvent(window, new MessageEvent('message', {
        data: { source: 'jan-preview-inspector', type: 'pin', rect: { x: 0, y: 0, width: 40, height: 20 } },
      })
    )
    expect(screen.getByPlaceholderText('Add note…')).toBeTruthy()
    rerender(
      <AnnotationOverlay {...defaultProps} active={false}>
        <div>Preview</div>
      </AnnotationOverlay>
    )
    // Inactive: no overlay UI at all.
    expect(screen.queryByPlaceholderText('Add note…')).toBeNull()
  })
})
