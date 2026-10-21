import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { ImportLocalEngineModelDialog } from '../ImportLocalEngineModelDialog'

const openDialog = vi.fn()
const engineImport = vi.fn()
const toastError = vi.fn()

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
  },
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    dialog: () => ({ open: openDialog }),
  }),
}))

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: () => ({
      getEngine: () => ({ import: engineImport }),
    }),
  },
}))

const provider = {
  provider: 'litert-lm',
  active: true,
  models: [],
} as unknown as ModelProvider

describe('ImportLocalEngineModelDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    engineImport.mockResolvedValue(undefined)
  })

  it('imports a model file the user picked', async () => {
    openDialog.mockResolvedValue('C:\\models\\Qwen3-0.6B.litertlm')

    render(
      <ImportLocalEngineModelDialog
        provider={provider}
        trigger={<button>open</button>}
      />
    )

    await userEvent.click(screen.getByText('open'))
    await userEvent.click(
      await screen.findByRole('button', { name: /select model file/i })
    )

    const nameInput = await screen.findByPlaceholderText('my-model')
    await waitFor(() => {
      expect((nameInput as HTMLInputElement).value).toBe('Qwen3-0.6B.litertlm')
    })

    await userEvent.click(screen.getByRole('button', { name: /import model/i }))

    await waitFor(() => {
      expect(engineImport).toHaveBeenCalledWith('Qwen3-0.6B.litertlm', {
        modelPath: 'C:\\models\\Qwen3-0.6B.litertlm',
      })
    })
  })

  it('imports a model from a URL', async () => {
    render(
      <ImportLocalEngineModelDialog
        provider={provider}
        trigger={<button>open</button>}
      />
    )

    await userEvent.click(screen.getByText('open'))
    const nameInput = await screen.findByPlaceholderText('my-model')
    await userEvent.type(nameInput, 'qwen3')

    const urlInput = screen.getByPlaceholderText(/huggingface.co/i)
    await userEvent.type(
      urlInput,
      'https://huggingface.co/litert-community/Qwen3-0.6B/resolve/main/model.litertlm'
    )

    await userEvent.click(screen.getByRole('button', { name: /import model/i }))

    await waitFor(() => {
      expect(engineImport).toHaveBeenCalledWith('qwen3', {
        modelPath:
          'https://huggingface.co/litert-community/Qwen3-0.6B/resolve/main/model.litertlm',
      })
    })
  })

  it('refuses a model name with illegal characters', async () => {
    render(
      <ImportLocalEngineModelDialog
        provider={provider}
        trigger={<button>open</button>}
      />
    )

    await userEvent.click(screen.getByText('open'))
    const nameInput = await screen.findByPlaceholderText('my-model')
    await userEvent.type(nameInput, 'bad name!')

    const urlInput = screen.getByPlaceholderText(/huggingface.co/i)
    await userEvent.type(urlInput, 'https://example.com/model.litertlm')

    await userEvent.click(screen.getByRole('button', { name: /import model/i }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        expect.stringMatching(/invalid model name/i)
      )
    })
    expect(engineImport).not.toHaveBeenCalled()
  })
})
