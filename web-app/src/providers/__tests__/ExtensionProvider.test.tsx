import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ExtensionProvider } from '../ExtensionProvider'

const mockRegisterActive = vi.fn()
const mockLoad = vi.fn()
const mockUnload = vi.fn()

vi.mock('@/lib/extension', () => ({
  ExtensionManager: class {
    static inst: any = null
    static getInstance() {
      if (!this.inst) this.inst = new this()
      return this.inst
    }
    registerActive = mockRegisterActive
    load = mockLoad
    unload = mockUnload
  },
}))

vi.mock('@/lib/service', () => ({ APIs: {} }))
vi.mock('@/services/events/EventEmitter', () => ({ EventEmitter: vi.fn() }))
vi.mock('@janhq/core', () => ({ EngineManager: vi.fn(), ModelManager: vi.fn() }))

describe('ExtensionProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders children after registerActive + load complete', async () => {
    mockRegisterActive.mockImplementation(() => ({
      then: (cb: any) => ({
        then: (cb2: any) => {
          cb()
          return Promise.resolve().then(() => cb2())
        },
      }),
    }))

    render(
      <ExtensionProvider>
        <div data-testid="child">Hello</div>
      </ExtensionProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('child')).toBeInTheDocument()
    })
  })

  it('does not render children before setup completes', () => {
    let resolve: (v: any) => void
    const pending = new Promise((r) => { resolve = r })
    mockRegisterActive.mockImplementation(() => ({
      then: () => ({ then: () => pending }),
    }))

    const { container, unmount } = render(
      <ExtensionProvider>
        <div data-testid="child">Hello</div>
      </ExtensionProvider>
    )
    expect(container.querySelector('[data-testid="child"]')).toBeNull()
    // Resolve and unmount to prevent vitest from hanging
    resolve!(undefined)
    unmount()
  })

  it('calls unload on unmount', async () => {
    mockRegisterActive.mockImplementation(() => ({
      then: (cb: any) => ({
        then: (cb2: any) => {
          cb()
          return Promise.resolve().then(() => cb2())
        },
      }),
    }))

    const { unmount } = render(
      <ExtensionProvider>
        <div>Test</div>
      </ExtensionProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Test')).toBeInTheDocument()
    })

    unmount()
    expect(mockUnload).toHaveBeenCalled()
  })

  it('sets up window.core with api and managers', async () => {
    mockRegisterActive.mockImplementation(() => ({
      then: (cb: any) => ({
        then: (cb2: any) => {
          cb()
          return Promise.resolve().then(() => cb2())
        },
      }),
    }))

    render(
      <ExtensionProvider>
        <div>Test</div>
      </ExtensionProvider>
    )

    await waitFor(() => {
      expect(window.core).toBeDefined()
      expect(window.core.api).toBeDefined()
    })
  })
})
