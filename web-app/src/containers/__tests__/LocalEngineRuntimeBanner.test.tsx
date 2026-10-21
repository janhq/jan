import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { LocalEngineRuntimeBanner } from '../LocalEngineRuntimeBanner'

const checkLocalEngine = vi.fn()
const installLocalEngineRuntime = vi.fn()

vi.mock('@janhq/tauri-plugin-local-engine-api', () => ({
  checkLocalEngine: (...args: unknown[]) => checkLocalEngine(...args),
  installLocalEngineRuntime: (...args: unknown[]) =>
    installLocalEngineRuntime(...args),
}))

describe('LocalEngineRuntimeBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports that the runtime is ready', async () => {
    checkLocalEngine.mockResolvedValue({ engine: 'litert-lm', available: true })

    render(
      <LocalEngineRuntimeBanner engine="litert-lm" name="LiteRT-LM" />
    )

    await waitFor(() => {
      expect(screen.getByText(/runtime is ready/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers to install a missing runtime', async () => {
    checkLocalEngine.mockResolvedValue({
      engine: 'litert-lm',
      available: false,
      error: "The 'litert_lm' package is not importable by this interpreter",
    })

    render(
      <LocalEngineRuntimeBanner engine="litert-lm" name="LiteRT-LM" />
    )

    await waitFor(() => {
      expect(screen.getByText(/runtime is not installed/i)).toBeInTheDocument()
    })
    expect(
      screen.getByText(/not importable by this interpreter/i)
    ).toBeInTheDocument()

    const button = screen.getByRole('button', { name: /install litert-lm/i })
    expect(button).toBeInTheDocument()
  })

  it('installs the runtime and checks again', async () => {
    checkLocalEngine
      .mockResolvedValueOnce({ engine: 'openvino', available: false })
      .mockResolvedValueOnce({ engine: 'openvino', available: true })
    installLocalEngineRuntime.mockResolvedValue('/venv/bin/python')

    render(<LocalEngineRuntimeBanner engine="openvino" name="OpenVINO" />)

    const button = await screen.findByRole('button', {
      name: /install openvino/i,
    })
    await userEvent.click(button)

    await waitFor(() => {
      expect(installLocalEngineRuntime).toHaveBeenCalledWith(
        'openvino',
        expect.any(String)
      )
    })
    await waitFor(() => {
      expect(screen.getByText(/runtime is ready/i)).toBeInTheDocument()
    })
  })

  it('does not offer an install button for an engine Jan does not manage', async () => {
    checkLocalEngine.mockResolvedValue({
      engine: 'other',
      available: false,
      error: 'no interpreter',
    })

    render(<LocalEngineRuntimeBanner engine="other" name="Other" />)

    await waitFor(() => {
      expect(screen.getByText(/runtime is not installed/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
