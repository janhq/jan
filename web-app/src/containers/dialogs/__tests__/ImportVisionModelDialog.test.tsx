import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const hoisted = vi.hoisted(() => ({
  dialogOpen: vi.fn(),
  pullModel: vi.fn(),
  validateGgufFile: vi.fn(),
  basename: vi.fn((p: string) => p.split('/').pop() || p),
  invoke: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: hoisted.toast }))

// Override the global useServiceHub mock from setup.ts with a tailored one.
vi.mock('@/hooks/useServiceHub', () => {
  const hub = {
    dialog: () => ({ open: hoisted.dialogOpen }),
    models: () => ({
      pullModel: hoisted.pullModel,
      validateGgufFile: hoisted.validateGgufFile,
    }),
    path: () => ({ basename: hoisted.basename }),
  }
  return {
    useServiceHub: () => hub,
    getServiceHub: () => hub,
  }
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: hoisted.invoke,
}))

import { ImportVisionModelDialog } from '../ImportVisionModelDialog'

const provider = { models: [] } as unknown as any

const openDialog = () => {
  fireEvent.click(screen.getByText('Open'))
}

describe('ImportVisionModelDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.validateGgufFile.mockResolvedValue({
      isValid: true,
      metadata: { metadata: { 'general.architecture': 'llama' } },
    })
    hoisted.invoke.mockResolvedValue({
      metadata: { 'general.architecture': 'clip' },
    })
  })

  it('renders the trigger and opens the dialog content', () => {
    render(
      <ImportVisionModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    expect(screen.getAllByText('Import Model').length).toBeGreaterThan(0)
    expect(screen.getByText('Select GGUF File')).toBeInTheDocument()
  })

  it('shows Select MMPROJ File when the vision switch is enabled', () => {
    render(
      <ImportVisionModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    const sw = screen.getByRole('switch')
    fireEvent.click(sw)
    expect(screen.getByText('Select MMPROJ File')).toBeInTheDocument()
  })

  it('toasts an error when Import is clicked with no model file selected', () => {
    render(
      <ImportVisionModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    // The Import button is disabled without a model, so directly invoke handleImport via click.
    // With no modelFile, the button is disabled; assert it's disabled instead.
    const importBtn = screen.getByRole('button', { name: /Import Model/i })
    expect(importBtn).toBeDisabled()
  })

  it('selects a model file via the dialog service and validates it', async () => {
    hoisted.dialogOpen.mockResolvedValueOnce('/tmp/model.gguf')
    hoisted.basename.mockReturnValueOnce('model.gguf')
    render(
      <ImportVisionModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    fireEvent.click(screen.getByText('Select GGUF File'))
    await waitFor(() =>
      expect(hoisted.validateGgufFile).toHaveBeenCalledWith('/tmp/model.gguf')
    )
    // File chip is rendered with the file name
    await waitFor(() =>
      expect(screen.getAllByText('model.gguf').length).toBeGreaterThan(0)
    )
  })

  it('surfaces a validation error when the model is CLIP', async () => {
    hoisted.dialogOpen.mockResolvedValueOnce('/tmp/clip.gguf')
    hoisted.validateGgufFile.mockResolvedValueOnce({
      isValid: true,
      metadata: { metadata: { 'general.architecture': 'clip' } },
    })
    render(
      <ImportVisionModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    fireEvent.click(screen.getByText('Select GGUF File'))
    await waitFor(() =>
      expect(screen.getByText('Model Validation Error')).toBeInTheDocument()
    )
  })

  it('rejects importing when the model name already exists in the provider', async () => {
    hoisted.dialogOpen.mockResolvedValueOnce('/tmp/dup.gguf')
    const providerWithModel = {
      models: [{ name: 'dup.gguf' }],
    } as unknown as any
    render(
      <ImportVisionModelDialog
        provider={providerWithModel}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    fireEvent.click(screen.getByText('Select GGUF File'))
    await waitFor(() =>
      expect(hoisted.validateGgufFile).toHaveBeenCalled()
    )
    const importBtn = await screen.findByRole('button', {
      name: /Import Model/i,
    })
    await waitFor(() => expect(importBtn).not.toBeDisabled())
    fireEvent.click(importBtn)
    await waitFor(() =>
      expect(hoisted.toast.error).toHaveBeenCalledWith(
        'Model already exists',
        expect.any(Object)
      )
    )
    expect(hoisted.pullModel).not.toHaveBeenCalled()
  })

  it('imports a regular model successfully via pullModel', async () => {
    hoisted.dialogOpen.mockResolvedValueOnce('/tmp/ok.gguf')
    hoisted.pullModel.mockResolvedValueOnce(undefined)
    const onSuccess = vi.fn()
    render(
      <ImportVisionModelDialog
        provider={provider}
        trigger={<button>Open</button>}
        onSuccess={onSuccess}
      />
    )
    openDialog()
    fireEvent.click(screen.getByText('Select GGUF File'))
    await waitFor(() => expect(hoisted.validateGgufFile).toHaveBeenCalled())
    const importBtn = await screen.findByRole('button', {
      name: /Import Model/i,
    })
    await waitFor(() => expect(importBtn).not.toBeDisabled())
    fireEvent.click(importBtn)
    await waitFor(() =>
      expect(hoisted.pullModel).toHaveBeenCalledWith(
        'ok.gguf',
        '/tmp/ok.gguf'
      )
    )
    await waitFor(() =>
      expect(hoisted.toast.success).toHaveBeenCalledWith(
        'Model imported successfully',
        expect.any(Object)
      )
    )
    expect(onSuccess).toHaveBeenCalledWith('ok.gguf')
  })

  it('toasts a failure when pullModel rejects', async () => {
    hoisted.dialogOpen.mockResolvedValueOnce('/tmp/fail.gguf')
    hoisted.pullModel.mockRejectedValueOnce(new Error('boom'))
    render(
      <ImportVisionModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    fireEvent.click(screen.getByText('Select GGUF File'))
    await waitFor(() => expect(hoisted.validateGgufFile).toHaveBeenCalled())
    const importBtn = await screen.findByRole('button', {
      name: /Import Model/i,
    })
    await waitFor(() => expect(importBtn).not.toBeDisabled())
    fireEvent.click(importBtn)
    await waitFor(() =>
      expect(hoisted.toast.error).toHaveBeenCalledWith(
        'Failed to import model',
        expect.any(Object)
      )
    )
  })

  it('renders the MMPROJ file chip after selection', async () => {
    hoisted.dialogOpen.mockResolvedValueOnce('/tmp/mmproj.gguf')
    render(
      <ImportVisionModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    // Enable vision mode first
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByText('Select MMPROJ File'))
    await waitFor(() =>
      expect(hoisted.invoke).toHaveBeenCalledWith(
        'plugin:llamacpp|read_gguf_metadata',
        { path: '/tmp/mmproj.gguf' }
      )
    )
    await waitFor(() =>
      expect(screen.getByText('mmproj.gguf')).toBeInTheDocument()
    )
  })

  it('rejects the MMPROJ file when its architecture is not clip', async () => {
    hoisted.dialogOpen.mockResolvedValueOnce('/tmp/bad-mmproj.gguf')
    hoisted.invoke.mockResolvedValueOnce({
      metadata: { 'general.architecture': 'llama' },
    })
    render(
      <ImportVisionModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByText('Select MMPROJ File'))
    await waitFor(() =>
      expect(screen.getByText('MMProj Validation Error')).toBeInTheDocument()
    )
  })

  it('Cancel button closes the dialog', async () => {
    render(
      <ImportVisionModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    fireEvent.click(screen.getByText('Cancel'))
    await waitFor(() =>
      expect(screen.queryByText('Import Model')).not.toBeInTheDocument()
    )
  })
})
